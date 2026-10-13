import UIKit
import SwiftUI
import AVFoundation
import MediaPlayer
import AppleCore

/// Drive the public UIKit slider supplied by MPVolumeView; never use private selectors.
@MainActor final class SystemMediaVolume {
    let view = MPVolumeView(frame: CGRect(x: 0, y: 0, width: 120, height: 20))
    init() {
        view.alpha = 0.01
        view.isUserInteractionEnabled = false
        view.accessibilityElementsHidden = true
    }
    var value: Double { Double(AVAudioSession.sharedInstance().outputVolume) }
    @discardableResult func set(_ value: Double) -> Bool {
        guard value.isFinite, let slider = view.subviews.compactMap({ $0 as? UISlider }).first else { return false }
        slider.setValue(Float(min(1, max(0, value))), animated: false)
        slider.sendActions(for: [.valueChanged, .touchUpInside])
        return true
    }
}

@MainActor final class PlayerGestureCoordinator: NSObject, ObservableObject, UIGestureRecognizerDelegate {
    let player: PlaybackController
    var tapped: () -> Void
    var feedback: (String, Bool) -> Void
    private var view: UIView? { player.surface }
    private var session: PlaybackGestureSession?
    private var revision: UInt64 = 0
    private var initialPosition = 0.0, initialSize = CGSize.zero
    private var recognizers: [UIGestureRecognizer] = []
    private var holding = false
    private var cancelling = false
    init(player: PlaybackController, tapped: @escaping () -> Void, feedback: @escaping (String, Bool) -> Void) {
        self.player = player; self.tapped = tapped; self.feedback = feedback
    }
    enum Kind: Hashable { case tap, doubleTap, pan, hold }
    private var registered: [Kind: UIGestureRecognizer] = [:]
    func register(_ gesture: UIGestureRecognizer, kind: Kind) {
        registered[kind] = gesture; gesture.delegate = self
        recognizers = Array(registered.values)
        if let tap = registered[.tap] {
            for kind in [Kind.doubleTap, .pan, .hold] { if let other = registered[kind] { tap.require(toFail: other) } }
        }
        if let double = registered[.doubleTap] {
            for kind in [Kind.pan, .hold] { if let other = registered[kind] { double.require(toFail: other) } }
        }
        revision = player.interactionRevision
    }
    func handle(_ gesture: UIGestureRecognizer, kind: Kind) {
        guard !cancelling else { return }
        switch kind {
        case .tap: if gesture.state == .ended { singleTap() }
        case .doubleTap: if gesture.state == .ended { doubleTap() }
        case .pan: panned(gesture as! UIPanGestureRecognizer)
        case .hold: held(gesture as! UILongPressGestureRecognizer)
        }
    }
    func update() {
        if revision != player.interactionRevision || (session != nil && view?.bounds.size != initialSize) {
            cancel(notify: false); revision = player.interactionRevision
            Task { @MainActor [weak self] in self?.feedback("", false) }
        }
    }
    func detach() {
        cancel(notify: false)
        player.systemVolume.view.removeFromSuperview()
        registered.removeAll(); recognizers.removeAll()
    }
    private func cancel(notify: Bool = true) {
        guard !cancelling else { return }
        cancelling = true
        defer { cancelling = false }
        session?.cancel(); session = nil; holding = false; player.endTemporarySpeed()
        for recognizer in recognizers { recognizer.isEnabled = false; recognizer.isEnabled = true }
        if notify { feedback("", false) }
    }
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        guard player.active, !player.locked, let view else { return false }
        let point = touch.location(in: view), inset = view.safeAreaInsets
        return PlaybackGestureSession.accepts(x: point.x - inset.left, y: point.y - inset.top,
            width: view.bounds.width - inset.left - inset.right, height: view.bounds.height - inset.top - inset.bottom)
    }
    private func begin(at point: CGPoint) {
        guard let view else { return }
        initialPosition = player.position; initialSize = view.bounds.size; revision = player.interactionRevision
        session = PlaybackGestureSession(x: point.x, y: point.y, width: initialSize.width, height: initialSize.height,
            position: player.position, duration: player.duration, volume: player.systemVolume.value, brightness: player.brightness)
    }
    @objc private func singleTap() { tapped() }
    @objc private func doubleTap() {
        guard !player.locked else { return }
        let wasPaused = player.paused
        _ = try? player.dispatch(wasPaused ? "play" : "pause", [])
        feedback(wasPaused ? "播放" : "暂停", false)
    }
    @objc private func held(_ gesture: UILongPressGestureRecognizer) {
        switch gesture.state {
        case .began:
            begin(at: gesture.location(in: view))
            if session?.beginHold() == true, player.beginTemporarySpeed() {
                holding = true; feedback(String(format: "临时 %.2g×", max(2, player.rate)), true)
            }
        case .ended, .cancelled, .failed:
            if holding { player.endTemporarySpeed(); session = nil; feedback("", false) }; holding = false
        default: break
        }
    }
    @objc private func panned(_ gesture: UIPanGestureRecognizer) {
        let point = gesture.location(in: view), translation = gesture.translation(in: view)
        if gesture.state == .began { begin(at: CGPoint(x: point.x - translation.x, y: point.y - translation.y)) }
        guard revision == player.interactionRevision, !player.locked, player.active else { cancel(); return }
        if gesture.state == .began || gesture.state == .changed || gesture.state == .ended {
            switch session?.move(x: point.x, y: point.y) ?? .none {
            case .seek(let target):
                let delta = Int(target - initialPosition)
                feedback("\(delta >= 0 ? "快进" : "快退") \(abs(delta)) 秒\n\(time(target)) / \(time(player.duration))", true)
            case .volume(let value):
                if player.systemVolume.set(value) { feedback("音量 \(Int((value * 100).rounded()))%", true) }
                else { feedback("请使用 iPad 音量键调整当前输出", true) }
            case .brightness(let value):
                player.setBrightness(value); feedback("亮度 \(Int((player.brightness * 100).rounded()))%", true)
            case .unseekable: feedback("此视频暂不支持滑动跳转", true)
            case .none: break
            }
        }
        if gesture.state == .ended {
            if let target = session?.finish() { _ = try? player.dispatch("seekTo", [.number(target * 1000)]) }
            session = nil; feedback("", false)
        } else if gesture.state == .cancelled || gesture.state == .failed { session?.cancel(); session = nil; feedback("", false) }
    }
    private func time(_ value: Double) -> String { let seconds = Int(max(0, value)); return String(format: "%d:%02d", seconds / 60, seconds % 60) }
}

