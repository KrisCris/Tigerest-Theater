import Foundation
import Combine
import AppleCore

struct TVSubtitleOption: Identifiable, Equatable {
    let id: String
    let generation: UUID
    let title: String
    let language: String?
    let isExternal: Bool
    let isDefault: Bool
    let isForced: Bool
    let mpvID: Int?
    let externalURL: URL?
    var canSelect: Bool { mpvID != nil || externalURL != nil }
    var accessibilityID: String { mpvID.map { "tv.subtitles.track.\($0)" } ?? "tv.subtitles.\(id)" }
}

/// MPV commands are asynchronous. A subtitle is selected only after its actual
/// track appears and MPV reports that SID as selected; failed subtitles never
/// tear down the video engine.
@MainActor final class TVSubtitleController: ObservableObject {
    @Published private(set) var options: [TVSubtitleOption] = []
    @Published private(set) var selectedID: String?
    @Published private(set) var isLoading = false
    @Published private(set) var isReady = false
    @Published private(set) var error: String?
    @Published private(set) var delay = 0.0
    private weak var engine: MPVEngine?
    private var generation = UUID()
    private var metadata: [EmbySubtitleTrack] = []
    private var initialIndex: Int?
    private var requestedURLs: Set<URL> = []
    private struct Pending { let id: String; let deadline: TimeInterval; var appliedSID: Int? }
    private var pending: Pending?
    var status: String {
        if isLoading { return "正在载入字幕…" }
        if let selectedID, let option = options.first(where: { $0.id == selectedID }) { return "已选择：" + option.title }
        return "字幕已关闭"
    }

