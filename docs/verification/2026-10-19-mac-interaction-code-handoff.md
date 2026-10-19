# Mac 立即接收：Jellyfin 2.9.0 交互修复代码快照

这是供 Mac 并行编译和验收的代码交付，不是全平台完成报告。压缩包内 manifest.json 记录唯一目标提交、前置提交、文件哈希及 bundle 引用。旧完整历史包 6736b4b 保留不变；本增量必须建立在包含该提交的仓库上。

## 现在可以开始

1. 保留 Mac 已有 Apple 修改，先查看 git status；不要 reset、覆盖或删除工作区。建议在独立工作树接收本快照。
2. 按压缩包中的接收命令.txt 验证并 fetch bundle，核对目标 SHA。若 Mac 有自己的提交，在独立分支合并本快照，报告合并后的 SHA；解决共享 native/ 冲突时保留双方目的，不静默舍弃代码。
3. 按原完整交接说明构建 macOS Qt、AppleCore、iPad/WKWebView、tvOS；共享资源必须重新同步后构建，不能只替换 Jellyfin 插件单个文件。
4. 先跑登录、首页→媒体夹→详情→返回、季/单集父链、收藏、切服取消与失败恢复，再测实际动画和首次/重复进入性能。详细矩阵见同包的动画专项补充与交互验收文档。

## 本快照包含

- JF10 静态快照避免升级 Jellyfin v0 自定义控件，修复慢速登录失败。
- JF12/13 Jellyfin 详情布局、真实可见海报落点、HomeMotion 路由适配、媒体夹与季/单集返回上下文。
- JF14 公共页面空导航处理和动态页头尺寸更新。
- JF15 客户端统一切服入口；macOS Qt 同步 SystemComponent 与 QML 原生入口及选择事务。API探测成功但网页403/断连时回滚旧设置并返回选择；成功加载才清旧服务器历史。原生设置是实时读取，不能以旧 bootstrap 或 session cache覆盖选择结果。
- JF11 Android 局部原生地址编辑、JF16 Android 导航观察器/展开态测量优化，以及 Modern hash变化即时更新。Android原生代码不应硬搬进iPad。

## Apple 必须补齐/核实

macOS Qt 使用本快照原生事务。iPad 的 api.system 如果没有 finishServerSelection / takeServerSelectionError，会走共享页面的旧保存后导航 fallback；这不代表 iPad 已实现与 Qt/Android 相同的取消、失败回滚和历史清理。Mac Codex需按Apple现有桥接及导航委托补齐等价行为，明确测试失败状态与保存地址；不要只新增空方法。

WKWebView 动画需验证其原生玻璃模糊分支、透明背景和实际海报飞行，不能用Chromium结果代替。tvOS若是SwiftUI原生页面，另测其导航和动画。用户未授权推送、合并到主分支或发布。

## Windows/Android 当前已知验证及边界

- 普通 Node 回归231/231；切服和Android bridge定向18/18。
- Chrome Android页头回归通过：内容插入不再触发无关导航测量，展开宽度无需compact几何，窄屏菜单及原按钮回调保持正常。
- 真实 Qt 切服回归通过：首次连接、显式选择不自动重连、取消保留地址/认证、PublicInfo成功但HTML失败、socket断连后的选择恢复与重试路径、持久化重启。受影响动画/布局CTest实际结果见包内 validation.json。
- Android JVM/lint/assemble成功，APK原生库16KB对齐通过；本轮切服事务的最终手机安装/设备复测尚在进行，不冒充全套真机通过。
- 手机此前已实际验证原生地址编辑的语言菜单、ASCII冒号/斜杠/数字与取消；方向旋转尚未实际改变窗口，待补测。
- 真机远程Jellyfin重复进入媒体墙P95约24.8ms，与同机Emby样本约24.9ms相近；首次进入仍有长任务。用户最新反馈安卓动画基本正常。样本不代表所有路径/平台流畅。
- Windows真实远程性能探针尚未完成，登录选择器等待超时正在定位，不写成远程性能通过。历史API/播放结果按原源码范围保留。

## 尚未包含的后续修改

用户最新截图显示 Android Jellyfin 媒体墙顶栏上下层衔接不自然。真实DOM：847×948 CSS视口，headerTop上下padding各29.76px，headerTabs起点比headerTop底部高约32.7px，存在叠层。此快照尚未修复这项最新顶栏反馈。Mac可先测试已交付内容；若也复现，回传其实际DOM/几何，Windows会另发小增量，勿等待它再开始编译。

回传仅含源码SHA、构建/测试命令与结果、设备版本、脱敏复现、Apple独立patch；不要上传账号密码、token、私密媒体截图或用户配置。
