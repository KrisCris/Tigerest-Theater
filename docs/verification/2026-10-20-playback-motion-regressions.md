# 2026-10-20 用户试用回归（进行中）

基线源码15f90932a467237b99d91503b6e0927f350278c0，实际Windows/Android产品6fe1b3d。用户报告PC花屏/撕裂与转场闪烁、首页服务器/全屏控件挤压、Emby头像与齿轮重复、Android Jellyfin手动退出却续播及动画/滚动卡顿。用户补充：播放器返回与系统返回均复现，Emby退出尚未测。

已向同一Claude会话发送任务及真机证据并确认收件，Claude为本轮唯一产品源码写入者；Codex只在外部证据目录采集固定已安装包的结果、维护此文档。未开始新源码原生构建，不修改Apple工作。修复后需要重新固定SHA、审查、受影响回归、实际更新两端测试版与Mac交接；不得引用上轮列表通过来关闭这些问题。

## Android 取消后误续播：真实复现

设备192.168.5.134:40089，top.tigerest.theater.debug，已安装APK ce1d7f7d…；真实Jellyfin10.11.11。按用户授权独占手机约十分钟，临时仅订阅native信号并包装MPV原型onEndedInternal采样（不改产品源码，不含媒体URL/token）。系统Back事件链：

1. windowVisible(false)
2. onEndedInternal({playNext:false,resetPlayQueue:true})，active=true
3. native canceled
4. 再次onEndedInternal相同参数，active=false
5. native stopped
6. 约273ms后windowVisible(true)，视频重新出现并开始播放

没有finished信号。因此这条样本不是Android把手动取消标成自然EOF，需继续核对Jellyfin对stopped参数/队列处理的协议。不能只改native END_FILE推断。证据外部 `regression-phone-exit-back.json`。本次诊断停止后重新载入页面以清除临时监听和旧播放会话，native停止后videoVisible=false、controlsVisible=false；认证与设置保持。

## Android 转场与滚动采样

同一已安装包，真实Jellyfin媒体墙约5017个DOM节点，948×847 CSS像素、DPR2.625。Profiler会增加开销，数字仅用于同条件诊断，不能当绝对性能/全设备验收。

- 首页→媒体夹cold：P95帧间隔58.3ms，长任务53/52/231/169ms；warm：P95 49.9ms，无>50ms长任务。证据 `regression20-jf-{cold,warm}-before.json/.cpuprofile`。
- 三次同向触摸滚动baseline：P95 25ms，2帧>50ms；对照临时禁用filter/backdrop-filter后P95 16.7ms，1帧>50ms；恢复样式baseline-repeat：P95 33.3ms，6帧>50ms。临时样式已在finally移除，不作为产品修复。
- baseline CPU采样getBoundingClientRect约423.8ms，其中418.2ms调用链是 `getBoundingClientRect ← box ← usable ← page ← backgroundRoot ← changes`，对应homeTransitions的MutationObserver。其changes在检查mutation是否相关前就取backgroundRoot，Jellyfin page()包含几何读，滚动/懒加载/动画style变化会反复强制布局；应先隔离/验证这个原因而非禁用动画。
- 顶栏三层backdrop：skinHeader blur(20px) saturate(1.32)、headerTop同值、tabs slider blur(15px)。filter对照会同时影响全部过滤层，只能证明过滤/布局存在成本，尚不能把某单层指定为唯一根因。
- 证据 `regression20-scroll-{baseline,no-blur,baseline-repeat}.json/.cpuprofile`。无模糊探针已移除；不改系统刷新率、键盘、WebView设置。

## Windows 渲染运行库：只读核对

实际试用PID376084加载build-719d85a/output/Qt6WebEngineCore.dll，SHA256为06e760bae00d8541c5fdca56b5b64387cd69c8f5f0f5c9c7f155f4055f7949c6，与补丁运行库manifest一致。试用日志有D3D11 producer wait completed=1/reset=0。因此不是打包漏同步补丁；这不证明所有花屏已排除。需硬件加速独立profile实际抓帧/转场复现，区分应用图层闪烁与纹理同步问题。不能用无GPU fixture或rAF计数冒充实际画面通过。

