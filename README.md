# claude-hud-deepseek

Claude Code status line plugin for [DeepSeek](https://deepseek.com) API backend. Displays real-time context usage, token consumption, tool/agent/task activity, git branch, and session duration — directly in your terminal status bar.

## Why

Claude Code's built-in status line relies on Anthropic-specific rate-limit headers that DeepSeek does not return. This plugin replaces that dependency with transcript-based tracking, giving you full visibility into your DeepSeek-powered Claude Code sessions.

## What You See

```
[deepseek-v4-pro] │ my-project git:(main*) │ ⏱ 59m │ 1 CLAUDE.md │ 10 rules │ 7 hooks
Context ████░░░░░░ 45%/1000k │ Tok in:450k out:82k total:532k
────────────────────────────────────────
◐ Bash: npm run build... │ ✓ Edit ×4 │ ✓ Bash ×3 │ ✓ Read ×2
◐ explore [haiku]: Finding memory leaks
▸ Fix auth bug (2/5)
```

### Line by line

| Line | Content |
|---|---|
| 1 | Model name, working directory, git branch (with dirty `*`), session duration, config counts |
| 2 | Context window usage bar + percentage + window size, session token totals (in/out/total) |
| 3 | Activity separator (only when there is activity) |
| 4 | Running tools (`◐`) and completed tool counts by name (`✓`) from the last 20 tool invocations |
| 5 | Agent status — running agents with type/model/description, recently completed agents |
| 6 | Task progress — current in-progress task content + (completed/total), or "All tasks complete" |

## Install

### Prerequisites

- Node.js ≥ 18
- Claude Code with DeepSeek backend configured

### Setup

```bash
git clone https://github.com/YOUR_USERNAME/claude-hud-deepseek.git /opt/projects/claude-hud-deepseek
```

Then update `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node /opt/projects/claude-hud-deepseek/src/index.js"
  }
}
```

The status bar will update on the next tick — type any character to trigger a refresh.

## How It Works

```
Claude Code harness
  │
  ├─ stdin (JSON): context_window, model, cwd, transcript_path
  │
  ▼
src/index.js (single file, zero npm dependencies)
  ├─ readStdin()          → Parse stdin JSON pipe
  ├─ validateStdin()      → Input validation + transcript path sandbox
  ├─ parseTranscript()    → Stream-read transcript JSONL via Node.js readline
  ├─ getGit()             → git branch + dirty state
  ├─ getConfigCounts()    → Scan ~/.claude/ for config stats (5s cache)
  └─ render()             → ANSI-colored multi-line output
  │
  ▼
stdout → Claude Code status bar
```

## Security

- **Path sandbox**: `transcript_path` is restricted to `~/.claude/projects/` — rejects traversal
- **File size guard**: Transcripts larger than 5MB or non-regular files (e.g. `/dev/zero`) are rejected
- **No secret retention**: `settings.json` is parsed to extract scalar counts only; the raw object is discarded immediately
- **ANSI sanitization**: All user-controlled strings from transcript data are stripped of escape sequences before rendering
- **No shell injection**: Git commands use hardcoded strings with `cwd` option, not shell concatenation

## vs claude-hud

| Feature | claude-hud | claude-hud-deepseek |
|---|---|---|
| Context bar | ✅ | ✅ |
| Token usage | ✅ (rate-limit headers) | ✅ (context_window totals) |
| Usage limits (5h/7d) | ✅ (Anthropic headers) | ❌ (DeepSeek doesn't provide) |
| Tool activity | ✅ | ✅ |
| Agent activity | ✅ | ✅ |
| Task progress | ✅ | ✅ |
| Git branch | ✅ | ✅ |
| Session duration | ✅ | ✅ |
| Config counts | ✅ | ✅ |
| Dependencies | ~10 npm packages | **Zero** |
| Backend | Anthropic only | DeepSeek |

## Configuration

All display preferences are currently hardcoded in `src/index.js`. Future versions will support `~/.claude/plugins/claude-hud/config.json` for customization.

## License

MIT
