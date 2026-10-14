import SwiftUI
import AppleCore
struct OfflineLibraryView: View {
    @ObservedObject var coordinator: DownloadCoordinator
    let model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var importing = false
    @State private var error = ""
    var body: some View {
        NavigationStack {
            Group {
                if coordinator.visible.isEmpty { ContentUnavailableView("尚无离线媒体",systemImage:"film.stack",description:Text("从 Emby 详情页下载，或导入已有媒体文件。")) }
                else {
                    List(coordinator.visible) { record in
                        VStack(alignment:.leading,spacing:10) {
                            Text(record.title).font(.headline)
                            Text("\(record.status) · \(ByteCountFormatter.string(fromByteCount:record.received,countStyle:.file))" + (record.total>0 ? " / " + ByteCountFormatter.string(fromByteCount:record.total,countStyle:.file) : "")).font(.caption).foregroundStyle(.secondary)
                            if record.total>0,record.status != "completed" { ProgressView(value:Double(record.received),total:Double(record.total)) }
                            if !record.error.isEmpty { Text(record.error).font(.caption).foregroundStyle(.orange) }
                            HStack {
                                if record.status=="completed" { Button("播放") { perform { try model.playOffline(record,coordinator:coordinator);dismiss() } }.buttonStyle(.borderedProminent) }
                                else if record.status=="downloading" { Button("暂停") { perform { try coordinator.pause(record.id) } }.buttonStyle(.bordered) }
                                else { Button("继续") { perform { try coordinator.resume(record.id) } }.buttonStyle(.bordered) }
                                Spacer()
                                Button("删除",role:.destructive) { perform { try coordinator.remove(record.id) } }.buttonStyle(.bordered)
                            }
                        }.padding(.vertical,8)
                    }
                }
            }.navigationTitle("离线媒体").toolbar { ToolbarItem(placement:.topBarLeading) { Button("导入媒体") { importing=true } };ToolbarItem(placement:.topBarTrailing) { Button("完成") { dismiss() } } }
        }.fileImporter(isPresented:$importing,allowedContentTypes:[.movie,.audio,.data]) { result in perform { try coordinator.importFile(result.get()) } }
            .alert("操作未完成",isPresented:Binding(get:{!error.isEmpty},set:{if !$0 {error=""}})) { Button("好") { error="" } } message: { Text(error) }
    }
    private func perform(_ action:() throws -> Void) { do {try action()} catch {self.error="请检查文件和可用空间后重试"} }
}