## 待验收

00:26 JST补充：旧Windows真实远程探针把“选择自建、赋值、提交”合在同一JavaScript回合，遇到chooser初始化时序会停留选择页；已仅调整外部探针，等待原生初始化、点击后实际表单可见再提交。固定已安装6fe产品在独立硬件加速Qt profile完成真实远程媒体夹cold/warm、详情/返回，P95分别37.6/33.2/33.5/25.1ms，落点0、无残留层。有58/85、76、50、73ms长任务。这是有同时后台负载的诊断样本，不是与旧性能样本严格配对，更不能当花屏画面通过。证据 `regression20-windows-real-remote.json`。临时profile/进程由fixture正常清理，用户manual-user-profile未动。

本轮新回归自动跟进已恢复ACTIVE，保持Claude唯一产品写入与明确commit交回后审查/构建约束，覆盖两端更新及新Mac交接后再暂停。

Windows中间帧已采集至外部 `regression20-windows-frames-before/`。library第01帧（采样累计906ms）出现整页暗色空场，第02帧出现新页头但卡片未到，第03帧媒体墙出现；detail与return有模糊/背景切换，没有在这些CDP帧中捕获局部纹理撕裂。需检查library outgoing/incoming交接是否存在不必要的空场；截图调用本身明显拉长动画，不能将其时间当原始卡顿时长。CDP截图发生在Chromium合成层，不包含最终Qt/D3D交换链，不能据此排除底层花屏。Sky原生截图观察被其他窗口遮挡、后续临时fixture完成退出导致句柄失效，未获得可用逐帧native证据；不把工具截图失败记录成应用崩溃。

- Jellyfin手动返回/系统返回停住；自然EOF仍能续集；Emby取消不回归；播放出错、连续返回、下一集加载途中取消。
- 首页窄容器图标回退、长服务器名、全屏状态/提示/触控目标；Emby头像与齿轮先查动作再去重，不丢管理入口。
- 真实PC媒体墙滚动/悬停/详情进出逐帧；Android同页冷/热转场与滚动前后对照、保留动画；不把Profiler与非Profiler数字混比。
- 独立审查、针对性Node/Qt/Android构建、保留用户配置更新测试版、给Mac新增量及未测Apple任务。

## 00:50 JST 复查与用户120帧标准

Claude明确交回80789741eabc71bb270d5fdc36887df1a7dc1450并停止后，独立Node受影响38/38通过，取消逻辑另对五版实际Jellyfin bundle执行30项契约检查通过。Windows独立staging output-regression20已构建；用户Windows实例仍旧6fe，未替换。Android807 APK SHA256 fc427725d8041f9c05047c2076c9cdc273c2a0e22846911a6050e2f8bd5a709e 已install-r，数据保留，这是中间验证包。

807真机真实远程Jellyfin：系统Back和原生播放器返回均产生canceled、stopped，videoVisible=false，4秒观察内无自动续集。系统Back证据regression20-phone-system-back.log；播放器按钮从debugInformation/UI树读取实际坐标，缓冲中先暂停显示控件、恢复播放后点返回，证据regression20-native-back.json。自然EOF探针先误点隐藏播放按钮，后改为可见按钮仍未完成有效EOF，不能标通过；需用可控测试片继续。探针已reload清除、手机恢复原首页，forward9223移除。

独立审查两项P2已经反馈Claude：新增fetch缺AbortSignal导致取消后请求/解码积累；整卡裁剪漏掉hover/focus上移进入视口的边缘海报。复现目录C:/Users/59890/AppData/Local/Temp/codex-motion-review-8078974。Claude明确交回bbfae89ce345a8f0703118fcfa2133f6d19f7f02，signal贯穿并取消后不回退IMG、保留64px边缘。Codex独立backdrop+lifecycle 13/13通过；Chrome边缘与原复现尚待独立复跑。未把bbfae89安装到手机。

