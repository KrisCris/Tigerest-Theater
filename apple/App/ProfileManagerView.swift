import SwiftUI
struct ProfileManagerView: View {
    @ObservedObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    var body: some View {
        NavigationStack {
            Form {
                Section("配置档") {
                    ForEach(model.profiles.profiles) { profile in
                        Button { do { try model.selectProfile(profile.id);dismiss() } catch { model.error="无法打开配置档" } } label: { HStack { Text(profile.name);Spacer();if profile.id==model.profiles.currentID {Image(systemName:"checkmark")} } }
                    }
                }
                Section("新建独立配置") {
                    TextField("名称",text:$name)
                    Button("创建") { do { let id=try model.profiles.create(name:name);try model.selectProfile(id);dismiss() } catch {model.error="配置名称无效或无法保存"} }.disabled(name.trimmingCharacters(in:.whitespaces).isEmpty)
                    Text("每个配置档分别保存服务器登录、设置、下载和社区凭据。").font(.caption).foregroundStyle(.secondary)
                }
            }.navigationTitle("配置档").toolbar { Button("完成") { dismiss() } }
        }
    }
}
