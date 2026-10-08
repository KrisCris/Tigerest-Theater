#include "ReportDiagnostics.h"
#include <QFile>
#include <QList>
#include <QRegularExpression>
#include <QUrl>

namespace
{
const QString Redacted = QStringLiteral("[redacted private diagnostic record]");

QString validText(const QString& input)
{
  QString result; result.reserve(input.size());
  for(qsizetype i = 0; i < input.size(); ++i)
  {
    const QChar c = input.at(i);
    if(c.isHighSurrogate())
    {
      if(i + 1 < input.size() && input.at(i + 1).isLowSurrogate())
      { result += c; result += input.at(++i); }
      else result += QChar::ReplacementCharacter;
    }
    else if(c.isLowSurrogate()) result += QChar::ReplacementCharacter;
    else if((c.unicode() < 0x20 && c != '\n' && c != '\r' && c != '\t') ||
            (c.unicode() >= 0x7f && c.unicode() <= 0x9f)) result += QChar(' ');
    else result += c;
  }
  return result;
}

QString decodeJsonEscapes(const QString& input)
{
  QString result; result.reserve(input.size());
  for(qsizetype i = 0; i < input.size(); ++i)
  {
    if(input.at(i) == '\\' && i + 5 < input.size() && input.at(i + 1) == 'u')
    {
      bool valid = false; const auto value = input.mid(i + 2, 4).toUShort(&valid, 16);
      if(valid) { result += QChar(value); i += 5; continue; }
    }
    result += input.at(i);
  }
  return result;
}

bool hasPrivateAt(const QString& input)
{
  // A linear scan also covers private email addresses with a local domain.
  // An unanchored email regex can scan a long malformed address quadratically.
  for(qsizetype i = 1; i + 1 < input.size(); ++i)
    if(input.at(i) == '@' && !input.at(i - 1).isSpace() && !input.at(i + 1).isSpace()) return true;
  return false;
}

QString redactRecord(const QString& input)
{
  // Preserve only our native formatter's structural prefix. Message content
  // must never be used as a prefix: it may contain credentials or account data.
  static const QRegularExpression prefix(QStringLiteral(
    R"(^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} \[(?:debug|info|warning|critical|fatal)\] [A-Za-z0-9_:<>()* &~.,]* @ \d+ - )"));
  const auto match = prefix.match(input.left(512));
  return (match.hasMatch() ? match.captured() : QString()) + Redacted;
}

QDateTime recordTime(const QString& line)
{
  static const QRegularExpression header(QStringLiteral(
    R"(^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} \[(?:debug|info|warning|critical|fatal)\] )"));
  if(!header.match(line.left(64)).hasMatch()) return {};
  auto time = QDateTime::fromString(line.left(23), QStringLiteral("yyyy-MM-dd hh:mm:ss.zzz"));
  time.setTimeSpec(Qt::LocalTime);
  return time.toUTC();
}
}

QString ReportDiagnostics::sanitize(const QString& record)
{
  if(record.size() > MaxRecordChars) return redactRecord(record);
  QString text = validText(record);
  QString inspect = text;
  // Detection only: never expose decoded data. Two passes cover nested URL
  // encoding without unbounded expansion or a backtracking decoder.
  for(int i = 0; i < 2; ++i) inspect = QUrl::fromPercentEncoding(inspect.toUtf8());
  inspect = decodeJsonEscapes(inspect);
  inspect.replace(QStringLiteral("\\\""), QStringLiteral("\""));
  inspect.replace(QStringLiteral("\\/"), QStringLiteral("/"));
  static const QRegularExpression privateField(QStringLiteral(
    R"((?i)(?:^|[^a-z0-9])(?:access[-_]?token|refresh[-_]?token|api[-_]?key|token|password(?:hash)?|passwd|pwd|secret|signature|sig|authorization|proxy[-_]?authorization|cookie|set[-_]?cookie|x[-_](?:emby|mediabrowser)[-_](?:token|authorization|user[-_]?id|server[-_]?id)|(?:emby[-_]?)?user[-_]?(?:id|name)|username|account(?:[-_]?(?:id|name))?|user|author|email|device[-_]?id|(?:emby[-_]?)?server[-_]?id|session[-_]?id|credential)[\s"'\\]*[:=])"));
  static const QRegularExpression authScheme(QStringLiteral(R"((?i)(?:^|[\s"'])\b(?:bearer|basic)\s+\S+)"));
  if(privateField.match(inspect).hasMatch() || authScheme.match(inspect).hasMatch() || hasPrivateAt(inspect))
    return redactRecord(text);
  // URLs may contain userinfo, signed path segments and unknown auth query
  // names. Removing the entire URL is safer than maintaining a query whitelist.
  static const QRegularExpression url(QStringLiteral(R"((?i)(?:https?|file|content)://[^\s<>"']+)"));
  // Escaped/nested-encoded URLs cannot safely be replaced by offsets from the
  // decoded detection string. Fail closed for the entire actual record.
  if(inspect != text && url.match(inspect).hasMatch()) return redactRecord(text);
  text.replace(url, QStringLiteral("[redacted URL]"));
  inspect.replace(url, QStringLiteral("[redacted URL]"));
  static const QRegularExpression absolutePath(QStringLiteral(
    R"((?:[a-zA-Z]:[\\/]|(?:^|[\s"'=(:\[{])(?:\\\\|/[^\s/])))"));
  if(absolutePath.match(inspect).hasMatch()) return redactRecord(text);
  return text;
}

QVariantMap ReportDiagnostics::collectFile(const QString& path, qint64 accountBoundary, const QDateTime& now)
{
  QFile file(path);
  if(!now.isValid() || accountBoundary < 0 || !file.open(QIODevice::ReadOnly) || accountBoundary >= file.size()) return {};
  const auto start = qMax(accountBoundary, file.size() - MaxReadBytes);
  bool truncated = start > accountBoundary;
  if(!file.seek(start)) return {};
  auto bytes = file.read(MaxReadBytes);
  if(start > accountBoundary)
  {
    const auto newline = bytes.indexOf('\n');
    if(newline < 0) return {};
    bytes.remove(0, newline + 1);
  }
  QList<QByteArray> records; qint64 total = 0;
  QString current; QDateTime time; bool oversized = false;
  const auto oldest = now.addSecs(-600);
  auto finish = [&] {
    if(!time.isValid() || time < oldest || time > now) return;
    const auto clean = (oversized ? redactRecord(current) : sanitize(current)).trimmed();
    if(clean.isEmpty()) return;
    const auto encoded = clean.toUtf8() + '\n';
    records.append(encoded); total += encoded.size();
    while(total > MaxBytes && !records.isEmpty()) { total -= records.takeFirst().size(); truncated = true; }
  };
  for(const auto& line : QString::fromUtf8(bytes).split('\n'))
  {
    const auto nextTime = recordTime(line);
    if(nextTime.isValid()) { finish(); current.clear(); time = nextTime; oversized = false; }
    if(!time.isValid()) continue;
    if(current.size() + line.size() + 1 > MaxRecordChars) { oversized = true; truncated = true; }
    else if(!oversized) { current += line; current += '\n'; }
  }
  finish();
  if(records.isEmpty()) return {};
  QByteArray result; result.reserve(total);
  for(const auto& record : records) result += record;
  return {{QStringLiteral("capturedAt"), now.toUTC().toString(Qt::ISODateWithMs)},
          {QStringLiteral("truncated"), truncated}, {QStringLiteral("logText"), QString::fromUtf8(result)}};
}
