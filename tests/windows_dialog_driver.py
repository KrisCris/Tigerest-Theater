"""Interact only with file dialogs belonging to the test-owned application PID."""
import ctypes
from ctypes import wintypes
import json
import sys
import time

user = ctypes.WinDLL('user32', use_last_error=True)
dwm = ctypes.WinDLL('dwmapi', use_last_error=True)
callback = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
user.EnumWindows.argtypes = [callback, wintypes.LPARAM]
user.EnumChildWindows.argtypes = [wintypes.HWND, callback, wintypes.LPARAM]
user.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
user.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user.GetParent.argtypes = [wintypes.HWND]
user.GetParent.restype = wintypes.HWND
user.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
user.SendMessageW.restype = ctypes.c_ssize_t
user.SetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPCWSTR]
user.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
user.IsWindowVisible.argtypes = [wintypes.HWND]

dwm.DwmGetWindowAttribute.argtypes = [wintypes.HWND, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD]
pid = int(sys.argv[1])

def text(handle, fn):
    value = ctypes.create_unicode_buffer(512)
    fn(handle, value, len(value))
    return value.value

def owned_windows():
    result = []
    @callback
    def visit(handle, _):
        owner = wintypes.DWORD()
        user.GetWindowThreadProcessId(handle, ctypes.byref(owner))
        if owner.value == pid and user.IsWindowVisible(handle):
            result.append(handle)
        return True
    user.EnumWindows(visit, 0)
    return result

if sys.argv[2] == 'title':
    windows = [h for h in owned_windows() if text(h, user.GetWindowTextW).startswith('Tigerest Theater')]
    if not windows:
        print(json.dumps({'found': False})); sys.exit(0)
    attributes = {}
    for attribute in (19, 20, 35, 36):
        value = wintypes.DWORD()
        status = dwm.DwmGetWindowAttribute(windows[0], attribute, ctypes.byref(value), ctypes.sizeof(value))
        attributes[str(attribute)] = {'supported': status == 0, 'value': value.value}
    print(json.dumps({'found': True, 'attributes': attributes})); sys.exit(0)

dialog = None
for _ in range(80):
    dialog = next((h for h in owned_windows() if text(h, user.GetClassNameW) == '#32770'), None)
    if dialog: break
    time.sleep(.1)
if not dialog:
    print(json.dumps({'opened': False})); sys.exit(0)
if sys.argv[2] == 'cancel':
    user.PostMessageW(dialog, 0x0010, 0, 0)
    print(json.dumps({'opened': True, 'cancelled': True})); sys.exit(0)
