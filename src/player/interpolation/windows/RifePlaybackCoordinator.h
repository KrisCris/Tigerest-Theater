#pragma once
#include "RifeRuntimeManager.h"
#include <QObject>
namespace rife {
class RifePlaybackCoordinator : public QObject {
    Q_OBJECT
public:
    using ValidateRuntime=std::function<bool(const RuntimePaths&,QString*)>;
    RifePlaybackCoordinator(RifeRuntimeManager& runtime,FrameInterpolationController& controller,
                            ValidateRuntime validate={},QObject* parent=nullptr);
    ~RifePlaybackCoordinator() override;
    void beginItem(bool enabled,bool systemConfig,double speed);
    void onFormatChanged(const SourceInfo& source);
    void onSeek();
    void onPlaybackSpeed(double speed);
    void endItem();
    quint64 generation()const{return serial;}
    QString activationError()const{return error;}
    bool engineCacheHitForItem()const{return cacheHit;}
signals:
    void enginePrepared(quint64 generation,bool ready,const QString& error);
private:
    RifeRuntimeManager& runtime;
    FrameInterpolationController& controller;
    ValidateRuntime validate;
    quint64 serial=0;
    bool inItem=false,sourceSeen=false,cacheHit=false;
    SourceInfo source;
    QString error;
};
}
