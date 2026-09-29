#include "InterpolationPolicy.h"
#include <cmath>
#include <numeric>
namespace rife {
Eligibility qualify(const SourceInfo& s) {
    if(s.hdr)return {false,"hdr"};
    if(!s.colorKnown)return {false,"unknown-color"};
    if(!s.progressive)return {false,"interlaced"};
    if(!s.cfr)return {false,"vfr"};
    if(s.fpsNum<=0 || s.fpsDen<=0 || double(s.fpsNum)/s.fpsDen>30.001)
        return {false,"unsupported-fps"};
    if(s.width<2 || s.height<2 || s.width>1920 || s.height>1080)
        return {false,"unsupported-size"};
    return {true,{}};
}
Rational rationalFrameRate(double fps) {
    if(!std::isfinite(fps)||fps<=0||fps>30.001)return {0,1};
    for(int64_t num:{24000,30000})if(std::abs(fps-double(num)/1001)<.0001)return {num,1001};
    const auto n=int64_t(std::llround(fps*10000)),d=int64_t(10000),g=std::gcd(n,d);
    return {n/g,d/g};
}
void PerformanceGuard::reset(){start=-1;firstPairs=firstDrops=0;slowWindows=0;}
bool PerformanceGuard::update(int64_t now,uint64_t predictions,uint64_t pairs,double p95,
                               uint64_t drops,double fps,bool suspended) {
    if(suspended||predictions<30||fps<=0){reset();return false;}
    if(start<0||now<start||pairs<firstPairs||drops<firstDrops){start=now;firstPairs=pairs;firstDrops=drops;return false;}
    if(now-start<3000)return false;
    // Count delivered output as well as model production: GPU renderer load
    // can drop frames even while inference itself sustains the source rate.
    const double deliveredPairs=double(pairs-firstPairs)-double(drops-firstDrops)/2;
    const double throughput=deliveredPairs*1000/(now-start);
    const bool slow=throughput<fps*.9 && (p95>1000/fps || drops>firstDrops);
    slowWindows=slow?slowWindows+1:0;
    start=now;firstPairs=pairs;firstDrops=drops;
    return slowWindows>=2;
}
}
