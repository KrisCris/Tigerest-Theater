#pragma once
#include "RifeExtensionArchive.h"
#include <QByteArray>
#include <QList>
#include <QUrl>
namespace rife {
class RifeExtensionDownload {
public:
    // Returns a hash-verified local archive. Independent network session, no
    // application/server authentication state. The catalog fixes the URL; a
    // github.com URL is first tried through the download accelerators. Tests
    // may replace that source list.
    static QString fetch(const QJsonObject& item,const QString& downloadRoot,
        const RifeExtensionArchive::Options& options,const QByteArray& testCertificate,QString* error,
        const QList<QUrl>& testSources={});
};
}
