#pragma once

#include <QList>
#include <QNetworkCookie>
#include <QObject>
#include <QPair>
#include <QPointer>
#include <QTimer>
#include <QUrl>
#include <functional>

class QNetworkAccessManager;
class QNetworkReply;

// Finds the subfolder named after a release in a Quark or Baidu netdisk share and
// returns the web page that opens it. Only the anonymous, read-only share listing is
// used; downloading still happens in the netdisk page after the user signs in there.
// Any failure, including a missing folder, falls back to the share page itself.
class NetdiskFolder : public QObject
{
  Q_OBJECT
public:
  using Done = std::function<void(const QUrl&)>;
  explicit NetdiskFolder(QNetworkAccessManager* network, QObject* parent = nullptr);
  // Calls done exactly once, unless another resolve() replaces this one first.
  void resolve(const QUrl& share, const QString& version, Done done);
  bool busy() const { return bool(m_done); }

  static QUrl quarkFolderPage(const QUrl& share, const QString& fid);
  static QUrl baiduFolderPage(const QUrl& share, const QString& path);

private:
  enum class Step { QuarkToken, QuarkList, BaiduPage, BaiduList };
  void send(Step step, const QUrl& url, const QByteArray& body = {});
  void received(QNetworkReply* reply, Step step);
  void listNext();
  void finish(const QUrl& page);

  QNetworkAccessManager* m_network;
  QPointer<QNetworkReply> m_reply;
  QTimer m_deadline;
  Done m_done;
  QUrl m_share;
  QString m_id;
  QString m_version;
  QString m_token;
  QList<QNetworkCookie> m_cookies;
  // Folders still to list: Quark fid or Baidu path, and its depth below the share.
  QList<QPair<QString, int>> m_pending;
  bool m_quark = false;
  int m_depth = 0;
  int m_listings = 0;
};
