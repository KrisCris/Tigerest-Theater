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
  // Netdisk shares: the release notes' tigerest-mirrors marker, else the built-in ones.
  QUrl quarkUrl;
  QUrl baiduUrl;
  bool valid() const { return !version.isEmpty(); }
};
// Built-in netdisk shares, one subfolder per released version.
constexpr char DefaultQuarkShare[] = "https://pan.quark.cn/s/88e6f7a795b4";
constexpr char DefaultBaiduShare[] = "https://pan.baidu.com/s/58azzOU4piiB3miyZqA1dig";
constexpr qint64 MaximumPackageBytes = 2LL * 1024 * 1024 * 1024;
constexpr qint64 MaximumMetadataBytes = 2 * 1024 * 1024;
Candidate select(const QJsonArray& releases, const QString& currentVersion, Package package);
// The selected release, reduced to what select() reads, for showing it again on the next launch.
QJsonObject cachedRelease(const QJsonArray& releases, const Candidate& candidate);
bool verifyFile(const QString& path, const Candidate& candidate);
}
