"""Windows mpv bridge for a previously prepared, private TensorRT runtime."""
import json
import os
from pathlib import Path
import runpy
import sys
import vapoursynth as vs

options = json.loads(user_data)
runtime = Path(options['runtime_path']).resolve()
# Handles remain in the script globals until mpv destroys this VS instance.
dll_directories = [os.add_dll_directory(str(runtime / relative)) for relative in
    ('python', 'python/Lib/site-packages/vapoursynth', 'plugins', 'plugins/vsmlrt-cuda')]
sys.path.insert(0, str(runtime / 'plugins'))
vs.core.num_threads = 4
vs.core.max_cache_size = 1024
if not hasattr(vs.core, 'trt'):
    vs.core.std.LoadPlugin(path=options['trt_plugin_path'])
build = runpy.run_path(str(Path(__file__).with_name('trt_pipeline.py')))['build_rife_filter']
build(video_in, options).set_output()
