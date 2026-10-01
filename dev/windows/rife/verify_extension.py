"""Inspect a ZIP64 extension against an explicitly trusted, fixed catalog.

Development/reference verifier; does not install or execute anything.
"""
import argparse
import hashlib
import json
from pathlib import Path, PureWindowsPath
import re
import stat
import unicodedata
import zipfile

from probe_runtime import file_hash

ABI = 'windows-nvidia-trt-r79-v1'
MAX_FILES = 4096
MAX_MANIFEST = 256*1024


def safe_name(name):
    if not isinstance(name,str) or not name or len(name)>240 or '\\' in name:
        raise ValueError('Invalid archive file path')
    path=PureWindowsPath(name)
    parts=name.split('/')
    if path.drive or path.root or unicodedata.normalize('NFC',name)!=name:
        raise ValueError('Invalid archive file path')
    for part in parts:
        if (part in ('','.','..') or part[-1:] in (' ','.')
                or any(ord(char)<32 or char in '<>:"|?*' for char in part)
                or re.fullmatch(r'(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\..*)?',part,re.I)):
            raise ValueError('Unsafe archive file path: '+name)
    return name


def version(text):
    if not isinstance(text,str) or not re.fullmatch(r'\d+\.\d+\.\d+',text):
        raise ValueError('Invalid application version')
    return tuple(map(int,text.split('.')))


def catalog_item(catalog,package_id,app_version):
    if catalog.get('schemaVersion')!=1 or not isinstance(catalog.get('packages'),list):
        raise ValueError('Unsupported trusted catalog')
    matches=[item for item in catalog['packages'] if item.get('id')==package_id]
    if len(matches)!=1:
        raise ValueError('Package is not uniquely listed in the trusted catalog')
    item=matches[0]
    if item.get('architecture')!='x64' or item.get('platform')!='windows' or item.get('abi')!=ABI:
        raise ValueError('Unsupported extension architecture or ABI')
    if not version(item['minAppVersion'])<=version(app_version)<version(item['maxAppVersion']):
        raise ValueError('Extension is incompatible with this application version')
    if any(not re.fullmatch('[0-9a-f]{64}',item.get(key,'')) for key in ('sha256','manifestSha256')):
        raise ValueError('Invalid catalog hash')
    if any(type(item.get(key)) is not int or item[key]<=0 for key in ('downloadSize','unpackedSize','fileCount')):
        raise ValueError('Invalid catalog sizes')
    if item['fileCount']>MAX_FILES:
        raise ValueError('Too many catalog files')
    return item


def verify_extension(archive_path,catalog,package_id,app_version):
    archive_path=Path(archive_path)
    item=catalog_item(catalog,package_id,app_version)
    if archive_path.stat().st_size!=item['downloadSize'] or file_hash(archive_path)!=item['sha256']:
        raise ValueError('Archive size/hash differs from trusted catalog')
    with zipfile.ZipFile(archive_path) as archive:
        infos=archive.infolist()
        if len(infos)!=item['fileCount'] or len(infos)>MAX_FILES:
            raise ValueError('Archive entry count differs from catalog')
        seen={}
        total=0
        for info in infos:
            name=safe_name(info.orig_filename)
            if info.orig_filename!=info.filename:
                raise ValueError('Archive file path was normalized by the ZIP reader')
            key=name.casefold()
            if key in seen:
                raise ValueError('Duplicate Windows archive path')
            mode=(info.external_attr>>16)&0xffff
            if info.is_dir() or stat.S_IFMT(mode) not in (0,stat.S_IFREG) or info.external_attr&0x410:
                raise ValueError('Archive link/non-file entry is forbidden')
            if info.flag_bits&1 or info.compress_type not in (zipfile.ZIP_STORED,zipfile.ZIP_DEFLATED):
                raise ValueError('Unsupported archive entry encoding')
            total+=info.file_size
            if total>item['unpackedSize']:
                raise ValueError('Archive unpacked size exceeds catalog')
            seen[key]=info
        for key in seen:
            parts=key.split('/')
            if any('/'.join(parts[:count]) in seen for count in range(1,len(parts))):
                raise ValueError('Archive file/directory path collision')
        if total!=item['unpackedSize']:
            raise ValueError('Archive unpacked size differs from catalog')
        header=seen.get('extension.json')
        if header is None or header.file_size>MAX_MANIFEST:
            raise ValueError('Missing/oversized extension file manifest')
        header_bytes=archive.read(header)
        if hashlib.sha256(header_bytes).hexdigest()!=item['manifestSha256']:
            raise ValueError('Extension manifest hash differs from catalog')
        manifest=json.loads(header_bytes)
        if manifest.get('schemaVersion')!=1:
            raise ValueError('Unsupported extension manifest')
        for key in ('id','version','platform','architecture','abi','runtimeId','minAppVersion','maxAppVersion','sourceSha'):
            if manifest.get(key)!=item.get(key):
                raise ValueError('Extension identity differs from catalog: '+key)
        files=manifest.get('files')
        if not isinstance(files,list) or len(files)+1!=len(infos):
            raise ValueError('Extension file list differs from archive entries')
        expected={'extension.json'}
        for entry in files:
            name=safe_name(entry.get('path'))
            key=name.casefold()
            if key in expected:
                raise ValueError('Duplicate extension file path')
            expected.add(key)
            info=seen.get(key)
            if info is None or info.filename!=name or type(entry.get('size')) is not int or info.file_size!=entry['size']:
                raise ValueError('Missing/changed extension file entry')
            if not re.fullmatch('[0-9a-f]{64}',entry.get('sha256','')):
                raise ValueError('Invalid extension file hash')
            digest=hashlib.sha256()
            with archive.open(info) as source:
                for chunk in iter(lambda:source.read(1024*1024),b''):
                    digest.update(chunk)
            if digest.hexdigest()!=entry['sha256']:
                raise ValueError('Corrupt extension file hash: '+name)
        if expected!=set(seen):
            raise ValueError('Unlisted archive file entry')
        return {key:item[key] for key in ('id','version','runtimeId','sha256','unpackedSize','fileCount','sourceSha')}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package',type=Path,required=True)
    parser.add_argument('--catalog',type=Path,required=True)
    parser.add_argument('--id',required=True)
    parser.add_argument('--app-version',required=True)
    args=parser.parse_args()
    result=verify_extension(args.package,json.loads(args.catalog.read_text(encoding='utf-8')),args.id,args.app_version)
    print(json.dumps(result,ensure_ascii=False,indent=2))


if __name__=='__main__':
    main()
