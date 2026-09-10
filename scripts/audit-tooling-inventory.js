// scripts/audit-tooling-inventory.js
// REVISION 2026-09-10a — first version.
//
// READ-ONLY. Lists every file in scripts/ and .github/workflows/, finds what
// references it, and joins that to what REPO_MANIFEST.md says it is for.
//
// WRITES NOTHING. No fs.writeFileSync, no git, no network.
//
// WHY
// ───
// cleanup-repo.yml names about 250 paths for deletion. It was written on 2026-07-16
// and asserts what is obsolete rather than checking — several entries are things that
// have been touched since. Extending a list like that one file at a time makes it
// less trustworthy, not more. What is needed first is an inventory derived from the
// repository as it is now.
//
// IT DOES NOT PRODUCE A DELETE LIST. It produces a table, and "no inbound references"
// is a flag for a human to judge, never an instruction. Three reasons a file can be
// live with nothing pointing at it, all of them real here:
//   - A script required by another script and run by no workflow of its own —
//     scripts/lib/uuid-prefix.cjs is exactly that.
//   - A workflow with no cron and no dispatcher, because a person runs it by hand.
//     Every diagnostic tool in §2.2 is that.
//   - A workflow dispatched by `gh workflow run` from inside another workflow's shell
//     script, which is not a dependency any parser would normally see.
//
// HOW REFERENCES ARE FOUND. By basename, across every script and workflow. That is
// deliberately blunt: it catches `node scripts/x.js`, `require('./x')`,
// `gh workflow run x.yml`, a `uses:` reference and a bare mention in a comment alike.
// A comment mention is a weak reference and is labelled as one rather than dropped,
// because a name appearing only in prose usually means the file was documented and
// then orphaned.
//
// PURPOSE COMES FROM THE MANIFEST, NOT FROM MEMORY. §2.1/§2.2/§2.3 classify scripts
// as live, on-demand tool, or already removed; §3.1–§3.4 do the same for workflows.
// A file on disk with no manifest row is UNDOCUMENTED. A manifest row with no file is
// a STALE DOCUMENT. Both are findings and both are printed.
//
// Run:
//   node scripts/audit-tooling-inventory.js
//   node scripts/audit-tooling-inventory.js --orphans-only
//   node scripts/audit-tooling-inventory.js --show=scripts

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT      = path.join(__dirname, '..');
const SCRIPTS   = path.join(ROOT, 'scripts');
const WORKFLOWS = path.join(ROOT, '.github', 'workflows');
const MANIFEST  = path.join(ROOT, 'REPO_MANIFEST.md');

const args        = process.argv.slice(2);
const argVal      = (n, d) => { const a = args.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const ORPHANS_ONLY = args.includes('--orphans-only');
const SHOW         = argVal('show', 'all');   // all | scripts | workflows

const log = (m) => console.log(`[inventory] ${new Date().toISOString()} ${m}`);

// ─── Collect the files ───────────────────────────────────────────────────────
function walk(dir, base = '') {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel  = base ? `${base}/${name}` : name;
    if (fs.statSync(full).isDirectory()) out.push(...walk(full, rel));
    else out.push({ rel, full });
  }
  return out;
}

const scriptFiles   = walk(SCRIPTS).filter(f => /\.(js|cjs|mjs|sh)$/.test(f.rel))
                        .map(f => ({ ...f, kind: 'script',   key: `scripts/${f.rel}` }));
const workflowFiles = walk(WORKFLOWS).filter(f => /\.ya?ml$/.test(f.rel))
                        .map(f => ({ ...f, kind: 'workflow', key: `.github/workflows/${f.rel}` }));
const all = [...scriptFiles, ...workflowFiles];

// ─── Read every file once ────────────────────────────────────────────────────
const text = new Map();
for (const f of all) {
  try { text.set(f.key, fs.readFileSync(f.full, 'utf8')); } catch { text.set(f.key, ''); }
}

// ─── Manifest: purpose and classification ────────────────────────────────────
// §2.1 live / §2.2 tool / §2.3 removed for scripts; §3.1–§3.4 for workflows.
let manifest = '';
try { manifest = fs.readFileSync(MANIFEST, 'utf8'); } catch { console.log('  ⚠ REPO_MANIFEST.md not readable — purpose column will be empty'); }

const SECTION_LABEL = {
  '2.1': 'LIVE (scheduled/chain)', '2.2': 'TOOL (on-demand)', '2.3': 'REMOVED in cleanup fe8eedb',
  '3.1': 'LIVE (scheduled)', '3.2': 'BUILD trigger', '3.3': 'TOOL (on-demand)', '3.4': 'REMOVED in cleanup fe8eedb',
};

