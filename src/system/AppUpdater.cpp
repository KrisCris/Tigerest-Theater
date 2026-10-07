#include "AppUpdater.h"
#include <QDir>
#include <QFileInfo>
#include <QJsonDocument>
#include <QJsonObject>
#include <QSaveFile>
#include <QTimer>
#include <QUuid>

using AppUpdatePolicy::Package;

AppUpdater::AppUpdater(const QString& version, Package package, const QString& cacheDirectory,
                       const QString& preferencePath, QNetworkAccessManager* network, Launcher launcher, QObject* parent)
  : QObject(parent), m_currentVersion(version), m_package(package), m_cacheDirectory(cacheDirectory),
    m_preferencePath(preferencePath), m_network(network), m_launcher(std::move(launcher))
{
  m_state = {{"status", "idle"}, {"currentVersion", version}, {"version", ""},
    {"releaseUrl", "https://github.com/Tigerest/Tigerest-Theater/releases"}, {"notes", ""},
    {"size", qint64(0)}, {"received", qint64(0)}, {"error", ""}, {"manual", false}, {"deferred", false}, {"installAfterDownload", false},
    {"platform", package == Package::MacArm64 ? "macos" : package == Package::Unsupported ? "unsupported" : "windows"},
    {"installLabel", package == Package::WindowsInstaller ? "安装更新" : package == Package::WindowsPortable ? "打开 ZIP 更新包" : "打开 DMG 更新包"}};
}

AppUpdater::~AppUpdater()
{
  // An installer or archive viewer may still be using the verified package.
  if (m_packageOpened) m_readyPath.clear();
  clearTransfer();
}

QVariantMap AppUpdater::state() const { return m_state; }

void AppUpdater::publish(const QString& status, const QString& error)
{
  m_state["status"] = status;
  m_state["error"] = error;
  m_state["version"] = m_candidate.version;
  m_state["notes"] = m_candidate.notes;
  m_state["size"] = m_candidate.size;
  m_state["releaseUrl"] = m_candidate.valid() ? m_candidate.releaseUrl.toString() :
    QString("https://github.com/Tigerest/Tigerest-Theater/releases");
  emit changed(m_state);
}

void AppUpdater::clearTransfer()
{
  if (m_reply)
  {
    auto* reply = m_reply.data();
    m_reply.clear();
    disconnect(reply, nullptr, this, nullptr);
    reply->abort();
    reply->deleteLater();
  }
  if (m_file.isOpen()) m_file.close();
  if (!m_file.fileName().isEmpty()) QFile::remove(m_file.fileName());
  if (!m_readyPath.isEmpty()) QFile::remove(m_readyPath);
  if (!m_downloadDirectory.isEmpty()) QDir().rmdir(m_downloadDirectory);
  m_file.setFileName(QString());
  m_readyPath.clear();
  m_downloadDirectory.clear();
  m_packageOpened = false;
  m_metadata.clear();
  m_state["received"] = qint64(0);
  m_state["installAfterDownload"] = false;
}

void AppUpdater::check(bool manual, bool enabled)
{
  if (!manual)
  {
    if (m_automaticAttempted) return;
    m_automaticAttempted = true;
    if (!enabled) return;
  }
  // A manual check can race the document's startup hook. It already satisfies
  // this process's automatic check and must retain its explicit result UI.
  if (manual) m_automaticAttempted = true;
  m_state["manual"] = manual;
  if (manual) m_state["deferred"] = false;
  const QString status = m_state.value("status").toString();
  if (status == "checking" || status == "downloading" || status == "ready" || status == "installing")
  {
    emit changed(m_state);
    return;
  }
  clearTransfer();
  m_candidate = {};
  if (m_package == Package::Unsupported)
  {
    publish("error", "此平台暂不支持应用内更新，请在发行页面查看可用版本。");
    return;
  }
  publish("checking");
  request(QUrl("https://api.github.com/repos/Tigerest/Tigerest-Theater/releases?per_page=30"), true);
}

