// scripts/prune-dangling-aliases.js
// REVISION 2026-09-10a — first version.
//
// Removes alias entries whose target player file does not exist.
//
// WHAT A DANGLING ALIAS IS. players/aliases/{xx}.json maps a spectator id to the
// full uuid of the player file that owns it. If that file has since been deleted —
// by a fold that merged the player away without repointing the alias — the entry
// points at nothing. db-audit.js §3b treats a non-zero count as a failed invariant.
//
// WHY NOT REPOINT THEM. fold-diverged-players.js --repoint-only is the right tool
// first, and it was run on 2026-09-08: it scanned 417,971 player files, built a map
// of 499,914 spectator ids, and reported both entries UNRESOLVABLE. No player file
// anywhere claims either id, so there is no target to derive and repointing is not
// possible. It deliberately will not delete, which is correct for a repair tool —
// hence this.
//
//   005c9694-d2a1 -> 3f310c9f-0352-4c3c-b9fc-b24a292ff9b8
//   9d69fac4-2d40 -> 3f310c9f-0352-4c3c-b9fc-b24a292ff9b8
//
// Neither id appears in reports/alias-repoint-log.json (13 entries, applied
// 2026-08-26) nor in reports/manual-alias-decisions.json, so neither was part of a
// deliberate attribution decision. That log covers one batch rather than the whole
// 46-alias campaign, so absence is supporting evidence, not proof — but a pointer to
// a file that does not exist cannot be serving anyone either way.
//
// DELETING IS BETTER THAN LEAVING IT. A lookup on a dangling alias resolves to a
// uuid whose file is missing, so the caller gets a broken reference instead of a
// clean miss. Absence is the honest answer.
//
// EXISTENCE IS CHECKED AGAINST players/indexes/, NOT THE PLAYER FILES.
// db-audit confirms the two are equivalent — index keys total equals detail files,
// with zero keys lacking a file and zero files lacking a key. The indexes are 155 MB
// against 2.2 GB, so this needs no full checkout.
//
// Run:
//   node scripts/prune-dangling-aliases.js --dry-run
//   node scripts/prune-dangling-aliases.js
//   node scripts/prune-dangling-aliases.js --ids=005c9694-d2a1,9d69fac4-2d40

'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT       = path.join(__dirname, '..');
const ALIAS_DIR  = path.join(ROOT, 'players', 'aliases');
const INDEX_DIR  = path.join(ROOT, 'players', 'indexes');
const ALIAS_REL  = 'players/aliases';

