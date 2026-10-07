#ifdef NDEBUG
#undef NDEBUG
#endif
#include "FrameInterpolationController.h"
#include "MpvPollAccess.h"
#include "RifeSessionMetrics.h"
#include <QCoreApplication>
#include <cassert>
using namespace rife;
struct Fake {
    QVariantMap props{{"hwdec","auto-safe"},{"vf",QVariantList{QVariantMap{{"name","crop"},{"label","user"}}}}};
    QString rejectedSync;
    bool rejectClockOwnership=false;
    QList<QPair<QString,QVariant>> writes;
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
      [this](const QString& key,const QVariant& value){if(forbidSync){++forbiddenSyncCalls;return false;}if(key=="video-sync"&&value.toString()==rejectedSync)return false;if(rejectClockOwnership&&key=="user-data/tigerest/rife-clock-owned"&&value.toBool())return false;writes.append({key,value});props[key]=value;return true;},
      [this](const QStringList& args){if(forbidSync){++forbiddenSyncCalls;return false;}return execute(args);},
      [this](const QString& key,const QVariant& value){writes.append({key,value});props[key]=value;return true;},
      [this](const QStringList& args){return execute(args);}};}
};
// Delays actual mpv execution: accepted async requests do not mutate properties.
struct AsyncClockFake : Fake {
    struct Request {QString key;QVariant value;int id=0;bool read=false;};
    QList<Request> pending;
    MpvAccess access() {
        auto result=Fake::access();
        const auto write=result.set;
        result.set=[this,write](const QString& key,const QVariant& value){
            if(key=="video-sync"||key=="user-data/tigerest/rife-clock-owned"){
                pending.append({key,value,0,false});return true;
            }
            return write(key,value);
        };
        const auto asyncWrite=result.setAsync;
        result.setAsync=[this,asyncWrite](const QString& key,const QVariant& value){
            if(key=="video-sync"||key=="user-data/tigerest/rife-clock-owned"){
                pending.append({key,value,0,false});return true;
            }
            return asyncWrite(key,value);
        };
        result.setAsyncTagged=[this](const QString& key,const QVariant& value,int id){
            pending.append({key,value,id,false});return true;
        };
        result.getAsyncTagged=[this](const QString& key,int id){pending.append({key,{},id,true});return true;};
        result.asyncPropertyReplies=true;
        return result;
    }
    Request complete(FrameInterpolationController& controller,int error=0){
        assert(pending.size()==1);
        const auto request=pending.takeFirst();
        if(request.read)controller.onClockReadReply(request.id,error,props.value(request.key));
        else {
            if(error>=0)props[request.key]=request.value;
            controller.onClockSetReply(request.id,error);
        }
        return request;
    }
    void drain(FrameInterpolationController& controller){
        for(int i=0;!pending.isEmpty();++i){assert(i<20);complete(controller);}
    }
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
    assert(slowController.state()==State::Active&&slow.notices==1);
    assert(slowController.ownsFilter()&&slow.removed.isEmpty());
    assert(slow.props["hwdec"]=="auto-copy");
    assert(slowController.diagnostics()["performanceWarning"].toBool());
    slowMetrics.predictions=slowMetrics.pairs=120;
    slowController.onMetrics(slowController.generation(),slowMetrics,9000,false,5);
    assert(slowController.state()==State::Active&&slow.notices==1); // no OSD spam
    slowMetrics.error="inference-error";
    slowController.onMetrics(slowController.generation(),slowMetrics,10000,false,5);
    assert(slowController.state()==State::DisabledForCurrentItem&&slow.notices==2); // real faults still stop
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
    auto windowsPaths=paths;windowsPaths.backend=Backend::TensorRT;windowsPaths.engine="prepared.engine";
    AsyncClockFake delayed;delayed.props["video-sync"]="display-resample";
    FrameInterpolationController delayedController(delayed.access(),windowsPaths);
    delayedController.beginItem(true,false);delayedController.onFormatChanged(source);
    assert(delayed.pending.size()==1); // Clock write must await marker SET_PROPERTY_REPLY.
    assert(delayed.pending.first().key=="user-data/tigerest/rife-clock-owned");
    assert(delayed.pending.first().id!=0&&delayed.adds==1);
    const QString asyncMarker="user-data/tigerest/rife-clock-owned";
    delayed.complete(delayedController); // Marker actually took effect.
    assert(delayed.props[asyncMarker].toBool()&&delayed.pending.first().read);
    delayed.complete(delayedController); // Read current preference before the override.
    assert(delayed.pending.first().key=="video-sync"&&delayed.pending.first().value=="audio");
    assert(delayed.props["video-sync"]=="display-resample"&&delayed.adds==1);
    delayed.complete(delayedController); // No PROPERTY_CHANGE notification is required.
    assert(delayed.pending.first().read);
    delayed.complete(delayedController);
    assert(delayed.pending.isEmpty()&&delayed.props["video-sync"]=="audio");
    delayedController.onFormatChanged(source);assert(delayed.adds==1);
    delayedController.configureVideoSync("display-resample"); // Settings refresh preserves the override.
    delayed.drain(delayedController);
    assert(delayed.props["video-sync"]=="audio"&&delayedController.diagnostics()["ownsVideoSync"].toBool());
    delayed.forbidSync=true;
    delayedController.stopOnEndFile();
    assert(delayed.pending.first().read&&delayed.props[asyncMarker].toBool());
    delayed.complete(delayedController); // Confirm ownership, then request restore.
    assert(delayed.pending.first().value=="display-resample");
    assert(delayed.props[asyncMarker].toBool());
    delayed.complete(delayedController); // Only its reply may release the marker.
    assert(delayed.props["video-sync"]=="display-resample"&&delayed.props[asyncMarker].toBool());
    assert(delayed.pending.first().key==asyncMarker&&!delayed.pending.first().value.toBool());
    delayed.complete(delayedController);
    assert(!delayed.props[asyncMarker].toBool()&&delayed.forbiddenSyncCalls==0);

