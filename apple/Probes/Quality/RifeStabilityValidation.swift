// Opt-in device diagnostics. Never included in the normal application target.
import Foundation
import AppleCore

@MainActor enum RifeStabilityValidation {
    static func run(_ model: AppModel) async {
        let reportURL = URL.cachesDirectory.appending(path: "rife-stability.json")
        let player = model.player
        var samples: [[String: Any]] = []
        var report: [String: Any] = ["status": "running", "version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] ?? ""]
        let quick = ProcessInfo.processInfo.arguments.contains("--rife-speed-quick-probe")
        let soakOnly = ProcessInfo.processInfo.arguments.contains("--rife-soak-only-probe")
        let samplesURL = URL.cachesDirectory.appending(path: "rife-stability-samples.jsonl")
        FileManager.default.createFile(atPath: samplesURL.path, contents: nil)
        let samplesFile = try? FileHandle(forWritingTo: samplesURL)
        defer { try? samplesFile?.close() }
        report["sampling"] = "constant-size JSONL; full report serialized after stopping playback"
        var maxSampleMilliseconds = 0.0
        func save() {
            report["samples"] = samples
            if let data = try? JSONSerialization.data(withJSONObject: report, options: [.sortedKeys]) {
                try? data.write(to: reportURL, options: .atomic)
            }
        }
        let start = ProcessInfo.processInfo.systemUptime
        func sample(_ phase: String, persist: Bool = true) {
            guard let e = player.engine else { return }
            let sampleStart = ProcessInfo.processInfo.systemUptime
            samples.append([
                "phase": phase, "wall": ProcessInfo.processInfo.systemUptime - start,
                "position": e.number("time-pos"), "speed": e.number("speed"),
                "audioPTS": e.number("audio-pts"),
                "paused": e.flag("pause"), "buffering": e.flag("paused-for-cache"),
                "fps": e.number("estimated-vf-fps"), "displayFPS": e.number("display-fps"),
                "renderDrops": e.number("frame-drop-count"), "decoderDrops": e.number("decoder-frame-drop-count"),
                "delayed": e.number("vo-delayed-frame-count"), "mistimed": e.number("mistimed-frame-count"),
                "avsync": e.number("avsync"), "memoryMB": RifePlaybackValidation.memoryMB(),
                "thermal": ProcessInfo.processInfo.thermalState.rawValue,
                "lowPower": ProcessInfo.processInfo.isLowPowerModeEnabled,
                "filter": e.json("vf-metadata/tigerest-rife").foundation
            ])
            if quick { samples[samples.count - 1]["outputFormat"] = e.json("video-out-params").foundation }
            if persist, let data = try? JSONSerialization.data(withJSONObject: samples[samples.count - 1]) {
                try? samplesFile?.write(contentsOf: data + Data([10]))
            }
            maxSampleMilliseconds = max(maxSampleMilliseconds, (ProcessInfo.processInfo.systemUptime - sampleStart) * 1000)
        }
        save()
        do {
            // Loop a local fixture only; never read production server credentials or media.
            let continuous = ProcessInfo.processInfo.arguments.contains("--rife-continuous-probe")
            let media = model.profiles.directory.appending(path: continuous ? "device-rife-continuous.mp4" : "device-rife-long.mp4")
            if !FileManager.default.fileExists(atPath: media.path) {
                try FileManager.default.copyItem(at: URL.cachesDirectory.appending(path: media.lastPathComponent), to: media)
            }
            let rife = !ProcessInfo.processInfo.arguments.contains("--rife-disabled-control")
            try model.settings.set("video", "aiRife", .bool(rife))
            report["rifeEnabled"] = rife
            let preset = ProcessInfo.processInfo.arguments.contains("--rife-stability-shader") ? "tigerest-default" : "native"
            report["preset"] = preset
            try player.selectQuality(QualitySelection(preset: preset))
            try player.dispatch("load", [.string(media.absoluteString), .object(["autoplay": .bool(true)]), .object(["title": .string("补帧稳定性测试")]), .number(1), .number(-1)])
            guard let e = player.engine else { throw PlaybackValidation.Failure.incorrectOutput }
            if !continuous { try e.set("loop-file", "inf") }
            try await PlaybackValidation.wait { player.position > 2 }
            report["hwdec"] = e.string("hwdec-current")
            report["sourceFPS"] = e.number("container-fps")
            report["audioBuffer"] = e.number("audio-buffer")
            report["renderPasses"] = e.json("vo-passes").foundation
            let phases: [(String, Double, Int)] = (quick || soakOnly) ? [("warmup", 1, 10)] : [
                ("warmup", 1, 10), ("1x-before", 1, 20), ("1.25x", 1.25, 20),
                ("1.5x", 1.5, 20), ("2x", 2, 20), ("1x-recovery", 1, 45)
            ]
            for (name, rate, seconds) in phases {
                try player.dispatch("setPlaybackRate", [.number(rate * 1000)])
                for _ in 0..<seconds {
                    try await Task.sleep(for: .seconds(1)); sample(name)
                    guard player.active else { throw PlaybackValidation.Failure.incorrectOutput }
                }
            }
            for _ in 0..<(soakOnly ? 0 : 5) {
                guard player.beginTemporarySpeed() else { throw PlaybackValidation.Failure.incorrectOutput }
                if quick {
                    for _ in 0..<40 { try await Task.sleep(for: .milliseconds(50)); sample("long-press", persist: false) }
                    save()
                } else { try await Task.sleep(for: .seconds(2)); sample("long-press") }
                player.endTemporarySpeed()
                if quick {
                    for _ in 0..<60 { try await Task.sleep(for: .milliseconds(50)); sample("long-press-release", persist: false) }
                    save()
                } else { try await Task.sleep(for: .seconds(3)); sample("long-press-release") }
            }
            if !soakOnly {
                try player.dispatch("seekTo", [.number(20000)])
                for _ in 0..<15 { try await Task.sleep(for: .seconds(1)); sample("seek-recovery") }
            }
            if ProcessInfo.processInfo.arguments.contains("--rife-stability-soak") {
                for _ in 0..<600 { try await Task.sleep(for: .seconds(1)); sample("soak") }
            }
            report["status"] = "collected"
        } catch {
            report["status"] = "failed"; report["error"] = String(describing: error)
        }
        player.stop(notify: false)
        report["maxSampleMilliseconds"] = maxSampleMilliseconds
        save()
    }
}
