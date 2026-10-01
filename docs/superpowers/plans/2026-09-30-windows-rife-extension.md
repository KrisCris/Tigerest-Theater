# Windows RIFE TensorRT Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Windows NVIDIA 电脑上交付由大河影院管理的可选 RIFE TensorRT 扩展包，验证真实补帧后，与现有 Mac RIFE 代码统一为可发布的集成版本。

**Architecture:** 基于 `codex/macos-rife` 的播放器控制、帧策略和统计接口，Windows 增加私有 Python/VapourSynth/vs-mlrt/TensorRT 运行库及独立扩展包管理。复用 Mac 的流式尾帧修复，保持其 Core ML/Metal 后端；主程序只携带轻量控制及统计模块。先验证推理和时序，再做扩展下载及设置界面。

**Tech Stack:** C++17、Qt 6.9.3、libmpv、VapourSynth、Python、vs-mlrt、标准 TensorRT FP16、CMake/Ninja、QtTest、Python unittest、现有 Node 播放测试。

**Spec:** `docs/superpowers/specs/2026-09-29-builtin-rife-design.md`（2026-09-30 修订版）。

## Global Constraints

- 本机只研究 Windows x64 / NVIDIA / TensorRT；M 芯片问题由用户在 Mac 单独解决，不引入 Windows 的 NCNN、Core ML 或 TensorRT-RTX 后端。
- Windows 默认关闭，最高 3840×2160、60 fps、逐行 SDR 恒定帧率；提供 2 倍与接近 60／120／240 fps 的整数倍输出，保持时长。Mac 保持原有范围。
- 扩展提供 4.25 lite／4.25／4.25 heavy 和画质优先／均衡／高帧率／4K 流畅预设。实际性能目标为 1080p→约 60 fps→默认 mpv 4K 输出、1080p→约 240 fps→4K 输出、原生 4K 60→120 fps；逐模型记录完整播放结果。
- HDR/Dolby Vision、隔行、未知时序或颜色、动态分辨率、非默认倍速、系统 MPV 配置和冲突滤镜均旁路；不自动缩小画幅或转 SDR。
- 扩展包独立发行，安装器和便携版不含大型 AI 运行库。用户无需配置 Python、VapourSynth、CUDA Toolkit、系统 PATH 或 SVP。
- 运行库保存在 `Paths::globalDataDir("extensions/rife/<version>")`，profile 间共享；引擎缓存与开关按 profile 保存。
- 下载由用户点击触发，先显示大小；支持离线导入。包哈希来自可信目录，安装原子完成，激活／升级在重启后生效。
- 引擎编译在隐藏辅助进程中完成；未准备好时原帧播放，完成后下次播放生效，可从当前位置重载。seek 不能重新编译引擎。
- 保留 Mac 分支的异步停止清理，不能在 END_FILE 内恢复阻塞式 mpv 查询；不修改用户其他未提交文件。
- 所有性能数字必须来自实测。Windows 当前机器为 RTX 4090、驱动 616.64、显存 24564 MiB；其通过不代表所有 N 卡通过。
- 用户已允许完成 Windows 后统一发布；只有满足测试和版本来源要求后才发布。Mac 原有结果不能替代修改共享代码后的 Mac 回归。

## Review Focus

- 一帧／两帧／非整数帧率／自然播完：保留尾帧和时长，不在 EOF 卡住（任务 2、3）。
- 编译引擎时切集、停止或退出：过期任务不能挂载滤镜、写错缓存或改变新影片（任务 3）。
- 下载中断、磁盘不足、错误哈希与包目录穿越：原有有效扩展及基础播放不受影响（任务 4）。
- 多 profile／多进程／便携版移动：运行库不重复下载，不移除正在使用的 DLL，不加载系统同名 Python（任务 2、4）。
- Mac 同名发布附件与旧 tag 的源码不一致：按实际 SHA 整合，新版本不能改名冒用旧 DMG（任务 1、6）。

## 已核对的源码与运行环境

