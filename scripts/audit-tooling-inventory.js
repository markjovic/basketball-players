// scripts/audit-tooling-inventory.js
//
// Inventories scripts/ and .github/workflows/ and classifies every file, so a
// deletion list is AGREED FROM EVIDENCE rather than remembered. It deletes
// nothing and proposes no commit to those paths — deletion stays with
// cleanup-repo.yml, which already has the dry-run, the pre-cleanup tag and the
// ordering gates. Building a second deleter would be the exact duplication this
// audit exists to find.
//
// WHY. 163 workflow files, 37 added or amended in seven days. The pattern is
// that each question gets its own script and workflow, they ship as a pair, and
// nothing is ever retired — so a week of debugging leaves dozens of permanent
// artefacts for a handful of durable answers. A one-question diagnostic should
// be deleted in the same commit that records its answer.
//
// WHAT IT DECIDES, AND WHAT IT REFUSES TO DECIDE. It reports facts: whether a
// script is referenced by a workflow, whether a workflow calls a script that
// exists, whether anything requires or imports it, whether REPO_MANIFEST.md
// mentions it, and when it was last committed. It classifies on those facts
// alone. It NEVER proposes deleting anything whose findings are not already
// written down somewhere — an undocumented one-off is flagged
// DOCUMENT-THEN-DELETE, not DELETE, because deleting it loses the answer it was
// built to get.
//
// REFERENCE DETECTION IS DELIBERATELY GENEROUS. A script counts as referenced if
// ANY workflow mentions its filename anywhere, not merely in an explicit
// `node scripts/<name>` invocation — a workflow may call it through a shell
// variable, a case statement or a composite step.
//   (That sentence used to spell out a literal example path. The workflow's own
//   header repeated it, and the invocation matcher then read the example out of the
//   prose and reported audit-tooling-inventory.yml as PARTLY BROKEN, calling a
//   script that has never existed. A detector that matches paths must not be
//   documented using a path.) Over-counting a reference leaves a dead file in the repo;
// under-counting one puts a LIVE file on a delete list. Those costs are not
// symmetrical, so the bias runs one way on purpose.
//
// DATES NEED HISTORY. `git log` on a depth-1 checkout returns nothing, so the
// workflow uses a blobless full-history checkout sparse to scripts/ and
// .github/workflows/ — the same pattern cleanup-repo.yml already uses for the
// same reason. If history is unavailable the date is reported as null and the
// classification does not depend on it.
//
// WRITES: reports/tooling-inventory.json and reports/tooling-delete-list.txt.
// Nothing else. The delete list is text ready to paste into cleanup-repo.yml.
//
// ── ADDED 2026-09-10 ────────────────────────────────────────────────────────
// TWO THINGS, BOTH ABOUT THE MANIFEST RATHER THAN THE FILES.
//
// 1. `documented` was a boolean — the name appears somewhere in one of three
//    documents. It now also carries WHAT THE MANIFEST SAYS: the section the file is
//    listed under and its stated purpose. §2.1/§2.2/§2.3 classify scripts and
//    §3.1–§3.4 classify workflows, so a row tells you whether the manifest considers
//    a file live, an on-demand tool, or already removed. §1.1 is IGNORED on purpose:
//    it is the schedule table and lists workflow names too, so a row from there would
//    classify nightly-crawl.yml by its cron entry rather than by the section that
//    says what it is. Presence proved a file was mentioned; this says in what terms.
//
// 2. STALE MANIFEST ROWS — files the manifest describes that are no longer on disk.
//    Nothing detected these before. They matter because this tool's own "documented"
//    test reads the manifest as authority: a document describing tools that were
//    deleted months ago is the same failure as data/venue-index.json's writer being
//    recorded as "(venue build)", a placeholder that was read back as fact for three
//    months (T56). Rows in §2.3 and §3.4 are EXCLUDED — those sections exist to
//    record what was removed, so their absence from disk is correct, not stale.

'use strict';

const fs   = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ARGS = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => { const i = a.indexOf('='); return i === -1 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)]; })
);

const DAYS   = ARGS.days ? Math.max(1, parseInt(ARGS.days, 10)) : 14;
const DRY    = !ARGS.commit;          // default: print and write locally, commit only with --commit
const SCRIPTS_DIR   = path.join(ROOT, 'scripts');
const WORKFLOWS_DIR = path.join(ROOT, '.github', 'workflows');
const REPORTS_DIR   = path.join(ROOT, 'reports');
const OUT_JSON      = path.join(REPORTS_DIR, 'tooling-inventory.json');
const OUT_LIST      = path.join(REPORTS_DIR, 'tooling-delete-list.txt');
const OUT_JSON_REL  = path.relative(ROOT, OUT_JSON);
const OUT_LIST_REL  = path.relative(ROOT, OUT_LIST);
const MANIFEST      = path.join(ROOT, 'REPO_MANIFEST.md');
const CONTEXT       = path.join(ROOT, 'claude_context.md');
const TASKS         = path.join(ROOT, 'OUTSTANDING_TASKS.md');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
// gitCommit below is copied verbatim from discover-game-backfill.js, and that
// script gates it on a DRY_RUN const of its own. This file has no dry-run of
// that kind, so the constant is declared here rather than editing the copied
// block — an edited copy stops being verbatim and stops being checkable against
// its source. It cost a full dispatch on 2026-08-26 when the census crashed at
// its first commit AFTER a 419,427-file scan had completed.
const DRY_RUN = false;
// ─── Git commit — discover-game-backfill.js, verbatim ─────────────────────────