/// Register through SwiftUI so its buttons keep priority over video gestures.
struct VideoGesture: UIGestureRecognizerRepresentable {
    let kind: PlayerGestureCoordinator.Kind
    let handler: PlayerGestureCoordinator
    let tapped: () -> Void
    let feedback: (String, Bool) -> Void
    func makeUIGestureRecognizer(context: Context) -> UIGestureRecognizer {
        let gesture: UIGestureRecognizer
        switch kind {
        case .tap: gesture = UITapGestureRecognizer()
        case .doubleTap:
            let tap = UITapGestureRecognizer(); tap.numberOfTapsRequired = 2; gesture = tap
        case .pan:
            let pan = UIPanGestureRecognizer(); pan.maximumNumberOfTouches = 1; gesture = pan
        case .hold:
            let hold = SingleTouchHoldRecognizer(); hold.minimumPressDuration = 0.5; hold.allowableMovement = 12; gesture = hold
        }
        handler.register(gesture, kind: kind)
        return gesture
    }
    func updateUIGestureRecognizer(_ recognizer: UIGestureRecognizer, context: Context) {
        handler.tapped = tapped; handler.feedback = feedback; handler.update()
    }
    func handleUIGestureRecognizerAction(_ recognizer: UIGestureRecognizer, context: Context) { handler.handle(recognizer, kind: kind) }
}

private final class SingleTouchHoldRecognizer: UILongPressGestureRecognizer {
    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        let active = event.allTouches?.filter { [.began, .moved, .stationary].contains($0.phase) }.count ?? 0
        guard active <= 1 else { state = state == .possible ? .failed : .cancelled; return }
        super.touchesBegan(touches, with: event)
    }
}