- 本地 HEAD：`cd601739fd4815a0d6cc417b27e67214c7814c68`，在 v2.0.18 源码之后只有本任务两次设计提交。
- 远端 main：`7044cb47a1213c72ad2e8d9ca823700614d26edb`。
- `codex/macos-rife`：`55dd5cf52ae1fcb337945a9e0a740755b0af9d69`，比该 main 超前 22 个提交。
- v2.1.2 tag 指向 `3cd0b0d6625a58f7f1331ba28a6e3290a96b7c78`；最新发布说明明确 DMG 使用 `55dd5cf` 的修复。不能只检出 tag 作为最新 Mac 实现。
- `build/output/libmpv-2.dll` 为 `mpv v0.41.0-920-gdd5d17d32`，构建启用了 VapourSynth；无媒体参数解析成功。它没有 `eof-aware` 选项字符串，不能直接套用 Mac 的滤镜命令。
- 实验选定 Python 3.13.15／VapourSynth R79／vs-mlrt v15.16 标准 TensorRT 10.16。R80 因移除 API 3 无法加载此插件；R79 私有加载与 tiny lite 实际推理已通过。上游 TensorRT 分卷合计 2,676,014,172 字节；端到端性能及发行验收仍未完成。
- 当前 GitHub API 能读取源码；普通 Git HTTPS fetch 两次连接失败。执行时先恢复正常 Git 获取，不用源码 ZIP 冒充保留了原始提交历史。

## 文件职责

以下已有文件位于 Mac 分支，任务 1 引入后使用；不要在 v2.0.18 上另造一套同名控制系统。

| 文件 | 职责 |
| --- | --- |
| `src/player/interpolation/FrameInterpolationController.*`、`InterpolationPolicy.*`、`FrameTiming.*` | 复用播放状态、适用性和有理数帧时长。 |
| `src/player/interpolation/RifeSessionMetrics.*` | 主程序和 VS 监视器共享同一份进程内统计。 |
| 新 `src/player/interpolation/RifeVsMonitor.*` | 从现有插件拆出不依赖 Core ML 的输出监视器，供两端复用。 |
| 新 `src/player/interpolation/windows/RifeRuntimeManager.*` | 运行库探测、引擎准备进程、缓存和本机能力报告。 |
| 新 `src/player/interpolation/windows/RifeExtensionManager.*` | 可信目录、下载／导入、原子安装、版本和清理。 |
| 新 `resources/mpv/rife/interpolate_trt.vpy`、`trt_pipeline.py` | Windows 图像转换、RIFE 图、切镜、输出属性；不改 Mac 的推理实现。 |
| 新 `dev/windows/rife/` | 固定依赖、私有运行库准备、打补丁的 mpv 构建、推理探测、扩展打包。 |
| `resources/settings/settings_description.json`、`native/nativeshell.js` | 复用 `video.aiRife`，增加 Windows 扩展管理状态和操作。 |
| `src/player/PlayerComponent.*`、`src/player/CMakeLists.txt`、`src/player/interpolation/CMakeLists.txt`、`src/CMakeLists.txt` | 必要的跨平台构建及生命周期连接。 |
| 新 `tests/test_rife_runtime.py`、`test_rife_extension.cpp`、`test_rife_trt_pipeline.py`、`test_rife_windows_playback.py` | 私有环境、真实帧、安装失败与完整播放验证。 |

### Task 1: 取得最新 Mac 源码并建立共同基线

**Files:** 已有 Mac 分支代码及本任务 spec/plan；按需修复合并冲突，不做无关重构。

**Interfaces:** 消费远端 SHA；产出包含 `55dd5cf` 修复和本任务文档的集成分支，继续使用 `rife::FrameInterpolationController(MpvAccess, RuntimePaths)`、`video.aiRife` 和滤镜标签 `@tigerest-rife`。

- [x] 获取 `main`、`codex/macos-rife` 与标签，核对实际 SHA。按用户选择的执行方式使用隔离工作区／分支；原目录里的两份 2026-08-30 未跟踪文档保持原样。
- [x] 将 Mac 分支合入集成分支，保留原始历史及本地 spec/plan。核对 `stopOnEndFile()` 只使用异步 mpv 调用、CoreAudio 补丁仍在 Mac 构建链、版本未提前标记正式发布。
- [x] 复用已有外部 Qt/MSVC/WebEngine 依赖路径，运行 `dev\windows\build.bat` 和 `dev\windows\test.bat`，记录集成前 Windows 基线。失败先定位，不把原有失败归为 TensorRT 变化。
- [x] 保存基线结果到 `docs/reports/2026-09-30-windows-rife.md`，记录实际源码 SHA、工具链路径变量名和测试结果；只提交本次合并／文档。

### Task 2: 私有运行库与带尾帧支持的 Windows libmpv

**Files:** 新 `dev/windows/rife/{prepare_runtime.py,build_mpv.py,runtime-lock.json,probe_runtime.py,README.md}`；复用 `dev/macos/rife/mpv-eof-aware.patch`；新 `tests/test_rife_runtime.py`；按需增加 Windows mpv 构建工作流。

