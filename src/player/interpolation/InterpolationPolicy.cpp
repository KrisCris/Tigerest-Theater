#include "InterpolationPolicy.h"
#include <cmath>
#include <numeric>
#include <algorithm>
namespace rife {
Eligibility qualify(const SourceInfo& s,SourceLimits limits) {
    if(s.hdr)return {false,"hdr"};
    if(!s.colorKnown)return {false,"unknown-color"};
    if(!s.progressive)return {false,"interlaced"};
    if(!s.cfr)return {false,"vfr"};
    if(s.fpsNum<=0 || s.fpsDen<=0 || double(s.fpsNum)/s.fpsDen>limits.fps)
        return {false,"unsupported-fps"};
    if(s.width<2 || s.height<2 || s.width>limits.width || s.height>limits.height)
        return {false,"unsupported-size"};
    return {true,{}};
}
Rational rationalFrameRate(double fps) {
    // Preserve valid high rates so qualification can report its actual limit.
    if(!std::isfinite(fps)||fps<=0||fps>1000)return {0,1};
    for(int64_t num:{24000,30000,60000})if(std::abs(fps-double(num)/1001)<.0001)return {num,1001};
    const auto n=int64_t(std::llround(fps*10000)),d=int64_t(10000),g=std::gcd(n,d);
    return {n/g,d/g};
}
int integerMultiplier(Rational source,int target){
    if(source.num<=0||source.den<=0||target<=0)return 0;
    const double desired=double(target)*source.den/source.num;
    if(!std::isfinite(desired))return 0;
    // Ties use the lower integer, avoiding unnecessary extra inference.
    return int(std::clamp(std::ceil(desired-.5),2.,15.));
}
void PerformanceGuard::reset(){start=avSince=previousPoll=-1;firstPairs=firstDrops=firstDecoderDrops=0;slowWindows=0;warming=true;}
bool PerformanceGuard::update(int64_t now,uint64_t predictions,uint64_t pairs,double p95,
                               uint64_t drops,double fps,bool suspended,int factor,bool timingAvailable,
                               double avsync,uint64_t decoderDrops) {
    if(parameters.windowsBackend){
        if(suspended||!pairs||!std::isfinite(fps)||fps<=0||factor<2||factor>15){reset();return false;}
        if(start<0||now<start||pairs<firstPairs||drops<firstDrops||decoderDrops<firstDecoderDrops){
            reset();start=now;firstPairs=pairs;firstDrops=drops;firstDecoderDrops=decoderDrops;return false;
        }
        if(warming){
            if(now-start<parameters.warmupMs)return false;
            warming=false;start=now;firstPairs=pairs;firstDrops=drops;firstDecoderDrops=decoderDrops;
        }
        if(!std::isfinite(avsync)||std::abs(avsync)*1000<=parameters.maxAvSyncMs){avSince=-1;}
        else if(avSince<0||previousPoll<0||now-previousPoll>1000){avSince=now;}
        previousPoll=now;
        if(avSince>=0&&now-avSince>=parameters.windowMs)return true;
        if(now-start<parameters.windowMs)return false;
        // VO drops are already part of the filter's produced output. Decoder
        // drops precede the filter and represent factor output opportunities.
        const double decodedDrops=double(decoderDrops-firstDecoderDrops)*factor;
        const double opportunities=double(pairs-firstPairs)*factor+decodedDrops;
        const double lost=double(drops-firstDrops)+decodedDrops;
        const bool slow=opportunities>0&&lost/opportunities>parameters.maxDropRatio;
        start=now;firstPairs=pairs;firstDrops=drops;firstDecoderDrops=decoderDrops;
        return slow;
    }
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
