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
                    ForEach(QualityPreset.bundled) { preset in
                        Button(preset.title) { select(QualitySelection(preset: preset.id)) }
                    }
                    Button("导入 GLSL / HOOK 着色器或 mpv.conf") { importing = true }
                    Button("恢复原生画质（清除着色器）") { select(QualitySelection()) }
                    Text("与 Mac 版共用 SSim、KrigBilateral、RAVU 和 Anime4K 原始着色器。放大与缩小效果按片源尺寸自动启用。激进测试档较耗电。").font(.caption).foregroundStyle(.secondary)

                }
                Section("播放诊断") {
                    let diagnostic=player.diagnostics()
                    LabeledContent("渲染",value:diagnostic["renderBackend"].string ?? "")
                    LabeledContent("硬件解码",value:diagnostic["hwdec"].string ?? "未启用")
                    LabeledContent("尺寸",value:"\(Int(diagnostic["sourceWidth"].number ?? 0)) × \(Int(diagnostic["sourceHeight"].number ?? 0))")
                    LabeledContent("丢帧",value:"输出 \(Int(diagnostic["voDrops"].number ?? 0)) · 解码 \(Int(diagnostic["decoderDrops"].number ?? 0))")
                    Text("RIFE 状态：\(diagnostic["nativeRife"]["status"].string ?? "未启用")，已生成 \(diagnostic["nativeRife"]["generated"].string ?? "0") 帧\(diagnostic["nativeRife"]["inferenceP95Ms"].string.map { "，推理 p95 " + $0 + " ms" } ?? "")").font(.caption).foregroundStyle(.secondary)
                }
                if !message.isEmpty {Text(message)}
            }.navigationTitle("画质设置").toolbar {Button("完成"){dismiss()}}
        }.fileImporter(isPresented:$importing,allowedContentTypes:[.data]) { result in
            do {
                let source=try result.get(),granted=source.startAccessingSecurityScopedResource();defer{if granted{source.stopAccessingSecurityScopedResource()}}
                guard (try source.resourceValues(forKeys:[.fileSizeKey])).fileSize ?? 0 <= 8_388_608 else {throw CoreError.invalidSetting}
                if ["glsl","hook"].contains(source.pathExtension.lowercased()) {
                    try FileManager.default.createDirectory(at:shaderRoot,withIntermediateDirectories:true)
                    let target=shaderRoot.appending(path:UUID().uuidString+".glsl");try FileManager.default.copyItem(at:source,to:target)
                    apply("glsl-shaders="+target.path)
                } else {apply(try String(contentsOf:source,encoding:.utf8))}
            } catch {message="导入失败：配置中只允许画质与字幕选项，着色器需先复制到应用内。"}
        }
    }
    private func select(_ selection: QualitySelection) {
        do { try player.selectQuality(selection); message = "已应用，之后播放也会使用此设置" }
        catch { message = "当前设备未能应用此预设，已恢复原画质。" }
    }
    private func apply(_ text:String) {
        do {
            let values=try MPVConfigurationPolicy.parse(text,shaderRoot:shaderRoot)
            var selection = player.qualitySelection; selection.custom = values
            try player.selectQuality(selection)
            message="已应用，之后播放也会使用此设置"
        } catch {message="当前播放器不支持部分配置，未保存此预设。"}
    }
}
