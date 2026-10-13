import SwiftUI
import AppleCore
struct PlayerSurface: UIViewRepresentable {
    let player: PlaybackController
    func makeUIView(context: Context) -> MetalSurface {
        player.surface.addSubview(player.systemVolume.view)
        return player.surface
    }
    func updateUIView(_ view: MetalSurface, context: Context) { view.setNeedsLayout() }
}
struct GestureVideoView: View {
    @StateObject private var gestures: PlayerGestureCoordinator
    let tapped: () -> Void
    let feedback: (String, Bool) -> Void
    init(player: PlaybackController, tapped: @escaping () -> Void, feedback: @escaping (String, Bool) -> Void) {
        _gestures = StateObject(wrappedValue: PlayerGestureCoordinator(player: player, tapped: tapped, feedback: feedback))
        self.tapped = tapped; self.feedback = feedback
    }
    var body: some View {
        ZStack {
            PlayerSurface(player: gestures.player).allowsHitTesting(false)
            Color.clear.contentShape(Rectangle())
            .gesture(VideoGesture(kind: .tap, handler: gestures, tapped: tapped, feedback: feedback))
            .gesture(VideoGesture(kind: .doubleTap, handler: gestures, tapped: tapped, feedback: feedback))
            .gesture(VideoGesture(kind: .pan, handler: gestures, tapped: tapped, feedback: feedback))
            .gesture(VideoGesture(kind: .hold, handler: gestures, tapped: tapped, feedback: feedback))
        }.onDisappear { gestures.detach() }
    }
}
struct PlayerView: View {
    @ObservedObject var player: PlaybackController
    @State private var controls = true
    @State private var scrub = 0.0
    @State private var seeking = false
    @State private var importSubtitle = false
    @State private var showDanmaku = false
    @State private var showQueue = false
    @State private var unlockVisible = false
    @State private var unlockTask: Task<Void, Never>?
    @State private var gestureMessage = ""
    @State private var interacting = false
    @State private var hideTask: Task<Void, Never>?
    @State private var feedbackTask: Task<Void, Never>?
    @State private var showTutorial = false
    @State private var tutorialResumeIntent: UInt64?
    @State private var tutorialRevision: UInt64 = 0
    @AppStorage("TigerestPlaybackGesturesSeen") private var tutorialSeen = false
    @Environment(\.scenePhase) private var scenePhase
    private func act(_ method: String, _ args: [JSONValue] = []) { do { try player.dispatch(method, args) } catch { player.notice = "播放操作未完成" } }
    var body: some View {
        ZStack {
            Color.black
            PlayerKeyboardInput(enabled:!showTutorial && !showDanmaku && !showQueue && !importSubtitle) {
                guard !player.locked else { revealUnlock(); return }
                act((player.engine?.flag("pause") ?? player.paused) ? "play" : "pause")
            }.frame(width:0,height:0).allowsHitTesting(false)
            GestureVideoView(player: player, tapped: { if player.locked { revealUnlock() } else { controls.toggle(); scheduleHide() } }, feedback: gestureFeedback)
                .accessibilityIdentifier("playerVideo").accessibilityLabel("视频画面")
            DanmakuOverlay(repository:player.model.danmaku,player:player).allowsHitTesting(false)
            if player.buffering { ProgressView().controlSize(.large) }
            if !gestureMessage.isEmpty {
                Text(gestureMessage).font(.title3.monospacedDigit()).multilineTextAlignment(.center)
                    .padding(20).background(.black.opacity(0.8), in: RoundedRectangle(cornerRadius: 14))
                    .allowsHitTesting(false).accessibilityIdentifier("playerGestureFeedback")
            }
            if controls && !player.locked {
                LinearGradient(colors: [.black.opacity(0.6), .clear, .black.opacity(0.7)], startPoint: .top, endPoint: .bottom).allowsHitTesting(false)
                VStack(spacing: 20) {
                    HStack {
                        if !player.locked { Button { act("stop") } label: { Image(systemName: "chevron.down").font(.title2) }.accessibilityLabel("退出播放"); Text(player.title).font(.headline).lineLimit(1) }
                        Spacer()
                        Button { presentTutorial() } label: { Image(systemName: "hand.draw") }.accessibilityLabel("手势教程")
                        Button { player.setTouchLocked(true); controls = false } label: { Image(systemName: "lock.open") }.accessibilityLabel("锁定")
                    }
                    Spacer()
                    if !player.locked {
                        HStack(spacing: 40) {
                            Button { player.adjacent(-1) } label: { Image(systemName: "backward.end.fill") }.accessibilityLabel("上一集")
                                .disabled(player.adjacentID(-1) == nil)
                            Button { act("seekTo", [.number(max(0, player.position - 10) * 1000)]) } label: { Image(systemName: "gobackward.10") }
                            Button { act(player.paused ? "play" : "pause") } label: { Image(systemName: player.paused ? "play.fill" : "pause.fill").font(.largeTitle) }.accessibilityLabel(player.paused ? "播放" : "暂停")
                            Button { act("seekTo", [.number((player.position + 10) * 1000)]) } label: { Image(systemName: "goforward.10") }
                            Button { player.adjacent(1) } label: { Image(systemName: "forward.end.fill") }.accessibilityLabel("下一集")
                                .disabled(player.adjacentID(1) == nil)
                        }.font(.title2)
                        Spacer()
                        Slider(value: Binding(get: { seeking ? scrub : player.position }, set: { scrub = $0 }), in: 0...max(1, player.duration), onEditingChanged: { editing in seeking = editing; if !editing { act("seekTo", [.number(scrub * 1000)]) } })
                        HStack {
                            Text("\(time(player.position)) / \(time(player.duration))").monospacedDigit().accessibilityIdentifier("playbackTime")
                            Spacer()
                            Menu("\(player.rate, specifier: "%.2g")×") { ForEach([0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4], id: \.self) { rate in Button("\(rate, specifier: "%.2g")×") { act("setPlaybackRate", [.number(rate * 1000)]) } } }
                            Button("弹幕") { showDanmaku = true }
                            Button("选集") { showQueue = true }
                                .disabled(player.queue.isEmpty)
                                .popover(isPresented: $showQueue) {
                                    NavigationStack {
                                        List {
                                            ForEach(Array(player.queue.enumerated()), id: \.offset) { _, item in
                                                if let id = item["PlaylistItemId"].string {
                                                    Button { player.selectQueueItem(id); showQueue = false } label: {
                                                        if id == player.currentID { Label(queueLabel(item), systemImage: "play.fill") }
                                                        else { Text(queueLabel(item)) }
                                                    }
                                                }
                                            }
                                        }.navigationTitle("选集").navigationBarTitleDisplayMode(.inline)
                                            .toolbar { Button("完成") { showQueue = false } }
                                    }.buttonStyle(.plain)
                                        .frame(minWidth: 280, idealWidth: 360, maxWidth: 420, minHeight: 260, idealHeight: 440, maxHeight: 560)
                                        .presentationCompactAdaptation(.popover)
                                }
                            Menu("音轨") { trackMenu("audio", method: "setAudioStream") }
                            Menu("字幕") { Button("关闭") { act("setSubtitleStream", [.number(-1)]) }; trackMenu("sub", method: "setSubtitleStream"); Button("导入字幕") { importSubtitle = true }; Button("提前 0.5 秒") { delay(-0.5) }; Button("延后 0.5 秒") { delay(0.5) } }
                            Menu("码率") { ForEach([0, 20000000, 10000000, 4000000], id: \.self) { bitrate in Button(bitrate == 0 ? "原始画质" : "\(bitrate / 1000000) Mbps") { player.model.bridge.emit("player", "streamingBitrateRequested", [.number(Double(bitrate))]) } } }
                        }.font(.callout)
                        if !player.notice.isEmpty { Text(player.notice).font(.caption) }
                        DanmakuPlaybackStatus(repository: player.model.danmaku)
                    }
                }.buttonStyle(PlayerTouchButtonStyle()).padding(28)
            }
            if player.locked && unlockVisible {
                HStack {
                    Button { revealUnlock() } label: { Label("长按解锁", systemImage: "lock.fill").padding(14).background(.black.opacity(0.75), in: Capsule()) }
                        .simultaneousGesture(LongPressGesture(minimumDuration: 0.6).onEnded { _ in unlock() })
                        .simultaneousGesture(DragGesture(minimumDistance: 0)
                            .onChanged { _ in unlockTask?.cancel() }
                            .onEnded { _ in if player.locked { revealUnlock() } })
                        .accessibilityLabel("长按解除防误触锁")
                        .accessibilityAction(named: Text("解除防误触锁")) { unlock() }
                    Spacer()
                }.padding(28)
            }
        }.ignoresSafeArea().foregroundStyle(.white)
            .onAppear { if !tutorialSeen { presentTutorial() }; scheduleHide() }
            .onDisappear { unlockTask?.cancel(); hideTask?.cancel(); feedbackTask?.cancel(); player.endTemporarySpeed() }
            .onChange(of: [seeking, showTutorial, showDanmaku, showQueue, importSubtitle]) { _, _ in scheduleHide() }
            .onChange(of: player.locked) { _, locked in
                feedbackTask?.cancel(); gestureMessage = ""
                if locked { revealUnlock() } else { unlockTask?.cancel(); unlockVisible = false }
            }
            .onChange(of: player.paused) { _, paused in if paused && !player.locked { controls = true }; scheduleHide() }
            .onChange(of: scenePhase) { _, phase in if phase != .active { hideTask?.cancel(); gestureMessage = ""; interacting = false } }
            .sheet(isPresented: $showTutorial, onDismiss: finishTutorial) {
                NavigationStack {
                    ScrollView {
                        Text("轻点画面：显示或隐藏控制栏\n\n双击画面：播放或暂停\n\n左右滑动：预览快进或快退，松手跳转\n\n左侧上下滑动：调整本次播放的亮度，退出后恢复\n\n右侧上下滑动：调整系统媒体音量\n\n长按空白画面：临时 2× 播放，松手恢复原速度；原速度超过 2× 时保持原速度\n\n锁定后提示会自动隐藏；轻点画面唤回按钮，长按解锁恢复操作\n\n请从画面内部开始滑动，屏幕边缘留给系统手势。")
                            .frame(maxWidth: .infinity, alignment: .leading).padding(24)
                    }.navigationTitle("播放手势").toolbar { Button("知道了") { showTutorial = false } }
                }.presentationDetents([.large])
            }
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
    private func revealUnlock() {
        unlockTask?.cancel(); unlockVisible = true
        unlockTask = Task { @MainActor in
            do { try await Task.sleep(for: .seconds(3)) } catch { return }
            unlockVisible = false
        }
    }
    private func unlock() { player.setTouchLocked(false); controls = true; scheduleHide() }
    private func gestureFeedback(_ text: String, _ touching: Bool) {
        feedbackTask?.cancel(); interacting = touching
        if !text.isEmpty { gestureMessage = text }
        else {
            feedbackTask = Task { @MainActor in
                do { try await Task.sleep(for: .milliseconds(800)) } catch { return }
                gestureMessage = ""
            }
        }
        if touching { hideTask?.cancel() } else { scheduleHide() }
    }
    private func scheduleHide() {
        hideTask?.cancel()
        guard controls, !player.paused, !player.locked, !interacting, !seeking,
              !showTutorial, !showDanmaku, !showQueue, !importSubtitle else { return }
        hideTask = Task { @MainActor in
            do { try await Task.sleep(for: .milliseconds(3500)) } catch { return }
            guard !player.paused, !player.locked, !interacting, !seeking,
                  !showTutorial, !showDanmaku, !showQueue, !importSubtitle else { return }
            controls = false
        }
    }
    private func presentTutorial() {
        guard !player.locked else { return }
        player.endTemporarySpeed(); hideTask?.cancel()
        let resume = !player.paused
        if resume { act("pause") }
        tutorialResumeIntent = resume ? player.pauseIntent : nil
        tutorialRevision = player.interactionRevision; showTutorial = true
    }
    private func finishTutorial() {
        tutorialSeen = true
        if let intent = tutorialResumeIntent, intent == player.pauseIntent,
           tutorialRevision == player.interactionRevision, player.active, scenePhase == .active { act("play") }
        tutorialResumeIntent = nil; scheduleHide()
    }
    private func queueLabel(_ item: JSONValue) -> String {
        let code = [("S", "ParentIndexNumber"), ("E", "IndexNumber")].compactMap { prefix, key -> String? in
            guard let raw = item[key].number ?? item[key].string.flatMap(Double.init),
                  let number = Int(exactly: raw), number >= 0 else { return nil }
            return prefix + (number < 10 ? "0" : "") + String(number)
        }.joined()
        let name = item["Name"].string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let title = name.isEmpty ? "媒体" : name
        return code.isEmpty ? title : "\(code) · \(title)"
    }
    @ViewBuilder private func trackMenu(_ type: String, method: String) -> some View {
        ForEach(Array(player.tracks.filter { $0["type"].string == type }.enumerated()), id: \.offset) { _, track in
            Button(track["title"].string ?? track["lang"].string ?? "轨道 \(Int(track["id"].number ?? 0))") { act(method, [.number(track["id"].number ?? -1)]) }
        }
    }
    private func delay(_ change: Double) { act("setSubtitleDelay", [.number(((player.engine?.number("sub-delay") ?? 0) + change) * 1000)]) }
    private func time(_ value: Double) -> String { let v = Int(max(0, value)); return String(format: "%d:%02d:%02d", v / 3600, v / 60 % 60, v % 60) }
}

private struct PlayerTouchButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.frame(minWidth: 44, minHeight: 44)
            .contentShape(Rectangle()).opacity(configuration.isPressed ? 0.55 : 1)
    }
}

