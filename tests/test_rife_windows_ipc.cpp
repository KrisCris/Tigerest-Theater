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
        auto& settings=SettingsComponent::Get();
        settings.setValue(SETTINGS_SECTION_MPV,"configMode","embedded");
        settings.setValue(SETTINGS_SECTION_MPV,"enableUosc",false);
        settings.setValue(SETTINGS_SECTION_MPV,"enableDanmaku",false);
        settings.setValue(SETTINGS_SECTION_OTHER,"other_conf",QString());
        settings.setValue(SETTINGS_SECTION_VIDEO,"aiRife",false);
        QVERIFY(MpvConfigManager::prepare());
        write(QDir(MpvConfigManager::activeConfigDir()).filePath("user-overrides.conf"),{});
    }
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
    void preservesUserOwnership_data(){
        QTest::addColumn<QByteArray>("content");QTest::addColumn<bool>("other");
        for(bool other:{false,true}){
            QTest::newRow(other?"options-endpoint":"overrides-endpoint")<<QByteArray("input-ipc-server=my-owned-pipe\n")<<other;
            QTest::newRow(other?"options-include":"overrides-include")<<QByteArray("  include = custom.conf\n")<<other;
        }
    }
    void preservesUserOwnership(){
        QFETCH(QByteArray,content);QFETCH(bool,other);
        const auto overrides=QDir(MpvConfigManager::activeConfigDir()).filePath("user-overrides.conf");
        if(other)SettingsComponent::Get().setValue(SETTINGS_SECTION_OTHER,"other_conf",QString::fromUtf8(content));
        else write(overrides,content);
        SettingsComponent::Get().setValue(SETTINGS_SECTION_VIDEO,"aiRife",true);
        QVERIFY(MpvConfigManager::prepare());QVERIFY(!MpvConfigManager::ownsDefaultSvpIpc());
        if(other)QCOMPARE(SettingsComponent::Get().value(SETTINGS_SECTION_OTHER,"other_conf").toString().toUtf8(),content);
        else QCOMPARE(read(overrides),content);
    }
    void leavesSystemConfigUntouched(){
        const auto system=root.filePath("system-mpv");QVERIFY(QDir().mkpath(system));
        const auto path=QDir(system).filePath("mpv.conf");
        const QByteArray content="input-ipc-server=system-owner\n";write(path,content);
        auto& settings=SettingsComponent::Get();
        settings.setValue(SETTINGS_SECTION_MPV,"systemConfigDir",system);
        settings.setValue(SETTINGS_SECTION_MPV,"configMode","system");
        settings.setValue(SETTINGS_SECTION_VIDEO,"aiRife",true);
        QVERIFY(MpvConfigManager::prepare());QVERIFY(MpvConfigManager::usingSystemConfig());
        QCOMPARE(MpvConfigManager::activeConfigDir(),QFileInfo(system).canonicalFilePath());
        QVERIFY(!MpvConfigManager::ownsDefaultSvpIpc());QCOMPARE(read(path),content);
    }
    void actualMpvResolvesUserInclude_data(){
        QTest::addColumn<bool>("enabled");
        QTest::newRow("rife-off")<<false;QTest::newRow("rife-on")<<true;
    }
    void actualMpvResolvesUserInclude(){
        QFETCH(bool,enabled);
        const auto config=ProfileManager::activeProfile().dataDir("mpv");
        const auto endpoint="tigerest-rife-test-"+QUuid::createUuid().toString(QUuid::Id128);
        write(QDir(config).filePath("user-overrides.conf"),"include=~~/user-extra.conf\n");
        write(QDir(config).filePath("user-extra.conf"),"input-ipc-server="+endpoint.toUtf8()+"\n");
        SettingsComponent::Get().setValue(SETTINGS_SECTION_VIDEO,"aiRife",enabled);
        QVERIFY(MpvConfigManager::prepare());QVERIFY(!MpvConfigManager::ownsDefaultSvpIpc());
        auto* handle=mpv_create();QVERIFY(handle);
        const auto cleanup=qScopeGuard([&]{mpv_terminate_destroy(handle);});
        QCOMPARE(mpv_set_option_string(handle,"config","yes"),0);
        QCOMPARE(mpv_set_option_string(handle,"config-dir",config.toUtf8().constData()),0);
        QCOMPARE(mpv_set_option_string(handle,"vo","null"),0);
        QCOMPARE(mpv_set_option_string(handle,"ao","null"),0);
        QCOMPARE(mpv_set_option_string(handle,"load-scripts","no"),0);
        QCOMPARE(mpv_initialize(handle),0);
        auto* parsed=mpv_get_property_string(handle,"input-ipc-server");QVERIFY(parsed);
        const auto release=qScopeGuard([&]{mpv_free(parsed);});
        QCOMPARE(QString::fromUtf8(parsed),endpoint);
    }
};
QTEST_MAIN(WindowsRifeIpc)
#include "test_rife_windows_ipc.moc"
