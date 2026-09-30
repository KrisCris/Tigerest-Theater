# Windows RIFE 实施验证记录

日期：2026-09-30。当前状态：完成共同源码整合与 Windows 基线构建；TensorRT 运行库与播放器接入正在实施，未达到发布验收。

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
