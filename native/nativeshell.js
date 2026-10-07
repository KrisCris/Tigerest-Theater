const features = [
    "filedownload",
    "displaylanguage",
    "htmlaudioautoplay",
    "htmlvideoautoplay",
    "externallinks",
    "clientsettings",
    "multiserver",
    "exitmenu",
    "remotecontrol",
    "fullscreenchange",
    "filedownload",
    "remotevideo",
    "displaymode",
    "screensaver",
    "fileinput"
].filter(feature => !window.tigerestAndroidApi || !['filedownload', 'fullscreenchange'].includes(feature));

const getPlugins = () => {
    const basePlugins = [
        'inputPlugin',
        ...(window.tigerestAndroidApi ? [] : ['updatePlugin'])
    ];

    const mpvEnabled = jmpInfo.settings?.main?.enableMPV !== false;
    if (mpvEnabled) {
        return [
            'mpvVideoPlayer',
            'mpvAudioPlayer',
            ...basePlugins
        ];
    }

    return basePlugins;
};

const plugins = getPlugins();

// Plugins are bundled, return class directly
for (const plugin of plugins) {
    window[plugin] = () => {
        return window["_" + plugin];
    };
}

window.NativeShell = {
    openUrl(url, target) {
        window.api.system.openExternalUrl(url);
    },

    downloadFile(downloadInfo) {
        return window.api.system.startDownload(downloadInfo);
    },

    openClientSettings() {
        openTigerestSettings('main');
    },

    openMpvSettings() {
        openTigerestSettings('mpv');
    },

    openOfflineLibrary() {
        window.tigerestOpenOfflineLibrary();
    },

    getPlugins() {
        return plugins;
    }
};

function getDeviceProfile() {
    const CodecProfiles = [];

    if (jmpInfo.settings.video.force_transcode_dovi) {
        CodecProfiles.push({
            'Type': 'Video',
            'Conditions': [
                {
                    'Condition': 'NotEquals',
                    'Property': 'VideoRangeType',
                    'Value': 'DOVI'
                }
            ]
        });
    }

    if (jmpInfo.settings.video.force_transcode_hdr) {
        CodecProfiles.push({
            'Type': 'Video',
            'Conditions': [
                {
                    'Condition': 'Equals',
                    'Property': 'VideoRangeType',
                    'Value': 'SDR'
                }
            ]
        });
    }

    if (jmpInfo.settings.video.force_transcode_hi10p) {
        CodecProfiles.push({
            'Type': 'Video',
            'Conditions': [
                {
                    'Condition': 'LessThanEqual',
                    'Property': 'VideoBitDepth',
                    'Value': '8',
                }
            ]
        });
    }

    if (jmpInfo.settings.video.force_transcode_hevc) {
        CodecProfiles.push({
            'Type': 'Video',
            'Codec': 'hevc',
            'Conditions': [
                {
                    'Condition': 'Equals',
                    'Property': 'Width',
                    'Value': '0',
                }
            ],
        });
        CodecProfiles.push({
            'Type': 'Video',
            'Codec': 'h265',
            'Conditions': [
                {
                    'Condition': 'Equals',
                    'Property': 'Width',
                    'Value': '0',
                }
            ],
        });
    }

    if (jmpInfo.settings.video.force_transcode_av1) {
        CodecProfiles.push({
            'Type': 'Video',
            'Codec': 'av1',
            'Conditions': [
                {
                    'Condition': 'Equals',
                    'Property': 'Width',
                    'Value': '0',
                }
            ],
        });
    }

    if (jmpInfo.settings.video.force_transcode_4k) {
        CodecProfiles.push({
            'Type': 'Video',
            'Conditions': [
                {
                    'Condition': 'LessThanEqual',
                    'Property': 'Width',
                    'Value': '1920',
                },
                {
                    'Condition': 'LessThanEqual',
                    'Property': 'Height',
                    'Value': '1080',
                }
            ]
        });
    }

    const DirectPlayProfiles = [{ 'Type': 'Audio' }, { 'Type': 'Photo' }];

    if (!jmpInfo.settings.video.always_force_transcode) {
        DirectPlayProfiles.push({ 'Type': 'Video' });
    }

    return {
        'Name': 'Tigerest Theater',
        'MaxStaticBitrate': 1000000000,
        'MusicStreamingTranscodingBitrate': 1280000,
        'TimelineOffsetSeconds': 5,
        'TranscodingProfiles': [
            { 'Type': 'Audio' },
            {
                'Container': 'ts',
                'Type': 'Video',
                'Protocol': 'hls',
                'AudioCodec': 'aac,mp3,ac3,opus,vorbis',
                'VideoCodec': jmpInfo.settings.video.allow_transcode_to_hevc
                    ? (
                        jmpInfo.settings.video.prefer_transcode_to_h265
                            ? 'h265,hevc,h264,mpeg4,mpeg2video'
                            : 'h264,h265,hevc,mpeg4,mpeg2video'
                    )
                    : 'h264,mpeg4,mpeg2video',
                'MaxAudioChannels': jmpInfo.settings.audio.channels === "2.0" ? '2' : '6'
            },
            { 'Container': 'jpeg', 'Type': 'Photo' }
        ],
        DirectPlayProfiles,
        'ResponseProfiles': [],
        'ContainerProfiles': [],
        CodecProfiles,
        'SubtitleProfiles': [
            { 'Format': 'srt', 'Method': 'External' },
            { 'Format': 'srt', 'Method': 'Embed' },
            { 'Format': 'ass', 'Method': 'External' },
            { 'Format': 'ass', 'Method': 'Embed' },
            { 'Format': 'sub', 'Method': 'Embed' },
            { 'Format': 'sub', 'Method': 'External' },
            { 'Format': 'ssa', 'Method': 'Embed' },
            { 'Format': 'ssa', 'Method': 'External' },
            { 'Format': 'smi', 'Method': 'Embed' },
            { 'Format': 'smi', 'Method': 'External' },
            { 'Format': 'pgssub', 'Method': 'Embed' },
            { 'Format': 'dvdsub', 'Method': 'Embed' },
            { 'Format': 'dvbsub', 'Method': 'Embed' },
            { 'Format': 'pgs', 'Method': 'Embed' }
        ]
    };
}

async function createApi() {
    // Can't append script until document exists
    if (document.readyState === 'loading') {
        await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, {once: true}));
    }

    if (window.tigerestAndroidApi) return window.tigerestAndroidApi;

    const channel = await new Promise((resolve) => {
        /*global QWebChannel */
        new QWebChannel(window.qt.webChannelTransport, resolve);
    });
    return channel.objects;
}

const sectionsFromStorage = window.sessionStorage.getItem('sections');
if (sectionsFromStorage) {
    jmpInfo.sections = JSON.parse(sectionsFromStorage);
}

let rawSettings = {};
Object.assign(rawSettings, jmpInfo.settings);
const settingsFromStorage = window.sessionStorage.getItem('settings');
if (settingsFromStorage) {
    rawSettings = JSON.parse(settingsFromStorage);
    Object.assign(jmpInfo.settings, rawSettings);
}

const settingsDescriptionsFromStorage = window.sessionStorage.getItem('settingsDescriptions');
if (settingsDescriptionsFromStorage) {
    jmpInfo.settingsDescriptions = JSON.parse(settingsDescriptionsFromStorage);
}

