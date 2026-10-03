#pragma once
#include "InterpolationPolicy.h"
#include "RifeSessionMetrics.h"
#include <QVariantMap>
#include <QStringList>
#include <functional>
namespace rife {
enum class State {Off,Preparing,Active,Bypassed,DisabledForCurrentItem};
enum class Backend {CoreMLMetal,TensorRT};
struct RuntimePaths {
    QString model,plugin,script;bool available=false;QString pipeline="split-coarse-metal",compute="cpu-ane";
    Backend backend=Backend::CoreMLMetal;
    QString engine,runtime,trtPlugin;
    int factor=2,alignment=128,implementation=1,numStreams=1,deviceId=0;
};
struct MpvAccess {
    std::function<QVariant(const QString&)> read;
    std::function<bool(const QString&,const QVariant&)> set;
    std::function<bool(const QStringList&)> command;
    std::function<bool(const QString&,const QVariant&)> setAsync;
    std::function<bool(const QStringList&)> commandAsync;
    std::function<bool(const QString&,const QVariant&,int)> setAsyncTagged;
};
class FrameInterpolationController {
public:
    FrameInterpolationController(MpvAccess access,RuntimePaths paths);
    ~FrameInterpolationController();
    bool setRuntimePaths(RuntimePaths paths);
    void beginItem(bool enabled,bool systemConfig);
    void onFormatChanged(const SourceInfo& source);
    void onSeek();
    void onPlaybackSpeed(double speed);
    void bypassCurrentItem(const QString& reason);
    void stop();
    void stopOnEndFile();
    void configureHardwareDecoding(const QString& mode);
    void configureVideoSync(const QString& mode);
    void onVideoSyncChanged(const QString& mode){effectiveVideoSync=mode;}
    void poll(int64_t nowMs,bool suspended);
    void onMetrics(uint64_t generation,const Metrics& metrics,int64_t nowMs,bool suspended,uint64_t drops,
                   double avsync=std::numeric_limits<double>::quiet_NaN(),uint64_t decoderDrops=0);
    State state()const{return current;}
    uint64_t generation()const{return serial;}
    QString status()const;
    QVariantMap diagnostics()const;
    bool ownsDecoding()const{return hwdecOwned;}
    bool ownsFilter()const{return filterOwned;}
private:
    bool conflict()const;
    bool hasFilter(bool requireEnabled=true)const;
    void detach();
    void disable(const QString& reason,bool bypass=false);
    MpvAccess mpv;
    RuntimePaths paths;
    State current=State::Off;
    SourceInfo source;
    uint64_t serial=0,session=0,epoch=0;
    bool requested=false,filterOwned=false,hwdecOwned=false,notified=false;
    QString oldHwdec,reason;
    bool videoSyncOwned=false;
    QString oldVideoSync,effectiveVideoSync;
    Metrics latest;
    QVariantMap lastFailure;
    PerformanceGuard guard;
    int64_t preparingSince=-1;
};
SourceInfo sourceInfo(const QVariantMap& params,const QVariantMap& frame,double fps);
RuntimePaths bundledRuntimePaths();
}
