#include <QtTest/QtTest>
#include <QFile>
#include <QTemporaryDir>
#include "utils/ReportDiagnostics.h"

class TestReportDiagnostics : public QObject
{
  Q_OBJECT
private slots:
  void secrets_data()
  {
    QTest::addColumn<QString>("record");
    QTest::addColumn<QString>("secret");
    QTest::newRow("json-escaped") << QString::fromUtf8(R"({"AccessToken":"SECRET\"AFTER","message":"failed"})") << "AFTER";
    QTest::newRow("quoted-json") << QString::fromUtf8(R"(body={\"Password\":\"SECRET\"})") << "SECRET";
    QTest::newRow("unicode-json-key") << QString::fromUtf8(R"({"\u0041ccessToken":"SECRET"})") << "SECRET";
    QTest::newRow("json-multiline") << "{\n\"password\":\n\"SECRET\nSECOND\"\n}" << "SECOND";
    QTest::newRow("header-case") << "aUtHoRiZaTiOn: bEaReR SECRET" << "SECRET";
    QTest::newRow("basic") << "Authorization: Basic SECRET" << "SECRET";
    QTest::newRow("cookie") << "SET-cookie: session=SECRET; HttpOnly" << "SECRET";
    QTest::newRow("query") << "GET https://example.test/Items?api_key=SECRET&x=1" << "SECRET";
    QTest::newRow("double-encoded") << "request api%255fkey%253DSECRET" << "SECRET";
    QTest::newRow("double-encoded-url") << "request https%253A%252F%252Fexample.test%252Fstream%253Fopaque%253DSECRET" << "SECRET";
    QTest::newRow("escaped-url") << QString::fromUtf8(R"(request https:\/\/example.test\/stream?opaque=SECRET)") << "SECRET";
    QTest::newRow("credentials") << "request https://someone:SECRET@example.test/video" << "SECRET";
    QTest::newRow("private-account") << "{\"UserId\":\"SECRET\",\"ServerId\":\"OTHER\"}" << "SECRET";
    QTest::newRow("signature") << "Signature=SECRET" << "SECRET";
    QTest::newRow("email") << "request person.SECRET@example.test" << "SECRET";
    QTest::newRow("local-email") << "request person.SECRET@private-domain" << "SECRET";
    QTest::newRow("long-local-email") << QString(60000, 'a') + "SECRET@private-domain" << "SECRET";
    QTest::newRow("windows-path") << "failed C:\\Users\\SECRET\\movie.mkv" << "SECRET";
    QTest::newRow("path-colon") << "path:C:\\Users\\SECRET\\movie.mkv" << "SECRET";
    QTest::newRow("unix-path") << "failed /home/SECRET/movie.mkv" << "SECRET";
    QTest::newRow("unc-path") << "failed \\\\server\\SECRET\\movie.mkv" << "SECRET";
  }
  void secrets()
  {
    QFETCH(QString, record); QFETCH(QString, secret);
    const auto text = ReportDiagnostics::sanitize(record);
    QVERIFY(!text.contains(secret)); QVERIFY(!text.isEmpty());
  }
  void validUnicodeAndControls()
  {
    QString raw = QString::fromUtf8("播放器失败 😀\n下一行\t线索\r");
    raw += QChar(0); raw += QChar(1); raw += QChar(0xD800);
    const auto clean = ReportDiagnostics::sanitize(raw);
    QVERIFY(clean.contains(QString::fromUtf8("播放器失败 😀")));
    QVERIFY(clean.contains('\n')); QVERIFY(clean.contains('\t')); QVERIFY(clean.contains('\r'));
    QVERIFY(!clean.contains(QChar(0))); QVERIFY(!clean.contains(QChar(1))); QVERIFY(!clean.contains(QChar(0xD800)));
  }
  void timeBoundaryAndUnavailable()
  {
    QTemporaryDir temp; QVERIFY(temp.isValid());
    const auto now = QDateTime::currentDateTimeUtc();
    auto line = [](const QDateTime& time, const QString& text) {
      return time.toLocalTime().toString("yyyy-MM-dd hh:mm:ss.zzz").toUtf8() + " [warning] test @ 1 - " + text.toUtf8() + '\n';
    };
    QFile file(temp.filePath("current.log")); QVERIFY(file.open(QIODevice::WriteOnly));
    file.write(line(now, "PREVIOUS_ACCOUNT")); const auto boundary = file.pos();
    file.write(line(now.addSecs(-601), "EXPIRED_RECORD"));
    file.write(line(now.addSecs(-1), "current playback error"));
    file.write(line(now, "AccessToken=SECRET")); file.close();
    const auto result = ReportDiagnostics::collectFile(file.fileName(), boundary, now);
    QVERIFY(result.value("capturedAt").toString().endsWith('Z'));
    QCOMPARE(result.value("truncated").typeId(), QMetaType::Bool);
    const auto text = result.value("logText").toString();
    QVERIFY(text.contains("current playback error"));
    QVERIFY(!text.contains("PREVIOUS_ACCOUNT")); QVERIFY(!text.contains("EXPIRED_RECORD")); QVERIFY(!text.contains("SECRET"));
    QVERIFY(ReportDiagnostics::collectFile(temp.filePath("missing.log"), 0, now).isEmpty());
    QVERIFY(ReportDiagnostics::collectFile(file.fileName(), file.size(), now).isEmpty());
  }
  void boundedTailAndMalformedRecord()
  {
    QTemporaryDir temp; QVERIFY(temp.isValid()); const auto now = QDateTime::currentDateTimeUtc();
    QFile file(temp.filePath("bounded.log")); QVERIFY(file.open(QIODevice::WriteOnly));
    const auto prefix = now.toLocalTime().toString("yyyy-MM-dd hh:mm:ss.zzz").toUtf8() + " [warning] test @ 1 - ";
    file.write(prefix + QByteArray(3 * ReportDiagnostics::MaxBytes, 'a') + "AccessToken=SECRET\n");
    for(int i=0;i<1200;++i) file.write(prefix + QString(1024, QChar(0x4E2D)).toUtf8() + '\n');
    file.close(); const auto result = ReportDiagnostics::collectFile(file.fileName(), 0, now);
    QVERIFY(!result.isEmpty()); QVERIFY(result.value("truncated").toBool());
    const auto bytes = result.value("logText").toString().toUtf8();
    QVERIFY(bytes.size() <= ReportDiagnostics::MaxBytes); QVERIFY(!bytes.contains("SECRET"));
    QCOMPARE(QString::fromUtf8(bytes).toUtf8(), bytes);
    QVERIFY(ReportDiagnostics::sanitize(QString(ReportDiagnostics::MaxRecordChars + 1, 'a') + "password=SECRET").contains("redacted"));
  }
};
QTEST_APPLESS_MAIN(TestReportDiagnostics)
#include "test_report_diagnostics.moc"
