# OpenAI Codex 桌面端适配器 (OpenCLI)

利用 CDP 协议，直接从命令行/外部脚本接管和操控 **OpenAI Codex 官方桌面版**。
因为官方 Codex 是基于 Electron 构建的“多 Agent 协作中心”，通过本适配器，你可以让 AI 自动控制另一个 AI 完成工作，甚至自动截取代码审查的 Diff！

## 前置环境准备

1. 你必须下载并安装了官方原版的 OpenAI Codex 客户端。
2. 必须通过命令行挂载 CDP 调试端口启动它：
   ```bash
   # macOS 启动示例
   /Applications/Codex.app/Contents/MacOS/Codex --remote-debugging-port=9222
   ```

## 配置指南

在你要运行命令的终端里导出环境变量：
```bash
export OPENCLI_CODEX_CDP_ENDPOINT="http://127.0.0.1:9222"
```

## 核心指令

### 探查与调试
- `opencli codex status`: 检查是否成功连上内部 Chromium，获取上下文 Title。
- `opencli codex dump`: 强制剥离整个 App 的内部 DOM 树和无障碍视图并保存到 `/tmp`，是编写复杂自动化 RPA 脚本的终极利刃。

### 自动化执行
- `opencli codex new`: 模拟按下 `Cmd+N`。建立一个彻底干净、隔离了 Git Worktree 的全线并行 Thread。
- `opencli codex send "要发送的话"`: 强行跨越 Shadow Root 找到对应的富文本编辑器并注入提词。
  - *高阶技巧*: 你可以直接发送内置宏！例如 `opencli codex send "/review"` 就能触发本工作流的代码审查，或者 `opencli codex send "$imagegen"` 触发技能。
- `opencli codex read`: 完整抓取并提取整个当前 Thread 里的思考过程和对话日志。
- `opencli codex extract-diff`: 专门用于拦截并提取由 AI 建议的 `+` / `-` 代码 Patch 修改块，直接输出结构化数据！