用户新明确标准：动画和滚动需要120帧。120Hz每帧预算约8.333ms；旧P95 16–33ms结果仅能作诊断，不能算达标。后续在实际120Hz设备分别记录冷/热转场、详情/返回、持续触摸滚动的P50/P95/P99、错过vsync比例、最长连续掉帧，并以Android FrameTimeline/呈现帧验证，不用平均FPS或带Profiler样本冒充稳定120。保留动画视觉与功能，不降刷新率或关闭动画。Mac同样更新要求；无120Hz Apple实机则明确未测。

## 01:02 JST 120Hz有效样本与后续实施

bbfae89 Node13/13、原始abort复现24请求均带signal且取消后0decode、Chrome真实hover边缘像素通过；Qt jellyfin-motion/home-motion-cache 2/2，29.83秒。两端独立构建完成，Android APK 1ca282b12367afdc258b111fee49c19087ddda40cb36d78e13a6ee569d8467d9（89070817字节，16KB通过）实际install-r成功。此前包含外部工具下载的组合命令被审批拒绝且未执行；未重试下载，只执行范围更小的本地已构建包安装，获准成功。手机已启动新包，原认证保留。

用户授权20–30分钟继续测手机，PC同样120帧。曾在新路由尚未完成加载时录到scroll=0的两个样本（r120-scroll-baseline/native-baseline），无有效页面位移，明确作废，不以其P99 8.4ms宣称通过。改成等待稳定媒体墙并执行实际ADB触摸，最终scroll=1803.05。远程接口一度延迟约30秒，首页加载失败，重试后恢复；不能混作掉帧。

固定807：stable-baseline滚动P95/P99=16.7/33.3ms，48/314间隔>12.5ms；top/tabs/all滤镜诊断对照无稳定收益，复原stable-repeat仍P95 25ms，不足以把某单层认定根因。样本包含Profiler=false，但有极简rAF及FrameTimeline采集。

固定bbfa：Android847x948、DPR2.625、native实际120.00001Hz；媒体夹冷转场P95/P99=49.8/124.8ms，74/53/120ms长任务；稳定真实触摸滚动P95/P99=16.8/33.3ms，85/293间隔错过vsync，未达120。FrameTimeline按官方protobuf字段76只读解析，app PID2189：329帧，主要233 BufferStuffing、89 BufferStuffing+AppDeadlineMissed；映射DisplayFrame后的present间隔P95=16.667ms。trace含操作前后闲置，max340ms不得当活跃滚动最大卡顿；该统计尚未严格裁剪动作区间，不冒充最终帧率。解析脚本和原始perfetto-trace留外部可复核。参考https://perfetto.dev/docs/data-sources/frametimeline 。

另一次CPU诊断采样idle2631ms/program954ms，显式JS热点很少；不把Profiler数字混入上述无Profiler通过线。CDP Tracing.start关闭调试连接，重连确认app仍正常、PID未变，不当app崩溃；没有完整Chromium GPU trace证据。

Windows bbfa硬件加速隔离Qt真实远程冷/热媒体夹P95=33.3/46.1ms，详情/返回24.9/29.2ms，落点0无残留层。屏幕native刷新率尚需核对；这些结果至少不是稳定120，且不能替代最终D3D花屏检测。Windows用户实例仍旧6fe，未更换。

已准备把120帧优化和证据正式交回同一Claude为唯一产品写入；停止新源码构建，Codex只用固定已建包调查。shared Web/必要Qt Android注入可改，Apple产品不动；保留退出修复，不能关闭动画或降刷新率作为通过。

## 01:14 JST 补测与归因

01:04同一Claude会话消息63已正式发送并确认响应，Claude现在唯一产品写入者，处理120帧优化；Codex只测固定bbfa产物。独立APK安装路径sha256sum核对为1ca282b…一致；Windows staging EXE为bcd2bd9b23eb6fcbc268edf0f6a4e1bcc1cd3dfa03830793e28b054e5082b6d2，用户窗口尚未换。

真实本地Jellyfin10.11.11生成测试片：第一集自然finished→stopped→第二集playing并渲染640px画面；第二集中按系统Back产生canceled/stopped，四秒内videoVisible=false。外部regression20-natural-eof-bbfa.json为EOF与渲染证据，后续停止事件在执行输出。通过原生统一chooser切本地，结束按原历史卡恢复原远程认证，移除本轮临时18964条目，未清应用数据。测试服务器PID365220本来已运行，不由本轮结束它。reverse18964仍需清理。