jmpInfo.settingsDescriptionsUpdate = [];
jmpInfo.settingsUpdate = [];
window.apiPromise = createApi();
window.initCompleted = new Promise(async (resolve) => {
    window.api = await window.apiPromise;
    const settingUpdate = (section, key) => (
        (data) => {
            rawSettings[section][key] = data;
            window.sessionStorage.setItem("settings", JSON.stringify(rawSettings));
            return window.api.settings.setValue(section, key, data);
        }
    );
    const setSetting = (section, key) => {
        Object.defineProperty(jmpInfo.settings[section], key, {
            set: settingUpdate(section, key),
            get: () => rawSettings[section][key]
        });
    };
    for (const settingGroup of Object.keys(rawSettings)) {
        jmpInfo.settings[settingGroup] = {};
        for (const setting of Object.keys(rawSettings[settingGroup])) {
            setSetting(settingGroup, setting, jmpInfo.settings[settingGroup][setting]);
        }
    }
    window.api.settings.sectionValueUpdate.connect(
        (section, data) => {
            Object.assign(rawSettings[section], data);
            for (const callback of jmpInfo.settingsUpdate) {
                try {
                    callback(section, data);
                } catch (e) {
                    console.error("Update handler failed:", e);
                }
            }

            // Settings will be outdated if page reloads, so save them to session storage
            window.sessionStorage.setItem("settings", JSON.stringify(rawSettings));
        }
    );
    window.api.settings.groupUpdate.connect(
        (section, data) => {
            jmpInfo.settingsDescriptions[section] = data.settings;
            for (const callback of jmpInfo.settingsDescriptionsUpdate) {
                try {
                    callback(section, data);
                } catch (e) {
                    console.error("Description update handler failed:", e);
                }
            }

            // Settings will be outdated if page reloads, so save them to session storage
            window.sessionStorage.setItem("settingsDescriptions", JSON.stringify(jmpInfo.settingsDescriptions));
        }
    );

    // Sync cursor visibility with jellyfin-web's mouse idle state
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.attributeName === 'class') {
                const isIdle = document.body.classList.contains('mouseIdle');
                window.api.window.setCursorVisibility(!isIdle);
            }
        }
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    resolve();
});

window.NativeShell.AppHost = {
    init() {
        return Promise.resolve({
            deviceName: jmpInfo.deviceName,
            appName: "Tigerest Theater",
            appVersion: jmpInfo.version
        });
    },
    getDefaultLayout() {
        return jmpInfo.mode;
    },
    supports(command) {
        return features.includes(command.toLowerCase());
    },
    getDeviceProfile,
    getSyncProfile: getDeviceProfile,
    appName() {
        return "Tigerest Theater";
    },
    appVersion() {
        return jmpInfo.version;
    },
    deviceName() {
        return jmpInfo.deviceName;
    },
    exit() {
        window.api.system.exit();
    }
};

async function showLegacySettingsModal() {
    await initCompleted;

    const tooltipCSS = `
        .tooltip {
            position: relative;
            display: inline-block;
            margin-left: 0.5rem;
            font-size: 18px;
            vertical-align: sub;
        }

        .tooltip .tooltip-text {
            visibility: hidden;
            width: max-content;
            max-width: 40em;
            background-color: black;
            color: white;
            text-align: left;
            position: absolute;
            z-index: 1;
            border-radius: 6px;
            padding: 5px;
            top: -4px;
            left: 25px;
            border: solid 1px grey;
            font-size: 12px;
        }

        .tooltip:hover .tooltip-text {
            visibility: visible;
        }`;

    var style = document.createElement('style')
    style.innerText = tooltipCSS
    document.head.appendChild(style)

    const modalContainer = document.createElement("div");
    modalContainer.className = "dialogContainer";
    modalContainer.style.backgroundColor = "rgba(0,0,0,0.5)";
    modalContainer.addEventListener("click", e => {
        if (e.target == modalContainer) {
            modalContainer.remove();
        }
    });
    document.body.appendChild(modalContainer);

    const modalContainer2 = document.createElement("div");
    modalContainer2.className = "focuscontainer dialog dialog-fixedSize dialog-small formDialog opened";
    modalContainer.appendChild(modalContainer2);

    const modalHeader = document.createElement("div");
    modalHeader.className = "formDialogHeader";
    modalContainer2.appendChild(modalHeader);

    const title = document.createElement("h3");
    title.className = "formDialogHeaderTitle";
    title.textContent = "Client Settings";
    modalHeader.appendChild(title);

    const modalContents = document.createElement("div");
    modalContents.className = "formDialogContent smoothScrollY";
    modalContents.style.paddingTop = "2em";
    modalContents.style.marginBottom = "6.2em";
    modalContainer2.appendChild(modalContents);

    const settingUpdateHandlers = {};
    for (const sectionOrder of jmpInfo.sections.sort((a, b) => a.order - b.order)) {
        const section = sectionOrder.key;
        const group = document.createElement("fieldset");
        group.className = "editItemMetadataForm editMetadataForm dialog-content-centered";
        group.style.border = 0;
        group.style.outline = 0;
        modalContents.appendChild(group);

        const createSection = async (clear) => {
            if (clear) {
                group.innerHTML = "";
            }

            const values = jmpInfo.settings[section];
            const settings = jmpInfo.settingsDescriptions[section];

            const legend = document.createElement("legend");
            const legendHeader = document.createElement("h2");
            legendHeader.textContent = section;
            legendHeader.style.textTransform = "capitalize";
            legend.appendChild(legendHeader);
            if (section == "other") {
                const legendSubHeader = document.createElement("h4");
                legendSubHeader.textContent = "Use this section to input custom MPV configuration. These will override the above settings.";
                legend.appendChild(legendSubHeader);
            }
            group.appendChild(legend);

            for (const setting of settings) {
                const label = document.createElement("label");
                label.className = "inputContainer";
                label.style.marginBottom = "1.8em";
                label.style.display = "block";

                let helpElement;
                if (setting.help) {
                    helpElement = document.createElement("div");
                    helpElement.className = "tooltip";
                    const helpIcon = document.createElement("span");
                    helpIcon.style.fontSize = "18px"
                    helpIcon.className = "material-icons help_outline";
                    helpElement.appendChild(helpIcon);
                    const tooltipElement = document.createElement("span");
                    tooltipElement.className = "tooltip-text";
                    tooltipElement.innerText = setting.help;
                    helpElement.appendChild(tooltipElement);
                }

                if (setting.options) {
                    const safeValues = {};
                    const control = document.createElement("select");
                    control.className = "emby-select-withcolor emby-select";
                    for (const option of setting.options) {
                        safeValues[String(option.value)] = option.value;
                        const opt = document.createElement("option");
                        opt.value = option.value;
                        opt.selected = option.value == values[setting.key];
                        let optionName = option.title;
                        const swTest = `${section}.${setting.key}.`;
                        const swTest2 = `${section}.`;
                        if (optionName.startsWith(swTest)) {
                            optionName = optionName.substring(swTest.length);
                        } else if (optionName.startsWith(swTest2)) {
                            optionName = optionName.substring(swTest2.length);
                        }
                        opt.appendChild(document.createTextNode(optionName));
                        control.appendChild(opt);
                    }
                    control.addEventListener("change", async (e) => {
                        jmpInfo.settings[section][setting.key] = safeValues[e.target.value];
                    });
                    const labelText = document.createElement('label');
                    labelText.className = "inputLabel";
                    labelText.textContent = (setting.displayName ? setting.displayName : setting.key) + ": ";
                    label.appendChild(labelText);
                    if (helpElement) label.appendChild(helpElement);
                    label.appendChild(control);
                } else if (setting.inputType === "textarea") {
                    const control = document.createElement("textarea");
                    control.className = "emby-select-withcolor emby-select";
                    control.style = "resize: none;"
                    control.value = values[setting.key];
                    control.rows = 5;
                    control.addEventListener("change", e => {
                        jmpInfo.settings[section][setting.key] = e.target.value;
                    });
                    const labelText = document.createElement('label');
                    labelText.className = "inputLabel";
                    labelText.textContent = (setting.displayName ? setting.displayName : setting.key) + ": ";
                    label.appendChild(labelText);
                    if (helpElement) label.appendChild(helpElement);
                    label.appendChild(control);
                } else {
                    const control = document.createElement("input");
                    control.type = "checkbox";
                    control.checked = values[setting.key];
                    control.addEventListener("change", e => {
                        jmpInfo.settings[section][setting.key] = e.target.checked;
                    });
                    label.appendChild(control);
                    label.appendChild(document.createTextNode(" " + (setting.displayName ? setting.displayName : setting.key)));
                    if (helpElement) label.appendChild(helpElement);
                }

                group.appendChild(label);
            }
        };
        settingUpdateHandlers[section] = () => createSection(true);
        createSection();
    }

    const onSectionUpdate = (section) => {
        if (section in settingUpdateHandlers) {
            settingUpdateHandlers[section]();
        }
    };
    jmpInfo.settingsDescriptionsUpdate.push(onSectionUpdate);
    jmpInfo.settingsUpdate.push(onSectionUpdate);

    if (jmpInfo.settings.main.userWebClient) {
        const group = document.createElement("fieldset");
        group.className = "editItemMetadataForm editMetadataForm dialog-content-centered";
        group.style.border = 0;
        group.style.outline = 0;
        modalContents.appendChild(group);
        const legend = document.createElement("legend");
        const legendHeader = document.createElement("h2");
        legendHeader.textContent = "已保存的 Emby 服务器";
        legend.appendChild(legendHeader);
        const legendSubHeader = document.createElement("h4");
        legendSubHeader.textContent = (
            "客户端会优先连接已保存的服务器。重置后，下次启动将先尝试内网地址，" +
            "再尝试公网地址；此操作不会从当前 Emby 账号退出。"
        );
        legend.appendChild(legendSubHeader);
        group.appendChild(legend);

        const resetSavedServer = document.createElement("button");
        resetSavedServer.className = "raised button-cancel block btnCancel emby-button";
        resetSavedServer.textContent = "重置服务器地址"
        resetSavedServer.style.marginLeft = "auto";
        resetSavedServer.style.marginRight = "auto";
        resetSavedServer.style.maxWidth = "50%";
        resetSavedServer.addEventListener("click", async () => {
            window.jmpInfo.settings.main.userWebClient = '';
            window.jmpInfo.settings.main.serverConnectionMode = '';
            window.location.href = jmpInfo.scriptPath + "/find-webclient.html";
        });
        group.appendChild(resetSavedServer);
    }

    const offlineGroup = document.createElement("fieldset");
    offlineGroup.className = "editItemMetadataForm editMetadataForm dialog-content-centered";
    offlineGroup.style.border = 0;
    offlineGroup.style.outline = 0;
    const offlineTitle = document.createElement("h2");
    offlineTitle.textContent = "离线媒体";
    offlineGroup.appendChild(offlineTitle);
    const offlineButton = document.createElement("button");
    offlineButton.className = "raised block emby-button";
    offlineButton.textContent = "打开下载与离线媒体管理";
    offlineButton.addEventListener("click", () => {
        modalContainer.remove();
        window.tigerestOpenOfflineLibrary();
    });
    offlineGroup.appendChild(offlineButton);
    modalContents.appendChild(offlineGroup);

    const closeContainer = document.createElement("div");
    closeContainer.className = "formDialogFooter";
    modalContents.appendChild(closeContainer);

    const close = document.createElement("button");
    close.className = "raised button-cancel block btnCancel formDialogFooterItem emby-button";
    close.textContent = "关闭"
    close.addEventListener("click", () => {
        modalContainer.remove();
    });
    closeContainer.appendChild(close);
}

