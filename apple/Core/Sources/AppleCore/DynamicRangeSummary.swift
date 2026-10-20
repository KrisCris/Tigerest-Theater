import Foundation

/// The playback-start notice: whether the display receives HDR or SDR, from
/// mpv's actual source (`video-params`) and VO target (`video-target-params`).
/// The Mac client (PlayerComponent.cpp) uses the same rules and wording.
public enum DynamicRangeSummary {
    static let hdrTransfers: Set<String> = ["pq", "hlg"]

    /// nil until the VO has configured its target colorspace.
    public static func text(source: JSONValue, target: JSONValue, dolbyVisionProfile: Int?, toneMapping: String) -> String? {
        guard let targetGamma = target["gamma"].string, !targetGamma.isEmpty,
              let sourceGamma = source["gamma"].string, !sourceGamma.isEmpty else { return nil }
        let dolbyVision = dolbyVisionProfile.flatMap { $0 > 0 ? $0 : nil }
        let sourceHDR = hdrTransfers.contains(sourceGamma), targetHDR = hdrTransfers.contains(targetGamma)
        let format = dolbyVision.map { "杜比视界 Profile \($0)" } ?? (sourceGamma == "hlg" ? "HLG" : "HDR10")

        let mode: String
        if targetHDR { mode = "HDR 输出 · " + format }
        else if sourceHDR { mode = "SDR 输出 · \(format) 已色调映射（\(toneMapping.isEmpty ? "自动" : toneMapping)）" }
        else { mode = "SDR 播放" }

        var input = ["片源"]
        if let w = source["w"].number, let h = source["h"].number, w > 0, h > 0 { input.append("\(Int(w))×\(Int(h))") }
        input.append(colorspace(source))
        if sourceHDR, let nits = nits(source["max-luma"]) { input.append("母版 \(nits) nits") }

        // A PQ target's max-luma is the signal's 10000-nit ceiling, not the
        // screen; the system maps HDR to the display's current headroom.
        var output = ["输出", colorspace(target)]
        if targetHDR { output.append("由系统按屏幕能力映射亮度") }

        return [mode, join(input), join(output)].joined(separator: "\n")
    }

    static func join(_ parts: [String]) -> String { parts[0] + " " + parts.dropFirst().joined(separator: " · ") }
    /// Mastering peaks are coded with small offsets (1000.6); report them in 10-nit steps.
    static func nits(_ value: JSONValue) -> Int? { value.number.flatMap { $0.isFinite && $0 > 0 ? Int(($0 / 10).rounded()) * 10 : nil } }
    static func colorspace(_ params: JSONValue) -> String {
        primaries(params["primaries"].string ?? "") + " / " + transfer(params["gamma"].string ?? "")
    }
    static func primaries(_ name: String) -> String {
        ["bt.709": "BT.709", "bt.2020": "BT.2020", "display-p3": "Display P3", "dci-p3": "DCI-P3",
         "bt.601-525": "BT.601", "bt.601-625": "BT.601", "apple": "Apple RGB", "adobe": "Adobe RGB"][name] ?? (name.isEmpty ? "未知" : name.uppercased())
    }
    static func transfer(_ name: String) -> String {
        ["pq": "PQ", "hlg": "HLG", "srgb": "sRGB", "bt.1886": "BT.1886", "gamma2.2": "Gamma 2.2",
         "gamma2.4": "Gamma 2.4", "linear": "线性"][name] ?? (name.isEmpty ? "未知" : name)
    }
}
