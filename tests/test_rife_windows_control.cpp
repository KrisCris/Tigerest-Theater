#ifdef NDEBUG
#undef NDEBUG
#endif
#include "FrameInterpolationController.h"
#include <QCoreApplication>
#include <QJsonDocument>
#include <cassert>
#include <cmath>
using namespace rife;
int main(int argc,char**argv){
    QCoreApplication app(argc,argv);
    const SourceLimits windows{3840,2160,60.001};
    SourceInfo source{3840,2160,60000,1001,true,true,false,true};
    assert(qualify(source,windows).enabled);
    assert(!qualify(source).enabled); // Mac's original limits still apply.
    auto bad=source;bad.width=4096;assert(!qualify(bad,windows).enabled);
    bad=source;bad.fpsNum=120000;assert(!qualify(bad,windows).enabled);
    assert(rationalFrameRate(59.94005994).num==60000);
    assert(integerMultiplier({24000,1001},120)==5);
    assert(integerMultiplier({24000,1001},240)==10);
    assert(integerMultiplier({30,1},240)==8);
    assert(integerMultiplier({60000,1001},120)==2);
    assert(integerMultiplier({24,1},60)==2); // Equal distances: use the lower integer.
    assert(integerMultiplier({0,1},240)==0);
    assert(integerMultiplier({24,1},0)==0);
    PerformanceGuard guard(GuardParameters::windows());
    assert(!guard.update(0,90,10,0,0,24,false,10,false,0.));
    assert(!guard.update(5000,1170,130,0,0,24,false,10,false,0.));
    assert(!guard.update(14999,3330,370,0,130,24,false,10,false,0.));
    assert(guard.update(15000,3330,370,0,130,24,false,10,false,0.)); // 130/2400 > 5%.
    guard.reset();
    assert(!guard.update(0,90,10,0,0,24,false,10,false,0.));
    assert(!guard.update(5000,1170,130,0,0,24,false,10,false,.12));
    for(int now=5250;now<15000;now+=250)assert(!guard.update(now,3330,370,0,0,24,false,10,false,.12));
    assert(guard.update(15000,3330,370,0,0,24,false,10,false,.12));
    guard.reset();
    assert(!guard.update(0,90,10,0,0,24,false,10,false,.12));
    assert(!guard.update(5000,1170,130,0,0,24,false,10,false,.12));
    assert(!guard.update(10000,2250,250,0,0,24,true,10,false,.12));
    assert(!guard.update(15000,3330,370,0,0,24,false,10,false,.12));
    assert(!guard.update(20000,4410,490,0,0,24,false,10,false,0.));
    assert(!guard.update(30000,6570,730,0,0,24,false,10,false,0.));
    for(const auto& counts: {std::pair<uint64_t,uint64_t>{0,12},{0,13},{8,12},{120,0},{121,0}}){
        guard.reset();
        assert(!guard.update(0,90,10,0,0,24,false,10,false,0.,0));
        assert(!guard.update(5000,1170,130,0,0,24,false,10,false,0.,0));
        const bool shouldDisable=(double(counts.first)+double(counts.second)*10)/(2400+double(counts.second)*10)>.05;
        assert(guard.update(15000,3330,370,0,counts.first,24,false,10,false,0.,counts.second)==shouldDisable);
    }
    QVariantMap properties{{"vf",QVariantList{}},{"hwdec","auto"}};
    QString lastFilter;
    int adds=0;
    auto command=[&](const QStringList& args){
        if(args[0]=="vf"&&args[1]=="add"){
            ++adds;lastFilter=args[2];
            properties["vf"]=QVariantList{QVariantMap{{"label","tigerest-rife"},{"name","vapoursynth"}}};
        }else if(args[0]=="vf"&&args[1]=="remove")properties["vf"]=QVariantList{};
        return true;
    };
    MpvAccess access{[&](const QString&k){return properties.value(k);},
        [&](const QString&k,const QVariant&v){properties[k]=v;return true;},command,
        [&](const QString&k,const QVariant&v){properties[k]=v;return true;},command};
    RuntimePaths paths{"rife-4.25-lite","C:/插件/tigerest-rife-vs.dll","C:/脚本/interpolate_trt.vpy",true};
    paths.backend=Backend::TensorRT;paths.factor=2;paths.alignment=1;paths.implementation=2;
    paths.engine="C:/缓存/model.engine";paths.runtime="C:/私有 运行库";paths.trtPlugin="C:/私有 运行库/plugins/vstrt.dll";
    FrameInterpolationController controller(access,paths);
    controller.beginItem(true,false);controller.onFormatChanged(source);
    assert(!controller.diagnostics()["p95Ms"].isValid()); // No epoch is not zero-cost GPU timing.
    Metrics starting;starting.epoch=1; // Monitor is registered, but no frame has arrived.
    controller.onMetrics(controller.generation(),starting,0,false,0);
    assert(!controller.diagnostics()["timingAvailable"].toBool());
    assert(!controller.diagnostics()["p95Ms"].isValid());
    assert(adds==1&&lastFilter.contains("engine_path")&&lastFilter.contains("runtime_path"));
    assert(!controller.setRuntimePaths(paths)); // Loaded graph owns its current runtime.
    Metrics metrics;metrics.epoch=1;metrics.pairs=40;metrics.predictions=40;metrics.timingAvailable=false;
    controller.onMetrics(controller.generation(),metrics,0,false,0);
    assert(controller.state()==State::Active);
    assert(controller.status().contains("119.88"));
    const auto diagnostic=controller.diagnostics();
    assert(!diagnostic["timingAvailable"].toBool());
    assert(!diagnostic["p95Ms"].isValid());
    assert(diagnostic["pipeline"].toString()=="TensorRT");
    bad=source;bad.width=1920;bad.height=1080;
    controller.onFormatChanged(bad);
    assert(controller.state()==State::Bypassed&&adds==1); // Do not rebuild a changing-format item.
    controller.stop();paths.engine.clear();assert(controller.setRuntimePaths(paths));
    controller.beginItem(true,false);controller.onFormatChanged(source);
    assert(adds==1&&controller.diagnostics()["reason"]=="engine-preparing");
}
