# claude-hud-deepseek

<p align="center">
  <strong>DeepSeek 后端专用 Claude Code 状态栏插件 — 零依赖、实时追踪、即装即用</strong>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-green.svg" alt="MIT"></a>
  <a href="#"><img src="https://img.shields.io/badge/node-%E2%89%A518-brightgreen" alt="Node.js ≥ 18"></a>
  <a href="#"><img src="https://img.shields.io/badge/依赖-零-blue" alt="零依赖"></a>
  <a href="#"><img src="https://img.shields.io/badge/后端-DeepSeek-536DFE" alt="DeepSeek"></a>
  <a href="#"><img src="https://img.shields.io/badge/安装体积-~20KB-lightgrey" alt="安装体积 ~20KB"></a>
  <a href="./README.md"><img src="https://img.shields.io/badge/Docs-English-blue" alt="英文文档"></a>
</p>

---

## 一键安装

```bash
curl -fsSL https://raw.githubusercontent.com/anykeith/claude-hud-deepseek/main/install.sh | bash
```

安装完成后在 Claude Code 中按任意键即可看到效果。**零 npm 依赖**，不污染 node_modules，安装体积仅 ~20KB。

---

## 为什么需要它？

Claude Code 内置状态栏依赖 Anthropic 特有的 **rate-limit 响应头** 来显示用量数据，但 DeepSeek 后端**不返回这些头**，导致使用 DeepSeek 时状态栏信息空白或不完整。

本插件用 **transcript 解析 + Pre/PostToolUse 双 hook** 机制完全替代了响应头依赖，让 DeepSeek 用户也能看到完整的上下文用量、Token 统计、工具运行状态、任务进度等关键信息。

---

## 效果展示

```
[deepseek-v4-pro] │ ~/my-project git:(main*) │ ⏱ 1h 23m │ 1 CLAUDE.md │ 10 rules │ 8 hooks
Context █████▇░░░░ 52%/1000k │ Tok in:320k out:95k total:415k
◐ Agent: Debugging auth flow  Read: auth.ts │ ✓ Bash ×2  ✓ Read  ✓ Edit
▸ Fix auth token refresh bug (2/4)
```

### 行说明

| 行 | 内容 | 数据来源 |
|----|------|----------|
| **1** | 模型名 · 工作目录 · git 分支（`*`=有未提交变更）· 会话时长 · 配置统计 | stdin + git + `~/.claude/` |
| **2** | 上下文窗口进度条 + 已用百分比 + 总大小 · 会话 Token 入/出/总 | stdin `context_window` |
| **3** | ◐ 运行中工具含命令/文件名详情 · ✓ 最近完成的工具计数 | Pre/Post 双 hook + transcript |
| **4** | ▸ 当前活跃任务 + 完成进度 (N/M) | transcript TodoWrite/TaskUpdate |

---

## 特性

| 特性 | 说明 |
|------|------|
| 📊 **上下文进度条** | 直观展示上下文窗口已用/总容量 |
| 🔢 **Token 统计** | 会话总输入、输出、合计 token |
| ⚡ **实时工具追踪** | Pre+Post 双 hook，<1 tick 延迟 |
| 🎯 **工具详情** | 显示运行中工具的命令/文件名/Agent 描述 |
| ✅ **已完成工具** | 最近 2 分钟内完成的工具自动统计 |
| 📋 **任务进度** | 当前活跃任务名称 + 完成进度 |
| 🌿 **Git 状态** | 分支名 + 未提交变更星标 |
| ⏱ **会话时长** | 从第一条消息开始的计时 |
| 📦 **零依赖** | 不依赖任何 npm 包，~20KB |
| 🔒 **安全设计** | 路径沙箱、ANSI 清洗、无 shell 注入 |

---

## 环境要求

