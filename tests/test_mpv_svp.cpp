#include <QtTest/QtTest>
#include <QFile>
#include <QTemporaryDir>
#include <QLocalSocket>
#include <QLocalServer>
#include <QJsonDocument>
#include <MpvController>

#include "Paths.h"
#include "core/ProfileManager.h"
#include "player/MpvConfigManager.h"
#include "settings/SettingsComponent.h"

class TestMpvSvp : public QObject
{
  Q_OBJECT
private slots:
  void initTestCase();
  void embeddedConfigExposesSvpIpc();
  void leavesAnotherPlayersSocketUntouched();
  void discoversVapourSynth_data();
  void discoversVapourSynth();
  void preservesExplicitVapourSynth();
  void worksWithoutVapourSynthInstalled();
  void rifeSuppressesOnlyManagedDiscovery();
private:
  QTemporaryDir m_root;
};

void TestMpvSvp::initTestCase()
{
  QVERIFY(m_root.isValid());
  Paths::setConfigDir(m_root.path());
  Paths::setCacheDir(m_root.filePath("cache"));
  ProfileManager::Get().setActiveProfile(ProfileManager::createProfile("SVP test"));
  auto& settings = SettingsComponent::Get();
  QVERIFY(settings.componentInitialize());
  settings.setValue(SETTINGS_SECTION_MPV, "configMode", "embedded");
  settings.setValue(SETTINGS_SECTION_MPV, "enableUosc", false);
  settings.setValue(SETTINGS_SECTION_MPV, "enableDanmaku", false);
}

void TestMpvSvp::embeddedConfigExposesSvpIpc()
{
  QLocalSocket existing;
  existing.connectToServer("/tmp/mpvsocket");
  if (existing.waitForConnected(100))
    QSKIP("Another player is using the standard SVP socket");
  QVERIFY(MpvConfigManager::prepare());

  QObject owner;
  auto* controller = new MpvController(&owner);
  controller->init();
  const QString endpoint = controller->getProperty("input-ipc-server").toString();
  const auto cleanup = qScopeGuard([&] {
    mpv_set_wakeup_callback(controller->mpv(), nullptr, nullptr);
    mpv_terminate_destroy(controller->mpv());
    if (endpoint == QStringLiteral("/tmp/mpvsocket"))
      QFile::remove(endpoint);
  });
  QCOMPARE(endpoint, QStringLiteral("/tmp/mpvsocket"));
  QLocalSocket socket;
  socket.connectToServer(endpoint);
  QVERIFY2(socket.waitForConnected(3000), qPrintable(socket.errorString()));
  socket.write("{\"command\":[\"get_property\",\"mpv-version\"],\"request_id\":42}\n");
  socket.flush();
  QVERIFY(socket.waitForReadyRead(3000));
  const auto response = QJsonDocument::fromJson(socket.readLine()).object();
  QCOMPARE(response.value("request_id").toInt(), 42);
  QCOMPARE(response.value("error").toString(), QStringLiteral("success"));
  QVERIFY(response.value("data").toString().startsWith("mpv "));
  QCOMPARE(controller->getProperty("hr-seek-framedrop").toBool(), false);
  socket.disconnectFromServer();
}

void TestMpvSvp::leavesAnotherPlayersSocketUntouched()
{
  QLocalServer otherPlayer;
  if (!otherPlayer.listen("/tmp/mpvsocket"))
    QSKIP("Another player is using the standard SVP socket");
  const auto cleanup = qScopeGuard([&] { otherPlayer.close(); });
  QVERIFY(MpvConfigManager::prepare());
  QFile config(QDir(MpvConfigManager::activeConfigDir()).filePath("mpv.conf"));
  QVERIFY(config.open(QIODevice::ReadOnly));
  QVERIFY(!config.readAll().contains("\ninput-ipc-server=/tmp/mpvsocket\n"));
  QLocalSocket client;
  client.connectToServer("/tmp/mpvsocket");
  QVERIFY(client.waitForConnected(3000));
}

