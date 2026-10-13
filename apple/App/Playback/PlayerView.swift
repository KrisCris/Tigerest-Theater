import SwiftUI
import AppleCore
struct PlayerSurface: UIViewRepresentable {
    let player: PlaybackController
    func makeUIView(context: Context) -> MetalSurface { player.surface }
    func updateUIView(_ view: MetalSurface, context: Context) { view.setNeedsLayout() }
}
struct PlayerView: View {
    @ObservedObject var player: PlaybackController
    @State private var controls = true
    @State private var scrub = 0.0
    @State private var seeking = false
    @State private var importSubtitle = false
    @State private var showDanmaku = false
    @State private var showQuality = false
    private func act(_ method: String, _ args: [JSONValue] = []) { do { try player.dispatch(method, args) } catch { player.notice = "播放操作未完成" } }
    var body: some View {
        ZStack {
            Color.black
            PlayerSurface(player: player)
                .contentShape(Rectangle()).onTapGesture(count: 2) { if !player.locked { act(player.paused ? "play" : "pause") } }
                .onTapGesture { controls.toggle() }
                .onLongPressGesture(minimumDuration: 0.35, pressing: { pressing in if !pressing { player.endTemporarySpeed() } }) { if !player.locked { player.beginTemporarySpeed() } }
            DanmakuOverlay(repository:player.model.danmaku,player:player)
            if player.buffering { ProgressView().controlSize(.large) }
            if controls {
                VStack(spacing: 20) {
                    HStack {
                        if !player.locked { Button { act("stop") } label: { Image(systemName: "chevron.down").font(.title2) }; Text(player.title).font(.headline).lineLimit(1) }
                        Spacer()
                        Button { player.locked.toggle() } label: { Image(systemName: player.locked ? "lock.fill" : "lock.open") }
                    }
                    Spacer()
                    if !player.locked {
                        HStack(spacing: 40) {
                            Button { player.adjacent(-1) } label: { Image(systemName: "backward.end.fill") }.accessibilityLabel("上一集")
                            Button { act("seekTo", [.number(max(0, player.position - 10) * 1000)]) } label: { Image(systemName: "gobackward.10") }
                            Button { act(player.paused ? "play" : "pause") } label: { Image(systemName: player.paused ? "play.fill" : "pause.fill").font(.largeTitle) }.keyboardShortcut(.space, modifiers: [])
                            Button { act("seekTo", [.number((player.position + 10) * 1000)]) } label: { Image(systemName: "goforward.10") }
                            Button { player.adjacent(1) } label: { Image(systemName: "forward.end.fill") }.accessibilityLabel("下一集")
                        }.font(.title2)
                        Spacer()
                        Slider(value: Binding(get: { seeking ? scrub : player.position }, set: { scrub = $0 }), in: 0...max(1, player.duration), onEditingChanged: { editing in seeking = editing; if !editing { act("seekTo", [.number(scrub * 1000)]) } })
                        HStack {
                            Text("\(time(player.position)) / \(time(player.duration))").monospacedDigit()
                            Spacer()
                            Menu("\(player.rate, specifier: "%.2g")×") { ForEach([0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4], id: \.self) { rate in Button("\(rate, specifier: "%.2g")×") { act("setPlaybackRate", [.number(rate * 1000)]) } } }
                            Button("弹幕") { showDanmaku = true }
                            Menu("选集") {
                                ForEach(Array(player.queue.enumerated()), id: \.offset) { _, item in
                                    if let id = item["PlaylistItemId"].string {
                                        Button { player.selectQueueItem(id) } label: {
                                            if id == player.currentID { Label(item["Name"].string ?? "当前媒体", systemImage: "play.fill") }
                                            else { Text(item["Name"].string ?? "媒体") }
                                        }
                                    }
                                }
                            }.disabled(player.queue.isEmpty)
                            Menu("音轨") { trackMenu("audio", method: "setAudioStream") }
                            Menu("字幕") { Button("关闭") { act("setSubtitleStream", [.number(-1)]) }; trackMenu("sub", method: "setSubtitleStream"); Button("导入字幕") { importSubtitle = true }; Button("提前 0.5 秒") { delay(-0.5) }; Button("延后 0.5 秒") { delay(0.5) } }
                            Menu("画质") { Button("渲染与着色器") { showQuality=true }; ForEach([0, 20000000, 10000000, 4000000], id: \.self) { bitrate in Button(bitrate == 0 ? "原始画质" : "\(bitrate / 1000000) Mbps") { player.model.bridge.emit("player", "streamingBitrateRequested", [.number(Double(bitrate))]) } } }
                        }.font(.callout)
                        if !player.notice.isEmpty { Text(player.notice).font(.caption) }
                    }
                }.padding(28).background(LinearGradient(colors: [.black.opacity(0.6), .clear, .black.opacity(0.7)], startPoint: .top, endPoint: .bottom))
            }
        }.ignoresSafeArea().foregroundStyle(.white)
            .sheet(isPresented:$showQuality) { QualitySettings(player:player) }
            .sheet(isPresented:$showDanmaku) { DanmakuControls(repository:player.model.danmaku) }
            .fileImporter(isPresented: $importSubtitle, allowedContentTypes: [.data]) { result in
                do {
                    let source = try result.get(), granted = source.startAccessingSecurityScopedResource(); defer { if granted { source.stopAccessingSecurityScopedResource() } }
                    guard ["srt", "ass", "ssa", "vtt", "sup", "sub"].contains(source.pathExtension.lowercased()) else { throw CoreError.invalidRequest }
                    let directory = player.model.profiles.directory.appending(path: "Imported"); try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                    let target = directory.appending(path: UUID().uuidString + "." + source.pathExtension)
                    try FileManager.default.copyItem(at: source, to: target)
                    act("setSubtitleStream", [.string("#," + target.absoluteString)])
                } catch { player.notice = "字幕导入失败，请检查文件格式" }
            }
    }
    @ViewBuilder private func trackMenu(_ type: String, method: String) -> some View {
        ForEach(Array(player.tracks.filter { $0["type"].string == type }.enumerated()), id: \.offset) { _, track in
            Button(track["title"].string ?? track["lang"].string ?? "轨道 \(Int(track["id"].number ?? 0))") { act(method, [.number(track["id"].number ?? -1)]) }
        }
    }
    private func delay(_ change: Double) { act("setSubtitleDelay", [.number(((player.engine?.number("sub-delay") ?? 0) + change) * 1000)]) }
    private func time(_ value: Double) -> String { let v = Int(max(0, value)); return String(format: "%d:%02d:%02d", v / 3600, v / 60 % 60, v % 60) }
}
