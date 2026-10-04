#pragma once
#include <QString>
#include <cmath>

// Select the application preference before interpolation and user mpv overrides.
inline QString playbackVideoSync(const QString& configured, double refreshRate,
                                 bool highRefreshCompatibility, bool windows)
{
    // The composed Windows presentation path can miss 4.17 ms deadlines even
    // with cheap rendering. Audio pacing avoids chasing that noisy feedback.
    // Leave 120 Hz (including reporting tolerance), explicit alternative modes,
    // and other platforms on their requested clock.
    if (windows && highRefreshCompatibility && std::isfinite(refreshRate) &&
        refreshRate > 120.5 && configured == QStringLiteral("display-resample"))
        return QStringLiteral("audio");
    return configured;
}
