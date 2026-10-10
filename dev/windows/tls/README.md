# Windows TLS runtime

The updater and RIFE extension installer share Qt Network. Package the matching
Qt OpenSSL backend and pinned OpenSSL DLLs so HTTPS downloads do not depend on
developer PATH entries. Qt prefers OpenSSL when this backend is available.

Prepare the runtime before configuring Windows:

```powershell
python dev/windows/tls/prepare_openssl_runtime.py --output D:/CodexDeps/TigerestTheater/deps/openssl-runtime-3.5.9
$env:TIGEREST_OPENSSL_RUNTIME_DIR = 'D:/CodexDeps/TigerestTheater/deps/openssl-runtime-3.5.9'
# Or pass -DTIGEREST_OPENSSL_RUNTIME_DIR=... to CMake.
```

Use `--archives DIR --offline` with a previously downloaded pinned archive for
offline builds. Existing output is verified; a corrupt output is rejected.
The script extracts only OpenSSL DLLs and Python license, adds the checked-in
OpenSSL license, and publishes the staging directory after all checks pass.
It never searches PATH for shipping DLLs or executes the downloaded interpreter.

Qt x64 loads `libssl-3-x64.dll` and `libcrypto-3-x64.dll`. These are unmodified
copies of the archive's unsuffixed DLLs, with identical pinned hashes.
`libcrypto-3.dll` is also retained because the Python-built SSL DLL imports
that exact dependency name. All three names must be shipped together.

`runtime-lock.json` records the python.org published archive SHA256 and hashes
of its exact members. The official CPython 3.13.16 Windows package supplies
OpenSSL 3.5.9 LTS. This main-app runtime is pinned independently of the optional
RIFE extension, whose Python environment remains separate. OpenSSL 3.0 reached
end of support in September 2026 and is not used by this main-app TLS package.
The OpenSSL Apache-2.0 license is retained from its upstream version tag.
The current packaging target is Windows amd64; enabling ARM64 requires a new
architecture-specific lock and runtime, not these DLLs.

Configure and install both reject missing/mismatched DLLs or license files.
Install rechecks before windeployqt, uses `--force-openssl`, then
copies and verifies the pinned DLLs and matching `tls/qopensslbackend.dll` after
windeployqt. It also ships both licenses, NOTICE and the provenance lock.
Qt 6.9.3 treats `--force-openssl` and `--openssl-root` as mutually exclusive;
`--openssl-root` also assumes a `bin` subdirectory. We use `--force-openssl`
to deploy the Qt plugin without searching for its DLL dependencies, and copy
the already verified pinned DLLs explicitly.

Run `python tests/test_openssl_runtime_deployment.py` for fixture preflight and
deployment checks. These CMake fixture checks do not demonstrate real HTTPS
behavior. Validate the portable bundle in an isolated profile with developer
Qt/OpenSSL PATH entries and Qt overrides removed: inspect Qt's active TLS
backend and complete an updater/extension HTTPS download with certificate
verification enabled. Do not change installed player settings.

References: [Qt Windows deployment](https://doc.qt.io/qt-6/windows-deployment.html),
[Python release](https://www.python.org/downloads/release/python-31316/),
[OpenSSL 3.0 end of support](https://openssl-library.org/post/2026-09-16-eol30/),
[OpenSSL source/license](https://github.com/openssl/openssl/tree/openssl-3.5.9).