    func begin(playback: EmbyPlayback, engine: MPVEngine) {
        reset(); self.engine = engine
        var seen: Set<Int> = []
        metadata = playback.subtitleTracks.prefix(512).filter { seen.insert($0.index).inserted }
        // native/mpvVideoPlayer.js treats both absent and -1 defaults as off.
        initialIndex = playback.defaultSubtitleStreamIndex
        rebuild([])
        do {
            try engine.set("sid", "no"); try engine.set("secondary-sid", "no")
            try engine.set("sub-visibility", "yes"); try engine.set("sub-delay", "0")
            // Supply CJK glyphs even on a minimal TV runtime. This sets the
            // default/fallback family, while authored ASS styles and embedded
            // fonts keep their own typography and positioning.
            if let fonts = Bundle.main.resourceURL?.appending(path: "SubtitleFonts") {
                try engine.set("sub-fonts-dir", fonts.path)
            }
            try engine.set("sub-font", "Source Han Sans SC")
            // Plain-text subtitles a little larger than mpv's default for
            // viewing distance; ASS keeps its authored sizes (override is off).
            try engine.set("sub-scale", "1.15")
            try engine.set("sub-ass-override", "no")
        } catch { self.error = "字幕设置未能初始化，请在字幕面板重新选择。" }
    }
    func reset() {
        generation = UUID(); engine = nil; metadata = []; initialIndex = nil
        pending = nil; requestedURLs = []; options = []; selectedID = nil
        isLoading = false; isReady = false; error = nil; delay = 0
    }
    func fileLoaded() {
        guard !isReady, engine != nil else { return }
        isReady = true; update()
        if let initialIndex, initialIndex >= 0 {
            if let option = options.first(where: { $0.id == "emby.\(initialIndex)" }) { select(option) }
            else { select(nil); error = "服务器指定的字幕不可用，请手动选择。" }
        } else { select(nil) }
    }
    func select(_ option: TVSubtitleOption?) {
        guard let engine, isReady else { return }
        if let option {
            guard option.generation == generation, options.contains(where: { $0.id == option.id }) else { return }
            pending = Pending(id: option.id, deadline: ProcessInfo.processInfo.systemUptime + 30)
            isLoading = true; error = nil; update()
        } else {
            pending = nil; isLoading = false
            do {
                try engine.set("sid", "no"); try engine.set("secondary-sid", "no")
                guard engine.string("sid") == "no" else { throw CoreError.invalidSetting }
                selectedID = nil; error = nil
            } catch { self.error = "未能关闭字幕，请重试。" }
        }
    }
    func adjustDelay(by change: Double) {
        guard let engine, change.isFinite else { return }
        let target = min(60, max(-60, delay + change))
        do {
            try engine.set("sub-delay", String(target))
            guard let actual = Double(engine.string("sub-delay")), actual.isFinite else { throw CoreError.invalidSetting }
            delay = actual; error = nil
        } catch { self.error = "字幕时间未能调整，请重试。" }
    }
    func update(now: TimeInterval = ProcessInfo.processInfo.systemUptime) {
        guard let engine, isReady else { return }
        let tracks = (engine.json("track-list").array ?? []).prefix(512).filter { $0["type"].string == "sub" && Self.integer($0["id"]) != nil }
        rebuild(tracks)
        let sid = Int(engine.string("sid"))
        if engine.string("sid") == "no" { selectedID = nil }
        else if let sid, tracks.contains(where: { Self.integer($0["id"]) == sid && $0["selected"].bool == true }) {
            selectedID = options.first(where: { $0.mpvID == sid })?.id
        } else { selectedID = nil }
        guard var pending else { return }
        guard now < pending.deadline else { fail("字幕未能载入，请检查连接后重试，或选择其他字幕。"); return }
        guard let option = options.first(where: { $0.id == pending.id }) else { fail("此字幕已不可用，请重新选择。"); return }
        if let mpvID = option.mpvID {
            if selectedID == option.id { self.pending = nil; isLoading = false; error = nil; return }
            if pending.appliedSID != mpvID {
                do {
                    try engine.set("sid", String(mpvID)); try engine.set("sub-visibility", "yes")
                    pending.appliedSID = mpvID; self.pending = pending
                } catch { fail("未能选择此字幕，请尝试其他字幕。") }
            }
        } else if let url = option.externalURL, !requestedURLs.contains(url) {
            do {
                // Keep automatic selection disabled. A late external load must
                // not overwrite a newer choice or the user's explicit off.
                try engine.command(["sub-add", url.absoluteString, "auto", option.title, option.language ?? ""])
                requestedURLs.insert(url)
            } catch { fail("外挂字幕加载失败，请检查连接后重试。") }
        }
    }
    private func fail(_ message: String) {
        if let id = pending?.id, let url = options.first(where: { $0.id == id })?.externalURL { requestedURLs.remove(url) }
        pending = nil; isLoading = false; error = message
        try? engine?.set("sid", "no")
        if engine?.string("sid") == "no" { selectedID = nil }
    }
    private func rebuild(_ tracks: [JSONValue]) {
        var used: Set<Int> = []
        var result = metadata.map { item -> TVSubtitleOption in
            let candidate: JSONValue?
            if let url = item.externalURL {
                candidate = tracks.first { $0["external"].bool == true && $0["external-filename"].string.flatMap(URL.init(string:)) == url }
            } else { candidate = embedded(item, tracks: tracks) }
            let sid = candidate.flatMap { Self.integer($0["id"]) }
            if let sid { used.insert(sid) }
            return TVSubtitleOption(id: "emby.\(item.index)", generation: generation, title: item.title,
                language: item.language, isExternal: item.isExternal || item.externalURL != nil,
                isDefault: item.isDefault, isForced: item.isForced, mpvID: sid, externalURL: item.externalURL)
        }
        for track in tracks {
            guard let sid = Self.integer(track["id"]), used.insert(sid).inserted else { continue }
            result.append(TVSubtitleOption(id: "mpv.\(sid)", generation: generation,
                title: track["title"].string ?? track["lang"].string ?? "字幕 \(sid)", language: track["lang"].string,
                isExternal: track["external"].bool == true, isDefault: track["default"].bool == true,
                isForced: track["forced"].bool == true, mpvID: sid, externalURL: nil))
        }
        if options != result { options = result }
    }
    private func embedded(_ item: EmbySubtitleTrack, tracks: [JSONValue]) -> JSONValue? {
        guard !item.isExternal else { return nil }
        let actual = tracks.filter { $0["external"].bool != true }
        let indexed = actual.filter { Self.integer($0["ff-index"], minimum: 0) == item.index }
        if indexed.count == 1, compatible(item, indexed[0]) { return indexed[0] }
        // Never contradict a known FFmpeg index with an ordinal guess. When
        // indexes are unavailable, require complete counts/order and unique
        // language+codec evidence (or the sole embedded track).
        let expected = metadata.filter { !$0.isExternal && $0.externalURL == nil }
        guard actual.allSatisfy({ $0["ff-index"] == .null }), expected.count == actual.count,
              let ordinal = item.embeddedIndex, ordinal > 0, ordinal <= actual.count else { return nil }
        let ordered = actual.sorted { (Self.integer($0["id"]) ?? 0) < (Self.integer($1["id"]) ?? 0) }
        guard ordered.enumerated().allSatisfy({ Self.integer($0.element["id"]) == $0.offset + 1 }),
              Set(expected.compactMap(\.embeddedIndex)) == Set(1...actual.count) else { return nil }
        let candidate = ordered[ordinal - 1]
        guard compatible(item, candidate) else { return nil }
        if actual.count == 1 { return candidate }
        guard let language = item.language, let codec = item.codec,
              Self.language(language) == Self.language(candidate["lang"].string ?? ""),
              Self.codec(codec) == Self.codec(candidate["codec"].string ?? ""),
              actual.filter({ compatible(item, $0) }).count == 1 else { return nil }
        return candidate
    }
    private func compatible(_ item: EmbySubtitleTrack, _ track: JSONValue) -> Bool {
        if let lhs = item.language, let rhs = track["lang"].string, !lhs.isEmpty, !rhs.isEmpty,
           Self.language(lhs) != Self.language(rhs) { return false }
        if let lhs = item.codec, let rhs = track["codec"].string, !lhs.isEmpty, !rhs.isEmpty,
           Self.codec(lhs) != Self.codec(rhs) { return false }
        return true
    }
    private static func integer(_ value: JSONValue, minimum: Int = 1) -> Int? {
        guard let number = value.number ?? value.string.flatMap(Double.init), let value = Int(exactly: number),
              (minimum...1_000_000).contains(value) else { return nil }
        return value
    }
    private static func language(_ value: String) -> String {
        let code = value.lowercased().replacingOccurrences(of: "_", with: "-").split(separator: "-").first.map(String.init) ?? ""
        return ["chi": "zh", "zho": "zh", "cmn": "zh", "eng": "en", "jpn": "ja", "kor": "ko", "fra": "fr", "fre": "fr", "deu": "de", "ger": "de" ][code] ?? code
    }
    private static func codec(_ value: String) -> String {
        let code = value.lowercased()
        return ["srt": "subrip", "ssa": "ass", "tx3g": "mov_text", "vtt": "webvtt", "pgs": "hdmv_pgs_subtitle", "dvdsub": "dvd_subtitle"][code] ?? code
    }
}
