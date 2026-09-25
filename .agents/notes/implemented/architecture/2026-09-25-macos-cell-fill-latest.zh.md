# macOS 单元格填充与 npm latest 兼容

- 按官方 npm 通道解析，而非直接选择最新 GitHub 预发布：2026-09-25 核查，`latest` 为 dsh 0.1.5-rc.3，`next` 为 0.1.7-rc.2。host、public Harness 开发依赖和生产 peers 固定为 0.1.5-rc.3。保留 Cordis 4.0.2 与 patched Ink 7.1.1；不内置 Harness，也不导入上游源码。
- 清除生成的 workspace-state 元数据后，重新解析仓库与隐藏 pnpm 锁文件。禁止残留自动安装的 rc.2 peers；仓库闭包检查新增相应断言。
- 保留鲸鱼栅格、半格轮廓、52 列/20 行尺寸、居中和降级逻辑。实心单元格增加相同背景色，防止字体行间隙露出横线；外侧半格仍透明。
- 滚动条前景和背景使用相同填充，保留原有私有标记、绝对列输出、拖拽几何和单列宽度；深浅主题使用可区分的低亮度轨道。不增加帧、计时器、图像库或渲染路径。
- 在真实 PTY 模拟器中验证背景属性，因为非 TTY 帧测试会剥离 ANSI 颜色。保留 preset、resume/fork、jobs 归属、workflow 隔离与性能断言。
- 仅构建本地 tarball；不发布、不更改 tag 或 release。原生终端视觉效果由用户验收。

本地证据：build、typecheck、verify:repo、test:docs 和精确 tarball 审计通过。全套 49 个文件，526 项通过 / 3 项 Windows 专用测试跳过。官方 clean room 的直接启动、两种 launcher 启动、Cordis/Harness 单例和共享 React 检查通过。tarball：278035 字节，SHA256 38b33d267534e14036ba6b663cb3bcb1d4015dcfacc8bfa1ba539fa7fcac756f。macOS PTY：60 秒、3000 节点、444 次输入采样，p95 23 ms / 最大 34 ms，无负载测试错误。不据此保证长期无泄漏，也未声称运行 Windows/Linux 矩阵。性能探针改为匹配现有箭头；仅 PTY fixture 强制颜色，避免继承的 NO_COLOR 禁用颜色断言。经用户授权使用 AppleScript 打开原生 Terminal 验收版，未修改原有用户 profile。

## macOS 右缘修正

用户验收发现右缘仍有锯齿：背景填充上方仍绘制完整块状字形。仅在 darwin 且 ANSI 背景样式存在时，原有 Ink 标记输出器改为空格；保持 CHA 定位、颜色、宽度及 Windows/Linux 输出字节不变，无颜色输出保留可见块状回退。不改写鲸鱼或会话正文的普通块状字符。已安装输出器的平台测试覆盖命名色/256 色/RGB 填充、无颜色回退和普通块字；实际 macOS PTY 测试检查填色空格、拖拽、缩放、忙时输入及退出恢复。不修改渲染布局或调度。原生验收窗口在独立临时 profile 中恢复上次验收历史的稳定副本，不复制锁或凭据，不提交新的模型请求。

渲染层的同色前景/背景填充也仅限 macOS；Windows/Linux 保留原有暗轨道与青色/蓝色滑块样式。左上角 brandGlyph 和 Apple Terminal 回退不变，由平台样式与图标回退断言覆盖。

右缘修正最终证据：build、typecheck、verify:repo、文档校验、tarball 审计和官方 clean-room 验证通过。全套 50 个文件，537 项通过 / 3 项 Windows 专用测试跳过。最终 tarball：278281 字节，SHA256 c241b9220c380b7358e92bd45c15e51792117a3909520152d8057792aa248085。右缘补丁的 60 秒/3000 节点 PTY 负载运行 p95 23 ms、p99 24 ms、最大 59 ms，无负载错误。最终原生 Terminal 窗口 1212 成功加载历史副本。本机未执行 Windows/Linux 原生视觉验收。

## 0.2.2 发布准备

用户已明确授权 npm 发布、新 tag、GitHub Release 及提交推送。插件升级至 0.2.2，中英文安装指南改用准确的 rc.3 host；滚动条与鲸鱼回归加入现有 Windows/Linux/macOS smoke 矩阵。源码提交推送并通过 CI 后，只发布已经审计及 clean-room 验证的 staged tarball，并在该源码提交创建新 v0.2.2 tag，不移动既有标签。初次凭据检查显示 npm、gh 与 Git HTTPS 均未认证，因此 registry 和远端发布仍待认证与 CI。
