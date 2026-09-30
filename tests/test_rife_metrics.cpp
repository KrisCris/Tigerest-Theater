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
    rife::closeSession(session);
}