function createRifeExtensionPanel({element, player, settings, save, notify}) {
    if (typeof player.rifeExtensionStatus !== 'function') return null;
    const node = element('div', 'tgs-callout');
    node.id = 'tigerest-rife-extension';
    node.appendChild(element('strong', '', 'NVIDIA RIFE 扩展'));
    const summary = element('div', 'tgs-help');
    const progress = element('div', 'tgs-help');
    const runtime = element('div', 'tgs-help');
    node.append(summary, progress, runtime);
    const presets = {
        balanced: ['均衡 · 4.25 / 约 60 fps', 'rife-4.25', 60],
        quality: ['画质对比 · heavy / 约 60 fps', 'rife-4.25-heavy', 60],
        high: ['高帧率实验 · lite / 约 240 fps', 'rife-4.25-lite', 240],
        '4k': ['4K 补帧实验 · lite / 约 120 fps', 'rife-4.25-lite', 120],
    };
    const preset = element('select', 'tgs-control');
    preset.setAttribute?.('aria-label', 'RIFE 快速方案');
    for (const [id, title] of [['custom', '自定义模型与目标'], ...Object.entries(presets).map(([id, value]) => [id, value[0]])]) {
        const option = element('option', '', title); option.value = id; preset.appendChild(option);
    }
    const refreshPreferences = () => {
        preset.value = Object.keys(presets).find(id => presets[id][1] === settings.aiRifeModel && presets[id][2] === settings.aiRifeTarget) || 'custom';
    };
    preset.addEventListener('change', () => {
        const selected = presets[preset.value];
        if (!selected) return;
        save('aiRifeModel', selected[1]); save('aiRifeTarget', selected[2]);
        refreshPreferences();
    });
    node.appendChild(element('div', 'tgs-help', '快速方案（下方仍可分别选模型和帧率）：'));
    node.appendChild(preset);
    node.appendChild(element('div', 'tgs-help', '目标帧率由你决定；持续丢帧只提示，不自动关闭补帧或降低目标。建议先试 lite＋两倍帧率，再逐步提高。首次准备引擎时暂停播放并显示进度，完成后自动开始；已有引擎会直接复用。补帧保留你选择的音画同步模式。'));
    const actions = element('div', 'tgs-actions');
    const download = element('button', 'tgs-action', '下载扩展');
    const offline = element('button', 'tgs-action', '导入离线包');
    const cancel = element('button', 'tgs-action', '取消操作');
    const remove = element('button', 'tgs-action', '移除扩展');
    actions.append(download, offline, cancel, remove); node.appendChild(actions);
    let current = {state: 'checking', busy: true}, disposed = false, pending = false, revision = 0;
    const size = bytes => `${(Number(bytes || 0) / 1e9).toFixed(2)} GB`;
    const render = status => {
        if (disposed) return;
        current = status;
        const pack = status.packages?.[0];
        const states = {notInstalled: '尚未安装', checking: '正在核验', downloading: '正在下载', installing: '正在安装', removing: '正在移除', ready: '已安装', restartRequired: '请完全退出并重启客户端', cancelled: '操作已取消', error: '操作失败'};
        const packageKind = pack?.gpuArchitecture && pack.gpuArchitecture !== 'full' ? '当前显卡适配包' : '完整兼容包';
        summary.textContent = pack
            ? `${states[status.state] || status.state} · 推荐下载扩展 ${pack.version} · ${packageKind}：下载 ${size(pack.downloadSize)}，展开 ${size(pack.unpackedSize)}。运行库由各配置共用，引擎缓存按当前配置保存。`
            : `${states[status.state] || status.state} · 当前版本尚未提供可安装的扩展包。`;
        const done = Number(status.doneBytes || 0), total = Number(status.totalBytes || 0);
        progress.textContent = status.error ? String(status.error) : status.busy && total > 0
            ? `${Math.min(100, Math.floor(done * 100 / total))}% · ${size(done)} / ${size(total)}` : '';
        const r = status.runtime || {};
        runtime.textContent = status.restartRequired ? '安装或移除将在重启后生效。'
            : r.enginePreparing ? '正在准备引擎，播放已暂停；准备完成后自动开始。首次准备可能需要数分钟。'
            : r.runtimePreparing ? '正在检查 NVIDIA 运行库。'
            : r.activated ? r.playback?.status || '运行库已就绪；模型与目标帧率在下次播放生效。'
            : status.state === 'ready' ? r.error || '运行库尚未就绪；基础播放仍可使用。' : '';
        const busy = pending || Boolean(status.busy);
        download.disabled = busy || !pack?.downloadAvailable;
        offline.disabled = busy || !pack;
        cancel.disabled = !status.busy;
        remove.disabled = busy || !status.installedVersion || Boolean(status.removalPending);
        download.title = pack?.downloadAvailable ? '仅在点击后下载' : '在线附件尚未发布，可导入本版本的离线包';
    };
    const refresh = async () => {
        const token = ++revision;
        try { const status = await player.rifeExtensionStatus(); if (token === revision) render(status); }
        catch (error) { if (!disposed && token === revision) { progress.textContent = `读取补帧状态失败：${error.message || error}`; } }
    };
    const changed = status => { ++revision; render(status); };
    const request = async action => {
        if (pending || current.busy || disposed) return;
        pending = true; render(current);
        try { if (!(await action())) notify('另一个操作正在进行，请稍后重试。'); }
        catch (error) { notify(`补帧扩展操作失败：${error.message || error}`); }
        finally { pending = false; if (!disposed) await refresh(); }
    };
    download.addEventListener('click', () => request(() => player.downloadRifeExtension(current.packages[0].id)));
    offline.addEventListener('click', () => request(() => player.importRifeExtension()));
    cancel.addEventListener('click', () => player.cancelRifeExtensionOperation());
    remove.addEventListener('click', () => request(() => player.removeRifeExtension()));
    player.rifeExtensionStatusChanged?.connect(changed);
    const timer = setInterval(refresh, 1500);
    refreshPreferences(); render(current); refresh();
    return {node, refreshPreferences, dispose() {
        disposed = true; ++revision; clearInterval(timer);
        player.rifeExtensionStatusChanged?.disconnect(changed);
    }};
}

