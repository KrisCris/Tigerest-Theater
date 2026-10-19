# Mac接收失败复核与完整历史补包

2026-10-19。用户转来Mac接收检查：当前Mac仓库缺少原增量bundle的前置2f5e06c，未导入或执行Apple测试；并指出旧主文档末尾基准不一致、Xcode27硬门槛未经证明。

## 交付修正

已在新空bare仓库复现旧7656包的缺基线错误（退出1）。从固定引用仅导出目标可达历史，未使用排除基线的范围，也未导出其他分支；新包无前置提交。随后在同一仍为空的仓库中执行新bundle verify、fetch、完整HEAD核对及git fsck --full --strict，全部退出0。

- 交接HEAD：`6736b4b45bb71923c2dc3bf564471e3aaa8933a9`；最后产品变化：`829c5f8e7dd665d566d634600afda30b565b87df`，JF-09已包含。6736b4b仅归档Windows/Android验收及Apple交接文档。
- 引用：`refs/codex-handoff/jellyfin-290-full-6736b4b`；287个可达提交。
- bundle：`jellyfin-2.9.0-full.bundle`，67,202,958字节，SHA256 `3f8a8ca11b3a86495812e2f158f5e17cd71fbd3707fd4a94223e294977d9754b`。
- ZIP：`Jellyfin-2.9.0-Mac-Codex完整交接包-6736b4b.zip`，67,180,822字节，SHA256 `8cb46420db3d2d8715c32a5f30316fdceb502b6e49eb7b55f37d2807ed829b5e`。
- MANIFEST明确full、prerequisites=[]、交接HEAD、产品修复HEAD、引用、逐文件大小和哈希。ZIP逐文件验证通过。

主文档首次接收和回传命令统一为6736b4b；不再要求先导入7cdb/7656或从未核验远端分支取得基线。首次接收新建隔离工作树；Mac已有Apple修改则保留现有成果，按差异接收，不强制reset/rebase。完整包根目录说明与文档是本次接收操作依据，源码中较早交接记录保留为历史。

包、同名.zip.sha256及`Jellyfin-2.9.0-Windows补包回复-6736b4b.md`已复制到用户提供的`//Dx4600-tigerest/dx4600/网络交流`目录，并读取共享端文件重新计算SHA256，全部与本地一致。旧包和Mac来信未覆盖。这证明文件已放到共享目录，不表示Mac已再次读取或完成导入。

## Xcode与外部依赖结论

`apple/tools/build.py`确有只接受Xcode27字符串的门槛，自66cbced首次加入就存在；生成器使用Swift5语言模式、部署目标26.0，AppleCore声明Swift tools6.0。工程元数据CreatedOnToolsVersion27.2与历史Xcode27.2通过记录不等于最低要求。静态检查未找到足以证明必须27的源码条件，但Windows没有Apple工具链，不能据此认定26.6可完整编译。

撤回交接文档“必须Xcode27”的笼统要求；不在未实编时直接放宽helper后宣布兼容。Mac来信报告已安装26.6，默认CLT选择问题可通过进程DEVELOPER_DIR解决。补包已给出先执行AppleCore/模型测试，再通过生成器和直接xcodebuild实编的步骤，这条路径不经过helper版本门槛。若26.6实际通过，由Mac据测试修正能力/版本检查与README并回传；若失败，按具体SDK/API/Swift或二进制诊断界定，不降低部署目标、不改全局Xcode选择。

目标树gitlink为0、Git LFS标准指针为0。完整Git对象不包含Xcode/SDK、Qt6.9.3、MPVKit固定revision对应38项XCFramework、mpv0.41.0、VapourSynth79、RIFE模型或本地生成缓存。包内《外部依赖与Xcode核对.md》按实际锁文件/脚本逐项列出版本、来源、哈希和生成入口，并指出未锁定的Homebrew工具需报告Mac实际版本；不声称离线依赖已齐。

本轮只修交付材料与验证接收完整性，未修改产品或build.py，未新增Apple通过结论，未推送、合并或发布。外部证据位于`D:/CodexDeps/TigerestTheater/verification/jellyfin-290/apple-full-6736b4b`；空仓库命令、stdout/stderr、退出码及耗时已随包提供。此接收归档是随后本地文档更新，不改变已经验证并交付的固定6736b4b包。
