import AppleCore
import SwiftUI

struct TVRootView: View {
    @ObservedObject var model: TVAppModel
    @FocusState private var focused: String?
    private let columns = [GridItem(.adaptive(minimum: 300, maximum: 400), spacing: 36, alignment: .top)]

    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(red: 0.07, green: 0.12, blue: 0.22), .black],
                           startPoint: .topLeading, endPoint: .bottomTrailing)
                .ignoresSafeArea()
            VStack(alignment: .leading, spacing: 30) {
                header.focusSection()
                if let error = model.error {
                    errorBanner(error)
                }
                if model.isAuthenticated {
                    if let item = model.selectedItem {
                        detail(item)
                    } else {
                        browsing
                    }
                } else {
                    TVLoginView(model: model)
                }
            }
            .padding(.horizontal, 80)
            .padding(.vertical, 50)
        }
        .preferredColorScheme(.dark)
        .modifier(TVExitHandler(enabled: model.canGoBack || (!model.isAuthenticated && model.serverMode != nil)) {
            if model.canGoBack { model.goBack() } else { model.resetServerSelection() }
        })
        .onChange(of: model.focusTarget) { _, target in focused = target }
    }

    private var header: some View {
        HStack(spacing: 24) {
            if model.canGoBack {
                Button { model.goBack() } label: { Label("返回", systemImage: "chevron.left") }
                    .accessibilityIdentifier("tv.back")
                    .focused($focused, equals: "tv.back")
            }
            VStack(alignment: .leading, spacing: 7) {
                Text("大河影院").font(.system(size: 42, weight: .bold, design: .rounded))
                if !model.pages.isEmpty {
                    Text(model.pages.map(\.title).joined(separator: "  /  "))
                        .font(.callout).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer()
            if model.fixtureMode {
                Label("隔离测试", systemImage: "testtube.2")
                    .font(.callout).foregroundStyle(.orange)
            }
            if model.busy {
                ProgressView().accessibilityLabel("正在加载")
            }
            if model.isAuthenticated {
                if !model.canGoBack {
                    Button { Task { await model.refresh() } } label: { Label("刷新", systemImage: "arrow.clockwise") }
                        .disabled(model.busy)
                        .accessibilityIdentifier("tv.refresh")
                        .focused($focused, equals: "tv.refresh")
                }
                Button { Task { await model.logout() } } label: { Label("退出登录", systemImage: "rectangle.portrait.and.arrow.right") }
                    .accessibilityIdentifier("tv.logout")
                    .focused($focused, equals: "tv.logout")
            }
        }
    }

    private func errorBanner(_ message: String) -> some View {
        HStack(spacing: 24) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
            Text(message).font(.callout).lineLimit(3)
            Spacer(minLength: 16)
            if model.isAuthenticated {
                Button("重试") { Task { await model.retry() } }
                    .disabled(model.busy)
                    .accessibilityIdentifier("tv.retry")
                    .focused($focused, equals: "tv.retry")
            }
        }
        .padding(24)
        .background(.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 18))
        .accessibilityIdentifier("tv.error")
    }

    private var browsing: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 44) {
                if let page = model.currentPage {
                    Text(page.title).font(.largeTitle.bold())
                    if page.items.isEmpty, !model.busy, model.error == nil {
                        emptyState("这里还没有媒体", symbol: "folder")
                    }
                    itemGrid(page.items)
                    if page.hasMore {
                        Button("加载更多") { Task { await model.loadMore() } }
                            .disabled(model.busy)
                            .accessibilityIdentifier("tv.loadMore")
                            .focused($focused, equals: "tv.loadMore")
                    }
                } else {
                    if !model.resume.isEmpty {
                        VStack(alignment: .leading, spacing: 26) {
                            Text("继续观看").font(.title2.bold())
                            itemGrid(model.resume)
                        }
                        .focusSection()
                    }
                    VStack(alignment: .leading, spacing: 26) {
                        Text("媒体库").font(.title2.bold())
                        if model.libraries.isEmpty, !model.busy, model.error == nil {
                            emptyState("没有可访问的媒体库", symbol: "rectangle.stack")
                        }
                        itemGrid(model.libraries)
                    }
                    .focusSection()
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 24)
        }
        .accessibilityIdentifier(model.currentPage == nil ? "tv.home" : "tv.browse")
    }

    private func itemGrid(_ items: [JSONValue]) -> some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: 40) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                Button { Task { await model.open(item) } } label: {
                    TVMediaCard(item: item, imageURL: model.client?.imageURL(for: item, type: "Primary", maxWidth: 640))
                }
                .buttonStyle(.card)
                .accessibilityLabel([TVMedia.title(item), TVMedia.subtitle(item)].filter { !$0.isEmpty }.joined(separator: ", "))
                .accessibilityIdentifier("tv.item.\(TVMedia.id(item))")
                .focused($focused, equals: "tv.item.\(TVMedia.id(item))")
            }
        }
    }

    private func detail(_ item: JSONValue) -> some View {
        HStack(alignment: .top, spacing: 60) {
            TVArtwork(url: model.client?.imageURL(for: item, type: "Primary", maxWidth: 900),
                      symbol: item["Type"].string == "Episode" ? "play.rectangle" : "film")
                .frame(width: 440, height: 640)
                .clipShape(RoundedRectangle(cornerRadius: 24))
            ScrollView {
                VStack(alignment: .leading, spacing: 25) {
                    if let series = item["SeriesName"].string {
                        Text(series).font(.title3).foregroundStyle(.secondary)
                    }
                    Text(TVMedia.title(item)).font(.system(size: 54, weight: .bold)).fixedSize(horizontal: false, vertical: true)
                    Text(TVMedia.subtitle(item)).font(.title3).foregroundStyle(.secondary)
                    if let rating = item["OfficialRating"].string, !rating.isEmpty {
                        Text(rating).font(.callout).foregroundStyle(.secondary)
                    }
                    HStack(spacing: 26) {
                        if TVMedia.resumeSeconds(item) > 0 {
                            Button {
                                Task { await model.play(item, resume: true) }
                            } label: {
                                Label("继续播放 · \(TVMedia.time(TVMedia.resumeSeconds(item)))", systemImage: "play.fill")
                            }
                            .accessibilityIdentifier("tv.resume")
                            .focused($focused, equals: "tv.resume")
                        }
                        Button {
                            Task { await model.play(item, resume: false) }
                        } label: {
                            Label(TVMedia.resumeSeconds(item) > 0 ? "从头播放" : "播放", systemImage: TVMedia.resumeSeconds(item) > 0 ? "arrow.counterclockwise" : "play.fill")
                        }
                        .accessibilityIdentifier("tv.play")
                        .focused($focused, equals: "tv.play")
                    }
                    .disabled(model.busy)
                    .padding(.vertical, 16)
                    if let overview = item["Overview"].string, !overview.isEmpty {
                        Text(overview).font(.body).foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(20)
            }
        }
        .accessibilityIdentifier("tv.detail")
        .frame(maxHeight: .infinity, alignment: .top)
    }

    private func emptyState(_ title: String, symbol: String) -> some View {
        VStack(spacing: 20) {
            Image(systemName: symbol).font(.system(size: 65)).foregroundStyle(.secondary)
            Text(title).font(.title3).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, minHeight: 300)
    }
}

private struct TVLoginView: View {
    @ObservedObject var model: TVAppModel
    @State private var username = ""
    @State private var password = ""
    @FocusState private var focused: String?

    var body: some View {
        HStack(spacing: 100) {
            VStack(alignment: .leading, spacing: 28) {
                Image(systemName: "tv").font(.system(size: 110, weight: .light)).foregroundStyle(.cyan)
                Text("让好电影\n回到大屏幕").font(.system(size: 64, weight: .bold)).lineSpacing(12)
                Text(model.serverMode == nil ? "选择服务器，开始观看你的媒体库。" : "使用 Emby 账户登录。\n可通过 iPhone 或 iPad 输入文字。")
                    .font(.title3).foregroundStyle(.secondary).lineSpacing(10)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .leading, spacing: 28) {
                if let mode = model.serverMode {
                    Text(mode == .dedicated ? "专属服务器" : "自建服务器").font(.title.bold())
                    if mode == .selfHosted {
                        TextField("服务器地址（含 http:// 或 https://）", text: $model.serverURL)
                            .accessibilityIdentifier("tv.login.server")
                            .focused($focused, equals: "server")
                    }
                    TextField("用户名", text: $username)
                        .textContentType(.username)
                        .accessibilityIdentifier("tv.login.username")
                        .focused($focused, equals: "username")
                    SecureField("密码", text: $password)
                        .textContentType(.password)
                        .accessibilityIdentifier("tv.login.password")
                        .focused($focused, equals: "password")
                    HStack(spacing: 24) {
                        Button("登录") {
                            let submittedPassword = password
                            password = ""
                            Task { await model.login(username: username, password: submittedPassword) }
                        }
                        .disabled(model.busy)
                        .accessibilityIdentifier("tv.login.submit")
                        .focused($focused, equals: "submit")
                        Button("更换服务器") {
                            password = ""
                            model.resetServerSelection()
                        }
                        .accessibilityIdentifier("tv.login.changeServer")
                    }
                    .padding(.top, 8)
                } else {
                    Text("连接服务器").font(.title.bold())
                    modeButton("专属服务器", subtitle: "自动选择可用线路", symbol: "sparkles.tv", mode: .dedicated)
                        .accessibilityIdentifier("tv.mode.dedicated")
                        .focused($focused, equals: "dedicated")
                    modeButton("自建服务器", subtitle: "输入你的 Emby 服务器地址", symbol: "server.rack", mode: .selfHosted)
                        .accessibilityIdentifier("tv.mode.selfHosted")
                        .focused($focused, equals: "selfHosted")
                }
            }
            .frame(width: 650)
            .disabled(model.busy)
        }
        .padding(.horizontal, 30)
        .frame(maxHeight: .infinity)
        .onAppear { focused = "dedicated" }
        .onChange(of: model.serverMode) { _, mode in
            password = ""
            focused = mode == nil ? "dedicated" : mode == .selfHosted ? "server" : "username"
        }
    }

    private func modeButton(_ title: String, subtitle: String, symbol: String, mode: TVServerMode) -> some View {
        Button { model.selectServer(mode) } label: {
            HStack(spacing: 24) {
                Image(systemName: symbol).font(.title)
                VStack(alignment: .leading, spacing: 8) {
                    Text(title).font(.title3.bold())
                    Text(subtitle).font(.callout).opacity(0.7)
                }
                Spacer()
                Image(systemName: "chevron.right")
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct TVMediaCard: View {
    let item: JSONValue
    let imageURL: URL?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            TVArtwork(url: imageURL, symbol: TVMedia.isContainer(item) ? "rectangle.stack.fill" : "play.rectangle.fill")
                .aspectRatio(16 / 9, contentMode: .fit)
                .overlay(alignment: .bottomTrailing) {
                    if let episode = TVMedia.episodeLabel(item) {
                        Text(episode).font(.caption.bold()).padding(.horizontal, 10).padding(.vertical, 7)
                            .background(.black.opacity(0.75), in: RoundedRectangle(cornerRadius: 8))
                            .padding(12)
                    }
                }
            VStack(alignment: .leading, spacing: 8) {
                Text(TVMedia.title(item)).font(.headline).lineLimit(1)
                let subtitle = TVMedia.subtitle(item)
                if !subtitle.isEmpty {
                    Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                if TVMedia.resumeSeconds(item) > 0 {
                    Text("已看到 \(TVMedia.time(TVMedia.resumeSeconds(item)))")
                        .font(.caption).foregroundStyle(.cyan)
                }
            }
            .padding(20)
            .frame(maxWidth: .infinity, minHeight: 105, alignment: .topLeading)
            .background(Color(white: 0.11))
        }
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

private struct TVArtwork: View {
    let url: URL?
    let symbol: String
    var body: some View {
        GeometryReader { geometry in
            AsyncImage(url: url) { phase in
                if let image = phase.image {
                    image.resizable().scaledToFill()
                } else {
                    ZStack {
                        LinearGradient(colors: [Color(red: 0.12, green: 0.27, blue: 0.39), Color(red: 0.06, green: 0.12, blue: 0.22)],
                                       startPoint: .topLeading, endPoint: .bottomTrailing)
                        Image(systemName: symbol).font(.system(size: 65, weight: .light)).foregroundStyle(.white.opacity(0.5))
                    }
                }
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
            .clipped()
        }
        .accessibilityHidden(true)
    }
}

private struct TVExitHandler: ViewModifier {
    let enabled: Bool
    let action: () -> Void
    @ViewBuilder func body(content: Content) -> some View {
        if enabled { content.onExitCommand(perform: action) } else { content }
    }
}
