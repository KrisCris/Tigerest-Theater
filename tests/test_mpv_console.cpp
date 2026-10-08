#include <QtTest/QtTest>
#include <QFile>
#include <QJsonDocument>
#include <QJsonArray>
#include <QJsonObject>
#include <QTemporaryDir>
#include <QScopeGuard>
#include <MpvController>

class TestMpvConsole : public QObject
{
  Q_OBJECT
private slots:
  void disabledByDefault();
  void startupSelection_data();
  void startupSelection();
  void keybindLabels();
  void qualityProfilesPreserveInterpolation_data();
  void qualityProfilesPreserveInterpolation();
};

void TestMpvConsole::disabledByDefault()
{
  QFile file(QStringLiteral(SOURCE_ROOT "/resources/settings/settings_description.json"));
  QVERIFY(file.open(QIODevice::ReadOnly));
  bool found = false;
  for (const auto section : QJsonDocument::fromJson(file.readAll()).array()) {
    if (section.toObject().value("section") != "mpv") continue;
    for (const auto entry : section.toObject().value("values").toArray()) {
      const auto setting = entry.toObject();
      if (setting.value("value") != "enableConsole") continue;
      found = true;
      QCOMPARE(setting.value("default"), QJsonValue(false));
    }
  }
  QVERIFY2(found, "Persistent console switch is missing");
}

void TestMpvConsole::startupSelection_data()
{
  QTest::addColumn<bool>("enabled");
  QTest::newRow("disabled") << false;
  QTest::newRow("enabled") << true;
}

void TestMpvConsole::startupSelection()
{
  QFETCH(bool, enabled);
  QTemporaryDir config;
  QVERIFY(config.isValid());
  QFile conf(config.filePath("mpv.conf"));
  QVERIFY(conf.open(QIODevice::WriteOnly));
  // An old user file must not silently defeat the new application switch.
  conf.write(enabled ? "load-osd-console=no\n" : "load-osd-console=yes\n");
  conf.close();
  const auto oldRoot = qgetenv("TIGEREST_MPV_CONFIG_DIR");
  const auto oldConsole = qgetenv("TIGEREST_MPV_CONSOLE");
  const auto restore = qScopeGuard([&] {
    if (oldRoot.isNull()) qunsetenv("TIGEREST_MPV_CONFIG_DIR");
    else qputenv("TIGEREST_MPV_CONFIG_DIR", oldRoot);
    if (oldConsole.isNull()) qunsetenv("TIGEREST_MPV_CONSOLE");
    else qputenv("TIGEREST_MPV_CONSOLE", oldConsole);
  });
  qputenv("TIGEREST_MPV_CONFIG_DIR", config.path().toUtf8());
  qputenv("TIGEREST_MPV_CONSOLE", enabled ? "yes" : "no");
  QObject owner;
  auto* controller = new MpvController(&owner);
  controller->init();
  const auto cleanup = qScopeGuard([&] {
    mpv_set_wakeup_callback(controller->mpv(), nullptr, nullptr);
    mpv_terminate_destroy(controller->mpv());
  });
  auto option = controller->getProperty("options/load-commands");
  const bool separateCommandEntry = !option.canConvert<ErrorReturn>();
  if (!separateCommandEntry)
    option = controller->getProperty("options/load-osd-console");
  QVERIFY(!option.canConvert<ErrorReturn>());
  QCOMPARE(option.toBool(), enabled);
  const char* ping[] = {"script-message-to", separateCommandEntry ? "commands" : "console", "tigerest-test-ping", nullptr};
  QTRY_COMPARE_WITH_TIMEOUT(mpv_command(controller->mpv(), ping) >= 0, enabled, 5000);
  if (separateCommandEntry) {
    QCOMPARE(controller->getProperty("options/load-console").toBool(), true);
    const char* inputPing[] = {"script-message-to", "console", "tigerest-test-ping", nullptr};
    QTRY_VERIFY_WITH_TIMEOUT(mpv_command(controller->mpv(), inputPing) >= 0, 5000);
  }
}

void TestMpvConsole::keybindLabels()
{
  QTemporaryDir root;
  QVERIFY(root.isValid());
  QFile script(root.filePath("label-test.lua"));
  QVERIFY(script.open(QIODevice::WriteOnly));
  QFile fixture(QStringLiteral(SOURCE_ROOT "/tests/test_mpv_keybind_labels.lua"));
  QVERIFY(fixture.open(QIODevice::ReadOnly));
  QFile module(QStringLiteral(SOURCE_ROOT "/resources/mpv/plugins/uosc/lib/tigerest_keybind_labels.lua"));
  QVERIFY(module.copy(root.filePath("tigerest_keybind_labels.lua")));
  script.write("local tests = (function()\n" + fixture.readAll() + "\nend)()\n");
  script.write(QStringLiteral(
      "local ok, err = pcall(tests, [=[%1]=])\n"
      "local f = assert(io.open([=[%1/result.txt]=], 'w')); f:write(ok and 'ok' or tostring(err)); f:close()\n")
      .arg(root.path()).toUtf8());
  script.close();
  const auto oldRoot = qgetenv("TIGEREST_MPV_CONFIG_DIR");
  const auto restore = qScopeGuard([&] {
    if (oldRoot.isNull()) qunsetenv("TIGEREST_MPV_CONFIG_DIR");
    else qputenv("TIGEREST_MPV_CONFIG_DIR", oldRoot);
  });
  qputenv("TIGEREST_MPV_CONFIG_DIR", root.path().toUtf8());
  QObject owner;
  auto* controller = new MpvController(&owner);
  controller->init();
  const auto cleanup = qScopeGuard([&] {
    mpv_set_wakeup_callback(controller->mpv(), nullptr, nullptr);
    mpv_terminate_destroy(controller->mpv());
  });
  const auto loaded = controller->command(QVariantList{QStringLiteral("load-script"), script.fileName()});
  QVERIFY(!loaded.canConvert<ErrorReturn>());
  QTRY_VERIFY_WITH_TIMEOUT(QFile::exists(root.filePath("result.txt")), 5000);
  QFile result(root.filePath("result.txt"));
  QVERIFY(result.open(QIODevice::ReadOnly));
  QCOMPARE(QString::fromUtf8(result.readAll()), QStringLiteral("ok"));
}

