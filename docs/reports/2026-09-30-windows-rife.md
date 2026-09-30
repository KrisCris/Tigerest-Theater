# Windows RIFE 实施验证记录

更新：2026-10-01。当前状态：共同源码、私有运行库、三模型引擎缓存、真实多倍帧图和共享控制器原型已验证；Windows Player/UI、完整 4K 渲染和发行验收仍未完成。以下保留 9 月 30 日的实验记录，最新候选和结果见文末。

## 共同基线

- 实施分支：`codex/windows-rife-trt`，隔离工作区 `C:\Users\59890\.codex\worktrees\windows-rife-trt\EMBY大河版`。
- 文档基线：`c932990c145b55096eff0c687816dc6acd008a94`。
- 远端 main：`7044cb47a1213c72ad2e8d9ca823700614d26edb`。
- 已合入 Mac RIFE：`55dd5cf52ae1fcb337945a9e0a740755b0af9d69`，保留完整历史；合并提交 `42c44aebaadbeda5f33a09cc6169e6d67cc4fa76`。
- `v2.1.2` 标签仍指向 `3cd0b0d6625a58f7f1331ba28a6e3290a96b7c78`；采用发布说明注明的修复 SHA。版本保持 Mac 分支的 2.1.2，未创建新发行。
- `stopOnEndFile()` 保留异步清理；Mac CoreAudio 热插拔补丁仍仅由 Mac 构建脚本应用。
- Git 直连超时；按本机已配置的 `127.0.0.1:7890` 代理进行单次 fetch 成功。没有修改系统或全局 Git 配置。

## Windows 基线工具链及结果

- `TIGEREST_DEPS_DIR=D:\CodexDeps\TigerestTheater\deps`。
- `TIGEREST_MSVC_ROOT=D:\CodexDeps\TigerestTheater\portable-msvc-source\msvc`，MSVC 19.44.35228.0。
- `TIGEREST_WEBENGINE_RUNTIME=D:\CodexDeps\TigerestTheater\deps\qtwebengine-sync\6.9.3`。
- Qt 6.9.3；开发工具复用原工作区 `dev/windows/deps/tools-venv/Scripts`，没有全局安装。
- `dev/windows/build.bat`：通过，116 个构建步骤，生成播放器和测试程序。
- 第一轮 `dev/windows/test.bat`：17/18 通过；`test_server_onboarding_webengine` 的 CDP Runtime.evaluate 超时。
- 单独重跑失败用例：通过（6.21 秒）；原测试每次创建独立临时 profile。未更改该测试或产品代码；后续完整重跑结果见执行日志。
- Git Bash 调用旧 Windows PowerShell 读取无 BOM 的 UTF-8 辅助脚本时，中文工具路径不能解析；改用本机 pwsh 执行辅助脚本，构建及产品代码不受影响。

## 尚未验收

带 EOF 补丁的两份 Windows libmpv、播放器内真实补帧、10 分钟性能、扩展安装/下载/导入、无开发依赖的干净 Windows、共享代码修改后的 Mac 回归、统一版本产物均未验收。

完整重跑：18/18 通过（16.93 秒，未修改原测试或产品代码）。此前 CDP 超时仍记录为间歇性风险，后续回归保留该用例。

## 私有运行库及真实推理

