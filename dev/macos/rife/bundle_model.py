#!/usr/bin/env python3
"""Stage compiled, hash-recorded shipping models without development fixtures."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys


def stage_model(source,app):
    manifest=json.loads((source/'manifest.json').read_text())
    pinned=json.loads(Path(__file__).with_name('model_source.json').read_text())
    if manifest.get('revision')!=pinned['revision'] or manifest.get('weights_sha256')!=pinned['files']['train_log/flownet.pkl']:
        raise RuntimeError('Model provenance does not match the verified source')
    if (manifest.get('model'),manifest.get('width'),manifest.get('height'),manifest.get('grid_scale'))!=('rife-4.25-lite',1920,1080,.5):
        raise RuntimeError('Only the qualified 1080p half-grid model may be packaged')
    root=app/'Contents/Resources/rife';model=root/'model';model.mkdir(parents=True,exist_ok=True)
    for name in ('Encoder','Coarse','Refine'):
        package=source/(name+'.mlpackage')
        if not package.is_dir():raise RuntimeError(f'Missing {name} model package')
        subprocess.run(['xcrun','coremlcompiler','compile',str(package),str(model)],check=True)
    manifest['artifacts']={name.lower():name+'.mlmodelc' for name in ('Encoder','Coarse','Refine')}
    # Preserve the exported graph's identity; the runtime chooses its final warp.
    manifest['runtime_pipeline']='split-metal'
    manifest['compiled_sha256']={str(p.relative_to(model)):hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(model.rglob('*')) if p.is_file() and p.name!='manifest.json'}
    (model/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    repository=Path(__file__).resolve().parents[3]
    shutil.copy2(repository/'resources/mpv/rife/interpolate.vpy',root/'interpolate.vpy')
    licenses=app/'Contents/Resources/licenses/Practical-RIFE';licenses.mkdir(parents=True,exist_ok=True)
    shutil.copy2(Path(__file__).with_name('LICENSE.Practical-RIFE'),licenses/'LICENSE')
    shutil.copy2(Path(__file__).with_name('model_source.json'),licenses/'model_source.json')

if __name__=='__main__':stage_model(Path(sys.argv[1]),Path(sys.argv[2]))
