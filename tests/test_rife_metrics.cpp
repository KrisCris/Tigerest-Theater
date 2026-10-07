#ifdef NDEBUG
#undef NDEBUG
#endif
#include "RifeSessionMetrics.h"
#include <cassert>
#include <cstdio>
#include <limits>
#include <thread>
#include <vector>
#ifdef _WIN32
#include <windows.h>
#include <psapi.h>
#endif

#ifdef _WIN32
static SIZE_T privateBytes() {
    PROCESS_MEMORY_COUNTERS_EX memory{};
    memory.cb=sizeof(memory);
    assert(GetProcessMemoryInfo(GetCurrentProcess(),reinterpret_cast<PROCESS_MEMORY_COUNTERS*>(&memory),sizeof(memory)));
    return memory.PrivateUsage;
}
#endif

static void longStreamKeepsHistoryCompact() {
    const auto session=rife::openSession(),epoch=rife::beginInstance(session);
#ifdef _WIN32
    const auto before=privateBytes();
#endif
    // A million completed frames must not allocate a million history entries.
    // Each small request window completes out of order, as with prefetch.
    for(int start=0;start<1000000;start+=4)
        for(int offset:{3,1,0,2})rife::recordFrame(session,epoch,start+offset,true,0,"",2.5,false);
    for(int n:{0,42,999999})rife::recordFrame(session,epoch,n,true,0,"duplicate-error",2.5,false);
    const auto m=rife::readMetrics(session);
    assert(m.predictions==1000000&&m.pairs==400000&&m.error.empty());
#ifdef _WIN32
    const auto after=privateBytes();
    std::fprintf(stderr,"One million frames: private memory growth=%lld bytes\n",static_cast<long long>(after)-static_cast<long long>(before));
    // Leave room for unrelated CRT pages; a per-frame set uses tens of MiB.
    assert(after<=before+8*1024*1024);
#endif
    rife::closeSession(session);
}

static void outOfOrderFramesAreCountedOnce() {
    const auto session=rife::openSession(),epoch=rife::beginInstance(session);
    // At 2.5x, intervals end at 2, 4 and 7; only the middle one is a cut.
    for(int n:{7,2,4,1,0,6,3,5})
        rife::recordFrame(session,epoch,n,n==1||n==2,0,n>=5?"eof":n>=3?"cut":"",2.5,false);
    auto m=rife::readMetrics(session);
    assert(m.predictions==2&&m.pairs==3&&m.cuts==1&&m.error.empty());
    for(int n:{0,7,3,2,4,1,6,5})
        rife::recordFrame(session,epoch,n,true,0,"inference-error",2.5,false);
    m=rife::readMetrics(session);
    assert(m.predictions==2&&m.pairs==3&&m.cuts==1&&m.error.empty());

    for(const auto& setting:{std::pair<double,uint64_t>{1.5,20},{2,15},{2.5,12},{3.5,8},{15,2}}){
        const auto next=rife::beginInstance(session);
        for(int n=29;n>=0;--n)rife::recordFrame(session,next,n,true,0,"",setting.first,false);
        m=rife::readMetrics(session);
        assert(m.predictions==30&&m.pairs==setting.second&&m.cuts==0);
    }
    rife::closeSession(session);
}

static void concurrentCallbacksIgnoreDuplicatesAndStaleEpochs() {
    const auto session=rife::openSession(),oldEpoch=rife::beginInstance(session);
    rife::recordFrame(session,oldEpoch,239,true,0,"",2.5);
    const auto epoch=rife::beginInstance(session);
    std::vector<std::thread> workers;
    for(int worker=0;worker<8;++worker)workers.emplace_back([=]{
        // Each callback sequence covers every frame in a different order.
        for(int i=0;i<240;++i){
            const int n=(i+worker*31)%240;
            rife::recordFrame(session,oldEpoch,n,true,0,"stale-error",2.5);
            rife::recordFrame(session,epoch,n,true,4,"",2.5);
        }
    });
    for(auto& worker:workers)worker.join();
    auto m=rife::readMetrics(session);
    assert(m.predictions==240&&m.pairs==96&&m.cuts==0&&m.p95Ms==4&&m.error.empty());
    const auto replacement=rife::openSession(),replacementEpoch=rife::beginInstance(replacement);
    rife::recordFrame(session,epoch,240,true,0,"stale-error",2.5);
    rife::closeSession(session); // Closing the displaced session cannot clear its replacement.
    rife::recordFrame(replacement,replacementEpoch,239,true,0,"",2.5,false);
    rife::recordFrame(replacement,replacementEpoch,2,true,0,"",2.5,false);
    m=rife::readMetrics(replacement);
    assert(m.predictions==2&&m.pairs==2&&m.error.empty());
    rife::closeSession(replacement);
    assert(rife::readMetrics(replacement).epoch==0);
}

