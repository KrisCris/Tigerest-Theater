# Windows RIFE 私有运行库（开发中）

这套工具生成独立于系统 Python、VapourSynth、CUDA Toolkit 和 SVP 的运行库。
主安装器不包含这些大型依赖。当前只有开发验证；尚未接入 Windows 播放器设置，不能据此声称播放器补帧已经完成。

## 固定依赖

`runtime-lock.json` 固定 Python 3.13.15 embeddable、VapourSynth R79、vs-mlrt v15.16
标准 TensorRT 10.16.0 / CUDA 13.2，以及外部模型包的 RIFE 4.25 lite、4.25、4.25 heavy。
Windows 默认选用 v2 导出、7 通道 FP16 输入输出和内部填充；坐标/除法层遵循上游 FP32 保护。
R80 能导入，但移除了 vstrt 所用的 API 3，实际加载失败，因此采用已验证的 R79。
没有使用 TensorRT-RTX 或其他推理后端。

模型归档来自 vs-mlrt 的 external-models 发布附件；该附件没有上游 SHA256，锁文件保存
从官方 HTTPS 下载计算出的哈希。它与 Mac 模型同名，尚未证明权重逐项等价。
运行库暂保留标准 TensorRT 的所有显卡架构资源；不把 4090 的结果推广到其他显卡。

## 开发准备与验证

在仓库根目录执行（只在开发阶段下载；不做全局安装）：

```powershell
python dev/windows/rife/prepare_runtime.py --output 'build/rife/私有 运行库 R79'
python dev/windows/rife/probe_runtime.py --runtime 'build/rife/私有 运行库 R79' --report build/rife/probe.json
$env:RIFE_TEST_RUNTIME=(Resolve-Path 'build/rife/私有 运行库 R79').Path
python -m unittest discover -s tests -p 'test_rife_runtime*.py' -v
python -m unittest discover -s tests -p test_rife_inference.py -v
```

已有官方归档时增加 `--archives DIR --offline`。输出目录必须尚不存在；下载哈希、归档
路径、文件清单全部通过后才将暂存目录原子移入输出位置。离线缺依赖不会退回系统安装。
7zr 26.03 是固定哈希的开发解压工具，用于读取 BCJ2；不进入运行库。

辅助进程使用私有解释器 `-B -I -S -X utf8` 和相对 `_pth`，禁用插件自动发现。
文件清单拒绝未知文件，辅助进程不在运行库里生成字节码或引擎。
DLL 审计只允许选定运行库、Windows 系统库和显式指定的 mpv；Windows Defender 的
MpOAV.dll 注入另行记录，要求路径属于注册的 WinDefend 服务并通过离线 Authenticode 验证。

真实推理测试以 256×128 的移动矩形和纹理验证中间帧与前后帧的差异。`frameRequestMs`
是整次请求耗时，包含转换、调度和拷贝，**不代表精确 GPU 推理时间**。
首次编译允许 15 分钟。上游 trtexec 在含中文的 timing-cache 路径上出现锁文件告警；
正式缓存由 `prepare_engine.py` 管理，直接构建静态引擎并避开上游 timing-cache 锁。
缓存只有在完整推理验证、大小/SHA256 和原子完成标记均通过后才可用于播放。
取消、15 分钟超时和 Windows Job 子进程树清理已经覆盖自动回归。

准备和滤镜阶段的可复现实测（路径由本机选择）：

```powershell
# request.json 只包含 runtime、cache、model、width、height，可选 deviceId/cancelFile/generation。
python dev/windows/rife/prepare_engine.py --request request.json --result ready.json
python dev/windows/rife/benchmark_filter.py --runtime RUNTIME --prepared ready.json --width 1920 --height 1080 --fps 24 --factor 10 --streams 2 --duration 15 --output filter.json
```

该工具明确排除解码、Shader 和渲染。`consumerFrameWaitP95Ms` 是消费者等待，
不作为 GPU 推理耗时；播放诊断中无精确 GPU 计时时返回 null。
三个目标及三模型的实测、测试范围和未通过项见 `docs/reports/2026-09-30-windows-rife.md`。

## mpv 内核

保留源版本 dd5d17d3285a095a0f712fa9d116e22a076492de 与 shinchiro 配方
cd1edc11dc6887a50f705717619d879f5a93a488。冻结的 FFmpeg、libplacebo 提交已匹配原 DLL
实际版本。共用 Mac EOF/颜色元数据补丁；另加 Windows EOF-aware 会话禁用插件自动加载的补丁。
`build_mpv.py` 检查来源与补丁适用性；实际交叉编译由 `build-rife-mpv.yml` 执行，必须先
构建 gcc，再构建 mpv。兼容 x86-64 和 AVX2 x86-64-v3 均须通过真实媒体验证。
`mpv-source-lock.json` 保存 CI 36761087304 成功冻结的源提交；CI 对原配方
验证该锁，不在每次构建重新解析移动分支。ngtcp2/curl 的 static OpenSSL
补丁保留原版本与功能，并修正压缩库的传递链接顺序。

普通 x64 的真实 EOF/色彩及 tiny TRT 流式测试已连续 10 轮通过。首次 v3
产物在解码器列表登记的结构体传值中触发 GCC 14.4 Win64 AVX 栈对齐错误，
不作为可用内核。`mpv-win64-hwdec-pointer.patch` 通过指针参数及局部副本
保持原语义，Windows GCC-only `noipa` 阻止 IPA 重建该传值 ABI；新产物仍需
实际流式测试和反汇编验收。不得仅因编译成功或补丁适用就接受 v3 DLL。
CI 复用旧媒体缓存前核对固定旧提交和所有依赖配方字节，命中后必须重建
mpv 并移除本次构建目录内旧 DLL 输出。不能用旧 DLL 填写新源码来源。

主程序的私有加载必须在 `mpv_create()` 前完成完整探测和激活，Windows mpv
会缓存环境变量。播放 Coordinator 只验证既有激活；新 native 加载测试验证
隔离 Python、中文路径、外部同名 DLL 拒绝及不写入 bytecode，不能替代真实
mpv 启动/EOF 集成验收。

## 发布前仍需完成

真实 Windows 媒体/EOF 测试需设置 `RIFE_TEST_RUNTIME` 和
`RIFE_TEST_EOF_MPV_DLL` 后重新配置 CMake；它调用独立 native host。
小尺寸 TRT 子项另需 `RIFE_TEST_STREAM_PREPARED` 指向完整的 256×128
prepare_engine 成功报告，CTest 自动提供 Monitor DLL 路径。现有 stock
DLL 不支持 eof-aware，会明确失败。显式 EOF gate 的上述 fixture 环境在
CMake 配置时保存，避免重新运行 CTest 时静默跳过已配置的真实用例。
滤镜吞吐工具支持 `--threads`、`--prefetch`，两项默认均为 4；它仍不测
解码、Shader、4K 渲染、音频和显示性能。

播放器生命周期与真实 EOF、完整缓存、扩展安装/下载、10 分钟播放和干净系统测试仍未完成。
许可证文本已开始收集（Python/VS 在各自包中；vs-mlrt GPLv3、Practical-RIFE MIT、
TensorRT SLA 在 licenses 中）。公开分发前还需补齐 CUDA/VC 运行库通知与准确的对应源代码，
并核实组合分发条款。当前实验运行库不得当作完成版权材料的发行附件。
