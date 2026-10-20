#include "NetdiskFolder.h"
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QRegularExpression>
#include <QStringList>
#include <QUrlQuery>

namespace {
constexpr qint64 MaximumResponseBytes = 1024 * 1024;
// The version folder sits at most one level below the shared folder.
constexpr int MaximumDepth = 1;
constexpr int MaximumListings = 8;
const QString QuarkApi = "https://drive-h.quark.cn/1/clouddrive/share/sharepage/";

QString query(const QList<QPair<QString, QString>>& items)
{
  QStringList parts;
  for (const auto& item : items) parts << item.first + '=' + QString::fromLatin1(QUrl::toPercentEncoding(item.second));
  return parts.join('&');
}
}

NetdiskFolder::NetdiskFolder(QNetworkAccessManager* network, QObject* parent) : QObject(parent), m_network(network)
{
  m_deadline.setSingleShot(true);
  m_deadline.setInterval(10000);
  connect(&m_deadline, &QTimer::timeout, this, [this] { finish(m_share); });
}

QUrl NetdiskFolder::quarkFolderPage(const QUrl& share, const QString& fid)
{
  QUrl page(share);
  page.setFragment("/list/share/" + fid);
  return page;
}

QUrl NetdiskFolder::baiduFolderPage(const QUrl& share, const QString& path)
{
  QUrl page(share);
  page.setFragment("list/path=" + QString::fromLatin1(QUrl::toPercentEncoding(path)), QUrl::StrictMode);
  return page;
}

void NetdiskFolder::resolve(const QUrl& share, const QString& version, Done done)
{
  m_done = nullptr;
  finish({});
  m_done = std::move(done);
  m_share = share;
  m_version = version;
  m_token.clear();
  m_cookies.clear();
  m_pending.clear();
  m_listings = 0;
  m_quark = share.host() == "pan.quark.cn";
  const auto id = QRegularExpression("^/s/([0-9A-Za-z_-]{6,64})$").match(share.path());
  const bool baidu = share.host() == "pan.baidu.com";
  if (share.scheme() != "https" || !id.hasMatch() || (!m_quark && !baidu) || version.isEmpty())
  {
    finish(share);
    return;
  }
  m_id = id.captured(1);
  m_deadline.start();
  const QString code = QUrlQuery(share).queryItemValue("pwd");
  if (m_quark)
    send(Step::QuarkToken, QUrl(QuarkApi + "token?pr=ucpro&fr=pc"),
      QJsonDocument(QJsonObject{{"pwd_id", m_id}, {"passcode", code}}).toJson(QJsonDocument::Compact));
  // A Baidu extraction code needs a verification round; the share page asks for it instead.
  else if (!code.isEmpty()) finish(share);
  else send(Step::BaiduPage, share);
}

void NetdiskFolder::send(Step step, const QUrl& url, const QByteArray& body)
{
  QNetworkRequest request(url);
  request.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::ManualRedirectPolicy);
  request.setHeader(QNetworkRequest::UserAgentHeader, "Tigerest-Theater");
  if (!m_cookies.isEmpty()) request.setHeader(QNetworkRequest::CookieHeader, QVariant::fromValue(m_cookies));
  QNetworkReply* reply;
  if (step == Step::QuarkToken)
  {
    request.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    reply = m_network->post(request, body);
  }
  else reply = m_network->get(request);
  m_reply = reply;
  connect(reply, &QNetworkReply::finished, this, [this, reply, step] { received(reply, step); });
}

void NetdiskFolder::received(QNetworkReply* reply, Step step)
{
  reply->deleteLater();
  if (reply != m_reply) return;
  m_reply = nullptr;
  const QByteArray bytes = reply->read(MaximumResponseBytes + 1);
  if (reply->error() != QNetworkReply::NoError || reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt() != 200 ||
      bytes.size() > MaximumResponseBytes)
  {
    finish(m_share);
    return;
  }
  if (step == Step::BaiduPage)
  {
    // The listing endpoint answers only a client holding the share page's cookies.
    m_cookies = reply->header(QNetworkRequest::SetCookieHeader).value<QList<QNetworkCookie>>();
    m_pending = {{QString(), 0}};
    listNext();
    return;
  }
  const QJsonObject json = QJsonDocument::fromJson(bytes).object();
  if (step == Step::QuarkToken)
  {
    m_token = json.value("data").toObject().value("stoken").toString();
    m_pending = {{"0", 0}};
    if (m_token.isEmpty()) finish(m_share);
    else listNext();
    return;
  }
  if (!m_quark && json.value("errno").toInt(-1) != 0)
  {
    finish(m_share);
    return;
  }
  const QJsonArray items = m_quark ? json.value("data").toObject().value("list").toArray() : json.value("list").toArray();
  const QRegularExpression valid(m_quark ? "^[0-9A-Za-z]{1,64}$" : "^/.{1,1023}$");
  for (const auto& value : items)
  {
    const auto item = value.toObject();
    const bool folder = m_quark ? item.value("dir").toBool() : item.value("isdir").toVariant().toInt() == 1;
    const QString name = item.value(m_quark ? "file_name" : "server_filename").toString();
    const QString id = item.value(m_quark ? "fid" : "path").toString();
    if (!folder || !valid.match(id).hasMatch()) continue;
    if (name == m_version || name == "v" + m_version)
    {
      finish(m_quark ? quarkFolderPage(m_share, id) : baiduFolderPage(m_share, id));
      return;
    }
    if (m_depth < MaximumDepth) m_pending.append({id, m_depth + 1});
  }
  listNext();
}

void NetdiskFolder::listNext()
{
  if (m_pending.isEmpty() || ++m_listings > MaximumListings)
  {
    finish(m_share);
    return;
  }
  const auto next = m_pending.takeFirst();
  m_depth = next.second;
  if (m_quark)
  {
    QUrl url(QuarkApi + "detail");
    url.setQuery(query({{"pr", "ucpro"}, {"fr", "pc"}, {"pwd_id", m_id}, {"stoken", m_token}, {"pdir_fid", next.first},
      {"force", "0"}, {"_page", "1"}, {"_size", "100"}}));
    send(Step::QuarkList, url);
    return;
  }
  // Baidu's listing names the share by its short URL without the leading character.
  using Item = QPair<QString, QString>;
  QList<Item> items{{"shorturl", m_id.mid(1)}, {"page", "1"}, {"num", "100"}, {"web", "1"}};
  if (next.first.isEmpty()) items << Item("root", "1");
  else items << Item("dir", next.first) << Item("root", "0");
  QUrl url("https://pan.baidu.com/share/list");
  url.setQuery(query(items));
  send(Step::BaiduList, url);
}

void NetdiskFolder::finish(const QUrl& page)
{
  m_deadline.stop();
  if (m_reply)
  {
    QNetworkReply* reply = m_reply;
    m_reply = nullptr;
    reply->abort();
  }
  const Done done = m_done;
  m_done = nullptr;
  if (done) done(page);
}