滤镜对照必须核对computed结果：hdrdiag（CSS规则）仅覆盖了header/top，按钮和tabs仍blur，不能作为完整顶栏关闭。hdrdiag2改为临时inline important、禁其过渡，确认header/top/button/tabs都none，P95 8.4/P99 25ms，15/370帧间隔>12.5ms；恢复bbfa-restore2后P95 16.7/P99 25，97/273错过。hdrchildren仅去掉子层而保留外层skinHeader20px，P95 8.5/P99 25，15/353错过。ambientdiag2确认两个pseudo filter均none，P95仍16.8/P99 25，95/287错过。这证实顶栏重复过滤是滚动重要成本，但临时删效果不是产品修复，剩余掉帧也不满足120。全部探针finally恢复属性，没有永久关动画或改系统设置。原始JSON/trace保留。

Windows本轮Sky前台截图真实滚轮→海报详情→返回媒体墙，已取得原生稳态和一帧转场画面，未在这些稀疏截图中观察到局部纹理花屏，不能据此排除高频闪烁/撕裂。Sky激活后测试窗口从最大化变成1280×684 CSS，DPR1.5，screenX647/screenY360，屏幕2560×1440逻辑；此前性能样本是2560×1356视口，不能混比。OS只读枚举显示RTX4090关联3840×2160@240，也有59/60虚拟适配器；尚未用最终窗口所属QScreen直接确认该次刷新率。Qt调试快捷键没有显示调试层，未反复修改设置。

Mac追加文档已导出：//Dx4600-tigerest/dx4600/网络交流/Jellyfin-2.9.0-Mac-120帧与退出播放追加验收-2026-10-20.md，SHA256 1842dd46d014c9b60e262117d645f48153d6f822869ede0322a72664ea24c7a8。明确当前性能未通过、新代码包未交付，Apple并行补测，不能把文档当新代码包。

01:18 JST：hdrchildren computed确认外层skinHeader仍blur(20px) saturate(1.32)，headerTop/button/tabs均none；补充证据已通过同一Claude会话Ctrl+Enter加入队列，UI显示1件消息入队，不能重复发送。手机最后bbfa-active严格以/proc/uptime粗10ms边界裁剪FrameTimeline活跃区间：呈现P95 16.675/P99 16.677/max25.007ms，272个呈现间隔中98个>12.5ms、最长连续3个；不再把空闲尾部纳入。该结果仍未达120。已reload清掉采样包装和临时样式，恢复原远程#/home、videoVisible/controlsVisible=false；18964 reverse及9223 forward删除并核对列表为空。手机已交还用户，后续独占需再次协调。

01:24 JST：补充顶栏真机证据的队列消息按“立即发送”提交，UI显示已发送；未重复新建同内容消息。PC已有NVIDIA FrameViewSDK/PresentMon工具，--help可读；按唯一session名限定旧试用PID的12秒只读采集却立即exit0且没有CSV，因此不记为呈现帧采集成功，未提权、未停已有PresentMonService。只读EnumDisplayDevices在当前调用环境返回false（结构大小840），没有可用显示列表；CIM适配器信息保留，但不能冒充已直接确认Qt所属屏刷新率。Windows后续仍需解决可用呈现采样和原生画面验收；未下载额外工具，也未绕过此前下载组合审批拒绝。隔离bbfa可视测试fixture已正常结束，原用户6fe实例保留。

01:30 JST：只读Windows显示枚举已修正测量脚本的封送问题：PowerShell调用string参数时$null落成空字符串，改由C#包装直接传null后EnumDisplayDevices返回真实适配器。当前DISPLAY1主屏(0,0)3840×2160@240Hz，DISPLAY2(3840,0)3840×2160@60Hz；结果r120-windows-display-modes.json。此前记录的测试窗口screenX0或647、DPR1.5对应主屏范围，支持其位于240Hz屏，但最终验收仍在每次运行记录窗口/QScreen关联与显示模式，不把静态枚举当呈现帧通过。PresentMon改用Hidden Start-Process显式收集ExitCode/stdout/stderr：30ms退出1、无CSV且两流为空；此前PowerShell末命令0不能代表子工具采集成功。未请求管理员、未停止已有服务或改变系统设置。Claude仍在编写120帧改动与顶栏回归测试，Codex只修改外部测量脚本和此记录，未构建当前产品。