    // IPC can restore the previously observed value while our write is pending;
    // mpv may coalesce the intermediate value and emit no additional notification.
    AsyncClockFake takeover;takeover.props["video-sync"]="display-resample";
    FrameInterpolationController takeoverController(takeover.access(),windowsPaths);
    takeoverController.beginItem(true,false);takeoverController.onFormatChanged(source);
    takeover.complete(takeoverController);takeover.complete(takeoverController);
    takeover.complete(takeoverController); // audio completed; read-back is now pending.
    takeover.props["video-sync"]="display-resample"; // External IPC writes the old observed value.
    takeoverController.onVideoSyncChanged("display-resample");
    takeover.forbidSync=true;takeoverController.stopOnEndFile();
    takeover.drain(takeoverController);
    assert(takeover.props["video-sync"]=="display-resample"&&!takeover.props[asyncMarker].toBool());
    assert(!takeoverController.diagnostics()["ownsVideoSync"].toBool()&&takeover.forbiddenSyncCalls==0);

    AsyncClockFake initialTakeover;initialTakeover.props["video-sync"]="display-resample";
    FrameInterpolationController initialTakeoverController(initialTakeover.access(),windowsPaths);
    initialTakeoverController.beginItem(true,false);initialTakeoverController.onFormatChanged(source);
    initialTakeover.complete(initialTakeoverController);initialTakeover.complete(initialTakeoverController);
    initialTakeover.complete(initialTakeoverController); // Initial audio write completed, read-back still pending.
    initialTakeover.props["video-sync"]="display-resample"; // IPC returns to the previously observed value.
    initialTakeover.drain(initialTakeoverController);
    initialTakeoverController.onFormatChanged(source);
    assert(initialTakeover.pending.isEmpty()&&initialTakeover.adds==1);
    assert(initialTakeover.props["video-sync"]=="display-resample"&&!initialTakeover.props[asyncMarker].toBool());
    initialTakeoverController.stopOnEndFile();assert(initialTakeover.pending.isEmpty());

    // A new load cannot attach while an old clock request still has effects pending.
    AsyncClockFake replacement;replacement.props["video-sync"]="display-resample";
    FrameInterpolationController replacementController(replacement.access(),windowsPaths);
    replacementController.beginItem(true,false);replacementController.onFormatChanged(source);
    const auto staleAcquire=replacement.pending.first().id;
    replacementController.stopOnEndFile();replacementController.beginItem(true,false);
    replacementController.onFormatChanged(source);assert(replacement.adds==1);
    replacement.drain(replacementController);
    assert(!replacement.props[asyncMarker].toBool()&&replacement.props["video-sync"]=="display-resample");
    replacementController.onFormatChanged(source);
    assert(replacement.pending.first().id!=staleAcquire);
    replacementController.onClockSetReply(staleAcquire,0); // A duplicate old reply cannot advance the new transaction.
    assert(replacement.pending.size()==1&&replacement.pending.first().key==asyncMarker);
    replacement.drain(replacementController);replacementController.onFormatChanged(source);
    assert(replacement.adds==2&&replacement.props["video-sync"]=="audio");
    replacementController.stopOnEndFile();replacement.drain(replacementController);

