#ifdef NDEBUG
#undef NDEBUG
#endif
#include "interpolation/MpvPollAccess.h"
#include <QCoreApplication>
#include <cassert>

int main(int argc,char**argv) {
    QCoreApplication app(argc,argv);
    int syncCalls=0,asyncCalls=0;
    rife::MpvPollAccess access({
        [&](const QString&){++syncCalls;return QVariant("sync");},
        [&](const QString&,const QVariant&){++syncCalls;return true;},
        [&](const QStringList&){++syncCalls;return true;},
        [&](const QString&,const QVariant&){++asyncCalls;return true;},
        [&](const QStringList&){++asyncCalls;return true;}
    });
    const auto mpv=access.interface();
    assert(mpv.read("vf").toString()=="sync"&&syncCalls==1);
    access.observe("vf",QVariantList{QVariantMap{{"label","tigerest-rife"}}});
    {
        auto poll=access.enterPolling();
        assert(mpv.read("vf").toList().size()==1);
        assert(!mpv.read("missing").isValid());
        assert(mpv.set("hwdec",QStringLiteral("auto-copy")));
        assert(mpv.command({"vf","remove","@tigerest-rife"}));
        assert(mpv.read("hwdec").toString()=="auto-copy");
        assert(mpv.read("vf").toList().isEmpty());
        assert(syncCalls==1&&asyncCalls==2);
    }
    assert(mpv.read("vf").toString()=="sync"&&syncCalls==2);
    // Settings may request diagnostics outside polling while the native VO
    // thread is waiting for the UI thread. Reporting cached controller state
    // must not query or command the mpv core in either backend.
    for(const auto backend:{rife::Backend::CoreMLMetal,rife::Backend::TensorRT}){
        rife::RuntimePaths paths;paths.available=true;paths.backend=backend;
        paths.implementation=2;paths.alignment=1;
        rife::FrameInterpolationController controller(mpv,paths);
        access.observe("vf",QVariantList{});
        access.observe("video-sync","display-resample");
        {
            auto poll=access.enterPolling();
            controller.configureVideoSync("display-resample");
            controller.beginItem(true,false);
            controller.onFormatChanged({1920,1080,24,1,true,true,false,true});
        }
        const int readsBeforeDiagnostics=syncCalls;
        const auto preparing=controller.diagnostics();
        assert(syncCalls==readsBeforeDiagnostics);
        assert(preparing["effectiveSync"]==(backend==rife::Backend::TensorRT?"audio":"display-resample"));
        controller.stopOnEndFile();
        const auto stopped=controller.diagnostics();
        assert(syncCalls==readsBeforeDiagnostics);
        assert(stopped["effectiveSync"]=="display-resample");
        // Actual observations supersede accepted writes, including a rejected
        // asynchronous setting or an external script changing the option.
        controller.onVideoSyncChanged("display-tempo");
        assert(controller.diagnostics()["effectiveSync"]=="display-tempo");
        assert(syncCalls==readsBeforeDiagnostics);
    }
}