void TestMpvConsole::qualityProfilesPreserveInterpolation_data()
{
  QTest::addColumn<bool>("enabled");
  QTest::newRow("RIFE enabled") << true;
  QTest::newRow("RIFE disabled") << false;
}

void TestMpvConsole::qualityProfilesPreserveInterpolation()
{
  QFETCH(bool, enabled);
  QTemporaryDir root;
  QVERIFY(root.isValid());
  QFile source(QStringLiteral(SOURCE_ROOT "/resources/mpv/mpv.conf.in"));
  QVERIFY(source.open(QIODevice::ReadOnly));
  QString config = QString::fromUtf8(source.readAll());
  config.replace("@TIGEREST_PROFILE@", "tigerest-default");
  config.replace("@TIGEREST_IPC_SERVER@", "");
  config.replace("@TIGEREST_SCRIPTS@", "");
  config.replace("script=~~/plugins/stats.lua", "");
  config.replace("input-conf=~~/input.conf", "");
  config.replace("~~/shaders/", QStringLiteral(SOURCE_ROOT "/resources/mpv/shaders/"));
  QFile output(root.filePath("mpv.conf"));
  QVERIFY(output.open(QIODevice::WriteOnly));
  output.write(config.toUtf8()); output.close();
  QFile overrides(root.filePath("user-overrides.conf"));
  QVERIFY(overrides.open(QIODevice::WriteOnly)); overrides.close();
  const auto oldRoot = qgetenv("TIGEREST_MPV_CONFIG_DIR");
  const auto restore = qScopeGuard([&] {
    if (oldRoot.isNull()) qunsetenv("TIGEREST_MPV_CONFIG_DIR");
    else qputenv("TIGEREST_MPV_CONFIG_DIR", oldRoot);
  });
  qputenv("TIGEREST_MPV_CONFIG_DIR", root.path().toUtf8());
  QObject owner;
  auto* controller = new MpvController(&owner);
  controller->init();
  const auto cleanup = qScopeGuard([&] {
    mpv_set_wakeup_callback(controller->mpv(), nullptr, nullptr);
    mpv_terminate_destroy(controller->mpv());
  });
  QCOMPARE(controller->getProperty("video-sync").toString(), QStringLiteral("display-resample"));
  const auto shaders = [&] {
    QStringList result;
    for (const auto& value : controller->getProperty("glsl-shaders").toList())
      if (!value.toString().trimmed().isEmpty()) result.append(value.toString());
    return result;
  };
  const auto defaultShaders = shaders();
  QCOMPARE(defaultShaders.size(), 3);
  // A labelled no-op graph exercises real mpv filter retention without loading
  // an external RIFE engine. The production interpolation model is not involved.
  QVERIFY(controller->setProperty("vf", enabled ? "@tigerest-rife:lavfi=[null]" : "") >= 0);
  QVERIFY(controller->setProperty("video-sync", enabled ? "audio" : "display-resample") >= 0);
  QVERIFY(controller->setProperty("user-data/tigerest/rife-clock-owned", enabled) >= 0);
  const auto filters = controller->getProperty("vf");
  const auto sync = controller->getProperty("video-sync");
  const auto loaded = controller->command(QVariantList{QStringLiteral("load-script"),
      QStringLiteral(SOURCE_ROOT "/resources/mpv/plugins/profile_menu.lua")});
  QVERIFY(!loaded.canConvert<ErrorReturn>());
  QTRY_COMPARE_WITH_TIMEOUT(controller->getProperty("user-data/profile_menu/current").toString(),
                           QStringLiteral("tigerest-default"), 5000);
  for (const bool luaMenu : {false, true}) {
    const auto apply = [&](const QString& profile) {
      controller->command(QStringList{"change-list", "glsl-shaders", "clr", ""});
      return controller->command(QStringList{"apply-profile", profile});
    };
    QVERIFY(!apply("tigerest-aggressive-test").canConvert<ErrorReturn>());
    QCOMPARE(shaders().size(), 4);
    if (luaMenu) {
      controller->setProperty("user-data/profile_menu/current", "pending");
      const auto result = controller->command(QStringList{"script-binding", "profile_menu/apply-default"});
      QVERIFY(!result.canConvert<ErrorReturn>());
      QTRY_COMPARE_WITH_TIMEOUT(controller->getProperty("user-data/profile_menu/current").toString(),
                               QStringLiteral("tigerest-default"), 5000);
    } else {
      QVERIFY(!apply("tigerest-default").canConvert<ErrorReturn>());
    }
    QCOMPARE(shaders(), defaultShaders);
    QCOMPARE(controller->getProperty("vf"), filters);
    QCOMPARE(controller->getProperty("video-sync"), sync);
    QCOMPARE(controller->getProperty("user-data/tigerest/rife-clock-owned").toBool(), enabled);
  }
}

QTEST_GUILESS_MAIN(TestMpvConsole)
#include "test_mpv_console.moc"
