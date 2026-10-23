"""Flatten the three shipped desktop profiles; retain shader bytes and notices."""
import hashlib,json,shutil
from pathlib import Path
def sync_quality(root,output,manifest):
    sections={};current=None
    for raw in (root/'resources/mpv/mpv.default.conf').read_text().splitlines():
        line=raw.strip()
        if not line or line.startswith('#'):continue
        if line.startswith('['):current=line[1:-1];sections[current]=[]
        elif current and '=' in line:sections[current].append(line.split('=',1))
    def flatten(name,stack=()):
        if name in stack:raise ValueError('Recursive profile')
        result={'id':name,'title':name,'base':'','options':{},'shaders':[]}
        for key,value in sections[name]:
            if key=='profile':
                if value=='high-quality':result['base']=value
                else:
                    base=flatten(value,(*stack,name));result.update(base,id=name)
            elif key=='profile-desc':result['title']=value
            elif key=='glsl-shaders':
                if value:raise ValueError('Unexpected shader list')
                result['shaders']=[]
            elif key=='glsl-shader':
                if not value.startswith('~~/shaders/'):raise ValueError('External shader')
                result['shaders'].append(value[3:])
            else:result['options'][key]=value
        # A parent's description must not replace the child's title.
        result['title']=dict(sections[name]).get('profile-desc',name)
        return result
    presets=[flatten(name) for name in ['tigerest-default','tigerest-liveaction','tigerest-aggressive-test']]
    for relative in set(shader for p in presets for shader in p['shaders']):
        source=root/'resources/mpv'/relative
        if not source.resolve().is_relative_to((root/'resources/mpv/shaders').resolve()):raise ValueError('Shader escape')
        target=output/relative;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,target)
        manifest['files'][relative]=hashlib.sha256(target.read_bytes()).hexdigest()
    target=output/'quality_presets.json';target.write_text(json.dumps(presets,ensure_ascii=False,indent=2)+'\n')
    manifest['files'][target.name]=hashlib.sha256(target.read_bytes()).hexdigest()
    # Preserve the desktop third-party notices; source shader license headers are unchanged.
    target=output/'third_party_licenses.txt';shutil.copyfile(root/'resources/misc/licenses.txt',target)
    manifest['files'][target.name]=hashlib.sha256(target.read_bytes()).hexdigest()
