#pragma once
#include "FrameTiming.h"
#include <string>
namespace rife {
struct SourceInfo {
    int width=0,height=0;
    int64_t fpsNum=0,fpsDen=1;
    bool progressive=false,cfr=false,hdr=false,colorKnown=false;
};
struct Eligibility {bool enabled;std::string reason;};
Eligibility qualify(const SourceInfo& source);
Rational rationalFrameRate(double fps);
// Holds the initial audio/video clock while models load. User pause intent is
// independent of the temporary pause used for preparation.
class StartupGate {
public:
    void begin(bool enabled,bool paused,int64_t now) {pending=enabled;resume=!paused;since=now;}
    bool waiting()const{return pending;}
    bool waitingToPlay()const{return pending&&resume;}
    bool expired(int64_t now)const{return pending&&now-since>=15000;}
    void togglePause(){if(pending)resume=!resume;}
    bool requestPause(bool paused){resume=!paused;return pending||paused;}
    bool finish(){const bool play=pending&&resume;pending=false;return play;}
    void cancel(){pending=false;resume=false;}
private:
    bool pending=false,resume=false;
    int64_t since=0;
};
class PerformanceGuard {
public:
    void reset();
    bool update(int64_t nowMs,uint64_t predictions,uint64_t pairs,double p95Ms,
                uint64_t drops,double fps,bool suspended);
private:
    int64_t start=-1;
    uint64_t firstPairs=0,firstDrops=0;
    unsigned slowWindows=0;
};
}