function createRifeTargetControl({element, value, save, notify}) {
    const input = element('input', 'tgs-control');
    input.type = 'number'; input.min = '0'; input.max = '360'; input.step = '1';
    let saved = value;
    input.value = value;
    input.addEventListener('change', () => {
        const raw = String(input.value).trim(), target = Number(raw);
        if (!raw || !Number.isInteger(target) || (target !== 0 && (target < 24 || target > 360))) {
            input.value = saved;
            notify('请输入 24–360 的整数帧率，或输入 0 使用源帧率两倍。');
            return;
        }
        saved = target; save(target);
    });
    input.setSavedValue = newValue => { saved = newValue; input.value = newValue; };
    return input;
}

async function mountTigerestSettings(host = null, initialSection = null, onReturn = null, signal = null) {
    await initCompleted;
    if (signal?.aborted) return;

    let mpvDiagnostics = {};
    try {
        mpvDiagnostics = await window.api.player.mpvDiagnostics();
    } catch (error) {
        console.warn('Unable to read MPV diagnostics', error);
    }

    if (signal?.aborted) return;
    const previous = host ? host.querySelector('#tigerest-settings-inline') : document.getElementById('tigerest-settings-overlay');
    if (previous) return;
    const returnFocus = document.activeElement;
    const priorBodyOverflow = document.body.style.overflow;

    const sectionMeta = {
        main: {
            title: '客户端',
            subtitle: '窗口、启动与系统集成'
        },
        audio: {
            title: '音频',
            subtitle: '输出设备、声道与直通'
        },
        video: {
            title: '视频',
            subtitle: '硬件解码、同步与转码策略'
        },
        subtitles: {
            title: '字幕',
            subtitle: '字体、样式、位置与 ASS 行为'
        },
        mpv: {
            title: 'MPV 画质与插件',
            subtitle: '渲染、HDR、缓存、uosc 与弹幕'
        },
        danmaku: {
            title: '弹幕样式',
            subtitle: '内置 uosc_danmaku 的长期默认外观'
        },
        other: {
            title: '高级',
            subtitle: '直接传入 mpv.conf 选项'
        }
    };
    if (window.tigerestAndroidApi) {
        sectionMeta.main.subtitle = '服务器、窗口与网页浏览';
        sectionMeta.audio.subtitle = '声道与音量均衡';
        sectionMeta.mpv = {title: '播放器', subtitle: '音轨偏好、HDR、缓存与弹幕'};
        sectionMeta.danmaku.subtitle = '字号、描边、速度、透明度与显示范围';
    }
    const restartSettings = new Set([
        'main.enableMPV',
        'mpv.configMode',
        'mpv.renderBackend',
        'mpv.systemConfigDir',
        'mpv.enableUosc',
        'mpv.enableConsole',
        'mpv.enableDanmaku',
        'danmaku.bold',
        'danmaku.fontsize',
        'danmaku.outline',
        'danmaku.shadow',
        'danmaku.scrolltime',
        'danmaku.opacity',
        'danmaku.displayarea'
    ]);
    const embeddedOnlyMpvSettings = new Set([
        'shaderPreset',
        'enableUosc',
        'enableDanmaku',
        'scale',
        'cscale',
        'dscale',
        'interpolation',
        'tscale',
        'deband',
        'debandIterations',
        'debandThreshold',
        'debandRange',
        'debandGrain',
        'sigmoidUpscaling',
        'correctDownscaling',
        'scaleAntiring',
        'cscaleAntiring',
        'targetColorspaceHint',
        'iccProfileAuto',
        'toneMapping',
        'gamutMappingMode',
        'hdrComputePeak',
        'ditherDepth',
        'blendSubtitles',
        'audioLanguage',
        'subtitleLanguage',
        'cachePause',
        'demuxerMaxBackBytes',
        'screenshotFormat',
        'screenshotDirectory'
    ]);

    const css = document.createElement('style');
    css.id = 'tigerest-settings-style';
    css.textContent = `
        #tigerest-settings-overlay {
            position: fixed; inset: 0; z-index: 100000;
            display: flex; background: #141414;
        }
        .tgs-dialog {
            box-sizing: border-box; width: 100%; height: 100%; min-width: 0;
            display: grid; grid-template-rows: auto minmax(0, 1fr) auto;
            color: inherit; background: #141414; color-scheme: dark;
            border: 0; border-radius: 0; overflow: hidden; font: inherit;
        }
        #tigerest-settings-overlay .tgs-dialog { color: #eee; }
        .tgs-header {
            display: flex; align-items: center; gap: 24px; padding: 24px clamp(20px, 4vw, 56px);
            border-bottom: 1px solid rgba(255,255,255,.09);
        }
        .tgs-title { margin: 0; font-size: 26px; line-height: 1.3; font-weight: 500; }
        .tgs-subtitle { margin-top: 8px; color: #aaa; font-size: 13px; line-height: 1.5; }
        .tgs-search {
            box-sizing: border-box; margin-left: auto; width: min(310px, 31vw); min-height: 44px; padding: 10px 12px;
            color: inherit; background: #252525; border: 1px solid #555;
            border-radius: 3px; outline: none; font: inherit; font-size: 14px;
        }
        .tgs-search:focus { border-color: #ffbe38; }
        .tgs-body { min-height: 0; min-width: 0; display: grid; grid-template-columns: 230px minmax(0, 1fr); }
        .tgs-tabs { padding: 24px 0; overflow-y: auto; border-right: 1px solid rgba(255,255,255,.08); }
        .tgs-tab {
            box-sizing: border-box; width: 100%; min-height: 48px; margin: 0; padding: 14px 24px; color: #ccc;
            text-align: left; font: inherit; font-size: 15px; background: transparent; border: 0;
            border-left: 3px solid transparent; border-radius: 0; cursor: pointer;
        }
        .tgs-tab:hover { background: #ffffff08; }
        .tgs-tab.active { color: #ffbe38; border-color: #ffbe38; background: #ffffff07; }
        .tgs-tab small { display: block; margin-top: 5px; color: #999; font-size: 11px; line-height: 1.5; font-weight: 400; }
        .tgs-content { min-width: 0; overflow-y: auto; padding: 30px clamp(20px, 4vw, 56px) 48px; scrollbar-gutter: stable; }
        .tgs-section { display: none; max-width: 760px; margin: 0 auto 32px; }
        .tgs-section.active { display: block; }
        .tgs-section-head { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; margin-bottom: 24px; }
        .tgs-section-head h2 { margin: 0; font-size: 24px; font-weight: 400; }
        .tgs-section-head p { margin: 8px 0 0; color: #aaa; font-size: 14px; line-height: 1.5; }
        .tgs-reset {
            margin-left: auto; min-height: 44px; padding: 8px 12px; color: #ffbe38; font: inherit; font-size: 13px;
            background: transparent; border: 0; border-radius: 3px; cursor: pointer;
        }
        .tgs-callout {
            margin: 0 0 24px; padding: 0 0 0 14px; color: #bbb;
            border: 0; border-left: 2px solid #6d582a; font-size: 13px; line-height: 1.6; overflow-wrap: anywhere;
        }
        .tgs-setting {
            display: grid; grid-template-columns: minmax(0, 1fr); gap: 9px; padding: 0; margin-bottom: 28px;
        }
        .tgs-setting-title { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 15px; font-weight: 400; line-height: 1.5; }
        .tgs-help { margin-top: 0; color: #aaa; font-size: 13px; line-height: 1.6; white-space: pre-line; overflow-wrap: anywhere; }
        .tgs-restart {
            display: inline-block; color: #c7aa68; font-size: 11px; font-weight: 400;
        }
        .tgs-scope {
            display: inline-block; color: #aaa; font-size: 11px; font-weight: 400;
        }
        .tgs-control {
            box-sizing: border-box; width: 100%; min-width: 0; min-height: 44px; padding: 10px 12px;
            color: inherit; background: #252525; border: 1px solid #555; border-radius: 3px; outline: none; font: inherit; font-size: 15px;
        }
        .tgs-control:focus { border-color: #ffbe38; }
        textarea.tgs-control { min-height: 150px; resize: vertical; font-family: Consolas, Menlo, monospace; }
        .tgs-setting-boolean { grid-template-columns: 28px minmax(0, 1fr); column-gap: 12px; }
        .tgs-setting-boolean .tgs-setting-title { grid-column: 2; grid-row: 1; min-height: 32px; cursor: pointer; }
        .tgs-setting-boolean .tgs-switch-wrap { grid-column: 1; grid-row: 1; }
        .tgs-setting-boolean .tgs-help { grid-column: 2; }
        .tgs-switch-wrap { display: flex; align-items: center; }
        .tgs-switch { width: 22px; height: 22px; margin: 0; accent-color: #ffbe38; cursor: pointer; }
        .tgs-switch-state { display: none; }
        .tgs-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 22px; }
        .tgs-action { min-height: 44px; padding: 10px 20px; color: #eee; background: #303030; border: 0; border-radius: 3px; cursor: pointer; font: inherit; font-size: 14px; }
        .tgs-dialog button:focus-visible, .tgs-switch:focus-visible { outline: 2px solid #ffbe38; outline-offset: 2px; }
        .tgs-empty { max-width: 760px; margin: 20px auto; color: #aaa; line-height: 1.6; }
        .tgs-footer {
            display: flex; align-items: center; gap: 14px; padding: 14px clamp(20px, 4vw, 56px);
            border-top: 1px solid rgba(255,255,255,.08);
        }
        .tgs-status { color: #aaa; font-size: 12px; line-height: 1.5; }
        .tgs-close { margin-left: auto; min-width: 96px; min-height: 44px; padding: 10px 18px; color: #171717; background: #ffbe38; border: 0; border-radius: 3px; font: inherit; cursor: pointer; }
        @media (max-width: 760px) {
            .tgs-header { flex-wrap: wrap; gap: 14px; padding: 18px 20px; }
            .tgs-title { font-size: 22px; }
            .tgs-subtitle { font-size: 12px; }
            .tgs-search { width: 100%; margin: 0; font-size: 16px; }
            .tgs-body { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
            .tgs-tabs { display: flex; padding: 0 12px; overflow-x: auto; overflow-y: hidden; border-right: 0; border-bottom: 1px solid rgba(255,255,255,.08); scrollbar-width: thin; }
            .tgs-tab { flex: 0 0 auto; width: auto; padding: 12px 16px; white-space: nowrap; text-align: center; border-left: 0; border-bottom: 2px solid transparent; }
            .tgs-tab small { display: none; }
            .tgs-content { padding: 24px 20px 32px; }
            .tgs-control { font-size: 16px; }
            .tgs-section-head { gap: 8px; }
            .tgs-section-head h2 { font-size: 22px; }
            .tgs-reset { margin-left: 0; padding-left: 0; }
            .tgs-footer { padding: 12px 20px; }
        }
        .tigerest-settings-host { width: 100%; max-width: 1200px; }
        #tigerest-settings-inline .tgs-dialog {
            width: 100%; height: auto; min-height: 520px;
            background: transparent;
        }
        #tigerest-settings-inline .tgs-body { overflow: visible; }
        #tigerest-settings-inline .tgs-content { overflow: visible; min-width: 0; }
        #tigerest-settings-inline .tgs-tabs { align-self: start; position: sticky; top: 100px; }
        #tigerest-settings-inline .tgs-search { min-width: 0; }
        @media (max-width: 760px) {
            #tigerest-settings-inline .tgs-dialog { min-height: 0; }
            #tigerest-settings-inline .tgs-body { grid-template-rows: auto auto; }
            #tigerest-settings-inline .tgs-tabs { position: static; }
            #tigerest-settings-inline .tgs-header { flex-wrap: wrap; }
            #tigerest-settings-inline .tgs-search { width: 100%; }
        }
    `;
    document.head.appendChild(css);

    const element = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    };

    const overlay = element('div');
    overlay.id = host ? 'tigerest-settings-inline' : 'tigerest-settings-overlay';
    const dialog = element('div', 'tgs-dialog');
    dialog.setAttribute('role', host ? 'region' : 'dialog');
    if (!host) dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'tgs-settings-title');
    overlay.appendChild(dialog);

    const header = element('div', 'tgs-header');
    const heading = element('div');
    const headingTitle = element('h2', 'tgs-title', window.tigerestAndroidApi ? '客户端设置' : 'MPV 播放设置');
    headingTitle.id = 'tgs-settings-title';
    heading.appendChild(headingTitle);
    heading.appendChild(element('div', 'tgs-subtitle', '常规配置即时应用；带“需重启”标记的项目在下次启动生效'));
    header.appendChild(heading);
    const search = element('input', 'tgs-search');
    search.type = 'search';
    search.placeholder = '搜索设置，例如 HDR、字幕、缓存…';
    search.setAttribute('aria-label', '搜索客户端设置');
    header.appendChild(search);
    dialog.appendChild(header);

    const body = element('div', 'tgs-body');
    const tabs = element('nav', 'tgs-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', '设置分类');
    const content = element('main', 'tgs-content');
    body.append(tabs, content);
    dialog.appendChild(body);

    const footer = element('div', 'tgs-footer');
    const status = element('div', 'tgs-status', '设置保存在当前客户端配置中，不会包含 Emby 密码或令牌。');
    status.setAttribute('role', 'status');
    const closeButton = element('button', 'tgs-close', host ? '返回设置' : '完成');
    footer.append(status, closeButton);
    dialog.appendChild(footer);

    const orderedSections = [...jmpInfo.sections]
        .sort((a, b) => a.order - b.order)
        .filter(entry => sectionMeta[entry.key] && jmpInfo.settingsDescriptions[entry.key]);
    const tabButtons = new Map();
    const groups = new Map();
    let activeSection = initialSection || sessionStorage.getItem('tigerestSettingsTab') || 'mpv';
    if (!orderedSections.some(entry => entry.key === activeSection)) {
        activeSection = orderedSections[0]?.key || 'main';
    }

    const showSaved = message => {
        status.textContent = message;
        clearTimeout(showSaved.timer);
        showSaved.timer = setTimeout(() => {
            status.textContent = '设置保存在当前客户端配置中，不会包含 Emby 密码或令牌。';
        }, 2200);
    };

    const settingControls = new Map();
    let rifeExtensionPanel = null;
    const saveSetting = (section, key, value) => {
        jmpInfo.settings[section][key] = value;
        if (section === 'video' && key === 'aiRife') updateRifeStatus();
        if (section === 'video' && (key === 'aiRifeModel' || key === 'aiRifeTarget')) {
            const control = settingControls.get(key);
            if (control?.input) control.input.setSavedValue(value);
            else if (control) control.select.value = String(control.options.findIndex(option => option.value == value));
            rifeExtensionPanel?.refreshPreferences();
        }
        showSaved(restartSettings.has(`${section}.${key}`) ? '已保存；此项将在重启后生效。'
            : section === 'video' && key.startsWith('aiRife') ? '已保存；重新打开视频后生效。' : '已保存并应用。');
    };

    let rifeCallout = null;
    const updateRifeStatus = () => {
        if (!rifeCallout) return;
        const enabled = Boolean(jmpInfo.settings.video.aiRife);
        const rife = mpvDiagnostics.rife;
        if (jmpInfo.mpvConfigMode === 'system') {
            rifeCallout.textContent = 'AI 补帧需要使用内置播放配置。';
        } else if (enabled && !rife.runtimeAvailable) {
            rifeCallout.textContent = typeof window.api.player.rifeExtensionStatus === 'function'
                ? 'AI 补帧已开启；请先安装 NVIDIA RIFE 扩展并完全退出、重新启动客户端。运行库检查失败时仍可正常播放原帧。'
                : 'AI 补帧已开启，但内置组件尚未加载。请完全退出并重新启动客户端；若仍不可用，请检查安装包是否完整。';
        } else if (enabled && rife.state === 0) {
            rifeCallout.textContent = 'AI 补帧已开启；重新打开视频后生效。';
        } else if (!enabled && (rife.state === 1 || rife.state === 2)) {
            rifeCallout.textContent = 'AI 补帧设置已关闭；当前视频在重新打开后才会停止补帧。';
        } else {
            rifeCallout.textContent = enabled ? rife.status : 'AI 补帧已关闭。';
        }
    };

    const revealActiveTab = () => {
        tabs.setAttribute('aria-orientation', matchMedia('(max-width: 760px)').matches ? 'horizontal' : 'vertical');
        const selected = tabButtons.get(activeSection);
        if (!selected || tabs.scrollWidth <= tabs.clientWidth) return;
        const buttonBounds = selected.getBoundingClientRect(), tabBounds = tabs.getBoundingClientRect();
        if (buttonBounds.left < tabBounds.left) tabs.scrollLeft += Math.floor(buttonBounds.left - tabBounds.left) - 12;
        else if (buttonBounds.right > tabBounds.right) tabs.scrollLeft += Math.ceil(buttonBounds.right - tabBounds.right) + 12;
    };
    const activate = section => {
        activeSection = section;
        sessionStorage.setItem('tigerestSettingsTab', section);
        for (const [key, button] of tabButtons) {
            button.classList.toggle('active', key === section);
            button.setAttribute('aria-selected', String(key === section));
            button.tabIndex = key === section ? 0 : -1;
        }
        for (const [key, group] of groups) {
            group.classList.toggle('active', key === section);
            group.setAttribute('aria-hidden', String(key !== section));
        }
        content.scrollTop = 0;
        revealActiveTab();
    };

    const makeControl = (section, setting, currentValue) => {
        const key = setting.key;
        if (section === 'video' && key === 'aiRifeTarget') {
            const input = createRifeTargetControl({element, value:currentValue,
                save:value => saveSetting(section, key, value), notify:showSaved});
            settingControls.set(key, {input});
            return input;
        }
        if (setting.options) {
            const select = element('select', 'tgs-control');
            setting.options.forEach((option, index) => {
                const item = element('option', '', option.title.replace(`${section}.${key}.`, '').replace(`${section}.`, ''));
                item.value = String(index);
                item.selected = option.value == currentValue;
                select.appendChild(item);
            });
            select.addEventListener('change', () => {
                saveSetting(section, key, setting.options[Number(select.value)].value);
            });
            if (section === 'video') settingControls.set(key, {select, options: setting.options});
            return select;
        }

        if (setting.inputType === 'textarea') {
            const textarea = element('textarea', 'tgs-control');
            textarea.value = currentValue == null ? '' : currentValue;
            textarea.spellcheck = false;
            textarea.addEventListener('change', () => saveSetting(section, key, textarea.value));
            return textarea;
        }

        if (typeof currentValue === 'boolean') {
            const wrapper = element('div', 'tgs-switch-wrap');
            const state = element('span', 'tgs-switch-state', currentValue ? '开启' : '关闭');
            const checkbox = element('input', 'tgs-switch');
            checkbox.type = 'checkbox';
            checkbox.checked = currentValue;
            checkbox.addEventListener('change', () => {
                state.textContent = checkbox.checked ? '开启' : '关闭';
                saveSetting(section, key, checkbox.checked);
            });
            wrapper.append(state, checkbox);
            return wrapper;
        }

        const input = element('input', 'tgs-control');
        input.type = setting.inputType === 'number' || typeof currentValue === 'number' ? 'number' : 'text';
        input.value = currentValue == null ? '' : currentValue;
        input.addEventListener('change', () => {
            saveSetting(section, key, input.type === 'number' ? Number(input.value) : input.value);
        });
        return input;
    };

    for (const entry of orderedSections) {
        const section = entry.key;
        const meta = sectionMeta[section];
        const tab = element('button', 'tgs-tab');
        tab.type = 'button';
        tab.dataset.sectionTab = section;
        tab.id = `tgs-tab-${section}`;
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-controls', `tgs-section-${section}`);
        tab.append(element('span', '', meta.title), element('small', '', meta.subtitle));
        tab.addEventListener('click', () => {
            search.value = '';
            activate(section);
            applySearch();
        });
        tab.addEventListener('keydown', event => {
            if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const buttons = [...tabButtons.values()], index = buttons.indexOf(tab);
            const target = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
                : (index + (event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1) + buttons.length) % buttons.length;
            buttons[target].click();
            buttons[target].focus({preventScroll: true});
            buttons[target].scrollIntoView({block: 'nearest', inline: 'nearest'});
        });
        tabs.appendChild(tab);
        tabButtons.set(section, tab);

        const group = element('section', 'tgs-section');
        group.dataset.section = section;
        group.id = `tgs-section-${section}`;
        group.setAttribute('role', 'tabpanel');
        group.setAttribute('aria-labelledby', tab.id);
        const groupHead = element('div', 'tgs-section-head');
        const groupTitle = element('div');
        groupTitle.append(element('h2', '', meta.title), element('p', '', meta.subtitle));
        const reset = element('button', 'tgs-reset', '恢复本页默认值');
        reset.type = 'button';
        reset.addEventListener('click', async () => {
            if (!window.confirm(`确定恢复“${meta.title}”的默认设置吗？`)) return;
            reset.disabled = true;
            await window.api.settings.resetToDefault(section);
            if (disposed || signal?.aborted) return;
            showSaved('已恢复默认值。正在刷新设置页…');
            // QWebChannel updates the settings snapshot before rebuilding.
            const sectionToRestore = activeSection;
            cleanup();
            if (!host && returnFocus?.isConnected) returnFocus.focus({preventScroll: true});
            const refreshed = await mountTigerestSettings(host, sectionToRestore, onReturn, resetAbort.signal);
            if (disposed || signal?.aborted) { refreshed?.dispose(); return; }
            replacementMount = refreshed;
        });
        groupHead.append(groupTitle, reset);
        group.appendChild(groupHead);

        if (section === 'video' && mpvDiagnostics.rife) {
            rifeCallout = element('div', 'tgs-callout');
            updateRifeStatus();
            group.appendChild(rifeCallout);
        }
        if (section === 'video') {
            rifeExtensionPanel = createRifeExtensionPanel({element, player: window.api.player,
                settings: jmpInfo.settings.video, save: (key, value) => saveSetting('video', key, value), notify: showSaved});
            if (rifeExtensionPanel) group.appendChild(rifeExtensionPanel.node);
        }
        if (section === 'mpv' && !window.tigerestAndroidApi) {
            const activeMode = jmpInfo.mpvConfigMode === 'system' ? '系统用户配置' : '大河内置配置';
            const activeRoot = jmpInfo.mpvConfigDir || '尚未解析';
            const shaderFiles = Array.isArray(mpvDiagnostics.shaderFiles) ? mpvDiagnostics.shaderFiles : [];
            const shaderNames = shaderFiles
                .slice(0, 4)
                .map(path => String(path).replaceAll('\\', '/').split('/').pop())
                .join('、');
            const profileName = mpvDiagnostics.configuredProfile || '未声明（使用 mpv 默认）';
            const shaderSummary = shaderFiles.length
                ? `${shaderFiles.length} 个：${shaderNames}${shaderFiles.length > 4 ? '…' : ''}`
                : '0 个';
            const rendererName = mpvDiagnostics.renderBackend === 'gpu-next-native'
                ? '原生 GPU-Next 嵌入'
                : 'libmpv Render API 兼容模式';
            const activeVo = mpvDiagnostics.currentVo || mpvDiagnostics.configuredVo || '等待播放';
            const actualScale = [
                `亮度 ${mpvDiagnostics.scale || '未知'}`,
                `色度 ${mpvDiagnostics.cscale || '未知'}`,
                `缩小 ${mpvDiagnostics.dscale || '未知'}`
            ].join(' / ');
            const sourceSize = mpvDiagnostics.sourceWidth && mpvDiagnostics.sourceHeight
                ? `${mpvDiagnostics.sourceWidth}×${mpvDiagnostics.sourceHeight}`
                : '等待播放';
            const outputSize = mpvDiagnostics.outputWidth && mpvDiagnostics.outputHeight
                ? `${mpvDiagnostics.outputWidth}×${mpvDiagnostics.outputHeight}`
                : '等待播放';
            const passSummary = mpvDiagnostics.voPassesAvailable
                ? `可用（Fresh ${mpvDiagnostics.freshPassCount || 0} / Redraw ${mpvDiagnostics.redrawPassCount || 0} 项）`
                : '等待视频开始渲染';
            group.appendChild(element(
                'div',
                'tgs-callout',
                `当前实际使用：${activeMode} · ${activeRoot}。渲染后端：${rendererName}（当前 VO：${activeVo}）；默认配置档：${profileName}；视频 ${sourceSize} → 输出 ${outputSize}；实际缩放：${actualScale}；当前加载着色器：${shaderSummary}；完整帧流水线：${passSummary}。播放中按 Ctrl+J 开关统计总览、按数字 2 查看完整处理页，或按 Ctrl+Shift+J 直接显示完整页。自动模式优先读取你现有的 Windows/macOS 用户 mpv.conf；只有找不到用户配置时才部署内置配置。GPU-Next 模式会把 mpv 子窗口绑定到客户端窗口；兼容模式则锁定 vo=libmpv，防止 profile 另开播放窗口。标记“仅内置”的项可预先编辑，但只在切换为大河内置模式后生效，不会覆盖当前用户配置档与着色器。`
            ));
        } else if (section === 'other') {
            group.appendChild(element(
                'div',
                'tgs-callout',
                '这里接受标准 mpv.conf 的 key=value，每行一项，并在客户端选项之后应用。请不要填写 vo、wid 或 gpu-context；错误参数会记录为无敏感信息的警告。'
            ));
        }

        const values = jmpInfo.settings[section];
        for (const setting of jmpInfo.settingsDescriptions[section]) {
            const row = element('div', 'tgs-setting');
            row.dataset.setting = `${section}.${setting.key}`;
            row.dataset.search = `${meta.title} ${setting.displayName || setting.key} ${setting.key} ${setting.help || ''}`.toLowerCase();
            const labelTitle = element('label', 'tgs-setting-title inputLabel');
            labelTitle.appendChild(element('span', '', setting.displayName || setting.key));
            if (restartSettings.has(`${section}.${setting.key}`)) {
                labelTitle.appendChild(element('span', 'tgs-restart', '需重启'));
            }
            if (section === 'mpv' && embeddedOnlyMpvSettings.has(setting.key)) {
                labelTitle.appendChild(element('span', 'tgs-scope', '仅内置'));
            }
            const control = makeControl(section, setting, values[setting.key]);
            const input = control.matches('input,select,textarea') ? control : control.querySelector('input');
            if (input) {
                input.id = `tgs-input-${section}-${setting.key}`;
                labelTitle.htmlFor = input.id;
                if (input.type === 'checkbox') row.classList.add('tgs-setting-boolean');
            }
            row.append(labelTitle, control);
            if (setting.help) {
                const help = element('div', 'tgs-help fieldDescription', setting.help);
                help.id = `tgs-help-${section}-${setting.key}`;
                input?.setAttribute('aria-describedby', help.id);
                row.appendChild(help);
            }
            group.appendChild(row);
        }

        if (section === 'main') {
            const actions = element('div', 'tgs-actions');
            if (window.TigerestUpdate) {
                const checkUpdate = element('button', 'tgs-action', '检查客户端更新');
                checkUpdate.addEventListener('click', () => window.TigerestUpdate.check().catch(() => {}));
                actions.appendChild(checkUpdate);
            }
            if (jmpInfo.settings.main.userWebClient) {
                const resetServer = element('button', 'tgs-action', '重置已保存的服务器地址');
                resetServer.addEventListener('click', () => {
                    window.jmpInfo.settings.main.userWebClient = '';
                    window.jmpInfo.settings.main.serverConnectionMode = '';
                    window.location.href = jmpInfo.scriptPath + '/find-webclient.html';
                });
                actions.appendChild(resetServer);
            }
            const offline = element('button', 'tgs-action', '打开下载与离线媒体管理');
            offline.addEventListener('click', () => {
                close();
                window.tigerestOpenOfflineLibrary();
            });
            if (!window.tigerestAndroidApi) actions.appendChild(offline);
            group.appendChild(actions);
        }

        content.appendChild(group);
        groups.set(section, group);
    }

    const empty = element('div', 'tgs-empty', '没有找到匹配的设置，请尝试其他关键词。');
    empty.hidden = true;
    empty.setAttribute('role', 'status');
    content.appendChild(empty);
    const applySearch = () => {
        const query = search.value.trim().toLowerCase();
        empty.hidden = true;
        if (!query) {
            activate(activeSection);
            for (const group of groups.values()) {
                for (const row of group.querySelectorAll('.tgs-setting')) row.style.display = '';
            }
            return;
        }
        let matchCount = 0;
        for (const group of groups.values()) {
            let matches = 0;
            for (const row of group.querySelectorAll('.tgs-setting')) {
                const visible = row.dataset.search.includes(query);
                row.style.display = visible ? '' : 'none';
                if (visible) matches += 1;
            }
            group.classList.toggle('active', matches > 0);
            group.setAttribute('aria-hidden', String(matches === 0));
            matchCount += matches;
        }
        empty.hidden = matchCount > 0;
        for (const button of tabButtons.values()) {
            button.classList.remove('active');
            button.setAttribute('aria-selected', 'false');
        }
        status.textContent = `已找到 ${matchCount} 项设置。`;
    };
    search.addEventListener('input', applySearch);

    let replacementMount = null;
    let disposed = false;
    const resetAbort = new AbortController();
    const cleanup = () => {
        clearTimeout(showSaved.timer);
        rifeExtensionPanel?.dispose();
        document.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('resize', revealActiveTab);
        if (!host) document.body.style.overflow = priorBodyOverflow;
        overlay.remove();
        css.remove();
    };
    const close = () => {
        disposed = true;
        resetAbort.abort();
        replacementMount?.dispose();
        signal?.removeEventListener('abort', close);
        cleanup();
        if (!host && returnFocus?.isConnected) returnFocus.focus({preventScroll: true});
    };
    const onKeyDown = event => {
        if (event.key === 'Escape') { event.preventDefault(); close(); }
        if (event.key === 'Tab' && !host) {
            const focusable = [...dialog.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])')]
                .filter(node => node.tabIndex >= 0 && node.getClientRects().length);
            const first = focusable[0], last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
    };
    closeButton.addEventListener('click', () => { close(); if (host) onReturn?.(); });
    if (!host) {
        overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
        document.addEventListener('keydown', onKeyDown);
    }
    (host || document.body).appendChild(overlay);
    window.addEventListener('resize', revealActiveTab);
    if (!host) document.body.style.overflow = 'hidden';
    signal?.addEventListener('abort', close, {once: true});
    if (signal?.aborted) { close(); return; }
    activate(activeSection);
    if (!host) search.focus();
    return {dispose: close, activate};
}

