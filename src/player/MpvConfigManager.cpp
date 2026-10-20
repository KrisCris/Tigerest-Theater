#include "MpvConfigManager.h"

#include "core/ProfileManager.h"
#include "settings/SettingsComponent.h"
#include "settings/SettingsSection.h"

#include <QDir>
#include <QDirIterator>
#include <QFile>
#include <QFileInfo>
#include <QLocale>
#include <QLocalSocket>
#include <QSaveFile>
#include <QStandardPaths>
#include <QTextStream>
#include <QDebug>
#include <QUrl>
#include <QVersionNumber>
#include <QRegularExpression>
#include <QCoreApplication>
#include <QJsonDocument>
#include <QJsonObject>
#include <algorithm>

namespace
{
QString g_activeConfigDir;
bool g_usingSystemConfig = false;
bool g_ownsDefaultSvpIpc = false;

bool copyResourceTree(const QString& sourceRoot, const QString& targetRoot)
{
  QDirIterator it(sourceRoot, QDir::Files, QDirIterator::Subdirectories);
  bool ok = true;
  while (it.hasNext())
  {
    const QString sourcePath = it.next();
    QString relativePath = sourcePath.mid(sourceRoot.length());
    while (relativePath.startsWith('/'))
      relativePath.remove(0, 1);

    const QString targetPath = QDir(targetRoot).filePath(relativePath);
    if (!QDir().mkpath(QFileInfo(targetPath).absolutePath()))
    {
      qWarning() << "Unable to create MPV bundle directory for" << targetPath;
      ok = false;
      continue;
    }

    QFile source(sourcePath);
    if (!source.open(QIODevice::ReadOnly))
    {
      qWarning() << "Unable to read bundled MPV resource" << sourcePath;
      ok = false;
      continue;
    }

    const QByteArray data = source.readAll();
    QFile existing(targetPath);
    if (existing.open(QIODevice::ReadOnly) && existing.readAll() == data)
      continue;

    QSaveFile target(targetPath);
    const bool saved = target.open(QIODevice::WriteOnly) &&
                        target.write(data) == data.size() &&
                        target.commit();
    if (!saved)
    {
      // Windows can reject QSaveFile's atomic rename when antivirus or a
      // previously loaded Lua script briefly holds the managed destination.
      // These files are generated from immutable Qt resources, so a direct
      // truncate/write fallback is safe and lets upgrades repair themselves.
      QFile fallback(targetPath);
      const bool fallbackSaved = fallback.open(QIODevice::WriteOnly | QIODevice::Truncate) &&
                                 fallback.write(data) == data.size();
      fallback.close();
      if (!fallbackSaved)
      {
        qWarning() << "Unable to deploy bundled MPV resource" << targetPath
                   << fallback.errorString();
        ok = false;
      }
    }
  }
  return ok;
}

bool writeEmbeddedConfig(const QString& configDir)
{
  QFile input(":/mpv/mpv.conf.in");
  if (!input.open(QIODevice::ReadOnly | QIODevice::Text))
  {
    qCritical() << "Bundled MPV configuration template is missing";
    return false;
  }

  QString config = QString::fromUtf8(input.readAll());
  const QString preset = SettingsComponent::Get().value(SETTINGS_SECTION_MPV, "shaderPreset").toString();
  config.replace("@TIGEREST_PROFILE@", MpvConfigManager::profileName(preset));
#if defined(Q_OS_WIN) || defined(Q_OS_MAC)
  QFile overrides(QDir(configDir).filePath("user-overrides.conf"));
  const QString explicitOptions=(overrides.open(QIODevice::ReadOnly)?QString::fromUtf8(overrides.readAll()):QString())+"\n"+
      SettingsComponent::Get().value(SETTINGS_SECTION_OTHER,"other_conf").toString();
  // Includes may select an IPC endpoint indirectly; only the generated
  // default belongs to us, and user-owned discovery must remain untouched.
  g_ownsDefaultSvpIpc=!explicitOptions.contains(QRegularExpression(
      QStringLiteral("(^|\\n)\\s*(input-ipc-server|include)\\s*=")));
  const bool rife=SettingsComponent::Get().value(SETTINGS_SECTION_VIDEO,"aiRife").toBool();
#endif
#ifdef Q_OS_WIN
  // Suppress managed SVP discovery when RIFE owns interpolation. Explicit
  // endpoints in user-overrides.conf/other_conf still apply afterwards.
  config.replace("@TIGEREST_IPC_SERVER@", rife?QString():QStringLiteral("input-ipc-server=mpvpipe"));
#elif defined(Q_OS_MAC)
  // SVP's standard macOS endpoint. Never unlink another running player's
  // socket; a user-overrides.conf endpoint can still override this default.
  const QString endpoint = QStringLiteral("/tmp/mpvsocket");
  QLocalSocket existing;
  existing.connectToServer(endpoint);
  const bool occupied = existing.waitForConnected(100);
  const bool ordinaryFile = QFileInfo(endpoint).isFile() || QFileInfo(endpoint).isDir();
  if (occupied || ordinaryFile)
    qWarning() << "SVP IPC endpoint already in use; leaving it untouched:" << endpoint;
  config.replace("@TIGEREST_IPC_SERVER@", occupied || ordinaryFile || rife
      ? QString() : QStringLiteral("input-ipc-server=/tmp/mpvsocket"));
#else
  // "mpvpipe" is a Windows named-pipe convention. On Unix-like platforms the
  // same value would become a relative filesystem socket, so leave it disabled.
  config.replace("@TIGEREST_IPC_SERVER@", QString());
#endif

  QStringList scripts;
  if (SettingsComponent::Get().value(SETTINGS_SECTION_MPV, "enableUosc").toBool())
  {
    scripts << "# 加载 UOSC，接管播放时的控制栏、菜单、音轨与全屏界面。";
    scripts << "script=~~/plugins/uosc.lua";
    scripts << "# 将 UOSC 码率选择交回 Emby Web，保留进度、音轨、字幕与播放会话。";
    scripts << "script=~~/plugins/emby_quality.lua";
    scripts << "# 加载大河三档画质菜单，并在每次切换后核验实际 shader 数量。";
    scripts << "script=~~/plugins/profile_menu.lua";
  }
  if (SettingsComponent::Get().value(SETTINGS_SECTION_MPV, "enableDanmaku").toBool())
  {
    scripts << "# 加载 UOSC 弹幕搜索、匹配、显示和开关状态记忆插件。";
    scripts << "script=~~/plugins/uosc_danmaku.lua";
  }
  config.replace("@TIGEREST_SCRIPTS@", scripts.join('\n'));

  const QString path = QDir(configDir).filePath("mpv.conf");
  QSaveFile output(path);
  const QByteArray data = config.toUtf8();
  if (!output.open(QIODevice::WriteOnly | QIODevice::Text) ||
      output.write(data) != data.size() || !output.commit())
  {
    qCritical() << "Unable to write embedded MPV configuration" << path;
    return false;
  }

  const QString overridesPath = QDir(configDir).filePath("user-overrides.conf");
  if (!QFile::exists(overridesPath))
  {
    QSaveFile overrides(overridesPath);
    if (overrides.open(QIODevice::WriteOnly | QIODevice::Text))
    {
      overrides.write("# 大河影院用户自定义覆盖：可按 mpv.conf 语法逐行添加；本文件升级时不会被覆盖。\n");
      overrides.commit();
    }
  }
  return true;
}

QStringList safeMacScriptPaths(const QString& bundleDir)
{
  QStringList scripts;
#if defined(Q_OS_MAC)
  const QString pluginRoot = QDir(bundleDir).filePath(QStringLiteral("plugins"));
  if (SettingsComponent::Get().value(SETTINGS_SECTION_MPV, "enableUosc").toBool())
  {
    scripts << QDir(pluginRoot).filePath(QStringLiteral("uosc.lua"));
    scripts << QDir(pluginRoot).filePath(QStringLiteral("emby_quality.lua"));
    scripts << QDir(pluginRoot).filePath(QStringLiteral("profile_menu.lua"));
  }
  if (SettingsComponent::Get().value(SETTINGS_SECTION_MPV, "enableDanmaku").toBool())
    scripts << QDir(pluginRoot).filePath(QStringLiteral("uosc_danmaku.lua"));
#else
  Q_UNUSED(bundleDir)
#endif
  return scripts;
}

bool writeSystemCompanionConfig(const QString& bundleDir, QString& companionPath)
{
  QFile input(QStringLiteral(":/mpv/mpv.conf.in"));
  if (!input.open(QIODevice::ReadOnly | QIODevice::Text))
  {
    qCritical() << "Bundled MPV profile template is missing";
    return false;
  }

  const QString templateText = QString::fromUtf8(input.readAll());
  const qsizetype profileStart = templateText.indexOf(QStringLiteral("[tigerest-quality-base]"));
  if (profileStart < 0)
  {
    qCritical() << "Bundled MPV profile template has no Tigerest profiles";
    return false;
  }

  const QString normalizedBundle = QDir::fromNativeSeparators(bundleDir);
  QStringList outputLines;
  outputLines << QStringLiteral("# Generated by Tigerest Theater; user mpv.conf remains authoritative.");
#if defined(Q_OS_MAC)
  // The controller applies script isolation before mpv initialization. Keep a
  // visible marker in the generated companion for diagnostics and support.
  outputLines << QStringLiteral("# macOS host safety: keep user rendering options, isolate executable scripts.");
  // macOS system mode loads the bundled, quit-safe danmaku script from the
  // managed resource tree while keeping the user's mpv.conf authoritative.
  // Pass the app settings as startup script options so mp.options can see the
  // same persistent style without writing into the user's config directory.
  if (auto* section = SettingsComponent::Get().getSection(SETTINGS_SECTION_DANMAKU))
  {
    const QStringList danmakuOptions = MpvConfigManager::danmakuStyleMpvOptionsText(
        section->allValues()).split('\n', Qt::SkipEmptyParts);
    outputLines.append(danmakuOptions);
  }
#endif
  const QStringList profileLines = templateText.mid(profileStart).split('\n');
  for (QString line : profileLines)
  {
    const QString trimmed = line.trimmed();
    // user-overrides.conf belongs only to the embedded managed config. The
    // system companion must define Tigerest profiles without touching the
    // user's own global config or include chain.
    if (trimmed == QStringLiteral("[default]"))
      break;
    const QString shaderPrefix = QStringLiteral("glsl-shader=~~/");
    if (trimmed.startsWith(shaderPrefix))
    {
      const QString relative = trimmed.mid(shaderPrefix.size());
      line = QStringLiteral("glsl-shader=\"%1/%2\"").arg(normalizedBundle, relative);
    }
    outputLines << line;
  }

  companionPath = QDir(bundleDir).filePath(QStringLiteral("tigerest-system-profiles.conf"));
  QSaveFile output(companionPath);
  const QByteArray data = outputLines.join('\n').toUtf8();
  if (!output.open(QIODevice::WriteOnly | QIODevice::Text) ||
      output.write(data) != data.size() || !output.commit())
  {
    qCritical() << "Unable to write MPV companion profiles" << companionPath;
    return false;
  }
  return true;
}
}

