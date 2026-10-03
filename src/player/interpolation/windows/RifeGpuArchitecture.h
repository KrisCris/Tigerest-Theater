#pragma once
#include <QStringList>
#include <QRegularExpression>

namespace rife {
inline bool validGpuPackageArchitecture(const QString& architecture)
{
    static const QStringList supported{"full","sm75","sm80","sm86","sm89","sm90","sm100","sm120"};
    return supported.contains(architecture);
}

// Match native_probe.py's CUDA device 0. Multiple devices or an unrecognized
// capability deliberately retain the complete runtime, even for identical GPUs.
inline QString gpuPackageArchitecture(int deviceCount,int major,int minor)
{
    if(deviceCount!=1||major<=0||minor<0||minor>9)return "full";
    const auto architecture=QStringLiteral("sm%1%2").arg(major).arg(minor);
    return validGpuPackageArchitecture(architecture)?architecture:QStringLiteral("full");
}

// The isolated NVIDIA tool returns one CSV row per physical GPU. Only one
// exact capability is useful: device ordering cannot differ for a single GPU.
inline QString gpuPackageArchitectureFromReport(const QString& report)
{
    if(report.size()>1024)return "full";
    const auto rows=report.trimmed().split(QRegularExpression("[\r\n]+"),Qt::SkipEmptyParts);
    if(rows.size()!=1)return "full";
    static const QRegularExpression capability("^([1-9][0-9]?)\\.([0-9])$");
    const auto match=capability.match(rows.front().trimmed());
    return match.hasMatch()?gpuPackageArchitecture(1,match.captured(1).toInt(),match.captured(2).toInt()):QStringLiteral("full");
}
}
