#pragma once

#include <QByteArray>
#include <QDateTime>
#include <QHash>
#include <QJsonArray>
#include <QString>
#include <QUrl>
#include <optional>

// The community server's signed copy of the GitHub release list (docs/backend-app-release-feed.md).
// The updater asks it first and falls back to the GitHub API whenever it is missing or not trusted.
namespace ReleaseFeed
{
constexpr qint64 MaximumEnvelopeBytes = 2 * 1024 * 1024;
constexpr qint64 MaximumPayloadBytes = 1024 * 1024;

// keyId → raw 32-byte Ed25519 public key.
using Keys = QHash<QString, QByteArray>;

QUrl address();
// The keys built into the client; a rotated key is added beside the old one.
Keys productionKeys();

// The releases of an envelope signed by one of keys and current at now. Otherwise nothing, with the reason for the log.
std::optional<QJsonArray> open(const QByteArray& envelope, const QDateTime& now, const Keys& keys, QString* reason = nullptr);
}
