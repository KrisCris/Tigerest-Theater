#!/usr/bin/env python3
"""Build the pinned libmpv with EOF-aware VS and safe CoreAudio hotplug."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tarfile

VERSION='0.41.0'
SHA256='ee21092a5ee427353392360929dc64645c54479aefdb5babc5cfbb5fad626209'
HERE=Path(__file__).resolve().parent

def build(destination,meson):
    destination=destination.resolve();destination.mkdir(parents=True,exist_ok=True)
    archive=destination/f'mpv-v{VERSION}.tar.gz'
    if not archive.exists():
        subprocess.run(['curl','--fail','--location','--retry','3','--output',str(archive),
                        f'https://codeload.github.com/mpv-player/mpv/tar.gz/refs/tags/v{VERSION}'],check=True)
    if hashlib.sha256(archive.read_bytes()).hexdigest()!=SHA256:raise RuntimeError('mpv source hash mismatch')
    source=destination/f'mpv-{VERSION}'
    marker=source/'.tigerest-patches.json'
    patches=[HERE/'mpv-vapoursynth79.patch',HERE/'mpv-eof-aware.patch',
             HERE/'mpv-coreaudio-hotplug.patch']
    hashes={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in patches}
    if not source.exists():
        with tarfile.open(archive) as tar:tar.extractall(destination,filter='data')
        for patch in patches:
            subprocess.run(['patch','-p1','-i',str(patch)],cwd=source,check=True)
        marker.write_text(json.dumps(hashes,indent=2)+'\n')
    elif not marker.exists() or json.loads(marker.read_text())!=hashes:
        raise RuntimeError('Existing mpv source lacks this patch provenance; choose a fresh build directory')
    out=destination/'mpv-build'
    architecture='arm64' if platform.machine()=='arm64' else 'x86_64'
    sdk=subprocess.check_output(['xcrun','--sdk','macosx','--show-sdk-path'],text=True).strip()
    arguments=['-Dbuildtype=release','-Dlibmpv=true','-Djavascript=enabled','-Dlua=luajit',
        '-Dlibarchive=enabled','-Duchardet=enabled','-Dvulkan=enabled','-Dvapoursynth=enabled',
        '-Dmanpage-build=disabled',f'-Dswift-flags=-target {architecture}-apple-macos26.0',
        '-Dc_args=-mmacosx-version-min=26.0','-Dc_link_args=-mmacosx-version-min=26.0',
        '-Dobjc_args=-mmacosx-version-min=26.0','-Dobjc_link_args=-mmacosx-version-min=26.0']
    env=dict(os.environ,MACOSX_DEPLOYMENT_TARGET='26.0',SDKROOT=sdk)
    brew=Path(subprocess.check_output(['brew','--prefix'],text=True).strip())
    pkg_paths=[str(brew/'opt'/name/'lib/pkgconfig') for name in ('libarchive','luajit','vapoursynth','libplacebo')]
    env['PKG_CONFIG_PATH']=os.pathsep.join(pkg_paths+[env.get('PKG_CONFIG_PATH','')])
    subprocess.run([meson,'setup',*(['--reconfigure'] if (out/'build.ninja').exists() else []),
                    str(out),str(source),*arguments],env=env,check=True)
    subprocess.run([meson,'compile','-C',str(out),'-j',str(min(os.cpu_count() or 4,8))],env=env,check=True)
    (destination/'mpv-provenance.json').write_text(json.dumps({
        'version':VERSION,'archive_sha256':SHA256,'patches':hashes,'deployment_target':'26.0',
        'architecture':architecture},indent=2)+'\n')
    return out/'libmpv.dylib'

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--meson',default=shutil.which('meson'))
    args=parser.parse_args()
    if not args.meson:parser.error('Install Meson 1.9.2 in the build environment')
    print(build(args.output,args.meson))
