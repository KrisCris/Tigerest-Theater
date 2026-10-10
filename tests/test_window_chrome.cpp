#include <QtTest/QtTest>
#include <QQmlComponent>
#include <QQmlEngine>
#include <QQuickItem>
#include <QQuickWindow>
#include <QScreen>
#include <QScopedPointer>

class TestWindowChrome : public QObject
{
  Q_OBJECT
private slots:
  void fixedBarAndFullscreen();
  void maximizeRestoreAndClose();
  void minimizeAndClose();
  void resizeHandlesAndNativeViewport();
  void maximizedDragRestoresUnderPointer();
};

static void loadFixture(QQmlComponent& component)
{
  component.setData(R"(
    import QtQuick
    import QtQuick.Window
    import "."
    Window {
      id: host
      width: 640; height: 400
      flags: Qt.Window | Qt.FramelessWindowHint | Qt.WindowSystemMenuHint |
             Qt.WindowMinimizeButtonHint | Qt.WindowMaximizeButtonHint | Qt.WindowCloseButtonHint
      title: "Tigerest Theater / 大河影院"
      WindowChrome { id: chrome; objectName: "chrome"; hostWindow: host; videoActive: true; anchors.fill: parent; z: 1000 }
      Rectangle { objectName: "client"; y: chrome.barHeight; width: host.width; height: host.height - y; color: "#232831" }
      Rectangle {
        objectName: "videoViewport"
        x: chrome.resizeInset; y: chrome.barHeight
        width: host.width - chrome.resizeInset * 2
        height: host.height - chrome.barHeight - chrome.resizeInset
        color: "#1a202a"
      }
    }
  )", QUrl::fromLocalFile(QStringLiteral(SOURCE_ROOT "/src/ui/chrome-fixture.qml")));
}

static QQuickItem* findVisualItem(QQuickItem* root, const QString& name)
{
  if (root->objectName() == name)
    return root;
  for (auto* child : root->childItems())
    if (auto* item = findVisualItem(child, name))
      return item;
  return nullptr;
}

void TestWindowChrome::fixedBarAndFullscreen()
{
  QQmlEngine engine;
  engine.addImportPath(QStringLiteral(TEST_QML_IMPORTS));
  QQmlComponent component(&engine);
  loadFixture(component);
  QVERIFY2(component.isReady(), qPrintable(component.errorString()));
  QScopedPointer<QQuickWindow> window(qobject_cast<QQuickWindow*>(component.create()));
  QVERIFY(window);
  auto* chrome = window->findChild<QQuickItem*>("chrome");
  auto* client = window->findChild<QQuickItem*>("client");
  QVERIFY(chrome && client);
  window->showNormal();
  QVERIFY(QTest::qWaitForWindowExposed(window.data()));
  QCOMPARE(chrome->property("barHeight").toInt(), 36);
  QCOMPARE(client->y(), 36.0);
  QCOMPARE(client->height(), window->height() - 36.0);
  window->showFullScreen();
  QTRY_COMPARE(chrome->property("barHeight").toInt(), 0);
  QCOMPARE(client->y(), 0.0);
  QCOMPARE(client->height(), double(window->height()));
  window->showNormal();
  QTRY_COMPARE(chrome->property("barHeight").toInt(), 36);
  QCOMPARE(client->y(), 36.0);
}

void TestWindowChrome::maximizeRestoreAndClose()
{
  QQmlEngine engine;
  engine.addImportPath(QStringLiteral(TEST_QML_IMPORTS));
  QQmlComponent component(&engine);
  loadFixture(component);
  QVERIFY2(component.isReady(), qPrintable(component.errorString()));
  QScopedPointer<QQuickWindow> window(qobject_cast<QQuickWindow*>(component.create()));
  QVERIFY(window);
  auto* maximize = window->findChild<QQuickItem*>("chromeMaximize");
  auto* drag = window->findChild<QQuickItem*>("chromeDragArea");
  QVERIFY(maximize && drag);
  // Qt 6.9's Windows plugin detects fullscreen from native geometry. With no
  // reserved taskbar area, a settled frameless maximize becomes FullScreen.
  // Select a screen with a distinct work area without changing desktop settings.
  QScreen* workAreaScreen = nullptr;
  for (auto* screen : QGuiApplication::screens()) {
    if (screen->availableGeometry() != screen->geometry()) {
      workAreaScreen = screen;
      break;
    }
  }
  if (!workAreaScreen)
    QSKIP("Frameless maximize requires a screen with a work area smaller than its fullscreen geometry (Qt 6.9 Windows state detection).");
  window->setScreen(workAreaScreen);
  window->setPosition(workAreaScreen->availableGeometry().center() - QPoint(320, 200));
  auto click = [&](QQuickItem* item) {
    QTest::mouseClick(window.data(), Qt::LeftButton, Qt::NoModifier,
                     item->mapToScene(QPointF(item->width()/2, item->height()/2)).toPoint());
  };
  window->showNormal();
  QVERIFY(QTest::qWaitForWindowExposed(window.data()));
  window->requestActivate();
  QVERIFY(QTest::qWaitForWindowActive(window.data()));
  QTRY_COMPARE(window->visibility(), QWindow::Windowed);
  click(maximize);
  QTRY_COMPARE(window->visibility(), QWindow::Maximized);
  QTRY_COMPARE(window->geometry(), window->screen()->availableGeometry());
  QCOMPARE(window->findChild<QQuickItem*>("chrome")->property("barHeight").toInt(), 36);
  click(maximize);
  QTRY_COMPARE(window->visibility(), QWindow::Windowed);
  QTest::mouseDClick(window.data(), Qt::LeftButton, Qt::NoModifier,
                     drag->mapToScene(QPointF(120,18)).toPoint());
  QTRY_COMPARE(window->visibility(), QWindow::Maximized);
}

