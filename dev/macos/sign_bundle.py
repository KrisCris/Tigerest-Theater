#!/usr/bin/env python3
"""Remove development rpaths, then sign nested Mach-O code before its containers."""
from pathlib import Path
import plistlib
import re
import subprocess
import sys


def macho_files(app):
    magic={b'\xcf\xfa\xed\xfe',b'\xca\xfe\xba\xbe',b'\xfe\xed\xfa\xcf',b'\xbe\xba\xfe\xca'}
    for file in app.rglob('*'):
        if file.is_file() and not file.is_symlink():
            with file.open('rb') as source:header=source.read(4)
            if header in magic:yield file


def sign(app):
    for binary in macho_files(app):
        commands=subprocess.check_output(['otool','-l',str(binary)],text=True)
        paths=re.findall(r'cmd LC_RPATH\s+cmdsize \d+\s+path (.*?) \(offset',commands)
        for path in dict.fromkeys(paths):
            if path.startswith('/') and not path.startswith(('/usr/lib/','/System/Library/')):
                subprocess.run(['install_name_tool','-delete_rpath',path,str(binary)],check=True)
        bundle_executable=False
        for info in (binary.parent.parent/'Info.plist',binary.parent/'Resources/Info.plist'):
            if info.is_file():
                with info.open('rb') as source:
                    bundle_executable |= plistlib.load(source).get('CFBundleExecutable')==binary.name
        if not bundle_executable:
            subprocess.run(['codesign','--force','--sign','-',str(binary)],check=True)
    containers=[p for p in app.rglob('*') if p.is_dir() and not p.is_symlink() and p.suffix in ('.app','.framework')]
    for container in sorted(containers,key=lambda p:len(p.parts),reverse=True)+[app]:
        subprocess.run(['codesign','--force','--sign','-',str(container)],check=True)
    subprocess.run(['codesign','--verify','--deep','--strict',str(app)],check=True)

if __name__=='__main__':sign(Path(sys.argv[1]).resolve())
