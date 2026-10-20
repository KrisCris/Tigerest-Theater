"""Symbolize the stall stacks in an automatic fault report.

The client logs frames as module+offset (see src/system/MainThreadWatchdog.cpp).
This resolves them with dbghelp against the binaries of the reported version:
PDBs for our executable, export tables for DLLs without symbols.

    python dev/windows/symbolize_stall.py report.txt --modules <dir> [--modules <dir> ...]

Each --modules directory holds the release binaries (and PDBs) of that version,
for example release-staging/<version>/symbols plus the unpacked portable zip.
"""
import argparse
import ctypes
import ctypes.wintypes as wt
import os
import re
import sys

FRAME = re.compile(r'(?P<module>[A-Za-z0-9_.\-]+\.(?:exe|dll))\+0x(?P<offset>[0-9a-fA-F]+)')
SYMOPT_UNDNAME = 0x2
SYMOPT_DEFERRED_LOADS = 0x4
SYMOPT_LOAD_LINES = 0x10
MAX_NAME = 1024


class SymbolInfo(ctypes.Structure):
    _fields_ = [('SizeOfStruct', wt.ULONG), ('TypeIndex', wt.ULONG), ('Reserved', ctypes.c_uint64 * 2),
                ('Index', wt.ULONG), ('Size', wt.ULONG), ('ModBase', ctypes.c_uint64), ('Flags', wt.ULONG),
                ('Value', ctypes.c_uint64), ('Address', ctypes.c_uint64), ('Register', wt.ULONG),
                ('Scope', wt.ULONG), ('Tag', wt.ULONG), ('NameLen', wt.ULONG), ('MaxNameLen', wt.ULONG),
                ('Name', wt.WCHAR * MAX_NAME)]


class LineInfo(ctypes.Structure):
    _fields_ = [('SizeOfStruct', wt.DWORD), ('Key', ctypes.c_void_p), ('LineNumber', wt.DWORD),
                ('FileName', wt.LPWSTR), ('Address', ctypes.c_uint64)]


class Symbolizer:
    def __init__(self, directories):
        self.dbghelp = ctypes.WinDLL('dbghelp.dll')
        self.process = wt.HANDLE(0x7A11)  # a pseudo handle unique to this session
        self.dbghelp.SymSetOptions(SYMOPT_UNDNAME | SYMOPT_DEFERRED_LOADS | SYMOPT_LOAD_LINES)
        search = ';'.join(directories)
        if not self.dbghelp.SymInitializeW(self.process, ctypes.c_wchar_p(search), False):
            raise OSError('SymInitializeW failed')
        self.dbghelp.SymLoadModuleExW.restype = ctypes.c_uint64
        self.files = {}
        for directory in directories:
            for root, _, names in os.walk(directory):
                for name in names:
                    if name.lower().endswith(('.exe', '.dll')):
                        self.files.setdefault(name.lower(), os.path.join(root, name))
        self.bases = {}
        self.next_base = 0x10000000

    def base(self, module):
        key = module.lower()
        if key not in self.bases:
            path = self.files.get(key)
            base = 0
            if path:
                size = os.path.getsize(path)
                base = self.dbghelp.SymLoadModuleExW(self.process, None, ctypes.c_wchar_p(path), None,
                                                     ctypes.c_uint64(self.next_base), wt.DWORD(size), None, 0)
                self.next_base += (size + 0x10000000) & ~0xFFFFFF
            self.bases[key] = base
        return self.bases[key]

    def resolve(self, module, offset):
        base = self.base(module)
        if not base:
            return None
        address = ctypes.c_uint64(base + offset)
        info = SymbolInfo(SizeOfStruct=ctypes.sizeof(SymbolInfo) - MAX_NAME * ctypes.sizeof(wt.WCHAR),
                          MaxNameLen=MAX_NAME)
        displacement = ctypes.c_uint64(0)
        if not self.dbghelp.SymFromAddrW(self.process, address, ctypes.byref(displacement), ctypes.byref(info)):
            return None
        text = f'{info.Name}+0x{displacement.value:x}'
        line = LineInfo(SizeOfStruct=ctypes.sizeof(LineInfo))
        line_displacement = wt.DWORD(0)
        if self.dbghelp.SymGetLineFromAddrW64(self.process, address, ctypes.byref(line_displacement),
                                              ctypes.byref(line)):
            text += f'  [{os.path.basename(line.FileName)}:{line.LineNumber}]'
        return text


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('report')
    parser.add_argument('--modules', action='append', required=True)
    args = parser.parse_args()
    symbolizer = Symbolizer([os.path.abspath(d) for d in args.modules])
    with open(args.report, encoding='utf-8', errors='replace') as source:
        for line in source:
            line = line.rstrip('\n')
            match = FRAME.search(line)
            resolved = match and symbolizer.resolve(match['module'], int(match['offset'], 16))
            print(f'{line}    {resolved}' if resolved else line)
    return 0


if __name__ == '__main__':
    sys.exit(main())
