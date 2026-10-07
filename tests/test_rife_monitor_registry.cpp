#ifdef NDEBUG
#undef NDEBUG
#endif
#include "RifeSessionMetrics.h"
#define VS_USE_API_41
#include "VapourSynth4.h"
#include <QCoreApplication>
#include <QString>
#include <cassert>
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <mutex>
#include <stdexcept>
#include <string>
#include <windows.h>

namespace {
struct ConcurrentSource {
    VSNode* input=nullptr;
    std::mutex mutex;
    std::condition_variable ready;
    int entered=0,active=0,maxActive=0;
};
const VSFrame* VS_CC concurrentFrame(int n,int activation,void* instance,void**,VSFrameContext* context,VSCore*,const VSAPI* api) {
    auto& source=*static_cast<ConcurrentSource*>(instance);
    if(activation==arInitial)api->requestFrameFilter(n,source.input,context);
    if(activation!=arAllFramesReady)return nullptr;
    {
        std::unique_lock<std::mutex> guard(source.mutex);
        ++source.entered;
        ++source.active;
        if(source.active>source.maxActive)source.maxActive=source.active;
        source.ready.notify_all();
        // No GPU or timing threshold: another source request must enter before
        // the first can complete. The timeout lets a serial graph fail cleanly.
        source.ready.wait_for(guard,std::chrono::seconds(2),[&]{return source.entered>=2;});
        --source.active;
    }
    return api->getFrameFilter(n,source.input,context);
}
struct CompletedFrames {
    const VSAPI* api=nullptr;
    std::mutex mutex;
    std::condition_variable ready;
    int count=0;
    std::string error;
};
void VS_CC completedFrame(void* data,const VSFrame* frame,int,VSNode*,const char* error) {
    auto& completed=*static_cast<CompletedFrames*>(data);
    if(frame)completed.api->freeFrame(frame);
    std::lock_guard<std::mutex> guard(completed.mutex);
    if(error)completed.error=error;
    ++completed.count;
    completed.ready.notify_all();
}
void parallelMonitorPreservesUpstreamConcurrency(const VSAPI* api,VSCore* core,VSPlugin* plugin,VSNode* marked,uint64_t session) {
    ConcurrentSource source;source.input=marked;
    VSFilterDependency dependency{marked,rpGeneral};
    VSNode* upstream=api->createVideoFilter2("ConcurrentMonitorTestSource",api->getVideoInfo(marked),
        concurrentFrame,nullptr,fmParallel,&dependency,1,&source,core);
    assert(upstream);
    VSMap* input=api->createMap();
    api->mapSetNode(input,"clip",upstream,maReplace);
    api->mapSetInt(input,"session",session,maReplace);
    api->mapSetInt(input,"factor",5,maReplace);
    api->mapSetInt(input,"factor_den",2,maReplace);
    VSMap* result=api->invoke(plugin,"Monitor",input);
    assert(!api->mapGetError(result));
    VSNode* output=api->mapGetNode(result,"clip",0,nullptr);
    api->freeMap(result);api->freeMap(input);
    CompletedFrames completed;completed.api=api;
    for(int n=0;n<4;++n)api->getFrameAsync(n,output,completedFrame,&completed);
    {
        std::unique_lock<std::mutex> guard(completed.mutex);
        assert(completed.ready.wait_for(guard,std::chrono::seconds(10),[&]{return completed.count==4;}));
        assert(completed.error.empty());
    }
    std::fprintf(stderr,"Monitor mode=%d, concurrent upstream callbacks=%d\n",api->getNodeFilterMode(output),source.maxActive);
    assert(source.maxActive>=2);
    assert(api->getNodeFilterMode(output)==fmParallel);
    const auto metrics=rife::readMetrics(session);
    assert(metrics.predictions==4&&metrics.pairs==1&&metrics.error.empty());
    api->freeNode(output);api->freeNode(upstream);
}
}

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
    api->setThreadCount(4,core);
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
    api->freeMap(result);
    for(int n=0;n<10;++n){
        char error[1024]{};
        const auto* frame=api->getFrame(n,output,error,sizeof(error));
        if(!frame){std::fprintf(stderr,"%s\n",error);return 1;}
        api->freeFrame(frame);
    }
    const auto metrics=rife::readMetrics(session);
    assert(metrics.epoch!=0&&metrics.predictions==10&&metrics.pairs==1);
    assert(!metrics.timingAvailable&&metrics.error.empty());
    api->freeNode(output);
    parallelMonitorPreservesUpstreamConcurrency(api,core,monitorPlugin,marked,session);
    // The optional denominator preserves integer callers and accepts rational
    // half steps. Every new graph resets the shared counters and epoch.
    for(const auto& multiplier:{std::pair<int,int>{3,2},{5,2},{7,2},{30,2}}){
        api->mapSetInt(input,"factor",multiplier.first,maReplace);
        api->mapSetInt(input,"factor_den",multiplier.second,maReplace);
        result=api->invoke(monitorPlugin,"Monitor",input);
        if(const auto* error=api->mapGetError(result))std::fprintf(stderr,"%s\n",error);
        assert(!api->mapGetError(result));
        output=api->mapGetNode(result,"clip",0,nullptr);api->freeMap(result);
        auto current=rife::readMetrics(session);
        assert(current.epoch!=metrics.epoch&&current.predictions==0&&current.pairs==0);
        // Request order differs from frame order, as it does in a parallel graph.
        for(int n:{9,2,7,0,5,1,8,4,6,3}){
            char error[1024]{};
            const auto* frame=api->getFrame(n,output,error,sizeof(error));
            if(!frame){std::fprintf(stderr,"%s\n",error);return 1;}
            api->freeFrame(frame);
        }
        current=rife::readMetrics(session);
        assert(current.predictions==10&&current.pairs==uint64_t(20/multiplier.first));
        assert(!current.timingAvailable&&current.error.empty());
        api->freeNode(output);
    }
    for(const auto& invalid:{std::pair<int,int>{1,1},{2,2},{31,2},{16,1},{5,0},{5,-2},{9,4}}){
        const auto previous=rife::readMetrics(session);
        api->mapSetInt(input,"factor",invalid.first,maReplace);
        api->mapSetInt(input,"factor_den",invalid.second,maReplace);
        result=api->invoke(monitorPlugin,"Monitor",input);
        assert(api->mapGetError(result));api->freeMap(result);
        assert(rife::readMetrics(session).epoch==previous.epoch); // Invalid calls cannot reset an active graph.
    }
    api->freeMap(input);
    rife::closeSession(session);
    api->freeNode(marked);api->freeNode(blank);
    api->freeCore(core);FreeLibrary(library);
    std::puts("Monitor updated the host's shared metrics registry");
}