- R80 / vs-mlrt v15.16 的实际插件加载失败（不再支持 API 3）；R79 加载成功。锁定 R79、Python 3.13.15、标准 TensorRT 10.16.0 / CUDA 13.2.0。
- 私有解释器、VSScript、插件和显卡驱动初始化通过，报告显卡 RTX 4090，compute capability 8.9；不依赖系统 Python/CUDA Toolkit。
- 已组装运行库 `rife-trt-r79-15.16-py3.13.15-1`，展开文件总计约 2.523 GB；包含一个 22,518,498 字节的 RIFE 4.25 lite ONNX。保留所有标准 TensorRT 架构资源，未裁剪为 4090 专用包。
- 模型 SHA256 `026605086bd5782581cb3d846e16eec326d368af109f78cf8113883bff2e9e66`；来源为 vs-mlrt external-models 附件，尚未证明与 Mac 的 PyTorch 权重等价。
- 256×128 运动样本的真实中间帧与左右输入平均绝对像素差分别约 0.02972、0.03034（float RGB）。生成引擎 12,638,948 字节；首次实验编译约 44 秒。小样本的整次帧请求约 22 ms，包含调度/拷贝，不能当作 1080p 性能或精确 GPU 推理耗时。
- DLL 审计通过；Defender 的 MpOAV.dll 注入按注册服务路径和离线 Authenticode 单独核实。任意同名外部 DLL 仍被拒绝。
- 开发准备测试覆盖损坏归档不影响已有目录、离线缺依赖拒绝；运行库测试覆盖路径穿越、未列出的模块、损坏文件、缺私有 Python 和重复探测不写坏清单。真实推理测试通过。新增 5 个 CTest 项通过（7.79 秒），后续补丁还在继续验证。
- 首轮 CI 构建因未先构建交叉编译器失败；已补上 gcc 步骤，两个架构正在构建。冻结 FFmpeg `2a20737f662fd3f3f5999e873b9e7c90b5efc375`、libplacebo `4d82c6898551068d4ae6a6b5538efcddc2c7cf64` 与原 DLL 的版本一致。
- trtexec 在中文 timing-cache 路径产生锁文件告警，成功生成的引擎已实际执行。正式缓存层仍需处理，不能标记缓存管理完成。
- 包压缩大小、许可证/对应源码材料、真实媒体 EOF、干净系统均尚未验收。

## 2026-10-01：三目标与模型实现选择

用户指定的验收目标为：1080p 补到 60 fps 后由 Tigerest 默认 mpv 配置渲染到 4K；1080p 补到约 240 fps 后渲染到 4K；原生 4K 60→120 fps。120/240 采用接近目标的整数倍，例如 23.976→119.88/239.76。超高帧率与 4K 属于独立目标，当前未通过不会被标为通过，也不自动降低推理分辨率。

- 最新选择 `rife-trt-r79-15.16-py3.13.15-2-v2`，TensorRT 10.16 / CUDA 13.2，三个模型均使用上游 v2 ONNX 导出、7 输入通道、FP16 输入输出和内置填充。坐标/除法层按上游规则保留 FP32；没有在推理前缩小图像。原 v1 的 11 通道/FP32 I/O 路径保留回归覆盖，但不作为 Windows 默认运行库。
- 展开清单为 2,632,245,282 字节，运行库文件指纹 `e397c7cffa8033c60309ed605129aed77c59e618b7c30836d7106c1f14764780`。三个 v2 模型大小为 22,538,831／22,748,049／86,685,613 字节，具体 SHA256 固定于 `dev/windows/rife/runtime-lock.json`。运行库保留全部标准 TensorRT 显卡架构资源。
- 对比了 vs-mlrt v15.13 / TensorRT 10.13 候选。相同 v2 / FP16 I/O / 两推理 stream / 四线程与预取条件下，1080p lite 滤镜约 282/163 fps，当前版本约 279/160 fps（两倍/十倍）；没有发现足以抵消旧运行库维护成本的优势。选用当前 10.16，性能提升主要来自 v2 导出及 I/O，而非版本回退。
- 实机 RTX 4090、24 GB、compute capability 8.9、驱动 616.64（文件版本 32.0.16.1664）。其他用户程序保留运行，未把测量推广到其他显卡。

以下为可复现工具 `dev/windows/rife/benchmark_filter.py` 的**合成 VS 滤镜吞吐**，每项排除前 3 秒、测量 15 秒，VS 四线程、两推理 stream、预取四帧。输入为无切镜的交替 YUV420P10；实际合成帧计数经验证。它不包含解码、Shader、4K 渲染、音频或显示，因此仅是下一阶段的容量判断，不能替代 10 分钟播放验收。原始 JSON 位于 `docs/reports/data/2026-10-01-windows-rife-filter.json`。

| 模型 | 1080p 30→60：滤镜输出 fps | 1080p 24→240：滤镜输出 fps | 原生 4K 60→120：滤镜输出 fps |
| --- | ---: | ---: | ---: |
| 4.25 lite | 274.69 | 157.15 | 25.36 |
| 4.25 | 222.62 | 127.00 | 23.38 |
| 4.25 heavy | 246.42 | 140.68 | 24.70 |