const manifestRows = new Map();   // basename -> { purpose, section }
{
  let section = null;
  for (const line of manifest.split('\n')) {
    const h = line.match(/^###\s+(\d+\.\d+)\s/);
    if (h) { section = h[1]; continue; }
    const m = line.match(/^\|\s*`([^`]+)`\s*\|\s*([^|]*)\|/);
    if (!m) continue;
    const name = m[1].trim().replace(/^.*\//, '');
    if (!/\.(js|cjs|mjs|sh|ya?ml)$/.test(name)) continue;
    // ONLY §2.x (scripts) and §3.x (workflows) classify a file. §1.1 is the schedule
    // table and lists workflow names too — taking a row from there would classify
    // nightly-crawl.yml by its cron entry rather than by §3.1, which is the section
    // that actually says what it is and whether to keep it.
    if (!section || !/^[23]\./.test(section)) continue;
    if (manifestRows.has(name)) continue;                    // first §2/§3 mention wins
    manifestRows.set(name, { purpose: m[2].trim(), section });
  }
}

// ─── References: who mentions whom ───────────────────────────────────────────
// Every non-comment line is scored and the STRONGEST wins. Taking the first match
// classified a workflow as merely "mentions it" because its `node --check` line came
// before the `node scripts/x.js` line that actually runs the thing.
const STRENGTH = { 'runs it': 5, 'requires it': 5, 'dispatches it': 4, 'uses it': 4, 'mentions it': 2, 'comment only': 1 };
function classifyLine(l) {
  if (/node\s+(--\S+\s+)*scripts\//.test(l))  return 'runs it';
  if (/require\(/.test(l))                     return 'requires it';
  if (/gh workflow run/.test(l))               return 'dispatches it';
  if (/uses:/.test(l))                         return 'uses it';
  return 'mentions it';
}
function classify(where, name) {
  const t = text.get(where) || '';
  const lines = t.split('\n').filter(l => l.includes(name));
  if (!lines.length) return null;
  const live = lines.filter(l => { const s = l.trim(); return !s.startsWith('#') && !s.startsWith('//'); });
  if (!live.length) return 'comment only';
  let best = 'mentions it';
  for (const l of live) { const c = classifyLine(l); if (STRENGTH[c] > STRENGTH[best]) best = c; }
  return best;
}

const refs = new Map();
for (const f of all) {
  const base = path.basename(f.rel);
  const found = [];
  for (const other of all) {
    if (other.key === f.key) continue;
    if (!(text.get(other.key) || '').includes(base)) continue;
    found.push({ from: other.key, how: classify(other.key, base) });
  }
  refs.set(f.key, found);
}

// ─── Report ──────────────────────────────────────────────────────────────────
log('audit-tooling-inventory  READ-ONLY');
console.log('─'.repeat(110));
console.log(`  scripts on disk        : ${scriptFiles.length}`);
console.log(`  workflows on disk      : ${workflowFiles.length}`);
console.log(`  manifest rows parsed   : ${manifestRows.size}`);

const rows = all.map(f => {
  const base = path.basename(f.rel);
  const r    = refs.get(f.key) || [];
  const man  = manifestRows.get(base);
  const strong = r.filter(x => x.how !== 'comment only');
  return { f, base, r, strong, man };
});

const orphans      = rows.filter(x => x.strong.length === 0);
const undocumented = rows.filter(x => !x.man);
const stale        = [...manifestRows.keys()].filter(n => !all.some(f => path.basename(f.rel) === n));

console.log(`  no strong reference    : ${orphans.length}   ← candidates, NOT a delete list`);
console.log(`  on disk, not in manifest: ${undocumented.length}   ← undocumented`);
console.log(`  in manifest, not on disk: ${stale.length}   ← stale documentation`);

function printRow(x) {
  const cls = x.man ? (SECTION_LABEL[x.man.section] || `§${x.man.section}`) : '⚠ UNDOCUMENTED';
  console.log(`\n  ${x.f.key}`);
  console.log(`      classified : ${cls}`);
  if (x.man && x.man.purpose) console.log(`      purpose    : ${x.man.purpose.replace(/\*\*/g, '').slice(0, 150)}`);
  if (!x.r.length) {
    console.log(`      referenced : NOTHING references this file`);
  } else {
    for (const ref of x.r.slice(0, 6)) console.log(`      referenced : ${ref.from}  (${ref.how})`);
    if (x.r.length > 6) console.log(`                   … and ${x.r.length - 6} more`);
  }
}

if (ORPHANS_ONLY) {
  console.log(`\n─── NO STRONG REFERENCE — judge each, do not bulk delete ───────────────────────`);
  console.log(`    A file can be live with nothing pointing at it: a library another script`);
  console.log(`    requires, a workflow a person dispatches by hand, or one dispatched by`);
  console.log(`    'gh workflow run' from inside another workflow's shell.`);
  for (const x of orphans) if (SHOW === 'all' || x.f.kind + 's' === SHOW) printRow(x);
} else {
  for (const kind of ['script', 'workflow']) {
    if (SHOW !== 'all' && SHOW !== kind + 's') continue;
    console.log(`\n${'═'.repeat(110)}`);
    console.log(`  ${kind.toUpperCase()}S`);
    console.log(`${'═'.repeat(110)}`);
    for (const x of rows.filter(y => y.f.kind === kind).sort((a, b) => a.f.key.localeCompare(b.f.key))) printRow(x);
  }
}

if (stale.length) {
  console.log(`\n─── IN THE MANIFEST BUT NOT ON DISK ────────────────────────────────────────────`);
  console.log(`    The document describes files that are gone. Either they were deleted without`);
  console.log(`    the manifest being updated, or the row is aspirational.`);
  for (const nme of stale.sort()) {
    const m = manifestRows.get(nme);
    console.log(`    ${nme.padEnd(44)} ${SECTION_LABEL[m.section] || '§' + m.section}`);
  }
}

console.log(`\n${'═'.repeat(110)}`);
console.log(`  scripts ${scriptFiles.length}  workflows ${workflowFiles.length}  no strong reference ${orphans.length}  undocumented ${undocumented.length}  stale manifest rows ${stale.length}`);
console.log(`${'═'.repeat(110)}`);
console.log(`\n  This is an inventory, not a plan. Before deleting anything, confirm for each file`);
console.log(`  that it is not a library, not something you run by hand, and not dispatched from`);
console.log(`  inside another workflow's shell. cleanup-repo.yml should be rebuilt FROM this`);
console.log(`  output rather than extended — its list dates from 2026-07-16 and asserts rather`);
console.log(`  than checks.`);
log('read-only — nothing written.');
