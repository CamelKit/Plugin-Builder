#!/usr/bin/env node
// Anti-bot guard for Plugin-Builder CI pipeline.
// Fails the build if the plugin source contains input-fabrication, synthetic event construction,
// or anti-bot bypass vectors. See Client/docs/anti-bot.md.
// Pure Node, zero dependencies.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const target = process.argv[2] || '.';
const EXTS = new Set(['.ts', '.js', '.mjs', '.cjs', '.tsx', '.jsx']);
const SKIP_DIR = new Set(['node_modules', 'dist', 'out', 'build', '.git', '.yarn', 'plugin-vault']);

const RULES = [
  { re: /\bsendInputActivity\b/, msg: "calls the game's input-activity fn (mints an anti-bot ticket without a real user event)" },
  { re: /\b(consumePendingInputTicket|pendingInputTicketSeq|sendInputTicket|inputTicketBurst)\b/, msg: 'touches EvilQuest input-ticket internals (ticket forgery)' },
  { re: /new\s+(KeyboardEvent|PointerEvent|TouchEvent)\b/, msg: 'constructs a synthetic input event (fabricated game input; isTrusted=false but still a botting pattern)' },
  { re: /new\s+MouseEvent\s*\(\s*["'](?!contextmenu\b)/, msg: 'constructs a synthetic mouse input event (fabricated game input)' },
  { re: /\b(robotjs|nut-js|@nut-tree)\b/, msg: 'OS-level input automation library (auto-clicker / bot)' },
  { re: /setWebContentsDebuggingEnabled\s*\(\s*true\s*\)/, msg: 'hard-enables Android WebView debugging (anti-bot bypass)' },
];

function walk(dir, out) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    if (SKIP_DIR.has(name)) continue;
    const p = join(dir, name);
    try {
      const st = statSync(p);
      if (st.isDirectory()) walk(p, out);
      else if (EXTS.has(extname(name))) out.push(p);
    } catch {}
  }
}

const files = [];
try {
  const st = statSync(target);
  if (st.isDirectory()) {
    walk(target, files);
  } else if (st.isFile()) {
    files.push(target);
  }
} catch (err) {
  console.error(`Target path '${target}' not found: ${err.message}`);
  process.exit(1);
}

const violations = [];
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const rule of RULES) {
      if (rule.re.test(line)) {
        violations.push({ file, line: i + 1, text: line.trim(), msg: rule.msg });
      }
    }
  });
}

if (violations.length > 0) {
  console.error('\n❌ Anti-bot guard FAILED — input-fabrication / trusted-input bypass found in plugin:\n');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}\n    ${v.text}\n    ↳ ${v.msg}\n`);
  }
  console.error(`${violations.length} violation(s). CamelKit plugins must never fabricate input or weaken EvilQuest's anti-bot.`);
  process.exit(1);
}

console.log(`✅ Anti-bot guard passed (${files.length} files scanned in '${target}', zero input-fabrication vectors).`);
