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

真实 TensorRT 生成帧、带 EOF 补丁的两份 Windows libmpv、10 分钟性能、扩展安装/下载/导入、无开发依赖的干净 Windows、共享代码修改后的 Mac 回归、统一版本产物均未验收。

完整重跑：18/18 通过（16.93 秒，未修改原测试或产品代码）。此前 CDP 超时仍记录为间歇性风险，后续回归保留该用例。
