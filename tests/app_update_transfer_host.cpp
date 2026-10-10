// Exercises the real updater and QNetworkAccessManager. Only endpoint routing
// and fixture CA trust are test seams; no installer is ever launched.
#include "system/AppUpdater.h"
#include <QCoreApplication>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkProxy>
#include <QSslCertificate>
#include <QSslConfiguration>
#include <QSslSocket>
#include <QTextStream>

class TransferNetwork : public QNetworkAccessManager
{
public:
  QUrl endpoint; QByteArray certificate; QJsonArray requests;
protected:
  QNetworkReply* createRequest(Operation operation, const QNetworkRequest& original, QIODevice* body) override
  {
    QNetworkRequest request(original);
    requests.append(QJsonObject{{"host", original.url().host()}, {"range", QString::fromLatin1(original.rawHeader("Range"))},
      {"ifRange", QString::fromLatin1(original.rawHeader("If-Range"))}});
    if (!endpoint.isEmpty())
    {
      auto url = endpoint;
      url.setPath(original.url().host() == "api.github.com" ? "/metadata" : "/package");
      request.setUrl(url);
      auto ssl = request.sslConfiguration();
      auto authorities = ssl.caCertificates(); authorities.append(QSslCertificate::fromData(certificate));
      ssl.setCaCertificates(authorities); request.setSslConfiguration(ssl);
    }
    return QNetworkAccessManager::createRequest(operation, request, body);
  }
};

int main(int argc, char** argv)
{
  QCoreApplication app(argc, argv);
  if (argc != 2) return 1;
  QFile optionsFile(QString::fromLocal8Bit(argv[1])); if (!optionsFile.open(QIODevice::ReadOnly)) return 1;
  const auto options = QJsonDocument::fromJson(optionsFile.readAll()).object();
  TransferNetwork network;
  network.endpoint = QUrl(options.value("endpoint").toString());
  if (!network.endpoint.isEmpty()) network.setProxy(QNetworkProxy::NoProxy);
  QFile cert(options.value("certificate").toString()); if (cert.open(QIODevice::ReadOnly)) network.certificate = cert.readAll();
  const auto root = options.value("cache").toString();
  AppUpdater updater(options.value("version").toString("2.4.4"), AppUpdatePolicy::Package::WindowsInstaller,
    root, root + "/preferences.json", &network, {});
  const auto cancelAt = options.value("cancelAt").toInteger(-1);
  bool done = false, started = false;
  QObject::connect(&updater, &AppUpdater::changed, &app, [&](const QVariantMap& state) {
    if (done) return;
    const auto status = state.value("status").toString();
    if (status == "available" && !started)
    { started = true; QTimer::singleShot(0, &updater, [&] { updater.download(); }); }
    if (status == "downloading" && cancelAt >= 0 && state.value("received").toLongLong() >= cancelAt)
    {
      done = true;
      // Queue cancellation so changed() reentrancy doesn't outlive receive().
      QTimer::singleShot(0, &updater, [&] {updater.cancel(); app.exit(0);});
    }
    if (status == "ready" || status == "error" || status == "current") { done = true; app.exit(0); }
  });
  QTimer::singleShot(options.value("timeoutMs").toInt(90000), &app, [&] { updater.cancel(); app.exit(3); });
  QTimer::singleShot(0, &updater, [&] {updater.check(true, true);});
  const int result = app.exec();
  auto report = QJsonObject::fromVariantMap(updater.state());
  report["requests"] = network.requests;
  report["tls"] = QSslSocket::activeBackend();
  report["tlsVersion"] = QSslSocket::sslLibraryVersionString();
  QTextStream(stdout) << QJsonDocument(report).toJson(QJsonDocument::Compact) << Qt::endl;
  return result;
}
