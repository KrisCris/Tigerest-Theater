"""Check the real EOF patch against the pinned Windows mpv source."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
BUILDER = ROOT / "dev/windows/rife/build_mpv.py"


class MpvBuildPreparationTests(unittest.TestCase):
    @unittest.skipUnless(os.environ.get("RIFE_TEST_MPV_SOURCE"), "requires pinned source checkout")
    def test_private_core_function_compiles_against_pinned_api(self):
        # Applying a patch does not validate its API names. Compile the actual
        # resulting function using our unmodified, pinned VapourSynth headers.
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            relative = Path("video/filter/vf_vapoursynth.c")
            target = base / relative
            target.parent.mkdir(parents=True)
            target.write_bytes((Path(os.environ["RIFE_TEST_MPV_SOURCE"]) / relative).read_bytes())
            subprocess.run(["git", "-C", str(base), "apply", "--include=video/filter/vf_vapoursynth.c", str(ROOT / "dev/macos/rife/mpv-eof-aware.patch"),
                            str(ROOT / "dev/windows/rife/mpv-private-vs-core.patch")], check=True,
                           capture_output=True)
            match = re.search(r"static int drv_vss_load_core\(struct priv \*p\)\n\{.*?\n\}",
                              target.read_text(encoding="utf-8"), re.S)
            self.assertIsNotNone(match)
            unit = base / "private_core.c"
            unit.write_text('#include <stddef.h>\n#include "VSScript4.h"\n'
                'struct options { int eof_aware; };\n'
                'struct priv { const VSSCRIPTAPI *vs_script_api; const VSAPI *vsapi; '
                'VSScript *vs_script; VSCore *vscore; struct options *opts; };\n'
                + match.group() + '\n', encoding="utf-8")
            compiler = os.environ.get("RIFE_TEST_C_COMPILER", "cl" if os.name == "nt" else "cc")
            flags = ["/nologo", "/Zs", "/TC", "/I" + str(ROOT / "dev/windows/rife/include")] if os.name == "nt" else [
                "-fsyntax-only", "-D_WIN32", "-D__stdcall=", "-D__declspec(x)=", "-I", str(ROOT / "dev/windows/rife/include")]
            result = subprocess.run([compiler, *flags, str(unit)], capture_output=True)
            self.assertEqual(result.returncode, 0, (result.stdout + result.stderr).decode("utf-8", errors="replace"))

    def run_check(self, source):
        with tempfile.TemporaryDirectory() as temp:
            report = Path(temp) / "report.json"
            result = subprocess.run([sys.executable, str(BUILDER), "--check-source", str(source),
                                     "--report", str(report)], capture_output=True, text=True, timeout=30)
            self.assertTrue(report.exists(), result.stderr)
            return result.returncode, json.loads(report.read_text(encoding="utf-8"))

    def test_wrong_source_is_rejected_before_build(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp)
            subprocess.run(["git", "init", "-q", str(source)], check=True)
            (source / "fixture").write_text("incorrect source", encoding="utf-8")
            subprocess.run(["git", "-C", str(source), "add", "fixture"], check=True)
            subprocess.run(["git", "-C", str(source), "-c", "user.name=Test",
                            "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture"], check=True)
            code, report = self.run_check(source)
            self.assertNotEqual(code, 0)
            self.assertEqual(report["errorCode"], "source-sha")

    @unittest.skipUnless(os.environ.get("RIFE_TEST_MPV_SOURCE"), "requires pinned source checkout")
    def test_complete_eof_patch_applies_without_modifying_original_source(self):
        source = Path(os.environ["RIFE_TEST_MPV_SOURCE"])
        code, report = self.run_check(source)
        self.assertEqual(code, 0, report)
        self.assertEqual(report["sourceSha"], "dd5d17d3285a095a0f712fa9d116e22a076492de")
        self.assertTrue(report["eofPatchApplicable"])
        self.assertTrue(report['privateCorePatchApplicable'])
        self.assertEqual(subprocess.run(["git", "-C", str(source), "diff", "--quiet"]).returncode, 0)


if __name__ == "__main__":
    unittest.main()
