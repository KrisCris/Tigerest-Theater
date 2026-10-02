#pragma once
#include "FrameInterpolationController.h"
#include <QObject>
#include <QJsonObject>
#include <QPointer>
#include <QProcess>
#include <QProcessEnvironment>
#include <functional>

namespace rife {
class RifeRuntimeManager : public QObject {
    Q_OBJECT
public:
    using Launch=std::function<void(QProcess*,const QString&,const QStringList&,const QProcessEnvironment&)>;
    explicit RifeRuntimeManager(QObject* parent=nullptr,Launch launch={});
    ~RifeRuntimeManager() override;
    // Called only with an extension root approved by the installer/catalog.
    // Standalone roots get full verification. Only the native extension-manager
    // success path may assert extensionVerified and reuse its completed check.
    bool configure(const QString& runtime,const QString& cache,const QString& monitor,const QString& script,bool extensionVerified=false);
    bool select(const QString& model,int targetFps);
    void prepare(const SourceInfo& source,quint64 generation);
    void cancel(quint64 generation);
    RuntimePaths pathsFor(const SourceInfo& source) const;
    QVariantMap diagnostics() const;
signals:
    void runtimeReady(bool ok,const QString& error);
    void preparationStarted(quint64 generation);
    void prepared(quint64 generation,bool ok,const QString& error);
private:
    using Finished=std::function<void(bool,const QJsonObject&,const QString&)>;
    void run(const QString& worker,const QJsonObject& request,bool probe,Finished finished);
    void cancelActive();
    QJsonObject model() const;
    QJsonObject identityFor(const SourceInfo& source) const;
    QString cachedEngine(const SourceInfo& source) const;
    QString root,cache,monitor,script,modelId,error;
    int targetFps=60;
    bool available=false,probing=false,compiling=false,cacheHit=false;
    quint64 serial=0,generation=0;
    QJsonObject manifest,gpu;
    QPointer<QProcess> active;
    QString cancellation;
    Launch launch;
};
}