const GIT_MAXBUF     = 512 * 1024 * 1024;
const GIT_TIMEOUT_MS = 10 * 60 * 1000;

async function gitCommit(message, dirs) {
  if (DRY_RUN) { console.log(`  [dry-run] would commit: ${message}`); return; }
  const paths = (dirs && dirs.length ? dirs : ['.']);

  let addFailures = 0, hardAddFailures = 0;
  for (const p of paths) {
    try { execFileSync('git', ['add', '--', p], { stdio: 'pipe', cwd: ROOT, maxBuffer: GIT_MAXBUF, timeout: GIT_TIMEOUT_MS }); }
    catch (e) {
      addFailures++;
      const detail = ((e.stderr && e.stderr.toString()) || e.message || '').trim().split('\n')[0];
      if (!/did not match any files/i.test(detail)) hardAddFailures++;
      console.error(`  ⚠ git add ${/did not match any files/i.test(detail) ? 'skipped' : 'FAILED'} for "${p}": ${detail}`);
    }
  }

  const staged = (() => {
    try { return execFileSync('git', ['diff', '--staged', '--shortstat'], { stdio: 'pipe', cwd: ROOT, maxBuffer: GIT_MAXBUF, timeout: GIT_TIMEOUT_MS }).toString().trim(); }
    catch (_) { return ''; }
  })();

  if (!staged) {
    if (hardAddFailures) {
      throw new Error(`gitCommit: nothing staged and ${hardAddFailures} path(s) failed to stage for a reason other than "did not match any files" ("${message}")`);
    }
    if (addFailures) {
      console.log(`  (no changes to commit: ${message}) — ${addFailures} optional path(s) absent`);
      return;
    }
    console.log(`  (no changes to commit: ${message})`);
    return;
  }
  console.log(`  staging: ${staged}`);

  const IDENT = ['-c', 'user.name=github-actions[bot]',
                 '-c', 'user.email=github-actions[bot]@users.noreply.github.com'];

  try { execFileSync('git', [...IDENT, 'commit', '-q', '-m', message], { stdio: 'pipe', cwd: ROOT, maxBuffer: GIT_MAXBUF, timeout: GIT_TIMEOUT_MS }); }
  catch (e) {
    const detail = ((e.stderr && e.stderr.toString()) || e.message || '').trim();
    throw new Error(`gitCommit: commit failed for "${message}" — ${detail}`);
  }

  const MAX = 60;
  for (let attempt = 1; attempt <= MAX; attempt++) {
    try { execFileSync('git', ['merge', '--abort'], { stdio: 'pipe', cwd: ROOT, maxBuffer: GIT_MAXBUF, timeout: GIT_TIMEOUT_MS }); } catch (_) {}

    try {
      execFileSync('git', ['fetch', 'origin', 'main'], { stdio: 'pipe', cwd: ROOT, maxBuffer: GIT_MAXBUF, timeout: GIT_TIMEOUT_MS });
    } catch (e) {
      if (attempt === MAX) throw e;
      const s = 1 + Math.floor(Math.random() * 91);
      console.log(`  fetch failed (attempt ${attempt}/${MAX}), retrying in ${s}s`);
      await sleep(s * 1000);
      continue;
    }

    execFileSync('git', [...IDENT, 'merge', '-q', '-X', 'ours', 'FETCH_HEAD', '--no-edit', '--no-stat'], { stdio: 'pipe', cwd: ROOT, maxBuffer: GIT_MAXBUF, timeout: GIT_TIMEOUT_MS });

    try {
      execFileSync('git', ['push', 'origin', 'HEAD:main'], { stdio: 'pipe', cwd: ROOT, maxBuffer: GIT_MAXBUF, timeout: GIT_TIMEOUT_MS });
      console.log(`  ✓ Committed: ${message} (pushed on attempt ${attempt})`);
      return;
    } catch (e) {
      const detail = ((e.stderr && e.stderr.toString()) || e.message || '').trim();
      const contention = /non-fast-forward|fetch first|\[rejected\]|failed to push some refs|cannot lock ref/i.test(detail);
      if (!contention) {
        console.error(`  push failed — NOT contention, failing fast. git said:\n${detail}`);
        throw e;
      }
      if (attempt === MAX) {
        console.error(`  push still rejected after ${MAX} attempts. git said:\n${detail}`);
        throw e;
      }
      const s = 1 + Math.floor(Math.random() * 91);
      console.log(`  push attempt ${attempt}/${MAX} rejected, re-syncing in ${s}s`);
      await sleep(s * 1000);
    }
  }
  throw new Error(`gitCommit: exhausted ${MAX} push attempts for "${message}"`);
}
// ─── Git helpers ──────────────────────────────────────────────────────────────