**Interfaces:** `prepare_runtime.py --output DIR` 产出 `runtime.json` 与私有库树；`probe_runtime.py --runtime DIR --mpv DLL --report JSON` 产出 `ok,mpvVersion,vsVersion,trtVersion,gpu,loadedLibraries,errors`。运行库清单含 `schemaVersion=1,backend="windows-nvidia-trt",runtimeId,files[{path,sha256,size}],model`。

- [x] 编写运行库探测测试：缺少 DLL 返回明确失败；显式指定的坏私有根即使系统有 Python 也不能成功；从两个含中文和空格的路径运行，所加载的非系统依赖都属于选定私有根或播放器的轻量统计 DLL。
- [x] 运行 `python -m unittest discover -s tests -p test_rife_runtime.py -v`，确认缺少待实现工具／能力导致失败。
- [x] 固定已验证兼容的 R79、Python 3.13.15 与 vs-mlrt v15.16 私有运行库。仅开发准备过程联网；保存下载源、版本、SHA-256 和许可证，不执行全局安装。纳入 4.25 lite／4.25／4.25 heavy，逐一记录实际权重来源，不把 Mac 同版本号当作相同权重。
- [ ] 构建 Windows libmpv：保留当前 dd5d17d328 内核和既有依赖版本作为首个移植基线，只移植 EOF／颜色元数据必要修改；已存在的 VSScript 动态加载修改不重复打补丁。保存全部补丁与构建来源，不移植 CoreAudio。本地工具链不足时使用可复现 CI 构建并下载其已校验产物。AVX2 与兼容 DLL 都要有一致的滤镜能力。
- [ ] 用实际视频通过两份 DLL 验证 `eof-aware=yes`、R79 加载和颜色属性，覆盖一帧／两帧自然结束。静态字符串或选项解析成功不能替代媒体测试。运行上述 unittest 并执行 `probe_runtime.py`，报告必须 `ok=true` 且加载路径符合私有根。
- [ ] 统计压缩下载、展开运行库、模型和临时缓存体积；依赖裁剪每次均重跑加载与推理测试。提交脚本、锁文件和报告，不提交大型二进制或生成引擎。

### Task 3: 真实 TensorRT 补帧、缓存与共享播放控制

**Files:** 新 Windows 运行库管理器、`interpolate_trt.vpy`、`trt_pipeline.py`、`dev/windows/rife/prepare_engine.py`、`RifeVsMonitor.*`；修改已有控制器／统计／CMake／PlayerComponent；新增或扩展运行库、控制器、时序和 TRT 测试。

**Interfaces:**
- `RifeRuntimeManager::prepare(const rife::SourceInfo&, quint64 generation)` 异步准备；`cancel(quint64)` 取消；`pathsFor(const rife::SourceInfo&) const -> rife::RuntimePaths` 仅返回完整缓存；`diagnostics() const -> QVariantMap`；信号 `prepared(quint64,bool,QString)`。
- `prepare_engine.py --request JSON --result JSON` 只接收运行库根、GPU、模型、形状及缓存根，输出 `ready,cacheKey,enginePath,error`；不接收媒体 URL。
- `build_rife_filter(source, options)` 返回 VS clip；沿用 `_TigerestRifeSynthesized/_TigerestRifeReason/_DurationNum/_DurationDen` 和 `session`。
- 为控制器增加 `setRuntimePaths(RuntimePaths)`，仅在未挂载滤镜时接受；现有会话接口和 Mac 默认路径保持兼容。

- [ ] 先写测试：23.976/24/30/60 fps 的 2／4／5／8／10 倍输出时长不变；运动样本的各新增帧不同于相邻原帧且不同时间点有区别；奇数帧、切镜和 EOF 不虚报推理，多倍尾帧不取不存在的邻帧；4K 不在推理前缩小；缓存未完成不可用；取消旧 generation 后的结果不改变新影片。
- [x] 运行 `python -m unittest discover -s tests -p test_rife_trt_pipeline.py -v` 和新增 QtTest 用例，记录真实失败。
- [x] 将现有 Monitor 从 Mac 推理代码中拆出。Windows 构建轻量共享统计 DLL，主程序与 Monitor 必须连接同一份注册表；Mac 保留其引擎和 Monitor 行为。为 Windows DLL 正确导出统计接口，不能各自静态链接形成两份会话表。
- [x] 构建 TRT 图：显式加载私有插件，FP16 推理，使用输入颜色矩阵和范围，尺寸按模型需要填充后裁切；先检测切镜与无效帧再请求生成图。原帧保真、尾帧时长和切镜旁路沿用现有测试语义。只有实际取到生成分支的帧才计数。
- [x] 建立按 GPU／驱动／运行库／权重／精度／形状区分的引擎缓存，锁文件和原子完成标记防止半成品复用。首次编译允许最长 15 分钟并支持取消；Player 中原帧播放及启动门限连接仍由下一项完成，工具层不把 15 秒套用到首次编译。
- [ ] 在格式获知后调度引擎准备，未就绪时旁路本片；缓存命中才挂载滤镜。保留 `stopOnEndFile()` 异步清理和旧结果隔离，暂停／seek／缓冲不触发性能误判。Windows 的性能回退以 spec 的 5 秒排除期、10 秒窗口、5% 丢帧／100 ms 持续音画偏差为初始参数；通过按后端的参数传入共享 guard，Mac 保留其既有参数。Windows 没有精确 GPU 推理耗时时明确标记不可用，不能把 0 ms 或队列等待时间包装成推理性能。
- [ ] 用 `dev\windows\build.bat`、`dev\windows\test.bat -R rife` 及实际媒体验证；每个源帧率记录 10 分钟稳态结果、掉帧与音画偏差。报告合成帧计数、模型／后端和引擎缓存命中。达到 spec 标准后再继续扩展安装层。
- [ ] 提交此任务的源码、回归测试及可复现实测报告。

