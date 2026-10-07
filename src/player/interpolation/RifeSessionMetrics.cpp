#include "RifeSessionMetrics.h"
#include "InterpolationPolicy.h"
#include <algorithm>
#include <cmath>
#include <deque>
#include <mutex>
#include <vector>
namespace rife {
namespace {
std::mutex lock;
uint64_t serial=0,active=0;
Metrics metrics;
std::deque<double> timings;
int lastFrame=-1;
}
uint64_t openSession(){std::lock_guard<std::mutex> g(lock);active=++serial;metrics={};timings.clear();lastFrame=-1;return active;}
void closeSession(uint64_t session){std::lock_guard<std::mutex> g(lock);if(session==active){active=0;metrics={};timings.clear();}}
uint64_t beginInstance(uint64_t session){
    std::lock_guard<std::mutex> g(lock);
    if(!session||session!=active)return 0;
    metrics={};metrics.epoch=++serial;timings.clear();lastFrame=-1;return metrics.epoch;
}
void recordFrame(uint64_t session,uint64_t epoch,int index,bool synthesized,double ms,
                 const std::string& reason,double factor,bool timingAvailable){
    std::lock_guard<std::mutex> g(lock);
    if(!session||session!=active||!epoch||epoch!=metrics.epoch||index<=lastFrame||!validInterpolationMultiplier(factor))return;
    lastFrame=index;
    if(!reason.empty()&&reason!="cut"&&reason!="eof")metrics.error=reason;
    // An output frame completes an interval when its end crosses a source
    // boundary. Half steps alternate their output counts per interval; this
    // also counts the shortened last frame of an odd-length source correctly.
    const int64_t numerator=std::llround(factor*2),position=int64_t(index)*2;
    if((position+2)/numerator>position/numerator){++metrics.pairs;if(reason=="cut")++metrics.cuts;}
    if(!timingAvailable){metrics.timingAvailable=false;timings.clear();}
    if(synthesized){
        ++metrics.predictions;
        if(timingAvailable){
            if(!std::isfinite(ms)||ms<0){metrics.error="inference-error";return;}
            if(metrics.predictions>30){timings.push_back(ms);if(timings.size()>180)timings.pop_front();}
        }
    }
}
Metrics readMetrics(uint64_t session){
    std::lock_guard<std::mutex> g(lock);
    if(!session||session!=active)return {};
    auto result=metrics;
    if(!timings.empty()){
        std::vector<double> sorted(timings.begin(),timings.end());std::sort(sorted.begin(),sorted.end());
        result.p95Ms=sorted[size_t(std::ceil(sorted.size()*.95))-1];
    }
    return result;
}
}
