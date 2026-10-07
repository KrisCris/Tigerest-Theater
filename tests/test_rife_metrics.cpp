#ifdef NDEBUG
#undef NDEBUG
#endif
#include "RifeSessionMetrics.h"
#include <cassert>
#include <limits>

int main() {
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
