"""Runs only inside the packaged, isolated Python interpreter."""
import argparse
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import uuid


def private_vapoursynth():
    import vapoursynth as vs

    class PrivatePolicy(vs.EnvironmentPolicy):
        def on_policy_registered(self, api):
            self.api = api
            self.environment = api.create_environment(flags=int(vs.DISABLE_AUTO_LOADING))

        def get_current_environment(self):
            return self.environment

        def set_environment(self, environment):
            previous = self.environment
            self.environment = environment
            return previous

        def is_alive(self, environment):
            return environment is self.environment

        def on_policy_cleared(self):
            self.api.destroy_environment(self.environment)

    vs.register_policy(PrivatePolicy())
    return vs


def trusted_defender_module(path):
    """Allow only a signed DLL beside the registered Windows Defender service.

    Defender's AMSI provider can be injected outside Windows/System32. Never
    trust an arbitrary ProgramData DLL or a file just because of its name.
    """
    if path.name.casefold() != 'mpoav.dll':
        return False
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE,
                            r'SYSTEM\CurrentControlSet\Services\WinDefend') as key:
            service, _ = winreg.QueryValueEx(key, 'ImagePath')
        service = os.path.expandvars(service).strip('"')
        if path.resolve().parent != Path(service).resolve().parent:
            return False
    except OSError:
        return False

    class FileInfo(ctypes.Structure):
        _fields_ = [('size', wintypes.DWORD), ('path', wintypes.LPCWSTR),
                    ('handle', wintypes.HANDLE), ('subject', ctypes.c_void_p)]

    class TrustData(ctypes.Structure):
        _fields_ = [('size', wintypes.DWORD), ('policy', ctypes.c_void_p), ('sip', ctypes.c_void_p),
                    ('ui', wintypes.DWORD), ('revocation', wintypes.DWORD), ('choice', wintypes.DWORD),
                    ('file', ctypes.POINTER(FileInfo)), ('action', wintypes.DWORD),
                    ('state', wintypes.HANDLE), ('url', wintypes.LPWSTR), ('flags', wintypes.DWORD),
                    ('context', wintypes.DWORD), ('signature', ctypes.c_void_p)]

    file_info = FileInfo(ctypes.sizeof(FileInfo), str(path), None, None)
    data = TrustData(size=ctypes.sizeof(TrustData), ui=2, choice=1,
                     file=ctypes.pointer(file_info), action=1, flags=0x1010)
    # WINTRUST_ACTION_GENERIC_VERIFY_V2, offline signature/chain verification.
    action = (ctypes.c_ubyte * 16).from_buffer_copy(uuid.UUID('00aac56b-cd44-11d0-8cc2-00c04fc295ee').bytes_le)
    trust = ctypes.WinDLL('wintrust.dll', winmode=0x800)
    trust.WinVerifyTrust.argtypes = [wintypes.HWND, ctypes.c_void_p, ctypes.POINTER(TrustData)]
    trust.WinVerifyTrust.restype = ctypes.c_long
    try:
        return trust.WinVerifyTrust(None, action, ctypes.byref(data)) == 0
    finally:
        data.action = 2
        trust.WinVerifyTrust(None, action, ctypes.byref(data))


def audit_libraries(root, paths, allowed_files=()):
    windows = Path(os.environ.get('SystemRoot', 'C:/Windows')).resolve()
    allowed = {Path(path).resolve() for path in allowed_files}
    security = []
    foreign = []
    for item in paths:
        path = Path(item).resolve()
        if path.is_relative_to(root) or path.is_relative_to(windows) or path in allowed:
            continue
        if trusted_defender_module(path):
            security.append({'path': str(path), 'service': 'WinDefend', 'signatureVerified': True})
        else:
            foreign.append(str(path))
    if foreign:
        raise RuntimeError('Dependencies were loaded outside the private runtime: ' + '; '.join(foreign))
    return security