// ─── When did it LAST ACTUALLY RUN? ─────────────────────────────────────────
// ADDED 2026-09-10, after three attempts to infer a workflow's usefulness from
// structure produced three different wrong answers — including calling deploy-pages
// (which publishes the site) and cleanup-repo (the deletion tool itself) spent.
//
// A workflow can be live through a cron, a `workflow_run` on other workflows, a
// `gh workflow run` in a shell, a helper script wrapping that call, or a person
// pressing the button. The last leaves NO trace in the repository —
// overnight-chain.yml is deliberately built as sequential jobs rather than
// dispatches so it cannot displace itself, and that same decision makes it
// structurally invisible.
//
// GitHub knows. A workflow that has not run in months is spent however it is
// triggered; one that ran last night is live even when nothing in the repo explains
// why. Evidence, not inference, and it needs no maintenance.
//
// Needs `actions: read` and the gh CLI (preinstalled on runners). Without it every
// workflow reports an unknown date and the verdict falls back to structure — worse,
// but it SAYS SO rather than pretending.
function lastRunDays() {
  const out = new Map();
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) { console.log('  ⚠ GITHUB_REPOSITORY unset — run history unavailable (local run?)'); return out; }
  try {
    const raw = execSync(
      `gh api "repos/${repo}/actions/workflows?per_page=100" --paginate --jq '.workflows[] | [.path, .id] | @tsv'`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
    for (const line of raw.trim().split('\n').filter(Boolean)) {
      const [wpath, id] = line.split('\t');
      const file = String(wpath).replace(/^.*\//, '');
      let iso = '';
      try {
        iso = execSync(
          `gh api "repos/${repo}/actions/workflows/${id}/runs?per_page=1" --jq '.workflow_runs[0].created_at // empty'`,
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }).trim();
      } catch (_) {}
      out.set(file, { days: iso ? Math.round((Date.now() - Date.parse(iso)) / 86400000) : null, iso: iso || null });
    }
    console.log(`  workflow run history: ${out.size} workflow(s) queried`);
  } catch (e) {
    console.log(`  ⚠ could not read workflow run history: ${String(e.message).slice(0, 90)}`);
    console.log('    Verdicts fall back to structure alone, which has been wrong three times.');
    console.log('    This needs `actions: read` permission and the gh CLI.');
  }
  return out;
}

function lastCommitISO(relPath) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cI', '--', relPath],
      { cwd: ROOT, stdio: 'pipe', maxBuffer: 32 * 1024 * 1024 }).toString().trim();
    return out || null;
  } catch (e) { return null; }
}

function daysAgo(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - Date.parse(iso)) / 86400000);
}

// ─── Read the tree ────────────────────────────────────────────────────────────

function listFiles(dir, filterFn) {
  try { return fs.readdirSync(dir).filter(filterFn).sort(); }
  catch (e) { return []; }
}

