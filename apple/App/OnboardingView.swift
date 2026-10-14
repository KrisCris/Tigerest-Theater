import SwiftUI
struct OnboardingView: View {
    @ObservedObject var model: AppModel
    @State private var address = ""
    @State private var mode = ""
    @State private var connecting = false
    @State private var failure = ""
    @State private var connectionTask: Task<Void, Never>?
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Image(systemName: "play.rectangle.on.rectangle.fill").font(.system(size: 56)).foregroundStyle(.orange)
                    Text("大河影院").font(.largeTitle.bold())
                    if mode.isEmpty {
                        Text("请选择你要连接的服务器").font(.title2)
                        Button("连接大河李斯特专属 EMBY 服务器") { mode = "tigerest"; beginConnection() }
                            .buttonStyle(.borderedProminent).controlSize(.large)
                        Text("已有大河专属服务器权限，可直接使用服务器账号登录。").foregroundStyle(.secondary)
                        Button("连接自建 EMBY 服务器") { mode = "custom" }
                            .buttonStyle(.bordered).controlSize(.large)
                        Text("连接你自己搭建或获授权使用的 Emby 服务器。").foregroundStyle(.secondary)
                    } else {
                        Text(mode == "tigerest" ? "连接大河专属 EMBY" : "连接自建 EMBY 服务器").font(.title2)
                        if mode == "custom" {
                            TextField("服务器地址", text: $address)
                                .textContentType(.URL).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                                .padding(14).background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
                                .accessibilityIdentifier("服务器地址").disabled(connecting)
                            Text("支持 HTTP、HTTPS、端口和反向代理子路径。登录将在服务器页面中完成。").font(.callout).foregroundStyle(.secondary)
                        }
                        if connecting { ProgressView("正在连接…") }
                        if !failure.isEmpty { Text(failure).foregroundStyle(.orange).accessibilityIdentifier("连接错误") }
                        Button(mode == "tigerest" ? "重新连接" : "连接服务器") { beginConnection() }
                            .buttonStyle(.borderedProminent).controlSize(.large)
                            .disabled(connecting || (mode == "custom" && address.trimmingCharacters(in: .whitespaces).isEmpty))
                        Button("返回选择服务器") { cancelConnection(); mode = ""; failure = "" }
                    }
                    Divider()
                    Button("离线媒体", systemImage: "arrow.down.circle") { cancelConnection(); model.showOffline = true }
                    Button("管理配置档", systemImage: "person.crop.rectangle") { cancelConnection(); model.showProfiles = true }
                    Text("iPadOS 26+ · \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown")").font(.caption).foregroundStyle(.secondary)
                }.padding(32).frame(maxWidth: 560).frame(maxWidth: .infinity)
            }
            .toolbar { if model.server != nil { Button("取消") { cancelConnection(); model.showConnection = false } } }
            .onAppear { address = model.server?.baseURL.absoluteString ?? "" }
            .onDisappear { cancelConnection() }
            .sheet(isPresented: $model.showOffline) { OfflineLibraryView(coordinator: model.downloads, model: model) }
            .sheet(isPresented: $model.showProfiles) { ProfileManagerView(model: model) }
        }
    }
    private func beginConnection() {
        cancelConnection(); connecting = true; failure = ""
        connectionTask = Task {
            do {
                if mode == "tigerest" { try await model.connectDedicated() }
                else { try await model.connect(address, mode: "custom") }
            } catch {
                guard !Task.isCancelled else { return }
                failure = "无法连接服务器，请检查地址、端口和当前网络后重试。"
            }
            if !Task.isCancelled { connecting = false }
        }
    }
    private func cancelConnection() { connectionTask?.cancel(); connectionTask = nil; connecting = false }
}