bool MpvConfigManager::ownsDefaultSvpIpc()
{
  const QString options=SettingsComponent::Get().value(SETTINGS_SECTION_OTHER,"other_conf").toString();
  return !g_usingSystemConfig&&g_ownsDefaultSvpIpc&&!options.contains(QRegularExpression(
      QStringLiteral("(^|\\n)\\s*(input-ipc-server|include)\\s*=")));
}

QString MpvConfigManager::danmakuApiServer(const QString& serverUrl, const QString& connectionMode)
{
  const QUrl server(serverUrl);
  const bool dedicatedLan = connectionMode != "custom" &&
    server.host() == "192.168.5.150" && server.port() == 8095 &&
    (server.scheme() == "http" || server.scheme() == "https");
  return dedicatedLan ? QStringLiteral("http://192.168.5.150:18443")
                      : QStringLiteral("http://nas.tigerest.top:18443");
}

QString MpvConfigManager::profileName(const QString& preset)
{
  if (preset == "liveaction") return "tigerest-liveaction";
  if (preset == "aggressive" || preset == "anime4k")
    return "tigerest-aggressive-test";
  // Map every retired preset to the new user-confirmed default. This keeps
  // upgrades from older settings files valid after removing the old profiles.
  return "tigerest-default";
}

QString MpvConfigManager::danmakuStyleConfigText(const QVariantMap& values)
{
  const auto number = [&values](const QString& key, double fallback) {
    bool ok = false;
    const double value = values.value(key, fallback).toDouble(&ok);
    return QLocale::c().toString(ok ? value : fallback, 'g', 12);
  };

  QStringList lines;
  lines << QStringLiteral("bold=%1").arg(values.value(QStringLiteral("bold"), true).toBool()
                                              ? QStringLiteral("yes")
                                              : QStringLiteral("no"));
  lines << QStringLiteral("fontsize=%1").arg(number(QStringLiteral("fontsize"), 50));
  lines << QStringLiteral("outline=%1").arg(number(QStringLiteral("outline"), 1.0));
  lines << QStringLiteral("shadow=%1").arg(number(QStringLiteral("shadow"), 0));
  lines << QStringLiteral("scrolltime=%1").arg(number(QStringLiteral("scrolltime"), 15));
  lines << QStringLiteral("opacity=%1").arg(number(QStringLiteral("opacity"), 0.7));
  lines << QStringLiteral("displayarea=%1").arg(number(QStringLiteral("displayarea"), 0.2));
  return lines.join('\n') + '\n';
}

