//
// Created by Tobias Hieta on 07/03/16.
//

#ifndef PLEXMEDIAPLAYER_LOG_H
#define PLEXMEDIAPLAYER_LOG_H

#include <QString>
#include <QVariantMap>

namespace Log
{
  void Init();
  void RotateLog();
  void Cleanup();
  void ApplyConfigLogLevel();
  void CensorAuthTokens(QString& msg);
  void SetLogLevel(const QString& level);
  int ParseLogLevel(const QString& level);
  void SetReportDiagnosticsScope(const QString& key);
  QVariantMap CollectReportDiagnostics();
}

#endif //PLEXMEDIAPLAYER_LOG_H
