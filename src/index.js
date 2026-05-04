#!/usr/bin/env node

/**
 * claude-hud-deepseek — Status line plugin for Claude Code with DeepSeek backend.
 *
 * Shows context window usage, session token totals, tool/agent/task activity,
 * git branch, session duration, and config counts.
 *
 * Lines (expanded layout):
 *   [model] │ project git:(branch*) │ ⏱ 5m │ 1 CLAUDE.md │ 10 rules
 *   Context ████░░░░ 45%/1000k │ Tok in:45k out:12k total:57k
 *   ─────────────────────────────────
 *   ◐ Edit: file.ts | ✓ Read ×3  Write
 *   ◐ explore [haiku]: Finding code
 *   ▸ Fix auth bug (2/5)
 */

import { existsSync, statSync, readFileSync, createReadStream } from 'node:fs';
import { execSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve, normalize } from 'node:path';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';

// ═══════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════

const HOME = homedir();
const TRANSCRIPT_DIR = resolve(HOME, '.claude/projects');
const SETTINGS_PATH = resolve(HOME, '.claude/settings.json');
const RULES_DIR = resolve(HOME, '.claude/rules/common');
const MAX_TRANSCRIPT_BYTES = 5 * 1024 * 1024; // 5MB cap
const MAX_TRANSCRIPT_LINES = 2000;
const STDIN_MAX_BYTES = 256 * 1024;

// ═══════════════════════════════════════════════════════
// ANSI helpers
// ═══════════════════════════════════════════════════════

