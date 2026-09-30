#pragma once

#include "FrameInterpolationController.h"
#include <QHash>

namespace rife {
// mpv's macvk VO waits for the Cocoa main queue while it is destroyed. A
// synchronous property request from that queue can therefore deadlock even
// before END_FILE reaches the client. Timer work reads observed values and
// queues its writes instead.
class MpvPollAccess {
public:
    explicit MpvPollAccess(MpvAccess access):base(std::move(access)){}

    class Scope {
    public:
        explicit Scope(MpvPollAccess& owner):access(owner),previous(owner.polling){access.polling=true;}
        ~Scope(){access.polling=previous;}
        Scope(const Scope&)=delete;
        Scope& operator=(const Scope&)=delete;
    private:
        MpvPollAccess& access;
        bool previous;
    };

    Scope enterPolling(){return Scope(*this);}
    void observe(const QString& key,const QVariant& value){observed.insert(key,value);}
    void clearMedia(){
        for(const auto& key:{"video-params","video-frame-info","container-fps",
                             "seeking","paused-for-cache","frame-drop-count",
                             "decoder-frame-drop-count","playback-time","duration",
                             "avsync",
                             "video-out-params","current-vo","hwdec-current"})
            observed.remove(QString::fromLatin1(key));
    }
    bool has(const QString& key)const{return observed.contains(key);}
    QVariant value(const QString& key)const{return observed.value(key);}

    MpvAccess interface(){return {
        [this](const QString& key){return polling?observed.value(key):base.read(key);},
        [this](const QString& key,const QVariant& value){
            const bool accepted=polling?base.setAsync(key,value):base.set(key,value);
            if(accepted)observed.insert(key,value);
            return accepted;
        },
        [this](const QStringList& args){
            const bool accepted=polling?base.commandAsync(args):base.command(args);
            if(accepted)updateFilterCache(args);
            return accepted;
        },
        [this](const QString& key,const QVariant& value){
            const bool accepted=base.setAsync(key,value);
            if(accepted)observed.insert(key,value);
            return accepted;
        },
        [this](const QStringList& args){
            const bool accepted=base.commandAsync(args);
            if(accepted)updateFilterCache(args);
            return accepted;
        }
    };}

private:
    void updateFilterCache(const QStringList& args){
        if(args.size()<3||args[0]!="vf")return;
        const auto label=QStringLiteral("tigerest-rife");
        auto filters=observed.value(QStringLiteral("vf")).toList();
        if(args[1]=="add"&&args[2].startsWith("@tigerest-rife:"))
            filters.append(QVariantMap{{"name","vapoursynth"},{"label",label}});
        else if(args[1]=="remove"&&args[2]=="@tigerest-rife"){
            for(qsizetype i=filters.size();i>0;--i)
                if(filters[i-1].toMap().value("label")==label)filters.removeAt(i-1);
        }else return;
        observed.insert(QStringLiteral("vf"),filters);
    }
    MpvAccess base;
    QHash<QString,QVariant> observed;
    bool polling=false;
};
}
