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
    var body: some View {
        ZStack(alignment: .top) {
            Color(red: 0.035, green: 0.045, blue: 0.065).ignoresSafeArea()
            if model.server != nil { WebView(host: model.web).ignoresSafeArea(edges: .bottom) }
            if model.server == nil { OnboardingView(model: model) }
            if model.loading { ProgressView().padding(12).background(.regularMaterial, in: Capsule()) }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            HStack {
                Button("服务器", systemImage: "server.rack") { model.showConnection = true }
                Spacer()
                Button("配置", systemImage:"person.crop.rectangle") { model.showProfiles=true }
                Spacer()
                Button("重新载入", systemImage: "arrow.clockwise") { model.start() }.disabled(model.server == nil)
                Spacer()
                Button("离线媒体", systemImage: "arrow.down.circle") { model.showOffline = true }
            }.font(.callout).padding(.horizontal, 24).padding(.vertical, 10).background(.ultraThinMaterial)
        }
        .sheet(isPresented: Binding(get: { model.showConnection && model.server != nil }, set: { model.showConnection = $0 })) { OnboardingView(model: model) }
        .sheet(isPresented: $model.showOffline) { OfflineLibraryView(coordinator:model.downloads,model:model) }
        .sheet(isPresented:$model.showProfiles) { ProfileManagerView(model:model) }
        .alert("操作未完成", isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })) { Button("好") { model.error = nil } } message: { Text(model.error ?? "") }
        .overlay { PlayerPresentation(player: model.player) }
        .onAppear { model.start() }
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
