#pragma once

#include <QByteArray>
#include <QJsonArray>
#include <QJsonObject>
#include <QString>
#include <QUrl>

namespace AppUpdatePolicy
{
enum class Package { WindowsInstaller, WindowsPortable, MacArm64, Unsupported };
struct Candidate
{
  QString version;
  QString fileName;
  QString notes;
  QUrl releaseUrl;
  QUrl downloadUrl;
  QByteArray sha256;
  qint64 size = 0;
  // Netdisk share pages from the release notes' tigerest-mirrors marker.
  QUrl quarkUrl;
  QUrl baiduUrl;
  bool valid() const { return !version.isEmpty(); }
};
constexpr qint64 MaximumPackageBytes = 2LL * 1024 * 1024 * 1024;
constexpr qint64 MaximumMetadataBytes = 2 * 1024 * 1024;
Candidate select(const QJsonArray& releases, const QString& currentVersion, Package package);
// The selected release, reduced to what select() reads, for showing it again on the next launch.
QJsonObject cachedRelease(const QJsonArray& releases, const Candidate& candidate);
bool verifyFile(const QString& path, const Candidate& candidate);
}
