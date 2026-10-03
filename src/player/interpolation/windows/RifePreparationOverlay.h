#pragma once

#include <QStringList>

namespace rife {
// mpv renders this in both native VO and Render API output, so fullscreen
// video cannot cover the preparation status. UOSC remains above this layer.
inline QStringList preparationOverlay(bool visible,bool compiling,bool resume,qint64 elapsedMs)
{
    const QString id=QStringLiteral("7331");
    if(!visible)return {"osd-overlay",id,"none",""};
    const qint64 elapsed=qMax<qint64>(0,elapsedMs);
    const int estimated=int(90.0*double(elapsed)/(double(elapsed)+60000.0));
    const int fill=compiling?qMax(12,680*estimated/100):170;
    const int left=compiling?300:300+int((elapsed/20)%510);
    const auto title=compiling?QStringLiteral("正在准备补帧引擎"):QStringLiteral("正在载入补帧引擎");
    const auto detail=compiling?QStringLiteral("估算进度 %1% · 已用时 %2 秒").arg(estimated).arg(elapsed/1000)
                               :QStringLiteral("正在等待首帧 · 已用时 %1 秒").arg(elapsed/1000);
    const auto next=resume?QStringLiteral("准备完成后自动播放"):QStringLiteral("准备完成后保持暂停");
    const QString ass=QStringLiteral(
        "{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H1B1411&\\1a&H00&\\p1}m 0 0 l 1280 0 1280 720 0 720{\\p0}\n"
        "{\\an7\\pos(300,235)\\bord0\\shad0\\fs22\\1c&H38BEFF&}大河影院 · RIFE 补帧\n"
        "{\\an7\\pos(300,285)\\bord0\\shad0\\b1\\fs36\\1c&HF7F2F0&}%1\n"
        "{\\an7\\pos(300,365)\\bord0\\shad0\\1c&H40322B&\\p1}m 0 0 l 680 0 680 8 0 8{\\p0}\n"
        "{\\an7\\pos(%2,365)\\bord0\\shad0\\1c&H38BEFF&\\p1}m 0 0 l %3 0 %3 8 0 8{\\p0}\n"
        "{\\an7\\pos(300,405)\\bord0\\shad0\\fs24\\1c&HC2B2AA&}%4\n"
        "{\\an7\\pos(300,445)\\bord0\\shad0\\fs24\\1c&HC2B2AA&}%5\n"
        "{\\an7\\pos(300,500)\\bord0\\shad0\\fs20\\1c&H93887D&}可暂停、停止或切换影片")
        .arg(title).arg(left).arg(fill).arg(detail,next);
    return {"osd-overlay",id,"ass-events",ass,"1280","720","1000"};
}
}
