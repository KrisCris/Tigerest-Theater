"""Apply fixed sources and private Windows RIFE patches to an isolated recipe."""
import argparse
import json
from pathlib import Path
import re
import shutil

from probe_runtime import private_path

HERE = Path(__file__).resolve().parent


def prepare(recipe, lock):
    for relative, entry in lock['sources'].items():
        sha = entry['sourceSha']
        if not re.fullmatch('[0-9a-f]{40}', sha):
            raise ValueError('Invalid pinned source revision: ' + relative)
        path = private_path(recipe, relative)
        text = path.read_text(encoding='utf-8')
        if re.search(r'GIT_TAG\s+\S+', text):
            text = re.sub(r'GIT_TAG\s+\S+', 'GIT_TAG ' + sha, text, count=1)
        else:
            text = re.sub(r'(GIT_REPOSITORY\s+\S+)', r'\1\n    GIT_TAG ' + sha, text, count=1)
        if relative == 'packages/mpv.cmake':
            text = text.replace('    UPDATE_COMMAND ""',
                                '    PATCH_COMMAND git apply ${CMAKE_SOURCE_DIR}/tigerest-mpv-eof-aware.patch '
                                '${CMAKE_SOURCE_DIR}/tigerest-mpv-private-vs-core.patch\n    UPDATE_COMMAND ""', 1)
        path.write_text(text, encoding='utf-8')
    shutil.copyfile(HERE.parents[1] / 'macos/rife/mpv-eof-aware.patch', recipe / 'tigerest-mpv-eof-aware.patch')
    shutil.copyfile(HERE / 'mpv-private-vs-core.patch', recipe / 'tigerest-mpv-private-vs-core.patch')
    path = recipe / 'toolchain/rustup.cmake'
    text = path.read_text(encoding='utf-8')
    text = text.replace('--default-toolchain nightly', '--default-toolchain ' + lock['rustToolchain'])
    text = text.replace('BUILD_COMMAND ${EXEC} rustup update',
                        'BUILD_COMMAND ${EXEC} rustup default ' + lock['rustToolchain'])
    path.write_text(text, encoding='utf-8')
    # Moving-branch recipes compare HEAD against @{u} after each install.
    # Immutable checkouts have no upstream: use HEAD and the pinned GIT_TAG.
    path = recipe / 'cmake/custom_steps.cmake'
    text = path.read_text(encoding='utf-8')
    text = text.replace('rev-parse @{u}', 'rev-parse HEAD')
    text = text.replace('set(reset "@{u}")', 'set(reset "${git_tag}")')
    path.write_text(text, encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--recipe', required=True, type=Path)
    parser.add_argument('--lock', required=True, type=Path)
    args = parser.parse_args()
    prepare(args.recipe.resolve(), json.loads(args.lock.read_text(encoding='utf-8')))


if __name__ == '__main__':
    main()