int main() {
    outOfOrderFramesAreCountedOnce();
    concurrentCallbacksIgnoreDuplicatesAndStaleEpochs();
    longStreamKeepsHistoryCompact();
    const auto session=rife::openSession(), epoch=rife::beginInstance(session);
    for(int n=0;n<10;++n)
        rife::recordFrame(session,epoch,n,n!=0,std::numeric_limits<double>::quiet_NaN(),"",10,false);
    auto m=rife::readMetrics(session);
    assert(m.predictions==9&&m.pairs==1&&m.error.empty()&&!m.timingAvailable);
    for(int n=10;n<20;++n)rife::recordFrame(session,epoch,n,false,0,n==10?"":"cut",10,false);
    m=rife::readMetrics(session);
    assert(m.predictions==9&&m.pairs==2&&m.cuts==1);
    for(int n=20;n<30;++n)rife::recordFrame(session,epoch,n,false,0,n==20?"":"eof",10,false);
    m=rife::readMetrics(session);
    assert(m.predictions==9&&m.pairs==3&&m.cuts==1&&m.error.empty());
    const auto newer=rife::beginInstance(session);
    rife::recordFrame(session,epoch,31,true,1,"inference-error",10,false);
    assert(rife::readMetrics(session).predictions==0);
    rife::recordFrame(session,newer,1,true,std::numeric_limits<double>::quiet_NaN(),"");
    assert(rife::readMetrics(session).error=="inference-error"); // Mac timings remain checked.
    // With fractional output, source intervals finish on alternating output
    // indices. The last shortened output frame also completes its interval.
    const auto halfEpoch=rife::beginInstance(session);
    rife::recordFrame(session,halfEpoch,0,false,0,"",1.5,false);
    assert(rife::readMetrics(session).pairs==0);
    rife::recordFrame(session,halfEpoch,1,true,0,"",1.5,false);
    assert(rife::readMetrics(session).pairs==1);
    rife::recordFrame(session,halfEpoch,2,true,0,"",1.5,false);
    assert(rife::readMetrics(session).pairs==2);
    rife::recordFrame(session,halfEpoch,3,false,0,"",1.5,false);
    rife::recordFrame(session,halfEpoch,4,false,0,"eof",1.5,false);
    m=rife::readMetrics(session);assert(m.pairs==3&&m.predictions==2&&m.error.empty());
    const auto oddEpoch=rife::beginInstance(session);
    for(int n=0;n<8;++n){
        rife::recordFrame(session,oddEpoch,n,n==1||n==2,0,n>=5?"eof":n>=3?"cut":"",2.5,false);
        const uint64_t expectedPairs=n<2?0:n<4?1:n<7?2:3;
        assert(rife::readMetrics(session).pairs==expectedPairs);
    }
    m=rife::readMetrics(session);assert(m.pairs==3&&m.cuts==1&&m.predictions==2&&m.error.empty());
    rife::recordFrame(session,oddEpoch,7,true,0,"inference-error",2.5,false);
    rife::recordFrame(session,halfEpoch,9,true,0,"inference-error",1.5,false);
    m=rife::readMetrics(session);assert(m.pairs==3&&m.predictions==2&&m.error.empty());
    const auto singleEpoch=rife::beginInstance(session);
    for(int n=0;n<4;++n)rife::recordFrame(session,singleEpoch,n,false,0,"eof",3.5,false);
    m=rife::readMetrics(session);assert(m.pairs==1&&m.predictions==0&&m.cuts==0);
    for(double invalid:{0.,1.,1.25,2.25,15.5,std::numeric_limits<double>::quiet_NaN(),std::numeric_limits<double>::infinity()}){
        const auto invalidEpoch=rife::beginInstance(session);
        rife::recordFrame(session,invalidEpoch,9,true,0,"inference-error",invalid,false);
        m=rife::readMetrics(session);assert(m.pairs==0&&m.predictions==0&&m.error.empty());
        rife::recordFrame(session,invalidEpoch,1,true,0,"",1.5,false);
        m=rife::readMetrics(session);assert(m.pairs==1&&m.predictions==1&&m.error.empty());
    }
    rife::closeSession(session);
}
