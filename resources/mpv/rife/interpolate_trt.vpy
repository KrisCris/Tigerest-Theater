"""Windows mpv bridge for a previously prepared, private TensorRT runtime."""
import json
import os
from contextlib import ExitStack
from pathlib import Path
import runpy
import sys
import vapoursynth as vs
import weakref

options = json.loads(user_data)
runtime = Path(options['runtime_path']).resolve()
# Python's AddDllDirectory handle does not unregister when garbage collected.
# Give this VS instance a lease; its finalizer owns a separate cleanup stack so
# it cannot keep the lease itself alive after mpv clears the script globals.
dll_directories = ExitStack()
dll_directory_cleanup = None
try:
    for relative in ('python', 'python/Lib/site-packages/vapoursynth',
                     'plugins', 'plugins/vsmlrt-cuda'):
        dll_directories.enter_context(os.add_dll_directory(str(runtime / relative)))
    dll_directory_cleanup = weakref.finalize(dll_directories, dll_directories.pop_all().close)
    plugins_directory = str(runtime / 'plugins')
    sys.path[:] = [entry for entry in sys.path if entry != plugins_directory]
    sys.path.insert(0, plugins_directory)
    vs.core.num_threads = 4
    vs.core.max_cache_size = 1024
    if not hasattr(vs.core, 'trt'):
        vs.core.std.LoadPlugin(path=options['trt_plugin_path'])
    build = runpy.run_path(str(Path(__file__).with_name('trt_pipeline.py')))['build_rife_filter']
    build(video_in, options).set_output()
except BaseException:
    if dll_directory_cleanup is not None:
        dll_directory_cleanup()
    else:
        dll_directories.close()
    raise