QString MpvConfigManager::danmakuStyleMpvOptionsText(const QVariantMap& values)
{
  QStringList output;
  const QStringList options = danmakuStyleConfigText(values).split('\n', Qt::SkipEmptyParts);
  for (const QString& option : options)
    output << QStringLiteral("script-opt=uosc_danmaku-%1").arg(option);
  return output.join('\n') + '\n';
}

bool MpvConfigManager::writeDanmakuStyleConfig(const QString& configDir,
                                                const QVariantMap& values,
                                                QString* errorMessage)
{
  const QString scriptOptsDir = QDir(configDir).filePath(QStringLiteral("script-opts"));
  if (!QDir().mkpath(scriptOptsDir))
  {
    if (errorMessage)
      *errorMessage = QStringLiteral("Unable to create %1").arg(scriptOptsDir);
    return false;
  }

  const QString path = QDir(scriptOptsDir).filePath(QStringLiteral("uosc_danmaku.conf"));
  QSaveFile output(path);
  const QByteArray data = danmakuStyleConfigText(values).toUtf8();
  if (!output.open(QIODevice::WriteOnly | QIODevice::Text) ||
      output.write(data) != data.size() || !output.commit())
  {
    if (errorMessage)
      *errorMessage = QStringLiteral("Unable to write %1: %2").arg(path, output.errorString());
    return false;
  }
  return true;
}

