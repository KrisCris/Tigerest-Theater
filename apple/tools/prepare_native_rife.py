#!/usr/bin/env python3
"""Prepare pinned private mpv headers/registry and the verified Mac Core ML model.
No installed SPM artifact is modified. The registry object links before the
static archive, adding our filter while retaining every built-in entry.
"""
import argparse, hashlib, json, shutil, subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser();p.add_argument('--mpv-source',type=Path,required=True);p.add_argument('--model',type=Path,required=True);args=p.parse_args()
revision='41f6a645068483470267271e1d09966ca3b9f413'
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=args.mpv_source,text=True).strip()==revision
assert not subprocess.check_output(['git','diff','--name-only','HEAD'],cwd=args.mpv_source,text=True).strip()
manifest=json.loads((args.model/'manifest.json').read_text())
assert manifest['runtime_pipeline']=='split-coarse-metal'
assert manifest['weights_sha256']==json.loads((ROOT/'dev/macos/rife/model_source.json').read_text())['files']['train_log/flownet.pkl']
for name,digest in manifest['compiled_sha256'].items():
    file=(args.model/name).resolve();assert file.is_relative_to(args.model.resolve())
    assert hashlib.sha256(file.read_bytes()).hexdigest()==digest
out=ROOT/'apple/Generated/NativeRIFE';out.mkdir(parents=True,exist_ok=True)
shutil.copytree(args.mpv_source,out/'mpv',dirs_exist_ok=True,ignore=shutil.ignore_patterns('.git'))
(out/'config.h').write_text('#define HAVE_POSIX 1\n#define HAVE_VULKAN 1\n#define HAVE_GL 1\n#define HAVE_EGL 0\n#define HAVE_ZIMG 0\n#define HAVE_VAPOURSYNTH 0\n#define HAVE_RUBBERBAND 0\n#define HAVE_VDPAU 0\n#define HAVE_VAAPI 0\n#define HAVE_D3D_HWACCEL 0\n#define HAVE_GPL 0\n')
registry=(args.mpv_source/'filters/user_filters.c').read_text().replace('const struct mp_user_filter_entry *vf_list[] = {','extern const struct mp_user_filter_entry vf_tigerest_rife;\nconst struct mp_user_filter_entry *vf_list[] = {\n    &vf_tigerest_rife,')
(out/'user_filters.c').write_text(registry)
# Stable include roots; framework headers are the exact artifacts used by SPM.
artifacts=ROOT/'apple/DerivedData/SourcePackages/artifacts/mpvkit'
for variant,slice in [('device','ios-arm64'),('simulator','ios-arm64_x86_64-simulator')]:
    headers=out/variant;headers.mkdir(exist_ok=True)
    for framework,include in [('Libavutil','libavutil'),('Libplacebo','libplacebo')]:
        paths=list((artifacts/framework).glob(f'*.xcframework/{slice}/{framework}.framework/Headers'))
        assert len(paths)==1,(framework,slice)
        target=headers/include
        if target.is_symlink():target.unlink()
        target.symlink_to(paths[0])
shutil.copytree(args.model,ROOT/'apple/Generated/RifeModel',dirs_exist_ok=True)
(out/'source.json').write_text(json.dumps({'mpv':'https://github.com/mpv-player/mpv','revision':revision,'mpvkit':'d9194243bdc68b87d8989376ab52aee7da6c8e0b','weights_sha256':manifest['weights_sha256']},indent=2)+'\n')
print('Native RIFE sources and model verified')
