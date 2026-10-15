import AppleCore
import SwiftUI

struct TVDetailView: View {
    @ObservedObject var model: TVAppModel
    let item: JSONValue
    var children: [JSONValue]? = nil
    var hasMore = false
    @FocusState private var focused: String?
    @State private var commentsFocusRequest = 0
    @State private var showAllPeople = false
    private let gold = Color(red: 0.94, green: 0.78, blue: 0.47)
    private var details: EmbyMediaDetails { EmbyMediaDetails(item: item) }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 34) {
                    summary {
                        proxy.scrollTo("tv.comments.section", anchor: .top)
                        commentsFocusRequest &+= 1
                    }.id("tv.detail.top")
                    if item["Type"].string == "Episode" {
                        episodePicker
                    } else if let children {
                        childPicker(children)
                    }
                    if let overview = item["Overview"].string.map(TVMedia.plainText), !overview.isEmpty {
                        informationSection("剧情简介", identifier: "tv.detail.overview") {
                            TVDetailReadingText(text: overview)
                        }
                    }
                    if !facts.isEmpty {
                        informationSection("作品信息", identifier: "tv.detail.facts") {
                            LazyVGrid(columns: [GridItem(.adaptive(minimum: 420), spacing: 28, alignment: .top)], alignment: .leading, spacing: 22) {
                                ForEach(facts, id: \.id) { fact in
                                    VStack(alignment: .leading, spacing: 8) {
                                        Text(fact.label).font(.system(size: 18)).foregroundStyle(gold)
                                        Text(fact.value).font(.system(size: 23)).fixedSize(horizontal: false, vertical: true)
                                    }
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .focusable().accessibilityElement(children: .combine)
                                    .accessibilityIdentifier("tv.detail." + fact.id)
                                }
                            }
                        }
                    }
                    if !people.isEmpty { credits }
                    if !details.media.isEmpty {
                        informationSection("媒体信息", identifier: "tv.detail.media") {
                            ForEach(Array(details.media.enumerated()), id: \.offset) { _, value in
                                TVDetailReadingText(text: value)
                            }
                        }
                    }
                    if let client = model.client, let session = model.session,
                       ["Movie", "Series", "Season", "Episode"].contains(item["Type"].string ?? "") {
                        TVCommentsView(item: item, client: client, session: session, focusRequest: commentsFocusRequest)
                            .id(session.serverURL + "|" + session.userID + "|" + TVMedia.id(item))
                            .id("tv.comments.section")
                    }
                }
                .padding(.horizontal, 12).padding(.bottom, 30)
            }
            .accessibilityIdentifier(children == nil ? "tv.detail" : "tv.browse")
            .onAppear { focused = model.focusTarget }
            .onChange(of: model.focusTarget) { _, target in focused = target }
            .onChange(of: TVMedia.id(item)) { _, _ in
                showAllPeople = false
                proxy.scrollTo("tv.detail.top", anchor: .top)
                focused = model.focusTarget
            }
        }
    }

    private func summary(onComments: @escaping () -> Void) -> some View {
        HStack(alignment: .top, spacing: 48) {
            TVArtwork(url: model.client?.homeArtworkURL(for: item, purpose: .poster), symbol: "film")
                .frame(width: 265, height: 390).clipShape(RoundedRectangle(cornerRadius: 12))
                .shadow(color: .black.opacity(0.5), radius: 30, y: 12)
            VStack(alignment: .leading, spacing: 20) {
                if let series = item["SeriesName"].string { Text(series).font(.title3).foregroundStyle(gold) }
                Text(TVMedia.title(item)).font(.system(size: 52, weight: .bold)).lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("tv.detail.title")
                HStack(spacing: 20) {
                    if let episode = TVMedia.episodeLabel(item) {
                        Text(episode).foregroundStyle(gold).accessibilityIdentifier("tv.detail.episodeNumber")
                    } else {
                        Text(TVMedia.subtitle(item)).foregroundStyle(.white.opacity(0.7))
                    }
                    if let rating = item["CommunityRating"].number, rating.isFinite {
                        Label(String(format: "%.1f", rating), systemImage: "star.fill").foregroundStyle(gold)
                    }
                    if let certificate = item["OfficialRating"].string, !certificate.isEmpty {
                        Text(certificate).foregroundStyle(.secondary)
                    }
                }.font(.system(size: 22))
                actions(onComments: onComments).padding(.vertical, 10)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(32).frame(maxWidth: .infinity, alignment: .topLeading)
        .background {
            ZStack {
                TVArtwork(url: model.client?.homeArtworkURL(for: item, purpose: .hero), symbol: "")
                    .opacity(0.25)
                LinearGradient(colors: [Color(red: 0.043, green: 0.051, blue: 0.071).opacity(0.35), Color(red: 0.043, green: 0.051, blue: 0.071)], startPoint: .topTrailing, endPoint: .bottomLeading)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 16)).focusSection()
    }

    private func actions(onComments: @escaping () -> Void) -> some View {
        HStack(spacing: 24) {
            if !TVMedia.isContainer(item) {
                if TVMedia.resumeSeconds(item) > 0 {
                    Button { Task { await model.play(item, resume: true) } } label: {
                        Label("继续播放 · " + TVMedia.time(TVMedia.resumeSeconds(item)), systemImage: "play.fill")
                    }
                    .disabled(model.busy).accessibilityIdentifier("tv.resume")
                    .focused($focused, equals: "tv.resume")
                }
                Button { Task { await model.play(item, resume: false) } } label: {
                    Label(TVMedia.resumeSeconds(item) > 0 ? "从头播放" : "播放", systemImage: TVMedia.resumeSeconds(item) > 0 ? "arrow.counterclockwise" : "play.fill")
                }
                .disabled(model.busy).accessibilityIdentifier("tv.play")
                .focused($focused, equals: "tv.play")
            }
            if model.client != nil, model.session != nil, ["Movie", "Series", "Season", "Episode"].contains(item["Type"].string ?? "") {
                Button(action: onComments) { Label("评论", systemImage: "bubble.left.and.bubble.right") }
                    .accessibilityIdentifier("tv.comments").focused($focused, equals: "tv.comments")
            }
        }
        .font(.system(size: 22, weight: .semibold)).tint(gold)
    }

    private var episodePicker: some View {
        VStack(alignment: .leading, spacing: 24) {
            HStack {
                Text("选集").font(.system(size: 30, weight: .bold))
                    .accessibilityIdentifier("tv.detail.episodes")
                Spacer()
                if model.episodeLoading { ProgressView().accessibilityLabel("正在载入剧集") }
            }
            if !model.episodeSeasons.isEmpty {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 190, maximum: 280), spacing: 24)], alignment: .leading, spacing: 20) {
                    ForEach(model.episodeSeasons, id: \.selfID) { season in
                        let selected = model.episodeSeasonID == TVMedia.id(season)
                        Button { Task { await model.selectEpisodeSeason(season) } } label: {
                            Text((selected ? "✓ " : "") + TVMedia.title(season)).font(.system(size: 22, weight: .semibold))
                                .lineLimit(2).frame(maxWidth: .infinity, minHeight: 55, alignment: .leading).padding(14)
                                .background(selected ? gold.opacity(0.2) : .white.opacity(0.055), in: RoundedRectangle(cornerRadius: 10))
                        }
                        .buttonStyle(TVGalleryButtonStyle()).focusEffectDisabled()
                        .disabled(model.episodeLoading)
                        .focused($focused, equals: "tv.detail.season." + TVMedia.id(season))
                        .accessibilityIdentifier("tv.detail.season." + TVMedia.id(season))
                        .accessibilityValue(selected ? "当前季" : "")
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(focused == "tv.detail.season." + TVMedia.id(season) ? gold : .clear, lineWidth: 3))
                    }
                }.focusSection().accessibilityIdentifier("tv.detail.seasons")
            }
            if model.episodeSeasonsHaveMore {
                Button("更多季") { Task { await model.loadMoreEpisodeSeasons() } }
                    .disabled(model.episodeLoading).accessibilityIdentifier("tv.detail.moreSeasons")
            }
            if let error = model.episodeError {
                HStack {
                    Text(error).font(.callout).foregroundStyle(.secondary)
                    Button("重试选集") { Task { await model.reloadEpisodeContext() } }
                        .disabled(model.episodeLoading).accessibilityIdentifier("tv.detail.retryEpisodes")
                }
            }
            episodes(model.episodeQueue, replacingDetail: true)
            if model.episodeQueue.isEmpty, !model.episodeLoading, !model.busy, model.episodeError == nil {
                Text("这个季暂时没有可观看的剧集。").font(.title3).foregroundStyle(.secondary)
            }
            if model.episodeHasMore {
                Button("更多剧集") { Task { await model.loadMoreEpisodes() } }
                    .disabled(model.episodeLoading).accessibilityIdentifier("tv.detail.moreEpisodes")
            }
        }
        .padding(24).background(.white.opacity(0.025), in: RoundedRectangle(cornerRadius: 16))
    }

    private func childPicker(_ children: [JSONValue]) -> some View {
        VStack(alignment: .leading, spacing: 24) {
            Text(item["Type"].string == "Series" ? "分季" : "剧集").font(.system(size: 30, weight: .bold)).padding(.leading, 8)
            if children.isEmpty, !model.busy, model.error == nil {
                Text("这里还没有可观看的剧集").font(.title3).foregroundStyle(.secondary).padding(20)
            }
            if item["Type"].string == "Series" { seasons(children) }
            else { episodes(children) }
            if hasMore {
                Button("加载更多") { Task { await model.loadMore() } }
                    .disabled(model.busy).accessibilityIdentifier("tv.loadMore")
                    .focused($focused, equals: "tv.loadMore")
            }
        }
    }

    private func seasons(_ items: [JSONValue]) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 180, maximum: 240), spacing: 32, alignment: .top)], alignment: .leading, spacing: 30) {
            ForEach(items, id: \.selfID) { child in
                Button { Task { await model.open(child) } } label: {
                    VStack(alignment: .leading, spacing: 14) {
                        TVArtwork(url: model.client?.homeArtworkURL(for: child, purpose: .poster), symbol: "rectangle.stack")
                            .frame(height: 265).clipShape(RoundedRectangle(cornerRadius: 10))
                        Text(TVMedia.title(child)).font(.system(size: 22, weight: .semibold)).lineLimit(2)
                    }
                }
                .buttonStyle(TVGalleryButtonStyle()).focusEffectDisabled()
                .focused($focused, equals: "tv.item." + TVMedia.id(child))
                .accessibilityIdentifier("tv.item." + TVMedia.id(child))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(focused == "tv.item." + TVMedia.id(child) ? gold : .clear, lineWidth: 3).padding(-8))
            }
        }.padding(12).focusSection()
    }

    private func episodes(_ items: [JSONValue], replacingDetail: Bool = false) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 320, maximum: 430), spacing: 32, alignment: .top)], alignment: .leading, spacing: 38) {
            ForEach(items, id: \.selfID) { child in
                let current = item["Type"].string == "Episode" && TVMedia.id(child) == TVMedia.id(item)
                Button {
                    guard !current else { return }
                    Task {
                        if replacingDetail { await model.openEpisode(child) }
                        else { await model.open(child) }
                    }
                } label: {
                    TVMediaCard(item: child, imageURL: model.client?.homeArtworkURL(for: child, purpose: .cover))
                        .overlay(alignment: .topLeading) {
                            if current {
                                Text("当前集").font(.system(size: 18, weight: .bold)).foregroundStyle(.black)
                                    .padding(.horizontal, 12).padding(.vertical, 8).background(gold, in: RoundedRectangle(cornerRadius: 8)).padding(10)
                            }
                        }
                }
                .buttonStyle(TVGalleryButtonStyle()).focusEffectDisabled()
                .disabled(model.busy)
                .focused($focused, equals: "tv.item." + TVMedia.id(child))
                .accessibilityIdentifier("tv.item." + TVMedia.id(child))
                .accessibilityLabel([TVMedia.episodeLabel(child), TVMedia.title(child)].compactMap { $0 }.joined(separator: "，"))
                .accessibilityValue(current ? "当前集" : "")
                .overlay(RoundedRectangle(cornerRadius: 16).stroke(focused == "tv.item." + TVMedia.id(child) ? gold : current ? gold.opacity(0.55) : .clear, lineWidth: 3))
            }
        }.padding(12).focusSection()
    }

    private var facts: [(id: String, label: String, value: String)] {
        var result: [(String, String, String)] = []
        if let year = details.productionYear { result.append(("year", "年份", String(year))) }
        if let seconds = details.runtimeSeconds, seconds > 0 {
            result.append(("runtime", "时长", TVMedia.time(seconds)))
        }
        if !details.genres.isEmpty { result.append(("genres", "类型", details.genres.joined(separator: " / "))) }
        if let date = item["PremiereDate"].string, date.count >= 10 { result.append(("premiere", "首播 / 上映", String(date.prefix(10)))) }
        let studios = (item["Studios"].array ?? []).compactMap { $0["Name"].string }.filter { !$0.isEmpty }
        if !studios.isEmpty { result.append(("studios", "出品", studios.joined(separator: " / "))) }
        let locations = (item["ProductionLocations"].array ?? []).compactMap(\.string).filter { !$0.isEmpty }
        if !locations.isEmpty { result.append(("locations", "地区", locations.joined(separator: " / "))) }
        return result
    }

    private var people: [EmbyMediaPerson] { details.people }

    private var credits: some View {
        informationSection("演职员", identifier: "tv.detail.credits") {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 330), spacing: 28)], alignment: .leading, spacing: 24) {
                ForEach(Array((showAllPeople ? people : Array(people.prefix(12))).enumerated()), id: \.offset) { _, person in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(person.name).font(.system(size: 23, weight: .semibold))
                        let role = person.role ?? ["Director": "导演", "Writer": "编剧", "Actor": "演员", "GuestStar": "客串", "Producer": "制片人"][person.type ?? ""] ?? person.type ?? ""
                        if !role.isEmpty { Text(role).font(.system(size: 19)).foregroundStyle(.secondary) }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading).focusable()
                    .accessibilityElement(children: .combine)
                }
            }
            if people.count > 12 {
                Button(showAllPeople ? "收起演职员" : "查看全部 \(people.count) 位演职员") { showAllPeople.toggle() }
                    .accessibilityIdentifier("tv.detail.morePeople")
            }
        }
    }

    private func informationSection<Content: View>(_ title: String, identifier: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 22) {
            Text(title).font(.system(size: 30, weight: .bold)).accessibilityIdentifier(identifier)
            content()
        }
        .padding(28).frame(maxWidth: .infinity, alignment: .leading)
        .background(.white.opacity(0.025), in: RoundedRectangle(cornerRadius: 16))
    }
}

/// Small reading targets let the remote traverse long descriptions without
/// introducing an inner scroll view or truncating the information.
private struct TVDetailReadingText: View {
    let text: String
    private var segments: [String] {
        var result: [String] = [], segment = "", lineBreaks = 0
        for character in text {
            segment.append(character)
            if character.isNewline { lineBreaks += 1 }
            if segment.count >= 180 || lineBreaks >= 3 {
                result.append(segment); segment = ""; lineBreaks = 0
            }
        }
        if !segment.isEmpty { result.append(segment) }
        return result
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(segments.enumerated()), id: \.offset) { _, segment in
                Text(segment).font(.system(size: 23)).lineSpacing(6)
                    .fixedSize(horizontal: false, vertical: true).frame(maxWidth: .infinity, alignment: .leading)
                    .focusable()
            }
        }
    }
}

private extension JSONValue {
    var selfID: String { self["Id"].string ?? "" }
}
