#!/usr/bin/env node

/**
 * claude-hud-deepseek — Status line plugin for Claude Code with DeepSeek backend.
 *
 *   [model] │ cwd git:(branch*) │ ⏱ 1h │ 2 CLAUDE.md │ 10 rules │ 8 hooks
 *   Context ████░░░░ 45%/1000k │ Tok in:80k out:40k total:120k
 *   ◐ Bash: cmd  Read: file  │ ✓ Bash ×3  ✓ Read ×2
 *   ▸ Fix auth bug (2/5)
 */

import { existsSync, statSync, readFileSync, createReadStream, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, normalize, basename } from 'node:path';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';

// ═══════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════

const HOME = homedir();
const TRANSCRIPT_DIR = resolve(HOME, '.claude/projects');
const SETTINGS_PATH = resolve(HOME, '.claude/settings.json');
const RULES_DIR = resolve(HOME, '.claude/rules/common');
const MAX_TRANSCRIPT_BYTES = 5 * 1024 * 1024;
const MAX_TRANSCRIPT_LINES = 2000;
const STDIN_MAX_BYTES = 256 * 1024;
const HOOK_STALE_MS = 5_000;

function hookStateFile(transcriptPath) {
  if (!transcriptPath) return '';
  const stem = basename(transcriptPath, '.jsonl');
  return stem ? `/tmp/claude-hud-tools-${stem}.json` : '';
}

// ═══════════════════════════════════════════════════════
// ANSI
// ═══════════════════════════════════════════════════════

const ANSI_RE = /\x1B\[[0-?]*[ -/]*[@-~]/g;

function stripAnsi(s) {
  if (typeof s !== 'string') return '';
  return s.replace(ANSI_RE, '');
}

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};
const D = (s) => `${C.dim}${stripAnsi(s)}${C.reset}`;

// ═══════════════════════════════════════════════════════
// Stdin
// ═══════════════════════════════════════════════════════

function readStdin() {
  if (process.stdin.isTTY) return Promise.resolve(null);

  return new Promise((resolve) => {
    let raw = '';
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      process.stdin.off('data', onD);
      process.stdin.off('end', onE);
      process.stdin.off('error', onErr);
      process.stdin.pause();
      resolve(v);
    };
    const onD = (c) => {
      raw += String(c);
      if (Buffer.byteLength(raw, 'utf8') > STDIN_MAX_BYTES) { done(null); return; }
      try { done(JSON.parse(raw.trim())); } catch {}
    };
    const onE = () => { try { done(JSON.parse(raw.trim())); } catch { done(null); } };
    const onErr = () => done(null);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', onD);
    process.stdin.on('end', onE);
    process.stdin.on('error', onErr);
    process.stdin.resume();
  });
}

// ═══════════════════════════════════════════════════════
// Input validation
// ═══════════════════════════════════════════════════════

function safeString(v) {
  if (typeof v === 'string') return v.slice(0, 4096);
  return '';
}

function sanitizeTranscriptPath(userPath) {
  if (!userPath) return '';
  const resolved = resolve(userPath);
  return normalize(resolved).startsWith(normalize(TRANSCRIPT_DIR)) ? resolved : '';
}

function validateStdin(data) {
  if (!data || typeof data !== 'object') return null;
  if (!data.context_window || typeof data.context_window !== 'object') return null;
  return {
    model: {
      display_name: safeString(data.model?.display_name),
      id: safeString(data.model?.id),
    },
    cwd: safeString(data.cwd),
    transcript_path: sanitizeTranscriptPath(safeString(data.transcript_path)),
    context_window: data.context_window,
  };
}

// ═══════════════════════════════════════════════════════
// Hook state — running tool counters from PreToolUse hook
// ═══════════════════════════════════════════════════════

const RECENT_VISIBLE_MS = 3_000;

