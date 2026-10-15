import SwiftUI

struct TVEpisodeControls: View {
    @ObservedObject var model: TVAppModel
    @Environment(\.dismiss) private var dismiss
    @State private var operation: Task<Void, Never>?

    var body: some View {
        ZStack {
            Color(red: 0.035, green: 0.043, blue: 0.055).ignoresSafeArea()
            VStack(alignment: .leading, spacing: 24) {
                HStack {
                    Text("选集").font(.largeTitle.bold())
                    Spacer()
                    Button("完成") { dismiss() }.accessibilityIdentifier("tv.episodes.done")
                }
                if !model.episodeSeasons.isEmpty {
                    ScrollView(.horizontal) {
                        HStack(spacing: 24) {
                            ForEach(Array(model.episodeSeasons.enumerated()), id: \.offset) { _, season in
                                Button(TVMedia.title(season)) { run { await model.selectEpisodeSeason(season) } }
                                    .disabled(model.episodeLoading || model.busy)
                                    .accessibilityIdentifier("tv.episodes.season." + TVMedia.id(season))
                                    .accessibilityValue(model.episodeSeasonID == TVMedia.id(season) ? "已选择" : "未选择")
                            }
                            if model.episodeSeasonsHaveMore {
                                Button("更多季") { run { await model.loadMoreEpisodeSeasons() } }
                                    .disabled(model.busy || model.episodeLoading)
                                    .accessibilityIdentifier("tv.episodes.moreSeasons")
                            }
                        }.padding(12)
                    }
                }
                if let error = model.episodeError {
                    HStack(spacing: 24) {
                        Text(error).foregroundStyle(.yellow).accessibilityIdentifier("tv.episodes.error")
                        Button("重试") { run { await model.reloadEpisodeContext() } }
                            .disabled(model.busy || model.episodeLoading).accessibilityIdentifier("tv.episodes.retry")
                    }
                }
                if model.episodeLoading || model.busy { ProgressView(model.busy ? "正在准备播放…" : "正在获取剧集…") }
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 24) {
                        ForEach(Array(model.episodeQueue.enumerated()), id: \.offset) { _, item in
                            let current = model.currentEpisodeID == TVMedia.id(item)
                            Button {
                                run {
                                    await model.playEpisode(item)
                                    if model.currentEpisodeID == TVMedia.id(item), model.player.active { dismiss() }
                                }
                            } label: {
                                HStack(spacing: 20) {
                                    Image(systemName: current ? "play.circle.fill" : "play.circle")
                                    Text([TVMedia.episodeLabel(item), TVMedia.title(item)].compactMap { $0 }.joined(separator: " · "))
                                        .lineLimit(2)
                                    Spacer()
                                    if current { Text("正在播放").font(.caption).foregroundStyle(.secondary) }
                                }.frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .disabled(current || model.busy || model.episodeLoading)
                            .accessibilityIdentifier("tv.episodes.item." + TVMedia.id(item))
                            .accessibilityValue(current ? "已选择" : "未选择")
                        }
                        if model.episodeQueue.isEmpty && !model.episodeLoading { Text("暂无可播放剧集。").foregroundStyle(.secondary) }
                        if model.episodeHasMore {
                            Button("加载更多剧集") { run { await model.loadMoreEpisodes() } }
                                .disabled(model.busy || model.episodeLoading).accessibilityIdentifier("tv.episodes.more")
                        }
                    }.padding(12)
                }
            }.padding(60)
        }
        .onExitCommand { dismiss() }
        .onDisappear { operation?.cancel(); operation = nil }
    }

    private func run(_ action: @escaping @MainActor () async -> Void) {
        guard operation == nil else { return }
        operation = Task { @MainActor in
            await action()
            operation = nil
        }
    }
}
