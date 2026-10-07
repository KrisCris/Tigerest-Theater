#include <QtTest>
#include <QJsonDocument>
#include <QJsonObject>
#include <QTemporaryDir>
#include <QTimer>
#include "system/AppUpdater.h"

// Network I/O is the external boundary. The real updater still owns request
// policy, parsing, state transitions, filesystem writes and digest validation.
struct Response { QByteArray bytes; int status = 200; QUrl redirect; bool held = false; };
class FixtureReply : public QNetworkReply
{
public:
  FixtureReply(const QNetworkRequest& request, Response response, QObject* parent) : QNetworkReply(parent), m_response(response)
  {
    setRequest(request); setUrl(request.url()); setOperation(QNetworkAccessManager::GetOperation);
    setAttribute(QNetworkRequest::HttpStatusCodeAttribute, response.status);
    if (!response.redirect.isEmpty()) setAttribute(QNetworkRequest::RedirectionTargetAttribute, response.redirect);
    open(QIODevice::ReadOnly | QIODevice::Unbuffered);
    if (!response.held) QTimer::singleShot(0, this, [this] { complete(); });
  }
  void complete() { if (isFinished()) return; emit readyRead(); setFinished(true); emit finished(); }
  void abort() override { setError(OperationCanceledError, "Canceled"); setFinished(true); emit finished(); }
  qint64 bytesAvailable() const override { return m_response.bytes.size() - m_offset + QIODevice::bytesAvailable(); }
protected:
  qint64 readData(char* data, qint64 max) override
  { const auto count = qMin(max, m_response.bytes.size() - m_offset); if (count <= 0) return -1; memcpy(data, m_response.bytes.constData() + m_offset, count); m_offset += count; return count; }
private:
  Response m_response; qint64 m_offset = 0;
};
class FixtureNetwork : public QNetworkAccessManager
{
public:
  QList<Response> responses;
  QList<QUrl> requests;
protected:
  QNetworkReply* createRequest(Operation, const QNetworkRequest& request, QIODevice*) override
  {
    requests.append(request.url());
    return new FixtureReply(request, responses.isEmpty() ? Response{{}, 503} : responses.takeFirst(), this);
  }
};
static QByteArray metadata()
{
  return R"([{"tag_name":"v2.0.0","draft":false,"prerelease":false,"body":"Notes","assets":[{"name":"TigerestTheater-2.0.0-x64.exe","size":3,"digest":"sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad","browser_download_url":"https://github.com/Tigerest/Tigerest-Theater/releases/download/v2.0.0/TigerestTheater-2.0.0-x64.exe"}]}])";
}
class TestAppUpdater : public QObject
{
  Q_OBJECT
private slots:
  void automaticCheckRunsOnceAndManualBypassesDisabled()
  {
    QTemporaryDir dir; FixtureNetwork network; network.responses = {{metadata()}};
    AppUpdater updater("1.0.0", AppUpdatePolicy::Package::WindowsInstaller, dir.filePath("cache"), dir.filePath("skip.json"), &network, {});
    updater.check(false, false); QCOMPARE(updater.state().value("status").toString(), "idle");
    updater.check(false, true); QVERIFY(network.requests.isEmpty());
    updater.check(true, false);
    QTRY_COMPARE(updater.state().value("status").toString(), "available");
    QCOMPARE(network.requests.first(), QUrl("https://api.github.com/repos/Tigerest/Tigerest-Theater/releases?per_page=30"));
    QVERIFY(updater.state().value("manual").toBool());
    updater.check(false, true); QCOMPARE(network.requests.size(), 1);
  }
  void skippedVersionPersistsAndManualBypassesIt()
  {
    QTemporaryDir dir; FixtureNetwork network; network.responses = {{metadata()}, {metadata()}, {metadata()}};
    {
      AppUpdater updater("1.0.0", AppUpdatePolicy::Package::WindowsInstaller, dir.filePath("cache"), dir.filePath("skip.json"), &network, {});
      updater.check(false, true); QTRY_COMPARE(updater.state().value("status").toString(), "available");
      updater.skip(); QCOMPARE(updater.state().value("status").toString(), "idle");
    }
    AppUpdater updater("1.0.0", AppUpdatePolicy::Package::WindowsInstaller, dir.filePath("cache"), dir.filePath("skip.json"), &network, {});
    updater.check(false, true); QTRY_COMPARE(network.requests.size(), 2);
    QTRY_COMPARE(updater.state().value("status").toString(), "idle");
    updater.check(true, true); QTRY_COMPARE(updater.state().value("status").toString(), "available");
  }
  void startupCannotDowngradeAnExplicitCheckToSilent()
  {
    QTemporaryDir dir; FixtureNetwork network; network.responses = {{metadata(), 200, {}, true}};
    AppUpdater updater("1.0.0", AppUpdatePolicy::Package::WindowsInstaller, dir.filePath("cache"), dir.filePath("skip.json"), &network, {});
    updater.check(true, true);
    updater.check(false, true);
    QVERIFY(updater.state().value("manual").toBool());
    QCOMPARE(network.requests.size(), 1);
    updater.cancel();
  }
  void deferSurvivesDocumentReloadButNotManualCheck()
  {
    QTemporaryDir dir; FixtureNetwork network; network.responses = {{metadata()}, {metadata()}};
    AppUpdater updater("1.0.0", AppUpdatePolicy::Package::WindowsInstaller, dir.filePath("cache"), dir.filePath("skip.json"), &network, {});
    updater.check(false, true); QTRY_COMPARE(updater.state().value("status").toString(), "available");
    updater.defer(); QVERIFY(updater.state().value("deferred").toBool());
    updater.check(false, true); QVERIFY(updater.state().value("deferred").toBool()); QCOMPARE(network.requests.size(), 1);
    updater.check(true, true); QTRY_COMPARE(updater.state().value("status").toString(), "available");
    QVERIFY(!updater.state().value("deferred").toBool());
  }
  void downloadVerifiesBeforeReadyAndInstallRechecks()
  {
    QTemporaryDir dir; FixtureNetwork network; network.responses = {{metadata()}, {"abc"}};
    QString launched; int launches = 0;
    AppUpdater updater("1.0.0", AppUpdatePolicy::Package::WindowsInstaller, dir.filePath("cache"), dir.filePath("skip.json"), &network,
      [&](const QString& path, AppUpdatePolicy::Package package) { launched = path; ++launches; return package == AppUpdatePolicy::Package::WindowsInstaller; });
    updater.install(); QVERIFY(launched.isEmpty());
    updater.check(true, true); QTRY_COMPARE(updater.state().value("status").toString(), "available");
    updater.download(); QVERIFY(updater.state().value("installAfterDownload").toBool());
    QTRY_COMPARE(updater.state().value("status").toString(), "ready");
    QVERIFY(updater.state().value("installAfterDownload").toBool()); // Survives a web document replacement.
    QCOMPARE(updater.state().value("received").toLongLong(), 3);
    updater.install(true); QCOMPARE(updater.state().value("status").toString(), "ready"); QVERIFY(QFile::exists(launched));
    QVERIFY(!updater.state().value("installAfterDownload").toBool());
    updater.install(true); QCOMPARE(launches, 1); // A queued duplicate ready signal cannot relaunch it.
    updater.install(); QCOMPARE(launches, 2); // An installer wizard can be canceled after launch.
    QFile file(launched); QVERIFY(file.open(QIODevice::WriteOnly)); file.write("abd"); file.close();
    launched.clear(); updater.install(); QVERIFY(launched.isEmpty()); QCOMPARE(launches, 2);
    QCOMPARE(updater.state().value("status").toString(), "error");
  }
  void rejectsDamagedDownloadThenAllowsRetry()
  {
    QTemporaryDir dir; FixtureNetwork network; network.responses = {{metadata()}, {"bad"}, {"abc"}};
    AppUpdater updater("1.0.0", AppUpdatePolicy::Package::WindowsInstaller, dir.filePath("cache"), dir.filePath("skip.json"), &network, {});
    updater.check(true, true); QTRY_COMPARE(updater.state().value("status").toString(), "available");
    updater.download(); QTRY_COMPARE(updater.state().value("status").toString(), "error");
    QVERIFY(!updater.state().value("error").toString().isEmpty());
    QCOMPARE(updater.state().value("version").toString(), "2.0.0");
    updater.download(); QTRY_COMPARE(updater.state().value("status").toString(), "ready");
  }
  void rejectsInsecureRedirectsAndOversizedMetadata()
  {
    QTemporaryDir dir; FixtureNetwork network; network.responses = {{{}, 302, QUrl("http://api.github.com/downgrade")}, {QByteArray(AppUpdatePolicy::MaximumMetadataBytes + 1, ' ')}};
    AppUpdater updater("1.0.0", AppUpdatePolicy::Package::WindowsInstaller, dir.filePath("cache"), dir.filePath("skip.json"), &network, {});
    updater.check(true, true); QTRY_COMPARE(updater.state().value("status").toString(), "error");
    QCOMPARE(network.requests.size(), 1);
    updater.check(true, true); QTRY_COMPARE(updater.state().value("status").toString(), "error");
    QVERIFY(updater.state().value("version").toString().isEmpty());
  }
  void cancelReturnsToAvailableAndCannotInstallPartial()
  {
    QTemporaryDir dir; FixtureNetwork network; network.responses = {{metadata()}, {"ab", 200, {}, true}, {"abc"}};
    bool launched = false;
    AppUpdater updater("1.0.0", AppUpdatePolicy::Package::WindowsInstaller, dir.filePath("cache"), dir.filePath("skip.json"), &network,
      [&](const QString&, AppUpdatePolicy::Package) { launched = true; return true; });
    updater.check(true, true); QTRY_COMPARE(updater.state().value("status").toString(), "available");
    updater.download(); QCOMPARE(updater.state().value("status").toString(), "downloading");
    updater.cancel(); QCOMPARE(updater.state().value("status").toString(), "available");
    QVERIFY(!updater.state().value("installAfterDownload").toBool());
    updater.install(); QVERIFY(!launched);
    updater.download(); QTRY_COMPARE(updater.state().value("status").toString(), "ready");
    // Mutating the completed package must never reach the OS launcher.
    QDirIterator files(dir.filePath("cache"), {"*.exe"}, QDir::Files, QDirIterator::Subdirectories);
    QVERIFY(files.hasNext()); QFile file(files.next()); QVERIFY(file.open(QIODevice::WriteOnly)); file.write("xyz"); file.close();
    updater.install(); QCOMPARE(updater.state().value("status").toString(), "error"); QVERIFY(!launched);
  }
};
QTEST_GUILESS_MAIN(TestAppUpdater)
#include "test_appupdater.moc"
