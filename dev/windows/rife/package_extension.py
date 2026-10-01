"""Build a sealed ZIP64 extension; no engines, credentials or user settings."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import zipfile

from probe_runtime import file_hash, private_path, verify_manifest
from verify_extension import ABI, MAX_FILES, MAX_MANIFEST, safe_name, verify_extension


def build_extension(runtime,playback,notices,output,*,package_id,version: str,source_sha,
                    min_app_version,max_app_version):
    runtime,playback,notices,output=map(Path,(runtime,playback,notices,output))
    manifest=verify_manifest(runtime.resolve())
    if output.exists():
        raise ValueError('Output already exists; never replace an existing extension')
    if not re.fullmatch('[a-z0-9][a-z0-9-]{0,63}',package_id) or not re.fullmatch('[0-9a-f]{40}',source_sha):
        raise ValueError('Invalid package identity/source SHA')
    # Keep version parsing separate from the public parameter name.
    from verify_extension import version as parse_version
    parse_version(version)
    if parse_version(min_app_version)>=parse_version(max_app_version):
        raise ValueError('Invalid application version range')
    sources={}
    for entry in [{'path':'runtime.json'},*manifest['files']]:
        sources[safe_name('runtime/'+entry['path'])]=private_path(runtime.resolve(),entry['path'])
    for name in ('interpolate_trt.vpy','trt_pipeline.py','tigerest-rife-vs.dll'):
        source=private_path(playback.resolve(),name)
        if not source.is_file():
            raise ValueError('Missing playback payload: '+name)
        sources['playback/'+name]=source
    if not notices.is_dir() or not any(notices.iterdir()):
        raise ValueError('Extension notices are required')
    for source in notices.rglob('*'):
        relative=source.relative_to(notices).as_posix()
        checked=private_path(notices.resolve(),relative)
        if checked.is_file():
            sources[safe_name('notices/'+relative)]=checked
    if not any(name.startswith('notices/') for name in sources):
        raise ValueError('At least one real notice file is required')
    files=[]
    keys=set()
    for name,source in sorted(sources.items()):
        if name.casefold() in keys or name.casefold().endswith(('.engine','.plan')):
            raise ValueError('Duplicate or generated engine in extension')
        keys.add(name.casefold())
        files.append({'path':name,'size':source.stat().st_size,'sha256':file_hash(source)})
    metadata={'schemaVersion':1,'id':package_id,'version':version,'platform':'windows',
              'architecture':'x64','abi':ABI,'runtimeId':manifest['runtimeId'],
              'sourceSha':source_sha,'minAppVersion':min_app_version,'maxAppVersion':max_app_version}
    header=json.dumps(dict(metadata,files=files),ensure_ascii=False,sort_keys=True,indent=2).encode('utf-8')+b'\n'
    if len(header)>MAX_MANIFEST or len(files)+1>MAX_FILES:
        raise ValueError('Extension manifest too large')
    output.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=output.parent,delete=False,suffix='.zip.tmp') as temp:
        temporary=Path(temp.name)
    try:
        with zipfile.ZipFile(temporary,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6,allowZip64=True) as archive:
            for entry in [{'path':'extension.json'},*files]:
                name=entry['path']
                info=zipfile.ZipInfo(name,date_time=(1980,1,1,0,0,0))
                info.compress_type=zipfile.ZIP_DEFLATED;info.create_system=3
                info.external_attr=(stat.S_IFREG|0o644)<<16
                digest=hashlib.sha256();size=0
                with archive.open(info,'w',force_zip64=True) as destination:
                    if name=='extension.json':
                        destination.write(header)
                    else:
                        with sources[name].open('rb') as source:
                            for block in iter(lambda:source.read(1024*1024),b''):
                                destination.write(block);digest.update(block);size+=len(block)
                        if size!=entry['size'] or digest.hexdigest()!=entry['sha256']:
                            raise ValueError('Source changed during packaging: '+name)
        item=dict(metadata,downloadSize=temporary.stat().st_size,unpackedSize=len(header)+sum(entry['size'] for entry in files),
                  fileCount=len(files)+1,sha256=file_hash(temporary),manifestSha256=hashlib.sha256(header).hexdigest(),url=None)
        item.pop('schemaVersion')
        verify_extension(temporary,{'schemaVersion':1,'packages':[item]},package_id,min_app_version)
        # An atomic hard-link publish cannot overwrite a racing destination
        # on either Windows or POSIX. Unlink only our own temporary name.
        os.link(temporary,output)
        return item
    finally:
        temporary.unlink(missing_ok=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for key in ('runtime','playback','notices','output','catalog-item'):
        parser.add_argument('--'+key,type=Path,required=True)
    for key in ('id','version','source-sha','min-app-version','max-app-version'):
        parser.add_argument('--'+key,required=True)
    args=parser.parse_args()
    item=build_extension(args.runtime,args.playback,args.notices,args.output,package_id=args.id,version=args.version,
        source_sha=args.source_sha,min_app_version=args.min_app_version,max_app_version=args.max_app_version)
    args.catalog_item.write_text(json.dumps(item,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(item,ensure_ascii=False,indent=2))


if __name__=='__main__':
    main()
