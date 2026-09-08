// scripts/update-team-index.js
//
// Adds new team entries to team-index.json, AND corrects existing ones, by
// scanning recently-updated
// player files (default: last 2 days). Sources team data from
// seasons[].regs[] which includes pre-graded teams not yet in game files.
//
// Safe to run with the 2-day filter — any new team registration causes
// publicProfileTeams to update the player file (updatedAt), so recently
// registered players are always caught within 24-48h.
//
// team-index.json structure:
//   { "Season Name": [{ id, n, sid, comp, grade }] }
//
// Usage:
//   node scripts/update-team-index.js            # last 2 days
//   node scripts/update-team-index.js --days=7   # last 7 days
//   node scripts/update-team-index.js --all      # scan all player files
//   node scripts/update-team-index.js --dry-run

'use strict';

const fs           = require('fs');
const path         = require('path');
const { execSync } = require('child_process');

const ROOT    = path.join(__dirname, '..');
const ARGS    = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => { const [k, ...v] = a.slice(2).split('='); return [k, v.length ? v.join('=') : true]; })
);

const DRY_RUN  = !!ARGS['dry-run'];
const SCAN_ALL = !!ARGS.all;
const DAYS     = SCAN_ALL ? Infinity : Math.max(1, parseInt(ARGS.days || '2', 10));

const PLAYERS_DIR     = path.join(ROOT, 'players');
const INDEX_DIR       = path.join(ROOT, 'players', 'indexes');
const TEAM_INDEX_FILE = path.join(ROOT, 'data', 'team-index.json');
const SPORTS_INDEX    = path.join(ROOT, 'data', 'sports-index.json');

// ⚠️ REWRITTEN 2026-09-08. THE PREVIOUS VERSION BROKE FOUR OF THIS REPO'S OWN
// EXPLICIT RULES, THREE OF THEM NAMED IN claude_context.md.
//
// 1. `git add -A`. Forbidden outright (claude_context L1286). 418,000 files: it
//    risks ENOBUFS, and it stages whatever any CONCURRENT job has in flight. This
//    runs as a nightly job, so it could commit another job's half-written work
//    under this script's message. The same violation was found and fixed in
//    discover-seasons.js and build-leaderboards.js on 2026-07-09 — both had a
//    path parameter that was silently ignored in favour of blanket -A. This script
//    writes exactly ONE file and still used -A.
//
// 2. `git diff --staged --stat`. The rule is --shortstat, never --stat (L1296).
//    L475 records the consequence: 25,593 changed files, 2,460 bytes over the
//    buffer, Node killed git mid-merge with ENOBUFS/SIGTERM.
//
// 3. `git merge --no-edit` with no `--no-stat`. Same buffer class, same rule.
//
// 4. The whole thing wrapped in a try/catch that printed and returned, so a failed
//    add, commit, merge or push exited ZERO and the job showed green having
//    written nothing.
//
// There was also no push retry, so a single lost race discarded the run in silence.
const GIT_OPTS      = { cwd: ROOT, stdio: 'pipe', timeout: 10 * 60 * 1000, maxBuffer: 512 * 1024 * 1024 };
const PUSH_ATTEMPTS = 60;

function gitCommit(message) {
  if (DRY_RUN) { console.log(`  [dry-run] ${message}`); return; }

  // One file. Named explicitly. Never -A.
  execSync('git add -- data/team-index.json', GIT_OPTS);

  const shortstat = execSync('git diff --staged --shortstat', GIT_OPTS).toString().trim();
  if (!shortstat) { console.log('  staging: no changes — nothing to commit'); return; }
  console.log(`  staging: ${shortstat}`);

  // Commit BEFORE merge: merging over uncommitted changes fails outright when a
  // concurrent push touches the same file. build-win-loss lost a full run's 78,000
  // updates to exactly that on 2026-07-16.
  execSync(`git commit -m "${message.replace(/"/g, "'")}"`, GIT_OPTS);

  for (let attempt = 1; attempt <= PUSH_ATTEMPTS; attempt++) {
    try {
      execSync('git fetch origin main', GIT_OPTS);
      execSync('git merge -X ours FETCH_HEAD --no-edit --no-stat', GIT_OPTS);
      execSync('git push origin main', GIT_OPTS);
      console.log(`  ✔ pushed (attempt ${attempt}): ${message}`);
      return;
    } catch (e) {
      const detail = (e.stderr || e.stdout || '').toString().trim() || e.message;
      if (attempt === PUSH_ATTEMPTS) throw new Error(`push failed after ${PUSH_ATTEMPTS} attempts: ${detail}`);
      const wait = 1 + Math.floor(Math.random() * 90);
      console.log(`  … push contention (attempt ${attempt}) — retry in ${wait}s`);
      execSync(`sleep ${wait}`, { stdio: 'ignore' });
    }
  }
}

