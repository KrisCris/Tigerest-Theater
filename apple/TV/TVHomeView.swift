import AppleCore
import SwiftUI

private let homeGold = Color(red: 0.94, green: 0.78, blue: 0.47)

/// The native counterpart of homeGallery.js: library preview, featured work, portrait rail.
struct TVHomeView: View {
    @ObservedObject var model: TVAppModel
    @FocusState private var focused: String?
    @State private var choosingOrder = false

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                if let card = model.selectedHomeCard {
                    TVArtwork(url: model.client?.homeArtworkURL(for: card.item, purpose: .hero), symbol: "")
                        .opacity(0.14).blur(radius: 12).ignoresSafeArea()
                }
                HStack(alignment: .top, spacing: 34) {
                    libraries(height: geometry.size.height)
                        .frame(width: min(360, max(270, geometry.size.width * 0.19)))
                    VStack(alignment: .leading, spacing: 24) {
                        hero
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                        rail
                            .frame(height: min(270, max(220, geometry.size.height * 0.29)))
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
        }
        .onAppear { focused = model.focusTarget ?? model.homeLibraryID.map { "tv.library." + $0 } }
        .onChange(of: model.focusTarget) { _, target in focused = target }
        .onChange(of: focused) { _, target in
            guard let target else { return }
            if target.hasPrefix("tv.library.") { model.previewLibrary(String(target.dropFirst("tv.library.".count))) }
            if target.hasPrefix("tv.item.") { model.selectHomeCard(String(target.dropFirst("tv.item.".count))) }
        }
        .confirmationDialog("首页排序", isPresented: $choosingOrder) {
            ForEach(EmbyHomeOrder.allCases, id: \.rawValue) { order in
                Button(order.title) { model.setHomeOrder(order) }
            }
        }
    }

