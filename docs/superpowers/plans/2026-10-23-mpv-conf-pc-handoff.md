# 2.9.4 mpv.conf 编辑器：交给 PC 端合并

日期：2026-10-23（Asia/Shanghai）

## 1. 分支和基线

| 项 | 内容 |
| --- | --- |
| 分支 | `claude/apple-2.9.4-next`（已推送到 GitHub `origin`） |
| 基线 | `claude/apple-2.9.4` 的 `5e35995`（iPad/iPhone 2.9.4 的最新提交） |
| 本批改动 | `5e35995..claude/apple-2.9.4-next`，共 11 个提交（含这份交接说明） |
| 设计文档 | [docs/superpowers/specs/2026-10-23-mpv-conf-editor-design.md](../specs/2026-10-23-mpv-conf-editor-design.md)，第 16 节是实现记录 |
| 版本号 | 没有改动，`VERSION` 仍是 2.9.3，由 2.9.4 发版时统一修改 |

`claude/apple-2.9.4` 比 GitHub 上的 `main` 多出约 256 个提交（Jellyfin、iPad、iPhone 等），这些也在本分支的历史里。按 PC 端 2.9.4 分支的情况选一种合并方式：

1. **PC 端 2.9.4 也要带上 Apple 端改动**：整个分支合并。

   ```bash
   git fetch origin claude/apple-2.9.4-next
   git merge origin/claude/apple-2.9.4-next
   ```

2. **只要 mpv.conf 这批**：只摘本批提交。

   ```bash
   git fetch origin claude/apple-2.9.4-next
   git cherry-pick 5e35995..origin/claude/apple-2.9.4-next
   ```

   用第 2 种时，如果 PC 端没有 `5e35995` 之前的 iPad 改动，`apple/tools/quality_resources.py` 那一处路径修改可能套不上，可以直接跳过或按第 5 节手动改。

## 2. 改了什么

用户可见：

- 桌面端（Windows、macOS）只读取客户端目录里的一份 `mpv.conf`，在「设置 → 播放器设置 → MPV 画质与插件」下方的编辑器里修改。配置模式（内置 / 自动 / 系统）、「高级 → 手动 MPV 配置」和 `user-overrides.conf` 全部取消。
- 文件分三块：头部和尾部是软件维护的只读管理区，写着脚本、SVP 连接接口、启动档位，以及视频、字幕、音频页决定的值；中间的用户区可以编辑。
- 编辑器：表单与文本实时同步、每行左侧「＋」插入、逐行校验并标红、有错误时离开会询问「强行使用 / 返回修改」、恢复默认配置、粘贴整份配置前显示差异、「复制给 AI」（附自动生成的修改规则 `mpv-ai-guide.md`）、内置滤镜库清单（作用、触发条件、开销、强度、M4 Pro 实测耗时）、使用说明。
- 切档（设置页预设、uosc「滤镜」菜单、Alt+1/2/3）由客户端按当前 `mpv.conf` 执行，保存后立即生效，无需重启；播放中切档后设置页预设同步。
- RIFE 开启时，用户写的改帧率 vf 滤镜和 `interpolation=yes` 自动改成 `#[暂停执行:RIFE]` 注释，关闭后恢复，设置页底部提示。
- 着色器目录新增 `shaders/user/`，升级不改动；内置文件按清单更新，旧版留在根目录的 52 个重复 Anime4K 文件在未修改时自动删除。
- mpv 用用户配置初始化失败时，自动改用默认配置并提示，不再 `qFatal`。
- 左侧设置菜单：新增「播放器设置」分组（客户端、视频、音频、字幕、MPV 画质与插件、弹幕样式），原分组改名「媒体库设置」（General、播放、首页设置）；「高级」页隐藏。
- 「恢复本页默认值」改用页面内确认框（原生 `confirm()` 在 Qt 里可能看不见却卡住整个页面），且不再重置隐藏的迁移标记。

2.9.4 首次启动迁移：直接写入新默认配置；旧的 `user-overrides.conf`、高级选项和旧画质覆盖参数原样备份到配置目录的「旧版自定义配置备份.txt」，`user-overrides.conf` 删除。按产品决定，不导入系统 mpv 配置。

主要代码：

| 位置 | 作用 |
| --- | --- |
| `src/player/MpvConfDocument.*` | 解析、拼装、归属规则、校验、编辑操作（纯文本逻辑） |
| `src/player/MpvConfigManager.*` | 部署资源、生成管理区、迁移、升级、滤镜库清单、AI 说明 |
| `src/player/MpvConfEditor.*` | 设置页编辑器的数据接口 |
| `src/player/PlayerComponent.*` | 切档、保存后实时生效、RIFE 暂停提示、选项表缓存 |
| `external/mpvqt/src/mpvcontroller.cpp` | 初始化失败回退默认配置；删除系统模式的脚本隔离和 include |
| `native/mpvConfEditor.js`、`native/nativeshell.js` | 编辑器界面、设置页合并、菜单分组、页面内确认框 |
| `resources/mpv/mpv.default.conf` | 默认用户区（替代 `mpv.conf.in`） |
| `resources/mpvconf/` | 配置项目录、mpv 选项表快照、滤镜清单、实测耗时 |
| `resources/mpv/plugins/profile_menu.lua` | 菜单档位来自 mpv.conf，切档交给客户端 |
| `src/settings/SettingsSection.*` | 按页面恢复默认时跳过隐藏项 |

## 3. 合并后先做