function readText(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const t0 = Date.now();
  console.log('audit-tooling-inventory — what is in scripts/ and .github/workflows/, and what can go\n');
  fs.mkdirSync(REPORTS_DIR, { recursive: true });

  const scriptFiles   = listFiles(SCRIPTS_DIR, f => f.endsWith('.js') || f.endsWith('.cjs') || f.endsWith('.mjs') || f.endsWith('.sh'));
  const libFiles      = listFiles(path.join(SCRIPTS_DIR, 'lib'), f => f.endsWith('.cjs') || f.endsWith('.js'));
  const workflowFiles = listFiles(WORKFLOWS_DIR, f => f.endsWith('.yml') || f.endsWith('.yaml'));

  console.log(`  scripts/          : ${scriptFiles.length} files`);
  console.log(`  scripts/lib/      : ${libFiles.length} files`);
  console.log(`  .github/workflows/: ${workflowFiles.length} files\n`);

  const docText = readText(MANIFEST) + '\n' + readText(CONTEXT) + '\n' + readText(TASKS);

  // ── What the manifest SAYS about each file, not merely that it mentions it ──
  // Only §2.x (scripts) and §3.x (workflows) classify. See the header for why §1.1
  // is skipped. First matching row wins; later mentions are cross-references.
  const SECTION_LABEL = {
    '2.1': 'LIVE (scheduled / nightly chain)',
    '2.2': 'TOOL (on-demand, kept)',
    '2.3': 'RECORDED AS REMOVED (cleanup fe8eedb)',
    '3.1': 'LIVE (scheduled)',
    '3.2': 'BUILD trigger (manual full rebuild)',
    '3.3': 'TOOL (on-demand, kept)',
    '3.4': 'RECORDED AS REMOVED (cleanup fe8eedb)',
  };
  const manifestRows = new Map();   // basename -> { purpose, section }
  {
    let section = null;
    for (const line of readText(MANIFEST).split('\n')) {
      const h = line.match(/^###\s+(\d+\.\d+)\s/);
      if (h) { section = h[1]; continue; }
      if (!section || !/^[23]\./.test(section)) continue;

      // ⚠️ NOT EVERY SECTION IS A TABLE, AND ASSUMING SO CLASSIFIED 97 LIVE
      // WORKFLOWS AS SPENT. §2.1, §2.2 and §3.1 are tables. §3.2 (build triggers)
      // and §3.3 (on-demand tools) are PROSE — comma-separated backticked filenames
      // in running text. Measured 2026-09-10: 89 filenames in tables, 42 in prose,
      // and every prose one is a workflow. A table-only parser therefore saw no
      // §3.2 or §3.3 rows at all, so every build trigger and every on-demand
      // workflow fell through to SPENT — including deploy-pages.yml, which
      // publishes the site.
      const tableRow = line.match(/^\|\s*`([^`]+)`\s*\|\s*([^|]*)\|/);
      if (tableRow) {
        const nme = tableRow[1].trim().replace(/^.*\//, '');
        if (!/\.(js|cjs|mjs|sh|ya?ml)$/.test(nme)) continue;
        if (manifestRows.has(nme)) continue;
        manifestRows.set(nme, { purpose: tableRow[2].trim(), section });
        continue;
      }
      // Prose line: take every backticked filename on it. There is no purpose text
      // to extract — the section itself IS the classification, which is all the
      // verdict needs.
      for (const mm of line.matchAll(/`([^`]+)`/g)) {
        const nme = mm[1].trim().replace(/^.*\//, '');
        if (!/\.(js|cjs|mjs|sh|ya?ml)$/.test(nme)) continue;
        if (manifestRows.has(nme)) continue;
        manifestRows.set(nme, { purpose: '', section });
      }
    }
    console.log(`  manifest rows (§2/§3): ${manifestRows.size} classified\n`);
  }
  const manifestOf = (base) => manifestRows.get(base) || null;
  const manLabel   = (r) => r ? (SECTION_LABEL[r.section] || `§${r.section}`) : null;
  const docsPresent = { manifest: fs.existsSync(MANIFEST), context: fs.existsSync(CONTEXT), tasks: fs.existsSync(TASKS) };
  if (!docsPresent.manifest) console.log('  ⚠ REPO_MANIFEST.md not found — "documented" cannot be assessed and every');
  if (!docsPresent.manifest) console.log('    script will read as undocumented. Treat that column as unknown, not as fact.\n');

  // Workflow bodies, once.
  const runHistory = lastRunDays();

  const wf = workflowFiles.map(f => {
    const body = readText(path.join(WORKFLOWS_DIR, f));
    const nameMatch = body.match(/^name:\s*(.+)$/m);
    // Scripts invoked. Generous on purpose — see header.
    const invoked = new Set();
    for (const m of body.matchAll(/scripts\/([A-Za-z0-9._-]+\.(?:js|cjs|mjs|sh))/g)) invoked.add(m[1]);
    return {
      file: f,
      displayName: nameMatch ? nameMatch[1].trim() : null,
      hasSchedule: /^\s*schedule:/m.test(body),
      hasDispatch: /workflow_dispatch:/.test(body),
      hasRepoDispatch: /repository_dispatch:/.test(body),
      hasWorkflowCall: /workflow_call:/.test(body),
      invokes: [...invoked],
      lastCommit: lastCommitISO(`.github/workflows/${f}`),
      bytes: Buffer.byteLength(body),
      body,
    };
  });

  // Script bodies, once.
  const allScriptNames = [...scriptFiles, ...libFiles.map(f => `lib/${f}`)];
  const scriptBodies = new Map();
  for (const rel of allScriptNames) scriptBodies.set(rel, readText(path.join(SCRIPTS_DIR, rel)));

  // ── Classify scripts ────────────────────────────────────────────────────────
  const scripts = [];
  for (const rel of allScriptNames) {
    const base = path.basename(rel);
    const body = scriptBodies.get(rel) || '';

    // ⚠️ A SCRIPT CAN BE REACHED THROUGH A WORKFLOW NAME, NOT ITS OWN.
    // post-drain-chain.yml runs `gh workflow run build-leaderboards.yml`; that
    // workflow runs build-leaderboards.js. Matching only on the SCRIPT's basename
    // missed the link entirely and put build-leaderboards.js, build-records.js,
    // build-finals-stats.js and build-team-stats.js on a "safe to delete" list on
    // 2026-09-10. All four are live builders in the nightly chain.
    // A workflow that dispatches another workflow counts as using everything that
    // workflow runs — one hop, which is what the chain topology actually is.
    const directUsers = wf.filter(w => w.body.includes(base));
    const viaDispatch = wf.filter(w => !w.body.includes(base) &&
      wf.some(t => t.invokes.includes(base) && w.body.includes(t.file)));
    const usedByWorkflows = [...directUsers.map(w => w.file), ...viaDispatch.map(w => `${w.file} (dispatches its workflow)`)];
    const requiredBy = [];
    for (const [otherRel, otherBody] of scriptBodies) {
      if (otherRel === rel) continue;
      if (otherBody.includes(base)) requiredBy.push(otherRel);
    }
    const documented = docText.includes(base);
    const lastCommit = lastCommitISO(`scripts/${rel}`);
    const age = daysAgo(lastCommit);
    const scheduled = wf.some(w => w.hasSchedule && w.body.includes(base));

    let klass;
    if (rel.startsWith('lib/'))             klass = requiredBy.length ? 'LIBRARY (required by other scripts)' : 'LIBRARY, UNREFERENCED';
    else if (scheduled)                     klass = 'SCHEDULED';
    else if (usedByWorkflows.length)        klass = 'DISPATCH-ONLY';
    else if (requiredBy.length)             klass = 'CALLED BY ANOTHER SCRIPT (no workflow)';
    else if (documented)                    klass = 'NO WORKFLOW, but documented — review';
    else                                    klass = 'ORPHAN: no workflow, nothing requires it, undocumented';

    const man = manifestOf(base);
    scripts.push({ path: `scripts/${rel}`, base, klass, usedByWorkflows, requiredBy, documented,
                   manifestSection: man ? man.section : null,
                   manifestClass:   manLabel(man),
                   manifestPurpose: man ? man.purpose : null,
                   lastCommit, ageDays: age, recent: age !== null && age <= DAYS,
                   bytes: Buffer.byteLength(body) });
  }

  // ── Classify workflows ──────────────────────────────────────────────────────
  const scriptBaseSet = new Set(allScriptNames.map(r => path.basename(r)));
  const workflows = [];
  for (const w of wf) {
    const missing = w.invokes.filter(s => !scriptBaseSet.has(s));
    const age = daysAgo(w.lastCommit);
    let klass;
    if (missing.length && missing.length === w.invokes.length && w.invokes.length)
      klass = `BROKEN: calls script(s) that do not exist — ${missing.join(', ')}`;
    else if (missing.length)
      klass = `PARTLY BROKEN: missing ${missing.join(', ')}`;
    else if (w.hasSchedule)        klass = 'SCHEDULED';
    else if (!w.invokes.length)    klass = 'CALLS NO SCRIPT (composite, dispatcher, or inline shell) — read before judging';
    else                           klass = 'DISPATCH-ONLY';
    // ⚠️ A WORKFLOW ANOTHER WORKFLOW DISPATCHES IS PART OF A CHAIN AND IS LIVE,
    // WHATEVER THE MANIFEST SAYS. deploy-pages.yml is fired by post-drain-chain.yml
    // and appears in the manifest only in §1 prose, so no §2/§3 row classifies it —
    // and on 2026-09-10 it was reported SPENT. It publishes the site.
    // Being dispatched is evidence of use that does not depend on the document
    // being maintained, which is the whole reason to prefer it.
    // ⚠️ A MENTION IS NOT A DISPATCH. The first version matched the filename
    // anywhere in another workflow's body, which counted COMMENTS. On 2026-09-10
    // close-empty-seasons.yml and lock-quiet-seasons.yml each reported the other as
    // its dispatcher — neither dispatches anything, they simply reference each other
    // in prose I had written. cleanup-repo.yml reported audit-tooling-inventory.yml
    // as a dispatcher for the same reason: a header sentence saying deletion stays
    // with cleanup-repo.
    //
    // Harmless there, because all of those are live anyway. Not harmless in general:
    // this signal OVERRIDES the manifest, so a stray mention in a comment can mark a
    // dead workflow as live. backfill.yml was reported LIVE with six dispatchers
    // while simultaneously appearing in the BROKEN list because backfill.js does not
    // exist — a workflow that calls a missing script cannot be live.
    //
    // A dispatch is `gh workflow run <name>` on a line that is not a comment.
    const run = runHistory.get(w.file) || { days: null, iso: null };
    const dispatchedBy = wf.filter(o => {
      if (o.file === w.file) return false;
      return o.body.split('\n').some(line => {
        const t = line.trim();
        if (t.startsWith('#')) return false;
        return /gh\s+workflow\s+run/.test(line) && line.includes(w.file);
      });
    }).map(o => o.file);
    const wman = manifestOf(w.file);
    workflows.push({ path: `.github/workflows/${w.file}`, displayName: w.displayName, klass,
                     invokes: w.invokes, missingScripts: missing, hasSchedule: w.hasSchedule,
                     triggers: w.triggers, lastRunDays: run.days, lastRunAt: run.iso,
                     manifestSection: wman ? wman.section : null,
                     manifestClass:   manLabel(wman),
                     manifestPurpose: wman ? wman.purpose : null,
                     dispatchedBy,
                     lastCommit: w.lastCommit, ageDays: age, recent: age !== null && age <= DAYS,
                     bytes: w.bytes });
  }

  // ── Manifest rows describing files that are gone ────────────────────────────
  // The reverse of every other check here. Everything above asks "is this file
  // referenced"; this asks "is this DOCUMENT still true". §2.3 and §3.4 are excluded
  // because those sections exist to record what was removed — absence from disk is
  // what they assert, not a fault. A stale row elsewhere matters because the
  // `documented` test in this very script treats the manifest as authority, and a
  // document describing tools deleted months ago will keep something alive on that
  // basis. Same failure as data/venue-index.json's writer being recorded as
  // "(venue build)" — a placeholder read back as fact for three months (T56).
  const onDisk = new Set([...allScriptNames.map(r => path.basename(r)),
                          ...workflowFiles.map(f => path.basename(f))]);
  const staleRows = [...manifestRows.entries()]
    .filter(([nme, r]) => !onDisk.has(nme) && !/^[23]\.(3|4)$/.test(r.section))
    .map(([nme, r]) => ({ name: nme, section: r.section, klass: manLabel(r), purpose: r.purpose }))
    .sort((a, b) => a.section.localeCompare(b.section) || a.name.localeCompare(b.name));

  // ── Pairs added recently ────────────────────────────────────────────────────
  const recentScripts   = scripts.filter(s => s.recent);
  const recentWorkflows = workflows.filter(w => w.recent);

  // ── IS IT STILL USEFUL? ─────────────────────────────────────────────────────
  // ADDED 2026-09-10. Reference-counting answers "is anything pointing at this",
  // which is NOT the question. Scripts and workflows ship as a pair here, so almost
  // every script has a workflow mentioning it and the orphan test returns 2 out of
  // 119. The 2026-09-10 run reported "0 safe to delete" against a repository where
  // 103 of 119 scripts are dispatch-only one-offs.
  //
  // The signal that does answer it was already in the manifest and unused. §2.1 is
  // the live pipeline. §2.2 is the on-demand tools someone DECIDED to keep. Those
  // two sections are a judgement that was already made and written down. A
  // dispatch-only script in NEITHER was never recorded as worth keeping — it is a
  // one-off whose question has been answered.
  //
  // Age separates two different situations among those. Something written this week
  // is current work: the answer may not be recorded yet and the decision is due now.
  // Something untouched for a fortnight and still unlisted has already been
  // forgotten once.
  //
  // The verdict is advisory. It reads the manifest as authority, and a manifest that
  // has not been maintained will under-list §2.2 and over-report SPENT. That is why
  // the stale-row count above matters, and why nothing here is deleted automatically.
  // Run history outranks every structural signal, because it is the only one that
  // cannot be wrong about how a workflow is triggered.
  const RUN_LIVE_DAYS = Math.max(DAYS, 30);   // ran this recently => live
  const RUN_DEAD_DAYS = 120;                  // has not run in this long => spent
  const verdictOf = (x) => {
    // BROKEN first, even above run history: a workflow that ran yesterday AND calls
    // a script that is not in the repo is defective, and that is the thing worth
    // knowing. It ran; it did not work.
    if (x.klass && x.klass.startsWith('BROKEN')) {
      return `BROKEN — calls a script that is not in the repo${typeof x.lastRunDays === 'number' ? ` (last ran ${x.lastRunDays}d ago)` : ''}`;
    }
    if (typeof x.lastRunDays === 'number') {
      if (x.lastRunDays <= RUN_LIVE_DAYS)  return `LIVE — actually ran ${x.lastRunDays}d ago`;
      if (x.lastRunDays >= RUN_DEAD_DAYS)  return `SPENT — has not run in ${x.lastRunDays} days`;
      // Between the two: it ran, but not recently. Structure decides, and the date
      // is carried into the answer so nobody has to go and look it up.
      const struct = structuralVerdict(x);
      return `${struct}  [last ran ${x.lastRunDays}d ago]`;
    }
    const inLive = x.manifestSection === '2.1' || x.manifestSection === '3.1' || x.manifestSection === '3.2';
    const inTool = x.manifestSection === '2.2' || x.manifestSection === '3.3';
    return structuralVerdict(x);
  };

  // The old, inference-only path. Still used when GitHub has no run history for a
  // workflow — a newly added one, or a run with no actions:read permission.
  function structuralVerdict(x) {
    const inLive = x.manifestSection === '2.1' || x.manifestSection === '3.1' || x.manifestSection === '3.2';
    const inTool = x.manifestSection === '2.2' || x.manifestSection === '3.3';
    if (x.klass === 'SCHEDULED' || inLive)          return 'LIVE — runs on a schedule or in the nightly chain';
    // A workflow calling a script that is not in the repo cannot be live, whoever
    // dispatches it. Checked BEFORE the dispatch signal so a chain member that has
    // lost its script is not protected by the chain.
    if (x.dispatchedBy && x.dispatchedBy.length)    return `LIVE — dispatched by ${x.dispatchedBy.join(', ')}`;
    if (x.triggers && x.triggers.length)            return `LIVE — triggered by ${x.triggers.join(', ')}`;
    if (x.klass.startsWith('LIBRARY (required'))    return 'LIVE — required by another script';
    if (inTool)                                     return 'KEEP — recorded in the manifest as an on-demand tool';
    if (x.klass.startsWith('ORPHAN'))               return 'ORPHAN — nothing references it and no document mentions it';
    if (x.recent)                                   return 'DECIDE NOW — added recently, not recorded as a tool. Document it or delete it.';
    return 'SPENT — a one-off nothing decided to keep. Its question has been answered.';
  };
  for (const x of scripts)   x.verdict = verdictOf(x);
  for (const x of workflows) x.verdict = verdictOf(x);

  const spent  = scripts.filter(x => x.verdict.startsWith('SPENT'));
  const decide = scripts.filter(x => x.verdict.startsWith('DECIDE'));
  const spentW  = workflows.filter(x => x.verdict.startsWith('SPENT'));
  const decideW = workflows.filter(x => x.verdict.startsWith('DECIDE'));

  // ── Deletion candidates ─────────────────────────────────────────────────────
  // Two lists, deliberately separate. SAFE = nothing references it and its
  // findings are recorded. DOCUMENT-FIRST = nothing references it but no document
  // mentions it, so deleting it silently discards whatever it established.
  const safeDelete = [], documentFirst = [], brokenWorkflows = [];
  const SELF = 'scripts/audit-tooling-inventory.js';
  for (const s of scripts) {
    // Never list itself. It is dispatched by its own workflow but that workflow
    // mentions it, so the generous reference rule already covers it — this guard
    // is for the case where the audit is run before its workflow is added.
    if (s.path === SELF) continue;
    // 'NO WORKFLOW, but documented' MUST be a candidate. It is the class every
    // retired one-off lands in once its finding has been written down, and the
    // first version of this file excluded it — which made the SAFE list
    // permanently empty for scripts, since the ORPHAN class is undocumented by
    // definition. The audit would have reported "none to delete" against 163
    // workflows and looked like a clean result.
    // SPENT joins the candidate set as of 2026-09-10. Without it the SAFE list only
    // ever contained files nothing pointed at, and in a repo where every script has
    // a paired workflow that is almost nothing. A spent one-off is the ordinary case.
    const candidate = s.klass.startsWith('ORPHAN')
                   || s.klass.startsWith('LIBRARY, UNREF')
                   || s.klass.startsWith('NO WORKFLOW')
                   || s.verdict.startsWith('SPENT');
    if (!candidate) continue;
    (s.documented ? safeDelete : documentFirst).push(s.path);
  }
  for (const w of workflows) {
    if (w.klass.startsWith('BROKEN')) brokenWorkflows.push(w.path);
  }

  // ── Print ───────────────────────────────────────────────────────────────────
  const tallyBy = (arr, key) => {
    const t = {};
    for (const x of arr) { const k = x[key].split(' —')[0].split(':')[0]; t[k] = (t[k] || 0) + 1; }
    return t;
  };
  console.log('──── SCRIPTS BY CLASS ────');
  for (const [k, v] of Object.entries(tallyBy(scripts, 'klass'))) console.log(`  ${String(v).padStart(4)}  ${k}`);
  console.log('\n──── WORKFLOWS BY CLASS ────');
  for (const [k, v] of Object.entries(tallyBy(workflows, 'klass'))) console.log(`  ${String(v).padStart(4)}  ${k}`);

  console.log(`\n──── ADDED OR AMENDED IN THE LAST ${DAYS} DAYS ────`);
  console.log(`  ${recentScripts.length} script(s), ${recentWorkflows.length} workflow(s)`);
  for (const s of recentScripts) console.log(`  ${String(s.ageDays).padStart(3)}d  ${s.path}  [${s.klass}]${s.documented ? '' : '  UNDOCUMENTED'}`);

  // ── Is it still useful? ─────────────────────────────────────────────────────
  const vTally = (arr) => {
    const t = {};
    for (const x of arr) { const k = x.verdict.split(' —')[0]; t[k] = (t[k] || 0) + 1; }
    return Object.entries(t).sort((a, b) => b[1] - a[1]);
  };
  console.log(`\n── IS IT STILL USEFUL? ──`);
  console.log('  Reference-counting cannot answer this: scripts and workflows ship as a pair, so');
  console.log('  almost everything is "referenced". The manifest can — §2.1 is the live pipeline');
  console.log('  and §2.2 is the tools someone decided to keep. Anything dispatch-only in neither');
  console.log('  was never recorded as worth keeping.');
  console.log('\n  scripts:');
  for (const [k, v] of vTally(scripts))   console.log(`    ${String(v).padStart(5)}  ${k}`);
  console.log('  workflows:');
  for (const [k, v] of vTally(workflows)) console.log(`    ${String(v).padStart(5)}  ${k}`);

  console.log(`\n── SPENT — a one-off nothing decided to keep (${spent.length} script(s), ${spentW.length} workflow(s)) ──`);
  console.log('  Not in §2.1 or §2.2, dispatch-only, and untouched for more than the recent window.');
  console.log('  Delete the SCRIPT AND ITS WORKFLOW TOGETHER — a workflow left behind calls a file');
  console.log('  that no longer exists, which is exactly what cleanup-repo.yml looks like today.');
  console.log('  ⚠️ Check the finding is written down FIRST. The safe/document-first split below');
  console.log('     does that check; this list does not.');
  for (const x of spent) console.log(`  ${String(x.ageDays === null ? '?' : x.ageDays).padStart(4)}d  ${x.path}${x.documented ? '' : '   UNDOCUMENTED — its finding is nowhere'}`);
  for (const x of spentW) console.log(`  ${String(x.ageDays === null ? '?' : x.ageDays).padStart(4)}d  ${x.path}`);

  console.log(`\n── DECIDE NOW — recent, not recorded as a tool (${decide.length} script(s), ${decideW.length} workflow(s)) ──`);
  console.log('  Added inside the recent window and in neither manifest section. This is current');
  console.log('  work: either write its finding into REPO_MANIFEST §2.2 and keep it, or delete it');
  console.log('  in the same commit that records what it found. Left alone it becomes SPENT and');
  console.log('  then nobody remembers what it established.');
  for (const x of decide)  console.log(`  ${String(x.ageDays === null ? '?' : x.ageDays).padStart(4)}d  ${x.path}`);
  for (const x of decideW) console.log(`  ${String(x.ageDays === null ? '?' : x.ageDays).padStart(4)}d  ${x.path}`);

  // ── Workflows the manifest does not classify ────────────────────────────────
  // Distinct from SPENT: this is a DOCUMENTATION gap. A workflow absent from §3.x
  // gets no protection from the manifest, so the verdict falls back to age and to
  // whether anything dispatches it. If something here is live, the fix is a row in
  // §3.2 or §3.3, not a change to this tool.
  const unclassifiedW = workflows.filter(w => !w.manifestSection);
  console.log(`\n── WORKFLOWS WITH NO §3.x ROW — ${unclassifiedW.length} ──`);
  if (!unclassifiedW.length) console.log('  none.');
  else {
    console.log('  The manifest does not classify these, so nothing but age and dispatch protects');
    console.log('  them from being read as spent. Add a row to §3.2 or §3.3 for any that are live.');
    for (const w of unclassifiedW.slice(0, 40)) {
      console.log(`  ${String(w.ageDays === null ? '?' : w.ageDays).padStart(4)}d  ${w.path}  ${w.verdict.split(' —')[0]}${w.dispatchedBy.length ? `  ← dispatched by ${w.dispatchedBy.join(', ')}` : ''}`);
    }
    if (unclassifiedW.length > 40) console.log(`  … and ${unclassifiedW.length - 40} more`);
  }

  // ── Stale manifest rows ─────────────────────────────────────────────────────
  console.log(`\n── IN THE MANIFEST BUT NOT ON DISK — ${staleRows.length} row(s) ──`);
  if (!staleRows.length) {
    console.log('  none — every §2/§3 row outside the "removed" sections has a file.');
  } else {
    console.log('  The document describes these; the files are gone. Either they were deleted');
    console.log('  without the manifest being updated, or the row was aspirational. This is a');
    console.log('  DOCUMENT fault, not a file fault — nothing here is a deletion candidate.');
    console.log('  §2.3 and §3.4 are excluded: recording what was removed is their purpose.');
    for (const r of staleRows) {
      console.log(`  ${r.name.padEnd(46)} §${r.section}  ${r.klass}`);
      if (r.purpose) console.log(`      says: ${r.purpose.replace(/\*\*/g, '').slice(0, 120)}`);
    }
  }
  for (const w of recentWorkflows) console.log(`  ${String(w.ageDays).padStart(3)}d  ${w.path}  [${w.klass}]`);

  console.log('\n──── BROKEN WORKFLOWS (call a script that is not in the repo) ────');
  if (!brokenWorkflows.length) console.log('  none');
  for (const w of workflows.filter(x => x.klass.startsWith('BROKEN') || x.klass.startsWith('PARTLY'))) {
    console.log(`  ${w.path} — missing ${w.missingScripts.join(', ')}`);
  }

  console.log('\n──── ORPHAN SCRIPTS, DOCUMENTED (findings already recorded — safe to delete) ────');
  if (!safeDelete.length) console.log('  none');
  for (const p of safeDelete) console.log(`  ${p}`);

  console.log('\n──── ORPHAN SCRIPTS, UNDOCUMENTED (write the finding down FIRST) ────');
  if (!documentFirst.length) console.log('  none');
  for (const p of documentFirst) console.log(`  ${p}`);

  console.log('\nHOW TO READ THIS. "Referenced" is generous: a script counts as used if ANY');
  console.log('workflow mentions its filename anywhere. That over-counts, on purpose — a missed');
  console.log('reference would put a LIVE file on a delete list, which is the costlier mistake.');
  console.log('Nothing here is deleted. Paste the list into cleanup-repo.yml, dry-run it first.');

  // ── Write the paste-ready list ──────────────────────────────────────────────
  const lines = [
    '# reports/tooling-delete-list.txt',
    `# generated ${new Date().toISOString()} by scripts/audit-tooling-inventory.js`,
    '#',
    '# Paste into the SCRIPTS=( ) / WORKFLOWS=( ) arrays in cleanup-repo.yml.',
    '# Run cleanup-repo with dry_run=true FIRST and read the list it prints.',
    '#',
    '# SAFE — nothing references these and a document already records what they found:',
    ...safeDelete.map(p => `  ${p}`),
    '#',
    '# DOCUMENT FIRST — nothing references these, but NO document mentions them.',
    '# Deleting one discards whatever it established. Write the finding into',
    '# REPO_MANIFEST.md in the same commit, then move the line up into SAFE.',
    ...documentFirst.map(p => `  # ${p}`),
    '#',
    '# BROKEN WORKFLOWS — these call a script that is not in the repo. They cannot',
    '# run. Confirm the script was deleted deliberately, then remove the workflow:',
    ...brokenWorkflows.map(p => `  ${p}`),
    '',
  ];
  fs.writeFileSync(OUT_LIST, lines.join('\n'));

  const out = {
    generatedAt: new Date().toISOString(),
    docsPresent,
    counts: { scripts: scriptFiles.length, libs: libFiles.length, workflows: workflowFiles.length,
              recentScripts: recentScripts.length, recentWorkflows: recentWorkflows.length,
              staleManifestRows: staleRows.length,
              spentScripts: spent.length, spentWorkflows: spentW.length,
              decideScripts: decide.length, decideWorkflows: decideW.length,
              safeDelete: safeDelete.length, documentFirst: documentFirst.length, brokenWorkflows: brokenWorkflows.length },
    safeDelete, documentFirst, brokenWorkflows,
    scripts, workflows,
  };
  out.staleManifestRows = staleRows;
  fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${OUT_JSON_REL} and ${OUT_LIST_REL}`);

  if (DRY) console.log('(not committed — re-run with commit enabled to commit the two reports)');
  else await gitCommit(`tooling inventory: ${scriptFiles.length} scripts, ${workflowFiles.length} workflows, ${safeDelete.length} safe to delete`, [OUT_JSON_REL, OUT_LIST_REL]);

  console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

main().catch(e => { console.error('FATAL:', e && e.stack || e); process.exit(1); });
