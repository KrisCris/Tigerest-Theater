import SwiftUI
@main struct TigerestApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var model = AppModel()
    var body: some Scene {
        WindowGroup {
            RootView(model: model).preferredColorScheme(.dark)
        }
    }
}
struct RootView: View {
    @ObservedObject var model: AppModel
    @State private var playbackActive = false
    var body: some View {
        ZStack(alignment: .top) {
            Color(red: 0.035, green: 0.045, blue: 0.065).ignoresSafeArea()
            if model.server != nil { LibraryPresentation(host: model.web, player: model.player).id(model.profiles.currentID).ignoresSafeArea(edges: .bottom) }
            if model.server == nil { OnboardingView(model: model) }
            if model.loading { ProgressView().padding(12).background(.regularMaterial, in: Capsule()) }
            if let failure = model.connectionFailure {
                ContentUnavailableView {
                    Label("暂时无法打开媒体库", systemImage: "wifi.exclamationmark")
                } description: { Text(failure) } actions: {
                    Button("重试") { model.start() }.buttonStyle(.borderedProminent)
                    Button("选择服务器") { model.openServerSettings() }
                    Button("离线媒体") { model.showOffline = true }
                }.frame(maxWidth: .infinity, maxHeight: .infinity).background(.background)
            }
        }
        .sheet(isPresented: $model.showQuality) { QualitySettings(player: model.player) }
        .sheet(isPresented: Binding(get: { model.showConnection && model.server != nil }, set: { model.showConnection = $0 })) { OnboardingView(model: model) }
        .sheet(isPresented: Binding(get: { model.showOffline && model.server != nil && !model.showConnection }, set: { model.showOffline = $0 })) { OfflineLibraryView(coordinator:model.downloads,model:model) }
        .sheet(isPresented: Binding(get: { model.showProfiles && model.server != nil && !model.showConnection }, set: { model.showProfiles = $0 })) { ProfileManagerView(model:model) }
        .alert("操作未完成", isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })) { Button("好") { model.error = nil } } message: { Text(model.error ?? "") }
        .overlay { PlayerPresentation(player: model.player) }
        .statusBarHidden(playbackActive)
        .onReceive(model.player.$active.removeDuplicates()) { playbackActive = $0 }
        .onAppear {
            model.start()
            #if DEBUG
            DeviceTour.startIfRequested(model)
            #endif
        }
        #if PLAYBACK_VALIDATION
        .task { if ProcessInfo.processInfo.arguments.contains("--device-quality-probe") { await PlaybackValidation.run(model) } }
        #endif
    }
}

struct LibraryPresentation: View {
    let host: WebHost
    @ObservedObject var player: PlaybackController
    var body: some View {
        WebView(host: host).id(ObjectIdentifier(host)).allowsHitTesting(!player.active).accessibilityHidden(player.active)
    }
}

struct PlayerPresentation: View {
    @ObservedObject var player: PlaybackController
    var body: some View { if player.active { PlayerView(player: player) } }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
        DownloadCoordinator.backgroundCompletions[identifier]=completionHandler
        if let id=identifier.split(separator:".").last.flatMap({UUID(uuidString:String($0))}), let model=AppModel.shared, model.profiles.profiles.contains(where:{$0.id==id}) { _ = model.coordinator(for:id) }
        else { DownloadCoordinator.backgroundCompletions.removeValue(forKey:identifier)?() }
    }
}