QString MpvConfigManager::detectSystemConfigDir(const QString& configuredPath)
{
  if (!configuredPath.trimmed().isEmpty())
    return QDir::cleanPath(QDir::fromNativeSeparators(configuredPath.trimmed()));

#ifdef Q_OS_WIN
  const QString appData = qEnvironmentVariable("APPDATA");
  if (!appData.isEmpty())
    return QDir(appData).filePath("mpv");
#elif defined(Q_OS_MAC)
  const QString home = QStandardPaths::writableLocation(QStandardPaths::HomeLocation);
  const QString unixStyle = QDir(home).filePath(".config/mpv");
  const QString macStyle = QDir(home).filePath("Library/Application Support/mpv");
  if (QDir(unixStyle).exists()) return unixStyle;
  if (QDir(macStyle).exists()) return macStyle;
  return unixStyle;
#else
  return QDir(QStandardPaths::writableLocation(QStandardPaths::ConfigLocation)).filePath("mpv");
#endif
  return QString();
}

void MpvConfigManager::configureVapourSynth(const QStringList& installationRoots)
{
  // Finder launches do not inherit shell exports. SVP's Homebrew setup
  // installs this optional runtime, but recent mpv loads it via dlopen.
  // Respect explicit overrides and leave ordinary playback independent of it.
  if (qEnvironmentVariableIsSet("VSSCRIPT_PATH"))
    return;

  for (const QString& root : installationRoots)
  {
    QStringList candidates;
    const QDir pythonLib(QDir(root).filePath(QStringLiteral("libexec/lib")));
    QStringList versions = pythonLib.entryList({QStringLiteral("python3.*")}, QDir::Dirs);
    std::sort(versions.begin(), versions.end(), [](const QString& a, const QString& b) {
      return QVersionNumber::fromString(a.mid(6)) > QVersionNumber::fromString(b.mid(6));
    });
    for (const QString& version : versions)
      candidates << pythonLib.filePath(version + QStringLiteral("/site-packages/vapoursynth/libvsscript.dylib"));
    candidates << QDir(root).filePath(QStringLiteral("lib/libvsscript.dylib"))
               << QDir(root).filePath(QStringLiteral("lib/libvapoursynth-script.dylib"));

    for (const QString& candidate : candidates)
    {
      const QFileInfo library(candidate);
      if (!library.isFile())
        continue;
      // VSScript's Python configuration is keyed by the resolved library path.
      const QString path = library.canonicalFilePath();
      qputenv("VSSCRIPT_PATH", path.toUtf8());
      qInfo() << "VapourSynth runtime:" << path;
      return;
    }
  }
}

