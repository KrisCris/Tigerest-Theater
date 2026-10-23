#ifndef TIGEREST_MPVCONFEDITOR_H
#define TIGEREST_MPVCONFEDITOR_H

#include <QString>
#include <QVariantMap>

// Data for the settings-page mpv.conf editor. Results are plain maps so the
// WebChannel can pass them to JavaScript unchanged.
namespace MpvConfEditor
{
  // Everything the page needs on open: the file split into its parts, the
  // option and shader catalogs, profiles, paths and the first analysis.
  QVariantMap state(const QString& activeProfile);
  // Lines, diagnostics, profiles and the values the form shows for `section`.
  QVariantMap analyze(const QString& user, const QString& section);
  // Form and "+" picker edits. Returns {user} or {error}.
  QVariantMap edit(const QString& user, const QVariantMap& operation);
  // Accepts a whole pasted file: keeps only its user area and counts the
  // managed lines that differ from the current ones.
  QVariantMap paste(const QString& text);
  QVariantList userShaders();
}

#endif
