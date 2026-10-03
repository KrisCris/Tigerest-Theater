#include "RifePlaybackCoordinator.h"
#include "RifeVSScriptRuntime.h"
#include <cmath>
namespace rife {
namespace {
bool same(const SourceInfo& a,const SourceInfo& b){return a.width==b.width&&a.height==b.height&&a.fpsNum==b.fpsNum&&a.fpsDen==b.fpsDen&&
    a.progressive==b.progressive&&a.cfr==b.cfr&&a.hdr==b.hdr&&a.colorKnown==b.colorKnown;}
}
RifePlaybackCoordinator::RifePlaybackCoordinator(RifeRuntimeManager& r,FrameInterpolationController& c,ValidateRuntime validation,QObject* parent)
    :QObject(parent),runtime(r),controller(c),validate(std::move(validation)){
    if(!validate)validate=[](const RuntimePaths& paths,QString* error){return validateVSScriptRuntime(paths.runtime,error);};
    connect(&runtime,&RifeRuntimeManager::prepared,this,[this](quint64 generation,bool ready,const QString& message){
        // Attach on the next format poll, inside the player's asynchronous
        // mpv-access scope. A worker callback must not block on VO reconfigure.
        if(inItem&&generation==serial&&preparing){
            preparationFinished=true;preparationSucceeded=ready;error=message;
        }
    });
}
RifePlaybackCoordinator::~RifePlaybackCoordinator(){runtime.cancel(serial);}
void RifePlaybackCoordinator::beginItem(bool enabled,bool systemConfig,double speed){
    cancelPreparation();++serial;inItem=true;sourceSeen=false;cacheHit=false;source={};error.clear();
    controller.stop();
    auto paths=runtime.pathsFor({});paths.factor=2;
    controller.setRuntimePaths(paths);controller.beginItem(enabled,systemConfig);
    onPlaybackSpeed(speed);
}
void RifePlaybackCoordinator::onFormatChanged(const SourceInfo& info){
    if(!inItem)return;
    if(sourceSeen){
        if(!same(source,info)){cancelPreparation();controller.bypassCurrentItem("dynamic-format");}
        else {
            if(preparing&&preparationFinished)completePreparation();
            else controller.onFormatChanged(info);
            if(preparing&&controller.state()!=State::Preparing)cancelPreparation();
        }
        return;
    }
    sourceSeen=true;source=info;
    // The item may already be bypassed by runtime/system/filter/speed policy.
    if(controller.state()!=State::Preparing)return;
    auto paths=runtime.pathsFor(info);
    cacheHit=!paths.engine.isEmpty(); // pathsFor verifies the complete cache identity and bytes.
    const bool eligible=qualify(info,{3840,2160,60.001}).enabled;
    // Startup activates the verified runtime before mpv_create. The playback
    // hook only verifies that state; setting VSSCRIPT_PATH here is too late.
    if(eligible&&!paths.engine.isEmpty()&&!validate(paths,&error)){
        controller.bypassCurrentItem("runtime-missing");return;
    }
    controller.setRuntimePaths(paths);controller.onFormatChanged(info);
    if(controller.state()==State::Preparing&&controller.diagnostics()["reason"]=="engine-preparing"){
        preparing=true;preparationFinished=false;runtime.prepare(info,serial);
    }
}
void RifePlaybackCoordinator::cancelPreparation(){
    runtime.cancel(serial);preparing=false;preparationFinished=false;
}
void RifePlaybackCoordinator::completePreparation(){
    preparing=false;preparationFinished=false;
    if(controller.state()!=State::Preparing)return;
    if(!preparationSucceeded){
        controller.bypassCurrentItem("engine-prepare-error");
        emit enginePrepared(serial,false,error);return;
    }
    const auto paths=runtime.pathsFor(source); // Revalidate identity and bytes before attaching.
    if(paths.engine.isEmpty()||!validate(paths,&error)||!controller.setRuntimePaths(paths)){
        if(error.isEmpty())error=QStringLiteral("Prepared RIFE engine is unavailable");
        controller.bypassCurrentItem("runtime-missing");
        emit enginePrepared(serial,false,error);return;
    }
    controller.onFormatChanged(source);
    const bool attached=controller.ownsFilter();
    if(!attached&&error.isEmpty())error=QStringLiteral("Cannot attach prepared RIFE engine");
    emit enginePrepared(serial,attached,error);
}
void RifePlaybackCoordinator::onSeek(){if(inItem)controller.onSeek();}
void RifePlaybackCoordinator::onPlaybackSpeed(double speed){
    if(!inItem)return;
    if(!std::isfinite(speed)||std::abs(speed-1.)>1e-6)cancelPreparation();
    controller.onPlaybackSpeed(speed);
}
void RifePlaybackCoordinator::endItem(){
    cancelPreparation();++serial;inItem=false;sourceSeen=false;cacheHit=false;
    controller.stopOnEndFile();
}
}
