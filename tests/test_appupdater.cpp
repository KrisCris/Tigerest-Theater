#include <QtTest>
#include <QJsonDocument>
#include <QJsonObject>
#include <QCryptographicHash>
#include <QTemporaryDir>
#include <QTimer>
#include "system/AppUpdater.h"

// Network I/O is the external boundary. The real updater still owns request
// policy, parsing, state transitions, filesystem writes and digest validation.
struct Response { QByteArray bytes; int status = 200; QUrl redirect; bool held = false;
  QList<QPair<QByteArray, QByteArray>> headers;
  QNetworkReply::NetworkError error = QNetworkReply::NoError;
};
class FixtureReply : public QNetworkReply
{
public:
  FixtureReply(const QNetworkRequest& request, Response response, QObject* parent) : QNetworkReply(parent), m_response(response)
  {
    setRequest(request); setUrl(request.url()); setOperation(QNetworkAccessManager::GetOperation);
    setAttribute(QNetworkRequest::HttpStatusCodeAttribute, response.status);
    for (const auto& header : response.headers) setRawHeader(header.first, header.second);
    if (!response.redirect.isEmpty()) setAttribute(QNetworkRequest::RedirectionTargetAttribute, response.redirect);
    open(QIODevice::ReadOnly | QIODevice::Unbuffered);
    if (!response.held) QTimer::singleShot(0, this, [this] { complete(); });
  }
  void complete() { if (isFinished()) return; emit readyRead(); if (m_response.error != NoError) setError(m_response.error, "Interrupted by fixture"); setFinished(true); emit finished(); }
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
  QList<QNetworkRequest> requestDetails;
protected:
  QNetworkReply* createRequest(Operation, const QNetworkRequest& request, QIODevice*) override
  {
    requests.append(request.url());
    requestDetails.append(request);
    return new FixtureReply(request, responses.isEmpty() ? Response{{}, 503} : responses.takeFirst(), this);
  }
};
static const QString Release = "https://github.com/Tigerest/Tigerest-Theater/releases/download/v2.0.0/TigerestTheater-2.0.0-x64.exe";
static QByteArray metadata()
{
  return R"([{"tag_name":"v2.0.0","draft":false,"prerelease":false,"body":"Notes","assets":[{"name":"TigerestTheater-2.0.0-x64.exe","size":3,"digest":"sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad","browser_download_url":"https://github.com/Tigerest/Tigerest-Theater/releases/download/v2.0.0/TigerestTheater-2.0.0-x64.exe"}]}])";
}
class TestAppUpdater : public QObject
{
  Q_OBJECT
private slots:
  void repeatedPrefixesDoNotRefillRetryBudget_data()
  {
    QTest::addColumn<QByteArray>("etag");
    QTest::newRow("missing-etag") << QByteArray();
    QTest::newRow("weak-etag") << QByteArray("W/\"asset\"");
    QTest::newRow("ignored-range") << QByteArray("\"asset\"");
  }
  void repeatedPrefixesDoNotRefillRetryBudget()
  {
    QFETCH(QByteArray, etag);
    QTemporaryDir dir; FixtureNetwork network;
    network.responses = {{metadata()},
      {"ab", 200, {}, false, {{"ETag", etag}}, QNetworkReply::RemoteHostClosedError},
      {"a", 200, {}, false, {{"ETag", etag}}, QNetworkReply::RemoteHostClosedError},
      {"ab", 200, {}, false, {{"ETag", etag}}, QNetworkReply::RemoteHostClosedError}};
    AppUpdater updater("1.0.0", AppUpdatePolicy::Package::WindowsInstaller, dir.filePath("cache"), dir.filePath("skip.json"), &network, {});
    updater.check(true, true); QTRY_COMPARE(updater.state().value("status").toString(), "available"); updater.download();
    QTRY_VERIFY_WITH_TIMEOUT(network.requests.size() >= 4, 10000);
    QCOMPARE(updater.state().value("retryAttempt").toInt(), 3);
    updater.cancel();
  }
  void progressRefillsRetryBudgetAndCompletesAfterRepeatedDisconnects()
  {
    QTemporaryDir dir; FixtureNetwork network;
    auto releases = QJsonDocument::fromJson(metadata()).array();
    auto release = releases.first().toObject(); auto assets = release.value("assets").toArray(); auto asset = assets.first().toObject();
    asset["size"] = 8;
    asset["digest"] = "sha256:" + QString::fromLatin1(QCryptographicHash::hash("abcdefgh", QCryptographicHash::Sha256).toHex());
    assets[0] = asset; release["assets"] = assets; releases[0] = release;
    network.responses = {{QJsonDocument(releases).toJson()},
      {"a", 200, {}, false, {{"ETag", "\"asset\""}}, QNetworkReply::RemoteHostClosedError},
      {"b", 206, {}, false, {{"ETag", "\"asset\""}, {"Content-Range", "bytes 1-7/8"}}, QNetworkReply::RemoteHostClosedError},
      {"c", 206, {}, false, {{"ETag", "\"asset\""}, {"Content-Range", "bytes 2-7/8"}}, QNetworkReply::RemoteHostClosedError},
      {"d", 206, {}, false, {{"ETag", "\"asset\""}, {"Content-Range", "bytes 3-7/8"}}, QNetworkReply::RemoteHostClosedError},
      {"e", 206, {}, false, {{"ETag", "\"asset\""}, {"Content-Range", "bytes 4-7/8"}}, QNetworkReply::RemoteHostClosedError},
      {"f", 206, {}, false, {{"ETag", "\"asset\""}, {"Content-Range", "bytes 5-7/8"}}, QNetworkReply::RemoteHostClosedError},
      {"g", 206, {}, false, {{"ETag", "\"asset\""}, {"Content-Range", "bytes 6-7/8"}}, QNetworkReply::RemoteHostClosedError},
      {"h", 206, {}, false, {{"ETag", "\"asset\""}, {"Content-Range", "bytes 7-7/8"}}}};
    AppUpdater updater("1.0.0", AppUpdatePolicy::Package::WindowsInstaller, dir.filePath("cache"), dir.filePath("skip.json"), &network, {});
    updater.check(true, true); QTRY_COMPARE(updater.state().value("status").toString(), "available"); updater.download();
    QTRY_VERIFY_WITH_TIMEOUT(updater.state().value("status") == "ready" || updater.state().value("status") == "error", 30000);
    QCOMPARE(updater.state().value("status").toString(), "ready");
    QCOMPARE(network.requests.size(), 9);
    QCOMPARE(network.requestDetails.last().rawHeader("Range"), QByteArray("bytes=7-"));
    QCOMPARE(updater.state().value("received").toLongLong(), 8);
  }
  void synchronousPauseDoesNotStartAnOrphanRequest()
  {
    QTemporaryDir dir; FixtureNetwork network; network.responses = {{metadata()}, {"abc"}};
    AppUpdater updater("1.0.0", AppUpdatePolicy::Package::WindowsInstaller, dir.filePath("cache"), dir.filePath("skip.json"), &network, {});
    updater.check(true, true); QTRY_COMPARE(updater.state().value("status").toString(), "available");
    connect(&updater, &AppUpdater::changed, &updater, [&](const QVariantMap& state) {
      if (state.value("status") == "downloading") updater.cancel();
    });
    updater.download(); QCOMPARE(network.requests.size(), 1);
    QCOMPARE(updater.state().value("status").toString(), "available");
  }
  void completedPackageCanBeReusedWhileFirstInstanceIsOpen()
  {
    QTemporaryDir dir; FixtureNetwork firstNetwork, secondNetwork;
    firstNetwork.responses = {{metadata()}, {"abc"}}; secondNetwork.responses = {{metadata()}};
    AppUpdater first("1.0.0", AppUpdatePolicy::Package::WindowsInstaller, dir.filePath("cache"), dir.filePath("a.json"), &firstNetwork, {});
    AppUpdater second("1.0.0", AppUpdatePolicy::Package::WindowsInstaller, dir.filePath("cache"), dir.filePath("b.json"), &secondNetwork, {});
    first.check(true, true); QTRY_COMPARE(first.state().value("status").toString(), "available"); first.download();
    QTRY_COMPARE(first.state().value("status").toString(), "ready");
    second.check(true, true); QTRY_COMPARE(second.state().value("status").toString(), "available"); second.download();
    QCOMPARE(second.state().value("status").toString(), "ready"); QCOMPARE(secondNetwork.requests.size(), 1);
  }
  void retryBudgetStopsAfterConsecutiveAttemptsWithoutProgress()
  {
    QTemporaryDir dir; FixtureNetwork network;
    network.responses = {{metadata()}, {{}, 503}, {{}, 503}, {{}, 503}, {{}, 503}, {{}, 503}, {{}, 503}};
    AppUpdater updater("1.0.0", AppUpdatePolicy::Package::WindowsInstaller, dir.filePath("cache"), dir.filePath("skip.json"), &network, {});
    updater.check(true, true); QTRY_COMPARE(updater.state().value("status").toString(), "available"); updater.download();
    QTRY_COMPARE_WITH_TIMEOUT(updater.state().value("status").toString(), "error", 80000);
    QCOMPARE(network.requests.size(), 7); QCOMPARE(updater.state().value("retryAttempt").toInt(), 5);
    QVERIFY(!updater.state().value("installAfterDownload").toBool());
  }
  void cacheLockPreventsConcurrentWriters()
  {
    QTemporaryDir dir;
    FixtureNetwork firstNetwork, secondNetwork;
    firstNetwork.responses = {{metadata()}, {"a", 200, {}, true, {{"ETag", "\"asset\""}}}};
    secondNetwork.responses = {{metadata()}};
    AppUpdater first("1.0.0", AppUpdatePolicy::Package::WindowsInstaller, dir.filePath("locked"), dir.filePath("a.json"), &firstNetwork, {});
    AppUpdater second("1.0.0", AppUpdatePolicy::Package::WindowsInstaller, dir.filePath("locked"), dir.filePath("b.json"), &secondNetwork, {});
    first.check(true, true); QTRY_COMPARE(first.state().value("status").toString(), "available"); first.download();
    second.check(true, true); QTRY_COMPARE(second.state().value("status").toString(), "available"); second.download();
    QCOMPARE(second.state().value("status").toString(), "error");
    QCOMPARE(secondNetwork.requests.size(), 1);
    first.cancel();
  }
  void verifiedCachedPackageSurvivesRestartWithoutRedownload()
  {
    QTemporaryDir dir; FixtureNetwork network; network.responses = {{metadata()}, {"abc"}};
    {
      AppUpdater updater("1.0.0", AppUpdatePolicy::Package::WindowsInstaller, dir.filePath("cache"), dir.filePath("skip.json"), &network, {});
      updater.check(true, true); QTRY_COMPARE(updater.state().value("status").toString(), "available");
      updater.download(); QTRY_COMPARE(updater.state().value("status").toString(), "ready");
    }
    network.responses = {{metadata()}};
    AppUpdater restarted("1.0.0", AppUpdatePolicy::Package::WindowsInstaller, dir.filePath("cache"), dir.filePath("skip.json"), &network, {});
    restarted.check(true, true); QTRY_COMPARE(restarted.state().value("status").toString(), "available");
    restarted.download(); QCOMPARE(restarted.state().value("status").toString(), "ready");
    QCOMPARE(network.requests.size(), 3);
  }
  void interruptedTransferResumesExactRangeAndVerifies()
  {
    QTemporaryDir dir; FixtureNetwork network;
    network.responses = {{metadata()}, {"a", 200, {}, false, {{"ETag", "\"asset-v1\""}, {"Content-Length", "3"}}, QNetworkReply::RemoteHostClosedError},
      {"bc", 206, {}, false, {{"ETag", "\"asset-v1\""}, {"Content-Range", "bytes 1-2/3"}, {"Content-Length", "2"}}}};
    AppUpdater updater("1.0.0", AppUpdatePolicy::Package::WindowsInstaller, dir.filePath("cache"), dir.filePath("skip.json"), &network, {});
    updater.check(true, true); QTRY_COMPARE(updater.state().value("status").toString(), "available");
    updater.download(); QTRY_COMPARE_WITH_TIMEOUT(updater.state().value("status").toString(), "ready", 5000);
    QCOMPARE(network.requestDetails.size(), 3);
    QCOMPARE(network.requestDetails.last().rawHeader("Range"), QByteArray("bytes=1-"));
    QCOMPARE(network.requestDetails.last().rawHeader("If-Range"), QByteArray("\"asset-v1\""));
    QCOMPARE(updater.state().value("received").toLongLong(), 3);
  }
  void restartKeepsPartialAndIgnoredRangeRestartsSafely()
  {
    QTemporaryDir dir; FixtureNetwork network;
    network.responses = {{metadata()}, {"a", 200, {}, true, {{"ETag", "\"asset-v1\""}, {"Content-Length", "3"}}}};
    {
      AppUpdater updater("1.0.0", AppUpdatePolicy::Package::WindowsInstaller, dir.filePath("cache"), dir.filePath("skip.json"), &network, {});
      updater.check(true, true); QTRY_COMPARE(updater.state().value("status").toString(), "available");
      updater.download(); FixtureReply *reply = nullptr;
      // The metadata reply is deleteLater'd before QTRY returns; locate the pending package reply.
      for (auto *item : network.findChildren<QNetworkReply*>()) if (!item->isFinished()) reply = static_cast<FixtureReply*>(item);
      QVERIFY(reply); emit reply->readyRead();
      QCOMPARE(updater.state().value("received").toLongLong(), 1);
      updater.cancel(); QCOMPARE(updater.state().value("received").toLongLong(), 1);
    }
    network.responses = {{metadata()}, {"abc", 200, {}, false, {{"ETag", "\"asset-v2\""}, {"Content-Length", "3"}}}};
    AppUpdater restarted("1.0.0", AppUpdatePolicy::Package::WindowsInstaller, dir.filePath("cache"), dir.filePath("skip.json"), &network, {});
    restarted.check(true, true); QTRY_COMPARE(restarted.state().value("status").toString(), "available");
    QCOMPARE(restarted.state().value("received").toLongLong(), 1);
    restarted.download(); QTRY_COMPARE(restarted.state().value("status").toString(), "ready");
    QCOMPARE(network.requestDetails.last().rawHeader("Range"), QByteArray("bytes=1-"));
    QCOMPARE(restarted.state().value("received").toLongLong(), 3);
  }
  void invalidRangeNeverAppendsAndCancellationStopsRetry()
  {
    QTemporaryDir dir; FixtureNetwork network;
    network.responses = {{metadata()}, {"a", 200, {}, false, {{"ETag", "\"asset-v1\""}}, QNetworkReply::RemoteHostClosedError},
      {"bc", 206, {}, false, {{"ETag", "\"asset-v1\""}, {"Content-Range", "bytes 0-1/3"}}}, {"abc"}};
    AppUpdater updater("1.0.0", AppUpdatePolicy::Package::WindowsInstaller, dir.filePath("cache"), dir.filePath("skip.json"), &network, {});
    updater.check(true, true); QTRY_COMPARE(updater.state().value("status").toString(), "available"); updater.download();
    QTRY_COMPARE_WITH_TIMEOUT(updater.state().value("status").toString(), "ready", 5000);
    QCOMPARE(network.requestDetails.size(), 4);
    QVERIFY(network.requestDetails.last().rawHeader("Range").isEmpty());
    network.responses = {{metadata()}, {"a", 200, {}, false, {{"ETag", "\"asset-v1\""}}, QNetworkReply::RemoteHostClosedError}};
    AppUpdater other("1.0.0", AppUpdatePolicy::Package::WindowsInstaller, dir.filePath("other"), dir.filePath("other-skip.json"), &network, {});
    other.check(true, true); QTRY_COMPARE(other.state().value("status").toString(), "available"); other.download();
    QTRY_VERIFY(other.state().value("retrying").toBool());
    other.cancel(); const auto count = network.requests.size();
    QTest::qWait(1200); QCOMPARE(network.requests.size(), count);
    QCOMPARE(other.state().value("received").toLongLong(), 1);
    QVERIFY(!other.state().value("installAfterDownload").toBool());
  }
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
  void rememberedReleaseShowsAtOnceAndRefreshesSilently()
  {
    QTemporaryDir dir; FixtureNetwork network;
    auto releases = QJsonDocument::fromJson(metadata()).array();
    auto release = releases.first().toObject();
    release["body"] = R"(Notes <!-- tigerest-mirrors {"baidu":"https://pan.baidu.com/s/1AbCdEf?pwd=ab12"} -->)";
    releases[0] = release;
    const auto launch = [&] { return std::make_unique<AppUpdater>("1.0.0", AppUpdatePolicy::Package::WindowsInstaller,
      dir.filePath("cache"), dir.filePath("prefs.json"), &network, AppUpdater::Launcher{}); };
    network.responses = {{QJsonDocument(releases).toJson()}};
    {
      auto first = launch(); first->check(false, true);
      QCOMPARE(first->state().value("status").toString(), "checking");
      QTRY_COMPARE(first->state().value("status").toString(), "available");
      QVERIFY(!first->state().value("cached").toBool());
      QCOMPARE(first->state().value("mirrors").toMap().value("baidu").toString(), "https://pan.baidu.com/s/1AbCdEf?pwd=ab12");
    }
    // Next launch: shown before the network answers; a failed refresh keeps it.
    network.responses = {{{}, 503}};
    auto second = launch(); QStringList statuses;
    connect(second.get(), &AppUpdater::changed, this, [&](const QVariantMap& state) { statuses.append(state.value("status").toString()); });
    second->check(false, true);
    QCOMPARE(second->state().value("status").toString(), "available");
    QVERIFY(second->state().value("cached").toBool());
    QCOMPARE(second->state().value("notes").toString(), "Notes");
    QCOMPARE(network.requests.size(), 2);
    QTest::qWait(100);
    QCOMPARE(statuses, QStringList{"available"});
    // A withdrawn release is forgotten by the refresh.
    network.responses = {{"[]"}};
    auto third = launch(); third->check(false, true);
    QCOMPARE(third->state().value("status").toString(), "available");
    QTRY_COMPARE(third->state().value("status").toString(), "current");
    network.responses = {{"[]", 200, {}, true}};
    auto fourth = launch(); fourth->check(false, true);
    QCOMPARE(fourth->state().value("status").toString(), "checking");
    fourth->cancel();
  }
  void netdiskButtonsOpenTheVersionFolder()
  {
    QTemporaryDir dir; FixtureNetwork network;
    network.responses = {{metadata()},
      {R"({"data":{"stoken":"a+b/c="}})"},
      {R"({"data":{"list":[{"fid":"f1","file_name":"notes.txt","dir":false},{"fid":"root1","file_name":"Tigerest-Theater","dir":true}]}})"},
      {R"({"data":{"list":[{"fid":"f204","file_name":"2.0.4","dir":true},{"fid":"f200","file_name":"2.0.0","dir":true}]}})"},
      {"<html></html>", 200, {}, false, {{"Set-Cookie", "BAIDUID=abc123; path=/; domain=.baidu.com"}}},
      {R"({"errno":0,"list":[{"isdir":1,"server_filename":"Tigerest-Theater","path":"/software/Tigerest-Theater"}]})"},
      {R"({"errno":0,"list":[{"isdir":"1","server_filename":"2.0.0","path":"/software/Tigerest-Theater/2.0.0"}]})"}};
    AppUpdater updater("1.0.0", AppUpdatePolicy::Package::WindowsInstaller, dir.filePath("cache"), dir.filePath("prefs.json"), &network, {});
    QList<QUrl> opened;
    connect(&updater, &AppUpdater::openUrl, this, [&](const QUrl& url) { opened.append(url); });
    updater.check(true, true); QTRY_COMPARE(updater.state().value("status").toString(), "available");
    updater.openMirror("quark");
    updater.openMirror("quark");
    QTRY_COMPARE(opened.size(), 1);
    QCOMPARE(opened.first().toString(QUrl::FullyEncoded), "https://pan.quark.cn/s/88e6f7a795b4#/list/share/f200");
    QCOMPARE(network.requests.at(1).toString(), "https://drive-h.quark.cn/1/clouddrive/share/sharepage/token?pr=ucpro&fr=pc");
    QVERIFY(network.requests.at(2).toString(QUrl::FullyEncoded).contains("stoken=a%2Bb%2Fc%3D&pdir_fid=0&"));
    QVERIFY(network.requests.at(3).toString(QUrl::FullyEncoded).contains("&pdir_fid=root1&"));
    updater.openMirror("baidu");
    QTRY_COMPARE(opened.size(), 2);
    QCOMPARE(opened.last().toString(QUrl::FullyEncoded),
      "https://pan.baidu.com/s/58azzOU4piiB3miyZqA1dig#list/path=%2Fsoftware%2FTigerest-Theater%2F2.0.0");
    QCOMPARE(network.requests.at(4), QUrl("https://pan.baidu.com/s/58azzOU4piiB3miyZqA1dig"));
    QCOMPARE(network.requests.at(5).toString(QUrl::FullyEncoded),
      "https://pan.baidu.com/share/list?shorturl=8azzOU4piiB3miyZqA1dig&page=1&num=100&web=1&root=1");
    QCOMPARE(network.requests.at(6).toString(QUrl::FullyEncoded),
      "https://pan.baidu.com/share/list?shorturl=8azzOU4piiB3miyZqA1dig&page=1&num=100&web=1&dir=%2Fsoftware%2FTigerest-Theater&root=0");
    const auto cookies = network.requestDetails.at(6).header(QNetworkRequest::CookieHeader).value<QList<QNetworkCookie>>();
    QCOMPARE(cookies.size(), 1); QCOMPARE(cookies.first().name(), "BAIDUID"); QCOMPARE(cookies.first().value(), "abc123");
    QCOMPARE(network.requests.size(), 7);
  }
  void netdiskButtonsFallBackToTheShare()
  {
    QTemporaryDir dir; FixtureNetwork network;
    network.responses = {{metadata()},
      {R"({"data":{"stoken":"token"}})"}, {R"({"data":{"list":[{"fid":"f300","file_name":"3.0.0","dir":true}]}})"}, {"{}"},
      {{}, 503},
      {"<html></html>"}, {R"({"errno":9019,"errmsg":"need verify"})"}};
    AppUpdater updater("1.0.0", AppUpdatePolicy::Package::WindowsInstaller, dir.filePath("cache"), dir.filePath("prefs.json"), &network, {});
    QList<QUrl> opened;
    connect(&updater, &AppUpdater::openUrl, this, [&](const QUrl& url) { opened.append(url); });
    updater.openMirror("quark");
    QTest::qWait(50); QVERIFY(opened.isEmpty());
    updater.check(true, true); QTRY_COMPARE(updater.state().value("status").toString(), "available");
    // A missing version folder, an unreachable service and a refused listing all open the share.
    for (const char* kind : {"quark", "quark", "baidu"})
    {
      const int count = opened.size();
      updater.openMirror(kind);
      QTRY_COMPARE(opened.size(), count + 1);
      QCOMPARE(opened.last(), QUrl(QString(kind) == "quark" ? AppUpdatePolicy::DefaultQuarkShare : AppUpdatePolicy::DefaultBaiduShare));
    }
    updater.openMirror("other");
    QTest::qWait(50); QCOMPARE(opened.size(), 3);
  }
  void liveSharesResolveTheVersionFolder()
  {
    // Reads the production shares anonymously; run with TIGEREST_LIVE_NETDISK=<released version>.
    const QString version = qEnvironmentVariable("TIGEREST_LIVE_NETDISK");
    if (version.isEmpty()) QSKIP("TIGEREST_LIVE_NETDISK is not set");
    QNetworkAccessManager network; NetdiskFolder folder(&network);
    for (const char* share : {AppUpdatePolicy::DefaultQuarkShare, AppUpdatePolicy::DefaultBaiduShare})
    {
      QUrl page;
      folder.resolve(QUrl(share), version, [&](const QUrl& url) { page = url; });
      QTRY_VERIFY_WITH_TIMEOUT(!page.isEmpty(), 15000);
      qInfo().noquote() << page.toString(QUrl::FullyEncoded);
      QVERIFY2(page.hasFragment(), "version folder not found");
    }
  }
  void liveDownloadThroughTheFirstProxy()
  {
    // Downloads the latest Windows installer from GitHub's production release through the first accelerator and
    // verifies it against the API digest; run with TIGEREST_LIVE_PROXY=<a version older than the latest release>.
    const QString version = qEnvironmentVariable("TIGEREST_LIVE_PROXY");
    if (version.isEmpty()) QSKIP("TIGEREST_LIVE_PROXY is not set");
    QTemporaryDir dir; QNetworkAccessManager network;
    AppUpdater updater(version, AppUpdatePolicy::Package::WindowsInstaller, dir.filePath("cache"), dir.filePath("skip.json"), &network, {});
    QStringList sources;
    connect(&updater, &AppUpdater::changed, &updater, [&](const QVariantMap& state) {
      const auto source = state.value("source").toString();
      if (!source.isEmpty() && sources.value(sources.size() - 1) != source) sources << source;
    });
    updater.check(true, true); QTRY_COMPARE_WITH_TIMEOUT(updater.state().value("status").toString(), "available", 30000);
    QElapsedTimer clock; clock.start(); updater.download();
    QTRY_VERIFY_WITH_TIMEOUT(updater.state().value("status") == "ready" || updater.state().value("status") == "error", 600000);
    const auto bytes = updater.state().value("size").toLongLong();
    qInfo().noquote() << updater.state().value("version").toString() << bytes << "bytes in" << clock.elapsed() << "ms via" << sources.join(" -> ")
      << updater.state().value("error").toString();
    QCOMPARE(updater.state().value("status").toString(), "ready");
    QCOMPARE(sources.value(0), "gh-proxy.com");
  }
  void rememberedReleaseIsNotShownOnceInstalledOrIgnored()
  {
    QTemporaryDir dir; FixtureNetwork network; network.responses = {{metadata()}, {metadata(), 200, {}, true}, {metadata(), 200, {}, true}};
    {
      AppUpdater updater("1.0.0", AppUpdatePolicy::Package::WindowsInstaller, dir.filePath("cache"), dir.filePath("prefs.json"), &network, {});
      updater.check(false, true); QTRY_COMPARE(updater.state().value("status").toString(), "available");
    }
    AppUpdater installed("2.0.0", AppUpdatePolicy::Package::WindowsInstaller, dir.filePath("cache"), dir.filePath("prefs.json"), &network, {});
    installed.check(false, true); QCOMPARE(installed.state().value("status").toString(), "checking"); installed.cancel();
    {
      AppUpdater updater("1.0.0", AppUpdatePolicy::Package::WindowsInstaller, dir.filePath("cache"), dir.filePath("prefs.json"), &network, {});
      updater.check(false, true); QCOMPARE(updater.state().value("status").toString(), "available");
      updater.skip(); QCOMPARE(updater.state().value("status").toString(), "idle");
    }
    AppUpdater ignored("1.0.0", AppUpdatePolicy::Package::WindowsInstaller, dir.filePath("cache"), dir.filePath("prefs.json"), &network, {});
    ignored.check(false, true); QCOMPARE(ignored.state().value("status").toString(), "checking"); ignored.cancel();
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
    // The accelerated package fails GitHub's digest, so the release URL is tried alone; it fails too.
    QTemporaryDir dir; FixtureNetwork network; network.responses = {{metadata()}, {"bad"}, {"bad"}, {"abc"}};
    AppUpdater updater("1.0.0", AppUpdatePolicy::Package::WindowsInstaller, dir.filePath("cache"), dir.filePath("skip.json"), &network, {});
    updater.check(true, true); QTRY_COMPARE(updater.state().value("status").toString(), "available");
    updater.download(); QTRY_COMPARE(updater.state().value("status").toString(), "error");
    QVERIFY(!updater.state().value("error").toString().isEmpty());
    QCOMPARE(updater.state().value("version").toString(), "2.0.0");
    QCOMPARE(network.requests.mid(1), (QList<QUrl>{QUrl("https://gh-proxy.com/" + Release), QUrl(Release)}));
    QVERIFY(network.requestDetails.last().rawHeader("Range").isEmpty());
    updater.download(); QTRY_COMPARE(updater.state().value("status").toString(), "ready");
    QCOMPARE(network.requests.last(), QUrl("https://gh-proxy.com/" + Release));
  }
  void downloadsThroughTheProxiesBeforeTheReleaseUrl()
  {
    // A refusing and an unavailable accelerator are skipped; the release URL then delivers the package.
    QTemporaryDir dir; FixtureNetwork network; network.responses = {{metadata()}, {{}, 404}, {{}, 503}, {"abc"}};
    AppUpdater updater("1.0.0", AppUpdatePolicy::Package::WindowsInstaller, dir.filePath("cache"), dir.filePath("skip.json"), &network, {});
    QStringList sources;
    connect(&updater, &AppUpdater::changed, &updater, [&](const QVariantMap& state) {
      if (state.value("status") == "downloading" && sources.value(sources.size() - 1) != state.value("source").toString())
        sources << state.value("source").toString();
    });
    updater.check(true, true); QTRY_COMPARE(updater.state().value("status").toString(), "available");
    updater.download(); QTRY_COMPARE_WITH_TIMEOUT(updater.state().value("status").toString(), "ready", 15000);
    QCOMPARE(network.requests.mid(1), (QList<QUrl>{QUrl("https://gh-proxy.com/" + Release), QUrl("https://ghproxy.net/" + Release), QUrl(Release)}));
    QCOMPARE(sources, (QStringList{"gh-proxy.com", "ghproxy.net", "github.com"}));
  }
  void progressingProxyIsResumedAndMisbehavingProxyIsSkipped()
  {
    QTemporaryDir dir; FixtureNetwork network;
    network.responses = {{metadata()}, {"a", 200, {}, false, {{"ETag", "\"asset\""}}, QNetworkReply::RemoteHostClosedError},
      {"bc", 206, {}, false, {{"ETag", "\"asset\""}, {"Content-Range", "bytes 1-2/3"}}}};
    AppUpdater updater("1.0.0", AppUpdatePolicy::Package::WindowsInstaller, dir.filePath("cache"), dir.filePath("skip.json"), &network, {});
    updater.check(true, true); QTRY_COMPARE(updater.state().value("status").toString(), "available");
    updater.download(); QTRY_COMPARE_WITH_TIMEOUT(updater.state().value("status").toString(), "ready", 10000);
    QCOMPARE(network.requests.last(), QUrl("https://gh-proxy.com/" + Release));
    QCOMPARE(network.requestDetails.last().rawHeader("Range"), QByteArray("bytes=1-"));
    // An untrusted redirect or a wrong length from an accelerator moves on instead of failing the download.
    QTemporaryDir other; FixtureNetwork second;
    second.responses = {{metadata()}, {{}, 302, QUrl("http://example.com/package")}, {"abcd", 200, {}, false, {{"Content-Length", "4"}}}, {"abc"}};
    AppUpdater skipping("1.0.0", AppUpdatePolicy::Package::WindowsInstaller, other.filePath("cache"), other.filePath("skip.json"), &second, {});
    skipping.check(true, true); QTRY_COMPARE(skipping.state().value("status").toString(), "available");
    skipping.download(); QTRY_COMPARE_WITH_TIMEOUT(skipping.state().value("status").toString(), "ready", 15000);
    QCOMPARE(second.requests.mid(1), (QList<QUrl>{QUrl("https://gh-proxy.com/" + Release), QUrl("https://ghproxy.net/" + Release), QUrl(Release)}));
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