## 01:59 JST：66a23ee 独立验证后再次交回

Claude 01:48明确交回66a23eec8ea7e2db1cf59786c23a37671af90496并停手。Codex固定源码manifest，确认仅自己的文档未提交，独立Node13/13、两个新增Chrome夹具通过。Windows和Android均构建成功；Windows staging EXE 16fc9dad51676eae44f05f3e1571a6b8252dd0c66014ab4e0bb2562c4322e736；Android APK 91eb53ddf745fda7c64030625bdaacf596dcbcd0c0fef792fec771c806803154，16KB验证与两项共享资源SHA一致。用户重新同意独占手机约20分钟；Android install-r实际成功且安装路径base.apk哈希一致，认证保留。Windowsmanual-user-profile仍旧6fe，不冒称更新完成。

实际性能仍失败：Android120Hz冷媒体夹转场rAF P95/P99=66.5/141.4ms；热滚动repeat为16.7/25ms，50/337间隔>12.5ms。活跃FrameTimeline呈现P95/P99=16.669/16.676，41/338超过12.5，最长连续2；原始r120-*-66a23ee-{cold,stable,repeat} JSON/trace/timeline均留外部证据。真实DOM证明大多数header BUTTON都是appearance:auto，仍在执行12/15px模糊；新逻辑只覆盖headerTop/title/tabs/avatar DIV，未覆盖诊断所需的重复层。临时仅加.skinHeader button{appearance:none!important}让现有逻辑处理后，rAF P95 8.5/P99 25.1，14/380错过；FrameTimeline呈现P95/P99=8.338/8.341，2/383错过。此为单次诊断，不算产品120通过，样式finally恢复；证据r120-scroll-buttonappearance与脱敏r120-66a23ee-phone-header.json。

Windows固定新包真实远程冷/热媒体夹P95 41.6/20.8，详情25/返回16.7ms，无残留层/落点0；详情resize1.9ms、飞行开始596.4ms，缓存修复有收益但整体未达120。r120-windows-66a23ee.json/log，记录实际2560级视口、DPR1.5，主屏240Hz。仍无有效PresentMon呈现帧，不能当最终D3D画面验收。Qt新增header像素夹具直接运行失败mean4.52/p99 37/over20 1848；尚需隔离宿主原生注入，暂不直接断言产品视觉坏。其后cache Qt未执行（前一命令失败退出），不可标通过。

独立只读审查复现三项Important并已合并发送Claude：非均匀gradient/image祖先误当纯色（像素均差40.10）；hover/focus期间换主题后退出仍缓存旧色；异步link样式加载/href变化不失效。复现C:/Users/59890/AppData/Local/Temp/tigerest-header-review-20261020/review.cjs及PNG，产品未被审查者修改。

约01:58同一Claude桌面会话已成功提交整合交接，空输入框、正式用户消息和运行中状态均确认；Claude再次为唯一产品源码写入者。请先修实际按钮遗漏与三项正确性，再针对首次显示/转场成本继续有证据优化；Codex停止新产品构建，只使用固定66包诊断Qt夹具并维护文档。UI额度83%，不是耗尽，不按限额接手。手机随后reload清掉采样/诊断并恢复原远程#/home，无播放，forward/reverse列表全空，已提前交还，不能无限沿用此次独占。PC临时远程探针已正常退出；未动原有测试服/正式版。新Mac代码增量仍等修复验证后导出，旧Mac说明继续标性能未通过。

