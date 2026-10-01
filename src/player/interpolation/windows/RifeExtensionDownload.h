#pragma once
#include "RifeExtensionArchive.h"
#include <QByteArray>
namespace rife {
class RifeExtensionDownload {
public:
    // Returns a hash-verified local archive. Independent network session, no
    // application/server authentication state. The catalog fixes the URL.
    static QString fetch(const QJsonObject& item,const QString& downloadRoot,
        const RifeExtensionArchive::Options& options,const QByteArray& testCertificate,QString* error);
};
}
