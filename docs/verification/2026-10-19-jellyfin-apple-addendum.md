# Jellyfin 2.9.0：Mac Codex 最新补充交接

2026-10-19。最终共享产品提交 `829c5f8e7dd665d566d634600afda30b565b87df`。原《Jellyfin-2.9.0-Mac-Codex交接.md》的Apple任务、构建命令、设备要求和回传格式继续有效；请先读完整包主文档，再补本文件列出的风险。Windows/Android通过不能替代Apple验证。

## 应使用哪个包

- 尚未开始：使用 `Jellyfin-2.9.0-Mac-Codex交接包-829c5f8.zip`，内含详细任务、从共同基线 `2f5e06c97bd6c9cd4cdc1f5b4fe84c3813a69857` 到829c5f8的bundle、最新验收记录和逐文件SHA256清单。这里“完整交接包”指材料完整，Git bundle仍要求该共同基线存在。
- 已收到7656de0包并开始Apple工作：只接 `Jellyfin-2.9.0-Mac-JF09增量-829c5f8.zip`，包含7656de0到829c5f8这一提交，不覆盖已有Apple改动。
- 还在原7cdb83e：使用最新完整包，按主文档导入新引用，保留Mac工作；先接下表JF-06/07/08，再接JF-09。不要因为旧包缺补丁而在旧资源上验收。

所有包都不含远程密码、token、签名私钥、生产数据库或用户媒体。没有推送、合并或发布授权。

## 最新小增量接入

先检查Mac工作树和已完成提交，不reset、clean或覆盖Apple产物。小增量前置为 `7656de0031e23122269f075889fcc7b71b0f3f90`，目标为 `829c5f8e7dd665d566d634600afda30b565b87df`；MANIFEST列出bundle引用和各文件哈希。以下仅导入对象，不改当前文件：

```sh
REPO='/absolute/path/to/existing/Tigerest-Theater'
BUNDLE='/absolute/path/to/JF09/jellyfin-2.9.0-jf09.bundle'
git -C "$REPO" status --short --branch
git -C "$REPO" cat-file -e '7656de0031e23122269f075889fcc7b71b0f3f90^{commit}'
git -C "$REPO" bundle verify "$BUNDLE"
git -C "$REPO" fetch "$BUNDLE" refs/codex-handoff/jellyfin-290-829c5f8:refs/remotes/windows-handoff/jellyfin-290-jf09
git -C "$REPO" show --stat 829c5f8e7dd665d566d634600afda30b565b87df
```

若Mac已有自己的Apple提交，先保存现有工作，在Apple工作分支cherry-pick `829c5f8e7dd665d566d634600afda30b565b87df`，只解决真实冲突，不重复应用已存在补丁。若没有开始修改，可从导入引用创建独立 `codex/` 分支/工作树。已有工作树保持原样；文档单独读取，无须覆盖Mac自己的记录。回传最终Mac HEAD与其接收的源提交，cherry-pick后hash不同是正常的。

## 共享修复与Apple影响

| 源提交 | 内容与必测范围 |
| --- | --- |
| `7fc0e43` / `7cdb83e` | JF-04：SPA的DIV CustomEvent pagehide不能关闭桥；随后真实文档关闭仍清理pending/signals。iPad bridge与会话监听要在WKWebView验证。 |
| `de48a73` | JF-05：Android等Surface再loadfile。Android专属，不能据此声称iPad MPVKit通过。 |
| `490adbd` | JF-06：首页隐藏旧导航后清理外层padding/Modern占位；离开恢复。共享jellyfinPlugin影响Mac/iPad；Android安全区CSS不是iPad修复。 |
| `043d37c` | JF-07：没有Emby导航绑定时，openLibrary直接导航，不留下busy过场；需要Emby原路径受影响回归。 |
| `7656de0` | JF-08：Modern收藏使用hash，避免旧appRouter等待React不再发出的viewshow。必须与JF-06一起接入。 |
| `829c5f8` | JF-09：首页高度按入场结束位置测量，动画结束/取消再校正，避免横屏多扣72px；保留安全区和真实布局偏移。新增真实动画回归。 |

