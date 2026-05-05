#!/usr/bin/env node
'use strict';

/**
 * PostToolUse hook — decrements running tool counters after tool completion.
 *
 * State file format (/tmp/claude-hud-tools.json):
 *   { tools: { Bash: {n:3, targets:["cmd1","cmd2"]} }, updated: 1234567890 }
 *
 * This hook pairs with tool-tracker.cjs (PreToolUse) to maintain accurate
 * "currently running" counters. Tools with n=0 are removed from state.
 *
 * Deployment:
 *   "PostToolUse": [{ "matcher": "", "hooks": [{
 *     "type": "command", "command": "node ~/.claude/scripts/hooks/tool-tracker-post.js"
 *   }] }]
 */

const { writeFileSync, existsSync, readFileSync } = require('node:fs');

const STATE_FILE = '/tmp/claude-hud-tools.json';

let raw = '';
process.stdin.resume();
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  process.stdout.write(raw); // passthrough — never swallow

  try {
    const input = JSON.parse(raw);
    const name = input.tool_name;
    if (!name) return;

    let state = { tools: {}, updated: 0 };
    try {
      if (existsSync(STATE_FILE)) {
        state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
      }
    } catch { return; }

    const raw = state.tools[name];
    // Backwards compat: old format stored bare number, normalize to {n, targets}
    if (typeof raw === 'number') {
      // Old format: just decrement the count directly
      if (raw <= 1) { delete state.tools[name]; }
      else { state.tools[name] = raw - 1; }
      state.updated = Date.now();
      writeFileSync(STATE_FILE, JSON.stringify(state));
      return;
    }
    const entry = raw;
    if (!entry || entry.n <= 0) return;

    entry.n--;
    if (entry.targets.length > 0) entry.targets.shift(); // remove oldest

    if (entry.n === 0) {
      delete state.tools[name];
    }

    state.updated = Date.now();
    writeFileSync(STATE_FILE, JSON.stringify(state));
  } catch { /* never break hook */ }
});