### Task 4: 扩展包构建、离线导入与在线下载

**Files:** 新 `dev/windows/rife/{package_extension.py,verify_extension.py}`、`resources/rife/windows-catalog.json`、`RifeExtensionManager.*`、`tests/test_rife_extension.cpp`、`tests/test_rife_extension_package.py`；按需增加专用 ZIP64 解压依赖及许可。

**Interfaces:** `RifeExtensionManager(QObject*)` 提供 `download(QString packageId)`,`importPackage(QString path)`,`cancel()`,`scheduleRemoval(QString version)`,`status() const -> QVariantMap` 和 `statusChanged(QVariantMap)`；目录入口为 `Paths::globalDataDir("extensions/rife")`。

- [ ] 先写失败用例：可信目录未列出的包、错误哈希、错误架构／ABI、`../`/绝对路径／链接条目、磁盘不足均拒绝且旧 active 记录不变；两 profile 安装同包只产生一份运行库；使用中的版本不能被删除。
- [ ] 运行 `python -m unittest discover -s tests -p test_rife_extension_package.py -v` 与 QtTest 安装用例，确认失败后实现。
- [ ] 生成 ZIP64 扩展包与文件清单；仅携带任务 2/3 验证过的私有运行库、模型、脚本与 VS 插件，不带生成引擎或用户设置。可信目录包含包 ID、版本、Windows x64、运行库 ABI、主程序版本范围、下载／展开大小、固定 URL 和 SHA-256。
- [ ] 实现流式解压到独立暂存目录、逐文件校验和原子 active 记录。归档解析使用支持 ZIP64 的成熟库并固定版本；不能用 shell 拼接归档内路径执行文件操作。无扩展情况下基础播放器启动不需要 Python 或解压依赖的外部安装。
- [ ] 独立 QNetworkAccessManager 下载，不带 Emby 头；测试取消、服务端不支持 Range、ETag 改变以及续传，只有完整哈希通过才安装。清理／卸载只操作已解析并确认属于 RIFE 扩展根的版本目录。
- [ ] 激活需要重启，多进程用版本使用锁避免提前清理。主程序升级保留兼容扩展；不兼容版本准确显示原因。先离线导入真实本地包通过，再接已存在的发布附件地址；未发布前在线按钮显示尚不可用。
- [ ] 运行 `dev\windows\test.bat -R rife_extension` 和包验证脚本，记录最终体积并提交。

### Task 5: Windows 设置与打包接入

**Files:** `resources/settings/settings_description.json`、`native/nativeshell.js`、`PlayerComponent.*`、`MpvConfigManager.*`、`CMakeModules/CompleteBundleWin.cmake.in`、`PreparePortableZip.cmake.in`；新 `tests/test_rife_windows_settings.js`，扩展已有包完整性测试。

**Interfaces:** 复用 `video.aiRife`；桥接 `rifeExtensionStatus() -> QVariantMap`、`downloadRifeExtension(QString packageId)`、`importRifeExtension()`（原生文件选择器）、`cancelRifeExtensionOperation()` 和现有 `mpvDiagnostics()`。不允许网页传入任意下载 URL 或安装目录。

