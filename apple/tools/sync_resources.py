#!/usr/bin/env python3
"""Build the iPad payload only from version-controlled application assets."""
import argparse, hashlib, json, shutil, subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = 'mpvVideoPlayer mpvAudioPlayer inputPlugin sessionNavigationPlugin communityClient communityBridge communitySession communityAvatar communityPublicClient communityAccount communityMessages communityPlugin connectivityHelper nativeshell offline homeData homeGallery homeBackdrop homeTransitions homeMotion embycompat webAppearance updatePlugin'.split()
def sync(output):
    output.mkdir(parents=True, exist_ok=True)
    files = [ROOT/'native'/f'{name}.js' for name in SCRIPTS]
    files += sorted((ROOT/'native').glob('*.css'))
    files += sorted((ROOT/'native'/'home-art').rglob('*'))
    files += list((ROOT/'apple'/'Resources').glob('*'))
    files += [ROOT/'resources/settings/settings_description.json']
    manifest = {'revision':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'scripts':[f'{x}.js' for x in SCRIPTS], 'files':{}}
    for source in files:
        if not source.is_file(): continue
        relative = source.relative_to(ROOT/'native') if source.is_relative_to(ROOT/'native') else Path(source.name)
        target=output/relative
        target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(source,target)
        manifest['files'][str(relative)]=hashlib.sha256(source.read_bytes()).hexdigest()
    (output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,default=ROOT/'apple/Generated/Web');args=parser.parse_args();sync(args.output)