void TestMpvSvp::discoversVapourSynth_data()
{
  QTest::addColumn<QString>("relativeLibrary");
  QTest::newRow("python-package") << QStringLiteral("libexec/lib/python3.14/site-packages/vapoursynth/libvsscript.dylib");
  QTest::newRow("legacy") << QStringLiteral("lib/libvapoursynth-script.dylib");
}

void TestMpvSvp::rifeSuppressesOnlyManagedDiscovery()
{
  auto& settings=SettingsComponent::Get();
  settings.setValue(SETTINGS_SECTION_VIDEO,"aiRife",true);
  QVERIFY(MpvConfigManager::prepare());
  QFile config(QDir(MpvConfigManager::activeConfigDir()).filePath("mpv.conf"));
  QVERIFY(config.open(QIODevice::ReadOnly));
  QVERIFY(!config.readAll().contains("\ninput-ipc-server=/tmp/mpvsocket\n"));
  QVERIFY(MpvConfigManager::ownsDefaultSvpIpc());
  config.close();
  QFile overrides(QDir(MpvConfigManager::activeConfigDir()).filePath("user-overrides.conf"));
  QVERIFY(overrides.open(QIODevice::WriteOnly));
  const QByteArray explicitEndpoint="input-ipc-server=/tmp/rife-user-explicit.sock\n";
  QCOMPARE(overrides.write(explicitEndpoint),explicitEndpoint.size());overrides.close();
  QVERIFY(MpvConfigManager::prepare());
  QVERIFY(!MpvConfigManager::ownsDefaultSvpIpc());
  QVERIFY(overrides.open(QIODevice::ReadOnly));QCOMPARE(overrides.readAll(),explicitEndpoint);overrides.close();
  settings.setValue(SETTINGS_SECTION_VIDEO,"aiRife",false);
  QVERIFY(overrides.open(QIODevice::WriteOnly));overrides.close();
  QVERIFY(MpvConfigManager::prepare());
  QVERIFY(MpvConfigManager::ownsDefaultSvpIpc());
}

void TestMpvSvp::discoversVapourSynth()
{
  QFETCH(QString, relativeLibrary);
  QTemporaryDir root;
  const QString library = root.filePath(relativeLibrary);
  QVERIFY(QDir().mkpath(QFileInfo(library).absolutePath()));
  QFile file(library);
  QVERIFY(file.open(QIODevice::WriteOnly));
  file.close();
  const auto previous = qgetenv("VSSCRIPT_PATH");
  const auto restore = qScopeGuard([&] {
    if (previous.isNull()) qunsetenv("VSSCRIPT_PATH");
    else qputenv("VSSCRIPT_PATH", previous);
  });
  qunsetenv("VSSCRIPT_PATH");
  MpvConfigManager::configureVapourSynth({root.filePath("missing"), root.path()});
  QCOMPARE(QString::fromUtf8(qgetenv("VSSCRIPT_PATH")), QFileInfo(library).canonicalFilePath());
}

void TestMpvSvp::preservesExplicitVapourSynth()
{
  const auto previous = qgetenv("VSSCRIPT_PATH");
  const auto restore = qScopeGuard([&] {
    if (previous.isNull()) qunsetenv("VSSCRIPT_PATH");
    else qputenv("VSSCRIPT_PATH", previous);
  });
  qputenv("VSSCRIPT_PATH", "/custom/vapoursynth/libvsscript.dylib");
  MpvConfigManager::configureVapourSynth({"/opt/homebrew/opt/vapoursynth"});
  QCOMPARE(qgetenv("VSSCRIPT_PATH"), QByteArray("/custom/vapoursynth/libvsscript.dylib"));
}

void TestMpvSvp::worksWithoutVapourSynthInstalled()
{
  QTemporaryDir root;
  const auto previous = qgetenv("VSSCRIPT_PATH");
  const auto restore = qScopeGuard([&] {
    if (previous.isNull()) qunsetenv("VSSCRIPT_PATH");
    else qputenv("VSSCRIPT_PATH", previous);
  });
  qunsetenv("VSSCRIPT_PATH");
  MpvConfigManager::configureVapourSynth({root.path()});
  QVERIFY(!qEnvironmentVariableIsSet("VSSCRIPT_PATH"));
}

QTEST_GUILESS_MAIN(TestMpvSvp)
#include "test_mpv_svp.moc"
