#pragma once

#include <QList>
#include <QUrl>

// GitHub download accelerators, tried in order before a github.com URL itself. They only carry
// the bytes: every caller still checks size and SHA-256 against its own trusted source.
namespace DownloadProxies
{
constexpr const char* Prefixes[] = {"https://gh-proxy.com/", "https://ghproxy.net/"};
constexpr int Count = sizeof(Prefixes) / sizeof(Prefixes[0]);

// The accelerated URLs followed by the URL itself; other hosts are returned alone.
inline QList<QUrl> sources(const QUrl& url)
{
  QList<QUrl> result;
  if (url.scheme() == "https" && url.host() == "github.com")
    for (const char* prefix : Prefixes) result.append(QUrl(QString::fromLatin1(prefix) + url.toString(QUrl::FullyEncoded)));
  result.append(url);
  return result;
}
}
