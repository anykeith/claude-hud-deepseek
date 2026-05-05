#!/usr/bin/env node
'use strict';

/**
 * PostToolUse hook — decrements running tool counters, leaves recent-completed marker.
 *
 * State format: { tools: { Bash: {n, targets[], recent: [{target, at}] } }, updated }
 * - n=count && targets=[] → running counters cleared, recent added for display
 * - recent entries older than 5s are pruned by the reader
 */

const { writeFileSync, existsSync, readFileSync } = require('node:fs');
const STATE_FILE = '/tmp/claude-hud-tools.json';

let raw = '';
process.stdin.resume();
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  process.stdout.write(raw);

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

    const prev = state.tools[name];

    // Legacy bare-number format
    if (typeof prev === 'number') {
      if (prev <= 1) { delete state.tools[name]; }
      else { state.tools[name] = prev - 1; }
      state.updated = Date.now();
      writeFileSync(STATE_FILE, JSON.stringify(state));
      return;
    }

    if (!prev || prev.n <= 0) return;

    prev.n--;
    // Move completed target to recent list for short-lived display
    const doneTarget = prev.targets.length > 0 ? prev.targets.shift() : '';
    if (doneTarget) {
      prev.recent = prev.recent || [];
      prev.recent.push({ target: doneTarget, at: Date.now() });
      // Keep only last 5
      if (prev.recent.length > 5) prev.recent = prev.recent.slice(-5);
    }

    if (prev.n === 0) {
      // Don't delete — keep around with recent list for display
      prev.targets = [];
    }

    state.updated = Date.now();
    writeFileSync(STATE_FILE, JSON.stringify(state));
  } catch { /* never break hook */ }
});
