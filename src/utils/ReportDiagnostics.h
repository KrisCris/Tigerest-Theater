#ifndef TIGEREST_REPORT_DIAGNOSTICS_H
#define TIGEREST_REPORT_DIAGNOSTICS_H

#include <QDateTime>
#include <QString>
#include <QVariantMap>

namespace ReportDiagnostics
{
  constexpr qint64 MaxBytes = 1048576;
  constexpr qint64 MaxReadBytes = 2 * MaxBytes;
  constexpr qsizetype MaxRecordChars = 65536;
  QString sanitize(const QString& record);
  QVariantMap collectFile(const QString& path, qint64 accountBoundary,
                          const QDateTime& now = QDateTime::currentDateTimeUtc());
}

#endif
