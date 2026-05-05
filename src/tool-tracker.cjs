#!/usr/bin/env node
'use strict';

const { writeFileSync, existsSync, readFileSync } = require('node:fs');
const STATE_FILE = '/tmp/claude-hud-tools.json';

function extractTarget(name, input) {
  if (!input) return '';
  switch (name) {
    case 'Read': case 'Write': case 'Edit': {
      const p = (input.file_path || input.path || '').split('/').pop();
      return p ? p.slice(0, 40) : '';
    }
    case 'Bash': {
      const cmd = (input.command || '').replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
      return cmd.length > 30 ? cmd.slice(0, 27) + '...' : cmd;
    }
    case 'Glob': return (input.pattern || '').slice(0, 30);
    case 'Grep': return (input.pattern || '').slice(0, 30);
    case 'Skill': return (input.skill || '').slice(0, 30);
    case 'Agent': {
      const ad = input.description || '';
      return ad.slice(0, 30);
    }
    default: return '';
  }
}

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

    const target = extractTarget(name, input.tool_input);

    let state = { tools: {}, updated: 0 };
    try {
      if (existsSync(STATE_FILE)) {
        state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
      }
    } catch { /* corrupt */ }

    const prev = state.tools[name];
    const entry = (typeof prev === 'object' && prev !== null)
      ? prev
      : { n: (typeof prev === 'number' ? prev : 0), targets: [] };
    entry.n++;
    if (target) entry.targets.push(target);
    state.tools[name] = entry;
    state.updated = Date.now();

    writeFileSync(STATE_FILE, JSON.stringify(state));
  } catch { /* never break hook */ }
});