async function main() {
  console.log('update-team-index.js');
  if (SCAN_ALL)  console.log('  Mode: full scan (all player files)');
  else           console.log(`  Mode: recent only (last ${DAYS} day(s))`);
  if (DRY_RUN)   console.log('  ⚠  DRY RUN');
  console.log('─'.repeat(50));

  // Load sports-index for season metadata (name, compName)
  const sportIndex = JSON.parse(fs.readFileSync(SPORTS_INDEX, 'utf8'));
  const sidMeta    = {};
  for (const [sid, s] of Object.entries(sportIndex.seasons || {})) {
    sidMeta[sid] = { name: s.name || sid, compName: s.compName || '' };
  }

  // Load existing team-index — build a Set of all known team IDs
  let teamIndex = {};
  if (fs.existsSync(TEAM_INDEX_FILE)) {
    try { teamIndex = JSON.parse(fs.readFileSync(TEAM_INDEX_FILE, 'utf8')); }
    catch (_) {}
  }
  // ⚠️ A Set of ids was not enough. The old loop did `if (existingTids.has(tid))
  // continue;` BEFORE comparing anything, so a team that had been renamed or
  // regraded kept its original name and grade forever. Nothing in the pipeline ever
  // corrected it. That is a large part of why team-index.json barely moved.
  // Keeping the entry OBJECT means the current values can actually be compared.
  const existingById = new Map();
  for (const entries of Object.values(teamIndex)) {
    if (Array.isArray(entries)) {
      for (const e of entries) if (e.id) existingById.set(e.id, e);
    }
  }
  console.log(`Existing teams in index: ${existingById.size}`);

  // Determine cutoff timestamp
  const cutoff = SCAN_ALL ? 0 : Date.now() - DAYS * 24 * 60 * 60 * 1000;

  // Scan player shard indexes, filter by updatedAt, read player files
  const shards = fs.readdirSync(INDEX_DIR)
    .filter(f => /^[0-9a-f]{2}\.json$/.test(f))
    .map(f => f.replace('.json', ''));

  let playersChecked = 0, playersScanned = 0, newTeams = 0, updatedTeams = 0;
  const updates = [];
  const startingTotal = existingById.size;

  for (const shard of shards) {
    let index;
    try { index = JSON.parse(fs.readFileSync(path.join(INDEX_DIR, `${shard}.json`), 'utf8')); }
    catch (_) { continue; }

    for (const uuid of Object.keys(index)) {
      playersChecked++;
      const playerFile = path.join(PLAYERS_DIR, shard, `${uuid}.json`);
      if (!fs.existsSync(playerFile)) continue;

      // Check updatedAt before reading full file
      if (!SCAN_ALL) {
        try {
          const stat = fs.statSync(playerFile);
          if (stat.mtimeMs < cutoff) continue;
        } catch (_) { continue; }
      }

      let player;
      try { player = JSON.parse(fs.readFileSync(playerFile, 'utf8')); }
      catch (_) { continue; }
      playersScanned++;

      // Check updatedAt field in file as well (mtime can be unreliable on some runners)
      if (!SCAN_ALL && player.updatedAt) {
        const updatedMs = new Date(player.updatedAt).getTime();
        if (!isNaN(updatedMs) && updatedMs < cutoff) continue;
      }

      for (const season of (player.seasons || [])) {
        const sid  = season.sid;
        const meta = sidMeta[sid] || { name: sid, compName: '' };

        for (const reg of (season.regs || [])) {
          const tid = reg.tid;
          if (!tid) continue;

          const prev = existingById.get(tid);
          if (prev) {
            // Known team — CORRECT it if PlayHQ now says something different.
            // Only ever overwrite with a real value: a registration carrying no team
            // name must not blank a name we already hold.
            const want = { n: reg.tn || '', comp: meta.compName || '', grade: reg.gn || '' };
            const diffs = [];
            for (const k of ['n', 'comp', 'grade']) {
              if (!want[k]) continue;
              if (prev[k] === want[k]) continue;
              diffs.push(`${k} ${JSON.stringify(prev[k] === undefined ? null : prev[k])} -> ${JSON.stringify(want[k])}`);
              prev[k] = want[k];
            }
            if (diffs.length) {
              updatedTeams++;
              if (updates.length < 25) updates.push(`    ${tid}  ${diffs.join('; ')}`);
            }
            continue;
          }

          // New team — add to index
          const seasonName = meta.name;
          if (!teamIndex[seasonName]) teamIndex[seasonName] = [];
          const entry = {
            id:    tid,
            n:     reg.tn  || '',
            sid,
            comp:  meta.compName,
            grade: reg.gn  || '',
          };
          teamIndex[seasonName].push(entry);
          existingById.set(tid, entry);
          newTeams++;
        }
      }
    }
  }

  console.log(`Players checked: ${playersChecked.toLocaleString()}`);
  console.log(`Players scanned: ${playersScanned.toLocaleString()}`);
  console.log(`New teams added:    ${newTeams}`);
  console.log(`Existing corrected: ${updatedTeams}   <- renamed or regraded; previously never updated`);
  if (updates.length) {
    console.log('  corrections:');
    updates.forEach(u => console.log(u));
    if (updatedTeams > updates.length) console.log(`    ... and ${updatedTeams - updates.length} more`);
  }

  // This script only ever ADDS entries. If the total ever falls, the merge lost
  // rows and nothing may be written.
  const totalAfter = Object.values(teamIndex).reduce((t, a) => t + (Array.isArray(a) ? a.length : 0), 0);
  if (totalAfter < startingTotal) throw new Error(`ABORT: team-index shrank ${startingTotal} -> ${totalAfter}. Nothing written.`);
  console.log(`Total entries:      ${startingTotal} -> ${totalAfter}`);

  const changed = newTeams + updatedTeams;
  if (changed > 0 && !DRY_RUN) {
    fs.writeFileSync(TEAM_INDEX_FILE, JSON.stringify(teamIndex));
    gitCommit(`update-team-index: ${newTeams} new, ${updatedTeams} corrected`);
  } else if (changed === 0) {
    console.log('  Nothing new and nothing to correct');
  }

  console.log('─'.repeat(50));
  if (DRY_RUN) console.log('  ⚠  DRY RUN — nothing written');
}

main().catch(e => { console.error('\nFATAL:', e.message, '\n', e.stack); process.exit(1); });
