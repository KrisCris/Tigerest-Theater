# Windows RIFE 私有运行库（开发中）

这套工具生成独立于系统 Python、VapourSynth、CUDA Toolkit 和 SVP 的运行库。
主安装器不包含这些大型依赖。当前只有开发验证；尚未接入 Windows 播放器设置，不能据此声称播放器补帧已经完成。

## 固定依赖

`runtime-lock.json` 固定 Python 3.13.15 embeddable、VapourSynth R79、vs-mlrt v15.16
标准 TensorRT 10.16.0 / CUDA 13.2，以及外部模型包的 RIFE 4.25 lite ONNX。
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
引擎仍成功生成并执行，但正式缓存管理尚需解决此问题。

## mpv 内核

保留源版本 dd5d17d3285a095a0f712fa9d116e22a076492de 与 shinchiro 配方
cd1edc11dc6887a50f705717619d879f5a93a488。冻结的 FFmpeg、libplacebo 提交已匹配原 DLL
实际版本。共用 Mac EOF/颜色元数据补丁；另加 Windows EOF-aware 会话禁用插件自动加载的补丁。
`build_mpv.py` 检查来源与补丁适用性；实际交叉编译由 `build-rife-mpv.yml` 执行，必须先
构建 gcc，再构建 mpv。兼容 x86-64 和 AVX2 x86-64-v3 均须通过真实媒体验证。

## 发布前仍需完成

播放器生命周期与真实 EOF、完整缓存、扩展安装/下载、10 分钟播放和干净系统测试仍未完成。
许可证文本已开始收集（Python/VS 在各自包中；vs-mlrt GPLv3、Practical-RIFE MIT、
TensorRT SLA 在 licenses 中）。公开分发前还需补齐 CUDA/VC 运行库通知与准确的对应源代码，
并核实组合分发条款。当前实验运行库不得当作完成版权材料的发行附件。
