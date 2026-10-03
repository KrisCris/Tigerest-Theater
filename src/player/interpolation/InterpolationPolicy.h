#pragma once
#include "FrameTiming.h"
#include <string>
#include <limits>
namespace rife {
struct SourceInfo {
    int width=0,height=0;
    int64_t fpsNum=0,fpsDen=1;
    bool progressive=false,cfr=false,hdr=false,colorKnown=false;
};
struct Eligibility {bool enabled;std::string reason;};
struct SourceLimits {int width=1920,height=1080;double fps=30.001;};
Eligibility qualify(const SourceInfo& source,SourceLimits limits={});
Rational rationalFrameRate(double fps);
int integerMultiplier(Rational source,int targetFps);
// Holds the initial audio/video clock while models load. User pause intent is
// independent of the temporary pause used for preparation.
class StartupGate {
public:
    void begin(bool enabled,bool paused,int64_t now) {++serial;pending=enabled;resume=!paused;since=started=now;compiling=false;}
    uint64_t generation()const{return serial;}
    bool waiting()const{return pending;}
    bool waitingToPlay()const{return pending&&resume;}
    bool expired(int64_t now)const{return pending&&!compiling&&now-since>=15000;}
    void setEnginePreparing(bool preparing,int64_t now){
        if(pending&&compiling!=preparing){compiling=preparing;since=now;}
    }
    int64_t elapsed(int64_t now)const{return pending&&now>started?now-started:0;}
    void togglePause(){if(pending)resume=!resume;}
    bool requestPause(bool paused){resume=!paused;return pending||paused;}
    bool finish(){const bool play=pending&&resume;pending=false;compiling=false;return play;}
    void cancel(){++serial;pending=false;resume=false;compiling=false;}
private:
    bool pending=false,resume=false,compiling=false;
    int64_t since=0,started=0;
    uint64_t serial=0;
};
struct GuardParameters {
    bool windowsBackend=false;
    int64_t warmupMs=5000,windowMs=10000;
    double maxDropRatio=.05,maxAvSyncMs=100.;
    static GuardParameters windows(){GuardParameters p;p.windowsBackend=true;return p;}
};
class PerformanceGuard {
public:
    explicit PerformanceGuard(GuardParameters parameters={}):parameters(parameters){}
    void reset();
    bool update(int64_t nowMs,uint64_t predictions,uint64_t pairs,double p95Ms,
                uint64_t drops,double fps,bool suspended,int factor=2,bool timingAvailable=true,
                double avsync=std::numeric_limits<double>::quiet_NaN(),uint64_t decoderDrops=0,
                double displayFps=std::numeric_limits<double>::quiet_NaN());
private:
    GuardParameters parameters;
    int64_t start=-1;
    int64_t avSince=-1,previousPoll=-1;
    uint64_t firstPairs=0,firstDrops=0,firstDecoderDrops=0;
    double windowDisplayFps=0;
    bool warming=true;
    unsigned slowWindows=0;
};
}