function readHookState(stateFile) {
  if (!stateFile) return null;
  try {
    if (!existsSync(stateFile)) return null;
    const data = JSON.parse(readFileSync(stateFile, 'utf8'));
    if (data.updated && (Date.now() - data.updated) > HOOK_STALE_MS) return null;
    if (!data.tools || Object.keys(data.tools).length === 0) return null;

    const running = [];
    const recent = new Map(); // name → count

    for (const [name, v] of Object.entries(data.tools)) {
      const entry = typeof v === 'object' && v !== null ? v : { n: v || 0, targets: [], recent: [] };
      // Running tools — show with target detail
      if (entry.n > 0) {
        running.push({ name, n: entry.n, target: (entry.targets || []).slice(-1)[0] || '' });
      }
      // Recently completed — visible for RECENT_VISIBLE_MS
      const now = Date.now();
      for (const r of (entry.recent || [])) {
        if (r.at && (now - r.at) < RECENT_VISIBLE_MS) {
          recent.set(name, (recent.get(name) || 0) + 1);
        }
      }
    }

    return {
      running: running.length > 0 ? running : null,
      recent: recent.size > 0 ? recent : null,
    };
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════
// Git
// ═══════════════════════════════════════════════════════

function getGit(cwd) {
  if (!cwd) return null;
  try {
    const branch = execSync('git branch --show-current 2>/dev/null', {
      cwd, encoding: 'utf8', timeout: 2000,
    }).trim();
    if (!branch) return null;
    const status = execSync('git status --porcelain 2>/dev/null', {
      cwd, encoding: 'utf8', timeout: 2000,
    });
    return { branch: stripAnsi(branch), dirty: status.trim().length > 0 };
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════
// Config counts — cached 5s
// ═══════════════════════════════════════════════════════

let _configCache = null;
let _configCacheTime = 0;

function getConfigCounts() {
  const now = Date.now();
  if (_configCache && (now - _configCacheTime) < 5000) return _configCache;

  let claudeMd = 0, rules = 0, mcps = 0, hooks = 0;

  try {
    if (existsSync(resolve(process.cwd(), 'CLAUDE.md'))) claudeMd++;
    if (existsSync(resolve(HOME, '.claude/CLAUDE.md'))) claudeMd++;
  } catch {}
  try {
    if (existsSync(RULES_DIR)) {
      rules = readdirSync(RULES_DIR).filter(f => f.endsWith('.md')).length;
    }
  } catch {}
  try {
    if (existsSync(SETTINGS_PATH)) {
      const raw = readFileSync(SETTINGS_PATH, 'utf8');
      const settings = JSON.parse(raw);
      mcps = Object.keys(settings.mcpServers || {}).length;
      for (const phase of Object.values(settings.hooks || {})) {
        hooks += (Array.isArray(phase) ? phase : []).reduce((n, g) => n + (g.hooks || []).length, 0);
      }
    }
  } catch {}

  _configCache = { claudeMd, rules, mcps, hooks };
  _configCacheTime = now;
  return _configCache;
}

// ═══════════════════════════════════════════════════════
// Transcript parsing — streaming, size-guarded
// ═══════════════════════════════════════════════════════

function emptyTranscript() {
  return { tools: [], completedBy: new Map(), activeTask: null, sessionStart: null };
}

async function parseTranscript(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) {
    return emptyTranscript();
  }

  try {
    const st = statSync(transcriptPath);
    if (!st.isFile() || st.size > MAX_TRANSCRIPT_BYTES) {
      return emptyTranscript();
    }
  } catch {
    return emptyTranscript();
  }

  const toolMap = new Map();
  const completedBy = new Map(); // name → count (session total)
  const createSubjectById = new Map(); // tool_use id → subject (for TaskCreate)
  const taskSubjectById = new Map();   // taskId → subject (for TaskUpdate lookup)
  let activeTask = null;              // { subject, done, total } | null
  let sessionStart = null;
  let lineCount = 0;

  try {
    const rl = createInterface({
      input: createReadStream(transcriptPath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (++lineCount > MAX_TRANSCRIPT_LINES) break;
      if (!line.trim()) continue;

      let entry;
      try { entry = JSON.parse(line); } catch { continue; }

      if (!sessionStart && entry.timestamp) {
        const ts = new Date(entry.timestamp);
        if (!Number.isNaN(ts.getTime())) sessionStart = ts;
      }

      const ts = entry.timestamp && !Number.isNaN(new Date(entry.timestamp).getTime())
        ? new Date(entry.timestamp) : null;
      if (!ts) continue;

      const blocks = entry.message?.content;
      if (!Array.isArray(blocks)) continue;

      if (entry.type === 'assistant') {
        for (const blk of blocks) {
          if (blk.type === 'tool_use' && blk.id && blk.name) {
            toolMap.set(blk.id, {
              name: blk.name,
              target: extractTarget(blk.name, blk.input),
              status: 'running',
              time: ts,
            });

            const inp = blk.input || {};

            // TodoWrite: { todos: [{status, content, activeForm}] }
            if (blk.name === 'TodoWrite' && Array.isArray(inp.todos)) {
              const active = inp.todos.find(t => t.status === 'in_progress');
              if (active) {
                const done = inp.todos.filter(t => t.status === 'completed').length;
                activeTask = { subject: active.content || active.activeForm || '', done, total: inp.todos.length };
              } else {
                activeTask = null; // no active task in this TodoWrite
              }
            }

            // TaskCreate: remember subject for later taskId resolution
            if (blk.name === 'TaskCreate' && inp.subject) {
              createSubjectById.set(blk.id, inp.subject);
            }

            // TaskUpdate: resolve subject via taskId → subject map
            if (blk.name === 'TaskUpdate' && inp.taskId) {
              const tid = String(inp.taskId);
              const subject = taskSubjectById.get(tid) || inp.subject;
              if (inp.status === 'in_progress' && subject) {
                activeTask = { subject, done: 0, total: 0 };
              } else if (inp.status === 'completed' || inp.status === 'cancelled') {
                // Task finished — clear if this was the active task
                if (activeTask && activeTask.subject === subject) {
                  activeTask = null;
                }
              }
            }
          }
        }
      }

      if (entry.type === 'user') {
        for (const blk of blocks) {
          if (blk.type === 'tool_result' && blk.tool_use_id) {
            const tool = toolMap.get(blk.tool_use_id);
            if (tool) {
              tool.status = blk.is_error ? 'error' : 'completed';
              tool.endTime = ts;
              if (!blk.is_error) {
                completedBy.set(tool.name, (completedBy.get(tool.name) || 0) + 1);
              }
            }

            // TaskCreate result: extract taskId from "Task #N created successfully: ..."
            const subject = createSubjectById.get(blk.tool_use_id);
            if (subject && !blk.is_error) {
              const resultText = typeof blk.content === 'string'
                ? blk.content
                : Array.isArray(blk.content) ? blk.content.map(c => c.text || '').join('') : '';
              const m = resultText.match(/Task #(\d+)/);
              if (m) {
                taskSubjectById.set(m[1], subject);
              }
            }
          }
        }
      }
    }
  } catch { /* partial ok */ }

  return {
    tools: Array.from(toolMap.values()).slice(-30),
    completedBy,
    activeTask,
    sessionStart,
  };
}

function extractTarget(name, input) {
  if (!input) return undefined;
  switch (name) {
    case 'Read': case 'Write': case 'Edit': {
      const p = (input.file_path || input.path || '').split('/').pop();
      return p ? stripAnsi(p) : undefined;
    }
    case 'Bash': {
      const cmd = stripAnsi(input.command || '');
      return cmd.length > 25 ? cmd.slice(0, 25) + '...' : cmd;
    }
    case 'Glob': return stripAnsi(input.pattern || '');
    case 'Grep': return stripAnsi(input.pattern || '');
    case 'Skill': return stripAnsi(input.skill || '');
    default: return undefined;
  }
}

// ═══════════════════════════════════════════════════════
// Format helpers
// ═══════════════════════════════════════════════════════

const BAR_W = 10;
const BLOCKS = '█▇▆▅▄▃▂▁';

function bar(pct) {
  const c = Math.min(100, Math.max(0, Math.round(pct)));
  const filled = Math.round((c / 100) * BAR_W);
  let s = BLOCKS[0].repeat(filled);
  const rem = (c / 100) * BAR_W - filled;
  if (filled < BAR_W && rem > 0) {
    s += BLOCKS[Math.min(BLOCKS.length - 1, Math.floor(rem * BLOCKS.length))];
  }
  while (s.length < BAR_W) s += '░';
  return s;
}

function tok(n) {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(Math.round(n));
}

function dur(ms) {
  if (ms < 10_000) return '<10s';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

// ═══════════════════════════════════════════════════════
// Render
// ═══════════════════════════════════════════════════════

function render(stdin, data) {
  const ctx = stdin.context_window || {};
  const pct = ctx.used_percentage ?? 0;
  const size = ctx.context_window_size;
  const totalIn = ctx.total_input_tokens ?? 0;
  const totalOut = ctx.total_output_tokens ?? 0;
  const model = stripAnsi(stdin.model?.display_name || stdin.model?.id || '?');
  const cwd = stripAnsi((stdin.cwd || '').replace(/^\/root/, '~'));

  const lines = [];

  // Line 1: [model] │ cwd git │ ⏱ │ configs
  const l1 = [];
  l1.push(`${C.white}[${model}]${C.reset}`);

  let proj = cwd;
  if (data.git) {
    const dirty = data.git.dirty ? '*' : '';
    proj += ` ${C.dim}git:(${C.reset}${C.yellow}${data.git.branch}${dirty}${C.reset}${C.dim})${C.reset}`;
  }
  l1.push(proj);

  if (data.sessionStart) {
    l1.push(`${C.dim}⏱ ${dur(Date.now() - data.sessionStart.getTime())}${C.reset}`);
  }

  const cfg = data.config;
  if (cfg.claudeMd > 0) l1.push(D(`${cfg.claudeMd} CLAUDE.md`));
  if (cfg.rules > 0) l1.push(D(`${cfg.rules} rules`));
  if (cfg.mcps > 0) l1.push(D(`${cfg.mcps} MCPs`));
  if (cfg.hooks > 0) l1.push(D(`${cfg.hooks} hooks`));

  lines.push(l1.join(` ${C.dim}│${C.reset} `));

  // Line 2: context bar + token totals
  const ctxBar = bar(pct);
  const sizeStr = size ? `${Math.round(size / 1000)}k` : '?';
  const totalTokens = totalIn + totalOut;
  lines.push(
    `Context ${ctxBar} ${pct}%/${sizeStr}` +
    ` ${C.dim}│${C.reset} ` +
    `Tok ${C.dim}in:${C.reset}${tok(totalIn)} ${C.dim}out:${C.reset}${tok(totalOut)} ${C.dim}total:${C.reset}${tok(totalTokens)}`
  );

  // ── Running tools (hook primary, transcript fallback) ──
  let runningList = [];   // [{name, n, target}]
  let hookRecent = null;  // Map name→count from hook post-completion

  if (data.hookTools) {
    if (data.hookTools.running) runningList = data.hookTools.running;
    hookRecent = data.hookTools.recent;
  } else {
    // Fallback to transcript-based running detection
    const transcriptRunning = data.tools.filter(t => t.status === 'running');
    if (transcriptRunning.length > 0) {
      const byName = new Map();
      for (const t of transcriptRunning) {
        const entry = byName.get(t.name);
        if (entry) { entry.n++; } else { byName.set(t.name, { name: t.name, n: 1, target: t.target || '' }); }
      }
      runningList = Array.from(byName.values());
    }
  }

  // ── Completed tools — merge hook recent with transcript totals ──
  const completedBy = new Map(data.completedBy || []);
  if (hookRecent) {
    for (const [name, n] of hookRecent) {
      completedBy.set(name, (completedBy.get(name) || 0) + n);
    }
  }

  // ── Line 3: ◐ running | ✓ completed ──
  const l3 = [];
  if (runningList.length > 0) {
    const items = [];
    for (const r of runningList) {
      const label = r.target ? `${r.name}: ${r.target}` : r.name;
      items.push(r.n > 1 ? `${label} ×${r.n}` : label);
    }
    l3.push(`${C.yellow}◐${C.reset} ${C.cyan}${items.join('  ')}${C.reset}`);
  }
  if (completedBy.size > 0) {
    const items = [];
    for (const [name, n] of completedBy) {
      items.push(`${C.dim}✓${C.reset} ${n > 1 ? `${name} ×${n}` : name}`);
    }
    l3.push(items.join('  '));
  }
  if (l3.length > 0) lines.push(l3.join(` ${C.dim}│${C.reset} `));

  // ── Line 4: ▸ active task ──
  if (data.activeTask && data.activeTask.subject) {
    const t = data.activeTask;
    const progress = t.total > 0 ? ` (${t.done}/${t.total})` : '';
    lines.push(`${C.yellow}▸${C.reset} ${t.subject}${D(progress)}`);
  }

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════

try {
  const raw = await readStdin();
  if (!raw) process.exit(0);

  const stdin = validateStdin(raw);
  if (!stdin?.context_window) process.exit(0);

  const [transcriptData, git, config, hookTools] = await Promise.all([
    parseTranscript(stdin.transcript_path),
    Promise.resolve(getGit(stdin.cwd)),
    Promise.resolve(getConfigCounts()),
    Promise.resolve(readHookState(hookStateFile(safeString(raw.transcript_path)))),
  ]);

  const output = render(stdin, { ...transcriptData, git, config, hookTools });
  if (output) console.log(output);
} catch {
  process.exit(0);
}
