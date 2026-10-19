# Mac 接收：统一服务器历史与客户端菜单

本轮承接已发送的 4db34c7 交互修复和 31e7c46 顶栏修复。产品固定为 `6fe1b3d2343d61b43f18c36c36ba6f69a01a9c9a`，已安装到Windows/Android测试端。随包源码还含Codex测试隔离与本说明，精确source在manifest.json；产品未再改。此包已可接收并开跑Apple实现/验收。


## 包与接收步骤

文件：`Jellyfin-2.9.0-Mac统一服务器与菜单增量-6fe1b3d.zip`，旁有同名 `.sha256`。保留前面的完整历史6736b4b包；本包是从6736b4b起的累计增量，因此Mac仍在433a528或已收到4db34c7/31e7c46均可接收，不必来回串行下载三份增量。ZIP内没有安装包、登录资料或私有截图。

1. 先检查ZIP SHA256及manifest内每项SHA256，工作区未提交Apple改动先保存为本地提交或补丁；不要reset/clean。
2. 在已有完整历史的仓库检查并取入bundle：

```sh
git bundle verify /解压目录/jellyfin-history.bundle
git fetch /解压目录/jellyfin-history.bundle refs/codex-handoff/jellyfin-history-6fe1b3d:refs/remotes/windows/jellyfin-history-6fe1b3d
git log --oneline --reverse 6736b4b..refs/remotes/windows/jellyfin-history-6fe1b3d
git diff --stat 6736b4b..refs/remotes/windows/jellyfin-history-6fe1b3d
```

3. 先在独立集成分支审查共享变更，再应用尚未接收的提交。产品顺序为80e995e（延迟登录）→4db34c7（JF11–16）→31e7c46（顶栏）→a599df8（历史事务）→145dfc7（客户端菜单）→6fe1b3d（三项复审修复）；文档50a7086及最终source中的测试/交接文件也需同步。已有的提交不重复cherry-pick；Mac433a528有重叠共享修改时逐块解冲突。不要直接以Windows分支覆盖Apple工作分支。
4. 这个累计增量没有修改 `apple/` 产品文件。Apple独立修复必须保留；下面的原生任务仍须实现。`changes.txt`/`commits.txt`给完整范围，schema合同单独随包。

三项复审修复不可遗漏：迁移旧A后首次切B必须仍保留A；连接中更改选项后旧异步响应不能借新mode提交；Modern客户端按钮迁移后窗口按钮不能跨父节点插入或重复绑定。obsolete的abaa214不要使用，最终为6fe1b3d。

## 先保留 Mac 的独立工作

已读收到的 Apple 基线验证回传（433a528，基于6736b4b）。该报告验证的是旧产品829c5f8加Apple修复，不能覆盖本次JF11–17和新服务器列表。保留 Mac 分支的TV旧会话重试、iPad字体、打包/验证及现有真机证据，不执行 reset/clean。Windows没有把Apple回传代码直接应用到当前分支，也没有在Windows执行Apple构建。

回传中的重复homeTab可见页选择、v0快照闭合shadow root与Windows的首页/快照方案有重叠：按实际diff审查；不整包盲套旧Shared-candidate-review-first.patch，不把两个方案叠加后直接宣称通过。共享快照对齐后复测慢速登录、缓存滚动恢复和新版动画。已经收到此前增量的Mac可继续在现有分支上接收；仍停在433a528的Mac需先取齐从6736b4b起的共享提交。

## 用户期望

- 首页当前服务器入口、媒体页“客户端”菜单里的“切换 / 管理服务器”，统一进入客户端自己的列表。
- 记录实际连接过的Emby与Jellyfin；只迁移已有配置中的当前地址，无法追溯从未保存的历史。
- 默认启动仍是上次成功服务器。记录按客户端profile隔离，认证留在各自原有会话，不存入历史列表。
- 连接成功后记住；HTML失败、断网、取消及迟到响应不得更改成功历史。首次迁移A后连接B必须仍能从列表返回A。
- 专属服务器内外网是同一逻辑记录。自建服务器协议、端口和base path保留，不能仅凭主机名或serverId合并。
- 移除只移除列表项，不退出账号/删除媒体；当前项不能移除。地址编辑仅在成功时替换旧项。

## Apple 原生实现必须补齐

以随包 docs/superpowers/specs/2026-10-19-server-history-contract.md 和 native/serverHistory.js / tests/test_server_history.js 为准。

