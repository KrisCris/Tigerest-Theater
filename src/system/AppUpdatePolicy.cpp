#include "AppUpdatePolicy.h"
#include <QCryptographicHash>
#include <QFile>
#include <QFileInfo>
#include <QJsonObject>
#include <QRegularExpression>
#include <QVersionNumber>
#include <cmath>

namespace AppUpdatePolicy
{
Candidate select(const QJsonArray& releases, const QString& currentVersion, Package package)
{
  const QRegularExpression currentPattern("^v?(0|[1-9][0-9]{0,8})\\.(0|[1-9][0-9]{0,8})\\.(0|[1-9][0-9]{0,8})(-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?$");
  const QRegularExpression stablePattern("^v(0|[1-9][0-9]{0,8})\\.(0|[1-9][0-9]{0,8})\\.(0|[1-9][0-9]{0,8})$");
  const auto currentMatch = currentPattern.match(currentVersion);
  if (!currentMatch.hasMatch()) return {};
  const QVersionNumber current(currentMatch.captured(1).toInt(), currentMatch.captured(2).toInt(), currentMatch.captured(3).toInt());
  const QString suffix = package == Package::WindowsInstaller ? "x64.exe" :
    package == Package::WindowsPortable ? "x64.zip" : package == Package::MacArm64 ? "arm64.dmg" : QString();
  if (suffix.isEmpty()) return {};
  Candidate best;
  QVersionNumber bestVersion;
  for (const auto& value : releases)
  {
    const auto release = value.toObject();
    if (!release.value("draft").isBool() || release.value("draft").toBool() ||
        !release.value("prerelease").isBool() || release.value("prerelease").toBool()) continue;
    const QString tag = release.value("tag_name").toString();
    const auto match = stablePattern.match(tag);
    if (!match.hasMatch()) continue;
    const QVersionNumber version(match.captured(1).toInt(), match.captured(2).toInt(), match.captured(3).toInt());
    if (version < current || (version == current && currentMatch.captured(4).isEmpty()) ||
        (!bestVersion.isNull() && version <= bestVersion)) continue;
    const QString name = "TigerestTheater-" + tag.mid(1) + "-" + suffix;
    const QString download = "https://github.com/Tigerest/Tigerest-Theater/releases/download/" + tag + "/" + name;
    for (const auto& item : release.value("assets").toArray())
    {
      const auto asset = item.toObject();
      const QString digest = asset.value("digest").toString();
      const double size = asset.value("size").toDouble(-1);
      if (asset.value("name").toString() != name || asset.value("browser_download_url").toString() != download ||
          size <= 0 || size > MaximumPackageBytes || std::floor(size) != size ||
          !QRegularExpression("^sha256:[0-9a-fA-F]{64}$").match(digest).hasMatch()) continue;
      best = {tag.mid(1), name, release.value("body").toString().left(20000),
        QUrl("https://github.com/Tigerest/Tigerest-Theater/releases/tag/" + tag),
        QUrl(download), QByteArray::fromHex(digest.mid(7).toLatin1()), static_cast<qint64>(size)};
      bestVersion = version;
      break;
    }
  }
  return best;
}

bool verifyFile(const QString& path, const Candidate& candidate)
{
  if (!candidate.valid() || candidate.sha256.size() != 32 || candidate.size <= 0 ||
      candidate.size > MaximumPackageBytes || QFileInfo(path).isSymLink()) return false;
  QFile file(path);
  if (!file.open(QIODevice::ReadOnly) || file.size() != candidate.size) return false;
  QCryptographicHash hash(QCryptographicHash::Sha256);
  return hash.addData(&file) && hash.result() == candidate.sha256;
}
}
