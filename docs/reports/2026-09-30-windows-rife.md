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

固定内核 dd5d17d328 与原配方 cd1edc11dc6；冻结依赖保留配方的显式 GIT_RESET，不用移动分支覆盖它。已修复 detached 源码清理、git-am committer、Meson 版本和 GNU 同哈希镜像下载问题。

CI 36745960700 的两个架构均在 ngtcp2 的 QUIC 检查失败。完整 CMake 日志证实 compression 库位于 CFLAGS、排在 libcrypto 前，静态链接产生 Brotli/zlib/zstd 未定义引用，进而误报 OpenSSL 不支持 QUIC；固定 OpenSSL d8bf6cdd4 已确实检出。a5be125 将依赖附加到 OpenSSL 链接库之后，补丁在冻结 ngtcp2 源码上实际应用并通过 CMake 库列表验证。

CI 36752790588 已通过 ngtcp2，在 LuaJIT 补丁阶段失败。原配方的 UTF-8 文件系统补丁在 Makefile 上引用了较新源码的两行上下文，而冻结的 OpenResty LuaJIT 1edc3e5 不具备这些行。现在只适配这两行未修改的上下文，保留全部 UTF-8 功能变更；以 git apply 应用，生成的补丁随 DLL 保存并计算哈希。已在实际冻结源码上复现原补丁失败，新补丁实际应用通过，三项配方回归通过。两架构仍需 CI 成功构建；尚无成功 DLL。

仍需验证两份 DLL 的一帧/两帧自然结束与颜色属性，接入 Windows RuntimeManager/Player/UI，完成默认配置 4K 渲染/十分钟稳态、扩展安装与发行材料、干净 Windows 和同源码 Mac 产物。本报告不将以上原型测试视为播放器或统一发行已经完成。