async function openTigerestSettings(section = 'mpv') {
    if (window.Emby?.importModule) {
        try {
            const module = await Emby.importModule('./modules/approuter.js');
            const router = module.default || module;
            const route = router.getRoutes().find(route => route.controller === 'tigerest/settings-view.js');
            if (route) return router.show(route.path + '?section=' + encodeURIComponent(section));
        } catch (error) { console.warn('Unable to open the Emby settings route'); }
    }
    // First-run/server selection pages do not have an Emby router yet.
    return mountTigerestSettings(null, section);
}
window.tigerestMountSettings = mountTigerestSettings;
window.tigerestOpenMpvSettings = openTigerestSettings;

// Emby shelves support touch/trackpad horizontal scrolling, but Chromium
// starts an image drag when a desktop mouse drags an episode card. Convert a
// deliberate horizontal pointer gesture into scrollLeft movement while still
// allowing an ordinary click to select and play an episode.
function installHorizontalShelfDragging() {
    let dragState = null;
    let suppressNextClick = false;

    const findHorizontalScroller = start => {
        let node = start instanceof Element ? start : start?.parentElement;
        while (node && node !== document.body) {
            const style = getComputedStyle(node);
            const looksLikeShelf = /scroll|shelf|itemscontainer/i.test(node.className || '');
            const clipsHorizontally = style.overflowX !== 'visible';
            if (node.scrollWidth > node.clientWidth + 8 && (clipsHorizontally || looksLikeShelf)) {
                return node;
            }
            node = node.parentElement;
        }
        return null;
    };

    document.addEventListener('pointerdown', event => {
        if (event.button !== 0 || event.isPrimary === false) return;
        const scroller = findHorizontalScroller(event.target);
        if (!scroller) return;
        dragState = {
            scroller,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            scrollLeft: scroller.scrollLeft,
            dragging: false
        };
    }, true);

    document.addEventListener('pointermove', event => {
        if (!dragState || dragState.pointerId !== event.pointerId) return;
        const dx = event.clientX - dragState.startX;
        const dy = event.clientY - dragState.startY;
        if (!dragState.dragging) {
            if (Math.abs(dx) < 7 || Math.abs(dx) <= Math.abs(dy)) return;
            dragState.dragging = true;
            dragState.scroller.classList.add('tigerest-shelf-dragging');
        }
        dragState.scroller.scrollLeft = dragState.scrollLeft - dx;
        event.preventDefault();
        event.stopPropagation();
    }, true);

    const finishDrag = event => {
        if (!dragState || dragState.pointerId !== event.pointerId) return;
        suppressNextClick = dragState.dragging;
        dragState.scroller.classList.remove('tigerest-shelf-dragging');
        dragState = null;
    };
    document.addEventListener('pointerup', finishDrag, true);
    document.addEventListener('pointercancel', finishDrag, true);
    document.addEventListener('dragstart', event => {
        if (dragState && findHorizontalScroller(event.target) === dragState.scroller) {
            event.preventDefault();
        }
    }, true);
    document.addEventListener('click', event => {
        if (!suppressNextClick) return;
        suppressNextClick = false;
        event.preventDefault();
        event.stopPropagation();
    }, true);

    const style = document.createElement('style');
    style.textContent = '.tigerest-shelf-dragging{cursor:grabbing!important;scroll-behavior:auto!important}.tigerest-shelf-dragging *{cursor:grabbing!important;user-select:none!important}';
    const mountStyle = () => {
        if (document.head && !style.isConnected) document.head.appendChild(style);
        else if (!document.head) setTimeout(mountStyle, 30);
    };
    mountStyle();
}

