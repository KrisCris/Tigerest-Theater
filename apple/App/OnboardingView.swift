import SwiftUI
struct OnboardingView: View {
    @ObservedObject var model: AppModel
    @State private var address = ""
    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 24) {
                Image(systemName: "play.rectangle.on.rectangle.fill").font(.system(size: 56)).foregroundStyle(.orange)
                Text("大河影院").font(.largeTitle.bold())
                Text("连接你的 Emby 媒体库").font(.title2)
                TextField("服务器地址", text: $address).textContentType(.URL).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled().padding(14).background(.quaternary, in: RoundedRectangle(cornerRadius: 12)).accessibilityIdentifier("服务器地址")
                Text("支持 HTTPS、HTTP、端口和反向代理子路径。登录将在服务器页面中完成。").font(.callout).foregroundStyle(.secondary)
                Button("连接服务器") { do { try model.connect(address) } catch { model.error = error.localizedDescription } }.buttonStyle(.borderedProminent).controlSize(.large).disabled(address.trimmingCharacters(in: .whitespaces).isEmpty)
                Text("iPadOS 26+ · 2.6.0 开发版").font(.caption).foregroundStyle(.secondary)
            }.padding(32).frame(maxWidth: 560).frame(maxWidth: .infinity, maxHeight: .infinity)
                .toolbar { if model.server != nil { Button("取消") { model.showConnection = false } } }
                .onAppear { address = model.server?.baseURL.absoluteString ?? "" }
        }
    }
}