    // Submission can succeed but execution fail. Marker/clock failures remove
    // the graph; cleanup failures retain the transaction and retry.
    for(int failingStep:{0,1,2,3}){
        AsyncClockFake failure;failure.props["video-sync"]="display-resample";
        FrameInterpolationController failureController(failure.access(),windowsPaths);
        failureController.beginItem(true,false);failureController.onFormatChanged(source);
        for(int step=0;step<failingStep;++step)failure.complete(failureController);
        failure.complete(failureController,-1);
        if(failingStep==3){
            assert(failure.props[asyncMarker].toBool()&&failureController.diagnostics()["clockCleanupFailed"].toBool());
            failureController.serviceClock();
        }
        failure.drain(failureController);
        assert(failure.adds==1&&failureController.state()==State::DisabledForCurrentItem&&!failureController.ownsFilter());
        assert(!failure.props[asyncMarker].toBool()&&!failureController.diagnostics()["ownsVideoSync"].toBool());
    }
    AsyncClockFake releaseFailure;releaseFailure.props["video-sync"]="display-resample";
    FrameInterpolationController releaseFailureController(releaseFailure.access(),windowsPaths);
    releaseFailureController.beginItem(true,false);releaseFailureController.onFormatChanged(source);
    releaseFailure.drain(releaseFailureController);releaseFailureController.onFormatChanged(source);
    releaseFailureController.stopOnEndFile();releaseFailure.complete(releaseFailureController);
    releaseFailure.complete(releaseFailureController); // Restoration acknowledged.
    releaseFailure.complete(releaseFailureController,-1);
    assert(releaseFailure.props[asyncMarker].toBool()&&releaseFailureController.diagnostics()["clockCleanupFailed"].toBool());
    releaseFailureController.serviceClock();releaseFailure.drain(releaseFailureController);
    assert(!releaseFailure.props[asyncMarker].toBool()&&!releaseFailureController.diagnostics()["clockCleanupFailed"].toBool());
    // A rejected restore remains a live transaction until the user's clock is
    // restored, or a later read confirms that an external writer took over.
    for(bool externalDuringRetry:{false,true}){
        AsyncClockFake restoreFailure;restoreFailure.props["video-sync"]="display-resample";
        FrameInterpolationController restoreController(restoreFailure.access(),windowsPaths);
        restoreController.beginItem(true,false);restoreController.onFormatChanged(source);
        restoreFailure.drain(restoreController);restoreController.onFormatChanged(source);
        restoreFailure.forbidSync=true;
        restoreController.stopOnEndFile();restoreFailure.complete(restoreController); // Read current owned audio.
        restoreFailure.complete(restoreController,-1); // Restore submission succeeded, execution failed.
        assert(restoreFailure.pending.isEmpty()&&restoreFailure.props[asyncMarker].toBool());
        assert(restoreFailure.props["video-sync"]=="audio"&&restoreController.diagnostics()["clockCleanupFailed"].toBool());
        if(externalDuringRetry)restoreFailure.props["video-sync"]="display-desync";
        restoreController.serviceClock();assert(restoreFailure.pending.first().read);
        restoreFailure.drain(restoreController);
        assert(restoreFailure.props["video-sync"]==(externalDuringRetry?"display-desync":"display-resample"));
        assert(!restoreFailure.props[asyncMarker].toBool()&&restoreFailure.forbiddenSyncCalls==0);
    }
    AsyncClockFake releaseSettings;releaseSettings.props["video-sync"]="display-resample";
    FrameInterpolationController releaseSettingsController(releaseSettings.access(),windowsPaths);
    releaseSettingsController.beginItem(true,false);releaseSettingsController.onFormatChanged(source);
    releaseSettings.drain(releaseSettingsController);releaseSettingsController.onFormatChanged(source);
    releaseSettingsController.configureVideoSync("display-desync");
    releaseSettings.complete(releaseSettingsController);releaseSettings.complete(releaseSettingsController);
    assert(releaseSettings.pending.first().key==asyncMarker&&!releaseSettings.pending.first().value.toBool());
    releaseSettingsController.configureVideoSync("display-resample-vdrop");
    releaseSettings.complete(releaseSettingsController,-1); // A release retry must retain the newer intent too.
    releaseSettingsController.serviceClock();
    releaseSettings.drain(releaseSettingsController);
    assert(releaseSettings.props["video-sync"]=="display-resample-vdrop"&&!releaseSettings.props[asyncMarker].toBool());
    releaseSettingsController.stopOnEndFile();assert(releaseSettings.pending.isEmpty());
    Fake fallback;MpvPollAccess fallbackAccess(fallback.access());
    const auto fallbackInterface=fallbackAccess.interface();
    assert(!fallbackInterface.asyncPropertyReplies);
    assert(fallbackInterface.setAsyncTagged); // Startup callers require the existing untagged fallback.
    assert(fallbackInterface.setAsyncTagged("pause",false,100));
    assert(fallback.props["pause"]==false);
    Fake windowsEnding;windowsEnding.props["video-sync"]="display-resample";
    FrameInterpolationController windowsController(windowsEnding.access(),windowsPaths);
    windowsController.beginItem(true,false);windowsController.onFormatChanged(source);
    assert(windowsEnding.props["video-sync"]=="audio");
    assert(windowsEnding.props["user-data/tigerest/rife-clock-owned"].toBool());
    windowsController.onVideoSyncChanged("display-resample"); // Stale notification before override acknowledgment.
    windowsEnding.forbidSync=true;
    windowsController.stopOnEndFile();
    assert(windowsEnding.forbiddenSyncCalls==0&&windowsEnding.props["video-sync"]=="display-resample");
    assert(!windowsController.diagnostics()["ownsVideoSync"].toBool());
    assert(!windowsEnding.props["user-data/tigerest/rife-clock-owned"].toBool());
    windowsEnding.props["video-sync"]="audio";
    windowsController.stopOnEndFile();assert(windowsEnding.props["video-sync"]=="audio");
    windowsEnding.forbidSync=false;
    windowsController.configureVideoSync("display-resample");
    windowsController.beginItem(true,false);windowsController.onFormatChanged(source);
    assert(windowsEnding.props["video-sync"]=="audio");
    assert(windowsEnding.props["user-data/tigerest/rife-clock-owned"].toBool());
    windowsController.stop();assert(windowsEnding.props["video-sync"]=="display-resample");
    Fake windowsFail;windowsFail.props["video-sync"]="display-resample";windowsFail.failAdd=true;
    FrameInterpolationController failedWindowsController(windowsFail.access(),windowsPaths);
    failedWindowsController.beginItem(true,false);failedWindowsController.onFormatChanged(source);
    assert(failedWindowsController.state()==State::DisabledForCurrentItem);
    assert(windowsFail.props["video-sync"]=="display-resample");
    assert(!failedWindowsController.diagnostics()["ownsVideoSync"].toBool());
    Fake rejected;rejected.props["video-sync"]="display-resample";rejected.rejectedSync="audio";
    FrameInterpolationController rejectedController(rejected.access(),windowsPaths);
    rejectedController.beginItem(true,false);rejectedController.onFormatChanged(source);
    assert(rejectedController.state()==State::DisabledForCurrentItem&&rejected.adds==0);
    assert(rejected.props["video-sync"]=="display-resample"&&!rejectedController.diagnostics()["ownsVideoSync"].toBool());
    Fake windowsPolling;windowsPolling.props["video-sync"]="display-resample";
    MpvPollAccess windowsPollingAccess(windowsPolling.access());
    FrameInterpolationController polledWindowsController(windowsPollingAccess.interface(),windowsPaths);
    polledWindowsController.beginItem(true,false);
    windowsPollingAccess.observe("vf",windowsPolling.props["vf"]);
    windowsPollingAccess.observe("hwdec",windowsPolling.props["hwdec"]);
    windowsPollingAccess.observe("video-sync",windowsPolling.props["video-sync"]);
    windowsPolling.forbidSync=true;
    {
        auto poll=windowsPollingAccess.enterPolling();
        polledWindowsController.onFormatChanged(source);
        assert(windowsPolling.props["video-sync"]=="audio");
        windowsPollingAccess.observe("video-sync","display-resample");
        polledWindowsController.onVideoSyncChanged("display-resample");
        windowsPollingAccess.observe("video-sync","audio");
        polledWindowsController.onVideoSyncChanged("audio");
        assert(windowsPolling.props["video-sync"]=="audio");
        polledWindowsController.bypassCurrentItem("playback-speed");
    }
    assert(windowsPolling.forbiddenSyncCalls==0&&windowsPolling.props["video-sync"]=="display-resample");
    // The clock marker must fence Lua before changing audio/display timing.
    const QString clockMarker="user-data/tigerest/rife-clock-owned";
    Fake presentation;presentation.props["video-sync"]="display-resample";
    FrameInterpolationController presentationController(presentation.access(),windowsPaths);
    presentationController.beginItem(true,false);presentationController.onFormatChanged(source);
    assert(presentation.props["video-sync"]=="audio"&&presentation.props[clockMarker].toBool());
    assert(presentation.writes[1].first==clockMarker&&presentation.writes[1].second.toBool());
    assert(presentation.writes[2].first=="video-sync"&&presentation.writes[2].second=="audio");
    presentationController.onVideoSyncChanged("audio");
    presentationController.onSeek();
    assert(presentation.props["video-sync"]=="audio"&&presentationController.ownsFilter());
    presentationController.configureVideoSync("display-resample");
    assert(presentation.props["video-sync"]=="audio");
    presentationController.stop();
    assert(presentation.props["video-sync"]=="display-resample"&&!presentation.props[clockMarker].toBool());
    assert(presentation.writes[presentation.writes.size()-2].first=="video-sync");
    assert(presentation.writes.last().first==clockMarker&&!presentation.writes.last().second.toBool());