function installMpvSettingsEntry() {
    // The native shell is injected at DocumentCreation, before <head> and
    // <html> necessarily exist. Defer mounting instead of aborting the rest
    // of the shell on an early null append/observe target.
    if (!document.head || !document.documentElement) {
        setTimeout(installMpvSettingsEntry, 50);
        return;
    }

    if (!document.getElementById('tigerest-mpv-entry-style')) {
        const style = document.createElement('style');
        style.id = 'tigerest-mpv-entry-style';
        style.textContent = `
            #tigerest-mpv-settings-button {
                width: auto; min-width: 3.25em; padding: 0 .7em; margin: 0 .15em;
                color: #ffbe38; font: 800 12px/1 system-ui, sans-serif;
                letter-spacing: .06em; border-radius: 999px;
                border: 1px solid rgba(255,190,56,.42);
                background: rgba(255,190,56,.08);
            }
            #tigerest-mpv-settings-button:hover,
            #tigerest-mpv-settings-button:focus-visible {
                color: #151515; background: #ffbe38;
            }
        `;
        document.head.appendChild(style);
    }

    const mount = () => {
        if (document.getElementById('tigerest-mpv-settings-button')) return;
        const userButton = document.querySelector('.headerUserButton');
        if (!userButton?.parentElement) return;

        const button = document.createElement('button');
        button.id = 'tigerest-mpv-settings-button';
        button.type = 'button';
        button.className = 'headerButton headerSectionItem paper-icon-button-light emby-button-focusscale';
        button.textContent = 'MPV';
        button.title = 'MPV 画质与插件设置（Ctrl+,）';
        button.setAttribute('aria-label', 'MPV 画质与插件设置');
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            openTigerestSettings();
        });
        userButton.parentElement.insertBefore(button, userButton);
    };

    mount();
    const observer = new MutationObserver(mount);
    observer.observe(document.documentElement, {childList: true, subtree: true});

    document.addEventListener('keydown', event => {
        if ((event.ctrlKey || event.metaKey) && event.key === ',') {
            event.preventDefault();
            openTigerestSettings();
        }
    }, true);
}

