import UIKit
import AVFoundation
import MediaPlayer
import AppleCore
@MainActor final class PlaybackController: NSObject, ObservableObject {
    unowned let model: AppModel
    let surface = MetalSurface(frame: .zero)
    private(set) var engine: MPVEngine?
    private var state = PlaybackState(), temporary = TemporarySpeed(), watchdog = PlaybackWatchdog()
    private var timer: Timer?, startSeconds = 0.0, loaded = false
    private var audio: JSONValue = .number(1), subtitle: JSONValue = .number(-1)
    private var priorBrightness: CGFloat?
    private var interruptionIntent: UInt64?
    private var remoteTargets: [(MPRemoteCommand, Any)] = []
    @Published var active = false
    @Published var paused = true
    @Published var buffering = false
    @Published var locked = false
    @Published var position = 0.0
    @Published var duration = 0.0
    @Published var rate = 1.0
    @Published var title = ""
    @Published var notice = ""
    @Published var tracks: [JSONValue] = []
    @Published var queue: [JSONValue] = []
    var currentID = "", metadata: JSONValue = .null
    init(model: AppModel) {
        self.model = model
        super.init()
        NotificationCenter.default.addObserver(self, selector: #selector(interruption(_:)), name: AVAudioSession.interruptionNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(routeChanged(_:)), name: AVAudioSession.routeChangeNotification, object: nil)
        let center = MPRemoteCommandCenter.shared()
        func bind(_ command: MPRemoteCommand, _ method: String) {
            let target = command.addTarget { [weak self] _ in Task { @MainActor in _ = try? self?.dispatch(method, []) }; return .success }
            remoteTargets.append((command, target))
        }
        bind(center.playCommand, "play"); bind(center.pauseCommand, "pause"); bind(center.stopCommand, "stop")
        remoteTargets.append((center.changePlaybackPositionCommand, center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            Task { @MainActor in _ = try? self?.dispatch("seekTo", [.number(event.positionTime * 1000)]) }; return .success
        }))
    }
    private func emit(_ name: String, _ args: [JSONValue] = []) { model.bridge.emit("player", name, args) }
    private func track(_ name: String, _ value: JSONValue) throws {
        let text = value.string ?? String(Int(value.number ?? -1))
        if name == "sid", text.hasPrefix("#,") {
            let url = String(text.dropFirst(2)); try validateMedia(url); try engine?.command(["sub-add", url, "select"])
        } else { try engine?.set(name, PlaybackContract.track(text)) }
    }
    private func validateMedia(_ address: String) throws {
        guard let url = URL(string: address), url.user == nil, url.password == nil else { throw CoreError.invalidAddress }
        if ["http", "https"].contains(url.scheme) { return }
        if url.isFileURL, url.standardizedFileURL.path.hasPrefix(model.profiles.directory.path + "/") { return }
        throw CoreError.invalidAddress
    }
    @discardableResult func dispatch(_ method: String, _ args: [JSONValue]) throws -> JSONValue {
        func arg(_ index: Int) -> JSONValue { args.indices.contains(index) ? args[index] : .null }
        switch method {
        case "load":
            guard let url = arg(0).string else { throw CoreError.invalidAddress }; try validateMedia(url)
            stop(notify: false)
            metadata = arg(2); title = metadata["title"].string ?? metadata["metadata"]["Name"].string ?? "正在播放"
            currentID = metadata["metadata"]["Id"].string ?? ""
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .moviePlayback, options: [.allowAirPlay, .allowBluetoothA2DP])
            try session.setActive(true)
            let next = try MPVEngine(layer: surface.metal); engine = next
            do {
                try applySettings()
                audio = arg(3); subtitle = arg(4)
                startSeconds = try PlaybackContract.seconds(arg(1)["startMilliseconds"].number ?? 0)
                paused = arg(1)["autoplay"].bool == false; rate = model.settings.get("video", "default_playback_speed").number ?? 1
                try next.set("pause", paused ? "yes" : "no"); try next.set("speed", String(rate))
                var headers: [String] = []
                for (name, value) in metadata["headers"].object ?? [:] {
                    guard ["User-Agent", "Referer"].contains(name), let text = value.string, !text.contains(where: { $0 == "\r" || $0 == "\n" }) else { throw CoreError.invalidRequest }
                    headers.append(name + ": " + text)
                }
                if !headers.isEmpty { try next.set("http-header-fields", headers.joined(separator: ",")) }
                try next.command(["loadfile", url, "replace"])
            } catch { next.close(); engine = nil; throw error }
            model.diagnostics.record("info", "Player load requested"); state.begin(); active = true; locked = false; loaded = false; position = 0; duration = 0; watchdog = PlaybackWatchdog()
            priorBrightness = surface.window?.screen.brightness
            UIApplication.shared.isIdleTimerDisabled = true
            timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in Task { @MainActor in self?.tick() } }
            model.danmaku.autoMatch(metadata["metadata"]); emit("windowVisible", [.bool(true)]); emit("onMetaData", [metadata, .string(url)])
        case "stop": stop(notify: true)
        case "pause": endTemporarySpeed(); state.userPaused(); interruptionIntent = nil; try engine?.set("pause", "yes")
        case "play": try engine?.set("pause", "no")
        case "seekTo": try engine?.command(["seek", String(try PlaybackContract.seconds(arg(0).number ?? 0)), "absolute+exact"]); watchdog = PlaybackWatchdog()
        case "setPlaybackRate": endTemporarySpeed(); try engine?.set("speed", String(try PlaybackContract.rate(arg(0).number ?? 1000)))
        case "setVolume": try engine?.set("volume", String(min(100, max(0, arg(0).number ?? 100))))
        case "setMuted": try engine?.set("mute", arg(0).bool == true ? "yes" : "no")
        case "volume": return .number(engine?.number("volume") ?? 100)
        case "muted": return .bool(engine?.flag("mute") ?? false)
        case "getPosition": return .number(position * 1000)
        case "getDuration": return .number(duration * 1000)
        case "getSubtitleStreams": return metadata["media"]["subtitleStreams"].array.map(JSONValue.array) ?? .array([])
        case "setAudioStream": try track("aid", arg(0))
        case "setSubtitleStream": try track("sid", arg(0))
        case "setAudioDelay": try engine?.set("audio-delay", String((arg(0).number ?? 0) / 1000))
        case "setSubtitleDelay": try engine?.set("sub-delay", String((arg(0).number ?? 0) / 1000))
        case "getAudioDeviceList": return .array([.object(["name": .string("auto"), "description": .string("iPad 系统音频输出")])])
        case "setAudioDevice": guard arg(0).string == "auto" else { throw CoreError.invalidRequest }
        case "getWebPlaylist": return .array(queue)
        case "getCurrentWebPlaylistItemId": return .string(currentID)
        case "setWebPlaylist": queue = arg(0).array ?? []; currentID = arg(1).string ?? currentID; emit("webPlaylistChanged", [.array(queue), .string(currentID)])
        case "clearQueue": queue = []; emit("webPlaylistChanged", [.array([]), .string(currentID)])
        case "queueMedia": throw CoreError.invalidRequest
        case "setVideoRectangle": emit("onVideoRecangleChanged")
        case "streamSwitch", "setVideoOnlyMode": break
        case "mpvDiagnostics": return diagnostics()
        case "notifyMetadata": if let text = arg(0)["Name"].string { title = text }; updateNowPlaying()
        case "notifyStreamingBitrateResult": notice = arg(1).bool == true ? "画质已切换" : "画质切换失败"
        default:
            guard ["notifyShuffleChange", "notifyRepeatChange", "notifyFullscreenChange", "notifyRateChange", "notifyQueueChange", "notifyPlaybackStop", "notifyDurationChange", "notifyPlaybackState", "notifyPosition", "notifySeek", "notifyVolumeChange"].contains(method) else { throw CoreError.invalidRequest }
            updateNowPlaying()
        }
        return .bool(true)
    }
    private func tick() {
        guard let engine, state.active else { return }
        let generation = state.generation
        for event in engine.events() {
            switch event {
            case .loaded:
                loaded = true; model.diagnostics.record("info", "Player file loaded")
                do {
                    if startSeconds > 0 { try engine.command(["seek", String(startSeconds), "absolute+exact"]) }
                    try track("aid", audio); try track("sid", subtitle)
                } catch { notice = "部分音轨或字幕设置未能应用" }
                emit(paused ? "paused" : "playing"); emit("videoPlaybackActive", [.bool(!paused)])
            case .ended: finish(generation); return
            case .failed: fail("无法播放此媒体，请检查格式和网络"); return
            }
        }
        if engine.flag("eof-reached") { finish(generation); return }
        let nextPaused = engine.flag("pause"), nextDuration = engine.number("duration"), nextRate = engine.number("speed")
        if nextPaused != paused { paused = nextPaused; emit(paused ? "paused" : "playing"); emit("videoPlaybackActive", [.bool(!paused)]) }
        if nextDuration != duration { duration = nextDuration; emit("updateDuration", [.number(duration * 1000)]) }
        if nextRate > 0, nextRate != rate { rate = nextRate; emit("playbackRateChanged", [.number(rate)]) }
        position = max(0, engine.number("time-pos")); buffering = engine.flag("paused-for-cache") || !loaded
        tracks = engine.json("track-list").array ?? []
        emit("positionUpdate", [.number(position * 1000)]); emit("buffering", [.number(buffering ? 0 : 100)])
        if watchdog.stalled(position: position, now: ProcessInfo.processInfo.systemUptime, paused: paused) { fail("播放超过 30 秒没有进展，请检查网络后重试"); return }
        updateNowPlaying()
    }
    private func finish(_ generation: UInt64) {
        guard state.finish(generation: generation) else { return }
        stop(notify: false); emit("finished"); emit("stopped")
    }
    private func fail(_ message: String) { stop(notify: false); emit("error", [.string(message)]); emit("stopped"); model.error = message }
    func stop(notify: Bool) {
        if let (coordinator,id)=model.offlinePlayback { coordinator.saveProgress(id,seconds:position); model.offlinePlayback=nil }
        let wasActive = state.finish(generation: state.generation)
        model.danmaku.clear(); timer?.invalidate(); timer = nil; temporary = TemporarySpeed()
        engine?.close(); engine = nil; active = false; loaded = false
        UIApplication.shared.isIdleTimerDisabled = false
        if let priorBrightness { surface.window?.screen.brightness = priorBrightness }; priorBrightness = nil
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        emit("windowVisible", [.bool(false)])
        if notify && wasActive { emit("canceled"); emit("stopped") }
    }
    func beginTemporarySpeed() { guard active, !paused, let speed = temporary.begin(current: rate) else { return }; try? engine?.set("speed", String(speed)) }
    func endTemporarySpeed() { if let rate = temporary.end() { try? engine?.set("speed", String(rate)) } }
    func adjacent(_ delta: Int) {
        let ids = queue.compactMap { $0["Id"].string ?? $0["id"].string }
        if let id = EpisodeQueue(ids: ids, current: currentID).neighbor(delta) { model.bridge.emit("input", "playlistItemRequested", [.string(id)]) }
    }
    func updateNowPlaying() { guard active else { return }; MPNowPlayingInfoCenter.default().nowPlayingInfo = [MPMediaItemPropertyTitle: title, MPMediaItemPropertyPlaybackDuration: duration, MPNowPlayingInfoPropertyElapsedPlaybackTime: position, MPNowPlayingInfoPropertyPlaybackRate: paused ? 0 : rate] }
    @objc private func interruption(_ note: Notification) {
        guard let type = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt else { return }
        if type == AVAudioSession.InterruptionType.began.rawValue {
            endTemporarySpeed(); interruptionIntent = !paused ? state.pauseIntent : nil; try? engine?.set("pause", "yes")
        } else {
            let options = note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
            if let intent = interruptionIntent, state.mayResume(interruptedAt: intent), AVAudioSession.InterruptionOptions(rawValue: options).contains(.shouldResume) { try? AVAudioSession.sharedInstance().setActive(true); try? engine?.set("pause", "no") }
            interruptionIntent = nil
        }
    }
    @objc private func routeChanged(_ note: Notification) {
        if note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue { _ = try? dispatch("pause", []) }
    }
    func diagnostics() -> JSONValue { .object(["version": .string(engine?.string("mpv-version") ?? ""), "renderBackend": .string("Metal / Vulkan (MoltenVK)"), "currentVo": .string(engine?.string("vo") ?? ""), "hwdec": .string(engine?.string("hwdec-current") ?? ""), "tracks": .array(tracks), "sourceWidth": .number(engine?.number("video-params/w") ?? 0), "sourceHeight": .number(engine?.number("video-params/h") ?? 0)]) }
    func applySettings() throws {
        guard let engine else { return }
        let settings = model.settings
        func text(_ section: String, _ key: String) -> String { let v = settings.get(section, key); return v.string ?? v.number.map(String.init(describing:)) ?? v.bool.map { $0 ? "yes" : "no" } ?? "" }
        let hardware = text("video", "hardwareDecoding")
        let mapping = ["hwdec": hardware == "disabled" ? "no" : hardware == "copy" ? "videotoolbox-copy" : "videotoolbox", "demuxer-max-bytes": String(Int((settings.get("video", "cache").number ?? 100) * 1048576)), "video-sync": text("video", "sync_mode"), "alang": text("mpv", "audioLanguage"), "slang": text("mpv", "subtitleLanguage"), "cache-pause": text("mpv", "cachePause"), "deband": text("mpv", "deband"), "tone-mapping": text("mpv", "toneMapping"), "audio-channels": text("audio", "channels"), "deinterlace": text("video", "deinterlace"), "audio-delay": String((settings.get("video", "audio_delay.normal").number ?? 0) / 1000), "sub-font": text("subtitles", "font"), "sub-ass-override": text("subtitles", "ass_style_override")]
        for (key, value) in mapping where !value.isEmpty { try engine.set(key, value) }
        try engine.set("af", settings.get("audio", "normalize").bool == true ? "lavfi=[dynaudnorm]" : "")
        if let data=try? Data(contentsOf:model.profiles.directory.appending(path:"quality.json")),let custom=try? JSONDecoder().decode([String:String].self,from:data) {
            let validated=try MPVConfigurationPolicy.parse(custom.map { $0.key+"="+$0.value }.joined(separator:"\n"),shaderRoot:model.profiles.directory.appending(path:"Shaders"))
            for (key,value) in validated {try engine.set(key,value)}
        }
    }
}
