# 大河影院内置 RIFE 设计

日期：2026-09-29。状态：设计待审阅，尚未实现。

## 目标与首版范围

用户已确认：RIFE 由播放器直接集成和控制，免去 SVP 及其环境配置。用户安装或解压播放器后即可使用，依赖、模型、状态及恢复流程均由大河影院管理。

用户进一步明确首版优先 NVIDIA 显卡和 Apple M 芯片。因此首版纳入 Windows x64/NVIDIA 和 macOS 26+/Apple Silicon arm64 两个平台，共享控制层，使用各自的推理后端。当前本机可测 RTX 4090；M 芯片的具体型号及性能须在 Mac 实机验收。AMD、Intel GPU 和 Intel Mac 保留正常播放能力，本轮不纳入 RIFE 支持。

首版提供关闭／2 倍两个选项，默认关闭。支持最高 1920×1080、逐行、SDR、已识别的恒定帧率且源帧率不超过 30 fps 的视频。23.976 fps 对应 47.952 fps，24 fps 对应 48 fps，30 fps 对应 60 fps；保持原始播放时长。HDR、Dolby Vision、隔行、动态分辨率、无法确定时序以及超出范围的素材自动旁路，显示具体原因。首版不自动降分辨率、不将 HDR 转为 SDR 以强行补帧。

固定 60/120 fps、自动匹配刷新率、多模型商店、AMD/Intel 后端和 4K/HDR 补帧是后续扩展，不纳入本轮交付。两平台均以原分辨率 1080p SDR 2 倍补帧为首轮验证目标；不能将一台 M 芯片机器通过推断为所有 M 系列均达到实时性能。

## 项目依据和路线选择

本仓库使用 Qt + 内嵌 libmpv；Windows 默认以原生 GPU-Next 子窗口呈现视频，另有 Render API 兼容模式。`PlayerComponent` 已集中处理媒体生命周期、设置更新、mpv 事件和诊断；`MpvConfigManager` 管理内置与系统配置；设置定义在 `resources/settings/settings_description.json`，设置界面在 `native/nativeshell.js`。

2026-09-29 对 `build/output/libmpv-2.dll` 进行独立、无媒体的 API 查询：版本为 `mpv v0.41.0-920-gdd5d17d32`；构建参数包含 `-Dvapoursynth=enabled`；VapourSynth 滤镜参数解析返回 0。这只证明该 DLL 具备入口，没有验证运行库加载、RIFE 推理、播放性能或正式安装目录中的 DLL。实现时仍须核验最终发布文件，包括非 AVX2 兼容 DLL。

| 路线 | 取舍 |
| --- | --- |
| VapourSynth + 按平台选择后端（推荐） | Windows/NVIDIA 使用 vs-mlrt/TensorRT；Apple Silicon 使用原生 arm64 RIFE-NCNN 插件，通过 MoltenVK 在 Metal GPU 上计算。共享 UI、状态和播放控制，各自管理运行库及性能验证。 |
| 两端统一 VapourSynth + NCNN/Vulkan | 减少推理适配差异、依赖相对紧凑；NVIDIA 也放弃 TensorRT 路线，性能收益需要实测比较。 |
| 修改 libmpv，直接接入 C++ RIFE 推理 | 可更深入控制帧传递，但需要长期维护内核修改及跨版本适配，首版不采用。 |

