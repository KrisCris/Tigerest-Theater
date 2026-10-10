# Android 2.5.1 本地更新器验证

2026-10-09，在隔离工作区 `C:\A\tigerest-android` 构建工程版本 2.5.1（versionCode 2050100）。本文记录本地源码和构建验证；不表示已发布新版或完成真机更新验收。

## 完整构建与单元测试

同一次 PowerShell 调用设置工具链后执行：

```powershell
$env:JAVA_HOME='D:/CodexDeps/TigerestTheater/android/java/jdk-21.0.12.1+1'
$env:ANDROID_HOME='D:/CodexDeps/TigerestTheater/android/sdk'
& 'D:/CodexDeps/TigerestTheater/android/gradle/gradle-8.13/bin/gradle.bat' -p 'C:/A/tigerest-android/android' testDebugUnitTest lintDebug assembleDebug assembleRelease '-Pkotlin.incremental=false' --console=plain
```

最终重建实测退出码 0，`BUILD SUCCESSFUL in 29s`，106 个任务（23 执行、83 最新）。完整 JVM 套件共 111 项，失败、错误、跳过均为 0。更新器共 45 项（Source 4、Engine 10、InstallSession 2、Policy 4、Resume 13、Transfer 12）；弹幕匹配共 23 项。Lint 为 0 错误、39 警告，更新器生产文件没有 Lint 警告。此次重建包括“查询标题与候选标题都显式写出第二季”的匹配修复，以及多位英文季度序号修复：11th、12th、21st、23rd 等先匹配完整序号，避免被更短的末尾序号误识别为第 1／2／3 季。

原始测试报告在 `app/build/test-results/testDebugUnitTest/TEST-*.xml` 与 `app/build/reports/tests/testDebugUnitTest/index.html`；Lint 报告在 `app/build/reports/lint-results-debug.xml` 和同名 HTML。最终 Gradle 标准输出已保存到仓库根目录的 `build/update-integration-2026-10-09/android-final-build.log`。

新文件引入后曾遇到 Kotlin 增量编译将已存在的 `resumeOffset` 报为无法解析；关闭增量编译后恢复，最终完整检查使用上述参数。未改动工程的持久 Gradle 配置。编译输出还包含现有 `setDecorFitsSystemWindows` 与 `announceForAccessibility` 弃用提示，以及 `android.overridePathCheck` 实验选项提示。

## 先失败、后通过的回归验证

以下失败均在实现对应修复之前观察到，最终完整套件已包含并通过这些测试。早期 RED 控制台输出保留在工具调用记录，JUnit XML 会被后续 GREEN 运行覆盖。显式季度查询的最后一次 RED 另保存到仓库根目录的 `build/update-integration-2026-10-09/android-season-query-red.log`。

| 测试批次 | 修复前实际结果 | 最终结果 |
| --- | --- | --- |
| `AppUpdateResumeTest` 初始四项：完整缓存、暂停进度、中断自动续传、下载尾端中断 | 4 项、4 失败；断言失败／ComparisonFailure | 通过 |
| `AndroidAppUpdateSourceTest`：真实 HTTP Range、416、503、完整缓存避免网络 | 4 项、4 失败；错误响应处理或请求／字节断言不符 | 通过 |
| `cancelledLateFailureCannotDeletePrefixOwnedByContinue` | 1 项、1 失败；最终状态不是 ready | 通过 |
| 相同前缀被 200 重写、旧最高进度以内的前缀反复波动 | 2 项、2 失败；错误重置预算，超过预期请求次数 | 通过 |
| `explicitSeasonInBothQueryAndCandidateStillIdentifiesTheWork` | 1 项、1 失败；原逻辑错误拒绝同名同季结果，NPE | 通过 |

传输测试另覆盖严格 Content-Range、200 覆盖、短响应和读取异常保留字节、错误长度／超量数据拒绝、取消后读取出的块不再写入。完整缓存不会重新请求网络，但仍需通过最终 SHA-256 与 APK 身份验证，安装交接前再次验证。

## APK 输出

| 本地产物 | 大小（字节） | SHA-256 |
| --- | --- | --- |
| `app/build/outputs/apk/debug/app-debug.apk` | 88879779 | `d7d2813f10821247be7e2dbf8102edfe8199e1918b78263a70ccfa1cda0e13d2` |
| `app/build/outputs/apk/release/app-release-unsigned.apk` | 86639915 | `62d19a0835914aefbadec8a6804c8e7b5e887fa01873b0f6a39d98f6284c76a1` |

对两份产物分别运行 `python android/tools/verify_apk.py <APK>`，退出码均为 0：20 个原生库的哈希均与锁文件一致，ELF PT_LOAD 及 ZIP 数据偏移均满足 16 KB 对齐。详细结果是 APK 旁的 `.verification.json`。正式签名和已发布版本证书比对由主任务记录，未签名 APK 的上述哈希不能代替最终签名包哈希。

主任务随后使用既有签名密钥生成包含最终季度查询及多位英文序号修复的 `TigerestTheater-2.5.1-android.apk`：86,669,270 字节，SHA-256 为 `342c146a3e0df29f6ad7e82554e1801771c76b636f07d326419e022656436c89`。`apksigner verify --verbose --print-certs` 通过；证书 SHA-256 为 `d936433bfa928ea9cb67bed07a7e529edca4257cb2ff3e43f1804d495bcdc344`，与已发布 2.5.0 相同。签名包再次通过原生库固定摘要与 16 KB 对齐检查；日志位于 `build/update-integration-2026-10-09/android-signing.log`。

## 验证范围

本次没有安装、覆盖或启动用户设备上的播放器，没有修改其数据或设置。HTTP 验证使用 JVM 本机 MockWebServer，缓存使用测试临时目录；APK 身份规则由 JVM 夹具验证。本次没有执行 Android PackageManager 的真机签名解析、系统安装确认、GitHub 生产 API／资产网络传输或真实生产播放验收。原生库对齐检查不能代替 16 KB 页设备上的实际运行验证。
