#!/usr/bin/env python3
"""Generate an isolated RIFE probe project using the local app signing settings.

Explicitly opt in; output is outside the repository. It shares the development
bundle ID so installation temporarily replaces the executable, never profiles.
The normal app must be reinstalled after collecting the probe report.
"""
import argparse, hashlib, json, plistlib, shutil
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--model',type=Path,required=True);p.add_argument('--output',type=Path,required=True);args=p.parse_args()
root=Path(__file__).resolve().parents[3]
manifest=json.loads((args.model/'manifest.json').read_text())
assert manifest['runtime_pipeline']=='split-coarse-metal'
source=json.loads((root/'dev/macos/rife/model_source.json').read_text())
assert manifest['weights_sha256'] in json.dumps(source)
for name,digest in manifest['compiled_sha256'].items():
    assert (args.model/name).resolve().is_relative_to(args.model.resolve())
    assert hashlib.sha256((args.model/name).read_bytes()).hexdigest()==digest, name
project=plistlib.loads((root/'apple/TigerestTheater.xcodeproj/project.pbxproj').read_bytes());objects=project['objects']
proj=objects[project['rootObject']];target=next(x for x in objects.values() if x.get('isa')=='PBXNativeTarget' and x.get('name')=='TigerestTheater')
targetid=next(k for k,v in objects.items() if v is target);proj['targets']=[targetid];proj['packageReferences']=[];target['packageProductDependencies']=[]
def add(name,isa,**fields):
    key=hashlib.sha256(name.encode()).hexdigest()[:24].upper();objects[key]={'isa':isa,**fields};return key
sources=[]
for path in [Path(__file__).with_name('main.mm'),*[root/'src/player/interpolation'/f'{name}.mm' for name in ['RifeEngine','RifeMetalWarp','RifeCoarseMetal']]]:
    ref=add(str(path),'PBXFileReference',path=str(path),sourceTree='<absolute>',lastKnownFileType='sourcecode.cpp.objcpp');sources.append(add(str(path)+'build','PBXBuildFile',fileRef=ref))
ref=add('probe-model','PBXFileReference',path=str(args.model.resolve()),sourceTree='<absolute>',lastKnownFileType='folder')
resource=add('probe-model-build','PBXBuildFile',fileRef=ref)
for phaseid in target['buildPhases']:
    phase=objects[phaseid];phase['files']=sources if phase['isa']=='PBXSourcesBuildPhase' else [resource] if phase['isa']=='PBXResourcesBuildPhase' else []
for obj in objects.values():
    if obj.get('path')=='Local.xcconfig':obj.update(path=str(root/'apple/Local.xcconfig'),sourceTree='<absolute>')
    if obj.get('isa')=='XCBuildConfiguration':
        obj['buildSettings'].update({'GENERATE_INFOPLIST_FILE':'YES','INFOPLIST_FILE':'','INFOPLIST_KEY_UILaunchScreen_Generation':'YES','INFOPLIST_KEY_UIApplicationSceneManifest_Generation':'YES','INFOPLIST_KEY_UISupportedInterfaceOrientations':'UIInterfaceOrientationPortrait UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight','HEADER_SEARCH_PATHS':str(root/'src/player/interpolation'),'CLANG_CXX_LANGUAGE_STANDARD':'c++17','CLANG_ENABLE_OBJC_ARC':'YES','OTHER_LDFLAGS':'-framework UIKit -framework CoreML -framework Metal -framework Foundation','PRODUCT_NAME':'TigerestTheater'})
args.output.mkdir(parents=True,exist_ok=True);out=args.output/'RifeProbe.xcodeproj';out.mkdir(exist_ok=True);(out/'project.pbxproj').write_bytes(plistlib.dumps(project))
print(out)
