# 报错平台识别与分秒输入验证

本次修复尚未正式发布，版本号仍为 2.4.4；已生成单独 Windows 预览 ZIP，未替换已发布附件或已安装播放器。

## 平台根因与修复

原生 `SystemComponent::getUserAgent()` 使用内核名称：Windows 是 `Winnt`、macOS 是 `Darwin`。旧报错表单只匹配 `Windows`／`Mac`，其他情况默认为 Linux。使用实际原生 UA 格式的隔离回归先重现“Windows 发送 Linux”，修复后发送 Windows。

表单现在优先读取原生 `api.system` 平台标记，保留 Android 桥接；桥接未就绪时识别原生 UA 名称。未知平台不发送 platform。回归覆盖 Windows、macOS、Linux、FreeBSD、Android、Winnt／Darwin 回退及未知客户端，验证原生标记优先于冲突 UA。

隔离 HTTP 页面未启动 Emby nativeshell，因此最初只读取 Chromium 默认 UA 的回归未重现问题。补入原生 UA 与系统属性边界后，旧实现明确失败。测试中的系统标记和 HTTP 服务是夹具，真实报错表单、客户端序列化和 QtWebEngine 均实际执行。

## 时间输入

发生时间改为并排的“分钟”和“秒”，后端字段仍为 `context.positionSeconds`。12 分 30 秒发送 750；全部留空省略字段，显式 0 分 0 秒保留 0，单独填写分钟或秒均可。分钟和秒要求非负整数，秒最大 59，合计不能超过接口现有上限 604800 秒。

新增控件回归在旧实现下先失败，再确认修复通过；覆盖 60 秒、负数、小数、一周上限及超出上限。失败保留可编辑草稿，等待提交时冻结两个时间输入，原有报错 UUID 重试、消息已读、账号切换与报错历史仍通过。

## 执行结果

- Windows 构建及暂存成功；完整 CTest 62/62，115.91 秒。评审修正 Android fixture 环境变量选择后，再执行相关两个 CTest 目标，2/2 通过；报错 UI 额外验证 8 组平台场景。
- 独立评审未发现生产代码问题；指出的 `TIGEREST_ANDROID_FIXTURE` 选择问题已修正并复查。
- Chromium 1200×850 与 360×800 布局检查及截图核对通过，分秒控件无横向溢出。QtWebEngine 的独立截图请求超时，因此视觉检查使用 Chromium；QtWebEngine 报错交互测试正常通过。没有把窄屏 Chromium 验证当作 Android 实机验证。
- 预览 ZIP CRC 通过，解压主程序与已验证暂存主程序逐字节相同。移除工具链 PATH 和 Qt 运行库覆盖后，在隔离配置中使用包内运行库完成相同报错 UI 检查。
- 原生／UI 执行前均在同一个 PowerShell 调用读取 `dev/windows/TESTING.md` 并加载测试环境。没有向生产报错服务写测试数据，也没有修改正式客户端账号、设置或安装。

## 日志附件

现有 `X:/community-api.md` 的 `/reports` 明确不接受日志。根据用户选择，仅整理后端开发清单 `docs/backend-report-diagnostics-proposal.md`，未添加无效日志字段或宣称已自动上传。待后端实现并提供最终契约后，再对接客户端采集和上传；Android 还需应用内有界日志记录。