| 依赖 | 版本 | 说明 |
|------|------|------|
| **Node.js** | ≥ 18 | 插件运行时 |
| **Claude Code** | 最新版 | 已配置 DeepSeek 后端 |
| **Git** | 任意版本 | 可选，仅用于分支显示 |

---

## 安装方式

### 方式一：一键安装（推荐）

```bash
curl -fsSL https://raw.githubusercontent.com/anykeith/claude-hud-deepseek/main/install.sh | bash
```

脚本自动完成：
1. 克隆（或更新）仓库到 `/opt/projects/claude-hud-deepseek`
2. 部署 PreToolUse + PostToolUse 双 hook 到 `~/.claude/scripts/hooks/`
3. 合并 `statusLine` 和 hooks 配置到 `~/.claude/settings.json`
4. 修改前自动备份原配置文件

自定义安装路径：

```bash
CLAUDE_HUD_INSTALL_DIR="$HOME/projects/claude-hud-deepseek" curl -fsSL https://raw.githubusercontent.com/anykeith/claude-hud-deepseek/main/install.sh | bash
```

### 方式二：手动安装

```bash
git clone https://github.com/anykeith/claude-hud-deepseek.git /opt/projects/claude-hud-deepseek
```

在 `~/.claude/settings.json` 中添加：

```json
{
  "statusLine": {
    "type": "command",
    "command": "node /opt/projects/claude-hud-deepseek/src/index.js"
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "node /opt/projects/claude-hud-deepseek/src/tool-tracker.cjs" }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "node /opt/projects/claude-hud-deepseek/src/tool-tracker-post.cjs" }
        ]
      }
    ]
  }
}
```

重启 Claude Code（或按任意键）即可。

### 方式三：与官方 claude-hud 共存

两个插件可以并存，只需将 `statusLine.command` 指向本插件，hook 不会冲突。

---

## 工作原理

```
Claude Code harness（每次 tick）
  │  stdin pipe → { model, cwd, transcript_path, context_window }
  ▼
src/index.js（零依赖，单文件 ~400 行）
  │
  ├─ readStdin()          解析 stdin JSON
  ├─ validateStdin()      输入校验 + transcript 路径沙箱
  ├─ readHookState()      从 Pre+Post 双 hook 读取实时运行工具
  ├─ parseTranscript()    流式解析 transcript JSONL（回退方案）
  ├─ getGit()             git branch + 脏状态检测
  ├─ getConfigCounts()    扫描 ~/.claude/ 统计配置（5s 缓存）
  └─ render()             ANSI 彩色多行输出 → stdout
```

### 实时工具追踪精度的关键：双 hook 机制

```
PreToolUse  ─→ counter++ 记录 target  ─┐
                                       ├─ < 1 tick 延迟，近乎瞬时
PostToolUse ─→ counter-- 移除 target  ─┘
                                       │
Hook 状态过期 (>5s 无活动)              ─→ transcript 解析回退
```

---

## vs claude-hud 对比

| 功能 | claude-hud | claude-hud-deepseek |
|------|-----------|---------------------|
| 上下文进度条 | ✅ | ✅ |
| Token 用量追踪 | ✅（rate-limit 头） | ✅（context_window 总计） |
| 用量限制（5h/7d） | ✅（Anthropic 头） | ❌（DeepSeek 不提供） |
| 运行中工具检测 | ✅（仅 transcript） | ✅（**Pre+Post 双 hook**，<1 tick） |
| 已完成工具 ✓ | ✅ | ✅ |
| 当前任务 ▸ | ✅ | ✅ |
| 工具详情（targets） | ✅ | ✅ |
| Git 分支 + 脏状态 | ✅ | ✅ |
| 会话时长 | ✅ | ✅ |
| 配置统计 | ✅ | ✅ |
| npm 依赖 | ~10 个包 | **零** |
| 后端支持 | 仅 Anthropic | **DeepSeek** |
| 安装体积 | ~2MB | **~20KB** |

---

## 项目结构

