#pragma once
#include <QJsonObject>
#include <QString>
class QFile;

namespace rife {
// Receipts only remember hashes checked against the trusted catalog. They
// remain outside the immutable payload and are protected for the local user.
class RifeVerificationCache {
public:
    RifeVerificationCache(QString path, const QString& root, const QString& manifestHash);
    static bool openForVerification(QFile& file);
    static QJsonObject fingerprint(QFile& file);
    bool contains(const QString& name, const QString& hash, const QJsonObject& fingerprint) const;
    void remember(const QString& name, const QString& hash, const QJsonObject& fingerprint);
    void save() const;
private:
    QString path;
    QJsonObject binding, previous, current;
};
}
