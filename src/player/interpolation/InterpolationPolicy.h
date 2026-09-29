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
