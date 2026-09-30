#include "RifeSessionMetrics.h"
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
void recordFrame(uint64_t session,uint64_t epoch,int index,bool synthesized,double ms,const std::string& reason){
    std::lock_guard<std::mutex> g(lock);
    if(!session||session!=active||!epoch||epoch!=metrics.epoch||index<=lastFrame)return;
    lastFrame=index;
    if(!reason.empty()&&reason!="cut"&&reason!="eof")metrics.error=reason;
    if(index%2)++metrics.pairs;
    if(reason=="cut")++metrics.cuts;
    if(synthesized){
        ++metrics.predictions;
        if(!std::isfinite(ms)||ms<0){metrics.error="inference-error";return;}
        if(metrics.predictions>30){timings.push_back(ms);if(timings.size()>180)timings.pop_front();}
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