const args   = process.argv.slice(2);
const argVal = (n, d) => { const a = args.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const DRY_RUN  = args.includes('--dry-run');
const ONLY_IDS = argVal('ids', '').split(',').map(x => x.trim()).filter(Boolean);

const GIT_OPTS      = { cwd: ROOT, stdio: 'pipe', timeout: 10 * 60 * 1000, maxBuffer: 512 * 1024 * 1024 };
const PUSH_ATTEMPTS = 60;
const log = (m) => console.log(`[prune-aliases] ${new Date().toISOString()} ${m}`);

const isFullUuid = (s) => typeof s === 'string' && s.length === 36 && s.split('-').length === 5;

// House pattern: per-path add, shortstat, commit before merge, retry with jitter,
// merge --abort between attempts, THROW on exhaustion.
function gitCommit(message, paths) {
  let staged = 0;
  for (const p of paths) {
    try { execSync(`git add -- ${p}`, GIT_OPTS); staged++; }
    catch (e) { console.error(`  ⚠ git add FAILED "${p}": ${(e.stderr || e.stdout || '').toString().trim() || e.message}`); }
  }
  if (!staged) throw new Error('git add staged NOTHING — refusing to continue');

  const shortstat = execSync('git diff --staged --shortstat', GIT_OPTS).toString().trim();
  if (!shortstat) { console.log('  staging: no changes — nothing to commit'); return; }
  console.log(`  staging: ${shortstat}`);
  execSync(`git commit -q -m "${message.replace(/"/g, "'")}"`, GIT_OPTS);

  for (let attempt = 1; attempt <= PUSH_ATTEMPTS; attempt++) {
    try { execSync('git merge --abort', GIT_OPTS); } catch (_) { /* none in progress */ }
    try {
      execSync('git fetch origin main', GIT_OPTS);
      execSync('git merge -X ours FETCH_HEAD --no-edit --no-stat', GIT_OPTS);
      execSync('git push origin main', GIT_OPTS);
      console.log(`  ✔ pushed (attempt ${attempt}): ${message}`);
      return;
    } catch (e) {
      const detail = (e.stderr || e.stdout || '').toString().trim().slice(0, 200) || e.message.slice(0, 200);
      if (attempt === PUSH_ATTEMPTS) throw new Error(`push failed after ${PUSH_ATTEMPTS} attempts: ${detail}`);
      const s = 1 + Math.floor(Math.random() * 91);
      execSync(`sleep ${s}`, { stdio: 'pipe', cwd: ROOT });
    }
  }
}

function main() {
  log(`prune-dangling-aliases${DRY_RUN ? '  (DRY RUN)' : ''}${ONLY_IDS.length ? `  ids=${ONLY_IDS.join(',')}` : ''}`);
  console.log('─'.repeat(78));

  // Every uuid that has a player file, per players/indexes/.
  const known = new Set();
  let indexShards = 0;
  for (const f of fs.readdirSync(INDEX_DIR).filter(x => /^[0-9a-f]{2}\.json$/.test(x)).sort()) {
    let shard;
    try { shard = JSON.parse(fs.readFileSync(path.join(INDEX_DIR, f), 'utf8')); } catch { continue; }
    indexShards++;
    for (const uuid of Object.keys(shard)) known.add(uuid);
  }
  console.log(`  index shards read     : ${indexShards}`);
  console.log(`  players with a file   : ${known.size}`);
  if (indexShards !== 256) throw new Error(`ABORT: read ${indexShards} index shards, expected 256. A partial checkout would make every alias look dangling.`);

  let entries = 0, identity = 0, redirect = 0;
  const dangling = [];
  const shards = new Map();

  for (const f of fs.readdirSync(ALIAS_DIR).filter(x => /^[0-9a-f]{2}\.json$/.test(x)).sort()) {
    let shard;
    try { shard = JSON.parse(fs.readFileSync(path.join(ALIAS_DIR, f), 'utf8')); } catch { continue; }
    shards.set(f, shard);
    for (const [key, val] of Object.entries(shard)) {
      entries++;
      if (!isFullUuid(val)) { identity++; continue; }
      redirect++;
      if (known.has(val)) continue;
      dangling.push({ file: f, key, val });
    }
  }

  console.log(`  alias entries         : ${entries}   (${identity} identity, ${redirect} redirect)`);
  console.log(`  DANGLING              : ${dangling.length}`);
  if (!dangling.length) { log('nothing dangling — nothing to do.'); return; }

  console.log('');
  for (const d of dangling) console.log(`    ${d.key}  ->  ${d.val}   (players/aliases/${d.file})`);

  const target = ONLY_IDS.length ? dangling.filter(d => ONLY_IDS.includes(d.key)) : dangling;
  if (ONLY_IDS.length) {
    const missing = ONLY_IDS.filter(id => !dangling.some(d => d.key === id));
    if (missing.length) throw new Error(`ABORT: ${missing.join(', ')} not found among the dangling entries. Nothing changed.`);
    console.log(`\n  limited by --ids to ${target.length} of ${dangling.length}`);
  }

  const touched = new Set();
  for (const d of target) { delete shards.get(d.file)[d.key]; touched.add(d.file); }

  // ── Assertions. Exactly the named keys, and nothing else, may have gone. ────
  let after = 0;
  for (const shard of shards.values()) after += Object.keys(shard).length;
  if (entries - after !== target.length) throw new Error(`ABORT: entry count fell by ${entries - after} but ${target.length} were removed. Nothing written.`);
  for (const d of target) {
    if (d.key in shards.get(d.file)) throw new Error(`ABORT: ${d.key} still present after delete. Nothing written.`);
  }
  const stillDangling = [];
  for (const [f, shard] of shards) {
    for (const [key, val] of Object.entries(shard)) {
      if (isFullUuid(val) && !known.has(val)) stillDangling.push(`${key} -> ${val}`);
    }
  }

  console.log(`\n${'═'.repeat(78)}`);
  console.log(`  removed               : ${target.length}   across ${touched.size} shard file(s)`);
  console.log(`  alias entries         : ${entries} → ${after}`);
  console.log(`  dangling remaining    : ${stillDangling.length}${stillDangling.length ? '   ' + stillDangling.join(', ') : '   ✅ db-audit §3b invariant satisfied'}`);
  console.log(`  assertions            : PASSED — exactly the named keys removed`);
  console.log(`${'═'.repeat(78)}`);

  if (DRY_RUN) { log('dry run — nothing written.'); return; }

  const paths = [];
  for (const f of touched) {
    fs.writeFileSync(path.join(ALIAS_DIR, f), JSON.stringify(shards.get(f)));
    paths.push(`${ALIAS_REL}/${f}`);
  }
  gitCommit(`prune-dangling-aliases: removed ${target.length} alias(es) pointing at deleted player files`, paths);
  log('done. Re-run db-audit to confirm §3b reads 0.');
}

main();
