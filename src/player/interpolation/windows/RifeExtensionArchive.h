#pragma once
#include <QJsonObject>
#include <QString>
#include <atomic>
#include <functional>

namespace rife {
// No shell commands or executable payloads. The caller supplies a trusted
// catalog entry and an empty, independently owned staging directory.
class RifeExtensionArchive {
public:
    struct Options {
        std::atomic_bool* cancelled=nullptr;
        std::function<void(qint64,qint64)> progress;
        std::function<qint64(const QString&)> availableBytes;
    };
    struct Result { bool ok=false; QString error; QJsonObject manifest; };
    static QJsonObject catalogPackage(const QJsonObject& catalog,const QString& id,
        const QString& appVersion,QString* error);
    static Result extract(const QString& archive,const QJsonObject& trustedItem,
        const QString& staging,const Options& options);
    static Result verifyInstalled(const QString& root,const QJsonObject& trustedItem,
        const Options& options);
};
}
