"""In-app update handoff with a real Inno Setup installer (tests/fixtures/update_handoff_test.iss).

The client runs from the install directory, so Setup has to wait for it before replacing its exe.
Checks: Setup asks the client to quit, the client exits on its own (not killed by Restart Manager),
the files are replaced, the new version is started from the install directory, and a Setup that
ends early (a declined UAC prompt) leaves the client running and reports back.
Everything happens in a temporary per-user directory; no uninstaller or registry entry is created.
"""
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
HOST = pathlib.Path(os.environ["INSTALLER_HANDOFF_HOST"])
ISCC = os.environ.get("ISCC", "")
QUIET = "/VERYSILENT"  # keeps Setup's progress window off the desktop during tests


def wait_for(predicate, seconds):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.2)
    return predicate()


def lines(path):
    return path.read_text(encoding="utf-8").split() if path.exists() else []


def main():
    if not ISCC or not pathlib.Path(ISCC).exists():
        print("SKIP: Inno Setup compiler not found")
        return 0
    with tempfile.TemporaryDirectory(prefix="tigerest-handoff-") as temp:
        temp = pathlib.Path(temp)
        subprocess.run([ISCC, "/Q", f"/DHostExe={HOST}", f"/DHandoffIss={ROOT / 'bundle/win/UpdateHandoff.iss'}",
                        f"/DOutputDir={temp}", str(ROOT / "tests/fixtures/update_handoff_test.iss")], check=True, timeout=120)
        setup = temp / "update-handoff-test-setup.exe"
        app = temp / "app dir"
        installed = app / HOST.name
        relaunched = app / "relaunched.txt"

        # The currently installed version.
        subprocess.run([str(setup), QUIET, "/SUPPRESSMSGBOXES", f'/DIR={app}', f'/LOG={temp / "first.log"}'], check=True, timeout=120)
        assert installed.exists(), "first install did not copy the client"
        time.sleep(1)
        assert not relaunched.exists(), "a plain install must not start the app"

        # In-app update: the running client hands over to Setup.
        marker, log = temp / "update.txt", temp / "update.log"
        client = subprocess.run([str(installed), "client", str(marker), str(setup), QUIET, f'/DIR="{app}"', f'/LOG="{log}"'], timeout=150)
        assert client.returncode == 0, f"client exit {client.returncode}: {lines(marker)}"
        assert lines(marker) == ["started", "close-requested", "exiting"], lines(marker)
        assert wait_for(relaunched.exists, 90), "the new version was not started"
        assert wait_for(lambda: "Installation process succeeded." in log.read_text(encoding="utf-8", errors="replace"), 30)
        text = log.read_text(encoding="utf-8", errors="replace")
        assert "Asked the updating client to quit" in text, text
        assert "still running" not in text, "Setup gave up waiting for the client"
        # Setup keeps the source timestamp, so the log shows whether the running client's exe was replaced.
        assert "Dest file exists." in text and "Successfully installed the file." in text, "the client exe was not replaced"
        assert text.index("Asked the updating client to quit") < text.index("Dest file exists."), "files were replaced before the client was asked to quit"

        # Setup ending before it signals (a declined UAC prompt): the client stays and is told.
        relaunched.unlink()
        marker = temp / "declined.txt"
        client = subprocess.run([str(installed), "client", str(marker), str(setup), QUIET, "/FAILEARLY=1"], timeout=150)
        assert client.returncode == 2 and lines(marker) == ["started", "returned"], (client.returncode, lines(marker))
        time.sleep(1)
        assert not relaunched.exists(), "an aborted Setup must not start the app"
        shutil.rmtree(app, ignore_errors=True)
    print("installer handoff: close request, graceful exit, file replacement, relaunch and declined Setup passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
