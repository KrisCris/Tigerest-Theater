#include <QtTest/QtTest>
#include <QFile>
#include <QTemporaryDir>
#include <QUuid>
#include <mpv/client.h>
#include "Paths.h"
#include "core/ProfileManager.h"
#include "player/MpvConfigManager.h"
#include "settings/SettingsComponent.h"

class WindowsRifeIpc : public QObject {
    Q_OBJECT
private:
    QTemporaryDir root;
    void write(const QString& path,const QByteArray& content){
        QFile file(path);QVERIFY(file.open(QIODevice::WriteOnly|QIODevice::Truncate));
        QCOMPARE(file.write(content),content.size());
    }
    QByteArray read(const QString& path){
        QFile file(path);if(!file.open(QIODevice::ReadOnly))return {};
        return file.readAll();
    }
    QByteArray configuration(){return read(QDir(MpvConfigManager::activeConfigDir()).filePath("mpv.conf")).replace("\r\n","\n");}
private slots:
    void initTestCase(){
        QVERIFY(root.isValid());Paths::setConfigDir(root.path());Paths::setCacheDir(root.filePath("cache"));
        ProfileManager::Get().setActiveProfile(ProfileManager::createProfile("RIFE IPC test"));
        QVERIFY(SettingsComponent::Get().componentInitialize());
    }
    void init(){
        qunsetenv("TIGEREST_MPV_TEST_OPTIONS");
        auto& settings=SettingsComponent::Get();
        settings.setValue(SETTINGS_SECTION_MPV,"enableUosc",false);
        settings.setValue(SETTINGS_SECTION_MPV,"enableDanmaku",false);
        settings.setValue(SETTINGS_SECTION_VIDEO,"aiRife",false);
        QVERIFY(MpvConfigManager::prepare());
    }
    void cleanup(){qunsetenv("TIGEREST_MPV_TEST_OPTIONS");}
    void rifeSuppressesManagedPipe(){
        SettingsComponent::Get().setValue(SETTINGS_SECTION_VIDEO,"aiRife",true);
        QVERIFY(MpvConfigManager::prepare());
        QVERIFY(!configuration().contains("\ninput-ipc-server=mpvpipe\n"));
        QVERIFY(MpvConfigManager::ownsDefaultSvpIpc());
    }
    void disabledKeepsSvpDiscovery(){
        QVERIFY(MpvConfigManager::prepare());
        QVERIFY(configuration().contains("\ninput-ipc-server=mpvpipe\n"));
        QVERIFY(MpvConfigManager::ownsDefaultSvpIpc());
    }
    // The endpoint is locked to the client: one written into the user area
    // by another program is commented out at the next start.
    void userAreaEndpointsAreCommentedOut_data(){
        QTest::addColumn<QByteArray>("content");
        QTest::newRow("endpoint")<<QByteArray("input-ipc-server=my-owned-pipe");
        QTest::newRow("include")<<QByteArray("include = custom.conf");
    }
    void userAreaEndpointsAreCommentedOut(){
        QFETCH(QByteArray,content);
        const auto path=QDir(MpvConfigManager::activeConfigDir()).filePath("mpv.conf");
        write(path,read(path)+content+"\n");
        SettingsComponent::Get().setValue(SETTINGS_SECTION_VIDEO,"aiRife",true);
        QVERIFY(MpvConfigManager::prepare());
        QVERIFY(MpvConfigManager::ownsDefaultSvpIpc());
        QVERIFY(configuration().contains("#[已忽略:软件管理] "+content+"\n"));
    }
    // The pre-2.9.4 system mode is gone: the client keeps its own root and
    // never touches the machine-wide mpv.conf.
    void systemModeIsRetired(){
        const auto system=root.filePath("system-mpv");QVERIFY(QDir().mkpath(system));
        const auto path=QDir(system).filePath("mpv.conf");
        const QByteArray content="input-ipc-server=system-owner\n";write(path,content);
        auto& settings=SettingsComponent::Get();
        settings.setValue(SETTINGS_SECTION_MPV,"systemConfigDir",system);
        settings.setValue(SETTINGS_SECTION_MPV,"configMode","system");
        QVERIFY(MpvConfigManager::prepare());
        QCOMPARE(MpvConfigManager::activeConfigDir(),ProfileManager::activeProfile().dataDir("mpv"));
        QVERIFY(MpvConfigManager::ownsDefaultSvpIpc());QCOMPARE(read(path),content);
    }
    // Automated tests inject a private endpoint through the test hook; real
    // mpv parses it from the managed tail.
    void actualMpvUsesTestEndpoint_data(){
        QTest::addColumn<bool>("enabled");
        QTest::newRow("rife-off")<<false;QTest::newRow("rife-on")<<true;
    }
    void actualMpvUsesTestEndpoint(){
        QFETCH(bool,enabled);
        const auto config=ProfileManager::activeProfile().dataDir("mpv");
        const auto endpoint="tigerest-rife-test-"+QUuid::createUuid().toString(QUuid::Id128);
        qputenv("TIGEREST_MPV_TEST_OPTIONS",("input-ipc-server="+endpoint).toUtf8());
        SettingsComponent::Get().setValue(SETTINGS_SECTION_VIDEO,"aiRife",enabled);
        QVERIFY(MpvConfigManager::prepare());QVERIFY(!MpvConfigManager::ownsDefaultSvpIpc());
        auto* handle=mpv_create();QVERIFY(handle);
        const auto cleanup=qScopeGuard([&]{mpv_terminate_destroy(handle);});
        QCOMPARE(mpv_set_option_string(handle,"config","yes"),0);
        QCOMPARE(mpv_set_option_string(handle,"config-dir",config.toUtf8().constData()),0);
        QCOMPARE(mpv_set_option_string(handle,"vo","null"),0);
        QCOMPARE(mpv_set_option_string(handle,"ao","null"),0);
        QCOMPARE(mpv_initialize(handle),0);
        auto* parsed=mpv_get_property_string(handle,"input-ipc-server");QVERIFY(parsed);
        const auto release=qScopeGuard([&]{mpv_free(parsed);});
        QCOMPARE(QString::fromUtf8(parsed),endpoint);
    }
};
QTEST_MAIN(WindowsRifeIpc)
#include "test_rife_windows_ipc.moc"