如果从7cdb83e开始保留Apple分支，按顺序接 `490adbd`、`043d37c`、`7656de0`、`829c5f8`；Android专属de48a73可不移植。Windows侧已定位并修复这些根因，Mac集中验证平台差异。

## 新增P1：真实动画、布局与往返

```sh
node --test tests/test_jellyfin_compat.js tests/test_home_data.js tests/test_home_motion.js tests/test_web_appearance.js
node tests/test_jellyfin_home_layout.cjs '/absolute/path/to/browser'
node tests/test_home_gallery_entrance_ui.cjs '/absolute/path/to/browser'
```

Qt按Mac项目配置执行 `test_home_gallery_webengine`、`test_jellyfin_home_layout_webengine`、`test_home_gallery_entrance_webengine` 和受影响motion目标。iPad重新生成Web资源，确认homeGallery、jellyfinPlugin、homeMotion、ipadBridge实际进入包且哈希对应最终源码。不要使用Windows测试环境脚本，也不要用旧.app验证新代码。

1. 真实12.2 Modern登录，启用正常动画；首页出现后不靠手动resize修复。记录视口、图库top/bottom、实际安全区，纵向高度应扣除稳定布局偏移和既有8px间距，不保留动画translateY。横竖屏、窗口改变、收藏返回/重新进入、动画正常完成与取消分别检查。
2. 收藏恢复服务器原顶栏，返回首页后再点海报必须到详情并能实际播放。横屏可能用顶栏logo `#/`，竖屏用菜单 `#/home`；观察实际可见入口，不假定同一selector。重复往返，检查busy结束和未遗留路由promise。
3. 12.2 Legacy及至少一个10.x同样回归；Emby既有动画、固定导航偏移不能被本次高度计算破坏。保留刘海/状态栏/手势区，不照搬Android测得的43.43/16px数值。
4. iPad的安全区样式位于 `apple/Resources/`；本轮Modern顶栏CSS只改了Android。按WKWebView实测决定是否需对应修复，测试getAnimations/DOMMatrix和真实生命周期兼容性；不能把Chrome通过记为WebKit通过。

## 原Apple任务仍需完成

1. AppleCore鉴权、子路径、字段兼容、会话模型测试；JF-02 TV旧会话已有serverID但缺kind的迁移，必须加载旧数据验证。
2. JF-04桥的Node回归、WKWebView真实登录/SPA跳转、真正文档关闭清理分列，不能只检查源码字符串。
3. macOS桌面、iPad、tvOS分别生成工程/资源与构建；有工具链先完成，不等待物理设备或账号。使用隔离profile，保留正式安装版和用户数据。
4. 按原详细文档五个Jellyfin版本、根/子路径、12.2 Modern/Legacy执行各端真实登录、设置、详情、MPV视频和持续进度、暂停/seek/停止、音轨/字幕、续播/下一集及退出/原生入口切服。tvOS按其原生UI验证。
5. 远程HTTPS账号从用户已有私密上下文取得；包里没有凭据，缺少时先完成独立测试服务器与其他工作。没有签名/设备/私有依赖的场景明确记未测，并继续独立项目。模拟器不等于物理设备，静音解码不等于人工听音。

## Windows / Android证据边界

五版本根/代理子路径及真实远程播放已经分轮完成，精确源码见同包验收记录。JF-09在829c5f8独立Node80/80、Windows受影响CTest3/3（29.74秒）通过，Windows/Android均重建。MIX Fold4横屏图库从767恢复839 CSS px，竖屏940；正常安全区保留。竖屏Modern、横屏Modern和横屏Legacy的收藏→首页→详情与返回高度均通过。没有为高度修复重跑全媒体矩阵或早期99CTest目标。

Apple构建/运行、生产Emby认证播放、原生BaseUrl重启、真实CDN、长片4K/HDR、人工听音仍无新增通过结论。代理子路径不能替代服务端BaseUrl重启。回传Mac本地提交或bundle/patch、最终HEAD、工具/SDK版本、用例数量、设备/服务器版本/布局/路径、脱敏日志截图和剩余限制；不附账号密钥或媒体，不推送、合并、发布。