lite 的 trtexec 测量（无数据传输，CUDA graph，预热 1 秒、测量 5 秒）为：1080p 202.62 次/秒、GPU 平均 4.934 ms；4K 47.80 次/秒、GPU 平均 20.919 ms。1080p 24→240 需要约 216 次/秒推理，4K 60→120 需要约 60 次/秒；这两个目标目前连纯 GPU 容量都不足，4K 还存在明显的滤镜/传输开销。该 trtexec GPU 时间也不作为播放时的实时诊断值。三模型视觉质量及真实解码/渲染稳态性能尚未验收。

## 2026-10-01：帧图、缓存与控制器回归

- 8 个 v2 引擎（lite 256×128、240×112，以及三模型的 1080p/4K）均由私有 Python 创建，实推理验证像素后才原子提交。首次准备约 44–109 秒。缓存身份包含显卡 UUID/驱动/CC、完整运行库指纹、模型哈希、精度、实现与尺寸；文件锁、大小/SHA256 和原子完成标记拒绝半成品/损坏缓存。
- 播放图不编译或下载。已验证原帧逐字节保真、整数多倍时长、不同时间点生成帧、YUV 色彩范围、内部填充、切镜、奇数帧/多倍尾帧、EOF 前不请求不存在的邻帧，以及 HDR/VFR/隔行/颜色不明的旁路。18 个真实私有 VS/TRT 帧图用例（含真实 `interpolate_trt.vpy` 和 Monitor DLL）通过。运动样本为 256×128；六个全尺寸引擎另有常量对验证，不冒称完成全尺寸运动质量验收。
- CfrTiming 的去重和累积漂移检查由锁覆盖，防止并行回调重复累计。懒构建 TRT 图另加锁，修复 native 模型构建释放 GIL 时的竞争。v1 坐标平面改为批量行复制，结果与上游四个输入平面逐值一致。
- 编译进程由 Windows Job 管理，取消/超时能中断阻塞原生验证，杀死本任务子孙进程，且不提交未验证引擎。测试实际覆盖三层进程链，public wrapper 被终止时没有遗留编译器；不操作用户其他进程。
- 主程序和 VS Monitor 链接同一份轻量 `tigerest-rife.dll`；跨 DLL 集成测试实际取十帧并确认主程序读到插件更新，而非各自静态注册表。
- Windows 控制器支持最高 4K/60 fps、2–15 倍和已经准备的引擎，格式变化整片旁路。性能 guard 使用 5 秒排除期、10 秒窗口、超过 5% 丢帧或持续超过 100 ms AV 偏差触发原帧回退；暂停/seek/缓冲重置窗口，VO 与 decoder 丢帧分母分别测试。Mac 默认 1080p/30 fps/2 倍及其 guard 规则保留。
- Windows 不具备精确 GPU 计时接口，诊断始终 `timingAvailable=false`、`p95Ms=null`；准备阶段也不显示假的 0 ms。Core ML 超过 30 次预热预测后才显示已有 p95。只读审查发现的进程监督、时序竞争和准备期诊断问题均已先复现失败，再修复并关闭。
- 最新完整 `dev/windows/build.bat` 与 `dev/windows/test.bat`：**36/36 CTest 通过，86.69 秒**；真实 v2 引擎、帧图和共享 DLL 环境已启用。默认三模型 v2 离线准备另行实跑通过（4 用例、105.18 秒），独立真实 motion smoke 通过。Mac 测试逻辑在 Windows 的共同控制器用例中通过，但尚未取得 Mac 编译结果。

## 2026-10-01：mpv CI 尚未交付 DLL

Windows RuntimeManager 已完成独立层验证：私有运行库探测、Qt/Python 一致的缓存身份、按模型/尺寸选择缓存、异步准备、取消及过期结果隔离。真实私有进程探测和已有小尺寸引擎的跨语言缓存命中通过，不在测试中重新编译。只读审查发现缓存命中排队通知未取消、同步 preparationStarted 重入后仍启动旧任务、probe wrapper 子孙未清理；三种失败已复现并修复，SHA256 空值误判也已关闭。同尺寸缓存内容损坏会拒绝命中。新增探测链测试的 native fixture 不持有自己的 Job，仍能随 wrapper 终止，确保由外层承担清理。

