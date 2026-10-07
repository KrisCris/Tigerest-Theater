# V2.4.2 启动检查与应用内更新验收

状态：Windows / Android 候选包已构建，尚未发布新版本；Mac 共用更新后端已实现，平台构建和实际运行结果单独记录。

## 已确认的行为

用户批准的范围为 Windows、Apple Silicon Mac、Android：每次启动后台检查正式发布，只有当前平台存在可安装的新包才提示；提供立即更新、稍后、跳过版本、手动检查和自动检查开关。界面沿用深色金色风格。

原生后端固定读取本项目 GitHub Releases，按数值比较稳定版本，排除草稿和预发布，并要求精确平台包名、官方 HTTPS 下载地址、大小及 SHA-256。网页不能传入下载 URL 或本地安装路径。下载写入私有缓存，支持取消和重试；安装前再次核验。

- Windows 安装版打开 EXE 升级向导；便携版打开 ZIP，用户退出后替换程序并保留 `data`。
- Mac 打开 Apple Silicon DMG，由用户退出并替换应用。
- Android 额外验证 APK 包名、签名、新版本号、最低系统版本及设备 ABI，然后通过 FileProvider 交给系统安装器。首次需允许本应用安装更新，系统及厂商确认保留。

下载状态和安装意图保存在原生对象中，网页切换不丢失操作。自动安装请求在交接前消费意图，重复 ready 事件不会再次打开安装器；用户取消后可手动重试。跳过版本持久保存，“稍后”仅影响当前运行；手动检查绕过跳过及关闭自动检查的限制。自动网络失败保持安静，不妨碍连接服务器和播放。

## 桌面验证

- Windows 完整构建及 Inno Setup / ZIP 打包成功。
- 首次全量 CTest 55 项中 52 项通过，3 项因 2.4.2 未加入 RIFE 扩展兼容清单失败。补齐清单后，最终受影响的 7 项全部通过，包含更新策略、更新状态机、SystemComponent、真实 Qt WebEngine 更新 UI 及 3 项相关回归。
- 两项原生更新测试共 28 个 QtTest 结果通过；覆盖版本及平台选择、失败响应、长度／哈希、取消、跳过、安装器打开失败及自动交接仅一次。
- Chrome 和 Qt WebEngine 验证启动前登录页也加载更新模块、稍后／手动检查、纯文本说明、下载进度、重试、取消和 360px 窄屏布局。Qt 回调与 Android Promise 错误传播分别验证。
- Windows 实际原生桥接在隔离配置中成功请求生产 GitHub 接口，2.4.2 返回 `current`，手动检查窗口正常显示；未向生产发布上传测试包。
- 便携 ZIP 检查 1,559 个条目；清除开发 PATH 和 Qt 环境覆盖后，以独立配置启动，包内运行库成功创建 WebEngine 页面。
- 未在用户电脑执行 Windows 升级安装器；系统安装启动行为使用替代 launcher 验证。未变更已安装桌面播放器及其设置。

日志保存在工作树 `build/desktop-final-build.log`、`desktop-final-targeted-ctest.log`、`desktop-packaging.log`、`desktop-portable-smoke.log`。

## Android 验证

- `testDebugUnitTest`：36 项，0 失败、0 错误。`lintDebug`：0 错误、36 警告。
- Debug / Release 构建成功，签名 APK 校验成功；所有内置库与锁定来源一致，ELF 与 APK ZIP 的 16KB 对齐检查通过。实际手机为 4KB 页，不能据此宣称已在 16KB 页设备运行。
- 使用 Xiaomi 折叠屏 24072PX77C（Android 16 / API 36），隔离调试包数据，构建含新更新器的低版本 2.4.1 与同签名 2.4.2 候选包，验证实际原生更新管线。
- 本机 HTTP 传输夹具：启动提示、稍后跨网页、跳过跨重启、手动绕过跳过、错误 SHA-256 拒绝、取消后重试、下载中重载网页、校验后自动交接系统安装器均通过。夹具只替换调试版传输，正式 URL、文件身份及签名规则仍执行；正式 APK 禁用测试入口。
- 系统来源授权、厂商单次安装授权及实际安装完成：2.4.1 / 2040103 升级到 2.4.2 / 2040200，预先保存的设置仍为原值。取消系统安装后返回 ready，手动再试成功，未自动重复弹窗。
- 升级后直接使用真实 GitHub 接口检查，返回 `current`，无错误；当时最新公开 APK 仍为 2.4.1。实际 APK 下载／升级使用本地夹具，未将其混称为生产发布下载验证。
- 设置持久化／重置、首次导航桥接及样式、音频／视频共享播放器、两路外置字幕切换及字幕偏移回归通过。旧字幕测试使用内屏固定坐标，首次在外屏点击超出屏幕导致超时；改为读取当前播放器区域中心后，同一测试在外屏通过，播放器代码未因此改变。

设备日志：`android/test-artifacts/update-device-e2e.log`、`update-installed-production.log`、`update-release-sign.log`。网页截图位于 `android/test-artifacts/update-ui/`。

## 交付及发布约束

版本为 2.4.2；Android versionCode 为 2040200，并沿用现有正式签名，可覆盖 2.4.1。Windows 现有 RIFE 扩展继续兼容，不需要重新下载模型。版本附件使用以下名称，后续发布时须保持命名：

- `TigerestTheater-2.4.2-x64.exe`
- `TigerestTheater-2.4.2-x64.zip`
- `TigerestTheater-2.4.2-android.apk`
- `TigerestTheater-2.4.2-arm64.dmg`（平台构建通过后）

V2.4.1 及更早安装包没有本次更新器，需要先手动升级一次。GitHub 发布完成且对应平台附件可用后，新客户端才能检测到它；不会因为其他平台先发版而提示不可用更新。
