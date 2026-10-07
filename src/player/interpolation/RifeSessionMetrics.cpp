#include "RifeSessionMetrics.h"
#include "InterpolationPolicy.h"
#include <algorithm>
#include <cmath>
#include <deque>
#include <iterator>
#include <map>
#include <mutex>
#include <utility>
#include <vector>
namespace rife {
namespace {
std::mutex lock;
uint64_t serial=0,active=0;
Metrics metrics;
std::deque<double> timings;
// Parallel VS requests can complete out of order. Keep disjoint inclusive
// ranges so duplicate frames stay excluded even after a seek, while a normal
// contiguous stream occupies one range rather than one entry per frame.
std::map<int64_t,int64_t> completedFrames;
bool firstCompletion(int index) {
    const int64_t frame=index;
    auto next=completedFrames.upper_bound(frame);
    if(next!=completedFrames.begin()){
        auto previous=std::prev(next);
        if(frame<=previous->second)return false;
        if(frame==previous->second+1){
            previous->second=frame;
            if(next!=completedFrames.end()&&next->first==frame+1){
                previous->second=next->second;
                completedFrames.erase(next);
            }
            return true;
        }
    }
    if(next!=completedFrames.end()&&next->first==frame+1){
        auto range=completedFrames.extract(next);
        range.key()=frame;
        completedFrames.insert(std::move(range));
    } else completedFrames.emplace(frame,frame);
    return true;
}
}
uint64_t openSession(){std::lock_guard<std::mutex> g(lock);active=++serial;metrics={};timings.clear();completedFrames.clear();return active;}
void closeSession(uint64_t session){std::lock_guard<std::mutex> g(lock);if(session==active){active=0;metrics={};timings.clear();completedFrames.clear();}}
uint64_t beginInstance(uint64_t session){
    std::lock_guard<std::mutex> g(lock);
    if(!session||session!=active)return 0;
    metrics={};metrics.epoch=++serial;timings.clear();completedFrames.clear();return metrics.epoch;
}
void recordFrame(uint64_t session,uint64_t epoch,int index,bool synthesized,double ms,
                 const std::string& reason,double factor,bool timingAvailable){
    std::lock_guard<std::mutex> g(lock);
    if(!session||session!=active||!epoch||epoch!=metrics.epoch||index<0||!validInterpolationMultiplier(factor)||!firstCompletion(index))return;
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