def loaded_libraries():
    kernel = ctypes.WinDLL("kernel32.dll", winmode=0x800)
    psapi = ctypes.WinDLL("psapi.dll", winmode=0x800)
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    process = kernel.GetCurrentProcess()
    modules = (wintypes.HMODULE * 2048)()
    needed = wintypes.DWORD()
    psapi.EnumProcessModulesEx.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.HMODULE),
                                          wintypes.DWORD, ctypes.POINTER(wintypes.DWORD), wintypes.DWORD]
    if not psapi.EnumProcessModulesEx(process, modules, ctypes.sizeof(modules), ctypes.byref(needed), 3):
        raise ctypes.WinError()
    if needed.value > ctypes.sizeof(modules):
        raise RuntimeError("Library enumeration buffer is too small")
    psapi.GetModuleFileNameExW.argtypes = [wintypes.HANDLE, wintypes.HMODULE, wintypes.LPWSTR, wintypes.DWORD]
    paths = []
    for module in modules[:needed.value // ctypes.sizeof(wintypes.HMODULE)]:
        buffer = ctypes.create_unicode_buffer(32768)
        if not psapi.GetModuleFileNameExW(process, module, buffer, len(buffer)):
            raise ctypes.WinError()
        paths.append(str(Path(buffer.value).resolve()))
    return sorted(set(paths))


def library_version(path):
    version = ctypes.WinDLL('version.dll', winmode=0x800)
    version.GetFileVersionInfoSizeW.argtypes = [wintypes.LPCWSTR, ctypes.POINTER(wintypes.DWORD)]
    version.GetFileVersionInfoSizeW.restype = wintypes.DWORD
    version.GetFileVersionInfoW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p]
    version.VerQueryValueW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR, ctypes.POINTER(ctypes.c_void_p),
                                     ctypes.POINTER(wintypes.UINT)]
    size = version.GetFileVersionInfoSizeW(str(path), None)
    data = ctypes.create_string_buffer(size)
    value, length = ctypes.c_void_p(), wintypes.UINT()
    if (not size or not version.GetFileVersionInfoW(str(path), 0, size, data)
            or not version.VerQueryValueW(data, '\\', ctypes.byref(value), ctypes.byref(length))
            or length.value < 52):
        raise RuntimeError('Could not identify NVIDIA driver version')
    fixed = ctypes.cast(value, ctypes.POINTER(wintypes.DWORD * 13)).contents
    return '.'.join(str(n) for n in (fixed[2] >> 16, fixed[2] & 65535, fixed[3] >> 16, fixed[3] & 65535))


def gpu_info(device_id=0):
    cuda = ctypes.WinDLL("nvcuda.dll", winmode=0x800)
    if cuda.cuInit(0):
        raise RuntimeError("NVIDIA driver could not initialize CUDA")
    device = ctypes.c_int()
    if cuda.cuDeviceGet(ctypes.byref(device), device_id):
        raise RuntimeError("No NVIDIA CUDA device")
    name = ctypes.create_string_buffer(256)
    if cuda.cuDeviceGetName(name, len(name), device):
        raise RuntimeError('Could not identify NVIDIA device')
    major, minor = ctypes.c_int(), ctypes.c_int()
    identifier, driver = (ctypes.c_ubyte * 16)(), ctypes.c_int()
    if (cuda.cuDeviceComputeCapability(ctypes.byref(major), ctypes.byref(minor), device)
            or cuda.cuDeviceGetUuid(ctypes.byref(identifier), device)
            or cuda.cuDriverGetVersion(ctypes.byref(driver))):
        raise RuntimeError('Could not identify GPU and CUDA driver')
    kernel = ctypes.WinDLL('kernel32.dll', winmode=0x800)
    kernel.GetModuleFileNameW.argtypes = [wintypes.HMODULE, wintypes.LPWSTR, wintypes.DWORD]
    path = ctypes.create_unicode_buffer(32768)
    if not kernel.GetModuleFileNameW(cuda._handle, path, len(path)):
        raise RuntimeError('Could not identify NVIDIA driver library')
    return {"name": name.value.decode("utf-8"), "computeCapability": f"{major.value}.{minor.value}",
            'uuid': bytes(identifier).hex(), 'driverVersion': library_version(path.value),
            'cudaDriverVersion': driver.value, 'deviceId': device_id}


