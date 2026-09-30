#ifdef NDEBUG
#undef NDEBUG
#endif
#include "InterpolationPolicy.h"
#include <cassert>
#include <cmath>
int main() {
    rife::StartupGate startup;
    startup.begin(true,false,100); // autoplay waits for the first generated frame
    assert(startup.waiting()&&startup.waitingToPlay()&&!startup.expired(15099));
    assert(startup.expired(15100));
    assert(startup.finish());assert(!startup.finish()); // resume only once
    startup.begin(true,true,200);assert(!startup.waitingToPlay()&&!startup.finish()); // explicit paused load
    startup.begin(true,false,300);startup.requestPause(true);assert(!startup.finish());
    startup.begin(true,true,400);assert(startup.requestPause(false));assert(startup.finish());
    startup.begin(true,false,500);startup.cancel();assert(!startup.finish()); // stop/replace
    startup.begin(false,false,600);assert(!startup.waiting()&&!startup.requestPause(false));
    startup.begin(true,false,700);
    startup.togglePause();assert(startup.waiting()&&!startup.waitingToPlay());
    startup.togglePause();assert(startup.waitingToPlay());
    startup.togglePause();assert(!startup.finish());
    startup.begin(true,true,800);startup.togglePause();assert(startup.finish());
    rife::SourceInfo s{1920,1080,30000,1001,true,true,false,true};
    assert(rife::qualify(s).enabled);
    for (int kind=0;kind<7;++kind) {
        auto bad=s;
        switch(kind) {
        case 0:bad.width=3840;break;case 1:bad.fpsNum=60000;break;
        case 2:bad.progressive=false;break;case 3:bad.cfr=false;break;
        case 4:bad.hdr=true;break;case 5:bad.colorKnown=false;break;
        case 6:bad.fpsDen=0;break;
        }
        assert(!rife::qualify(bad).enabled);
    }
    assert(rife::rationalFrameRate(23.976023976).num==24000);
    assert(rife::rationalFrameRate(29.97002997).den==1001);
    assert(!rife::rationalFrameRate(NAN).num);
    rife::PerformanceGuard guard;
    // Thirty calls warm up; two uninterrupted slow windows are required.
    assert(!guard.update(0,30,30,50,0,30,false));
    assert(!guard.update(3000,70,70,50,1,30,false));
    assert(guard.update(6000,110,110,50,2,30,false));
    guard.reset();
    assert(!guard.update(0,30,30,50,0,30,false));
    assert(!guard.update(3000,70,70,50,1,30,false));
    assert(!guard.update(6000,70,70,50,1,30,true)); // pause/buffer/seek clears the streak
    assert(!guard.update(9000,110,110,50,2,30,false));
    assert(!guard.update(12000,150,150,50,3,30,false));
    assert(guard.update(15000,190,190,50,4,30,false));
    guard.reset();
    assert(!guard.update(0,30,30,10,0,30,false));
    assert(!guard.update(3000,70,70,10,0,30,false));
    assert(!guard.update(6000,110,110,10,0,30,false)); // low delivery alone is not inference blame
    guard.reset();
    assert(!guard.update(0,30,30,50,0,30,false));
    assert(!guard.update(3000,120,120,50,0,30,false));
    assert(!guard.update(6000,210,210,50,0,30,false)); // maintained throughput, no fallback
    guard.reset();
    assert(!guard.update(0,30,30,10,0,30,false));
    assert(!guard.update(3000,120,120,10,30,30,false));
    assert(guard.update(6000,210,210,10,60,30,false)); // renderer loses output despite fast model

}
