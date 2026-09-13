# 本地 Harness latest 与 TUI 显示调整

- 2026-09-12 官方 npm latest 为 dsh 0.1.5-rc.1，不是 next。保持 public npm exports、host 外部 runtime 和原 Ink patch。官方传递依赖 semver 范围会把部分包解析至 0.1.5-rc.2，host 锁定版本不代表全部传递依赖版本一致。
- 仅把当前 Agent 的 assistant stream 帧作为临时 fold 输入。持久结算替换实时正文，并用官方 compact stream 展开接口回放；临时帧不写入 Session。嵌套工具事件调整为 ptc-dispatch，命令图片添加类型标记，旧 projection cache 失效。
- 蓝白鲸鱼使用静态像素数据，外部保留终端背景，无图像处理运行时依赖。输入提示符仍占一格，剪贴板/输入处理及偏移保持不变。命令列表使用正文颜色，保留选中箭头；只移除上方状态行的重复计数。
- 仅做本地 build/typecheck、聚焦 fold/UI/剪贴板/布局测试、一项 PTY 输入/拖选/缩放检查、repo/docs 检查和一次 official host packed-plugin clean-room。未跑带 API key 的 E2E 或跨平台矩阵。clean-room 包生成于 projection cache 版本调整之前，仅作未发布本地诊断，不是发布候选包。
- 未提交、推送、改发行版本、改用户 profile、创建 tag 或 Release。

## 2026-09-13 回滚
用户要求撤回视觉修改。渲染器、viewport、鲸鱼及视觉测试恢复 HEAD，移除静态鲸鱼数据。仅保留 Harness 适配与流式回归。此前视觉预览和构建包已作废。


## 2026-09-13 严格复审更正
最终确认的 UI 为抗锯齿蓝鲸、白色嘴眼、单格提示符和统计去重，命令面板配色保持原样。重建锁解析及 pnpm 工作区缓存后移除了旧 persistence peer。CLI 保持 0.1.5-rc.1，子包依赖及 peer 精确对齐 0.1.5-rc.2。冷 fork 读取采用 public observeSession，复制后释放 lease，避开 readSession 的 seed 构造失败。新版官方 minimal preset 为单 shell，精确期望已对齐其发布契约，切换/fork/resume/jobs/workflow 覆盖均保留。测试需要真实临时目录访问权限，否则 EPERM 会在 mock adapter 前结束 turn。此前候选包作废，本轮复审不发布 npm/tag/release。


最终本地证据：49 个测试文件通过，527 测试通过 / 1 跳过；host/client build、typecheck、repo/docs 及 exact 0.2.1 tarball clean-room PASS。候选包 277721 字节、202 文件，SHA256 6d7432b71be1e31636f40db74cd55381f1164c781f170a9d3fbf0e0131dc7c63。Windows 真 PTY 通过；本地未重跑 Linux/macOS CI 矩阵。