bool MpvConfigManager::configureBundledVapourSynth(const QString& executableDirectory,
                                                  const QString& registrationDirectory,bool preferBundled)
{
  const QDir binaryDir(executableDirectory);
  QFile manifest(binaryDir.filePath("../Resources/vapoursynth-runtime.json"));
  if(!manifest.open(QIODevice::ReadOnly))return false;
  const auto values=QJsonDocument::fromJson(manifest.readAll()).object();
  const QString contents=QFileInfo(binaryDir.filePath("..")).canonicalFilePath()+"/";
  const auto resolve=[&](const QString& key){
    const QString relative=values.value(key).toString();
    if(relative.isEmpty()||QDir::isAbsolutePath(relative))return QString();
    const QString path=QFileInfo(binaryDir.filePath(relative)).canonicalFilePath();
    return path.startsWith(contents)?path:QString();
  };
  const auto library=resolve("library"),home=resolve("pythonHome"),packages=resolve("pythonPath");
  if(!QFileInfo(library).isFile()||!QDir(home).exists()||!QDir(packages).exists()||
     !QFileInfo(binaryDir.filePath("vapoursynth")).isExecutable()||
     !QFileInfo(binaryDir.filePath("tigerest-python")).isExecutable())return false;
  // Preserve an explicit external runtime for SVP. When built-in RIFE is
  // selected, its native plugin needs the matching runtime shipped in this app.
  if(!preferBundled&&qEnvironmentVariableIsSet("VSSCRIPT_PATH")&&
      QFileInfo(qEnvironmentVariable("VSSCRIPT_PATH")).canonicalFilePath()!=library)return false;
  if(!QDir().mkpath(registrationDirectory))return false;
  qputenv("VSSCRIPT_PATH",library.toUtf8());
  qputenv("PYTHONHOME",home.toUtf8());qputenv("PYTHONPATH",packages.toUtf8());
  qputenv("PYTHONNOUSERSITE","1");qputenv("PYTHONDONTWRITEBYTECODE","1");
  // VSScript 79 keys registration by the resolved library path and can rebuild
  // it after relocation. Keep its writes outside both the app and user config.
  qputenv("XDG_CONFIG_HOME",QFileInfo(registrationDirectory).absoluteFilePath().toUtf8());
  auto search=qEnvironmentVariable("PATH").split(QDir::listSeparator(),Qt::SkipEmptyParts);
  search.removeAll(binaryDir.absolutePath());search.prepend(binaryDir.absolutePath());
  qputenv("PATH",search.join(QDir::listSeparator()).toUtf8());
  return true;
}

