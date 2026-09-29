#pragma once
#include "InterpolationPolicy.h"
#include "RifeSessionMetrics.h"
#include <QVariantMap>
#include <QStringList>
#include <functional>
namespace rife {
enum class State {Off,Preparing,Active,Bypassed,DisabledForCurrentItem};
struct RuntimePaths {QString model,plugin,script;bool available=false;QString pipeline="split-coarse-metal",compute="cpu-ane";};
struct MpvAccess {
    std::function<QVariant(const QString&)> read;
    std::function<bool(const QString&,const QVariant&)> set;
    std::function<bool(const QStringList&)> command;
};
class FrameInterpolationController {
public:
    FrameInterpolationController(MpvAccess access,RuntimePaths paths);
    ~FrameInterpolationController();
    void beginItem(bool enabled,bool systemConfig);
    void onFormatChanged(const SourceInfo& source);
    void onSeek();
    void stop();
    void poll(int64_t nowMs,bool suspended);
    void onMetrics(uint64_t generation,const Metrics& metrics,int64_t nowMs,bool suspended,uint64_t drops);
    State state()const{return current;}
    uint64_t generation()const{return serial;}
    QString status()const;
    QVariantMap diagnostics()const;
    bool ownsDecoding()const{return hwdecOwned;}
private:
    bool conflict()const;
    bool hasFilter()const;
    void detach();
    void disable(const QString& reason,bool bypass=false);
    MpvAccess mpv;
    RuntimePaths paths;
    State current=State::Off;
    SourceInfo source;
    uint64_t serial=0,session=0,epoch=0;
    bool requested=false,filterOwned=false,hwdecOwned=false,notified=false;
    QString oldHwdec,reason;
    Metrics latest;
    PerformanceGuard guard;
    int64_t preparingSince=-1;
};
SourceInfo sourceInfo(const QVariantMap& params,const QVariantMap& frame,double fps);
RuntimePaths bundledRuntimePaths();
}
