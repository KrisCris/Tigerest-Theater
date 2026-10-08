#include <QtTest/QtTest>
#include <QProcess>
#include <QTemporaryDir>
#include <MpvController>
#include "player/interpolation/MpvPollAccess.h"
#include "player/interpolation/windows/RifePlaybackCoordinator.h"
#include "player/interpolation/windows/RifePreparationOverlay.h"
#include <windows.h>
#include "Paths.h"
#include "core/ProfileManager.h"
#include "player/PlayerComponent.h"
#include "player/MpvVideoItem.h"
#include "player/MpvConfigManager.h"
#include <QKeyEvent>
#include <QMouseEvent>
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
    void preparationPauseReportsBufferingUntilUserPauses(){
        PlayerComponent player;player.m_inPlayback=true;player.m_paused=true;
        player.m_rifeStartup.begin(true,false,0);
        player.updatePlaybackState();
        QCOMPARE(player.m_state,PlayerComponent::State::buffering);
        player.pause();
        QVERIFY(player.m_rifeStartup.waiting());
        QVERIFY(!player.m_rifeStartup.waitingToPlay());
        player.updatePlaybackState();
        QCOMPARE(player.m_state,PlayerComponent::State::paused);
    }
    void stopCancelsPreparationBeforeNativeEndFileArrives(){
        PlayerComponent player;
        player.m_rifeStartup.begin(true,false,0);
        player.stop();
        QVERIFY(!player.m_rifeStartup.waiting());
        QVERIFY(!player.m_rifeStartup.finish());
    }
    void nativePreparationToggleChangesIntentWithoutReleasingHold(){
        PlayerComponent player;
        player.m_rifeStartup.begin(true,false,0);
        const char* args[]={"tigerest-rife-toggle-pause"};
        mpv_event_client_message message{};message.num_args=1;message.args=args;
        mpv_event event{};event.event_id=MPV_EVENT_CLIENT_MESSAGE;event.data=&message;
        player.handleMpvEvent(&event);
        QVERIFY(player.m_rifeStartup.waiting());
        QVERIFY(!player.m_rifeStartup.waitingToPlay());
        player.handleMpvEvent(&event);
        QVERIFY(player.m_rifeStartup.waitingToPlay());
    }
    void queuedPreparationTogglesAfterResumeRemainDistinct(){
        PlayerComponent player;player.m_paused=true;player.m_rifeClock.start();
        int toggles=0;bool physicalPause=false;
        rife::MpvAccess access{
            [](const QString&){return QVariant();},
            [](const QString&,const QVariant&){return false;},
            [](const QStringList&){return false;},
            [](const QString&,const QVariant&){return true;},
            [&](const QStringList& args){
                if(args==QStringList{"cycle","pause"}){++toggles;physicalPause=!physicalPause;}
                return true;
            }};
        player.m_rifeAccess=std::make_unique<rife::MpvPollAccess>(access);
        player.m_rifeStartup.begin(true,false,0);player.finishInterpolationStartup();
        mpv_event reply{};reply.event_id=MPV_EVENT_SET_PROPERTY_REPLY;
        reply.reply_userdata=player.m_rifeResumeRequest;player.handleMpvEvent(&reply);
        const char* args[]={"tigerest-rife-toggle-pause"};
        mpv_event_client_message message{};message.num_args=1;message.args=args;
        mpv_event event{};event.event_id=MPV_EVENT_CLIENT_MESSAGE;event.data=&message;
        player.handleMpvEvent(&event);QCOMPARE(toggles,1);QVERIFY(physicalPause);
        player.handleMpvEvent(&event);QCOMPARE(toggles,2);QVERIFY(!physicalPause);
        QVERIFY(player.m_paused); // observation intentionally delayed throughout
    }
    void qtSpaceAndDoubleClickPreservePreparationIntent(){
        class InputItem:public MpvVideoItem{
        public:
            using MpvVideoItem::keyPressEvent;
            using MpvVideoItem::keyReleaseEvent;
            using MpvVideoItem::mouseDoubleClickEvent;
            using MpvVideoItem::mouseReleaseEvent;
        };
        PlayerComponent player;player.m_paused=true;player.m_rifeClock.start();
        int unpauses=0,cycles=0;
        rife::MpvAccess access{
            [](const QString&){return QVariant();},
            [](const QString&,const QVariant&){return false;},
            [](const QStringList&){return false;},
            [&](const QString& key,const QVariant& value){if(key=="pause"&&!value.toBool())++unpauses;return true;},
            [&](const QStringList& args){if(args==QStringList{"cycle","pause"})++cycles;return true;}};
        player.m_rifeAccess=std::make_unique<rife::MpvPollAccess>(access);
        InputItem item;item.m_player=&player; // no window, media, or renderer is created
        player.m_rifeStartup.begin(true,false,0);
        QKeyEvent press(QEvent::KeyPress,Qt::Key_Space,Qt::NoModifier);
        QKeyEvent release(QEvent::KeyRelease,Qt::Key_Space,Qt::NoModifier);
        item.keyPressEvent(&press);QVERIFY(!player.m_rifeStartup.waitingToPlay());
        item.keyReleaseEvent(&release);QVERIFY(!player.m_rifeStartup.waitingToPlay());
        item.keyPressEvent(&press);item.keyReleaseEvent(&release);QVERIFY(player.m_rifeStartup.waitingToPlay());
        QMouseEvent doubleClick(QEvent::MouseButtonDblClick,QPointF(20,20),QPointF(20,20),
            Qt::LeftButton,Qt::LeftButton,Qt::NoModifier);
        QMouseEvent mouseRelease(QEvent::MouseButtonRelease,QPointF(20,20),QPointF(20,20),
            Qt::LeftButton,Qt::NoButton,Qt::NoModifier);
        item.mouseDoubleClickEvent(&doubleClick);QVERIFY(!player.m_rifeStartup.waitingToPlay());
        item.mouseReleaseEvent(&mouseRelease);QVERIFY(!player.m_rifeStartup.waitingToPlay());
        item.mouseDoubleClickEvent(&doubleClick);item.mouseReleaseEvent(&mouseRelease);
        QVERIFY(player.m_rifeStartup.waitingToPlay());QCOMPARE(unpauses,0);QCOMPARE(cycles,0);
        player.m_rifeStartup.cancel();
        item.keyPressEvent(&press);item.keyReleaseEvent(&release);QCOMPARE(cycles,1);
        item.mouseDoubleClickEvent(&doubleClick);item.mouseReleaseEvent(&mouseRelease);QCOMPARE(cycles,2);
    }
    void preparationOverlayAndResumeFollowTheCurrentHold(){
        PlayerComponent player;player.m_inPlayback=true;player.m_rifeClock.start();
        QList<QStringList> commands;QList<QPair<QString,QVariant>> writes;
        rife::MpvAccess access{
            [](const QString&){return QVariant();},
            [](const QString&,const QVariant&){return false;},
            [](const QStringList&){return false;},
            [&](const QString& key,const QVariant& value){writes.append({key,value});return true;},
            [&](const QStringList& args){commands.append(args);return true;}};
        player.m_rifeAccess=std::make_unique<rife::MpvPollAccess>(access);
        player.m_rifeStartup.begin(true,false,-1000);
        player.updateInterpolationPreparationOverlay();
        QVERIFY(player.m_windowsPreparationOverlayVisible);
        QCOMPARE(commands.last().value(2),QString("ass-events"));
        player.pause();
        QVERIFY(player.m_rifeStartup.waiting());
        player.finishInterpolationStartup();
        QVERIFY(!player.m_windowsPreparationOverlayVisible);
        QCOMPARE(commands.last().value(2),QString("none"));
        QVERIFY(!writes.contains({QString("pause"),QVariant(false)}));
        player.m_rifeStartup.begin(true,false,-1000);
        player.finishInterpolationStartup();
        QCOMPARE(writes.count({QString("pause"),QVariant(false)}),1);
        player.finishInterpolationStartup();
        QCOMPARE(writes.count({QString("pause"),QVariant(false)}),1);
        player.m_rifeStartup.begin(true,false,-1000);player.updateInterpolationPreparationOverlay();
        player.stop();
        QVERIFY(!player.m_windowsPreparationOverlayVisible);
        QCOMPARE(commands.last().value(2),QString("none"));
        player.finishInterpolationStartup();
        QCOMPARE(writes.count({QString("pause"),QVariant(false)}),1);
    }
    void preparationResumeRetainsHoldUntilAcknowledged(){
        PlayerComponent player;player.m_inPlayback=true;player.m_paused=true;player.m_rifeClock.start();
        int resumes=0;
        rife::MpvAccess access{
            [](const QString&){return QVariant();},
            [](const QString&,const QVariant&){return false;},
            [](const QStringList&){return false;},
            [&](const QString& key,const QVariant& value){if(key=="pause"&&!value.toBool())++resumes;return true;},
            [](const QStringList&){return true;}};
        player.m_rifeAccess=std::make_unique<rife::MpvPollAccess>(access);
        player.m_rifeStartup.begin(true,false,0);
        player.finishInterpolationStartup();
        QCOMPARE(resumes,1);
        QVERIFY(player.m_rifeStartup.waiting());
        player.updatePlaybackState();
        QCOMPARE(player.m_state,PlayerComponent::State::buffering);
        player.finishInterpolationStartup();
        QCOMPARE(resumes,1);
        mpv_event reply{};reply.event_id=MPV_EVENT_SET_PROPERTY_REPLY;
        reply.reply_userdata=player.m_rifeResumeRequest;
        player.handleMpvEvent(&reply);
        QVERIFY(!player.m_rifeStartup.waiting());
        player.handleMpvEvent(&reply); // duplicate reply cannot resume twice
        QCOMPARE(resumes,1);
    }
    void rejectedPreparationResumeReportsPlaybackError(){
        PlayerComponent player;player.m_inPlayback=true;player.m_paused=true;player.m_rifeClock.start();
        QList<QStringList> commands;QSignalSpy errors(&player,&PlayerComponent::error);
        rife::MpvAccess access{
            [](const QString&){return QVariant();},
            [](const QString&,const QVariant&){return false;},
            [](const QStringList&){return false;},
            [](const QString& key,const QVariant&){return key!="pause";},
            [&](const QStringList& args){commands.append(args);return true;}};
        player.m_rifeAccess=std::make_unique<rife::MpvPollAccess>(access);
        player.m_rifeStartup.begin(true,false,0);
        player.finishInterpolationStartup();
        QCOMPARE(errors.count(),1);
        QVERIFY(!player.m_rifeStartup.waiting());
        QVERIFY(commands.contains(QStringList{"stop"}));
    }
    void preparationResumeReplyIsScopedToItemAndPauseIntent(){
        PlayerComponent player;player.m_inPlayback=true;player.m_paused=true;player.m_rifeClock.start();
        QList<int> requests;
        rife::MpvAccess access{
            [](const QString&){return QVariant();},
            [](const QString&,const QVariant&){return false;},
            [](const QStringList&){return false;},
            [](const QString&,const QVariant&){return true;},
            [](const QStringList&){return true;},
            [&](const QString&,const QVariant&,int id){requests.append(id);return true;}};
        player.m_rifeAccess=std::make_unique<rife::MpvPollAccess>(access);
        player.m_rifeStartup.begin(true,false,0);player.finishInterpolationStartup();
        const auto oldRequest=requests.last();
        player.m_rifeStartup.begin(true,false,0);player.finishInterpolationStartup();
        const auto newRequest=requests.last();QVERIFY(newRequest!=oldRequest);
        mpv_event reply{};reply.event_id=MPV_EVENT_SET_PROPERTY_REPLY;reply.reply_userdata=oldRequest;
        player.handleMpvEvent(&reply);QVERIFY(player.m_rifeStartup.waiting());
        player.pause();player.play();player.finishInterpolationStartup();
        const auto resumedAfterPause=requests.last();QVERIFY(resumedAfterPause!=newRequest);
        reply.reply_userdata=newRequest;reply.error=MPV_ERROR_PROPERTY_ERROR;
        player.handleMpvEvent(&reply);QVERIFY(player.m_rifeStartup.waiting());
        reply.reply_userdata=resumedAfterPause;reply.error=0;
        player.handleMpvEvent(&reply);QVERIFY(!player.m_rifeStartup.waiting());
        player.m_rifeStartup.begin(true,false,0);player.finishInterpolationStartup();
        reply.reply_userdata=requests.last();player.stop();player.handleMpvEvent(&reply);
        QVERIFY(!player.m_rifeStartup.waiting());QVERIFY(!player.m_rifeStartup.waitingToPlay());
    }
    void preparationResumeErrorsAndMissingRepliesAreBounded(){
        for(const bool timeout:{false,true}){
            PlayerComponent player;player.m_inPlayback=true;player.m_paused=true;player.m_rifeClock.start();
            QSignalSpy errors(&player,&PlayerComponent::error);
            rife::MpvAccess access{
                [](const QString&){return QVariant();},
                [](const QString&,const QVariant&){return false;},
                [](const QStringList&){return false;},
                [](const QString&,const QVariant&){return true;},
                [](const QStringList&){return true;}};
            player.m_rifeAccess=std::make_unique<rife::MpvPollAccess>(access);
            player.m_rifeStartup.begin(true,false,0);player.finishInterpolationStartup();
            if(timeout){
                player.checkInterpolationResume(player.m_rifeResumeSince+4999);QCOMPARE(errors.count(),0);
                player.checkInterpolationResume(player.m_rifeResumeSince+5000);
            }else{
                mpv_event reply{};reply.event_id=MPV_EVENT_SET_PROPERTY_REPLY;
                reply.reply_userdata=player.m_rifeResumeRequest;reply.error=MPV_ERROR_PROPERTY_ERROR;
                player.handleMpvEvent(&reply);
            }
            QCOMPARE(errors.count(),1);QVERIFY(!player.m_rifeStartup.waiting());
            QCOMPARE(player.m_state,PlayerComponent::State::error);
            player.checkInterpolationResume(player.m_rifeResumeSince+6000);QCOMPARE(errors.count(),1);
        }
    }
    void nativeSpaceDuringPreparationDoesNotRacePhysicalPause(){
        std::unique_ptr<mpv_handle,decltype(&mpv_terminate_destroy)> core(mpv_create(),mpv_terminate_destroy);
        QVERIFY(core);mpv_set_option_string(core.get(),"config","no");
        mpv_set_option_string(core.get(),"vo","null");mpv_set_option_string(core.get(),"ao","null");
        mpv_set_option_string(core.get(),"pause","yes");QCOMPARE(mpv_initialize(core.get()),0);
        const auto command=[&](const QStringList& args){
            QList<QByteArray> text;QList<const char*> raw;
            for(const auto& arg:args)text.append(arg.toUtf8());
            for(const auto& arg:text)raw.append(arg.constData());raw.append(nullptr);
            return mpv_command(core.get(),raw.data())>=0;
        };
        QVERIFY(command({"define-section","test-baseline","SPACE cycle pause","force"}));
        QVERIFY(command({"enable-section","test-baseline"}));
        PlayerComponent player;player.m_paused=true;player.m_rifeClock.start();
        rife::MpvAccess access{
            [](const QString&){return QVariant();},
            [](const QString&,const QVariant&){return false;},command,
            [](const QString&,const QVariant&){return true;},command};
        player.m_rifeAccess=std::make_unique<rife::MpvPollAccess>(access);
        player.m_rifeStartup.begin(true,false,0);player.publishInterpolationPause();
        QVERIFY(command({"keypress","SPACE"}));QVERIFY(command({"keypress","SPACE"}));
        int toggles=0;QElapsedTimer deadline;deadline.start();
        while(toggles<2&&deadline.elapsed()<2000){
            auto* event=mpv_wait_event(core.get(),0.01);
            if(event->event_id==MPV_EVENT_CLIENT_MESSAGE){player.handleMpvEvent(event);++toggles;}
        }
        QCOMPARE(toggles,2);QVERIFY(player.m_rifeStartup.waitingToPlay());
        int paused=0;QCOMPARE(mpv_get_property(core.get(),"pause",MPV_FORMAT_FLAG,&paused),0);QVERIFY(paused);
        player.m_rifeStartup.cancel();player.publishInterpolationPause();
        QVERIFY(command({"keypress","SPACE"}));
        QTRY_VERIFY(([&]{mpv_get_property(core.get(),"pause",MPV_FORMAT_FLAG,&paused);return !paused;})());
    }
    void preparationOverlayCommandsAreAcceptedByMpv(){
        std::unique_ptr<mpv_handle,decltype(&mpv_terminate_destroy)> core(mpv_create(),mpv_terminate_destroy);
        QVERIFY(core);mpv_set_option_string(core.get(),"config","no");
        mpv_set_option_string(core.get(),"vo","null");mpv_set_option_string(core.get(),"ao","null");
        QCOMPARE(mpv_initialize(core.get()),0);
        for(const bool visible:{true,false}){
            const auto args=rife::preparationOverlay(visible,true,true,1000);
            QList<QByteArray> text;QList<const char*> raw;
            for(const auto& arg:args)text.append(arg.toUtf8());
            for(const auto& arg:text)raw.append(arg.constData());raw.append(nullptr);
            QCOMPARE(mpv_command(core.get(),raw.data()),0);
        }
    }
    void renderApiRemainsVisibleWhileItsVoReconfigures(){
        for(const bool native:{false,true}) {
            PlayerComponent player;player.m_nativeVideoOutput=native;
            QSignalSpy visibility(&player,&PlayerComponent::windowVisible);
            mpv_event_start_file start{};start.playlist_entry_id=17;
            mpv_event event{};event.event_id=MPV_EVENT_START_FILE;event.data=&start;
            player.handleMpvEvent(&event);
            QCOMPARE(visibility.last()[0].toBool(),!native);
            int configured=0;
            mpv_event_property property{"vo-configured",MPV_FORMAT_FLAG,&configured};
            event.event_id=MPV_EVENT_PROPERTY_CHANGE;event.data=&property;
            player.handleMpvEvent(&event);
            QCOMPARE(visibility.last()[0].toBool(),!native);
            QVERIFY(!player.m_windowVisible); // readiness remains a real VO state
            mpv_event_end_file ended{};ended.reason=MPV_END_FILE_REASON_EOF;
            event.event_id=MPV_EVENT_END_FILE;event.data=&ended;
            player.handleMpvEvent(&event);
            QCOMPARE(visibility.last()[0].toBool(),false);
        }
    }
    void renderApiWaitsForRestartBeforeQualifyingItsFormat(){
        std::unique_ptr<QObject> controller(new MpvController);
        PlayerComponent player;
        player.m_mpv=static_cast<MpvController*>(controller.get());player.m_nativeVideoOutput=false;
        player.m_inPlayback=true;player.m_nativeVideoReady=false;player.m_rifeClock.start();
        rife::MpvAccess access{
            [](const QString&){return QVariant();},
            [](const QString&,const QVariant&){return true;},
            [](const QStringList&){return true;},
            [](const QString&,const QVariant&){return true;},
            [](const QStringList&){return true;}};
        player.m_rifeAccess=std::make_unique<rife::MpvPollAccess>(access);
        player.m_rife=std::make_unique<rife::FrameInterpolationController>(access,rife::RuntimePaths{});
        player.m_windowsRifePlayback=std::make_unique<rife::RifePlaybackCoordinator>(*player.m_windowsRifeRuntime,*player.m_rife);
        player.m_windowsRifePlayback->beginItem(true,false,1.);
        auto& observed=*player.m_rifeAccess;
        observed.observe("vf",QVariantList{});observed.observe("speed",1.);
        observed.observe("video-sync","display-resample");
        observed.observe("container-fps",30.);
        observed.observe("video-frame-info",QVariantMap{{"interlaced",false}});
        QVariantMap format{{"w",1920},{"h",1080}};
        observed.observe("video-params",format);
        // A replacement initially reports dimensions without settled color
        // metadata. It must not become the immutable source identity yet.
        player.pollInterpolation();
        format.insert("gamma","bt.1886");format.insert("primaries","bt.709");
        format.insert("colormatrix","bt.709");format.insert("colorlevels","limited");
        observed.observe("video-params",format);
        mpv_event event{};event.event_id=MPV_EVENT_PLAYBACK_RESTART;player.handleMpvEvent(&event);
        player.pollInterpolation();
        QCOMPARE(player.m_rife->diagnostics()["reason"].toString(),QString("runtime-missing"));
        // After restart, a real format transition still bypasses this item.
        format.insert("w",1280);observed.observe("video-params",format);player.pollInterpolation();
        QCOMPARE(player.m_rife->diagnostics()["reason"].toString(),QString("dynamic-format"));
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
        if(!qEnvironmentVariableIsSet("RIFE_TEST_RUNTIME"))QSKIP("requires the explicit private runtime and cached engine fixture");
        QTemporaryDir root;QVERIFY(root.isValid());
        Paths::setConfigDir(root.path());Paths::setCacheDir(root.filePath("cache"));
        ProfileManager::Get().setActiveProfile(ProfileManager::createProfile("RIFE playback test"));
        auto& settings=SettingsComponent::Get();QVERIFY(settings.componentInitialize());
        QVERIFY(InputComponent::Get().componentInitialize());
        settings.setValue(SETTINGS_SECTION_MPV,"configMode","embedded");
        settings.setValue(SETTINGS_SECTION_MPV,"enableUosc",false);
        settings.setValue(SETTINGS_SECTION_MPV,"enableDanmaku",false);
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
        QVERIFY(player.prepareBundledWindowsRife(qEnvironmentVariable("RIFE_TEST_RUNTIME"),
            qEnvironmentVariable("RIFE_TEST_PLAYER_CACHE")));
        QTRY_VERIFY_WITH_TIMEOUT(!ready.isEmpty(),75000);
        QVERIFY2(ready.first()[0].toBool(),qPrintable(ready.first()[1].toString()));
        QVERIFY(!player.selectWindowsRifeModel("missing-model",60));
        QVERIFY(!player.selectWindowsRifeModel("rife-4.25-lite",23));
        QVERIFY(player.selectWindowsRifeModel("rife-4.25-lite",75));
        QVERIFY(MpvConfigManager::prepare());
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
        QCOMPARE(playback()["factor"].toDouble(),2.5);
        const auto activeFilters=controller->getProperty("vf");
        const auto activeClock=controller->getProperty("video-sync");
        for(const QString& profile:{QStringLiteral("tigerest-aggressive-test"),
            QStringLiteral("tigerest-default"),QStringLiteral("tigerest-default")}) {
            const auto frames=playback()["generatedFrames"].toULongLong();
            QVERIFY(!controller->command(QStringList{"change-list","glsl-shaders","clr",""}).canConvert<ErrorReturn>());
            QVERIFY(!controller->command(QStringList{"apply-profile",profile}).canConvert<ErrorReturn>());
            QCOMPARE(controller->getProperty("vf"),activeFilters);
            QCOMPARE(controller->getProperty("video-sync"),activeClock);
            QTRY_VERIFY_WITH_TIMEOUT(playback()["generatedFrames"].toULongLong()>frames,5000);
            QCOMPARE(playback()["state"].toInt(),2);
        }
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
    // The previous media was also paused. Wait for the asynchronous replacement
    // to reach its requested position rather than accepting the old pause flag.
    QTRY_VERIFY_WITH_TIMEOUT(player.getPosition()>=2500,5000);
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
        QVERIFY(controller->getProperty("pause").toBool());
        // Recovery reload is asynchronous even though the old entry was paused.
        QTRY_VERIFY_WITH_TIMEOUT(player.getPosition()>=2500,5000);
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