最新完整构建和 CTest 为 **37/37 通过，45.14 秒**，真实 v2 图、私有进程及冻结配方环境启用。Manager 尚未接入 Windows Player 或安装器；当前开发运行库清单仍记录旧 probe helper，后续冻结扩展时须纳入新 helper 并重新生成运行库/引擎身份。

固定内核 dd5d17d328 与原配方 cd1edc11dc6；冻结依赖保留配方的显式 GIT_RESET，不用移动分支覆盖它。已修复 detached 源码清理、git-am committer、Meson 版本和 GNU 同哈希镜像下载问题。

CI 36745960700 的两个架构均在 ngtcp2 的 QUIC 检查失败。完整 CMake 日志证实 compression 库位于 CFLAGS、排在 libcrypto 前，静态链接产生 Brotli/zlib/zstd 未定义引用，进而误报 OpenSSL 不支持 QUIC；固定 OpenSSL d8bf6cdd4 已确实检出。a5be125 将依赖附加到 OpenSSL 链接库之后，补丁在冻结 ngtcp2 源码上实际应用并通过 CMake 库列表验证。

CI 36752790588 已通过 ngtcp2，在 LuaJIT 补丁阶段失败。原配方的 UTF-8 文件系统补丁在 Makefile 上引用了较新源码的两行上下文，而冻结的 OpenResty LuaJIT 1edc3e5 不具备这些行。现在只适配这两行未修改的上下文，保留全部 UTF-8 功能变更；以 git apply 应用，生成的补丁随 DLL 保存并计算哈希。已在实际冻结源码上复现原补丁失败，新补丁实际应用通过，三项配方回归通过。35602b3 触发 CI 36761087304，两架构仍需成功构建；尚无成功 DLL。

仍需验证两份 DLL 的一帧/两帧自然结束与颜色属性，接入 Windows Player/UI，完成默认配置 4K 渲染/十分钟稳态、扩展安装与发行材料、干净 Windows 和同源码 Mac 产物。本报告不将以上原型测试视为播放器或统一发行已经完成。

## 2026-10-01：原生加载与播放协调原型

- 新候选为 `rife-trt-r79-15.16-py3.13.15-3-v2`，包含修复后的探测进程树清理。展开文件 2,632,245,589 字节，指纹 `f78c0d6669b89c0efe644ceb818282ddb4b058c7322ac96f6f5f3261807a413d`。旧运行库及上述性能记录的指纹保留；新版本重新编译缓存，不将旧身份的引擎冒充新身份。
- `RifeVSScriptRuntime` 从全新原生进程激活私有 Python，以 wide Windows 环境 API 处理中文路径，保留进程级 DLL 搜索目录；拒绝已加载的外部同名 Python/VS。R79 使用旧 Python 初始化 API，故必须在初始化前设置固定 CPython 3.13 的隔离、忽略环境、禁 site 和禁写 bytecode 标志。真实 VSScript 帧请求、恶意 PYTHONHOME/PYTHONPATH 隔离、外部 DLL 拒绝及加载后全文件清单完整性均通过。
- 启动次序必须早于 `mpv_create()`：固定 mpv 的 Windows 环境读取会缓存整份环境。Coordinator 首个格式事件只验证已有激活，不负责第一次激活。此边界已审查修正；直接 DLL 测试不能替代待完成的真实 mpv 启动入口回归。
- `RifePlaybackCoordinator` 已验证冷缓存原帧播放、准备完成仅通知、下次播放使用完整缓存、切片/停止/动态格式/倍速取消和旧结果隔离。seek 保留同尺寸编译并重置图/性能状态；恢复 1 倍速不在本片重新开启。默认协调器在启动未激活时拒绝挂载且不改环境。Player 尚未连接这些接口。
- `dev/windows/build.bat` 通过；完整 CTest **40/40 通过（45.61 秒）**，含真实私有 GPU 帧图、全新 native VSScript 和加载后完整性检查。首次完整轮次的实际探测等待采用了 fake worker 的 5 秒限额而超时，单独复测通过；真实探测测试现按 Manager 的 75 秒限额等待，并记录失败诊断。fake worker 仍用 5 秒限额。
- Windows 私有 core 补丁曾误写 `vsccfDisableAutoLoading`。实际应用补丁后提取完整 `drv_vss_load_core`、以冻结的 VS 头文件编译，复现未声明标识符；改为 `ccfDisableAutoLoading` 后通过。该编译检查已移到大型 CI 媒体构建之前。
- CI 36761087304 的兼容架构已经通过 LuaJIT，随后 curl 的 ECH 检查因 static libcrypto 的压缩依赖放在 CFLAGS 中而产生链接失败。新补丁把依赖附到 `OpenSSL::Crypto` 的传递链接列表，同时作用于检测及最终链接；实际冻结 curl 源码的补丁/CMake 目标回归通过。剩余停滞的旧 v3 工具准备任务已取消。
- CI 36768668690 在重新解析依赖时遇到临时裸 Git 目录清理失败，尚未进入媒体构建。源码锁现保存先前成功冻结的全部提交，由 CI 对原配方逐条核对仓库、原 ref、显式 GIT_RESET 与固定 SHA；每次构建不再重新解析移动分支。缺项/错仓库/ref/SHA 拒绝的测试通过。最终两份 libmpv 仍未成功构建，不能计作 EOF 或整机性能通过。
- 新增真实 mpv 启动回归，以现有官方 dd5d17d DLL 在两个全新原生进程中对比早/晚激活：早激活通过 mpv 加载测试视频和 VS 脚本，执行全部私有 Python 隔离断言；晚激活必须无成功标记且收到精确的 VSScript 加载失败日志。两项通过（0.18/0.09 秒），启动次序问题已在实际 mpv 环境读取路径上得到验证。此用例只证明解释器执行，未检查图出帧，仍不能替代补丁 DLL 的 EOF/RIFE 验收。加上补丁和配方测试，四项 targeted CTest 全通过（3.37 秒）。