1. **Windows 编译。** 这批 C++ 只在 macOS（Apple clang，`-Wall -Wextra -Wshorten-64-to-32`）上编译过，新代码在 Mac 上零警告。没有在 MSVC 上编译。
2. **按 `dev/windows/TESTING.md` 跑全套测试**（先在同一个 PowerShell 调用里加载 `dev/windows/Enter-TestEnvironment.ps1`）。下面这些是我改过、但在 Mac 上不注册或无法运行的：
   - `test_rife_windows_ipc`：改为验证锁定项被注释、旧系统模式不再生效、通过测试注入口传入私有端点后真实 mpv 能读到。只在 Mac 上做过语法检查。
   - `test_rife_player_playback`、`rife_player_benchmark`：测试资源换成 `mpv.default.conf` 和 `resources/mpvconf/*`。
   - `test_high_refresh_playback.cjs`、`test_rife_playback.cjs`：私有 IPC 端点和窗口选项改走 `TIGEREST_MPV_TEST_OPTIONS`。
   - `test_windows_web_controls.cjs`：恢复默认改为点页面内确认框。
   - `test_settings_webengine`（`test_settings_ui.cjs`）：菜单改成分组结构；Mac 上用真实客户端手动跑过并通过。
   - `test_mpvconf_editor_webengine`：编辑器端到端测试（真实客户端 + 真实 C++ 接口 + 磁盘上的 mpv.conf），Mac 上通过，Windows 上需要跑一次。
3. **Windows 实机检查**：默认配置下 SVP 的 `mpvpipe` 仍在（RIFE 关闭时）；开启 RIFE 后暂停与恢复提示；嵌入式 GPU-Next 下切档与编辑保存立即生效；升级一台装有 2.9.3 并写过「高级」选项的机器，确认生成了备份文件。
4. **Windows 独显补测着色器耗时**：`python tools/measure_mpv_shaders.py`（会反复弹出 mpv 窗口，约 15 分钟），结果写入 `resources/mpvconf/shader-timings.json` 后运行 `python tools/generate_mpv_shader_catalog.py`。注意它会覆盖 Mac 的数据；如果想两份都保留，需要先扩展文件格式，目前只支持一台设备。

## 4. 容易冲突的文件

- `src/player/PlayerComponent.cpp`、`PlayerComponent.h`：删除了 `setOtherConfiguration` 和所有 `usingSystemConfig` 分支；`setVideoConfiguration` / `setSubtitleConfiguration` / `setAudioConfiguration` 改为遍历 `MpvConfigManager::videoOptions()` 等；`setMpvPreset` 改为调用 `applyQualityProfile`。PC 端如果在这些函数里加了新设置项，合并时要把新项加进 `MpvConfigManager` 对应的 `*Options()`，并在 `resources/mpvconf/options.json` 的 `pageOwned` 里登记，否则它不会出现在尾部管理区，用户区也不会锁定它。
- `native/nativeshell.js`：设置页、菜单分组、恢复默认确认框。
- `resources/settings/settings_description.json`：新增隐藏项 `mpv.mpvConfEditorMigrated`；`other` 分组设为隐藏。mpv 分组里的旧画质参数和配置模式项保留，因为 Android 和 iPad 还在用。
- `tests/CMakeLists.txt`：新增 3 个测试目标，若干测试的资源清单改动。
- `src/system/SystemComponent.cpp`：注入脚本列表新增 `mpvConfEditor.js`；`clientData` 的 `mpvConfigMode` 换成 `mpvConfNotices`。

## 5. 约定和注意事项

- **自动化测试注入 mpv 选项**：设置环境变量 `TIGEREST_MPV_TEST_OPTIONS`（换行分隔），内容写在尾部管理区末尾。写了 `input-ipc-server` 或 `include` 时，`ownsDefaultSvpIpc()` 返回 false。不要再用 `other_conf` 或 `user-overrides.conf`。
- **新增由设置页决定的 mpv 选项**：同时改 `*Options()` 和 `options.json` 的 `pageOwned`。
- **新增、删除或更新内置着色器**：运行 `tools/generate_mpv_shader_catalog.py`；`test_bundle_integrity.py` 会检查清单是否过期。
- **升级 libmpv 后**：可以运行 `tools/snapshot_mpv_options.py <libmpv>` 更新内置选项表快照；客户端运行时也会按版本自动刷新缓存。
- **iPad 打包脚本**：`apple/tools/quality_resources.py` 改为读 `resources/mpv/mpv.default.conf`，生成的三个画质预设与原来逐项一致（已核对）。

## 6. 已做的验证（macOS，Apple M4 Pro）

- 全量 CTest：见本节末尾。
- 测试用例层面：`test_mpv_conf_document`（解析、校验、编辑 17 项）、`test_mpv_conf_manager`（迁移、升级、锁定项、RIFE 暂停、滤镜库、空滤镜 10 项）、`test_settings`（按页面恢复默认保留隐藏项）、编辑器端到端测试。
- 真实客户端、隔离配置档：540p 测试片在客户端自己的 gpu-next 窗口里播放，设置页预设、uosc 菜单快捷键、编辑器保存三种切档方式都生效，着色器数量正确，截图确认画面在渲染。
- 真实 Emby 服务器（隔离的 Demo 配置档）：设置页、菜单分组、恢复本页默认值都实际操作过。
- 没有做的：Windows 上的任何编译和运行；真实 Emby 片源的长时间播放；Android、iPad 端（这批没有改动它们的代码路径）。

最终全量测试结果：2026-10-23 在本分支最新代码上运行，87 项全部通过（不含 `test_macos_pause`）。另外 `test_settings_ui.cjs` 不在 Mac 的 CTest 里，已用真实客户端单独运行并通过。
