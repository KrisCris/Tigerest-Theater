#ifdef NDEBUG
#undef NDEBUG
#endif
#include "RifeSessionMetrics.h"
#include "VapourSynth4.h"
#include <QCoreApplication>
#include <QString>
#include <cassert>
#include <cstdio>
#include <stdexcept>
#include <windows.h>

int main(int argc,char** argv) {
    QCoreApplication app(argc,argv);
    const auto arguments=app.arguments();
    if(arguments.size()!=3)return 2;
    const auto libraryPath=arguments[1].toStdWString();
    HMODULE library=LoadLibraryExW(libraryPath.c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_DEFAULT_DIRS);
    assert(library);
    auto getAPI=reinterpret_cast<VSGetVapourSynthAPI>(GetProcAddress(library,"getVapourSynthAPI"));
    assert(getAPI);
    const auto* api=getAPI(VAPOURSYNTH_API_VERSION);
    assert(api);
    VSCore* core=api->createCore(ccfDisableAutoLoading);
    assert(core);
    auto* standard=api->getPluginByID("com.vapoursynth.std",core);
    assert(standard);
    VSMap* input=api->createMap();
    const auto pluginPath=arguments[2].toUtf8();
    api->mapSetData(input,"path",pluginPath.constData(),pluginPath.size(),dtUtf8,maReplace);
    VSMap* result=api->invoke(standard,"LoadPlugin",input);
    if(const auto* error=api->mapGetError(result)){std::fprintf(stderr,"%s\n",error);return 1;}
    api->freeMap(result);api->clearMap(input);
    for(const auto& setting: {std::pair<const char*,int>{"width",16},{"height",16},{"format",pfGray8},{"length",10},{"fpsnum",240}})
        api->mapSetInt(input,setting.first,setting.second,maReplace);
    result=api->invoke(standard,"BlankClip",input);
    assert(!api->mapGetError(result));
    VSNode* blank=api->mapGetNode(result,"clip",0,nullptr);
    api->freeMap(result);api->clearMap(input);
    api->mapSetNode(input,"clip",blank,maReplace);
    api->mapSetInt(input,"_TigerestRifeSynthesized",1,maReplace);
    api->mapSetInt(input,"_TigerestRifeTimingAvailable",0,maReplace);
    result=api->invoke(standard,"SetFrameProps",input);
    assert(!api->mapGetError(result));
    VSNode* marked=api->mapGetNode(result,"clip",0,nullptr);
    api->freeMap(result);api->clearMap(input);
    const auto session=rife::openSession();
    api->mapSetNode(input,"clip",marked,maReplace);
    api->mapSetInt(input,"session",session,maReplace);
    api->mapSetInt(input,"factor",10,maReplace);
    auto* monitorPlugin=api->getPluginByID("io.github.tigerest.rife",core);
    assert(monitorPlugin);
    result=api->invoke(monitorPlugin,"Monitor",input);
    assert(!api->mapGetError(result));
    VSNode* output=api->mapGetNode(result,"clip",0,nullptr);
    api->freeMap(result);api->freeMap(input);
    for(int n=0;n<10;++n){
        char error[1024]{};
        const auto* frame=api->getFrame(n,output,error,sizeof(error));
        if(!frame){std::fprintf(stderr,"%s\n",error);return 1;}
        api->freeFrame(frame);
    }
    const auto metrics=rife::readMetrics(session);
    assert(metrics.epoch!=0&&metrics.predictions==10&&metrics.pairs==1);
    assert(!metrics.timingAvailable&&metrics.error.empty());
    rife::closeSession(session);
    api->freeNode(output);api->freeNode(marked);api->freeNode(blank);
    api->freeCore(core);FreeLibrary(library);
    std::puts("Monitor updated the host's shared metrics registry");
}