02:03 JST：Qt像素失败已用66a23ee固定源码的外部同源iframe夹具复现。child api/qt均undefined，只有两个预期样式ID；UA QtWebEngine6.9.3 Chrome130。静止均差3.8904、p99 26、1333像素>20（原顶层4.5202）；nested.png/flat.png目视tabs文字/背景有差异，不能用最新Chrome通过推断Qt130也等效。该结论仍是软件渲染夹具正确性，不是最终D3D花屏检测。证据目录D:/CodexDeps/TigerestTheater/verification/jellyfin-290/66a23ee-header-isolated，日志r120-66a23ee-qt-header-screenshot.log。单独补充消息先入同会话队列，再按立即发送，UI已显示送信済み；不要重复发送。Claude已明确在写真实按钮/动态主题新回归并开始修实现，随后自动压缩上下文中；压缩不是额度耗尽，当前83%。所有本轮原生fixture进程已正常收尾，未保留新采样服务。

## 02:24 JST：Claude再次限额，Codex接手

同任务日志17:20:16 UTC明确session limit，UI100%且运行结束，测试后台命令已完成。Codex按用户既有授权成为唯一产品源码写入者；已取消本任务的限额后自动继续，接手通知消息71成功提交且输入框清空。即使额度恢复也不自动交回写入权，避免同时写。

保留Claude未提交的native/webAppearance.js与tests/test_header_backdrop_root_ui.cjs（基线66a23ee）。她已补实际appearance:auto按钮、hover/动态CSS失效、非均匀/阴影覆盖拒绝，并加Chromium>=143门限，因为Qt130的实际滤镜采样语义不同。Chrome自检日志通过、旧代码各项失败记录已看到，但还不是Codex独立通过，更不是120帧达标。开始独立审查与针对性复测；新版本未提交、未构建、未安装。手机继续已归还状态，Windows用户实例仍6fe；暂停自动重跑旧性能样本。

## 02:33 JST：固定f4772f6，开始两端构建与新真机验证

Claude未提交修复经Codex独立Chrome与Qt检查；新增独立审查发现own background-clip和溢出伪元素两项Important。Codex先补失败回归，再保守处理覆盖区域；另发现保留子filter时不能移除其Backdrop Root，补反例后保留必要祖先filter。修复后独立原复现两项像素差均0，真实Jellyfin按钮夹具mean0.135/p99=1/over20=0，Qt130原样保留滤镜且静止/悬停像素差均0。未放宽原有像素阈值。Node13/13通过。夹具改同源iframe、等待新文档timeOrigin与字体加载，避免宿主注入和reload旧文档竞态。

固定产品提交f4772f6fb2ffae0f288830b50382264efd3b6b07，仅webAppearance与针对性测试/CMake注册；性能仍未验收。两端开始隔离构建，Android APK17cd492631a5729e8f2f6b880a4608c8292cfa824083db84557720a6107ed7a6，16KB检查通过。用户本轮重新允许约20分钟手机独占，设备连接正常，准备安装并测真实120Hz；正式版/认证保留。

固定66的新增PC CPU诊断（不是无Profiler验收）：冷媒体夹createImageBitmap/decodeSource约77ms；详情同调用248ms、alignPanel/getBoundingClientRect约86ms，旧header getAnimations约34ms。已有缓存只改善命中路径，首次DOM回退解码仍可能卡主线程。证据r120-windows-66-cpu-*.cpuprofile已移除URL query/hash；不得把这些Profiler数值混为120帧通过。接下来先验证新顶栏实测，再继续定位剩余PC/冷转场成本。Windows用户实例仍6fe，未替换。

## 02:45 JST：f477 真机结果与后续边界修复

f477 Windows构建完成，EXE SHA256 `6ceaac6134d7fcd0c000dbd8b569f125c81e6d8ee89ef62acc41118e1cc7bba1`；Android install-r成功，安装路径base.apk SHA与17cd4926…一致。手机实际120Hz、847×948 CSS、DPR2.625。无Profiler活跃滚动两轮FrameTimeline呈现P50/P95/P99分别为8.335/8.339/16.668ms（4/375间隔>12.5ms）、8.335/8.339/8.341ms（3/362）。rAF分别P95/P99=16.6/25.1、8.4/41.6ms；不能只挑第二轮呈现P99宣布全面120通过。首次媒体夹转场rAF P95/P99=33.3/66.5ms，呈现16.64/83.15ms；热转场rAF58.4/83.2，仍失败。证据r120-{scroll,transition}-f4772f6-*。