VapourSynth 官方提供 Windows 便携部署方式。Windows 路线是否适合发布，以当前 DLL 与私有运行库的兼容验证为第一个验收关口，不根据最新文档推定本地二进制已经兼容。[VapourSynth 安装文档](https://www.vapoursynth.com/doc/installation.html#windows-portable)、[vs-mlrt 后端说明](https://github.com/AmusementClub/vs-mlrt)

Mac 使用 `styler00dollar/VapourSynth-RIFE-ncnn-Vulkan` 作为首选适配目标：核对时 `r9_mod_v33` release 已提供 `librife_macos_arm64.dylib`，仍须检查该二进制的最低系统版本和动态依赖。MoltenVK 将 Vulkan 映射到 Metal；这条路线不等于原生 CoreML 或使用 Neural Engine。Mac 当前由 Homebrew 提供构建期 libmpv，需单独验证其 VapourSynth 编译支持；若缺失，在项目构建阶段补齐并将依赖随应用发布。Windows 的 DLL 探测结果不适用于 Mac。[RIFE 插件发布页](https://github.com/styler00dollar/VapourSynth-RIFE-ncnn-Vulkan/releases/tag/r9_mod_v33)、[MoltenVK](https://github.com/KhronosGroup/MoltenVK)

## Apple Neural Engine 评估

用户询问 M 芯片能否使用 NPU。Apple Neural Engine 可以通过 Core ML 参与模型推理；`all` 允许系统选择 CPU/GPU/ANE，`cpuAndNeuralEngine` 允许 CPU 与 ANE、排除 GPU，不能理解为保证模型全部在 ANE 上执行。[Apple MLComputeUnits](https://developer.apple.com/documentation/coreml/mlcomputeunits)、[Core ML 模型执行说明](https://apple.github.io/coremltools/docs-guides/source/model-prediction.html)

Mac 第一阶段加入独立的 Core ML 可行性与性能实验：用同源 RIFE 权重及相同精度、分辨率，与 NCNN/MoltenVK GPU 基线比较。覆盖 `all`、`cpuAndNeuralEngine`、`cpuAndGPU`，记录模型转换是否成功、计算单元分配、实际推理轨迹、端到端速度、功耗、内存及画质偏差。使用 MLComputePlan 查看预计设备分配，并结合 Core ML 性能工具验证执行，不能把选择了 `all` 或模型转换成功当作 ANE 已工作。[Apple Core ML 性能工具](https://developer.apple.com/videos/play/wwdc2024/10161/)

RIFE 涉及光流变形与采样，原始实现使用 `grid_sample`；具体选定版本的这些运算能否有效分配到 ANE，需要转换和性能分析确认，不能笼统断言支持或不支持。CPU/GPU 回退及设备间同步可能抵消收益；减少 GPU 占用和功耗是待测收益。[RIFE 采样实现](https://github.com/hzwer/ECCV2022-RIFE/blob/main/model/warplayer.py)

Core ML 实验先测模型，不立即扩展正式播放链；现有 NCNN 插件不会因设置一个选项就改为 ANE。若实验显示足够收益，再为 Core ML 编写专用帧接口／VapourSynth 后端适配并验证播放时序，替换或补充 Mac 后端。若没有收益，保留 GPU 方案并记录结果。用户当前是在询问可行性，尚未要求首版必须通过 NPU 执行，因此 ANE 全模型覆盖不设为首版交付条件。

## 数据流与组件职责

播放链路为：Emby／本地文件 → libmpv 解码 → 帧回读及色彩格式转换 → VapourSynth RIFE → 原有视频渲染与 Shader → 字幕、弹幕、UOSC。

视频仍由 libmpv 读取，滤镜使用 mpv 提供的 `video_in`；不在辅助进程重新打开 Emby 地址。音频与播放进度继续由现有 libmpv 管理，不产生补帧后的视频文件。普通字幕和弹幕在补帧之后呈现；源视频中已经烧录的文字仍属于视频画面。

新增职责独立的组件，避免继续向 `PlayerComponent.cpp` 堆积推理和部署逻辑：

- **RifeRuntimeManager**：定位私有运行库、校验版本清单、检测 GPU 与依赖、运行后台模型准备、管理平台缓存。
- **后端适配器**：分别实现 `windows-nvidia-trt` 和 `mac-arm64-ncnn` 的探测、准备、脚本参数及诊断，向控制层提供统一接口；首版不在运行时自动切换到其他后端。
- **RifeController**：处理每次播放的适用性、滤镜挂载与移除、状态更新、设置覆盖与恢复，以及故障旁路。由 `PlayerComponent` 的现有生命周期调用。
- **内置 `.vpy` 适配层**：完成格式转换、RIFE 调用、切镜处理、帧时长及色彩属性传递。显式加载本包插件，不扫描用户全局插件。
- **后台准备工具**：在无可见窗口的独立进程中完成兼容探测、Windows TensorRT 引擎构建或 Mac 模型预热，可取消，输出结构化状态；只接收模型、GPU、分辨率和缓存路径，不接收媒体 URL 或凭据。

运行库环境必须在 VapourSynth 首次加载前建立。实现阶段沿 `src/main.cpp`、`MpvConfigManager`、MpvQt 初始化顺序确定入口，不将环境准备放在已经初始化后的 `PlayerComponent::initializeMpv()` 中碰运气。

## 私有运行环境和发布

Windows 将运行库、Python、VapourSynth、推理 DLL、固定脚本和模型放入安装目录下的独立 `rife/` 树，安装器与便携包使用同一份清单。Mac 将原生 arm64 Python、VapourSynth、NCNN 插件及其动态依赖、MoltenVK 和模型纳入 `.app` 的 Frameworks/Resources 目录。两个平台各固定一个经验证的模型配置，优先使用同源模型的适配格式，不强求二进制格式相同。

无需用户运行 pip、配置系统 PATH、注册 VapourSynth、安装 CUDA Toolkit 或 Homebrew。显卡驱动／Metal 由系统提供。Mac 上依赖全部使用包内可重定位的 install name/rpath；如插件依赖 Vulkan loader，则连同 loader 与 ICD 配置一起打包，明确定位包内 MoltenVK。所有 Mach-O 与 Python 扩展纳入依赖闭包检查及签名，迁移应用位置后仍能从 Finder 启动；不依赖开发机 `/opt/homebrew` 路径或终端环境。

使用进程内的明确路径加载所需库；如采用 `VSSCRIPT_PATH`，须分别验证所打包的 libmpv 确实支持并使用了该路径。Python 使用对应平台的隔离路径配置，不读取用户 site-packages，不修改系统或用户级环境变量，不借用本机 SVP 安装。

首次使用无需联网下载依赖。模型引擎、GPU 缓存和临时文件写入当前 profile 的可写缓存目录，不写 Program Files 或已签名的 `.app`。打包清单记录来源、版本、SHA-256、模型标识及配套许可文件；在兼容实验中选定版本组合后固定，不在运行时追随 latest。正式包只包含允许再分发的组件，分别报告实际体积。

TensorRT 引擎按 GPU 标识、驱动版本、TensorRT/插件版本、模型哈希、精度及输入形状区分。使用文件锁和原子完成标记，取消或失败的半成品不能作为成功缓存。迁移便携包或更新驱动后，播放器自行判断是否重建；不分发 4090 本机生成的引擎给其他 GPU 直接复用。Mac 不走 TensorRT 引擎编译流程；NCNN/MoltenVK 的预热状态及可持久化缓存按模型、插件、GPU 和系统版本区分，并单独验证 seek 重载成本。

## 播放控制与用户体验

设置中增加“RIFE AI 补帧”，与现有 mpv `interpolation` 明确区分。首版显示关闭／2 倍、实际状态、源／目标帧率和旁路原因。诊断中可查看后端、模型版本、GPU、缓存命中与错误；普通设置不暴露 Python 路径和 TensorRT 参数。

首次开关或遇到需要准备的新输入形状时，后台进行相应平台的引擎准备／模型预热，界面显示“正在准备补帧”；当前视频先正常播放。准备完成后显示“已准备，下次播放生效”，用户可选择从当前位置重新加载并启用。不在长时间编译期间阻塞 mpv 加载 hook 或 UI，也不突然自动重启正在看的视频。

缓存就绪后的新播放可自动启用。播放中修改设置默认下次加载生效；“立即应用”保存当前位置、暂停状态及轨道选择后受控重载。关闭时仅移除大河影院自己的滤镜，并恢复由本功能覆盖的设置。切换影片、停止、取消和迟到的后台结果以播放会话 ID 隔离，不允许旧任务影响新影片。

滤镜用独立标签管理，例如 `@tigerest_rife`。不整体清空 `vf`。首版在“大河内置配置”模式下启用；“系统 MPV 配置”模式显示不可用原因，避免覆盖用户现有 VapourSynth 和滤镜链。即使在内置模式，发现外部 VapourSynth 滤镜或无法证明兼容的用户滤镜组合时也旁路。

RIFE 生效时关闭 mpv 原有时间轴 interpolation，硬解按经实测的 copy-back 路径处理。现有设置写入顺序为视频设置、自定义配置、画质预设；RIFE 对必要选项的临时覆盖必须在这些写入之后统一应用，Shader 切换也须重新协调。移除 RIFE 时只恢复仍由它持有的覆盖，不覆盖用户在此期间作出的新选择。

## 帧处理、错误与性能边界

mpv 的 VapourSynth 脚本会在 seek 时重新加载，Windows 脚本必须复用已有引擎而非重新编译；Mac 须验证重复创建滤镜的模型加载与 GPU pipeline 建立成本，若超过可接受的 seek 延迟，需在插件层优化复用后再验收。正确维护 `_DurationNum` / `_DurationDen`，验证非整数源帧率、尾帧、短视频与重复帧，不能仅靠修改 FPS 标记声称完成补帧。[mpv VapourSynth 文档](https://mpv.io/manual/master/#video-filters-vapoursynth)

YUV 与浮点 RGB 转换须采用输入的矩阵、范围和色彩属性，并正确还原。模型尺寸对齐采用边缘填充后裁切，不能改变画幅。切镜检测命中时使用原帧，避免将两个镜头合成过渡帧；检测规则和阈值与模型一起固定，并用实际切镜样本验证。

状态区分关闭、准备中、已准备、正在补帧、已旁路及失败；“正在补帧”需要滤镜存在且已确认产出符合目标时序的帧，不能由配置开关直接推断。

依赖缺失、驱动不兼容、缓存不可写、准备超时、模型错误或可捕获的滤镜失败，均显示可理解的原因并保持或恢复原帧播放。需要重载才能恢复时，限本次播放一次，并保存进度和轨道，避免重试循环。网络缓冲、暂停和 seek 后的过渡期不得误判为算力不足。

持续性能不足的回退以稳态播放采样为依据：初始规则为排除启动／seek 后 5 秒与缓冲区间，在连续 10 秒窗口内输出丢帧比例超过 5% 或音画偏差绝对值持续超过 100 ms 时旁路。实施中验证统计分母及 mpv 属性含义，验收报告记录调整后的阈值。用户可手动重试，不在本次播放中不断自动重新开启。

原有 Shader 与 RIFE 共享 GPU 资源；不自动修改用户画质档来掩盖性能不足。滤镜／驱动在主进程中的原生崩溃无法由普通错误回退保证恢复，这仍是本方案的可靠性边界；后台准备阶段则可以隔离并报告辅助进程崩溃。

## 验收与实施入口

先验证私有运行环境，再接控制层和 UI，最后打包验收。兼容实验失败时报告实际失败层，不能把只有设置开关的版本当作内置 RIFE 完成。

1. 在未安装 SVP、Python、VapourSynth、CUDA Toolkit 的干净 Windows 环境中，只安装播放器与适配驱动，验证依赖解析、引擎准备及实际推理。另在未安装 Homebrew/Python/VapourSynth/Vulkan SDK 的 Apple Silicon Mac 上验证完整 `.app`；开发机上成功不替代两端独立安装验证。
2. 使用本地和 Emby 直连的 1080p SDR 样本，在 RTX 4090 和实际可用的 M 芯片 Mac 上分别验证 23.976/24/30 fps 的 2 倍输出、实际新增帧、时长、音画同步及切镜画面。每个代表性样本连续播放 10 分钟，预热后的丢帧比例低于 1%、音画偏差绝对值不持续超过 80 ms。记录完整芯片型号、系统和内存；达不到时记录结果并调整模型／范围，不提前承诺性能。
3. 覆盖首次编译、缓存命中、取消、磁盘不可写、损坏／过期缓存、驱动或 GPU 变化，验证界面可操作和缓存不误用。
4. 覆盖快速 seek、暂停／恢复、停止、下一集、重新打开、字幕切换、弹幕、全屏和三套画质档。Windows 原生 GPU-Next 和 Render API 各自验证；Mac 按实际提供的默认后端与兼容后端验证，尤其检查 VideoToolbox 帧回读。不通过的组合明确旁路。
5. HDR、4K、未知帧率、隔行、冲突滤镜、系统配置模式、不支持的 GPU、无 RIFE 运行库均保持正常原帧播放，状态理由准确。非默认倍速播放首版旁路。
6. 控制层自动化测试覆盖时序状态、会话取消、滤镜所有权和选项恢复；适配层用短片验证时长与新增帧；最终 Windows 安装器／便携包及 Mac DMG／应用均验证中文路径、空格路径及普通用户权限。Mac 检查原生 arm64 依赖、无 Rosetta 前提、签名和从 Finder 启动。包中逐一校验运行库清单，不将本机开发环境带入验收。

实现主要接入 `src/player/`、`resources/settings/settings_description.json`、`native/nativeshell.js`、运行库准备入口，以及 `CMakeModules/CompleteBundleWin.cmake.in`、`CMakeModules/PreparePortableZip.cmake.in`、`CMakeModules/CompleteBundleMac.cmake.in` 和两端构建脚本。新组件与测试独立成文件，现有 PlayerComponent 仅接生命周期和状态桥接。当前 Windows 环境无法完成 Mac 实机验收；Mac 构建通过也不代表 M 芯片实时补帧性能通过，交付报告必须分开陈述。

本文为设计结果。完整 RIFE 环境、具体模型组合、端到端效果和性能尚未验证；通过设计审阅后再形成逐项实施计划。
