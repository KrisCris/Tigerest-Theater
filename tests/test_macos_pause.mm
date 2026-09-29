#import <AppKit/AppKit.h>

#include <QtTest/QtTest>
#include <QQuickWindow>
#include <QTemporaryDir>
#include <QScopeGuard>
#include <MpvController>
#include "player/MpvVideoItem.h"
#include "settings/SettingsComponent.h"
#include "settings/SettingsSection.h"

class TestMacosPause : public QObject
{
  Q_OBJECT
private slots:
  void nativeWindowPause_data();
  void nativeWindowPause();
};

void TestMacosPause::nativeWindowPause_data()
{
  QTest::addColumn<bool>("uosc");
  QTest::addColumn<bool>("minimalConfig");
  QTest::addColumn<bool>("spaceOverride");
  QTest::newRow("native") << false << false << false;
  QTest::newRow("native-with-uosc") << true << false << false;
  QTest::newRow("system-without-default-bindings") << true << true << false;
  QTest::newRow("system-custom-space") << false << true << true;
}

void TestMacosPause::nativeWindowPause()
{
  QFETCH(bool, uosc);
  QFETCH(bool, minimalConfig);
  QFETCH(bool, spaceOverride);
  QTemporaryDir config;
  QVERIFY(config.isValid());
  QFile conf(config.filePath("mpv.conf"));
  QVERIFY(conf.open(QIODevice::WriteOnly));
  conf.write("vo=null\nao=null\nosc=no\nload-scripts=no\n");
  if (!minimalConfig)
    conf.write("input-default-bindings=yes\n");
  if (uosc)
    conf.write("script=\"" SOURCE_ROOT "/resources/mpv/plugins/uosc.lua\"\n");
  conf.close();
  if (uosc) {
    QVERIFY(QDir(config.path()).mkdir("script-opts"));
    QVERIFY(QFile::copy(QStringLiteral(SOURCE_ROOT "/resources/mpv/script-opts/uosc.conf"),
                       config.filePath("script-opts/uosc.conf")));
  }
  if (!minimalConfig) {
    QVERIFY(QFile::copy(QStringLiteral(SOURCE_ROOT "/resources/mpv/input.conf"),
                       config.filePath("input.conf")));
  }
  QFile customBindings(config.filePath("input.conf"));
  QVERIFY(customBindings.open(QIODevice::Append));
  customBindings.write("\nCtrl+k repeatable add volume 1\nCtrl+K set volume 39\n"
                       "Alt+1 set volume 47\nMeta+k set volume 58\n"
                       "! set volume 63\nF5 set volume 64\nKP1 set volume 65\n");
  if (spaceOverride)
    customBindings.write("SPACE set volume 29\n");
  customBindings.close();
  qputenv("TIGEREST_MPV_CONFIG_DIR", config.path().toUtf8());
  qunsetenv("TIGEREST_MPV_INCLUDE");
  qunsetenv("TIGEREST_MPV_SAFE_SCRIPTS");

  auto* section = new SettingsSection("mpv", PLATFORM_ANY, -1, &SettingsComponent::Get());
  section->registerSetting(new SettingsValue("renderBackend", "gpu-next"));
  SettingsComponent::Get().registerSection(section);
  MpvVideoItem item;
  const auto stopBeforeDestroy = qScopeGuard([&]() {
    item.commandAsync({"stop"});
    QTest::qWait(500);
  });
  QVERIFY(item.usingNativeGpuNext());
  item.setPropertyBlocking("vo", "gpu-next");
  item.setPropertyBlocking("gpu-api", "vulkan");
  item.setPropertyBlocking("gpu-context", "macvk");
  item.setPropertyBlocking("input-vo-keyboard", true);
  item.setPropertyBlocking("input-cursor", true);
  item.setPropertyBlocking("loop-file", "inf");
  item.setPropertyBlocking("fullscreen", false);
  QSignalSpy loaded(item.controller(), &MpvController::fileLoaded);
  item.commandAsync({"loadfile", QStringLiteral(SOURCE_ROOT "/resources/testmedia/high_1920x1080.h264")});
  QTRY_VERIFY_WITH_TIMEOUT(loaded.count() > 0, 15000);

  NSWindow* native = nil;
  // fileLoaded can arrive before Cocoa has made the native window visible.
  const auto findNativeWindow = [&]() {
    for (NSWindow* candidate in NSApp.windows) {
      if (candidate.visible && [NSStringFromClass(candidate.class) hasSuffix:@".Window"]) {
        native = candidate;
        return true;
      }
    }
    return false;
  };
  QTRY_VERIFY_WITH_TIMEOUT(findNativeWindow(), 5000);
  [native makeKeyAndOrderFront:nil];
  [NSApp activateIgnoringOtherApps:YES];
  auto key = [&](NSEventType type, bool repeat = false, NSEventModifierFlags modifiers = 0,
                 NSWindow* target = nil, unsigned short code = 49, NSString* text = @" ") {
    NSWindow* window = target ?: native;
    NSEvent* event = [NSEvent keyEventWithType:type location:NSZeroPoint modifierFlags:modifiers
        timestamp:NSProcessInfo.processInfo.systemUptime windowNumber:window.windowNumber
        context:nil characters:text charactersIgnoringModifiers:text isARepeat:repeat keyCode:code];
    [NSApp postEvent:event atStart:NO];
    QTest::qWait(100);
  };
  auto click = [&](NSEventType type, NSInteger count) {
    NSEvent* event = [NSEvent mouseEventWithType:type location:NSMakePoint(100, 100)
        modifierFlags:0 timestamp:NSProcessInfo.processInfo.systemUptime
        windowNumber:native.windowNumber context:nil eventNumber:0 clickCount:count pressure:1];
    [NSApp postEvent:event atStart:NO];
    QTest::qWait(30);
  };
  auto paused = [&]() { return item.getProperty("pause").toBool(); };
  QVERIFY(!paused());
  key(NSEventTypeKeyDown);
  if (spaceOverride) {
    key(NSEventTypeKeyUp);
    QCOMPARE(item.getProperty("volume").toInt(), 29);
    QVERIFY2(!paused(), "Explicit user SPACE bindings must override the host fallback");
    return;
  }
  QVERIFY2(paused(), "Space in the native macvk window must pause playback");
  key(NSEventTypeKeyDown, true);
  key(NSEventTypeKeyUp);
  QVERIFY2(paused(), "Key repeats and release must not toggle pause a second time");
  key(NSEventTypeKeyDown);
  key(NSEventTypeKeyUp);
  QVERIFY(!paused());

  click(NSEventTypeLeftMouseDown, 1);
  click(NSEventTypeLeftMouseUp, 1);
  click(NSEventTypeLeftMouseDown, 2);
  click(NSEventTypeLeftMouseUp, 2);
  QTest::qWait(350);
  QVERIFY2(paused(), "One native double-click must toggle pause exactly once");
  item.setPropertyBlocking("pause", false);
  if (minimalConfig)
    return; // No SPACE input.conf entry or libmpv default bindings in system mode.

  const auto press = [&](unsigned short code, NSString* text, NSEventModifierFlags modifiers = 0) {
    key(NSEventTypeKeyDown, false, modifiers, nil, code, text);
    key(NSEventTypeKeyUp, false, modifiers, nil, code, text);
  };
  if (uosc) {
    const QString menu = QStringLiteral(R"({"type":"keyboard-test","selected_index":2,
      "search_style":"disabled","items":[
        {"title":"Root action","value":["set","volume","19"]},
        {"title":"Submenu","search_style":"disabled","items":[
          {"title":"First","value":["set","volume","31"]},
          {"title":"Second","value":["set","volume","62"]}]}]})");
    const auto openMenu = [&]() {
      item.commandAsync({"script-message-to", "uosc", "open-menu", menu});
      QTest::qWait(150);
    };
    openMenu();
    QCOMPARE(item.getProperty("user-data/uosc/menu/type").toString(), QString("keyboard-test"));
    item.setPropertyBlocking("volume", 50);
    press(124, @"\uF703"); // Right: enter submenu
    press(125, @"\uF701"); // Down: select second item
    press(36, @"\r"); // Return: execute
    QTRY_COMPARE(item.getProperty("volume").toInt(), 62);

    openMenu();
    press(124, @"\uF703");
    press(123, @"\uF702"); // Left: back to parent
    press(126, @"\uF700");
    press(36, @"\r");
    QTRY_COMPARE(item.getProperty("volume").toInt(), 19);
    openMenu();
    press(124, @"\uF703");
    press(53, @"\x1b");
    QTRY_VERIFY(item.getProperty("user-data/uosc/menu/type").toString().isEmpty());
    QVERIFY2(!item.getProperty("path").toString().isEmpty(), "Escape in a menu must not stop playback");

    // Space and letters must reach menu search instead of playback shortcuts.
    item.commandAsync({"script-message-to", "uosc", "open-menu", QStringLiteral(R"({
      "type":"keyboard-search","search_style":"palette","items":[
      {"title":"Other","value":["set","volume","10"]},
      {"title":"A B","value":["set","volume","73"]}]})")});
    QTest::qWait(150);
    press(0, @"A", NSEventModifierFlagShift);
    press(49, @" ");
    press(11, @"b");
    QVERIFY2(!paused(), "Typing a space in menu search must not pause playback");
    press(36, @"\r");
    QTRY_COMPARE(item.getProperty("volume").toInt(), 73);
  }
  item.setPropertyBlocking("volume", 50);
  press(126, @"\uF700");
  QCOMPARE(item.getProperty("volume").toInt(), 55);
  press(125, @"\uF701");
  QCOMPARE(item.getProperty("volume").toInt(), 50);
  press(8, @"c");
  QVERIFY(qAbs(item.getProperty("speed").toDouble() - 1.1) < 0.001);
  press(6, @"Z", NSEventModifierFlagShift);
  QCOMPARE(item.getProperty("speed").toDouble(), 1.0);
  const bool deband = item.getProperty("deband").toBool();
  press(2, @"d", NSEventModifierFlagOption);
  QCOMPARE(item.getProperty("deband").toBool(), !deband);
  press(18, @"1", NSEventModifierFlagOption);
  QCOMPARE(item.getProperty("volume").toInt(), 47);
  press(40, @"k", NSEventModifierFlagControl);
  QCOMPARE(item.getProperty("volume").toInt(), 48);
  press(40, @"K", NSEventModifierFlagControl | NSEventModifierFlagShift);
  QCOMPARE(item.getProperty("volume").toInt(), 39);
  press(40, @"k", NSEventModifierFlagCommand);
  QCOMPARE(item.getProperty("volume").toInt(), 58);
  press(18, @"!", NSEventModifierFlagShift);
  QCOMPARE(item.getProperty("volume").toInt(), 63);
  press(96, @"\uF708"); // F5
  QCOMPARE(item.getProperty("volume").toInt(), 64);
  press(83, @"1", NSEventModifierFlagNumericPad);
  QCOMPARE(item.getProperty("volume").toInt(), 65);

  // Releasing a modifier before its key must release the ORIGINAL chord.
  item.setPropertyBlocking("input-ar-delay", 100);
  item.setPropertyBlocking("input-ar-rate", 20);
  key(NSEventTypeKeyDown, false, NSEventModifierFlagControl, nil, 40, @"k");
  QTest::qWait(250);
  QVERIFY(item.getProperty("volume").toInt() > 66);
  key(NSEventTypeKeyUp, false, 0, nil, 40, @"k");
  const int releasedVolume = item.getProperty("volume").toInt();
  QTest::qWait(250);
  QCOMPARE(item.getProperty("volume").toInt(), releasedVolume);

  key(NSEventTypeKeyDown, false, NSEventModifierFlagCommand);
  key(NSEventTypeKeyUp, false, NSEventModifierFlagCommand);
  QVERIFY2(!paused(), "Modified Space must retain its original behavior");
  QQuickWindow library;
  key(NSEventTypeKeyDown, false, 0, nil, 126, @"\uF700");
  [native resignKeyWindow];
  QTest::qWait(100);
  const int unfocusedVolume = item.getProperty("volume").toInt();
  QTest::qWait(250);
  QCOMPARE(item.getProperty("volume").toInt(), unfocusedVolume);
  library.show();
  NSWindow* qtWindow = [reinterpret_cast<NSView*>(library.winId()) window];
  key(NSEventTypeKeyDown, false, 0, qtWindow);
  key(NSEventTypeKeyUp, false, 0, qtWindow);
  QVERIFY2(!paused(), "Space in the Qt library must not control the native player");
  key(NSEventTypeKeyDown, false, 0, qtWindow, 125, @"\uF701");
  key(NSEventTypeKeyUp, false, 0, qtWindow, 125, @"\uF701");
  QCOMPARE(item.getProperty("volume").toInt(), unfocusedVolume);
  item.setVisible(false);
  key(NSEventTypeKeyDown);
  key(NSEventTypeKeyUp);
  QVERIFY2(!paused(), "Hidden playback must not consume input");
  item.commandAsync({"stop"});
  QTest::qWait(300);
}

int main(int argc, char** argv)
{
  QQuickWindow::setGraphicsApi(QSGRendererInterface::OpenGL);
  QGuiApplication app(argc, argv);
  TestMacosPause test;
  return QTest::qExec(&test, argc, argv);
}

#include "test_macos_pause.moc"
