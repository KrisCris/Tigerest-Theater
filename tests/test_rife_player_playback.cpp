#include <QtTest/QtTest>
#include <QProcess>
#include <QTemporaryDir>
#include <MpvController>
#include <windows.h>
#include "Paths.h"
#include "core/ProfileManager.h"
#include "player/PlayerComponent.h"
#include "settings/SettingsComponent.h"

class RifePlayerPlayback : public QObject {
    Q_OBJECT
private slots:
    void actualCachedPlaybackSeekPauseSpeedAndReload(){
        QTemporaryDir root;QVERIFY(root.isValid());
        Paths::setConfigDir(root.path());Paths::setCacheDir(root.filePath("cache"));
        ProfileManager::Get().setActiveProfile(ProfileManager::createProfile("RIFE playback test"));
        auto& settings=SettingsComponent::Get();QVERIFY(settings.componentInitialize());
        settings.setValue(SETTINGS_SECTION_MPV,"configMode","embedded");
        settings.setValue(SETTINGS_SECTION_VIDEO,"aiRife",true);
        settings.setValue(SETTINGS_SECTION_VIDEO,"hardwareDecoding","disabled");
        settings.setValue(SETTINGS_SECTION_VIDEO,"refreshrate.auto_switch",false);
        const auto media=root.filePath(QStringLiteral("真实 补帧.mp4"));
        QProcess encoder;
        encoder.start(qEnvironmentVariable("RIFE_TEST_FFMPEG","ffmpeg"),{"-v","error","-f","lavfi","-i",
            "testsrc2=size=256x128:rate=30","-t","15","-vf",
            "setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709",
            "-c:v","libx264","-preset","ultrafast","-crf","18","-color_range","tv",
            "-color_primaries","bt709","-color_trc","bt709","-colorspace","bt709",media});
        QVERIFY(encoder.waitForFinished(30000));QCOMPARE(encoder.exitCode(),0);
        wchar_t module[32768]{};GetModuleFileNameW(GetModuleHandleW(L"libmpv-2.dll"),module,DWORD(std::size(module)));
        QCOMPARE(QFileInfo(QString::fromWCharArray(module)).canonicalFilePath(),
                 QFileInfo(qEnvironmentVariable("RIFE_TEST_PLAYER_EXPECTED_DLL")).canonicalFilePath());
        PlayerComponent player;
        QSignalSpy ready(&player,&PlayerComponent::windowsRifeReady);
        QVERIFY(player.prepareWindowsRife(qEnvironmentVariable("RIFE_TEST_RUNTIME"),
            qEnvironmentVariable("RIFE_TEST_PLAYER_CACHE"),qEnvironmentVariable("RIFE_TEST_PLAYER_MONITOR"),
            QStringLiteral(SOURCE_ROOT "/resources/mpv/rife/interpolate_trt.vpy")));
        QTRY_VERIFY_WITH_TIMEOUT(!ready.isEmpty(),75000);
        QVERIFY2(ready.first()[0].toBool(),qPrintable(ready.first()[1].toString()));
        QVERIFY(!player.selectWindowsRifeModel("missing-model",60));
        QVERIFY(!player.selectWindowsRifeModel("rife-4.25-lite",75));
        QVERIFY(player.selectWindowsRifeModel("rife-4.25-lite",60));
        // Match MpvAbstractItem's real worker-thread ownership and teardown.
        QThread worker;auto* controller=new MpvController;
        controller->moveToThread(&worker);
        connect(&worker,&QThread::finished,controller,&QObject::deleteLater);
        worker.start();
        QMetaObject::invokeMethod(controller,&MpvController::init,Qt::BlockingQueuedConnection);
        auto* handle=controller->mpv();
        const auto cleanup=qScopeGuard([&]{
            mpv_set_wakeup_callback(handle,nullptr,nullptr);worker.quit();worker.wait();mpv_terminate_destroy(handle);
        });
        QSignalSpy stolenProperties(controller,&MpvController::propertyChanged);
        player.setMpvController(controller);player.setNativeVideoOutput(true);
        player.initializeMpv();
        QVERIFY(controller->setProperty("vo","null")>=0);
        QVERIFY(controller->setProperty("ao","null")>=0);
        QVERIFY(controller->setProperty("audio","no")>=0);
        const auto playback=[&]{return player.windowsRifeStatus()["playback"].toMap();};
        QVERIFY(controller->command(QStringList{"loadfile",media}).metaType().id()!=qMetaTypeId<ErrorReturn>());
        QTest::qWait(1000);
        qInfo()<<"Initial playback"<<player.windowsRifeStatus()<<controller->getProperty("video-params")
               <<controller->getProperty("video-frame-info")<<controller->getProperty("speed");
        QCOMPARE(stolenProperties.count(),0); // Player exclusively owns this mpv event queue.
        QTRY_VERIFY_WITH_TIMEOUT(playback()["generatedFrames"].toULongLong()>0,10000);
        QVERIFY(player.windowsRifeStatus()["engineCacheHitForItem"].toBool());
        QCOMPARE(playback()["state"].toInt(),2); // Active, observed by the real Player timer.
        QVERIFY(!player.selectWindowsRifeModel("rife-4.25-heavy",240));
        QVERIFY(playback()["processedPairs"].toULongLong()>0);
        QVERIFY(!playback()["timingAvailable"].toBool());QVERIFY(playback()["p95Ms"].isNull());
        const auto epoch=playback()["epoch"].toULongLong();QVERIFY(epoch>0);
        player.pause();QTRY_VERIFY(controller->getProperty("pause").toBool());
        QCOMPARE(playback()["state"].toInt(),2);
        player.seekTo(1000);player.play();
        QTRY_VERIFY_WITH_TIMEOUT(playback()["epoch"].toULongLong()>epoch&&playback()["generatedFrames"].toULongLong()>0,10000);
        QVERIFY(controller->setProperty("speed",1.25)>=0);
        QTRY_COMPARE_WITH_TIMEOUT(playback()["reason"].toString(),QString("playback-speed"),5000);
        for(const auto& value:controller->getProperty("vf").toList())
            QVERIFY(value.toMap()["label"]!="tigerest-rife");
        QVERIFY(controller->setProperty("speed",1.0)>=0);QTest::qWait(500);
        QCOMPARE(playback()["reason"].toString(),QString("playback-speed"));
        QVERIFY(controller->command(QStringList{"loadfile",media,"replace"}).metaType().id()!=qMetaTypeId<ErrorReturn>());
        QTRY_VERIFY_WITH_TIMEOUT(playback()["generatedFrames"].toULongLong()>0&&playback()["state"].toInt()==2,10000);
        player.stop();QTRY_COMPARE_WITH_TIMEOUT(playback()["state"].toInt(),0,5000);
    }
};
QTEST_MAIN(RifePlayerPlayback)
#include "test_rife_player_playback.moc"
