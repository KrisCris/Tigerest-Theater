import SwiftUI

struct TVSubtitleControls: View {
    @ObservedObject var subtitles: TVSubtitleController
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            Color(red: 0.035, green: 0.043, blue: 0.055).ignoresSafeArea()
            VStack(alignment: .leading, spacing: 28) {
                HStack {
                    Text("字幕").font(.largeTitle.bold())
                    Spacer()
                    Button("完成") { dismiss() }.accessibilityIdentifier("tv.subtitles.done")
                }
                Text(subtitles.status).foregroundStyle(.secondary)
                    .accessibilityIdentifier("tv.subtitles.status")
                if let error = subtitles.error { Text(error).foregroundStyle(.yellow).accessibilityIdentifier("tv.subtitles.error") }
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 24) {
                        Button { subtitles.select(nil) } label: {
                            Label("关闭字幕", systemImage: subtitles.selectedID == nil ? "checkmark.circle.fill" : "circle")
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .disabled(!subtitles.isReady)
                        .accessibilityIdentifier("tv.subtitles.off")
                        .accessibilityValue(subtitles.selectedID == nil ? "已选择" : "未选择")
                        ForEach(subtitles.options) { option in
                            Button { subtitles.select(option) } label: {
                                HStack(spacing: 20) {
                                    Image(systemName: subtitles.selectedID == option.id ? "checkmark.circle.fill" : "circle")
                                    VStack(alignment: .leading, spacing: 8) {
                                        Text(option.title).lineLimit(2)
                                        Text(details(option)).font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                }.frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .disabled(!subtitles.isReady || !option.canSelect)
                            .accessibilityIdentifier(option.accessibilityID)
                            .accessibilityValue(subtitles.selectedID == option.id ? "已选择" : "未选择")
                        }
                        if subtitles.isReady && subtitles.options.isEmpty { Text("此视频未发现可用字幕。").foregroundStyle(.secondary) }
                        VStack(alignment: .leading, spacing: 20) {
                            Text("字幕时间：\(subtitles.delay, specifier: "%+.1f") 秒").monospacedDigit()
                                .accessibilityIdentifier("tv.subtitles.delay")
                            HStack(spacing: 24) {
                                Button("提前 0.5 秒") { subtitles.adjustDelay(by: -0.5) }.disabled(subtitles.delay <= -60)
                                Button("延后 0.5 秒") { subtitles.adjustDelay(by: 0.5) }.disabled(subtitles.delay >= 60)
                                Button("重置时间") { subtitles.adjustDelay(by: -subtitles.delay) }.disabled(subtitles.delay == 0)
                            }.disabled(!subtitles.isReady)
                        }.padding(.top, 20)
                    }.padding(12)
                }
            }.padding(60)
        }
        .onExitCommand { dismiss() }
    }

    private func details(_ option: TVSubtitleOption) -> String {
        var parts = [option.isExternal ? "外挂字幕" : "内嵌字幕"]
        if let language = option.language, !language.isEmpty {
            parts.append(Locale(identifier: "zh_CN").localizedString(forLanguageCode: language) ?? language)
        }
        if option.isDefault { parts.append("默认") }
        if option.isForced { parts.append("强制") }
        if !option.canSelect { parts.append("当前不可用") }
        return parts.joined(separator: " · ")
    }
}
