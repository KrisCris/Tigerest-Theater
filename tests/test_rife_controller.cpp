#ifdef NDEBUG
#undef NDEBUG
#endif
#include "FrameInterpolationController.h"
#include "RifeSessionMetrics.h"
#include <QCoreApplication>
#include <cassert>
using namespace rife;
struct Fake {
    QVariantMap props{{"hwdec","auto-safe"},{"vf",QVariantList{QVariantMap{{"name","crop"},{"label","user"}}}}};
    QStringList removed; int adds=0,notices=0,forbiddenSyncCalls=0; bool failAdd=false,forbidSync=false;
    bool execute(const QStringList& args) {
        if(args[0]=="show-text"){++notices;return true;}
        auto filters=props["vf"].toList();
        if(args[1]=="add") {if(failAdd)return false;++adds;filters.append(QVariantMap{{"name","vapoursynth"},{"label","tigerest-rife"}});}
        if(args[1]=="remove") {removed<<args[2];for(qsizetype i=filters.size()-1;i>=0;--i)if(filters[i].toMap()["label"]=="tigerest-rife")filters.removeAt(i);}
        props["vf"]=filters;return true;
    }
    MpvAccess access() {return {
      [this](const QString& key){if(forbidSync){++forbiddenSyncCalls;return QVariant();}return props.value(key);},
      [this](const QString& key,const QVariant& value){if(forbidSync){++forbiddenSyncCalls;return false;}props[key]=value;return true;},
      [this](const QStringList& args){if(forbidSync){++forbiddenSyncCalls;return false;}return execute(args);},
      [this](const QString& key,const QVariant& value){props[key]=value;return true;},
      [this](const QStringList& args){return execute(args);}};}
};
int main(int argc,char**argv) {
    QCoreApplication app(argc,argv);
    RuntimePaths paths{"/tmp/模型 有空格/model","/tmp/插件.dylib","/tmp/script.vpy",true};
    SourceInfo source{1920,1080,24000,1001,true,true,false,true};
    Fake f;FrameInterpolationController c(f.access(),paths);
    c.beginItem(false,false);c.onFormatChanged(source);assert(c.state()==State::Off&&f.adds==0);
    c.beginItem(true,true);assert(c.state()==State::Bypassed&&f.props["hwdec"]=="auto-safe");
    c.beginItem(true,false);assert(c.state()==State::Preparing&&f.props["hwdec"]=="auto-copy");
    c.onFormatChanged(source);assert(f.adds==1&&c.state()==State::Preparing);
    const auto first=c.generation();
    Metrics m;m.epoch=1;m.predictions=40;m.pairs=40;m.p95Ms=10;
    c.onMetrics(first,m,0,false,0);assert(c.state()==State::Active);
    m.epoch=2;c.onMetrics(first,m,50,false,0); // graph can rebuild before the SEEK event arrives
    c.onSeek();assert(c.generation()>first);
    m.error="inference-error";c.onMetrics(first,m,100,false,0);
    assert(c.state()!=State::DisabledForCurrentItem); // reject stale results
    m.error.clear();c.onMetrics(c.generation(),m,200,false,0);assert(c.state()==State::Active);
    m.error="inference-error";c.onMetrics(c.generation(),m,300,false,0);
    assert(c.state()==State::DisabledForCurrentItem&&f.notices==2); // one per item
    assert(f.removed==QStringList{"@tigerest-rife"});
    assert(f.props["vf"].toList().size()==1&&f.props["hwdec"]=="auto-safe");
    c.onFormatChanged(source);assert(f.adds==1); // don't retry within item
    c.beginItem(true,false);c.onFormatChanged(source);f.props["hwdec"]="no";c.stop();
    assert(f.props["hwdec"]=="no"); // later user change survives
    c.beginItem(true,false);c.onFormatChanged(source);assert(f.props["hwdec"]=="no");
    auto hdr=source;hdr.hdr=true;c.onFormatChanged(hdr);
    assert(c.state()==State::Bypassed&&f.props["vf"].toList().size()==1);
    c.stop();f.props["vf"]=QVariantList{QVariantMap{{"name","vapoursynth"},{"label","svp"}}};
    c.beginItem(true,false);c.onFormatChanged(source);assert(c.state()==State::Bypassed);
    assert(f.props["vf"].toList().size()==1);
    Fake fail;fail.failAdd=true;FrameInterpolationController bad(fail.access(),paths);
    bad.beginItem(true,false);bad.onFormatChanged(source);
    assert(bad.state()==State::DisabledForCurrentItem&&fail.props["hwdec"]=="auto-safe");
    Fake settings;FrameInterpolationController configured(settings.access(),paths);
    configured.beginItem(true,false);configured.onFormatChanged(source);
    configured.configureHardwareDecoding("no");
    assert(settings.props["hwdec"]=="no"&&!configured.ownsDecoding());
    configured.configureHardwareDecoding("auto");
    assert(settings.props["hwdec"]=="auto-copy"&&configured.ownsDecoding());
    configured.configureHardwareDecoding("auto"); // routine settings refresh
    configured.stop();assert(settings.props["hwdec"]=="auto");
    configured.beginItem(true,false);configured.onFormatChanged(source);
    configured.configureHardwareDecoding("auto-safe");
    configured.beginItem(false,false); // next load applies settings before detach
    assert(settings.props["hwdec"]=="auto-safe");
    configured.beginItem(true,false);configured.onFormatChanged(source);
    Metrics openingCut;openingCut.epoch=9;openingCut.pairs=1;openingCut.cuts=1;
    configured.onMetrics(configured.generation(),openingCut,0,true,0);
    assert(configured.state()==State::Active); // a cut must not stall paused prefetch
    // The shared native registry rejects results from old plugin instances.
    const auto session=openSession();const auto old=beginInstance(session);
    recordFrame(session,old,1,true,10,"");assert(readMetrics(session).predictions==1);
    const auto current=beginInstance(session);
    recordFrame(session,old,3,true,99,"inference-error");
    recordFrame(session,current,1,true,12,"");recordFrame(session,current,1,true,12,"");
    auto result=readMetrics(session);assert(result.predictions==1&&result.error.empty());
    closeSession(session);recordFrame(session,current,3,true,10,"");assert(!readMetrics(session).epoch);
    Fake list;list.props["hwdec"]=QVariantList{"auto-safe"};FrameInterpolationController listController(list.access(),paths);
    listController.beginItem(true,false);assert(list.props["hwdec"]=="auto-copy");
    listController.stop();assert(list.props["hwdec"]=="auto-safe");
    Fake slow;FrameInterpolationController slowController(slow.access(),paths);
    slowController.beginItem(true,false);slowController.onFormatChanged(source);
    Metrics slowMetrics;slowMetrics.epoch=20;slowMetrics.predictions=slowMetrics.pairs=30;slowMetrics.p95Ms=70;
    slowController.onMetrics(slowController.generation(),slowMetrics,0,false,0);
    slowMetrics.predictions=slowMetrics.pairs=60;
    slowController.onMetrics(slowController.generation(),slowMetrics,3000,false,1);
    assert(slowController.state()==State::Active);
    slowMetrics.predictions=slowMetrics.pairs=90;
    slowController.onMetrics(slowController.generation(),slowMetrics,6000,false,2);
    assert(slowController.state()==State::DisabledForCurrentItem&&slow.notices==1);
    Fake ending;FrameInterpolationController endingController(ending.access(),paths);
    endingController.beginItem(true,false);endingController.onFormatChanged(source);
    assert(ending.props["hwdec"]=="auto-copy"&&ending.props["vf"].toList().size()==2);
    ending.forbidSync=true; // Native macvk teardown may be waiting for this Qt thread.
    endingController.stopOnEndFile();
    assert(ending.forbiddenSyncCalls==0&&endingController.state()==State::Off);
    assert(ending.props["hwdec"]=="auto-safe");
    assert(ending.props["vf"].toList().size()==1&&ending.removed==QStringList{"@tigerest-rife"});
    endingController.stopOnEndFile(); // Duplicate END_FILE must not touch mpv again.
    assert(ending.forbiddenSyncCalls==0&&ending.removed.size()==1);
    ending.forbidSync=false;
    endingController.beginItem(true,false);endingController.onFormatChanged(source);
    assert(endingController.state()==State::Preparing&&ending.adds==2);
    auto goodParams=QVariantMap{{"w",1920},{"h",1080},{"gamma","bt.1886"},{"primaries","bt.709"},{"colormatrix","bt.709"},{"colorlevels","limited"}};
    assert(qualify(sourceInfo(goodParams,{{"interlaced",false}},23.976023976)).enabled);
    assert(qualify(sourceInfo(goodParams,{{"interlaced",false}},60)).reason=="unsupported-fps");
    goodParams["gamma"]="pq";assert(sourceInfo(goodParams,{{"interlaced",false}},24).hdr);
}
