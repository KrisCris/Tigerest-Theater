import SwiftUI
import AVFoundation
import AppleCore

/// A playback generation owns its engine, timer and server-report sequence.
@MainActor final class TVPlaybackController: ObservableObject, DanmakuPlaybackState {
    var onStopped: ((JSONValue, Double, Double) -> Void)?
    var onStopReported: ((JSONValue, EmbyClient) -> Void)?
    let surface = MetalSurface(frame: .zero)
    let subtitles = TVSubtitleController()
    @Published private(set) var active = false
    @Published private(set) var paused = false
    @Published private(set) var buffering = false
    @Published private(set) var position = 0.0
    @Published private(set) var duration = 0.0
    @Published private(set) var title = ""
    @Published var error: String?
    var engine: MPVEngine?
    @Published private(set) var danmaku: DanmakuRepository?
    @Published private(set) var qualityPreset = UserDefaults.standard.string(forKey: "tv.qualityPreset") == "tigerest-default" ? "tigerest-default" : "native"
    @Published private(set) var qualityMessage = ""
    private(set) var danmakuEpoch: UInt64 = 0
    var rate: Double { 1 }
    private var mappingTask: Task<Void, Never>?
    private var timer: Timer?
    private var playback: EmbyPlayback?
    private var client: EmbyClient?
    private var loaded = false
    private var reportTask: Task<Void, Never>?
    private var reporting = false
    private var lastReport = 0.0
    private let probeEnabled: Bool
    private var lastProbe = 0.0
    private var generation = UUID()
    /// Episode requests capture this token before awaiting the server. Leaving
    /// playback or replacing an engine invalidates late responses.
    var playbackGeneration: UUID { generation }
    private var watchdog = PlaybackWatchdog()
    init(arguments: [String] = ProcessInfo.processInfo.arguments) {
        probeEnabled = arguments.contains("--tv-playback-probe")
    }