额外手机CPU诊断（非验收）：createImageBitmap约81ms、getAnimations约60ms、getBoundingClientRect约20ms。共享顶栏逐属性重复枚举动画值得继续缩减；媒体截图解码回退仍需优化。f477真实远程Jellyfin一集播放发出playing，系统Back发出canceled→onEndedInternal(playNext:false,resetPlayQueue:true)→stopped，停在details且videoVisible=false，没有续下一集。此轮只重新验证系统Back；播放器Back/自然EOF沿用此前bbfa证据，不能标为f477重测。约02:43已提前归还手机，恢复原远程home、无播放，forward/reverse列表为空。

独立审查又发现静态overflow owner不能裁掉其绝对定位伪元素、滚动owner改变伪元素位置两项，均补红绿测试。后续产品提交5901449d7fc2ecaa2c75cd3b4505a75b13102b82保守保留这些覆盖区域；还未构建/安装。Chrome bounds通过、header像素两次通过；原像素夹具的间歇464像素差在“相同未优化页面重复reload”对照中也复现，差异集中标签CJK字形、几何与font完全相同。测试改明确Arial整数字号/Latin标签，顶栏中文标题保留；未放宽像素阈值，增加可选PNG/几何证据输出。此为夹具稳定性修正，不是产品视觉豁免。Windows真实D3D花屏与120呈现验收仍未完成，用户Windows实例仍6fe，Mac新代码包仍未交付。

## 03:07 JST：9d20453 / 73379eb 与最新手机实测（120仍未通过）

Codex仍为唯一产品写入者。9d204530d381e743726cc19159f35ae4390d8392 将每次顶栏处理内重复的 getAnimations 读取按节点缓存；真实按钮回归先观测147次读取/15节点，修复后每节点至多一次。Node13/13、Chrome根/边界、Qt根像素回归通过。9d两端构建完成，Android实际安装并核对APK b12ea7d56376bc9f69fe7828b15c01997ca8a7a2dbbd4e8c1e33e6edf820ae86。

73379eb49da9c5d7e8808f4fb6b76c84335ea666 修复媒体夹冻结层捕获到仍只有0.094 opacity且模糊/位移的入场帧，随后冻结层移除导致画面突然跳变。新增红绿真实DOM回归；不透明遮罩后先完成被遮住的页面入场，可见整体460ms入场动画保留。Chrome新回归和既有home-motion14项通过。两端构建完成；Windows EXE2945ff6f1b9cfe2328c63ac6d1f7dad32a05a01e1d8200a7fe0876c3ddba45f1；Android APK3cf1a1fb3645d7599b42b871654756710b15adaadfe108722b18962f0894ac5a，install-r成功且安装路径SHA一致。Windows隔离staging三项CTest（home_motion/library_incoming_settled/header_backdrop_root）通过，28.61秒。用户Windows手动实例仍旧6fe，未替换；不能把静态/fixture通过当D3D撕裂或120通过。

用户约02:53重新授权15分钟手机独占；约03:00提前归还，已reload清除诊断/监听，原远程home、videoVisible=false，forward/reverse为空。不能无限沿用本次独占。

新手机无Profiler、实际120Hz、活跃操作FrameTimeline：9d首次媒体夹呈现P50/P95/P99=8.317/8.320/16.636ms、2/151间隔>12.5；热滚动8.330/16.654/16.662、29/362。733首次转场8.319/16.632/74.793（8/131），两轮热滚动8.334/16.666/16.671（34/340）、8.333/16.666/16.668（30/340）；rAF转场P95/P99=58.1/108.1，滚动16.7/33.3。**仍失败**，不挑某轮好数字当通过。证据r120-{scroll,transition}-{9d20453,73379eb}-*。

733同机对照诊断：临时关闭全部顶栏滤镜呈现P95/P99=8.337/8.338（2/377）；恢复后8.336/16.666（10/381）；只关闭顶栏子层、保留外层毛玻璃8.335/8.336（2/369）。均已恢复，不是正式修复或产品验收。实际geometry：headerTop x=-8/w863超847 viewport；内层头像DIV宽79.2/起点754.638，但被44px父BUTTON起点772.238/overflow:hidden裁剪，客户端按钮终点766.238，实际间距6px。painting按未裁剪内层rect误判邻居覆盖，且采样背景圆角/边界判断仍保守保留多层filter。已交独立只读reviewer外部fixture验证，未直接放宽边界或跳过圆角。