void AppUpdater::request(const QUrl& url, bool metadata, int redirects)
{
  QNetworkRequest request(url);
  request.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::ManualRedirectPolicy);
  request.setHeader(QNetworkRequest::UserAgentHeader, "Tigerest-Theater-Updater/" + m_currentVersion);
  request.setRawHeader("Accept", metadata ? "application/vnd.github+json" : "application/octet-stream");
  request.setRawHeader("Accept-Encoding", "identity");
  if (metadata) request.setRawHeader("X-GitHub-Api-Version", "2022-11-28");
  request.setTransferTimeout(30000);
  auto* reply = m_network->get(request);
  m_reply = reply;
  reply->setReadBufferSize(128 * 1024);
  connect(reply, &QIODevice::readyRead, this, [this, reply, metadata] { receive(reply, metadata); });
  connect(reply, &QNetworkReply::finished, this, [this, reply, metadata, redirects] { finish(reply, metadata, redirects); });
  QTimer::singleShot(metadata ? 30000 : 30 * 60 * 1000, reply, [this, reply] {
    if (m_reply == reply) fail("更新请求超时，请检查网络后重试。");
  });
}

void AppUpdater::receive(QNetworkReply* reply, bool metadata)
{
  if (m_reply != reply || reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt() != 200) return;
  const qint64 maximum = metadata ? AppUpdatePolicy::MaximumMetadataBytes : m_candidate.size;
  bool hasLength = false;
  const qint64 contentLength = reply->header(QNetworkRequest::ContentLengthHeader).toLongLong(&hasLength);
  if (hasLength && (contentLength < 0 || contentLength > maximum || (!metadata && contentLength != maximum)))
  {
    fail("更新响应大小不符合预期。");
    return;
  }
  while (reply->bytesAvailable() > 0)
  {
    const QByteArray bytes = reply->read(64 * 1024);
    if (bytes.isEmpty()) break;
    const qint64 received = metadata ? m_metadata.size() : m_file.size();
    if (bytes.size() > maximum - received)
    {
      fail("更新响应超过允许的大小。");
      return;
    }
    if (metadata) m_metadata.append(bytes);
    else
    {
      if (m_file.write(bytes) != bytes.size())
      {
        fail("无法写入更新文件，请检查可用空间和目录权限。");
        return;
      }
      m_state["received"] = m_file.size();
    }
  }
  if (!metadata) emit changed(m_state);
}

void AppUpdater::finish(QNetworkReply* reply, bool metadata, int redirects)
{
  if (m_reply != reply) return;
  receive(reply, metadata);
  if (m_reply != reply) return;
  const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
  if (status >= 300 && status < 400)
  {
    const QUrl target = reply->url().resolved(reply->attribute(QNetworkRequest::RedirectionTargetAttribute).toUrl());
    const QString host = target.host().toLower();
    const bool knownHost = metadata ? host == "api.github.com" :
      (host == "github.com" || host == "release-assets.githubusercontent.com" || host == "objects.githubusercontent.com");
    if (redirects >= 5 || !target.isValid() || target.scheme() != "https" || !knownHost ||
        !target.userInfo().isEmpty() || target.hasFragment() || (target.port() != -1 && target.port() != 443))
    {
      fail("更新服务器返回了不安全或过多的重定向。");
      return;
    }
    m_reply.clear();
    reply->deleteLater();
    request(target, metadata, redirects + 1);
    return;
  }
  if (reply->error() != QNetworkReply::NoError || status != 200)
  {
    fail(status == 403 || status == 429 ? "GitHub 请求受限，请稍后重试。" : "无法获取更新，请检查网络后重试。");
    return;
  }
  m_reply.clear();
  reply->deleteLater();
  if (metadata)
  {
    QJsonParseError parseError;
    const auto document = QJsonDocument::fromJson(m_metadata, &parseError);
    m_metadata.clear();
    if (parseError.error != QJsonParseError::NoError || !document.isArray() || document.array().size() > 30)
    {
      fail("更新服务器返回了无效的版本信息。");
      return;
    }
    m_candidate = AppUpdatePolicy::select(document.array(), m_currentVersion, m_package);
    if (m_candidate.valid() && !m_state.value("manual").toBool() && m_candidate.version == skippedVersion())
    {
      m_candidate = {};
      publish("idle");
      return;
    }
    publish(m_candidate.valid() ? "available" : "current");
    return;
  }
  const bool flushed = m_file.flush();
  m_file.close();
  if (!flushed || !AppUpdatePolicy::verifyFile(m_file.fileName(), m_candidate))
  {
    fail("更新文件长度或 SHA-256 校验失败，请重新下载。");
    return;
  }
  m_readyPath = m_downloadDirectory + "/" + m_candidate.fileName;
  if (!QFile::rename(m_file.fileName(), m_readyPath))
  {
    fail("无法保存已校验的更新文件。");
    return;
  }
  publish("ready");
}

