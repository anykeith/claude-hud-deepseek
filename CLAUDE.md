# claude-hud-deepseek

**技术栈**：Node.js (ESM) — 零依赖

## 自动引入的规则

@~/.claude/rules-lib/typescript/coding-style.md
@~/.claude/rules-lib/typescript/hooks.md
@~/.claude/rules-lib/typescript/patterns.md
@~/.claude/rules-lib/typescript/security.md

## 项目概述

Claude Code status line 插件，适配 DeepSeek 后端。由 Claude Code harness 在每次 tick 时通过 stdin pipe JSON 调用，解析 transcript 获取实时活动数据，渲染多行状态栏输出到 stdout。

### 输出结构

```
[model] │ project git:(branch*) │ ⏱ 59m │ 2 CLAUDE.md │ 10 rules │ 7 hooks
Context ████░░░░ 12%/1000k │ Tok in:80k out:40k total:120k
────────────────────────────────────────
◐ Bash: running-command... │ ✓ Edit ×4 │ ✓ Bash ×3 │ ✓ Read ×2
◐ explore [haiku]: Finding code
▸ Fix auth bug (2/5)
```

## 目录结构

```
.
├── CLAUDE.md
├── README.md
├── package.json
├── ports.env
├── .env.example
├── docs/
│   ├── PORTS.md
│   └── CREDENTIALS.md
└── src/
    └── index.js      # 单文件入口：stdin 解析 → transcript 流式读取 → 渲染输出
```

## 数据流

```
Claude Code harness
  │
  ├─ stdin (JSON): context_window, model, cwd, transcript_path, cost
  │
  ▼
src/index.js
  ├─ readStdin()          → 解析 stdin JSON
  ├─ validateStdin()      → 输入校验 + transcript 路径沙箱
  ├─ parseTranscript()    → 流式读取 transcript JSONL（readline）
  ├─ getGit()             → git branch + dirty state
  ├─ getConfigCounts()    → 扫描 ~/.claude/ 配置统计（5s 缓存）
  └─ render()             → ANSI 彩色输出
  │
  ▼
stdout → 状态行显示
```

## 安全设计

- `transcript_path` 限制在 `~/.claude/projects/` 目录内（防路径穿越）
- transcript 文件大小上限 5MB，非普通文件拒绝（防 /dev/zero 挂起）
- `settings.json` 只提取计数，原始对象立即丢弃（防密钥泄漏）
- 所有用户输入字段经 `stripAnsi()` 处理后渲染（防终端注入）
- Git 命令通过 `cwd` 选项传递，不拼接 shell 字符串

## 运行方式

由 Claude Code harness 直接调用，配置在 `~/.claude/settings.json` → `statusLine`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node /opt/projects/claude-hud-deepseek/src/index.js"
  }
}
```

## 记忆与计划位置

- 项目记忆：`~/.claude/projects/<encoded-path>/memory/`
- 项目 plan：`docs/plan.md`
- 会话存档：`sessions/`
