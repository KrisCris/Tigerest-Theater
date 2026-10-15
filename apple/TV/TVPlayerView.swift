import SwiftUI

private struct TVVideoSurface: UIViewRepresentable {
    let player: TVPlaybackController
    func makeUIView(context: Context) -> MetalSurface { player.surface }
    func updateUIView(_ view: MetalSurface, context: Context) {}
}

struct TVPlayerView: View {
    @ObservedObject var player: TVPlaybackController
    @State private var controlsVisible = true
    @State private var interaction = 0
    @FocusState private var focused: Bool
    private func reveal() { controlsVisible = true; interaction += 1 }
    private func time(_ value: Double) -> String {
        let s = value.isFinite ? Int(min(1_000_000_000, max(0, value))) : 0; return s >= 3600 ? String(format: "%d:%02d:%02d", s / 3600, (s / 60) % 60, s % 60) : String(format: "%d:%02d", s / 60, s % 60)
    }
    var body: some View {
        ZStack(alignment: .bottom) {
            Color.black.ignoresSafeArea()
            TVVideoSurface(player: player).ignoresSafeArea()
            if player.buffering { ProgressView("正在缓冲").frame(maxWidth: .infinity, maxHeight: .infinity) }
            if controlsVisible || player.paused {
                VStack(alignment: .leading, spacing: 22) {
                    Text(player.title).font(.title2).lineLimit(2)
                    ProgressView(value: min(player.position, max(player.duration, 1)), total: max(player.duration, 1))
                    HStack(spacing: 30) {
                        Text(time(player.position) + " / " + time(player.duration)).monospacedDigit().accessibilityIdentifier("tv.player.position")
                        Spacer()
                        Button { player.seek(by: -10); reveal() } label: { Label("后退 10 秒", systemImage: "gobackward.10") }.accessibilityIdentifier("tv.player.back")
                        Button { player.togglePause(); reveal() } label: { Label(player.paused ? "播放" : "暂停", systemImage: player.paused ? "play.fill" : "pause.fill") }.focused($focused).accessibilityIdentifier("tv.player.pause")
                        Button { player.seek(by: 10); reveal() } label: { Label("前进 10 秒", systemImage: "goforward.10") }.accessibilityIdentifier("tv.player.forward")
                        Button("退出播放") { player.stop() }.accessibilityIdentifier("tv.player.close")
                    }
                    if let error = player.error { Text(error).font(.callout).foregroundStyle(.yellow) }
                }
                .padding(50).background(.black.opacity(0.78))
            } else {
                Button("显示播放控制") { reveal(); focused = true }
                    .opacity(0.015).accessibilityLabel("显示播放控制").accessibilityIdentifier("tv.player.reveal")
            }
        }
        .onPlayPauseCommand { player.togglePause(); reveal() }
        .onMoveCommand { direction in
            if !controlsVisible {
                if direction == .left { player.seek(by: -10) }
                if direction == .right { player.seek(by: 10) }
                reveal(); focused = true
            } else { reveal() }
        }
        .onExitCommand { player.stop() }
        .task(id: interaction) {
            try? await Task.sleep(for: .seconds(5))
            guard !Task.isCancelled, !player.paused, !player.buffering else { return }
            controlsVisible = false
        }
        .onAppear { focused = true }
    }
}
