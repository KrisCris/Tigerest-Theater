#include <QtTest/QtTest>
#include <QProcess>
#include <QTemporaryDir>
#include <MpvController>
#include "player/interpolation/MpvPollAccess.h"
#include <windows.h>
#include "Paths.h"
#include "core/ProfileManager.h"
#include "player/PlayerComponent.h"
#include "settings/SettingsComponent.h"
#include "input/InputComponent.h"

class RifePlayerPlayback : public QObject {
    Q_OBJECT
    QTemporaryDir fixture;
private slots:
    void initTestCase(){
        QVERIFY(fixture.isValid());Paths::setConfigDir(fixture.path());Paths::setCacheDir(fixture.filePath("cache"));
        ProfileManager::Get().setActiveProfile(ProfileManager::createProfile("Native lifecycle boundaries"));
        QVERIFY(SettingsComponent::Get().componentInitialize());
    }
    void replacementDoesNotFinishOnSupersededNativeStart(){
        PlayerComponent player;player.m_inPlayback=true;player.m_replacementPending=true;
        // C has replaced R; the old recovery START can already be queued.
        player.m_windowsReplacementTargetEntryId=43;
        player.m_windowsRecoveryLoads.insert(43,{});
        mpv_event_start_file start{};start.playlist_entry_id=42;
        mpv_event event{};event.event_id=MPV_EVENT_START_FILE;event.data=&start;
        player.handleMpvEvent(&event);
        QVERIFY(player.m_replacementPending);
        mpv_event_end_file stopped{};stopped.reason=MPV_END_FILE_REASON_STOP;stopped.playlist_entry_id=42;
        event.event_id=MPV_EVENT_END_FILE;event.data=&stopped;player.handleMpvEvent(&event);
        QVERIFY(player.m_inPlayback);QVERIFY(!player.m_playbackCanceled);
        start.playlist_entry_id=43;event.event_id=MPV_EVENT_START_FILE;event.data=&start;player.handleMpvEvent(&event);
        QVERIFY(!player.m_replacementPending);
    }
    void stopCancelsPendingRecoveryReplacement(){
        PlayerComponent player;player.m_inPlayback=true;player.m_replacementPending=true;
        player.m_windowsReplacementTargetEntryId=42;
        player.m_windowsRecoveryLoads.insert(42,{});
        player.stop();
        QVERIFY(!player.m_replacementPending);
        QVERIFY(player.m_windowsRecoveryLoads.isEmpty());
        mpv_event_end_file stopped{};stopped.reason=MPV_END_FILE_REASON_STOP;
        mpv_event event{};event.event_id=MPV_EVENT_END_FILE;event.data=&stopped;
        player.handleMpvEvent(&event);
        QVERIFY(!player.m_inPlayback);QVERIFY(player.m_playbackCanceled);
    }
    void recoveryDoesNotMarkAnUnrelatedNativeStart(){
        PlayerComponent player;
        player.m_windowsReplacementTargetEntryId=42;player.m_windowsRifeReloaded=true;
        player.m_replacementPending=true;
        PlayerComponent::WindowsRecoveryLoad recovery;recovery.recovery=true;
        player.m_windowsRecoveryLoads.insert(42,recovery);
        mpv_event_start_file start{};start.playlist_entry_id=12;
        mpv_event event{};event.event_id=MPV_EVENT_START_FILE;event.data=&start;
        player.handleMpvEvent(&event);
        QVERIFY(!player.m_windowsRifeReloaded);
        QVERIFY(player.m_replacementPending);
        QCOMPARE(player.m_windowsReplacementTargetEntryId,qint64(42));
        start.playlist_entry_id=42;player.handleMpvEvent(&event);
        QVERIFY(player.m_windowsRifeReloaded);
        QVERIFY(!player.m_replacementPending);
        QCOMPARE(player.m_windowsReplacementTargetEntryId,qint64(-1));
    }
    void actualCachedPlaybackSeekPauseSpeedAndReload(){
        QTemporaryDir root;QVERIFY(root.isValid());
        Paths::setConfigDir(root.path());Paths::setCacheDir(root.filePath("cache"));
        ProfileManager::Get().setActiveProfile(ProfileManager::createProfile("RIFE playback test"));
        auto& settings=SettingsComponent::Get();QVERIFY(settings.componentInitialize());
        QVERIFY(InputComponent::Get().componentInitialize());
        settings.setValue(SETTINGS_SECTION_MPV,"configMode","embedded");
        settings.setValue(SETTINGS_SECTION_VIDEO,"aiRife",true);
        settings.setValue(SETTINGS_SECTION_VIDEO,"hardwareDecoding","disabled");
        settings.setValue(SETTINGS_SECTION_VIDEO,"refreshrate.auto_switch",false);
        const auto media=root.filePath(QStringLiteral("真实 补帧.mp4"));
        QProcess encoder;
        encoder.start(qEnvironmentVariable("RIFE_TEST_FFMPEG","ffmpeg"),{"-v","error","-f","lavfi","-i",
            "testsrc2=size=256x128:rate=30","-f","lavfi","-i","sine=frequency=440:sample_rate=48000",
            "-f","lavfi","-i","sine=frequency=880:sample_rate=48000","-t","15","-map","0:v","-map","1:a","-map","2:a","-c:a","aac","-vf",
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
        QVERIFY(player.load(QUrl::fromLocalFile(media).toString(),{{"autoplay",true}},{},1,-1));
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
        QVERIFY(player.load(QUrl::fromLocalFile(media).toString(),{{"autoplay",true}},{},1,-1));
        QTRY_VERIFY_WITH_TIMEOUT(playback()["generatedFrames"].toULongLong()>0&&playback()["state"].toInt()==2,10000);
        // A lazy VS frame error arrives after vf add succeeded. mpv disables
        // that filter and seeks back; the controller must observe enabled=false.
        QFile failure(root.filePath("frame-failure.vpy"));QVERIFY(failure.open(QIODevice::WriteOnly));
        failure.write("def fail(n):\n    raise RuntimeError('controlled RIFE frame failure')\nvideo_in.std.FrameEval(eval=fail).set_output()\n");failure.close();
        player.seekTo(3000);player.pause();
        QTRY_VERIFY(controller->getProperty("pause").toBool());
        const auto filter=QStringLiteral("@tigerest-rife:vapoursynth=file=%1%2:eof-aware=yes")
            .arg(QString("%")+QString::number(failure.fileName().toUtf8().size())+"%",failure.fileName());
        QVERIFY(controller->command(QStringList{"vf","add",filter}).metaType().id()!=qMetaTypeId<ErrorReturn>());
        QTRY_COMPARE_WITH_TIMEOUT(playback()["reason"].toString(),QString("filter-error"),10000);
        QVERIFY(controller->getProperty("pause").toBool());
        QVERIFY(player.getPosition()>=2500);
        for(const auto& value:controller->getProperty("vf").toList())
            QVERIFY(value.toMap()["label"]!="tigerest-rife");
        player.play();QTest::qWait(600);QVERIFY(player.getPosition()>3000);
        QVERIFY(player.load(QUrl::fromLocalFile(media).toString()+"?api_key=RifeFixtureA",{{"autoplay",true}},{},1,-1));
        QTRY_VERIFY_WITH_TIMEOUT(playback()["generatedFrames"].toULongLong()>0&&playback()["state"].toInt()==2,10000);
        player.seekTo(3000);player.pause();QTRY_VERIFY(controller->getProperty("pause").toBool());
        QTest::qWait(400);
        player.queueMedia(QUrl::fromLocalFile(media).toString()+"?api_key=RifeFixtureB",{{"autoplay",true}},{},1,-1);
        player.setAudioStream(1);
        QVERIFY(controller->setProperty("aid",2)>=0); // e.g. a native UOSC track change belongs to A
        QTRY_COMPARE(controller->getProperty("aid").toString(),QString("2"));
        // Deliver the real native observation before injecting the fatal event.
        QTRY_COMPARE(player.m_rifeAccess->value("aid").toString(),QString("2"));
        QCOMPARE(controller->getProperty("playlist").toList().size(),2);
        // Inject the rarer fatal END_FILE delivery at the native event boundary,
        // then exercise the actual mpv reload rather than mocking commands.
        QSignalSpy failures(&player,&PlayerComponent::error);
        mpv_event_end_file fatal{};fatal.reason=MPV_END_FILE_REASON_ERROR;fatal.error=MPV_ERROR_GENERIC;
        fatal.playlist_entry_id=player.m_windowsCurrentEntryId;
        mpv_event event{};event.event_id=MPV_EVENT_END_FILE;event.data=&fatal;
        player.handleMpvEvent(&event);
        QTRY_COMPARE_WITH_TIMEOUT(playback()["reason"].toString(),QString("filter-error"),10000);
        QVERIFY(controller->getProperty("pause").toBool());QVERIFY(player.getPosition()>=2500);
        QCOMPARE(controller->getProperty("aid").toString(),QString("2"));
        QCOMPARE(controller->getProperty("playlist").toList().size(),2);
        const auto headers=controller->getProperty("http-header-fields").toList();
        QVERIFY(headers.contains("X-Emby-Token: RifeFixtureA"));
        QVERIFY(!headers.contains("X-Emby-Token: RifeFixtureB"));
        QCOMPARE(failures.size(),0);
        QVERIFY(!player.m_windowsRecoveryLoads.isEmpty());
        player.clearQueue();
        QVERIFY(player.m_windowsRecoveryLoads.isEmpty());
        QCOMPARE(controller->getProperty("playlist").toList().size(),1);
        // The native core can select R before Qt delivers its START_FILE.
        // Clearing the queue retains that native current entry and its snapshot.
        player.m_windowsRecoveryLoads.insert(player.m_windowsCurrentEntryId,player.m_windowsCurrentLoad);
        player.clearQueue();
        QVERIFY(player.m_windowsRecoveryLoads.contains(player.m_windowsCurrentEntryId));
        QVERIFY(player.m_windowsRecoveryLoads.value(player.m_windowsCurrentEntryId).recovery);
        fatal.playlist_entry_id=player.m_windowsCurrentEntryId;
        player.handleMpvEvent(&event);player.updatePlaybackState();QTest::qWait(500);
        QCOMPARE(failures.size(),1);QCOMPARE(playback()["state"].toInt(),0);
        player.stop();QTRY_COMPARE_WITH_TIMEOUT(playback()["state"].toInt(),0,5000);
    }
};
QTEST_MAIN(RifePlayerPlayback)
#include "test_rife_player_playback.moc"
