# Windows 测试启动环境

原生测试程序位于 `build/tests`，没有安装包旁的完整运行库和 `qt.conf`。直接运行会弹出缺少 `libmpv-2.dll` 或 Qt platform plugin 错误框。**每次测试都必须在同一个 PowerShell 进程中先加载环境脚本**；上一次工具调用中的环境变量不会延续。

```powershell
. ./dev/windows/Enter-TestEnvironment.ps1
ctest --test-dir build --output-on-failure --timeout 90
```

使用其他构建目录：

```powershell
. ./dev/windows/Enter-TestEnvironment.ps1 -BuildDirectory 'D:/build/tigerest'
ctest --test-dir 'D:/build/tigerest' --output-on-failure --timeout 90
```

脚本从 CMakeCache 读取 Qt、MPV 和工具路径，检查 DLL、`qwindows.dll` 和 `qoffscreen.dll`，设置 PATH、QT_PLUGIN_PATH、QT_QPA_PLATFORM_PLUGIN_PATH 和 Qt 控制台日志。缺失文件时直接报错，停止测试；不要靠反复启动程序查缺哪一个 DLL，也不要修改用户已安装播放器解决测试环境问题。

无窗口的单项策略测试可以额外设置 `QT_QPA_PLATFORM=offscreen`；真正的窗口、WebEngine、播放测试使用默认 Windows 平台，不要把 offscreen 留给整套测试。Qt GUI 测试需要文字报告时加 `-o 路径,txt`，避免把无 stdout 误判为未执行：

```powershell
. ./dev/windows/Enter-TestEnvironment.ps1
$env:QT_QPA_PLATFORM = 'offscreen'
./build/tests/test_windowmanager.exe testMovingToAnotherScreenRefreshesPlaybackPolicy -o build/screen-policy.txt,txt
Get-Content build/screen-policy.txt
```

先按 `dev/windows/build.bat` 配置并编译，再测试；完整客户端检查前用 `cmake --install build` 更新暂存包。消息 UI 测试用隔离账号 fixture：

```powershell
. ./dev/windows/Enter-TestEnvironment.ps1
node tests/test_community_messages_ui.cjs 'build/output/Tigerest Theater.exe' --webengine
```

播放测试使用独立配置目录，不复制真实认证凭据到 fixture，也不向生产评论服务写入测试评论或已读状态。屏幕刷新率如临时改变，结束时必须恢复。此前的两个启动错误分别来自遗漏 MPV DLL 路径和遗漏 Qt 平台插件路径；都属于测试环境，不代表播放器需要重装。

不要额外把 QTWEBENGINEPROCESS_PATH／RESOURCES_PATH／LOCALES_PATH 指向未经部署的 QtWebEngine 构建目录。集成测试使用应用自身的部署资源；混用目录会令页面执行超时，即使旧安装版也会复现。独立发行包冒烟测试应移除工具链 PATH 和 Qt 环境覆盖，确认只靠包内运行库启动。
