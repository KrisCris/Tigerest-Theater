// Opt-in tracing of user-started playback. Optional bounded QoS experiment;
// never changes saved preferences. Not in release targets.
import Foundation
import UIKit
import AppleCore

@MainActor enum PlaybackPerformanceTrace {
    private static let enabled = ProcessInfo.processInfo.arguments.contains("--playback-performance-trace")
    private static var drawCount = 0, maxVisible = 0
    private static var drawTotal = 0.0, drawMax = 0.0, frameGapMax = 0.0, lastDraw: Double?
    static func recordDanmakuFrame(host: Double, duration: Double, visible: Int) {
        guard enabled else { return }
        if let lastDraw { frameGapMax = max(frameGapMax, host - lastDraw) }
        lastDraw = host; drawCount += 1; drawTotal += duration
        drawMax = max(drawMax, duration); maxVisible = max(maxVisible, visible)
    }
    private static func danmakuSnapshot() -> [String: Any] {
        let result: [String: Any] = ["frames": drawCount, "totalDrawMs": drawTotal * 1000,
                                    "maxDrawMs": drawMax * 1000, "maxFrameGapMs": frameGapMax * 1000,
                                    "maxVisible": maxVisible]
        drawCount = 0; maxVisible = 0; drawTotal = 0; drawMax = 0; frameGapMax = 0; lastDraw = nil
        return result
    }
    static func run(_ model: AppModel) async {
        guard !ProcessInfo.processInfo.arguments.contains("--ui-testing") else { return }
        let url = URL.cachesDirectory.appending(path: "playback-performance.jsonl")
        FileManager.default.createFile(atPath: url.path, contents: nil)
        guard let file = try? FileHandle(forWritingTo: url) else { return }
        defer { try? file.close() }
        let batteryMonitoring = UIDevice.current.isBatteryMonitoringEnabled
        UIDevice.current.isBatteryMonitoringEnabled = true
        defer { UIDevice.current.isBatteryMonitoringEnabled = batteryMonitoring }
        func append(_ row: [String: Any]) {
            guard let data = try? JSONSerialization.data(withJSONObject: row, options: [.sortedKeys]) else { return }
            try? file.write(contentsOf: data + Data([10]))
        }
        append(["event": "trace-start", "utc": ISO8601DateFormatter().string(from: Date()),
                "samplingSeconds": 2, "version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] ?? "",
                "privacy": "numeric performance counters only; no media URL, title, account, headers or credentials"])
        let start = ProcessInfo.processInfo.systemUptime
        var lastEngine: ObjectIdentifier?, session = 0, activeSamples = 0
        var lastSampleStart: Double?
        let qosExperiment = ProcessInfo.processInfo.arguments.contains("--rife-qos-experiment")
        var activeSeconds = 0.0, lastQoSMode: String?
        // Bounded append-only capture: no growing report serialization during playback.
        for _ in 0..<1800 {
            do { try await Task.sleep(for: .seconds(2)) } catch { break }
            guard let engine = model.player.engine, model.player.active else {
                if lastEngine != nil { append(["event": "playback-stopped", "session": session]); lastEngine = nil }
                continue
            }
            let sampleStart = ProcessInfo.processInfo.systemUptime
            if ObjectIdentifier(engine) != lastEngine { lastEngine = ObjectIdentifier(engine); session += 1; activeSamples = 0; lastSampleStart = nil; activeSeconds = 0; lastQoSMode = nil }
            if !engine.flag("pause") && !engine.flag("paused-for-cache") {
                activeSeconds += lastSampleStart.map { min(3, sampleStart - $0) } ?? 0
            }
            // A/B/A/B in one stream: 60s default, 120s user-initiated,
            // 120s default, 180s user-initiated, then restore default.
            if qosExperiment {
                let mode = (60..<180).contains(activeSeconds) || (300..<480).contains(activeSeconds) ? "user-initiated" : "default"
                if mode != lastQoSMode {
                    do {
                        try engine.command(["vf-command", "tigerest-rife", "probe-qos", mode])
                        append(["event": "qos-request", "session": session, "activeSeconds": activeSeconds, "mode": mode])
                        lastQoSMode = mode
                    } catch { append(["event": "qos-command-rejected", "session": session]) }
                }
            }
            var row: [String: Any] = [
                "session": session, "wall": sampleStart - start,
                "activeSeconds": activeSeconds, "qosExperiment": qosExperiment,
                "sampleIntervalMs": lastSampleStart.map { (sampleStart - $0) * 1000 } ?? 0,
                "position": engine.number("time-pos"), "speed": engine.number("speed"),
                "paused": engine.flag("pause"), "buffering": engine.flag("paused-for-cache"),
                "renderDrops": engine.number("frame-drop-count"), "decoderDrops": engine.number("decoder-frame-drop-count"),
                "delayed": engine.number("vo-delayed-frame-count"), "mistimed": engine.number("mistimed-frame-count"),
                "avsync": engine.number("avsync"), "sourceFPS": engine.number("container-fps"),
                "outputFPS": engine.number("estimated-vf-fps"), "displayFPS": engine.number("display-fps"),
                "estimatedDisplayFPS": engine.number("estimated-display-fps"),
                "cacheSeconds": engine.number("demuxer-cache-duration"),
                "thermal": ProcessInfo.processInfo.thermalState.rawValue,
                "lowPower": ProcessInfo.processInfo.isLowPowerModeEnabled,
                "batteryState": UIDevice.current.batteryState.rawValue,
                "memoryMB": RifePlaybackValidation.memoryMB(),
                "filter": engine.json("vf-metadata/tigerest-rife").foundation,
                "danmaku": danmakuSnapshot(), "danmakuEnabled": model.danmaku.enabled,
                "danmakuCommentCount": model.danmaku.sources.filter(\.enabled).reduce(0) { $0 + $1.comments.count }
            ]
            if activeSamples % 10 == 0 {
                // Store aggregate GPU timings, never shader descriptions/paths or raw samples.
                let passes = engine.json("vo-passes")["fresh"].array ?? []
                row["gpuPassAverageMs"] = passes.reduce(0.0) { $0 + ($1["avg"].number ?? 0) } / 1_000_000
                row["gpuPassLastMs"] = passes.reduce(0.0) { $0 + ($1["last"].number ?? 0) } / 1_000_000
                row["shaderCount"] = engine.json("glsl-shaders").array?.count ?? 0
                let preset = model.player.qualitySelection.preset
                row["qualityPreset"] = (["native"] + QualityPreset.bundled.map(\.id)).contains(preset) ? preset : "custom"
                row["rifeRequested"] = model.settings.get("video", "aiRife").bool ?? false
                row["surfaceWidth"] = model.player.surface.metal.drawableSize.width
                row["surfaceHeight"] = model.player.surface.metal.drawableSize.height
                row["screenMaximumFPS"] = model.player.surface.window?.screen.maximumFramesPerSecond ?? 0
                row["brightness"] = model.player.brightness
                row["hwdec"] = engine.string("hwdec-current")
                row["videoSync"] = engine.string("video-sync")
                row["displaySyncActive"] = engine.flag("display-sync-active")
                row["framedrop"] = engine.string("framedrop")
                row["mpvInterpolation"] = engine.flag("interpolation")
                row["videoWidth"] = engine.number("video-params/w")
                row["videoHeight"] = engine.number("video-params/h")
            }
            row["sampleMs"] = (ProcessInfo.processInfo.systemUptime - sampleStart) * 1000
            append(row); activeSamples += 1; lastSampleStart = sampleStart
        }
        append(["event": "trace-ended"])
    }
}
