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
}