function installWindowModeEntry() {
    if (window.tigerestAndroidApi) return;
    if (!document.head || !document.documentElement) {
        setTimeout(installWindowModeEntry, 50);
        return;
    }

    if (!document.getElementById('tigerest-window-entry-style')) {
        const style = document.createElement('style');
        style.id = 'tigerest-window-entry-style';
        style.textContent = `
            #tigerest-window-mode-button {
                width: auto; min-width: 3.5em; padding: 0 .65em; margin: 0 .15em;
                color: #f2f2f2; font: 700 12px/1 system-ui, sans-serif;
                border-radius: 999px; border: 1px solid rgba(255,255,255,.28);
                background: rgba(255,255,255,.08);
            }
            #tigerest-window-mode-button:hover,
            #tigerest-window-mode-button:focus-visible {
                color: #151515; background: #f2f2f2;
            }
        `;
        document.head.appendChild(style);
    }

    let fullscreen = false;
    const updateButton = () => {
        const button = document.getElementById('tigerest-window-mode-button');
        if (!button) return;
        const label = fullscreen ? '窗口' : '全屏';
        if (button.textContent !== label) button.textContent = label;
        button.title = fullscreen ? '恢复播放前的窗口状态' : '切换为全屏';
        button.setAttribute('aria-label', button.title);
    };
    const refreshState = async () => {
        if (!window.api?.window) return;
        fullscreen = !!(await window.api.window.isFullScreen());
        updateButton();
    };
    const mount = () => {
        if (document.getElementById('tigerest-window-mode-button')) {
            updateButton();
            return;
        }
        const userButton = document.querySelector('.headerUserButton');
        if (!userButton?.parentElement) return;

        const button = document.createElement('button');
        button.id = 'tigerest-window-mode-button';
        button.type = 'button';
        button.className = 'headerButton headerSectionItem paper-icon-button-light emby-button-focusscale';
        button.addEventListener('click', async event => {
            event.preventDefault();
            event.stopPropagation();
            if (!window.api?.window) return;
            window.api.window.setFullScreen(!fullscreen);
            await refreshState();
        });
        const settingsButton = document.getElementById('tigerest-mpv-settings-button');
        userButton.parentElement.insertBefore(button, settingsButton || userButton);
        updateButton();
    };

    mount();
    const observer = new MutationObserver(mount);
    observer.observe(document.documentElement, {childList: true, subtree: true});
    window.initCompleted.then(() => {
        window.api.window.fullScreenSwitched.connect(refreshState);
        refreshState();
    });
}

installMpvSettingsEntry();
installWindowModeEntry();
installHorizontalShelfDragging();

let lastFullscreenState = window.jmpInfo.settings.main.fullscreen;

window.jmpInfo.settingsUpdate.push(function(section) {
    if (section === 'main') {
        const currentFullscreenState = window.jmpInfo.settings.main.fullscreen;
        if (currentFullscreenState !== lastFullscreenState) {
            lastFullscreenState = currentFullscreenState;

            if (window.api && window.api.player) {
                window.api.player.notifyFullscreenChange(currentFullscreenState);
                console.log('Player fullscreen notified');
            }

            if (window.Events && window.playbackManager && window.playbackManager._currentPlayer) {
                window.Events.trigger(window.playbackManager._currentPlayer, 'fullscreenchange');
            }
        }
    }
});