def mpv_info(path):
    library = ctypes.CDLL(str(path), winmode=0x1100)
    library.mpv_create.restype = ctypes.c_void_p
    library.mpv_set_option_string.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_char_p]
    library.mpv_initialize.argtypes = [ctypes.c_void_p]
    library.mpv_get_property_string.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
    library.mpv_get_property_string.restype = ctypes.c_void_p
    library.mpv_free.argtypes = [ctypes.c_void_p]
    library.mpv_terminate_destroy.argtypes = [ctypes.c_void_p]
    handle = library.mpv_create()
    if not handle:
        raise RuntimeError("mpv_create failed")
    try:
        for key, value in ((b"config", b"no"), (b"vo", b"null"), (b"ao", b"null"), (b"load-scripts", b"no")):
            if library.mpv_set_option_string(handle, key, value) < 0:
                raise RuntimeError("mpv option failed: " + key.decode())
        if library.mpv_set_option_string(handle, b"vf", b"vapoursynth=file=__probe__.vpy:eof-aware=yes") < 0:
            raise RuntimeError("mpv is missing the EOF-aware VapourSynth filter")
        if library.mpv_initialize(handle) < 0:
            raise RuntimeError("mpv_initialize failed")
        pointer = library.mpv_get_property_string(handle, b"mpv-version")
        if not pointer:
            raise RuntimeError("mpv-version is unavailable")
        version = ctypes.string_at(pointer).decode("utf-8")
        library.mpv_free(pointer)
        return version
    finally:
        library.mpv_terminate_destroy(handle)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--mpv", type=Path)
    args = parser.parse_args()
    root = args.runtime.resolve()
    result = {"ok": False, "mpvVersion": None, "vsVersion": None, "trtVersion": None,
              "gpu": None, "loadedLibraries": [], "privateLibrariesOnly": False, "errors": []}
    directories = []
    libraries = []
    try:
        manifest = json.loads((root / "runtime.json").read_text(encoding="utf-8"))
        for path in (root / "python", root / "python/Lib/site-packages/vapoursynth",
                     root / "plugins", root / "plugins/vsmlrt-cuda"):
            directories.append(os.add_dll_directory(str(path)))
        # Keep registry/site package discovery out of the helper. Its _pth file
        # and -I/-S interpreter flags restrict imports to the extension tree.
        vs = private_vapoursynth()
        result["vsVersion"] = str(vs.__version__)
        libraries.append(ctypes.WinDLL(str(root / manifest["entrypoints"]["vsscript"]), winmode=0x1100))
        vs.core.std.LoadPlugin(path=str(root / manifest["entrypoints"]["plugin"]))
        result['autoloadDisabled'] = True
        result['plugins'] = [plugin.identifier for plugin in vs.core.plugins()]
        version = int(vs.core.trt.Version()["tensorrt_version"])
        result["trtVersion"] = f"{version // 10000}.{version % 10000 // 100}.{version % 100}"
        result["gpu"] = gpu_info()
        if args.mpv:
            result["mpvVersion"] = mpv_info(args.mpv.resolve())
        result["loadedLibraries"] = loaded_libraries()
        result['systemSecurityLibraries'] = audit_libraries(
            root, result['loadedLibraries'], [args.mpv] if args.mpv else [])
        result.update(ok=True, privateLibrariesOnly=True, mpvChecked=bool(args.mpv))
    except Exception as error:
        result["errors"].append({"code": "native-probe", "message": str(error)})
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
