#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════
# claude-hud-deepseek — one-click installer
# ═══════════════════════════════════════════════════════

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

REPO_URL="https://github.com/anykeith/claude-hud-deepseek.git"
INSTALL_DIR="${CLAUDE_HUD_INSTALL_DIR:-/opt/projects/claude-hud-deepseek}"
SETTINGS_FILE="$HOME/.claude/settings.json"
HOOK_DIR="$HOME/.claude/scripts/hooks"
NODE_BIN="${NODE_BIN:-node}"

echo -e "${BOLD}${CYAN}╔══════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║  claude-hud-deepseek installer       ║${NC}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════╝${NC}"
echo ""

# ── Check Node.js ──────────────────────────
if ! command -v "$NODE_BIN" &>/dev/null; then
  echo -e "${RED}✖${NC} Node.js not found. Install Node.js ≥ 18 first."
  exit 1
fi

NODE_VERSION=$("$NODE_BIN" -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo -e "${RED}✖${NC} Node.js ≥ 18 required (found v$NODE_VERSION)."
  exit 1
fi
echo -e "${GREEN}✓${NC} Node.js $("$NODE_BIN" -v)"

# ── Clone / update repo ────────────────────
if [ -d "$INSTALL_DIR/.git" ]; then
  echo -e "${GREEN}✓${NC} Repo exists, pulling latest..."
  git -C "$INSTALL_DIR" pull --ff-only
else
  echo -e "${GREEN}✓${NC} Cloning into $INSTALL_DIR..."
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

# ── Deploy hook scripts ────────────────────
mkdir -p "$HOOK_DIR"
cp "$INSTALL_DIR/src/tool-tracker.cjs" "$HOOK_DIR/tool-tracker.js"
cp "$INSTALL_DIR/src/tool-tracker-post.cjs" "$HOOK_DIR/tool-tracker-post.js"
echo -e "${GREEN}✓${NC} PreToolUse  hook → $HOOK_DIR/tool-tracker.js"
echo -e "${GREEN}✓${NC} PostToolUse hook → $HOOK_DIR/tool-tracker-post.js"

# ── Configure settings.json ────────────────

merge_settings() {
  # Safe merge: write new file only on success
  node - "$SETTINGS_FILE" "$INSTALL_DIR" "$HOOK_DIR" <<'NODESCRIPT'
const { readFileSync, writeFileSync, copyFileSync, existsSync } = require('fs');

const [settingsPath, installDir, hookDir] = process.argv.slice(2);

let settings = {};
if (existsSync(settingsPath)) {
  settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
}

let changed = false;

// statusLine
const statusCmd = `node ${installDir}/src/index.js`;
if (!settings.statusLine || settings.statusLine.command !== statusCmd) {
  settings.statusLine = { type: "command", command: statusCmd };
  changed = true;
}

// PreToolUse hook
settings.hooks = settings.hooks || {};
settings.hooks.PreToolUse = settings.hooks.PreToolUse || [];

const preCmd = `node ${hookDir}/tool-tracker.js`;
const hasPre = settings.hooks.PreToolUse.some(
  g => g.matcher === "" && (g.hooks || []).some(h => h.type === "command" && h.command === preCmd)
);
if (!hasPre) {
  settings.hooks.PreToolUse.unshift({
    matcher: "",
    hooks: [{ type: "command", command: preCmd }]
  });
  changed = true;
}

// PostToolUse hook
settings.hooks.PostToolUse = settings.hooks.PostToolUse || [];

const postCmd = `node ${hookDir}/tool-tracker-post.js`;
const hasPost = settings.hooks.PostToolUse.some(
  g => g.matcher === "" && (g.hooks || []).some(h => h.type === "command" && h.command === postCmd)
);
if (!hasPost) {
  settings.hooks.PostToolUse.unshift({
    matcher: "",
    hooks: [{ type: "command", command: postCmd }]
  });
  changed = true;
}

if (changed) {
  // Backup original
  if (existsSync(settingsPath)) {
    copyFileSync(settingsPath, settingsPath + '.bak-' + new Date().toISOString().replace(/[:.]/g, '-'));
  }
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  console.log('UPDATED');
} else {
  console.log('UNCHANGED');
}
NODESCRIPT
}

RESULT=$(merge_settings)
if [ "$RESULT" = "UPDATED" ]; then
  echo -e "${GREEN}✓${NC} settings.json updated (backup saved to $SETTINGS_FILE.bak-*)"
elif [ "$RESULT" = "UNCHANGED" ]; then
  echo -e "${GREEN}✓${NC} settings.json already configured"
else
  echo -e "${RED}✖${NC} Failed to update settings.json"
  exit 1
fi

# ── Done ─────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}Install complete!${NC}"
echo ""
echo -e "  Status line:  ${CYAN}node $INSTALL_DIR/src/index.js${NC}"
echo -e "  PreToolUse:   ${CYAN}node $HOOK_DIR/tool-tracker.js${NC}"
echo -e "  PostToolUse:  ${CYAN}node $HOOK_DIR/tool-tracker-post.js${NC}"
echo ""
echo -e "Type any character in Claude Code to see the status bar update."
echo -e "To uninstall, run: ${CYAN}rm -rf $INSTALL_DIR${NC}"
echo -e "Then remove statusLine, PreToolUse, and PostToolUse entries from $SETTINGS_FILE"