    private func libraries(height: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("YOUR LIBRARY / 我的媒体")
                .font(.system(size: 16, weight: .medium)).tracking(2).foregroundStyle(.white.opacity(0.6))
                .padding(.leading, 4)
            ScrollView(.vertical) {
                VStack(spacing: 14) {
                    ForEach(Array(model.libraries.enumerated()), id: \.offset) { index, library in
                        let id = TVMedia.id(library)
                        Button { Task { await model.open(library) } } label: {
                            libraryCard(library, index: index, selected: model.homeLibraryID == id)
                                .frame(height: min(245, max(138, (height - 80) / 4)))
                        }
                        .buttonStyle(TVGalleryButtonStyle()).focusEffectDisabled()
                        .focused($focused, equals: "tv.library." + id)
                        .accessibilityIdentifier("tv.library." + id)
                        .accessibilityLabel(TVMedia.title(library))
                        .overlay {
                            RoundedRectangle(cornerRadius: 10)
                                .stroke(focused == "tv.library." + id ? homeGold : .clear, lineWidth: 3)
                        }
                    }
                }
                .padding(4)
            }
            .scrollClipDisabled()
        }
        .focusSection()
    }

    private func libraryCard(_ library: JSONValue, index: Int, selected: Bool) -> some View {
        ZStack(alignment: .leading) {
            TVLibraryArtwork(name: EmbyHomeData.libraryArtwork(library))
                .opacity(selected ? 1 : 0.55)
                .overlay(LinearGradient(colors: [.black.opacity(0.65), .black.opacity(0.1)], startPoint: .leading, endPoint: .trailing))
            VStack(alignment: .leading, spacing: 12) {
                Text(TVMedia.title(library)).font(.system(size: 31, weight: .bold)).lineLimit(2)
                Text(library["kind"].string == "favorites" ? "FAVORITES" : String(format: "LIBRARY %02d", index + 1))
                    .font(.system(size: 12, weight: .medium)).tracking(2)
                    .foregroundStyle(selected ? homeGold : .white.opacity(0.6))
            }
            .padding(.horizontal, 25)
            if selected {
                Rectangle().fill(homeGold).frame(width: 4).padding(.vertical, 35)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(selected ? homeGold.opacity(0.5) : .white.opacity(0.05), lineWidth: 1))
    }

    private var hero: some View {
        ZStack {
            if let card = model.selectedHomeCard {
                Button { Task { await model.openHomeWork(card.item) } } label: {
                    GeometryReader { geometry in
                        ZStack(alignment: .bottomLeading) {
                            TVArtwork(url: model.client?.homeArtworkURL(for: card.item, purpose: .hero), symbol: "")
                            LinearGradient(colors: [.clear, Color(red: 0.043, green: 0.051, blue: 0.071).opacity(0.8), Color(red: 0.043, green: 0.051, blue: 0.071)], startPoint: .top, endPoint: .bottom)
                            HStack(alignment: .bottom, spacing: 45) {
                                VStack(alignment: .leading, spacing: 14) {
                                    Text((model.selectedHomeLibrary.map(TVMedia.title) ?? "") + " / " + model.homeOrder.title)
                                        .font(.system(size: 15, weight: .medium)).tracking(2).foregroundStyle(homeGold)
                                    Text(TVMedia.title(card.item))
                                        .font(.system(size: min(62, geometry.size.width * 0.055), weight: .bold)).lineLimit(2)
                                    Text(subtitle(card)).font(.system(size: 17)).foregroundStyle(.white.opacity(0.7)).lineLimit(2)
                                    Label("查看作品", systemImage: "arrow.up.right")
                                        .font(.system(size: 17, weight: .semibold))
                                        .padding(.horizontal, 20).padding(.vertical, 12)
                                        .background(.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 5))
                                        .overlay(RoundedRectangle(cornerRadius: 5).stroke(.white.opacity(0.25)))
                                        .padding(.top, 6)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                if let overview = card.item["Overview"].string, !overview.isEmpty {
                                    Text(TVMedia.plainText(overview))
                                        .font(.system(size: 18)).lineSpacing(8).foregroundStyle(.white.opacity(0.75))
                                        .lineLimit(4).frame(width: geometry.size.width * 0.34, alignment: .leading)
                                        .padding(.bottom, 4)
                                }
                            }
                            .padding(.horizontal, 40).padding(.bottom, 28)
                        }
                        .overlay(alignment: .topTrailing) {
                            Text(counter).font(.system(size: 16, weight: .medium, design: .monospaced))
                                .tracking(2).foregroundStyle(.white.opacity(0.7)).padding(28)
                        }
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                }
                .buttonStyle(TVGalleryButtonStyle()).focusEffectDisabled()
                .focused($focused, equals: "tv.home.hero")
                .accessibilityIdentifier("tv.home.hero")
                .accessibilityLabel("查看作品：" + TVMedia.title(card.item))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(focused == "tv.home.hero" ? homeGold : .clear, lineWidth: 3))
            } else {
                VStack(spacing: 24) {
                    if model.homeLoading { ProgressView(); Text("正在载入作品…") }
                    else if let error = model.homeError {
                        Text(error).lineLimit(3)
                        Button("重试") { if let id = model.homeLibraryID { model.previewLibrary(id, refresh: true) } }
                            .focused($focused, equals: "tv.home.retry").accessibilityIdentifier("tv.home.retry")
                    } else {
                        Text(model.selectedHomeLibrary?["kind"].string == "favorites" ? "还没有收藏作品。" : "这个媒体库还没有可展示的作品。")
                    }
                }
                .font(.title3).foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(.white.opacity(0.025), in: RoundedRectangle(cornerRadius: 10))
            }
        }
        .focusSection()
    }

    private var rail: some View {
        VStack(alignment: .leading, spacing: 15) {
            Rectangle().fill(.white.opacity(0.12)).frame(height: 1)
            HStack(spacing: 16) {
                Text(model.selectedHomeLibrary.map(TVMedia.title) ?? "媒体库")
                    .font(.system(size: 19, weight: .semibold)).lineLimit(1)
                Text("/").foregroundStyle(.secondary)
                Button { choosingOrder = true } label: {
                    HStack(spacing: 8) { Text(model.homeOrder.title); Image(systemName: "chevron.down").font(.caption2) }
                }
                .font(.system(size: 18)).buttonStyle(TVGalleryButtonStyle()).focusEffectDisabled()
                .foregroundStyle(focused == "tv.home.order" ? .white : homeGold)
                .focused($focused, equals: "tv.home.order").accessibilityIdentifier("tv.home.order")
                Spacer()
                Button {
                    if let library = model.selectedHomeLibrary { Task { await model.open(library) } }
                } label: { Text("查看更多 →") }
                .font(.system(size: 18)).buttonStyle(TVGalleryButtonStyle()).focusEffectDisabled().foregroundStyle(focused == "tv.home.more" ? .white : homeGold)
                .focused($focused, equals: "tv.home.more").accessibilityIdentifier("tv.home.more")
                Text(counter).font(.system(size: 15, design: .monospaced)).foregroundStyle(.secondary).padding(.leading, 10)
            }
            ScrollViewReader { proxy in
                ScrollView(.horizontal) {
                    LazyHStack(spacing: 18) {
                        ForEach(model.homeCards) { card in
                            Button { Task { await model.openHomeWork(card.item) } } label: { poster(card) }
                                .buttonStyle(TVGalleryButtonStyle()).focusEffectDisabled()
                                .focused($focused, equals: "tv.item." + card.id)
                                .accessibilityIdentifier("tv.item." + card.id)
                                .accessibilityLabel([TVMedia.title(card.item), card.watchState.description].compactMap { $0 }.joined(separator: "，"))
                                .id(card.id)
                        }
                    }
                    .padding(.vertical, 6).padding(.horizontal, 4)
                }
                .scrollClipDisabled()
                .onChange(of: focused) { _, value in
                    if let value, value.hasPrefix("tv.item.") { withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(String(value.dropFirst("tv.item.".count)), anchor: .center) } }
                }
            }
        }
        .focusSection()
    }

    private func poster(_ card: EmbyHomeCard) -> some View {
        let selected = model.selectedHomeCard?.id == card.id
        return TVArtwork(url: model.client?.homeArtworkURL(for: card.item, purpose: .poster), symbol: "film")
            .frame(width: 132, height: 192)
            .overlay(alignment: .bottomLeading) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(TVMedia.title(card.item)).font(.system(size: 14, weight: .semibold)).lineLimit(2)
                    if let progress = card.watchState.description { Text(progress).font(.system(size: 11)).foregroundStyle(homeGold) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10).padding(.top, 28)
                .background(LinearGradient(colors: [.clear, .black.opacity(0.9)], startPoint: .top, endPoint: .bottom))
            }
            .overlay(alignment: .topTrailing) {
                if card.watchState.unwatched == true { Circle().fill(Color(red: 0.88, green: 0.23, blue: 0.29)).frame(width: 9, height: 9).padding(9) }
            }
            .overlay(alignment: .bottom) {
                if let resume = card.resumeItem {
                    GeometryReader { geometry in
                        Rectangle().fill(homeGold).frame(width: geometry.size.width * min(100, max(0, resume["UserData"]["PlayedPercentage"].number ?? 0)) / 100)
                    }
                    .frame(height: 3).background(.white.opacity(0.25)).padding(.horizontal, 5).padding(.bottom, 4)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 5))
            .overlay(RoundedRectangle(cornerRadius: 5).stroke(selected ? homeGold : .white.opacity(0.12), lineWidth: focused == "tv.item." + card.id ? 3 : 1))
            .scaleEffect(focused == "tv.item." + card.id ? 1.035 : 1)
    }

    private var counter: String {
        let index = model.homeCards.firstIndex { $0.id == model.selectedHomeCard?.id }.map { $0 + 1 } ?? 0
        return String(format: "%02d / %02d", index, model.homeCards.count)
    }

    private func subtitle(_ card: EmbyHomeCard) -> String {
        var values = [card.watchState.description, card.item["ProductionYear"].number.map { String(Int($0)) }].compactMap { $0 }
        if let episode = card.latestEpisode {
            values.append((card.newEpisode == episode ? "新一集未看" : "最新入库") + " · " + (TVMedia.episodeLabel(episode) ?? "") + " " + TVMedia.title(episode))
        }
        if !card.addedAt.isEmpty { values.append("入库 " + card.addedAt.prefix(10)) }
        return values.joined(separator: " · ")
    }
}

private struct TVLibraryArtwork: View {
    let name: String
    var body: some View {
        GeometryReader { geometry in
            if let url = Bundle.main.url(forResource: name, withExtension: "png", subdirectory: "home-art") ?? Bundle.main.url(forResource: name, withExtension: "png"),
               let image = UIImage(contentsOfFile: url.path) {
                Image(uiImage: image).resizable().scaledToFill().frame(width: geometry.size.width, height: geometry.size.height).clipped()
            } else { Color(red: 0.08, green: 0.09, blue: 0.12) }
        }
    }
}

/// Artwork stays dark when focused; the gallery draws its own gold focus ring.
struct TVGalleryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(.white)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .contentShape(Rectangle())
    }
}