1. 在 apple/tools/sync_resources.py 的SCRIPTS中，把serverHistory放在nativeshell之前；重新同步资源，核对打包后的哈希与源码。
2. 在原生SettingsStore增加main.knownServers（版本1 JSON字符串，最多20项/32768字符）；与settings.value/setValue桥接，按profile保存，字段和规范化测试向量与共享契约一致。
3. 扩展现有SwiftUI服务器选择页，而非让WK绕回服务器自带列表。openServerSettings仍是共享入口。支持卡片连接、重试、编辑、确认移除、当前标识及单独添加入口。
4. 在真实新主文档成功后提交历史；失败/取消保持旧值。首次迁移、并发选择代次、编辑替换、专属LAN/public回退必须有测试。不要仅在API探测成功或saveConnection被调用时就写成历史成功。
5. Mac Qt用共享原生选择页；iPad WK用原生sheet，二者分别实测。tvOS是独立SwiftUI导航，不把JS动画通过当作TV已适配；按原生应用现有服务器会话设计补统一列表与返回。
6. 顶栏仅有一个客户端入口，Modern/Legacy切换与头部重建可见，无重复。桌面窗口模式/更新状态按钮保留；验证它们与客户端按钮位于有效父节点。窄屏不溢出，退出/过期登录页仍能切服。

## 增量验收

先编译AppleCore、Mac Qt、iPad与TV对应目标，再按可用设备验收；工具链使用Mac已确认的配置，不照搬Windows构建路径。

- 模型与事务：首次迁移A→B→A；Emby↔Jellyfin；同主机不同basepath；失败HTTP/SSL/断连；取消探测与HTML加载；A慢返回后选择B；保存重启；profile A/B隔离；移除不影响认证；坏JSON恢复。
- UI：Mac窗口/全屏、iPad横竖/分屏；Legacy/Modern；登录前、登录过期、退出账号；首页标签与客户端菜单；鼠标/触摸/键盘Back/Escape；原生地址输入语言、冒号、粘贴、取消和旋转。
- 交互沿用JF11–17补充要求：电影/剧集/单集详情不重叠；海报墙→详情、季/集和返回所属媒体夹；快照滚动恢复；品牌主题顶栏两行及安全区；冷/热动画与同机Emby对照，报告帧间隔/长任务，不仅截图。
- 真实API与播放：先保留旧矩阵范围；在最终新包至少复测登录、列表切服、原生播放、暂停/恢复和退出播放。未重跑的历史结果明确注明旧SHA，未测Apple项目不能标记通过。

## 回传

提供最终SHA、与Windows共享代码的差异、资源同步哈希、实际构建/安装包哈希、测试命令/结果及设备矩阵；将fixture、真实API、原生视频/字幕与性能分开。不要回传账号密码、token、Keychain或私人媒体截图。无推送、合并或发布授权。

## Windows/Android本轮结果

- 最终产品6fe1b3d：独立Node53/53；Qt受影响七项目最终通过。首轮菜单fixture与原生注入相互干扰，已改同源iframe隔离，严格一次点击断言保留；Qt重跑1/1（7.03秒）、Chrome五宽通过。不是把原失败忽略。
- Windows构建/暂存成功；原生Qt事务fixture验证成功写历史、HTML403/断连回滚、取消保留WebStorage、双basepath往返和重启持久化。Windows用户试用实例已重开、原远程登录保留；本次真实用户窗口chooser取消有手动输入交错，不记为通过。
- Android JVM、lint、assemble成功，20个原生库16KB对齐通过；包内共享资源完整性12项通过。手机debug已覆盖安装并从实际base.apk核对哈希。原远程→实际本地Jellyfin10.9.11→历史卡返回原远程、原认证保留、迁移旧地址、取消均通过；未清数据。仅移除测试生成的临时条目，设备留在原远程首页。
- EXE SHA256：`0a60586160538b0fe8123e46f656239e78d34c3668d52b8864d38740ad78c18f`。APK SHA256：`ce1d7f7dd90466d6ec1d19dfe654bb14e86349fde02cadbb48b394cdf799a508`。
- 本次验证重点是菜单与切服，不重复宣称全版本实播或性能矩阵已在新SHA重跑；既有JF16/17性能和早期播放记录仍保留各自旧SHA。用户已反馈Android动画基本正常，但Apple新动画和交互仍需本机测。
- 只迁移已有配置的一个当前服务器，其余过去从未保存的地址不可恢复；历史最多20条。专属服务器LAN/public为一个条目。当前服务器不可移除；移除其他历史只移列表项，不注销。
- 说明中的Apple任务是待办，不是已通过项目。Mac可以现在开始，不必等Windows再发下一包。
