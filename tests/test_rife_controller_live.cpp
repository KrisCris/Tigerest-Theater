#ifdef NDEBUG
#undef NDEBUG
#endif
#include "FrameInterpolationController.h"
#include "QtHelper.h"
#include <QCoreApplication>
#include <QElapsedTimer>
#include <QThread>
#include <QDebug>
#include <cassert>
using namespace rife;
int main(int argc,char** argv){
    QCoreApplication app(argc,argv);assert(argc==5||argc==6);
    auto* mpv=mpv_create();assert(mpv);
    mpv_set_option_string(mpv,"config","no");mpv_set_option_string(mpv,"vo","null");
    mpv_set_option_string(mpv,"ao","null");mpv_set_option_string(mpv,"idle","yes");
    mpv_set_option_string(mpv,"hwdec","auto-safe");
    mpv_set_option_string(mpv,"msg-level","all=warn");
    assert(mpv_initialize(mpv)>=0);mpv_request_log_messages(mpv,"warn");
    auto read=[&](const QString& key){return mpv::qt::get_property(mpv,key);};
    auto set=[&](const QString& key,const QVariant& v){return mpv::qt::set_property(mpv,key,v)>=0;};
    auto command=[&](const QStringList& arguments){
        QList<QByteArray> storage;QList<const char*> args;
        for(const auto& a:arguments)storage<<a.toUtf8();
        for(const auto& a:storage)args<<a.constData();args<<nullptr;
        return mpv_command(mpv,args.data())>=0;
    };
    RuntimePaths paths{argv[1],argv[2],argv[3],true,argc==6?argv[5]:"monolithic",argc==6?"cpu-ane":"cpu-gpu"};
    FrameInterpolationController c({read,set,command},paths);
    QElapsedTimer timer;timer.start();bool ended=false;
    State previous=State::Off;
    auto pump=[&]{
        for(;;){auto* event=mpv_wait_event(mpv,0);if(event->event_id==MPV_EVENT_NONE)break;
            if(event->event_id==MPV_EVENT_SEEK)c.onSeek();
            if(event->event_id==MPV_EVENT_END_FILE){ended=true;c.stop();}
            if(event->event_id==MPV_EVENT_LOG_MESSAGE){auto* log=static_cast<mpv_event_log_message*>(event->data);qWarning().noquote()<<log->prefix<<log->text;}
        }
        auto frame=read("video-frame-info").toMap(),params=read("video-params").toMap();
        if(!params.isEmpty()&&frame.contains("interlaced"))c.onFormatChanged(sourceInfo(params,frame,read("container-fps").toDouble()));
        c.poll(timer.elapsed(),read("pause").toBool()||read("seeking").toBool());
        if(previous!=c.state()){previous=c.state();qInfo()<<c.diagnostics()<<params<<frame;}
        QThread::msleep(10);
    };
    auto wait=[&](auto condition){const auto end=timer.elapsed()+12000;while(!condition()&&timer.elapsed()<end)pump();
        if(!condition()){qCritical()<<c.diagnostics()<<read("video-dec-params")<<read("video-frame-info");abort();}};
    const auto originalHwdec=read("hwdec");
    c.beginItem(true,false);assert(command({"loadfile",argv[4]}));
    wait([&]{return c.diagnostics()["generatedFrames"].toULongLong()>5;});
    assert(c.state()==State::Active);const auto firstEpoch=c.diagnostics()["epoch"].toULongLong();
    assert(command({"seek","2","absolute+exact"}));
    wait([&]{return c.diagnostics()["epoch"].toULongLong()>firstEpoch&&c.diagnostics()["generatedFrames"].toULongLong()>3;});
    assert(set("pause",true));for(int i=0;i<30;++i)pump();const auto pos=read("time-pos").toDouble();
    for(int i=0;i<30;++i)pump();assert(std::abs(read("time-pos").toDouble()-pos)<.03);
    assert(c.state()==State::Active);assert(set("pause",false));
    // Runtime error must remove only our filter and preserve ordinary playback.
    assert(command({"vf","add","@user:crop=128:128"}));
    const auto id=c.generation();Metrics failed;failed.epoch=c.diagnostics()["epoch"].toULongLong();failed.error="inference-error";
    c.onMetrics(id,failed,timer.elapsed(),false,0);assert(c.state()==State::DisabledForCurrentItem);
    auto filters=read("vf").toList();assert(filters.size()==1&&filters[0].toMap()["label"]=="user");
    assert(read("hwdec")==originalHwdec);const auto before=read("time-pos").toDouble();wait([&]{return read("time-pos").toDouble()>before+.15;});
    assert(command({"seek","7.7","absolute+exact"}));wait([&]{return ended;});
    assert(c.state()==State::Off);
    assert(command({"vf","add","@svp:format=yuv420p"}));
    c.beginItem(true,false);assert(c.state()==State::Bypassed);
    assert(read("vf").toList().size()==2); // neither external filter was removed
    mpv_terminate_destroy(mpv);
    qInfo()<<"Real libmpv controller: synthesis, seek epoch, pause, error fallback, ownership and EOF passed";
}
