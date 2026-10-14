#include <QDebug>
#include <QElapsedTimer>
#include <QGuiApplication>
#include <QQmlApplicationEngine>
#include <QQmlContext>
#include <QQuickWindow>
#include <QScreen>
#include <QSocketNotifier>
#include <QTimer>
#include <QtWebEngineQuick>
#include <atomic>
#include <unistd.h>

unsigned probeNativeWindowState(void *nativeView);
void probeMinimizeNativeWindow(void *nativeView);

int main(int argc, char **argv)
{
    QCoreApplication::setAttribute(Qt::AA_ShareOpenGLContexts);
    QQuickWindow::setGraphicsApi(qEnvironmentVariable("PROBE_GRAPHICS_API") == "metal"
        ? QSGRendererInterface::Metal : QSGRendererInterface::OpenGL);
    QtWebEngineQuick::initialize();
    QGuiApplication app(argc, argv);
    app.setApplicationName("TigerestFrameProbe");
    qInfo() << "screenHz" << app.primaryScreen()->refreshRate()
            << "dpr" << app.primaryScreen()->devicePixelRatio();
    // These outlive the engine/window and its direct render-thread callback.
    std::atomic<int> frames{0};
    QElapsedTimer clock;
    QTimer stats;
    QString phase = QStringLiteral("active");
    QQmlApplicationEngine engine;
    engine.rootContext()->setContextProperty("probeUrl", QUrl(qEnvironmentVariable("PROBE_URL")));
    engine.rootContext()->setContextProperty("probeNativeAnimation", qEnvironmentVariableIsSet("PROBE_NATIVE_ANIMATION"));
    engine.loadData(R"QML(
        import QtQuick
        import QtWebEngine
        Window {
            visible: true; width: 1280; height: 720
            flags: Qt.Window | Qt.WindowTitleHint | Qt.WindowSystemMenuHint |
                   Qt.WindowMinimizeButtonHint | Qt.WindowMaximizeButtonHint | Qt.WindowCloseButtonHint
            title: "Isolated high-refresh probe"
            function pauseAnimation(paused) {
                web.runJavaScript("document.getAnimations().forEach(a => a." + (paused ? "pause" : "play") + "())")
            }
            WebEngineView {
                id: web
                focus: true; anchors.fill: parent; url: probeUrl
                profile: WebEngineProfile { offTheRecord: true }
            }
            Rectangle {
                visible: probeNativeAnimation; z: 2; x: 1100; y: 550
                width: 60; height: 60; color: "#eb7143"
                NumberAnimation on rotation {
                    running: probeNativeAnimation; from: 0; to: 360
                    duration: 1000; loops: Animation.Infinite
                }
            }
        }
    )QML");
    if (engine.rootObjects().isEmpty()) return 2;
    auto window = qobject_cast<QQuickWindow *>(engine.rootObjects().first());
    QObject::connect(window, &QQuickWindow::frameSwapped, window,
                     [&frames] { ++frames; }, Qt::DirectConnection);
    clock.start();
    QObject::connect(&stats, &QTimer::timeout, &app, [&] {
        qInfo().noquote() << "windowSubmittedFps" << frames.exchange(0) * 1000.0 / clock.restart()
                         << "phase" << phase << "visibility" << window->visibility()
                         << "exposed" << window->isExposed()
                         << "cocoaState" << probeNativeWindowState(reinterpret_cast<void *>(window->winId()));
    });
    stats.start(2000);
    window->raise();
    window->requestActivate();
    QTimer::singleShot(500, window, [window] { window->raise(); window->requestActivate(); });
    // Test-only stdin protocol. Reset each measurement window after changing
    // state so a partial active interval cannot be mistaken for idle rendering.
    QSocketNotifier input(STDIN_FILENO, QSocketNotifier::Read, &app);
    QByteArray pending;
    QObject::connect(&input, &QSocketNotifier::activated, &app, [&] {
        char buffer[256];
        const auto count = ::read(STDIN_FILENO, buffer, sizeof(buffer));
        if (count <= 0) { input.setEnabled(false); return; }
        pending.append(buffer, count);
        while (pending.contains('\n')) {
            const auto end = pending.indexOf('\n');
            const auto command = pending.left(end).trimmed();
            pending.remove(0, end + 1);
            if (command == "idle") {
                QMetaObject::invokeMethod(window, "pauseAnimation", Q_ARG(QVariant, true));
            } else if (command == "minimized") {
                QMetaObject::invokeMethod(window, "pauseAnimation", Q_ARG(QVariant, false));
                probeMinimizeNativeWindow(reinterpret_cast<void *>(window->winId()));
            } else if (command == "restored") {
                window->showNormal(); window->raise(); window->requestActivate();
            } else if (command == "hidden") {
                window->hide();
            } else continue;
            phase = QString::fromUtf8(command);
            frames = 0; clock.restart(); stats.start(2000);
        }
    });
    QTimer::singleShot(45000, &app, &QCoreApplication::quit);
    return app.exec();
}