void TestWindowChrome::minimizeAndClose()
{
  QQmlEngine engine;
  engine.addImportPath(QStringLiteral(TEST_QML_IMPORTS));
  QQmlComponent component(&engine);
  loadFixture(component);
  QVERIFY2(component.isReady(), qPrintable(component.errorString()));
  QScopedPointer<QQuickWindow> window(qobject_cast<QQuickWindow*>(component.create()));
  QVERIFY(window);
  auto* minimize = window->findChild<QQuickItem*>("chromeMinimize");
  auto* close = window->findChild<QQuickItem*>("chromeClose");
  QVERIFY(minimize && close);
  auto click = [&](QQuickItem* item) {
    QTest::mouseClick(window.data(), Qt::LeftButton, Qt::NoModifier,
                     item->mapToScene(QPointF(item->width()/2, item->height()/2)).toPoint());
  };
  window->showNormal();
  QVERIFY(QTest::qWaitForWindowExposed(window.data()));
  click(minimize);
  QTRY_COMPARE(window->visibility(), QWindow::Minimized);
  window->showNormal();
  QVERIFY(QTest::qWaitForWindowExposed(window.data()));
  click(close);
  QTRY_VERIFY(!window->isVisible());
}

void TestWindowChrome::resizeHandlesAndNativeViewport()
{
  QQmlEngine engine;
  engine.addImportPath(QStringLiteral(TEST_QML_IMPORTS));
  QQmlComponent component(&engine);
  loadFixture(component);
  QVERIFY2(component.isReady(), qPrintable(component.errorString()));
  QScopedPointer<QQuickWindow> window(qobject_cast<QQuickWindow*>(component.create()));
  QVERIFY(window);
  auto* chrome = window->findChild<QQuickItem*>("chrome");
  auto* viewport = window->findChild<QQuickItem*>("videoViewport");
  QVERIFY(chrome && viewport);
  window->showNormal();
  QVERIFY(QTest::qWaitForWindowExposed(window.data()));
  const QStringList edges = { "Left", "Right", "Top", "Bottom", "TopLeft", "TopRight", "BottomLeft", "BottomRight" };
  for (const auto& edge : edges) {
    auto* handle = findVisualItem(chrome, "chromeResize" + edge);
    QVERIFY2(handle && handle->isVisible() && handle->property("enabled").toBool(), qPrintable(edge));
    const QRectF handleRect(handle->mapToScene(QPointF()), handle->size());
    const QRectF videoRect(viewport->mapToScene(QPointF()), viewport->size());
    QVERIFY2(!handleRect.intersects(videoRect), qPrintable(edge));
  }
  QCOMPARE(viewport->position(), QPointF(5, 36));
  QCOMPARE(viewport->size(), QSizeF(window->width() - 10, window->height() - 41));
  const QImage frame = window->grabWindow();
  QVERIFY(!frame.isNull());
  const qreal scale = frame.width() / qreal(window->width());
  QCOMPARE(frame.pixelColor(0, qRound((window->height() - 10) * scale)), QColor("#11151c"));
  const QString capturePath = qEnvironmentVariable("TIGEREST_CHROME_FIXTURE_SCREENSHOT");
  if (!capturePath.isEmpty())
    QVERIFY(frame.save(capturePath));
  window->showMaximized();
  QTRY_COMPARE(chrome->property("resizeInset").toInt(), 0);
  QCOMPARE(viewport->position(), QPointF(0, 36));
  auto* left = findVisualItem(chrome, "chromeResizeLeft");
  // MouseArea's enabled property controls input separately from Item::isEnabled().
  QTRY_VERIFY(!left->isVisible() && !left->property("enabled").toBool());
  window->showFullScreen();
  QTRY_COMPARE(chrome->property("barHeight").toInt(), 0);
  QCOMPARE(viewport->position(), QPointF());
  QCOMPARE(viewport->size(), QSizeF(window->width(), window->height()));
  chrome->setEnabled(false);
  window->showNormal();
  QTRY_COMPARE(chrome->property("barHeight").toInt(), 0);
  QCOMPARE(chrome->property("resizeInset").toInt(), 0);
  QVERIFY(!chrome->isVisible());
}

void TestWindowChrome::maximizedDragRestoresUnderPointer()
{
  QQmlEngine engine;
  engine.addImportPath(QStringLiteral(TEST_QML_IMPORTS));
  QQmlComponent component(&engine);
  loadFixture(component);
  QVERIFY2(component.isReady(), qPrintable(component.errorString()));
  QScopedPointer<QQuickWindow> window(qobject_cast<QQuickWindow*>(component.create()));
  QVERIFY(window);
  auto* chrome = window->findChild<QQuickItem*>("chrome");
  window->showNormal();
  QVERIFY(QTest::qWaitForWindowExposed(window.data()));
  const QSize normalSize = window->size();
  window->showMaximized();
  QTRY_COMPARE(window->visibility(), QWindow::Maximized);
  const QPointF pointer(800, 80);
  QVERIFY(QMetaObject::invokeMethod(chrome, "restoreForDrag",
    Q_ARG(QVariant, QVariant::fromValue(pointer)), Q_ARG(QVariant, 0.4), Q_ARG(QVariant, 18)));
  QTRY_COMPARE(window->visibility(), QWindow::Windowed);
  QCOMPARE(window->size(), normalSize);
  QCOMPARE(window->position(), QPoint(qRound(pointer.x() - normalSize.width() * 0.4), 62));
  QCOMPARE(chrome->property("barHeight").toInt(), 36);
}

QTEST_MAIN(TestWindowChrome)
#include "test_window_chrome.moc"
