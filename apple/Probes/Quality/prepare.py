#!/usr/bin/env python3
"""Temporarily add the fixture-only probe to the generated Xcode project.
Run generate_project.py after building to restore the normal project.
"""
import plistlib,hashlib
from pathlib import Path
root=Path(__file__).resolve().parents[2];path=root/'TigerestTheater.xcodeproj/project.pbxproj';project=plistlib.loads(path.read_bytes());o=project['objects']
def add(name,isa,**kw):
    key=hashlib.sha256(name.encode()).hexdigest()[:24].upper();o[key]={'isa':isa,**kw};return key
ref=add('quality-probe','PBXFileReference',path='Probes/Quality/PlaybackValidation.swift',sourceTree='<group>',lastKnownFileType='sourcecode.swift')
build=add('quality-probe-build','PBXBuildFile',fileRef=ref)
for obj in list(o.values()):
    if obj.get('isa')=='PBXNativeTarget' and obj['name']=='TigerestTheater':
        for phase in obj['buildPhases']:
            if o[phase]['isa']=='PBXSourcesBuildPhase' and build not in o[phase]['files']:o[phase]['files'].append(build)
        for config in o[obj['buildConfigurationList']]['buildConfigurations']:
            o[config]['buildSettings']['SWIFT_ACTIVE_COMPILATION_CONDITIONS']=o[config]['buildSettings'].get('SWIFT_ACTIVE_COMPILATION_CONDITIONS','')+' PLAYBACK_VALIDATION'
ref=add('rife-playback-probe','PBXFileReference',path='Probes/Quality/RifePlaybackValidation.swift',sourceTree='<group>',lastKnownFileType='sourcecode.swift')
build=add('rife-playback-probe-build','PBXBuildFile',fileRef=ref)
for obj in list(o.values()):
    if obj.get('isa')=='PBXNativeTarget' and obj['name']=='TigerestTheater':
        for phase in obj['buildPhases']:
            if o[phase]['isa']=='PBXSourcesBuildPhase' and build not in o[phase]['files']:o[phase]['files'].append(build)
ref=add('danmaku-parity-probe','PBXFileReference',path='Probes/Quality/DanmakuParityValidation.swift',sourceTree='<group>',lastKnownFileType='sourcecode.swift')
build=add('danmaku-parity-probe-build','PBXBuildFile',fileRef=ref)
for obj in list(o.values()):
    if obj.get('isa')=='PBXNativeTarget' and obj['name']=='TigerestTheater':
        for phase in obj['buildPhases']:
            if o[phase]['isa']=='PBXSourcesBuildPhase' and build not in o[phase]['files']:o[phase]['files'].append(build)
ref=add('danmaku-frame-probe','PBXFileReference',path='Probes/Quality/DanmakuFrameValidation.swift',sourceTree='<group>',lastKnownFileType='sourcecode.swift')
build=add('danmaku-frame-probe-build','PBXBuildFile',fileRef=ref)
for obj in list(o.values()):
    if obj.get('isa')=='PBXNativeTarget' and obj['name']=='TigerestTheater':
        for phase in obj['buildPhases']:
            if o[phase]['isa']=='PBXSourcesBuildPhase' and build not in o[phase]['files']:o[phase]['files'].append(build)
path.write_bytes(plistlib.dumps(project,sort_keys=False))
