import SwiftUI
import AppleCore
struct QualitySettings: View {
    @ObservedObject var player: PlaybackController
    @Environment(\.dismiss) private var dismiss
    @State private var importing = false
    @State private var message = ""
    private var shaderRoot: URL { player.model.profiles.directory.appending(path:"Shaders") }
    var body: some View {
        NavigationStack {
            Form {
                Section("渲染预设") {
                    Button("均衡") { apply("scale=bilinear\ncscale=bilinear\ndeband=no") }
                    Button("精细缩放") { apply("scale=ewa_lanczossharp\ncscale=ewa_lanczossharp\ndeband=yes") }
                    Button("流畅优先") { apply("scale=bilinear\ncscale=bilinear\ndeband=no\ninterpolation=no") }
                    Button("导入 GLSL / HOOK 着色器或 mpv.conf") { importing=true }
                    Button("清除自定义画质") { do { try? FileManager.default.removeItem(at:player.model.profiles.directory.appending(path:"quality.json"));try player.engine?.set("glsl-shaders","");try player.applySettings();message="已恢复默认画质" } catch {message="无法恢复设置"} }
                }
                Section("播放诊断") {
                    let diagnostic=player.diagnostics()
                    LabeledContent("渲染",value:diagnostic["renderBackend"].string ?? "")
                    LabeledContent("硬件解码",value:diagnostic["hwdec"].string ?? "未启用")
                    LabeledContent("尺寸",value:"\(Int(diagnostic["sourceWidth"].number ?? 0)) × \(Int(diagnostic["sourceHeight"].number ?? 0))")
                    Text("RIFE 插帧尚未接通 iPad 帧处理链路，当前不提供启用开关。").font(.caption).foregroundStyle(.secondary)
                }
                if !message.isEmpty {Text(message)}
            }.navigationTitle("画质设置").toolbar {Button("完成"){dismiss()}}
        }.fileImporter(isPresented:$importing,allowedContentTypes:[.data]) { result in
            do {
                let source=try result.get(),granted=source.startAccessingSecurityScopedResource();defer{if granted{source.stopAccessingSecurityScopedResource()}}
                guard (try source.resourceValues(forKeys:[.fileSizeKey])).fileSize ?? 0 <= 1_048_576 else {throw CoreError.invalidSetting}
                if ["glsl","hook"].contains(source.pathExtension.lowercased()) {
                    try FileManager.default.createDirectory(at:shaderRoot,withIntermediateDirectories:true)
                    let target=shaderRoot.appending(path:UUID().uuidString+".glsl");try FileManager.default.copyItem(at:source,to:target)
                    apply("glsl-shaders="+target.path)
                } else {apply(try String(contentsOf:source,encoding:.utf8))}
            } catch {message="导入失败：配置中只允许画质与字幕选项，着色器需先复制到应用内。"}
        }
    }
    private func apply(_ text:String) {
        do {
            let values=try MPVConfigurationPolicy.parse(text,shaderRoot:shaderRoot)
            for (key,value) in values {try player.engine?.set(key,value)}
            try JSONEncoder().encode(values).write(to:player.model.profiles.directory.appending(path:"quality.json"),options:.atomic)
            message="已应用，之后播放也会使用此设置"
        } catch {message="当前播放器不支持部分配置，未保存此预设。"}
    }
}
