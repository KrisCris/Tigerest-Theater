#ifndef TIGEREST_MPVCONFIGMANAGER_H
#define TIGEREST_MPVCONFIGMANAGER_H

#include <QString>
#include <QStringList>
#include <QVariantMap>

namespace MpvConfigManager
{
  bool prepare();
  void configureVapourSynth(const QStringList& installationRoots);
  QString activeConfigDir();
  bool usingSystemConfig();
  QString detectSystemConfigDir(const QString& configuredPath = QString());
  QString profileName(const QString& preset);
  QString danmakuApiServer(const QString& serverUrl, const QString& connectionMode);
  QString danmakuStyleConfigText(const QVariantMap& values);
  QString danmakuStyleMpvOptionsText(const QVariantMap& values);
  bool writeDanmakuStyleConfig(const QString& configDir,
                               const QVariantMap& values,
                               QString* errorMessage = nullptr);
}

#endif
