#include <QtTest/QtTest>
#include <QTemporaryDir>
#include <QJsonObject>
#include <QJsonArray>
#include <QFile>
#include <MpvController>
#include "Paths.h"
#include "core/ProfileManager.h"
#include "player/PlayerComponent.h"
#include "settings/SettingsComponent.h"

class RifePlayerStartup : public QObject {
    Q_OBJECT
    QTemporaryDir root;
private slots:
    void initTestCase(){
        QVERIFY(root.isValid());Paths::setConfigDir(root.path());Paths::setCacheDir(root.filePath("cache"));
        ProfileManager::Get().setActiveProfile(ProfileManager::createProfile("RIFE startup test"));
        QVERIFY(SettingsComponent::Get().componentInitialize());
    }
    void missingRuntimeNeverChangesEnvironment(){
        PlayerComponent player;
        const auto before=qgetenv("VSSCRIPT_PATH");
        QVERIFY(!player.prepareWindowsRife(root.filePath("missing"),root.filePath("cache"),"missing.dll","missing.vpy"));
        QCOMPARE(qgetenv("VSSCRIPT_PATH"),before);
        QVERIFY(!player.windowsRifeStatus()["activated"].toBool());
    }
    void noExtensionStartupCompletesWithoutLoadingPython(){
        PlayerComponent player;QSignalSpy finished(&player,&PlayerComponent::windowsRifeStartupFinished);
        const auto before=qgetenv("VSSCRIPT_PATH");
        player.initializeWindowsRife(root.filePath("empty-extension"),{{"schemaVersion",1},{"packages",QJsonArray{}}});
        QTRY_COMPARE_WITH_TIMEOUT(finished.size(),1,10000);
        QCOMPARE(player.rifeExtensionStatus()["state"].toString(),QString("notInstalled"));
        QVERIFY(!player.windowsRifeStatus()["activated"].toBool());
        QCOMPARE(qgetenv("VSSCRIPT_PATH"),before);
    }
    void untrustedActiveExtensionStillAllowsBaseStartup(){
        const auto extensions=root.filePath("invalid-extension");QVERIFY(QDir().mkpath(extensions));
        QFile active(extensions+"/active.json");QVERIFY(active.open(QIODevice::WriteOnly));
        active.write("{\"schemaVersion\":1,\"id\":\"unknown-package\"}");active.close();
        PlayerComponent player;QSignalSpy finished(&player,&PlayerComponent::windowsRifeStartupFinished);
        const auto before=qgetenv("VSSCRIPT_PATH");
        player.initializeWindowsRife(extensions,{{"schemaVersion",1},{"packages",QJsonArray{}}});
        QTRY_COMPARE_WITH_TIMEOUT(finished.size(),1,10000);
        QCOMPARE(player.rifeExtensionStatus()["state"].toString(),QString("error"));
        QVERIFY(!player.rifeExtensionStatus()["error"].toString().isEmpty());
        QVERIFY(!player.windowsRifeStatus()["activated"].toBool());
        QCOMPARE(qgetenv("VSSCRIPT_PATH"),before);
    }
    void windowsPreferencesAreOffAndProvideAllThreeModels(){
        QCOMPARE(SettingsComponent::Get().value("video","aiRife"),QVariant(false));
        QCOMPARE(SettingsComponent::Get().value("video","aiRifeModel"),QVariant("rife-4.25"));
        QCOMPARE(SettingsComponent::Get().value("video","aiRifeTarget"),QVariant(60));
    }
    void realProbeActivatesBeforeCreatingMpv(){
        const auto runtime=qEnvironmentVariable("RIFE_TEST_RUNTIME");
        if(runtime.isEmpty())QSKIP("requires verified private runtime");
        PlayerComponent player;
        QSignalSpy ready(&player,&PlayerComponent::windowsRifeReady);
        QVERIFY(player.prepareWindowsRife(runtime,root.filePath("engines"),
            qEnvironmentVariable("RIFE_TEST_PLAYER_MONITOR"),QStringLiteral(SOURCE_ROOT "/resources/mpv/rife/interpolate_trt.vpy")));
        QTRY_VERIFY_WITH_TIMEOUT(!ready.isEmpty(),75000);
        QVERIFY2(ready.first()[0].toBool(),qPrintable(ready.first()[1].toString()));
        QVERIFY(player.windowsRifeStatus()["activated"].toBool());
        QCOMPARE(QFileInfo(QString::fromWCharArray(_wgetenv(L"VSSCRIPT_PATH"))).canonicalFilePath(),
            QFileInfo(runtime+"/python/Lib/site-packages/vapoursynth/vsscript.dll").canonicalFilePath());
        // The native caller waits for ready before constructing QML/mpv.
        // Once a controller is present, runtime changes must require restart.
        QObject owner;auto* controller=new MpvController(&owner);
        controller->init();
        const auto cleanup=qScopeGuard([&]{mpv_set_wakeup_callback(controller->mpv(),nullptr,nullptr);mpv_terminate_destroy(controller->mpv());});
        player.setMpvController(controller);
        QVERIFY(!player.prepareWindowsRife(runtime,root.filePath("later"),
            qEnvironmentVariable("RIFE_TEST_PLAYER_MONITOR"),QStringLiteral(SOURCE_ROOT "/resources/mpv/rife/interpolate_trt.vpy")));
        QVERIFY(player.windowsRifeStatus()["error"].toString().contains("restart"));
    }
};
QTEST_MAIN(RifePlayerStartup)
#include "test_rife_player_startup.moc"
