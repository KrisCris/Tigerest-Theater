import SwiftUI
import AVFoundation
import AppleCore

/// A playback generation owns its engine, timer and server-report sequence.
@MainActor final class TVPlaybackController: ObservableObject {
    var onStopped: ((JSONValue, Double, Double) -> Void)?
    let surface = MetalSurface(frame: .zero)
    @Published private(set) var active = false
    @Published private(set) var paused = false
    @Published private(set) var buffering = false
    @Published private(set) var position = 0.0
    @Published private(set) var duration = 0.0
    @Published private(set) var title = ""
    @Published var error: String?
    private var engine: MPVEngine?
    private var timer: Timer?
    private var playback: EmbyPlayback?
    private var client: EmbyClient?
    private var loaded = false
    private var reportTask: Task<Void, Never>?
    private var reporting = false
    private var lastReport = 0.0
    private var generation = UUID()
    private var watchdog = PlaybackWatchdog()

    func play(_ playback: EmbyPlayback, client: EmbyClient) throws {
        stop()
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
            try next.command(["loadfile", playback.url.absoluteString, "replace"])
        } catch { next.close(); try? audio.setActive(false); throw error }
        self.engine = next; self.playback = playback; self.client = client
        generation = UUID(); loaded = false; reporting = false; reportTask = nil
        position = 0; duration = 0; paused = false; buffering = true; error = nil
        let season = playback.item["ParentIndexNumber"].number, episode = playback.item["IndexNumber"].number
        let label = season.map { $0.isFinite && (0...9999).contains($0) } == true && episode.map { $0.isFinite && (0...9999).contains($0) } == true ? String(format: "S%02dE%02d · ", Int(season!), Int(episode!)) : ""
        title = label + (playback.item["Name"].string ?? "正在播放")
        watchdog = PlaybackWatchdog(); active = true
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
                if let start = playback?.startSeconds, start > 0 {
                    do { try engine.command(["seek", String(start), "absolute+exact"]); position = start }
                    catch { self.error = "续播位置未能恢复" }
                }
                sendReport(.start)
            case .ended: stop(); return
            case .failed: stop(); error = "无法播放此媒体，请检查服务器连接后重试。"; return
            case .restarted: watchdog = PlaybackWatchdog()
            }
        }
        if let value = Double(engine.string("time-pos")), value.isFinite, value >= 0 { position = safeTime(value) }
        if let value = Double(engine.string("duration")), value.isFinite, value > 0 { duration = safeTime(value) }
        paused = engine.flag("pause"); buffering = !loaded || engine.flag("paused-for-cache")
        if loaded && engine.flag("eof-reached") { stop(); return }
        let now = ProcessInfo.processInfo.systemUptime
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
        do { try engine.command(["seek", String(target), "absolute+exact"]); watchdog = PlaybackWatchdog() }
        catch { self.error = "未能跳转播放位置" }
    }
    private func safeTime(_ value: Double) -> Double { value.isFinite ? min(1_000_000_000, max(0, value)) : 0 }
    private func isLocalFixture(_ playback: EmbyPlayback) -> Bool {
        ProcessInfo.processInfo.arguments.contains("--tv-fixture") && playback.url.isFileURL
    }
    func stop() {
        let wasActive = active
        if let engine, let final = Double(engine.string("time-pos")), final.isFinite, final >= 0 { position = safeTime(final) }
        timer?.invalidate(); timer = nil; engine?.close(); engine = nil
        if wasActive, loaded, let playback, let client, !isLocalFixture(playback) {
            let prior = reportTask, position = position, paused = paused
            Task {
                await prior?.value
                try? await client.report(.stop, playback: playback, position: position, paused: paused)
            }
        }
        if wasActive, loaded, let playback { onStopped?(playback.item, position, duration) }
        generation = UUID(); reportTask = nil; reporting = false
        playback = nil; client = nil; loaded = false; active = false; buffering = false
        UIApplication.shared.isIdleTimerDisabled = false
        if wasActive { try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
    }
}
