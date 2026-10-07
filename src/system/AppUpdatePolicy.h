#pragma once

#include <QByteArray>
#include <QJsonArray>
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
  bool valid() const { return !version.isEmpty(); }
};
constexpr qint64 MaximumPackageBytes = 2LL * 1024 * 1024 * 1024;
constexpr qint64 MaximumMetadataBytes = 2 * 1024 * 1024;
Candidate select(const QJsonArray& releases, const QString& currentVersion, Package package);
bool verifyFile(const QString& path, const Candidate& candidate);
}