private struct DanmakuPlaybackStatus: View {
    @ObservedObject var repository: DanmakuRepository
    var body: some View {
        if !repository.status.isEmpty {
            Text(repository.status).font(.caption).foregroundStyle(.secondary).lineLimit(2).accessibilityIdentifier("danmakuStatus")
        }
    }
}

/// Keep the player in the responder chain when its visible OSD is removed.
/// Suspend during sheets so spaces in search fields remain ordinary text input.
private struct PlayerKeyboardInput: UIViewRepresentable {
    let enabled:Bool
    let toggle:()->Void
    func makeUIView(context:Context) -> PlayerKeyboardResponder { PlayerKeyboardResponder() }
    func updateUIView(_ view:PlayerKeyboardResponder,context:Context) {
        view.toggle=toggle;view.acceptsKeyboard=enabled
    }
    static func dismantleUIView(_ view:PlayerKeyboardResponder,coordinator:()) {view.acceptsKeyboard=false;view.toggle=nil}
}
private final class PlayerKeyboardResponder: UIView {
    var toggle:(()->Void)?
    var acceptsKeyboard=false {
        didSet {
            guard acceptsKeyboard != oldValue else {return}
            if acceptsKeyboard {becomeFirstResponder()} else {resignFirstResponder()}
        }
    }
    override var canBecomeFirstResponder:Bool {acceptsKeyboard}
    override func didMoveToWindow() {super.didMoveToWindow();if window != nil && acceptsKeyboard {becomeFirstResponder()}}
    override var keyCommands:[UIKeyCommand]? {
        guard acceptsKeyboard else {return nil}
        let command=UIKeyCommand(input:" ",modifierFlags:[],action:#selector(togglePlayback))
        command.wantsPriorityOverSystemBehavior=true
        command.discoverabilityTitle="播放 / 暂停"
        return [command]
    }
    @objc private func togglePlayback() {toggle?()}
}