## 2026-10-01：当前验证与性能参数对比

- 新运行库 3-v2 的八个缓存全部重新验证，三模型的 1080p/4K 首次准备约 53–110 秒；小尺寸原生帧图 18 项通过。完整构建和 CTest **42/42 通过（46.86 秒）**，包括实际 mpv 早/晚启动回归。新的 EOF-aware stream 测试未包含在这 42 项中。
- 新建 fresh native stream host 和真实媒体用例，准备逐一检查一/二/三帧自然结束、显式/未知颜色，以及真实 TRT 2/5/10 倍的逐索引合成标记、每帧与总时长、尾帧和同一共享 Monitor 注册表。以 stock DLL 运行时明确失败于不支持 `eof-aware`（vf add -12）；尚无 patched DLL 的绿色结果。CMake 只给显式 `RIFE_TEST_EOF_MPV_DLL` 注册该项，不依赖旧启动测试的 DLL 环境变量；TRT 子项另需明确 `RIFE_TEST_STREAM_PREPARED`。host 编译和独立 gate 注册检查通过。
- lite 的 builderOptimizationLevel 5 对比已完成。1080p/4K 编译约 245/441 秒，常量像素实推理和私有 DLL 审计均通过。纯 GPU 吞吐 199.60/48.27 次每秒、平均时间 5.009/20.716 ms，与此前默认 level 3 的 202.62/47.80 接近；保留 level 3，不让用户承担额外编译成本。实验引擎不进入正式缓存。数据见 `data/2026-10-01-windows-rife-opt5.json`；测量使用 FP16 I/O、上游 FP32 层保护、noTF32、maxAuxStreams=0、noDataTransfers、CUDA graph、1 秒预热及 5 秒样本。
- 3-v2 的 4K lite 滤镜以 4线程/4预取、8/4、8/8、16/16 顺序测得 26.09、26.06、25.68、23.91 输出 fps，各排除 3 秒、采样 15 秒。没有线程增加带来的收益，保留 4/4。工具增加显式 `--threads/--prefetch`，默认值保持原值；正式工具 8/8 再次验证通过。数据见 `data/2026-10-01-windows-rife-threads.json`。加载时 PCIe Gen4×16、GPU 2715 MHz；单次观察 GPU 利用率 28%，不足以据此定位全部开销。该测量仍不包含解码、Shader、渲染或音频。
- CI v3 媒体编译仍在运行。兼容架构的工具准备曾因拉取非必要的 TeX/MuPDF 文档依赖超时；改用 asciidoc-base 和 no-install-recommends 后，单架构重新构建的工具准备通过，媒体构建仍待结束。锁定的全部媒体依赖、mpv 和补丁来源保持不变。