修正上一节CPU解码归因：r120-windows-f477-origin按实际操作起点记录createImageBitmap/build/cache事件，实际媒体夹转场内没有新的大图解码；先前CPU profile包含了转场前预热。详情内仅缓存ImageBitmap副本，resize约2.1ms。不能把整个profile的81ms图片成本全部认作活动转场开销。PC详情仍有alignPanel→getBoundingClientRect约55ms强制布局，需继续准确定位。Profiler样本不用于验收。

Mac已导出固定733累计增量（前置6736b4b，相对上一包15f9093有9个新共享提交，无新增Apple产品修改）：Jellyfin-2.9.0-Mac播放与转场修复增量-73379eb.zip，NAS SHA256 bef5c9d9e280f6c27640e4c7a2fa0e716bddbeba11929a96afd920205f9572ea，189078字节。bundle/manifest/NAS回读通过；配套Jellyfin-2.9.0-Mac播放与转场接收说明-73379eb.md。明确120未过、WebKit不得强行打开Chromium>=143颜色替代、需Apple实际资源哈希与原生取消/EOF及ProMotion呈现帧复测。没有Apple已测声明。

Windows新733真实远程探针第一轮等待library-cold超时，诊断仍#/home，暂未归因产品；第二轮增加gallery entered/错误/可见按钮状态诊断继续中，不算通过。PresentMon只读无GPU/输入跟踪诊断仍未产生CSV；未提权/停服务。最终PC呈现帧证据仍缺。

## 03:12 JST：可见头像边界、PC前台对照和候选包

独立review确认普通流/relative子节点确实被overflow:hidden/auto/scroll父级裁掉的普通元素/文本绘制区域，可以用父border box保守求交；不改伪元素、采样圆角/阴影或Backdrop Root规则。新增test_header_clipped_avatar_ui红绿回归：父级裁剪时旁边客户端滤镜可替换，overflow visible/fixed逃逸时保留；headerTop与内外头像仍保留。产品固定1b7fdd18755b9d70c3976accd65230064917697e，Node13/13、Chrome新增/原bounds通过。header像素首轮88个>20像素差失败（未保存首轮PNG），复跑通过；额外固定733基线跑相同夹具，baseline/current四张rest/hover PNG逐像素完全一致。没有放宽阈值或掩盖首次失败，归因尚未完全复现。外部真实CSS独立review正例mean0.159/max4/over20=0；visible与escape反例差0。

1b7 Android assembleDebug成功，16KB检查通过，APK aacc677bcef3a6b19b98b335fd5a1f8cff56667bd34fbe6ffd6f5c04eb9c18d7。**尚未安装、尚未实测性能**。手机仍733、已归还。1b7 Windows尚未重建，Mac733包不包含它。不能因为额外一项正确性优化推断已达120。

Windows733第二轮诊断：home tg-ready但未tg-entered，nav位于视口外，busy=false/last=null/无JS错误；说明后台Qt合成尚未推进首页入场。第三轮先通过sky激活唯一output-regression20窗口，入场正常完成，真实远程冷/热媒体夹、详情/返回成功，无Profiler P95分别33.3/25/33.3/25ms，median12.5ms，落点0.022/0、无残留层；仍未达120。实际1280×684 CSS、DPR1.5、screenX647/screenY360，激活后窗口尺寸已变，不能与先前2560宽样本直接混比。r120-windows-73379eb-remote.json保留。50秒原生截图观察后测试进程正常退出；用户manual实例未动。

原生静态截图确认能够呈现首页，但不是连续D3D帧/撕裂验收。PresentMon独立进程以当前固定测试PID运行、唯一session、无提权/不停止既有服务，exit1无CSV/无stderr，仍缺可靠PC呈现帧证据。自动跟进已重写为当前Codex写入权和1b7/733状态，消除旧段落所有权矛盾；继续覆盖性能、实际更新和最终Mac增量。