```
.
├── README.md                ← 英文文档
├── README.zh-CN.md           ← 中文文档（你在这里）
├── install.sh                ← 一键安装脚本
├── package.json              ← 元数据（零依赖）
├── .env.example              ← 环境变量模板
├── ports.env                 ← 端口声明
├── docs/
│   ├── PORTS.md              ← 端口分配
│   └── CREDENTIALS.md        ← 凭证说明
└── src/
    ├── index.js              ← 主插件（stdin → 渲染 → stdout）
    ├── tool-tracker.cjs      ← PreToolUse hook（递增计数 + 记录 target）
    └── tool-tracker-post.cjs ← PostToolUse hook（递减计数 + 清理）
```

---

## 配置

`src/index.js` 中可调的常量：

| 常量 | 默认值 | 说明 |
|------|--------|------|
| `HOOK_STALE_MS` | `5000` | Hook 状态过期阈值（毫秒） |
| `MAX_TRANSCRIPT_BYTES` | `5MB` | 最大 transcript 文件大小 |
| `MAX_TRANSCRIPT_LINES` | `2000` | 最大解析行数 |
| `BAR_W` | `10` | 上下文进度条宽度 |

---

## 故障排除

<details>
<summary><b>状态栏不显示</b></summary>

```bash
# 1. Node.js ≥ 18
node -v

# 2. 验证 settings.json 是合法 JSON
python3 -m json.tool ~/.claude/settings.json > /dev/null

# 3. 确认插件文件存在
ls /opt/projects/claude-hud-deepseek/src/index.js

# 4. 独立测试插件
echo '{"context_window":{"used_percentage":50}}' | node /opt/projects/claude-hud-deepseek/src/index.js
```
</details>

<details>
<summary><b>工具追踪不工作</b></summary>

```bash
# 1. 确认双 hook 文件
ls ~/.claude/scripts/hooks/tool-tracker.js
ls ~/.claude/scripts/hooks/tool-tracker-post.js

# 2. 检查 settings.json 中 PreToolUse 和 PostToolUse 均已注册

# 3. 手动测试
echo '{"tool_name":"Bash","tool_input":{"command":"test"}}' | node ~/.claude/scripts/hooks/tool-tracker.js
echo '{"tool_name":"Bash"}' | node ~/.claude/scripts/hooks/tool-tracker-post.js
cat /tmp/claude-hud-tools.json
```
</details>

<details>
<summary><b>Git 分支不显示</b></summary>

```bash
git --version
git branch  # 确保当前目录是 git 仓库且至少有一次提交
```
</details>

---

## 安全

| 措施 | 说明 |
|------|------|
| **路径沙箱** | `transcript_path` 限制在 `~/.claude/projects/` 内，拒绝路径穿越攻击 |
| **文件大小保护** | transcript > 5MB 或非普通文件（如 `/dev/zero`）直接拒绝 |
| **密钥不落地** | `settings.json` 只提取数字计数，原始对象立即丢弃 |
| **ANSI 清洗** | 所有用户可控字符串渲染前剥离 ANSI 转义序列 |
| **无 Shell 注入** | Git 命令使用硬编码字符串 + `cwd` 选项 |

---

## 卸载

```bash
rm -rf /opt/projects/claude-hud-deepseek
```

然后从 `~/.claude/settings.json` 中移除 `statusLine`、`PreToolUse`、`PostToolUse` 相关配置即可。

---

## 参与贡献

欢迎提交 Issue 和 PR。提交前请测试：

```bash
echo '{"model":{"display_name":"deepseek-v4-pro"},"cwd":"/root","context_window":{"used_percentage":45,"context_window_size":100000,"total_input_tokens":450000,"total_output_tokens":82000},"transcript_path":""}' | node src/index.js
```

核心原则：
- **零依赖** — 这是设计约束，不是偏好
- **无 fallback** — 失败必须显式报错，绝不静默降级

---

## License

MIT © 2025
