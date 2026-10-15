// Opt-in validation compiled only by the probe build script, never normal builds.
import Foundation
import UIKit
import AppleCore
@MainActor enum PlaybackValidation {
    enum Failure: Error { case timedOut, incorrectOutput }
    static func wait(_ condition: () -> Bool) async throws {
        for _ in 0..<300 { if condition() { return }; try await Task.sleep(for: .milliseconds(100)) }
        throw Failure.timedOut
    }
    static func run(_ model: AppModel) async {
        guard ProcessInfo.processInfo.arguments.contains("--ui-testing") else { return }
        if ProcessInfo.processInfo.arguments.contains("--rife-stability-probe") { await RifeStabilityValidation.run(model); return }
        if ProcessInfo.processInfo.arguments.contains("--update-probe") { await UpdateValidation.run(model);return }
        if ProcessInfo.processInfo.arguments.contains("--bluebox-live-probe") { await DanmakuParityValidation.blueBoxLive(model); return }
        if ProcessInfo.processInfo.arguments.contains("--danmaku-glyph-probe") { await DanmakuFrameValidation.glyphs(model); return }
        if ProcessInfo.processInfo.arguments.contains("--danmaku-frame-probe") { await DanmakuFrameValidation.run(model); return }
        if ProcessInfo.processInfo.arguments.contains("--rife-playback-probe") { await RifePlaybackValidation.run(model); return }
        if ProcessInfo.processInfo.arguments.contains("--danmaku-parity-probe") { await DanmakuParityValidation.run(model); return }
        let downscale = ProcessInfo.processInfo.arguments.contains("--downscale-probe")
        let fixture = downscale ? "device-fixture-4k.mp4" : "device-fixture.mp4"
        let reportName = downscale ? "quality-probe-downscale.json" : "quality-probe.json"
        var report: [[String: Any]] = []
        func save() { if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted,.sortedKeys]) { try? data.write(to: URL.cachesDirectory.appending(path: reportName), options: .atomic) } }
        let media = model.profiles.directory.appending(path: fixture)
        try? FileManager.default.copyItem(at: URL.cachesDirectory.appending(path: fixture), to: media)
        let player = model.player
        for preset in downscale ? ["tigerest-liveaction"] : ["native"] + QualityPreset.bundled.map(\.id) + ["native"] {
            var row: [String: Any] = ["preset": preset, "stage": "load"]
            if let entry = QualityPreset.bundled.first(where: { $0.id == preset }) {
                let root = Bundle.main.resourceURL!.appending(path: "Web")
                row["resourceChecks"] = entry.shaders.map { path in
                    let url = root.appending(path: path).standardizedFileURL
                    return ["name":url.lastPathComponent,"exists":FileManager.default.fileExists(atPath:url.path),"inside":url.path.hasPrefix(root.path + "/shaders/"),"normalizedInside":url.path.hasPrefix(root.standardizedFileURL.path + "/shaders/")] as [String:Any]
                }
            }
            do {
                try player.selectQuality(QualitySelection(preset: preset))
                try player.dispatch("load", [.string(media.absoluteString),.object(["autoplay":.bool(true)]),.object(["title":.string("画质验证")]),.number(1),.number(-1)])
                try await wait { player.position > 0.3 }
                guard let engine = player.engine else { throw Failure.incorrectOutput }
                try await Task.sleep(for: .seconds(1))
                row["videoOutput"] = engine.string("current-vo")
                row["audioSampleRate"] = engine.number("audio-out-params/samplerate")
                row["hardwareDecoder"] = engine.string("hwdec-current")
                row["shaderPaths"] = engine.json("glsl-shaders").array?.compactMap { $0.string.map { URL(fileURLWithPath: $0).lastPathComponent } } ?? []
                row["passes"] = engine.json("vo-passes").foundation
                row["options"] = Dictionary(uniqueKeysWithValues:["scale", "scale-antiring", "deband", "deband-threshold", "tone-mapping"].map { ($0,engine.string($0)) })
                row["frameDrops"] = engine.number("frame-drop-count")
                if preset != "native" {
                    try player.selectQuality(QualitySelection())
                    row["resetShaders"] = engine.json("glsl-shaders").foundation
                    row["resetAntiring"] = engine.number("scale-antiring")
                    guard engine.json("glsl-shaders").array?.isEmpty == true, abs(engine.number("scale-antiring")) < 0.001 else { throw Failure.incorrectOutput }
                    row["hotReset"] = "success"
                    try player.selectQuality(QualitySelection(preset: preset))
                    let expected = QualityPreset.bundled.first { $0.id == preset }!
                    guard engine.json("glsl-shaders").array?.count == expected.shaders.count else { throw Failure.incorrectOutput }
                    row["hotReapply"] = "success"
                }
                if preset == "native" && report.isEmpty {
                    let screen = player.surface.window!.screen, original = screen.brightness
                    player.setBrightness(original < 0.6 ? 0.8 : 0.3)
                    row["brightnessBefore"] = original; try await Task.sleep(for: .milliseconds(500)); row["brightnessAdjusted"] = screen.brightness
                    let volume = player.systemVolume.value, target = volume < 0.5 ? 0.65 : 0.35
                    row["volumeBefore"] = volume
                    row["volumeWriteAccepted"] = player.systemVolume.set(target)
                    try await Task.sleep(for: .milliseconds(500))
                    row["volumeAdjusted"] = player.systemVolume.value
                    player.systemVolume.set(volume)
                    try await Task.sleep(for: .milliseconds(500))
                    row["volumeRestored"] = player.systemVolume.value
                    player.stop(notify: false); try await Task.sleep(for: .milliseconds(500)); row["brightnessRestored"] = screen.brightness
                } else { player.stop(notify: false) }
                row["result"] = "success"
            } catch { row["error"] = String(describing: error);row["result"] = "failed";player.stop(notify: false) }
            report.append(row);save()
        }
    }
}
