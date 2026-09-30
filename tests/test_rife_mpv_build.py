"""Check the real EOF patch against the pinned Windows mpv source."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
BUILDER = ROOT / "dev/windows/rife/build_mpv.py"


class MpvBuildPreparationTests(unittest.TestCase):
    @unittest.skipUnless(os.environ.get('RIFE_TEST_MPV_SOURCE'), 'requires pinned source checkout')
    def test_hwdec_pointer_patch_preserves_input_and_direct_copy_registration(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            relative = Path('video/decode/vd_lavc.c')
            target = base / relative
            target.parent.mkdir(parents=True)
            target.write_bytes((Path(os.environ['RIFE_TEST_MPV_SOURCE']) / relative).read_bytes())
            applied = subprocess.run(['git', '-C', str(base), 'apply',
                str(ROOT / 'dev/windows/rife/mpv-win64-hwdec-pointer.patch')], capture_output=True)
            self.assertEqual(applied.returncode, 0, applied.stderr.decode('utf-8', errors='replace'))
            source = target.read_text(encoding='utf-8')
            definition = re.search(r'struct hwdec_info \{.*?\n\};', source, re.S).group()
            flags = re.search(r'enum \{\n    HWDEC_FLAG_AUTO.*?\n\};', source, re.S).group()
            autoprobe = re.search(r'struct autoprobe_info \{.*?\n\};', source, re.S).group()
            entries = re.search(r'const struct autoprobe_info hwdec_autoprobe_info\[\] = \{.*?\n\};', source, re.S).group()
            function = re.search(r'static void add_hwdec_item\(.*?\n\}', source, re.S).group()
            unit = base / 'hwdec.c'
            unit.write_text('''#include <assert.h>
#include <limits.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdio.h>
#include <stdarg.h>
#include <string.h>
typedef struct AVCodec { const char *name; } AVCodec;
enum AVHWDeviceType { AV_HWDEVICE_TYPE_NONE, AV_HWDEVICE_TYPE_CUDA };
enum AVPixelFormat { AV_PIX_FMT_NONE, AV_PIX_FMT_YUV420P };
static void mp_snprintf_cat(char *out, size_t size, const char *format, ...) {
    size_t length=strlen(out); va_list args; va_start(args,format);
    vsnprintf(out+length,size-length,format,args); va_end(args);
}
#define MP_TARRAY_APPEND(ctx, array, count, value) ((array)[(count)++]=(value))
''' + definition + '\n' + flags + '\n' + autoprobe + '\n' + entries + '\n' + function + '''
int main(void) {
    const AVCodec codec={"h264"};
    struct hwdec_info storage[2], *items=storage, input={0}; int count=0;
    input.codec=&codec; input.lavc_device=AV_HWDEVICE_TYPE_CUDA;
    input.pix_fmt=AV_PIX_FMT_YUV420P; input.use_hw_frames=true;
    strcpy(input.method_name,"nvdec"); struct hwdec_info before=input;
    add_hwdec_item(&items,&count,&input);
    assert(!memcmp(&before,&input,sizeof(input)));
    input.copying=true; before=input;
    add_hwdec_item(&items,&count,&input);
    assert(!memcmp(&before,&input,sizeof(input)));
    assert(count==2 && !strcmp(items[0].name,"h264-nvdec"));
    assert(!strcmp(items[1].name,"h264-nvdec-copy"));
    assert(items[0].rank==0 && items[1].rank==1);
    assert(items[0].flags==(HWDEC_FLAG_AUTO|HWDEC_FLAG_WHITELIST));
    assert(items[1].flags==items[0].flags && items[1].auto_pos>items[0].auto_pos);
    assert(items[0].codec==&codec && items[1].codec==&codec);
    assert(items[0].use_hw_frames && items[1].use_hw_frames);
    assert(items[0].pix_fmt==AV_PIX_FMT_YUV420P && items[1].pix_fmt==AV_PIX_FMT_YUV420P);
    return 0;
}
''', encoding='utf-8')
            executable = base / ('hwdec.exe' if os.name == 'nt' else 'hwdec')
            compiler = os.environ.get('RIFE_TEST_C_COMPILER', 'cl' if os.name == 'nt' else 'cc')
            flags = ['/nologo', '/TC', '/Fe:' + str(executable), '/Fo:' + str(base / 'hwdec.obj')] if os.name == 'nt' else ['-std=c11', '-O2', '-o', str(executable)]
            compiled = subprocess.run([compiler, *flags, str(unit)], capture_output=True)
            self.assertEqual(compiled.returncode, 0, (compiled.stdout+compiled.stderr).decode('utf-8',errors='replace'))
            executed = subprocess.run([str(executable)], capture_output=True)
            self.assertEqual(executed.returncode, 0, executed.stderr)

    @unittest.skipUnless(os.environ.get("RIFE_TEST_MPV_SOURCE"), "requires pinned source checkout")
    def test_private_core_function_compiles_against_pinned_api(self):
        # Applying a patch does not validate its API names. Compile the actual
        # resulting function using our unmodified, pinned VapourSynth headers.
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            relative = Path("video/filter/vf_vapoursynth.c")
            target = base / relative
            target.parent.mkdir(parents=True)
            target.write_bytes((Path(os.environ["RIFE_TEST_MPV_SOURCE"]) / relative).read_bytes())
            subprocess.run(["git", "-C", str(base), "apply", "--include=video/filter/vf_vapoursynth.c", str(ROOT / "dev/macos/rife/mpv-eof-aware.patch"),
                            str(ROOT / "dev/windows/rife/mpv-private-vs-core.patch")], check=True,
                           capture_output=True)
            match = re.search(r"static int drv_vss_load_core\(struct priv \*p\)\n\{.*?\n\}",
                              target.read_text(encoding="utf-8"), re.S)
            self.assertIsNotNone(match)
            unit = base / "private_core.c"
            unit.write_text('#include <stddef.h>\n#include "VSScript4.h"\n'
                'struct options { int eof_aware; };\n'
                'struct priv { const VSSCRIPTAPI *vs_script_api; const VSAPI *vsapi; '
                'VSScript *vs_script; VSCore *vscore; struct options *opts; };\n'
                + match.group() + '\n', encoding="utf-8")
            compiler = os.environ.get("RIFE_TEST_C_COMPILER", "cl" if os.name == "nt" else "cc")
            flags = ["/nologo", "/Zs", "/TC", "/I" + str(ROOT / "dev/windows/rife/include")] if os.name == "nt" else [
                "-fsyntax-only", "-D_WIN32", "-D__stdcall=", "-D__declspec(x)=", "-I", str(ROOT / "dev/windows/rife/include")]
            result = subprocess.run([compiler, *flags, str(unit)], capture_output=True)
            self.assertEqual(result.returncode, 0, (result.stdout + result.stderr).decode("utf-8", errors="replace"))

    def run_check(self, source):
        with tempfile.TemporaryDirectory() as temp:
            report = Path(temp) / "report.json"
            result = subprocess.run([sys.executable, str(BUILDER), "--check-source", str(source),
                                     "--report", str(report)], capture_output=True, text=True, timeout=30)
            self.assertTrue(report.exists(), result.stderr)
            return result.returncode, json.loads(report.read_text(encoding="utf-8"))

    def test_wrong_source_is_rejected_before_build(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp)
            subprocess.run(["git", "init", "-q", str(source)], check=True)
            (source / "fixture").write_text("incorrect source", encoding="utf-8")
            subprocess.run(["git", "-C", str(source), "add", "fixture"], check=True)
            subprocess.run(["git", "-C", str(source), "-c", "user.name=Test",
                            "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture"], check=True)
            code, report = self.run_check(source)
            self.assertNotEqual(code, 0)
            self.assertEqual(report["errorCode"], "source-sha")

    @unittest.skipUnless(os.environ.get("RIFE_TEST_MPV_SOURCE"), "requires pinned source checkout")
    def test_complete_eof_patch_applies_without_modifying_original_source(self):
        source = Path(os.environ["RIFE_TEST_MPV_SOURCE"])
        code, report = self.run_check(source)
        self.assertEqual(code, 0, report)
        self.assertEqual(report["sourceSha"], "dd5d17d3285a095a0f712fa9d116e22a076492de")
        self.assertTrue(report["eofPatchApplicable"])
        self.assertTrue(report['privateCorePatchApplicable'])
        self.assertEqual(subprocess.run(["git", "-C", str(source), "diff", "--quiet"]).returncode, 0)


if __name__ == "__main__":
    unittest.main()