void AppUpdater::fail(const QString& message)
{
  clearTransfer();
  publish("error", message);
}

void AppUpdater::download()
{
  const QString status = m_state.value("status").toString();
  if (!m_candidate.valid() || (status != "available" && status != "error")) return;
  clearTransfer();
  m_state["manual"] = true;
  m_state["deferred"] = false;
  m_state["installAfterDownload"] = true;
  if (QFileInfo(m_cacheDirectory).isSymLink() || !QDir().mkpath(m_cacheDirectory))
  {
    fail("无法创建更新缓存目录。");
    return;
  }
  QFile::setPermissions(m_cacheDirectory, QFile::ReadOwner | QFile::WriteOwner | QFile::ExeOwner);
  m_downloadDirectory = m_cacheDirectory + "/" + QUuid::createUuid().toString(QUuid::WithoutBraces);
  if (!QDir().mkdir(m_downloadDirectory)) { fail("无法创建更新缓存目录。"); return; }
  QFile::setPermissions(m_downloadDirectory, QFile::ReadOwner | QFile::WriteOwner | QFile::ExeOwner);
  m_file.setFileName(m_downloadDirectory + "/" + m_candidate.fileName + ".part");
  if (!m_file.open(QIODevice::WriteOnly | QIODevice::NewOnly)) { fail("无法创建更新下载文件。"); return; }
  m_file.setPermissions(QFile::ReadOwner | QFile::WriteOwner);
  publish("downloading");
  request(m_candidate.downloadUrl, false);
}

void AppUpdater::install(bool automatic)
{
  if (automatic && !m_state.value("installAfterDownload").toBool()) return;
  if (m_state.value("status") != "ready") return;
  m_state["installAfterDownload"] = false;
  if (!AppUpdatePolicy::verifyFile(m_readyPath, m_candidate))
  {
    fail("更新文件已被修改或丢失，请重新下载。");
    return;
  }
  publish("installing");
  if (!m_launcher || !m_launcher(m_readyPath, m_package))
  {
    // Keep the verified download available if UAC or the OS opener is canceled.
    publish("ready", "未能打开更新包，请重试。");
    return;
  }
  m_packageOpened = true;
  // Opening a package hands control to the OS; it does not prove installation.
  // Keep explicit reopening possible after a canceled installer/archive viewer.
  publish("ready");
}

void AppUpdater::cancel()
{
  const QString status = m_state.value("status").toString();
  if (status != "checking" && status != "downloading") return;
  clearTransfer();
  publish(m_candidate.valid() ? "available" : "idle");
}

QString AppUpdater::skippedVersion() const
{
  QFile file(m_preferencePath);
  if (!file.open(QIODevice::ReadOnly) || file.size() > 4096) return {};
  return QJsonDocument::fromJson(file.readAll()).object().value("skippedVersion").toString();
}

void AppUpdater::skip()
{
  if (!m_candidate.valid() || m_state.value("status") == "installing") return;
  QDir().mkpath(QFileInfo(m_preferencePath).absolutePath());
  QSaveFile file(m_preferencePath);
  const auto json = QJsonDocument(QJsonObject{{"skippedVersion", m_candidate.version}}).toJson();
  if (!file.open(QIODevice::WriteOnly) || file.write(json) != json.size() || !file.commit())
  {
    publish(m_state.value("status").toString(), "无法保存跳过版本设置。");
    return;
  }
  clearTransfer();
  m_candidate = {};
  m_state["deferred"] = true;
  publish("idle");
}

void AppUpdater::defer()
{
  m_state["deferred"] = true;
  m_state["installAfterDownload"] = false;
  emit changed(m_state);
}
