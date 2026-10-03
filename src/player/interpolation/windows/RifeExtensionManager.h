#pragma once
#include "RifeExtensionArchive.h"
#include <QObject>
#include <QVariantMap>
#include <QThread>
#include <memory>

class QLockFile;
namespace rife {
class RifeExtensionManager : public QObject {
    Q_OBJECT
public:
    // Native callers only: catalog and root are never supplied by webpage JS.
    RifeExtensionManager(QString root,QJsonObject catalog,QString appVersion,QObject* parent=nullptr,
                         std::function<QString()> gpuReportProvider={});
    ~RifeExtensionManager() override;
    void initialize();
    void importPackage(const QString& path);
    void download(const QString& id);
    void cancel();
    void scheduleRemoval(const QString& versionKey);
    QVariantMap status() const {return m_status;}
    QVariantMap runtimePaths() const {return m_paths;}
    static QVariantMap packageSelection(const QJsonObject& catalog,const QString& appVersion,
                                       int deviceCount,int major,int minor);
    void setAvailableBytesForTest(qint64 bytes){m_availableBytes=bytes;}
    void setTrustedCertificateForTest(QByteArray certificate){m_testCertificate=std::move(certificate);}
signals:
    void statusChanged(const QVariantMap& status);
    void operationFinished(bool ok,const QString& error);
    void operationRejected(const QString& error);
private:
    struct OperationResult {
        bool ok=false;QString error;QVariantMap status,paths;
        std::shared_ptr<QLockFile> lease;
    };
    QString m_root,m_appVersion;
    QJsonObject m_catalog;
    QVariantMap m_status,m_paths;
    QThread* m_worker=nullptr;
    std::atomic_bool m_cancelled{false};
    qint64 m_availableBytes=-1;
    QByteArray m_testCertificate;
    std::function<QString()> m_gpuReportProvider;
    std::shared_ptr<QLockFile> m_lease;
    void start(const QString& state,std::function<OperationResult()> work,bool startup=false);
    void publish(const QVariantMap& status);
    OperationResult install(const QString& path);
    OperationResult loadActive(const QString& gpuArchitecture);
    static QVariantMap packageSelectionForArchitecture(const QJsonObject& catalog,const QString& appVersion,
                                                       const QString& architecture);
    OperationResult removeVersion(const QString& versionKey);
    RifeExtensionArchive::Options archiveOptions();
};
}
