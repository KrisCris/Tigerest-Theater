#include <QtTest/QtTest>
#include <QTemporaryDir>
#include <QScopeGuard>
#include <MpvController>
#include "player/PlayerComponent.h"
#include "shared/Paths.h"
#include "settings/SettingsComponent.h"
#include "settings/SettingsSection.h"
#include <condition_variable>
#include <mutex>
#include <chrono>

class TestAudioDeviceDispatch : public QObject {
  Q_OBJECT
private slots:
  void refreshDoesNotWaitForBusyCore();
};

void TestAudioDeviceDispatch::refreshDoesNotWaitForBusyCore()
{
  QTemporaryDir config;
  QVERIFY(config.isValid());
  Paths::setConfigDir(config.path());Paths::setCacheDir(config.filePath("cache"));
  qputenv("TIGEREST_MPV_CONFIG_DIR",config.path().toUtf8());
  auto* audio=new SettingsSection("audio",PLATFORM_ANY,-1,&SettingsComponent::Get());
  audio->registerSetting(new SettingsValue("device","disconnected-test-device"));
  SettingsComponent::Get().registerSection(audio);
  auto* artwork=new SettingsSection("albumart",PLATFORM_ANY,-1,&SettingsComponent::Get());
  artwork->registerSetting(new SettingsValue("cacheSize",10));
  SettingsComponent::Get().registerSection(artwork);
  QObject owner;
  auto* controller=new MpvController(&owner);
  controller->init();
  PlayerComponent player;
  player.setMpvController(controller);
  controller->setProperty("audio-device","null");
  auto* blocker=mpv_create_client(controller->mpv(),"audio-test-blocker");
  QVERIFY(blocker);
  struct Gate {
    std::mutex mutex;
    std::condition_variable changed;
    bool armed=false,entered=false,released=false;
  } gate;
  const auto cleanup=qScopeGuard([&]{
    {std::lock_guard<std::mutex> lock(gate.mutex);gate.released=true;gate.changed.notify_all();}
    mpv_set_wakeup_callback(blocker,nullptr,nullptr);
    mpv_destroy(blocker);
    mpv_set_wakeup_callback(controller->mpv(),nullptr,nullptr);
    mpv_terminate_destroy(controller->mpv());
  });
  mpv_set_wakeup_callback(blocker,[](void* data){
    auto& g=*static_cast<Gate*>(data);
    std::unique_lock<std::mutex> lock(g.mutex);
    if(!g.armed)return;
    g.entered=true;g.changed.notify_all();
    // Simulate the core waiting on a native window while the main thread
    // handles an audio-device timer. Bound the wait so RED cannot hang CI.
    g.changed.wait_for(lock,std::chrono::milliseconds(750),[&]{return g.released;});
    g.armed=false;
  },&gate);
  while(mpv_wait_event(blocker,0)->event_id!=MPV_EVENT_NONE){}
  {std::lock_guard<std::mutex> lock(gate.mutex);gate.armed=true;}
  const char* command[]={"script-message-to",mpv_client_name(blocker),"hold",nullptr};
  QVERIFY(mpv_command_async(controller->mpv(),77,command)>=0);
  {
    std::unique_lock<std::mutex> lock(gate.mutex);
    QVERIFY(gate.changed.wait_for(lock,std::chrono::seconds(2),[&]{return gate.entered;}));
  }
  QElapsedTimer elapsed;elapsed.start();
  QVERIFY(QMetaObject::invokeMethod(&player,"updateAudioDevice",Qt::DirectConnection));
  const auto duration=elapsed.elapsed();
  {std::lock_guard<std::mutex> lock(gate.mutex);gate.released=true;gate.changed.notify_all();}
  QVERIFY2(duration<100,qPrintable(QString("Audio refresh blocked main thread for %1 ms").arg(duration)));
  QTRY_COMPARE(controller->getProperty("audio-device").toString(),QString("auto"));
}
QTEST_GUILESS_MAIN(TestAudioDeviceDispatch)
#include "test_audio_device_dispatch.moc"