    func play(_ playback: EmbyPlayback, client: EmbyClient, session: EmbySession? = nil) throws {
        // A successful episode replacement keeps the existing full-screen
        // presentation. Failure still dismisses it once the old engine is gone.
        stop(preservingPresentation: active)
        defer { if engine == nil { active = false } }
        let audio = AVAudioSession.sharedInstance()
        try audio.setCategory(.playback, mode: .moviePlayback)
        try audio.setActive(true)
        let next: MPVEngine
        do { next = try MPVEngine(layer: surface.metal) }
        catch { try? audio.setActive(false); throw error }
        do {
            if !playback.headers.isEmpty {
                let headers = try playback.headers.map { key, value -> String in
                    guard !key.contains(where: { $0 == "\r" || $0 == "\n" || $0 == ":" }),
                          !value.contains(where: { $0 == "\r" || $0 == "\n" }) else { throw CoreError.invalidRequest }
                    return key + ": " + value
                }
                try next.set("http-header-fields", headers.joined(separator: ","))
            }
            do {
                try applyQuality(qualityPreset, to: next)
                qualityMessage = qualityPreset == "native" ? "已选择原生画质" : "已启用完整桌面滤镜"
            } catch {
                guard qualityPreset != "native" else { throw error }
                // Resetting alone returns to shared high-quality defaults. The
                // TV native baseline must also be applied before claiming it.
                try applyQuality("native", to: next)
                qualityPreset = "native"
                qualityMessage = "桌面滤镜未能启用，当前使用原生画质。"
            }
            subtitles.begin(playback: playback, engine: next)
            try next.command(["loadfile", playback.url.absoluteString, "replace"])
        } catch { subtitles.reset(); next.close(); try? audio.setActive(false); throw error }
        self.engine = next; self.playback = playback; self.client = client
        generation = UUID(); loaded = false; reporting = false; reportTask = nil
        lastProbe = 0
        position = 0; duration = 0; paused = false; buffering = true; error = nil
        let season = playback.item["ParentIndexNumber"].number, episode = playback.item["IndexNumber"].number
        let label = season.map { $0.isFinite && (0...9999).contains($0) } == true && episode.map { $0.isFinite && (0...9999).contains($0) } == true ? String(format: "S%02dE%02d · ", Int(season!), Int(episode!)) : ""
        title = label + (playback.item["Name"].string ?? "正在播放")
        watchdog = PlaybackWatchdog(); active = true
        danmakuEpoch &+= 1
        if let session, !isLocalFixture(playback) {
            let host = TVDanmakuHost(session: session)
            let repository = DanmakuRepository(host: host)
            danmaku = repository
            repository.autoMatch(playback.item, mediaURL: playback.url)
            mappingTask = Task { [weak self, weak host] in
                let headers = try? await CommunityClient(emby: session).mappingHeaders()
                guard !Task.isCancelled, self?.danmaku === repository else { return }
                host?.mappingHeaders = headers ?? [:]
            }
        }
        UIApplication.shared.isIdleTimerDisabled = true
        timer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
    }
    private func tick() {
        guard let engine, active else { return }
        for event in engine.events() {
            switch event {
            case .loaded:
                loaded = true
                subtitles.fileLoaded()
                if let start = playback?.startSeconds, start > 0 {
                    do { try engine.command(["seek", String(start), "absolute+exact"]); position = start }
                    catch { self.error = "续播位置未能恢复" }
                }
                sendReport(.start)
            case .ended: stop(); return
            case .failed: stop(); error = "无法播放此媒体，请检查服务器连接后重试。"; return
            case .restarted: watchdog = PlaybackWatchdog(); danmakuEpoch &+= 1
            }
        }
        if let value = Double(engine.string("time-pos")), value.isFinite, value >= 0 { position = safeTime(value) }
        if let value = Double(engine.string("duration")), value.isFinite, value > 0 { duration = safeTime(value) }
        paused = engine.flag("pause"); buffering = !loaded || engine.flag("paused-for-cache")
        if loaded { subtitles.update() }
        if loaded && engine.flag("eof-reached") { stop(); return }
        let now = ProcessInfo.processInfo.systemUptime
        if probeEnabled, loaded, now - lastProbe >= 10 {
            lastProbe = now
            if let data = try? JSONEncoder().encode(playbackProbe()) {
                try? data.write(to: URL.cachesDirectory.appending(path: "tv-playback-probe.json"), options: .atomic)
            }
        }
        if watchdog.stalled(position: position, now: now, paused: paused) {
            stop(); error = "播放长时间没有进展，请检查网络后重试。"; return
        }
        if loaded && now - lastReport >= 10 { sendReport(.progress) }
    }
    private func sendReport(_ event: EmbyPlaybackEvent) {
        guard let client, let playback, !reporting, !isLocalFixture(playback) else { return }
        reporting = true; lastReport = ProcessInfo.processInfo.systemUptime
        let id = generation, position = position, paused = paused
        reportTask = Task { [weak self] in
            do { try await client.report(event, playback: playback, position: position, paused: paused) }
            catch { if self?.generation == id { self?.error = "观看进度暂时未能同步到服务器" } }
            if self?.generation == id { self?.reporting = false }
        }
    }
    func togglePause() {
        guard let engine else { return }
        do { try engine.set("pause", paused ? "no" : "yes"); paused.toggle(); sendReport(.progress) }
        catch { self.error = "暂停状态未能切换" }
    }
    func seek(by seconds: Double) {
        guard let engine, seconds.isFinite else { return }
        let target = min(duration > 0 ? duration : .greatestFiniteMagnitude, max(0, position + seconds))
        do { try engine.command(["seek", String(target), "absolute+exact"]); watchdog = PlaybackWatchdog(); danmakuEpoch &+= 1 }
        catch { self.error = "未能跳转播放位置" }
    }
    private func safeTime(_ value: Double) -> Double { value.isFinite ? min(1_000_000_000, max(0, value)) : 0 }
    private func isLocalFixture(_ playback: EmbyPlayback) -> Bool {
        ProcessInfo.processInfo.arguments.contains("--tv-fixture") && playback.url.isFileURL
    }
    func stop() {
        stop(preservingPresentation: false)
    }
    private func stop(preservingPresentation: Bool) {
        let wasActive = active
        subtitles.reset()
        mappingTask?.cancel(); mappingTask = nil; danmaku?.clear(); danmaku = nil; danmakuEpoch &+= 1
        if let engine, let final = Double(engine.string("time-pos")), final.isFinite, final >= 0 { position = safeTime(final) }
        timer?.invalidate(); timer = nil; engine?.close(); engine = nil
        if wasActive, loaded, let playback, let client, !isLocalFixture(playback) {
            let prior = reportTask, position = position, paused = paused
            Task { [weak self] in
                await prior?.value
                try? await client.report(.stop, playback: playback, position: position, paused: paused)
                self?.onStopReported?(playback.item, client)
            }
        }
        if wasActive, loaded, let playback { onStopped?(playback.item, position, duration) }
        generation = UUID(); reportTask = nil; reporting = false
        playback = nil; client = nil; loaded = false; buffering = false
        if !preservingPresentation { active = false }
        UIApplication.shared.isIdleTimerDisabled = false
        if wasActive { try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
    }

    func selectQuality(_ preset: String) {
        guard ["native", "tigerest-default"].contains(preset) else { return }
        let old = qualityPreset
        do {
            if let engine { try applyQuality(preset, to: engine) }
            qualityPreset = preset
            UserDefaults.standard.set(preset, forKey: "tv.qualityPreset")
            qualityMessage = preset == "native" ? "已选择原生画质" : "已选择完整桌面滤镜"
        } catch {
            guard let engine else { return }
            do {
                try applyQuality(old, to: engine)
                qualityMessage = "未能应用，已恢复上一画质设置。"
            } catch {
                do {
                    try applyQuality("native", to: engine); qualityPreset = "native"
                    qualityMessage = "未能恢复上一画质，已切换原生画质。"
                } catch {
                    stop()
                    self.error = "画质设置未能恢复，请重新播放。"
                    qualityMessage = "画质设置未能恢复，请重新播放。"
                }
            }
        }
    }
    private func applyQuality(_ selection: String, to engine: MPVEngine) throws {
        // Validate the entire bundled chain before changing a running engine.
        let preset = selection == "native" ? nil : try TVQualityPreset.bundledDefault()
        let paths = try preset?.paths()
        try engine.resetQuality()
        if selection == "native" {
            // TV keeps full output resolution with the verified low-cost
            // scalers; all other shared high-quality properties stay intact.
            try engine.qualitySetting("glsl-shaders", "")
            for scaler in ["scale", "cscale", "dscale"] { try engine.qualitySetting(scaler, "bilinear") }
            return
        }
        guard let preset, let paths else { return }
        for (name, value) in preset.options.sorted(by: { $0.key < $1.key }) { try engine.qualitySetting(name, value) }
        try engine.qualitySetting("glsl-shaders", paths.joined(separator: ":"))
    }

    /// Explicit probe mode writes this allowlist only; media metadata, request
    /// headers and URLs are never serialized. One atomic file replaces the last.
    func playbackProbe() -> JSONValue {
        guard let engine else { return .null }
        func number(_ key: String) -> JSONValue {
            guard let value = Double(engine.string(key)), value.isFinite else { return .null }
            return .number(max(0, value))
        }
        func description(_ value: String) -> String {
            String(value.prefix(512))
                .replacingOccurrences(of: #"(?i)\b[a-z][a-z0-9+.-]*://\S+"#, with: "[redacted]", options: .regularExpression)
                .replacingOccurrences(of: #"(?:/[^\s]+)+"#, with: "[path]", options: .regularExpression)
                .components(separatedBy: .controlCharacters).joined(separator: " ")
        }
        let passes = engine.json("vo-passes")
        let passDescriptions = Dictionary(uniqueKeysWithValues: ["fresh", "redraw"].map { kind in
            (kind, JSONValue.array((passes[kind].array ?? []).prefix(128).compactMap { pass in
                pass["desc"].string.map { .string(description($0)) }
            }))
        })
        return .object([
            "capturedAt": .string(ISO8601DateFormatter().string(from: Date())),
            "position": .number(position), "paused": .bool(paused), "buffering": .bool(buffering),
            "qualityPreset": .string(qualityPreset),
            "scalers": .object(Dictionary(uniqueKeysWithValues: ["scale", "cscale", "dscale"].map { ($0, .string(engine.string($0))) })),
            "drawableSize": .object(["width": .number(Double(surface.metal.drawableSize.width)), "height": .number(Double(surface.metal.drawableSize.height))]),
            "cache": .object(["seconds": number("demuxer-cache-duration"), "percent": number("cache-buffering-state")]),
            "videoParams": .object(["width": number("video-params/w"), "height": number("video-params/h"), "codec": .string(description(engine.string("video-codec")))]),
            "frame-drop-count": number("frame-drop-count"), "decoder-frame-drop-count": number("decoder-frame-drop-count"),
            "glsl-shaders": .array((engine.json("glsl-shaders").array ?? []).prefix(64).compactMap { value in
                value.string.map { .string(URL(fileURLWithPath: $0).lastPathComponent) }
            }),
            "vo-passes": .object(passDescriptions)
        ])
    }
}
