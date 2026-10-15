import SwiftUI
@main struct TigerestTVApp: App {
    @StateObject private var model = TVAppModel()
    var body: some Scene { WindowGroup { TVRootContainer(model: model, player: model.player) } }
}
private struct TVRootContainer: View {
    @ObservedObject var model: TVAppModel
    @ObservedObject var player: TVPlaybackController
    @Environment(\.scenePhase) private var scenePhase
    var body: some View {
        TVRootView(model: model)
            .preferredColorScheme(.dark)
            .task { await model.start() }
            .fullScreenCover(isPresented: Binding(get: { player.active }, set: { if !$0 { player.stop() } })) {
                TVPlayerView(player: player, model: model)
            }
            .alert("播放提示", isPresented: Binding(get: { !player.active && player.error != nil }, set: { if !$0 { player.error = nil } })) {
                Button("明白") { player.error = nil }
            } message: { Text(player.error ?? "") }
            .onChange(of: scenePhase) { _, phase in if phase == .background { model.suspend(); player.stop() } }
    }
}
