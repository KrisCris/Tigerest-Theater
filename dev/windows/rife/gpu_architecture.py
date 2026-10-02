"""Select only TensorRT's documented per-SM builder resources.

NVIDIA documents partitioned cubins and the separate forward-compatibility PTX:
https://docs.nvidia.com/deeplearning/tensorrt/10.x.x/getting-started/release-notes-10/10.14.1.html
Keep PTX and every other file. This policy is pinned to our audited 10.16.0
runtime; a dependency upgrade must explicitly revalidate the layout.
"""
import re

ARCHITECTURES = ('full', 'sm75', 'sm80', 'sm86', 'sm89', 'sm90', 'sm100', 'sm120')
BUILDER = 'plugins/vsmlrt-cuda/nvinfer_builder_resource_'


def partition_manifest(manifest, architecture=None):
    current = manifest.get('gpuArchitecture', 'full')
    architecture = architecture or current
    if architecture not in ARCHITECTURES or current not in ARCHITECTURES:
        raise ValueError('Unsupported GPU architecture')
    if current != 'full' and architecture != current:
        raise ValueError('Cannot expand an architecture-specific runtime')
    result = dict(manifest, gpuArchitecture=architecture)
    if architecture != 'full':
        if manifest.get('versions', {}).get('tensorrt') != '10.16.0':
            raise ValueError('Architecture packages require the audited TensorRT 10.16.0 runtime')
        paths = {entry['path'] for entry in manifest['files']}
        required = {BUILDER + name + '_10.dll' for name in ('ptx', architecture)}
        if not required <= paths:
            raise ValueError('Missing required TensorRT builder resource')
        result['files'] = [entry for entry in manifest['files']
                           if not re.fullmatch(re.escape(BUILDER) + r'sm\d+_10\.dll', entry['path'])
                           or entry['path'] == BUILDER + architecture + '_10.dll']
        if current == 'full':
            result['runtimeId'] = manifest['runtimeId'] + '-' + architecture
    result['unpackedBytes'] = sum(entry['size'] for entry in result['files'])
    return result
