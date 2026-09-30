#ifdef NDEBUG
#undef NDEBUG
#endif
#include "windows/RifeVSScriptRuntime.h"
#include "VSScript4.h"
#include <QCoreApplication>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QTemporaryDir>
#include <cassert>
#include <cstdio>
#include <windows.h>

int main(int argc,char** argv){
    QCoreApplication app(argc,argv);
    const auto root=QFileInfo(qEnvironmentVariable("RIFE_TEST_RUNTIME")).canonicalFilePath();assert(!root.isEmpty());
    QString error;
    if(app.arguments().contains("--foreign")){
        QTemporaryDir temp;assert(temp.isValid());
        const auto dll=temp.path()+"/python313.dll";
        assert(QFile::copy(root+"/python/python313.dll",dll));
        const auto foreign=LoadLibraryExW(dll.toStdWString().c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_DEFAULT_DIRS);assert(foreign);
        const auto previous=qgetenv("VSSCRIPT_PATH");
        assert(!rife::activateVSScriptRuntime(root,&error));assert(!error.isEmpty());
        assert(qgetenv("VSSCRIPT_PATH")==previous);assert(!GetModuleHandleW(L"vsscript.dll"));
        FreeLibrary(foreign);return 0;
    }
    // Initialize Python from a fresh native host, not from a Python launcher.
    // Deliberately invalid ambient settings must not change its module search.
    qputenv("PYTHONHOME","C:/untrusted-python-fixture");qputenv("PYTHONPATH","C:/untrusted-python-fixture/modules");
    const auto previous=qgetenv("VSSCRIPT_PATH");
    assert(!rife::validateVSScriptRuntime(root,&error));assert(!error.isEmpty());
    assert(qgetenv("VSSCRIPT_PATH")==previous);assert(!GetModuleHandleW(L"python313.dll"));
    assert(rife::activateVSScriptRuntime(root,&error));assert(error.isEmpty());
    assert(rife::validateVSScriptRuntime(root,&error));assert(error.isEmpty());
    assert(rife::activateVSScriptRuntime(root,&error));
    const auto path=qEnvironmentVariable("VSSCRIPT_PATH");
    assert(path==root+"/python/Lib/site-packages/vapoursynth/vsscript.dll");
    const auto library=LoadLibraryExW(path.toStdWString().c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_DEFAULT_DIRS);
    if(!library){std::fprintf(stderr,"VSScript load failed (%lu): %s\n",GetLastError(),path.toUtf8().constData());return 1;}
    auto getAPI=reinterpret_cast<decltype(&getVSScriptAPI)>(GetProcAddress(library,"getVSScriptAPI"));assert(getAPI);
    const auto* api=getAPI(VSSCRIPT_API_VERSION);assert(api);
    const auto* vs=api->getVSAPI(VAPOURSYNTH_API_VERSION);assert(vs);
    auto* script=api->createScript(vs->createCore(ccfDisableAutoLoading));assert(script);
    auto* variables=vs->createMap();const auto utf8=root.toUtf8();
    vs->mapSetData(variables,"_runtime_root",utf8.constData(),utf8.size(),dtUtf8,maReplace);
    assert(api->setVariables(script,variables)==0);vs->freeMap(variables);
    const char* code="import sys\nfrom pathlib import Path\nimport vapoursynth as vs\n"
        "assert sys.flags.isolated and sys.flags.ignore_environment and sys.flags.no_site\n"
        "assert sys.dont_write_bytecode\n"
        "root=Path(_runtime_root).resolve()\n"
        "assert all(Path(p).resolve().is_relative_to(root) for p in sys.path), sys.path\n"
        "assert 'site' not in sys.modules\n"
        "vs.core.std.BlankClip(width=16,height=16,length=2,format=vs.GRAY8).set_output()\n";
    if(api->evaluateBuffer(script,code,"private-host-test.vpy")){std::fprintf(stderr,"%s\n",api->getError(script));return 1;}
    auto* output=api->getOutputNode(script,0);assert(output);
    char frameError[1024]{};const auto* frame=vs->getFrame(1,output,frameError,sizeof(frameError));assert(frame);
    vs->freeFrame(frame);vs->freeNode(output);api->freeScript(script);FreeLibrary(library);
    assert(!rife::activateVSScriptRuntime(root+"/missing",&error));
    std::puts("Fresh native VSScript host uses isolated private Python and produces frames");
}