void MpvConfigManager::configureBundledVulkan(const QString& executableDirectory)
{
  // Vulkan otherwise enumerates both the bundled ICD and Homebrew's copy.
  // Honor a deliberate override, but keep ordinary installations self-contained.
  if (!qEnvironmentVariableIsEmpty("VK_DRIVER_FILES") ||
      !qEnvironmentVariableIsEmpty("VK_ICD_FILENAMES"))
    return;
  const QFileInfo manifest(QDir(executableDirectory).filePath(
      "../Resources/vulkan/icd.d/MoltenVK_icd.json"));
  if (manifest.isFile())
    qputenv("VK_DRIVER_FILES", manifest.canonicalFilePath().toUtf8());
}

bool MpvConfigManager::prepare()
{
#if defined(Q_OS_MAC)
  const bool preferBundledRife=SettingsComponent::Get().value(SETTINGS_SECTION_VIDEO,"aiRife").toBool()&&
      SettingsComponent::Get().value(SETTINGS_SECTION_MPV,"configMode").toString()!="system";
  configureBundledVulkan(QCoreApplication::applicationDirPath());
  if(!configureBundledVapourSynth(QCoreApplication::applicationDirPath(),
      ProfileManager::activeProfile().dataDir("rife-runtime"),preferBundledRife)) {
#if defined(Q_PROCESSOR_ARM_64)
  configureVapourSynth({QStringLiteral("/opt/homebrew/opt/vapoursynth")});
#else
  configureVapourSynth({QStringLiteral("/usr/local/opt/vapoursynth")});
#endif
  }
#endif
  auto& settings = SettingsComponent::Get();
  // The controller applies this selection after parsing either config mode.
  qputenv("TIGEREST_MPV_CONSOLE",
          settings.value(SETTINGS_SECTION_MPV, "enableConsole").toBool() ? "yes" : "no");
  QString mode = settings.value(SETTINGS_SECTION_MPV, "configMode").toString();

  // Existing 2.0.x profiles stored the old sans-serif default explicitly,
  // which would otherwise override the requested Segoe UI value at runtime.
  // Migrate only that former default once; preserve any genuinely custom font.
  if (!settings.value(SETTINGS_SECTION_SUBTITLES, "referenceMpvDefaultsMigrated").toBool())
  {
    const QString font = settings.value(SETTINGS_SECTION_SUBTITLES, "font").toString();
    if (font.isEmpty() || font == QStringLiteral("sans-serif"))
      settings.setValue(SETTINGS_SECTION_SUBTITLES, "font", QStringLiteral("Segoe UI"));
    settings.setValue(SETTINGS_SECTION_SUBTITLES, "referenceMpvDefaultsMigrated", true);
  }

  const QString legacyPreset = settings.value(SETTINGS_SECTION_MPV, "shaderPreset").toString();
  if (legacyPreset != QStringLiteral("default") &&
      legacyPreset != QStringLiteral("liveaction") &&
      legacyPreset != QStringLiteral("aggressive"))
  {
    // Keep the one intentional Anime4K choice when upgrading; every other
    // retired profile now resolves to the user-confirmed Anime AA default.
    const QString migratedPreset = legacyPreset == QStringLiteral("anime4k")
        ? QStringLiteral("aggressive")
        : QStringLiteral("default");
    settings.setValue(SETTINGS_SECTION_MPV, "shaderPreset", migratedPreset);
    qInfo() << "Migrated retired MPV preset to" << migratedPreset;
  }
  const QString configured = settings.value(SETTINGS_SECTION_MPV, "systemConfigDir").toString();
  const QString detected = detectSystemConfigDir(configured);
  const bool systemConfigExists = QFile::exists(QDir(detected).filePath("mpv.conf"));
  const QString bundleDir = ProfileManager::activeProfile().dataDir("mpv");

  // The managed tree is also deployed in system-config mode. It supplies
  // Tigerest-only profiles and shader assets without modifying the user's
  // mpv.conf, scripts or shader directory. On macOS, the companion additionally
  // disables automatic user-script execution and loads quit-safe bundled scripts.
  if (!QDir().mkpath(bundleDir) || !copyResourceTree(":/mpv", bundleDir))
  {
    qCritical() << "Failed to prepare Tigerest MPV resources";
    return false;
  }

  auto* danmakuSection = settings.getSection(SETTINGS_SECTION_DANMAKU);
  QString danmakuConfigError;
  if (!writeDanmakuStyleConfig(bundleDir,
                               danmakuSection ? danmakuSection->allValues() : QVariantMap(),
                               &danmakuConfigError))
  {
    qCritical() << "Failed to prepare persistent danmaku style configuration:"
                << danmakuConfigError;
    return false;
  }

  // Retain the old migration marker so existing settings files remain valid,
  // but no longer promote embedded mode to automatic system-config detection.
  if (!settings.value(SETTINGS_SECTION_MPV, "configModeMigrated").toBool())
  {
    settings.setValue(SETTINGS_SECTION_MPV, "configModeMigrated", true);
  }

  // 2.0.11 and earlier defaulted to auto, so upgrading profiles would keep
  // loading a machine-wide mpv tree even after the application default changed.
  // Migrate only that former default once; preserve an explicit system choice.
  if (!settings.value(SETTINGS_SECTION_MPV, "embeddedConfigDefaultMigrated").toBool())
  {
    if (mode == QStringLiteral("auto"))
    {
      mode = QStringLiteral("embedded");
      settings.setValue(SETTINGS_SECTION_MPV, "configMode", mode);
      qInfo() << "Migrated MPV mode to the bundled default configuration";
    }
    settings.setValue(SETTINGS_SECTION_MPV, "embeddedConfigDefaultMigrated", true);
  }

  if ((mode == "auto" || mode == "system") && systemConfigExists)
  {
    QString companionPath;
    if (!writeSystemCompanionConfig(bundleDir, companionPath))
      return false;
    g_activeConfigDir = detected;
    g_usingSystemConfig = true;
    qInfo() << "Using system MPV configuration:" << g_activeConfigDir;
    qputenv("TIGEREST_MPV_CONFIG_DIR", g_activeConfigDir.toUtf8());
    qputenv("TIGEREST_MPV_INCLUDE", companionPath.toUtf8());
#if defined(Q_OS_MAC)
    const QStringList safeScripts = safeMacScriptPaths(bundleDir);
    qputenv("TIGEREST_MPV_SAFE_SCRIPTS",
            safeScripts.join(QDir::listSeparator()).toUtf8());
#else
    qunsetenv("TIGEREST_MPV_SAFE_SCRIPTS");
#endif
    return true;
  }

  if (mode == "system")
    qWarning() << "System MPV configuration not found, falling back to embedded mode:" << detected;
  else if (mode == "auto")
    qInfo() << "No user mpv.conf found; automatic mode is using the embedded bundle:" << detected;

  g_usingSystemConfig = false;
  g_activeConfigDir = bundleDir;
  qunsetenv("TIGEREST_MPV_INCLUDE");
  qunsetenv("TIGEREST_MPV_SAFE_SCRIPTS");
  if (!writeEmbeddedConfig(g_activeConfigDir))
  {
    qCritical() << "Failed to prepare embedded MPV configuration";
    return false;
  }

  qInfo() << "Using embedded MPV configuration:" << g_activeConfigDir;
  qputenv("TIGEREST_MPV_CONFIG_DIR", g_activeConfigDir.toUtf8());
  return true;
}

QString MpvConfigManager::activeConfigDir()
{
  return g_activeConfigDir;
}

bool MpvConfigManager::usingSystemConfig()
{
  return g_usingSystemConfig;
}
