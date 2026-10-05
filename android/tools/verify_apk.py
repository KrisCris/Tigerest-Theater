"""Check the actual packaged native binaries and ZIP offsets, not just inputs."""
import hashlib, json, pathlib, struct, sys, zipfile
from bootstrap import elf_alignment

def verify(path):
    path = pathlib.Path(path)
    entries = []
    locked = {record['path']:record['sha256'] for record in json.loads((pathlib.Path(__file__).resolve().parents[1]/'native-runtime.lock.json').read_text())['libraries']}
    with path.open('rb') as raw, zipfile.ZipFile(path) as archive:
        for item in archive.infolist():
            if not item.filename.startswith('lib/') or not item.filename.endswith('.so'): continue
            assert item.compress_type == zipfile.ZIP_STORED, f'{item.filename}: native library compressed'
            raw.seek(item.header_offset)
            header = raw.read(30)
            name, extra = struct.unpack_from('<HH',header,26)
            offset = item.header_offset + 30 + name + extra
            assert offset % 16384 == 0, f'{item.filename}: ZIP offset {offset} not 16KB aligned'
            data = archive.read(item)
            assert hashlib.sha256(data).hexdigest() == locked.get(item.filename), f'{item.filename}: binary differs from pinned upstream runtime'
            entries.append({'path':item.filename,'offset':offset,'loadSegmentAlignment':elf_alignment(data),'sha256':hashlib.sha256(data).hexdigest()})
    assert len(entries) == 20, f'Expected both ABIs and all dependencies, found {len(entries)}'
    report = {'apk':path.name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'size':path.stat().st_size,'libraries':entries,'native16KBAlignment':True}
    path.with_suffix('.verification.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps({key:value for key,value in report.items() if key!='libraries'},indent=2))

if __name__ == '__main__': verify(sys.argv[1])