    // Reloading preserves the configured preference; an external mode survives stop.
    presentationController.beginItem(true,false);presentationController.onFormatChanged(source);
    assert(presentation.props["video-sync"]=="audio");
    presentationController.beginItem(true,false);presentationController.onFormatChanged(source);
    assert(presentation.props["video-sync"]=="audio");
    presentationController.onVideoSyncChanged("audio");
    presentation.props["video-sync"]="display-vdrop";
    presentationController.onVideoSyncChanged("display-vdrop");
    assert(!presentationController.diagnostics()["ownsVideoSync"].toBool());
    assert(!presentation.props[clockMarker].toBool());
    presentationController.onVideoSyncChanged("audio"); // A late own notification cannot reclaim ownership.
    presentationController.stop();assert(presentation.props["video-sync"]=="display-vdrop");

    presentationController.configureVideoSync("display-resample");
    presentationController.beginItem(true,false);presentationController.onFormatChanged(source);
    presentationController.configureVideoSync("audio"); // Explicit preference, despite matching a policy value.
    assert(!presentation.props[clockMarker].toBool());
    presentationController.stopOnEndFile();assert(presentation.props["video-sync"]=="audio");
    Fake markerFailure;markerFailure.props["video-sync"]="display-resample";markerFailure.rejectClockOwnership=true;
    FrameInterpolationController markerFailureController(markerFailure.access(),windowsPaths);
    markerFailureController.beginItem(true,false);markerFailureController.onFormatChanged(source);
    assert(markerFailure.adds==0&&markerFailureController.state()==State::DisabledForCurrentItem);
    assert(markerFailure.props["video-sync"]=="display-resample"&&!markerFailure.props[clockMarker].toBool());
    assert(!windowsFail.props[clockMarker].toBool()&&!rejected.props[clockMarker].toBool());
    Fake timed;
    MpvPollAccess timedAccess(timed.access());
    FrameInterpolationController timedController(timedAccess.interface(),paths);
    timedController.beginItem(true,false);
    timedAccess.observe("vf",timed.props["vf"]);
    timedAccess.observe("hwdec",timed.props["hwdec"]);
    timed.forbidSync=true; // macvk may already be waiting for Cocoa during STOP.
    {
        auto poll=timedAccess.enterPolling();
        timedController.onFormatChanged(source);
        timedController.poll(0,false);
    }
    assert(timed.forbiddenSyncCalls==0&&timed.adds==1);
    auto goodParams=QVariantMap{{"w",1920},{"h",1080},{"gamma","bt.1886"},{"primaries","bt.709"},{"colormatrix","bt.709"},{"colorlevels","limited"}};
    assert(qualify(sourceInfo(goodParams,{{"interlaced",false}},23.976023976)).enabled);
    assert(qualify(sourceInfo(goodParams,{{"interlaced",false}},60)).reason=="unsupported-fps");
    goodParams["gamma"]="pq";assert(sourceInfo(goodParams,{{"interlaced",false}},24).hdr);
}