const ANSI_RE = /\x1B\[[0-?]*[ -/]*[@-~]/g;

function stripAnsi(s) {
  if (typeof s !== 'string') return '';
  return s.replace(ANSI_RE, '');
}

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
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
      try { const o = JSON.parse(raw.trim()); done(o); } catch {}
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

/**
 * Reject transcript paths outside the Claude Code transcript directory.
 */
function sanitizeTranscriptPath(userPath) {
  if (!userPath) return '';
  const resolved = resolve(userPath);
  const rel = normalize(resolved).startsWith(normalize(TRANSCRIPT_DIR))
    ? resolved
    : '';
  return rel;
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
    const dirty = status.trim().length > 0;
    return { branch: stripAnsi(branch), dirty };
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════
// Config counts — read settings.json ONCE, extract scalars only
// ═══════════════════════════════════════════════════════

let _configCache = null;
let _configCacheTime = 0;
const CONFIG_CACHE_MS = 5000; // cache for 5 seconds between ticks

function getConfigCounts() {
  const now = Date.now();
  if (_configCache && (now - _configCacheTime) < CONFIG_CACHE_MS) {
    return _configCache;
  }

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

  // Read settings.json ONCE, extract only what we need, then discard
  try {
    if (existsSync(SETTINGS_PATH)) {
      const raw = readFileSync(SETTINGS_PATH, 'utf8');
      const settings = JSON.parse(raw);
      // Immediately extract counts — do NOT retain the full object
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
// Transcript parsing — streaming read with size guard
// ═══════════════════════════════════════════════════════

async function parseTranscript(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) {
    return { tools: [], agents: [], todos: [], sessionStart: null };
  }

  // Size guard — reject files too large or character devices
  let fileSize;
  try {
    const stat = statSync(transcriptPath);
    if (!stat.isFile()) return { tools: [], agents: [], todos: [], sessionStart: null };
    if (stat.size > MAX_TRANSCRIPT_BYTES) return { tools: [], agents: [], todos: [], sessionStart: null };
    fileSize = stat.size;
  } catch {
    return { tools: [], agents: [], todos: [], sessionStart: null };
  }

  const toolMap = new Map();
  const agentMap = new Map();
  const taskIdToIdx = new Map();
  let todos = [];
  let sessionStart = null;
  let lineCount = 0;

  try {
    const fileStream = createReadStream(transcriptPath, { encoding: 'utf8' });
    const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

    for await (const line of rl) {
      lineCount++;
      if (lineCount > MAX_TRANSCRIPT_LINES) break; // safety cap
      if (!line.trim()) continue;

      let entry;
      try { entry = JSON.parse(line); } catch { continue; }

      // Session start — first valid timestamp
      if (!sessionStart && entry.timestamp) {
        const ts = new Date(entry.timestamp);
        if (!Number.isNaN(ts.getTime())) sessionStart = ts;
      }

      const ts = entry.timestamp && !Number.isNaN(new Date(entry.timestamp).getTime())
        ? new Date(entry.timestamp)
        : null;
      if (!ts) continue;

      const blocks = entry.message?.content;
      if (!Array.isArray(blocks)) continue;

      if (entry.type === 'assistant') {
        for (const blk of blocks) {
          if (blk.type !== 'tool_use' || !blk.id || !blk.name) continue;

          const target = extractTarget(blk.name, blk.input);
          toolMap.set(blk.id, { name: blk.name, target, status: 'running', time: ts });

          if (blk.name === 'Task' || blk.name === 'Agent') {
            agentMap.set(blk.id, {
              id: blk.id,
              type: safeString(blk.input?.subagent_type) || 'agent',
              model: safeString(blk.input?.model),
              description: safeString(blk.input?.description),
              status: 'running',
              startTime: ts,
            });
          }

          if (blk.name === 'TodoWrite' && Array.isArray(blk.input?.todos)) {
            taskIdToIdx.clear();
            todos = blk.input.todos.map((t, i) => {
              const tid = String(t.taskId || i);
              taskIdToIdx.set(tid, i);
              return {
                content: stripAnsi(t.content || t.subject || ''),
                status: normStatus(t.status) || 'pending',
              };
            });
          }

          if (blk.name === 'TaskCreate') {
            const sub = stripAnsi(blk.input?.subject || blk.input?.description || '');
            if (sub) {
              const idx = todos.length;
              todos.push({ content: sub, status: normStatus(blk.input?.status) || 'pending' });
              taskIdToIdx.set(String(blk.input?.taskId || blk.id || idx), idx);
            }
          }

          if (blk.name === 'TaskUpdate') {
            const idx = resolveTaskIdx(blk.input?.taskId, taskIdToIdx, todos);
            if (idx !== null && idx < todos.length) {
              if (blk.input?.status) {
                const s = normStatus(blk.input.status);
                if (s) todos[idx].status = s;
              }
              const nc = blk.input?.subject || blk.input?.description;
              if (nc) todos[idx].content = stripAnsi(nc);
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
            }
            const agent = agentMap.get(blk.tool_use_id);
            if (agent) { agent.status = 'completed'; agent.endTime = ts; }

            // Extract system task ID from TaskCreate result (e.g. "Task #5 created successfully")
            if (typeof blk.content === 'string') {
              const m = blk.content.match(/Task #(\d+)/);
              if (m && taskIdToIdx.has(blk.tool_use_id)) {
                const sysId = m[1];
                const idx = taskIdToIdx.get(blk.tool_use_id);
                taskIdToIdx.delete(blk.tool_use_id);
                taskIdToIdx.set(sysId, idx);
              }
            }
          }
        }
      }
    }
  } catch {
    // Return partial results on read error
  }

  // Collect last 20 tools and last 10 agents
  const tools = Array.from(toolMap.values()).slice(-20);
  const agents = Array.from(agentMap.values()).slice(-10);

  return { tools, agents, todos, sessionStart };
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
    case 'Agent': case 'Task':
      return stripAnsi(input.description || input.subagent_type || '');
    default: return undefined;
  }
}

function resolveTaskIdx(taskId, map, todos) {
  if (typeof taskId === 'string' || typeof taskId === 'number') {
    const k = String(taskId);
    if (map.has(k)) return map.get(k);
    if (/^\d+$/.test(k)) {
      const i = parseInt(k, 10) - 1;
      if (i >= 0 && i < todos.length) return i;
    }
  }
  return null;
}

function normStatus(s) {
  switch (s) {
    case 'pending': case 'not_started': return 'pending';
    case 'in_progress': case 'running': return 'in_progress';
    case 'completed': case 'done': return 'completed';
    default: return null;
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

function elapsed(start, end) {
  const ms = Math.max(0, (end || Date.now()) - start.getTime());
  if (ms < 1000) return '<1s';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function trunc(s, max = 40) {
  const clean = stripAnsi(s);
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 3) + '...';
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

  // ── Line 1: [model] │ cwd git │ ⏱ │ configs ──────
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

  // ── Line 2: Context bar + tokens ──────────────────
  const l2 = [];
  const ctxBar = bar(pct);
  const sizeStr = size ? `${Math.round(size / 1000)}k` : '?';
  const totalTokens = totalIn + totalOut;
  l2.push(`Context ${ctxBar} ${pct}%/${sizeStr}`);
  l2.push(`Tok ${C.dim}in:${C.reset}${tok(totalIn)} ${C.dim}out:${C.reset}${tok(totalOut)} ${C.dim}total:${C.reset}${tok(totalTokens)}`);
  lines.push(l2.join(` ${C.dim}│${C.reset} `));

  // ── Activity separator ─────────────────────────────
  const hasActivity =
    data.tools.some(t => t.status === 'running') ||
    data.agents.some(a => a.status === 'running') ||
    data.todos.some(t => t.status === 'in_progress') ||
    (data.todos.length > 0 && data.todos.every(t => t.status === 'completed'));

  if (hasActivity) {
    lines.push(D('─'.repeat(40)));
  }

  // ── Running tools (◐ only, max 3) ─────────────────
  const runningTools = data.tools.filter(t => t.status === 'running').slice(-3);
  for (const t of runningTools) {
    const label = t.target ? `${t.name}: ${trunc(t.target)}` : t.name;
    lines.push(`${C.yellow}◐${C.reset} ${C.cyan}${label}${C.reset}`);
  }

  // ── Running agents (◐ only, max 3) ─────────────────
  const runningAgents = data.agents.filter(a => a.status === 'running');
  for (const a of runningAgents.slice(-3)) {
    const type = `${C.magenta}${a.type}${C.reset}`;
    const modelStr = a.model ? ` ${D('[' + a.model + ']')}` : '';
    const desc = a.description ? `: ${trunc(a.description)}` : '';
    const et = elapsed(a.startTime);
    lines.push(`${C.yellow}◐${C.reset} ${type}${modelStr}${desc} ${D('(' + et + ')')}`);
  }

  // ── Line 5: Todos ──────────────────────────────────
  if (data.todos.length > 0) {
    const completed = data.todos.filter(t => t.status === 'completed').length;
    const total = data.todos.length;
    const inProg = data.todos.find(t => t.status === 'in_progress');

    if (inProg) {
      lines.push(`${C.yellow}▸${C.reset} ${trunc(inProg.content, 50)} ${D('(' + completed + '/' + total + ')')}`);
    } else if (completed === total && total > 0) {
      lines.push(`${C.green}✓${C.reset} All tasks complete ${D('(' + completed + '/' + total + ')')}`);
    }
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
  if (!stdin || !stdin.context_window) process.exit(0);

  const [transcriptData, git, config] = await Promise.all([
    parseTranscript(stdin.transcript_path),
    Promise.resolve(getGit(stdin.cwd)),
    Promise.resolve(getConfigCounts()),
  ]);

  const output = render(stdin, { ...transcriptData, git, config });
  if (output) console.log(output);
} catch {
  // Silent failure — don't break the status line
  process.exit(0);
}
