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
        // A completed compile only informs this item. It never replaces its
        // graph; the verified cache will be picked up by the next beginItem.
        if(inItem&&generation==serial)emit enginePrepared(generation,ready,message);
    });
}
RifePlaybackCoordinator::~RifePlaybackCoordinator(){runtime.cancel(serial);}
void RifePlaybackCoordinator::beginItem(bool enabled,bool systemConfig,double speed){
    runtime.cancel(serial);++serial;inItem=true;sourceSeen=false;source={};error.clear();
    controller.stop();
    auto paths=runtime.pathsFor({});paths.factor=2;
    controller.setRuntimePaths(paths);controller.beginItem(enabled,systemConfig);
    onPlaybackSpeed(speed);
}
void RifePlaybackCoordinator::onFormatChanged(const SourceInfo& info){
    if(!inItem)return;
    if(sourceSeen){
        if(!same(source,info)){runtime.cancel(serial);controller.bypassCurrentItem("dynamic-format");}
        else controller.onFormatChanged(info);
        return;
    }
    sourceSeen=true;source=info;
    // The item may already be bypassed by runtime/system/filter/speed policy.
    if(controller.state()!=State::Preparing)return;
    auto paths=runtime.pathsFor(info);
    const bool eligible=qualify(info,{3840,2160,60.001}).enabled;
    // Startup activates the verified runtime before mpv_create. The playback
    // hook only verifies that state; setting VSSCRIPT_PATH here is too late.
    if(eligible&&!paths.engine.isEmpty()&&!validate(paths,&error)){
        controller.bypassCurrentItem("runtime-missing");return;
    }
    controller.setRuntimePaths(paths);controller.onFormatChanged(info);
    if(controller.diagnostics()["reason"]=="engine-preparing")runtime.prepare(info,serial);
}
void RifePlaybackCoordinator::onSeek(){if(inItem)controller.onSeek();}
void RifePlaybackCoordinator::onPlaybackSpeed(double speed){
    if(!inItem)return;
    if(!std::isfinite(speed)||std::abs(speed-1.)>1e-6)runtime.cancel(serial);
    controller.onPlaybackSpeed(speed);
}
void RifePlaybackCoordinator::endItem(){
    runtime.cancel(serial);++serial;inItem=false;sourceSeen=false;
    controller.stopOnEndFile();
}
}