- [ ] 写用户流程测试：打开设置不下载；未安装时呈现大小与下载／导入；等待重启和准备引擎分别显示；安装失败可重试；Mac 现有开关不出现 Windows 扩展安装流程。
- [ ] 运行 `node --test tests/test_rife_windows_settings.js` 确认失败，再实现桥接和界面。普通设置只显示补帧、扩展与性能结果，不要求用户输入运行库路径。
- [ ] 将 Windows 私有路径准备放到第一次 VSScript 加载之前，并显式禁用系统 Python/site-packages 自动搜索。profile 切换更新引擎缓存根，不重装运行库。
- [ ] 基础安装器／便携 ZIP 只携带控制层、必要的轻量统计／安装支持和可信目录；使用任务 4 的独立扩展文件。验证无扩展的安装版／便携版启动和普通播放，再验证安装扩展后的两种视频后端与三套 Shader。
- [ ] 执行 `dev\windows\build.bat`、相关 Node 测试、`dev\windows\test.bat`；通过后运行 `dev\windows\bundle.bat`，记录实际文件清单、哈希和大小，提交。

### Task 6: Windows 验收与统一版本发布

**Files:** 新 `tests/test_rife_windows_playback.py`、`docs/reports/2026-09-30-windows-rife.md`；必要的 `VERSION`、`CHANGELOG.md`、`README.md`、构建工作流和版本目录更新。

**Interfaces:** 报告逐项标记通过／失败／未测；发行清单记录 `sourceSha,platform,version,assetName,sha256,runtimeId,tests`，不根据文件名推定同一源码。

- [ ] 自动回归：短片/尾帧、20 次 seek、停止重开、播放列表切集、补帧中退出、暂停及倍速旁路；模拟缺失／损坏扩展、缓存不可写和准备取消，确认原帧恢复且无退出死锁。
- [ ] 实机回归：逐模型测试 1080p SDR 23.976/24/30→约 60 fps→默认 mpv 4K 输出、1080p→约 240 fps→4K 输出、原生 4K 60→120 fps，各代表性组合 10 分钟。覆盖原生 GPU-Next 与 Render API、字幕和弹幕、三套 Shader；记录配置、实际帧率、显存、丢帧比例和音画偏差。稳态目标低于 1% 丢帧且音画偏差不持续超过 80 ms；极限目标未通过明确报告，不伪报通过。
- [ ] 在无 Python/VS/CUDA/SVP 的干净 Windows 上验证安装与离线导入。若仅完成本机隔离测试，报告仍为未完成干净系统验收；不能将该项勾为通过。
- [ ] 对共享控制／Monitor 变化进行 Mac 编译和现有回归测试，保留 `55dd5cf` 修复。通过现有 Mac CI 或用户的 Mac 构建环境取得同一集成 SHA 的 DMG 和测试记录；不重命名旧 v2.1.2 DMG 充作新版本。
- [ ] 检查远端最新版本后分配未占用版本号；从最终集成 SHA 生成 Windows 安装器、便携 ZIP 和 Mac DMG。RIFE 扩展独立编号，先固定其运行库源码／锁文件 SHA 并生成包，再将包哈希纳入主程序目录，避免哈希清单的自引用；发行清单分别记录主程序 SHA 和扩展构建 SHA。先建立发布草稿并验证所有附件／下载链接／扩展目录哈希及测试边界。
- [ ] 全部分支检查通过后按用户已给的统一发布授权发布；只有预览版质量时明确标记 prerelease。若缺少 Mac 同提交产物或必要验证，则保留可审阅草稿并准确报告缺项，不覆盖旧 tag 或旧发布。

## 执行方式建议与当前状态

推荐在本任务顺序实施，使用隔离工作区；运行库兼容、原生统计和扩展安装有较强依赖，先得到可信的真实推理结果更有价值。也可选择子代理逐项实施与复核，但不会在用户选择前派出子代理。

本计划已获用户批准并顺序执行。任务 1 完成；任务 2 的普通 x64 内核已通过真实 EOF、流式 TRT 和三模型 600 秒完整 4K 渲染，连续三个 v3 候选因实际播放崩溃被拒绝，发行两个角色改用已验收的普通内核。任务 3 的 Player、缓存、时序与性能回退已接通，三模型日常目标通过，两个极限目标明确失败。任务 4 完整约 2GB 扩展已完成原生导入、重启完整校验和隔离启动，在线下载基础已通过真实 TLS 用例。任务 5 主程序／设置已实际播放验证，安装版／便携版已生成并继续验收。完整 53 项 CTest 通过后，错误恢复边界继续补充回归。任务 6 等待最终同提交 Windows/Mac 产物与草稿核对；干净 Windows 等未测项不能勾为通过。执行记录见 `.superpowers/sdd/2026-09-30-windows-rife-extension/progress.md` 和 `docs/reports/2026-09-30-windows-rife.md`。
