#ifdef NDEBUG
#undef NDEBUG
#endif
#include "windows/RifeVSScriptRuntime.h"
#include "RifeSessionMetrics.h"
#include "QtHelper.h"
#include <QCoreApplication>
#include <QElapsedTimer>
#include <QFile>
#include <QFileInfo>
#include <QJsonDocument>
#include <QJsonObject>
#include <QSaveFile>
#include <cassert>
#include <windows.h>

// A fresh native host is necessary: a Python parent may launch this process,
// but must never initialize the embedded interpreter inside the mpv process.
int main(int argc,char** argv){
    QCoreApplication app(argc,argv);assert(argc==2);
    QFile request(app.arguments()[1]);assert(request.open(QIODevice::ReadOnly));
    const auto input=QJsonDocument::fromJson(request.readAll()).object();
    const auto root=QFileInfo(input["runtime"].toString()).canonicalFilePath();
    const auto dll=QFileInfo(input["mpv"].toString()).canonicalFilePath();
    assert(!root.isEmpty()&&!dll.isEmpty());QString error;
    assert(rife::activateVSScriptRuntime(root,&error));
    const auto library=LoadLibraryExW(dll.toStdWString().c_str(),nullptr,
        LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_DEFAULT_DIRS);assert(library);
#define MPV_FUNCTION(name) const auto name=reinterpret_cast<decltype(&mpv_##name)>(GetProcAddress(library,"mpv_" #name));assert(name)
    MPV_FUNCTION(create);MPV_FUNCTION(initialize);MPV_FUNCTION(set_option_string);
    MPV_FUNCTION(command);MPV_FUNCTION(wait_event);MPV_FUNCTION(request_log_messages);
    MPV_FUNCTION(get_property);MPV_FUNCTION(free_node_contents);MPV_FUNCTION(terminate_destroy);
#undef MPV_FUNCTION
    auto* handle=create();assert(handle);
    for(const auto& item:QList<QPair<QByteArray,QByteArray>>{{"config","no"},{"vo","null"},{"ao","null"},
        {"audio","no"},{"hwdec","no"},{"terminal","no"},{"idle","yes"}})
        assert(set_option_string(handle,item.first.constData(),item.second.constData())==0);
    assert(request_log_messages(handle,"warn")==0);assert(initialize(handle)==0);
    auto property=[&](const char* name){mpv_node node{};if(get_property(handle,name,MPV_FORMAT_NODE,&node)<0)return QVariant();
        const auto value=mpv::qt::node_to_variant(&node);free_node_contents(&node);return value;};
    const auto version=property("mpv-version").toString();
    const auto session=input["monitor"].toBool()?rife::openSession():0;
    auto options=input["userData"].toObject();if(session)options["session"]=double(session);
    const auto data=input["userData"].isObject()?QJsonDocument(options).toJson(QJsonDocument::Compact):input["userData"].toString().toUtf8();
    const auto script=input["script"].toString().toUtf8();
    const auto quote=[](const QByteArray& value){return "%"+QByteArray::number(value.size())+"%"+value;};
    const auto filter="vapoursynth=file="+quote(script)+":user-data="+quote(data)+
        ":eof-aware=yes:buffered-frames=4:concurrent-frames=2";
    const char* add[]={"vf","add",filter.constData(),nullptr};const auto added=command(handle,add);
    const auto media=input["media"].toString().toUtf8();const char* load[]={"loadfile",media.constData(),nullptr};
    bool ended=false,loaded=false;int reason=-1,endError=0;QByteArray messages;
    if(added>=0){assert(command(handle,load)>=0);QElapsedTimer clock;clock.start();
        while(!ended&&clock.elapsed()<20000){
            const auto* event=wait_event(handle,.05);
            if(event->event_id==MPV_EVENT_FILE_LOADED)loaded=true;
            if(event->event_id==MPV_EVENT_END_FILE){const auto* eof=static_cast<mpv_event_end_file*>(event->data);
                ended=true;reason=eof->reason;endError=eof->error;}
            if(event->event_id==MPV_EVENT_LOG_MESSAGE){const auto* log=static_cast<mpv_event_log_message*>(event->data);
                if(messages.size()<16384)messages+=QByteArray(log->prefix)+": "+log->text;}
        }
    }
    const auto metrics=session?rife::readMetrics(session):rife::Metrics{};
    const QJsonObject result{{"added",added},{"loaded",loaded},{"ended",ended},{"endReason",reason},{"endError",endError},
        {"mpvVersion",version},{"messages",QString::fromUtf8(messages)},{"generated",double(metrics.predictions)},
        {"pairs",double(metrics.pairs)},{"epoch",double(metrics.epoch)},{"timingAvailable",metrics.timingAvailable}};
    terminate_destroy(handle);if(session)rife::closeSession(session);FreeLibrary(library);
    QSaveFile report(input["result"].toString());assert(report.open(QIODevice::WriteOnly));
    assert(report.write(QJsonDocument(result).toJson())>=0&&report.commit());
    return added>=0&&loaded&&ended&&reason==MPV_END_FILE_REASON_EOF&&endError==0?0:1;
}
