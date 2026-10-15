import SwiftUI
import AppleCore

struct TVQualityPreset: Decodable {
    let id: String
    let base: String
    let options: [String: String]
    let shaders: [String]
    static func bundled(_ selection: String) throws -> Self {
        guard let root = Bundle.main.resourceURL else { throw CoreError.invalidSetting }
        let presets = try JSONDecoder().decode([Self].self, from: Data(contentsOf: root.appending(path: "Web/quality_presets.json")))
        guard ["tigerest-default", "tv-balanced"].contains(selection),
              let value = presets.first(where: { $0.id == selection }), value.base == "high-quality",
              value.shaders.count == (selection == "tv-balanced" ? 1 : 3) else { throw CoreError.invalidSetting }
        return value
    }
    func paths() throws -> [String] {
        let root = Bundle.main.resourceURL!.appending(path: "Web").standardizedFileURL
        return try shaders.map { relative in
            let file = root.appending(path: relative).standardizedFileURL
            guard relative.hasPrefix("shaders/"), file.path.hasPrefix(root.path + "/shaders/"), !file.path.contains(":"), FileManager.default.fileExists(atPath: file.path) else { throw CoreError.invalidSetting }
            return file.path
        }
    }
}
struct TVQualitySettings: View {
    @ObservedObject var player: TVPlaybackController
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        VStack(alignment: .leading, spacing: 32) {
            HStack { Text("画质设置").font(.largeTitle.bold()); Spacer(); Button("完成") { dismiss() } }
            Button { player.selectQuality("native") } label: {
                Label("原生画质", systemImage: player.qualityPreset == "native" ? "checkmark.circle.fill" : "circle")
            }.accessibilityIdentifier("tv.quality.native")
            Text("保持电视输出分辨率，优先保证播放流畅。").foregroundStyle(.secondary)
            Button { player.selectQuality("tv-balanced") } label: {
                Label("轻量增强", systemImage: player.qualityPreset == "tv-balanced" ? "checkmark.circle.fill" : "circle")
            }.accessibilityIdentifier("tv.quality.balanced")
            Text("简化画面放大处理，保留线条细节；高帧率或持续掉帧时自动降低本集滤镜负载。").foregroundStyle(.secondary)
            Button { player.selectQuality("tigerest-default") } label: {
                Label("完整桌面滤镜", systemImage: player.qualityPreset == "tigerest-default" ? "checkmark.circle.fill" : "circle")
            }.accessibilityIdentifier("tv.quality.default")
            Text("保留桌面版的完整画质增强。Apple TV 4K（二代）在 4K 输出时负载较高，可能出现掉帧；播放不够流畅时，请切回原生画质。").foregroundStyle(.secondary)
            if !player.qualityMessage.isEmpty { Text(player.qualityMessage).foregroundStyle(.secondary) }
            Spacer()
        }
        .padding(70).background(Color(red: 0.035, green: 0.043, blue: 0.055).ignoresSafeArea())
        .tint(Color(red: 0.82, green: 0.68, blue: 0.38)).onExitCommand { dismiss() }
    }
}
