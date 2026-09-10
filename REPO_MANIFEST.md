# REPO_MANIFEST.md — Basketball Victoria Stats System

**Canonical reference for `markjovic/sports-players-stats` and `markjovic/stattrack`.**
Generated 2026-07-16 from a full read of all 78 scripts + 88 workflows, with the JSON
writer→reader graph derived mechanically (grep of every `readFileSync`/`writeFileSync`/
`unlinkSync` call), not from memory. This file is intended to replace re-uploading scripts
into each new conversation: it documents every file's purpose, trigger, schedule, reads,
writes, and how the pieces chain together.

> **Confidence markers:** every entry here was read in full ([V]-grade in the audit).
> The only files NOT documented are ~40 already-deleted files listed on `cleanup-repo.yml`'s
> manifest that never existed in any working tree during this audit — they are gone, not missing.

---

## 0. HOW TO READ THIS DOCUMENT

- **§1 Live core** — what actually runs on a schedule and how the jobs chain. Read this first.
- **§2 Scripts** — every `scripts/*.js|*.cjs`, grouped by role, with reads/writes/trigger.
- **§3 Workflows** — every `.github/workflows/*.yml`, with trigger, schedule, and the script it runs.
- **§4 JSON / data files** — the writer→reader graph: who writes each file, who reads it, is it needed.
- **§5 Progress files** — the resumable-checkpoint dotfiles and their delete-on-success behaviour.
- **§6 Known issues & open decisions** — live bugs, contradictions, and design calls awaiting Mark.
- **§7 Conventions** — the non-negotiable git/workflow/code rules this repo enforces.

Legend for verdicts: **LIVE** (runs in steady state) · **TOOL** (on-demand ops utility, keep) ·
**FIX** (live but has a bug to correct). Files that were completed one-offs have been DELETED (see the
"removed in cleanup" records in §2.3 / §3.4 / §4.3); they are not listed as live files.

---

## 1. THE LIVE CORE (what runs automatically)

### 1.1 Schedules
| Workflow | Schedule (UTC) | Local (AEST) | Purpose |
|---|---|---|---|
| `nightly-crawl.yml` | `0 15 * * *` daily | 01:00 daily | Ingest new/changed games, chain downstream builds |
| `weekly-indexes.yml` | `0 2 * * 0` Sunday | 12:00 Sun | Full-population team-stats, player-games, win-loss; + fold-diverged backstop |
| `recheck-private-profiles.yml` | `0 2 1 * *` monthly | 12:00 1st | Re-probe private profiles for newly-public data |
| `discover-seasons-matrix.yml` | *(no cron)* — fired by nightly on Sundays when crawl drains | — | Sharded season/grade discovery |
| `fetch-profile-stats-matrix.yml` | *(no cron)* — fired by nightly when new players / rechecks exist | — | Per-shard profile stats fetch |
| `fold-diverged-players.yml` | *(no cron)* — fired by the matrix on terminal completion | — | Fold re-diverged players onto api ids |
| `discover-fixtures.yml` | *(no cron)* — fired by nightly on Mondays when crawl drains (2026-07-21) | — | Weekly future-fixtures sweep (`--current-only`); chains finals→leaderboards via `chain_stats` |
| `build-finals-stats.yml` | *(no cron)* — fired by discover-fixtures' chain-stats job (2026-07-21) | — | Weekly `active_only=true`; chains leaderboards via `chain_leaderboards` |
| `build-leaderboards.yml` | *(no cron)* — fired by build-finals-stats' chain job (2026-07-21) | — | Weekly `active_only=true` |
| `post-drain-chain.yml` | *(no cron)* — fired by the matrix terminal at drain, OR by nightly directly on matrix-skipped nights (2026-08-07) | — | Sequential derived-data builds under ONE data-write acquisition (T19 structural fix); dispatches fold + Deploy Pages + Graduate Seasons |
| `graduate-seasons.yml` | *(no cron)* — fired by post-drain-chain's tail, unconditionally (2026-08-07; moved there from the nightly the same day — §2.7) | — | Season graduation for the active/locked split; 28-day grace lives HERE ONLY (`grace_days` input default) |
| `weekly-indexes.yml` | **cron 02:00 UTC Sun** (12:00 AEST Sun) | — | ⚠ CHAIN ORDER MATTERS (2026-08-13): `discover-fixtures → team-stats → win-loss → player-games → fold-diverged`, serialised by `needs`. Workflow-level `data-write` does NOT serialise a workflow's own jobs (T28), and `build-player-games` derives `games[]` entirely from `games/bv` (T29) — anything added that WRITES games/bv must be placed BEFORE `player-games`. Its `discover-fixtures` job passes `--concurrency=40`, the proven value |
| `discover-seasons-matrix.yml` | **cron 20:00 UTC Sun** (06:00 Mon AEST) — MOVED here 2026-08-10 from nightly-crawl's terminal fan-out | — | Weekly season + pre-game-roster discovery. Schedule mode resolves `backfill_teams=true` (T27) |
| `discover-fixtures.yml` | **cron 20:00 UTC Mon** (06:00 Tue AEST) — MOVED here 2026-08-10 | — | Weekly future-fixtures sweep; schedule mode = `--current-only` + stats chain (T27) |
| `spectator-backfill.yml` | cron 10:00 UTC Sat — **COMMENTED OUT for the re-sweep campaign** (2026-08-08); re-enable at campaign end (OUTSTANDING §2.9) | — | Permanent weekly tail: sweeps games that aged past the 30-day guard |
| `deploy-archive-pages.yml` | **cron 18:00 UTC Sat** (04:00 Sun AEST) + dispatched by graduation and backfill tails | — | **Lives in `markjovic/sports-players-stats-archive`**, builds the ARCHIVE origin from THIS repo's checkout (locked OR archivedAt — union rule) |

`deploy-pages.yml` trigger location, recorded precisely (2026-08-07 — the imprecision cost a session
detour): `workflow_dispatch` + `workflow_run` on five workflow **NAMES** (Weekly Indexes, Build
Leaderboards (Full), Build Search Index, Build Single-Game Records, Fold diverged players) — the
dispatch is NOT in nightly-crawl.yml; the chaining happens via those terminals' completions, plus
explicit dispatches from post-drain-chain and graduate-seasons.

Everything else is `workflow_dispatch` (manual) only.

### 1.2 The nightly chain (topology)
```
nightly-crawl (cron 15:00 UTC daily)  [concurrency: data-write]
│
├─ crawl ─────────────► nightly-crawl.js: Phase 2 fetches ROUND FIXTURES itself
│                       (discoverFixtureByRound; 2026-07-21: `--rounds-forward=N|all`
│                       adds FUTURE rounds — default 0 = nightly unchanged; grades with
│                       NO current round now fetch their first unsettled round instead
│                       of being skipped), writes games/bv/{sid}.json,
│                       roundsComplete markers, .nightly-status.json,
│                       needs-matrix-shards.json ; outputs: games_remaining,
│                       games_processed, new_players, stats_rechecks
│
├─ team-stats ────────► build-team-stats.js --active-only   → team-stats/bv/{sid}.json
├─ team-index ────────► update-team-index.js                → data/team-index.json
├─ venue-lookup ──────► update-venue-lookup.js               → venue-lookup/*
│    (venue-indexes MOVED to post-drain-chain.yml 2026-08-07 — post-drain by construction,
│     so the matrix-storm push contention that was killing it is gone at the source)
├─ win-loss ──────────► build-win-loss.js --active-only      → players/**/*.json (win/loss fields)
│
├─ profile-stats-matrix (if new_players≠0 OR stats_rechecks≠0)
│    └─ gh workflow run fetch-profile-stats-matrix.yml  --field shards=<needs-matrix-shards.json>
│
├─ post-drain-chain (terminal drain AND matrix NOT triggered) ► gh workflow run post-drain-chain.yml
│                                  (mirror gate — matrix-skipped nights previously ran NO post-drain
│                                  builds and published NOTHING; matrix nights: its terminal dispatches)
│
├─ discover-seasons (Sundays only, if games_remaining==0)
│    └─ gh workflow run discover-seasons-matrix.yml --field backfill_teams=true
│       (2026-07-21: weekly pre-game roster capture — mode all+backfill, implies
│        all_players; ~411k probes, ~2× the old current-mode sweep)
│
├─ discover-fixtures-weekly (Mondays only, if games_remaining==0)      ◄── 2026-07-21 §C7 chain
│    └─ gh workflow run discover-fixtures.yml --field current_only=true --field chain_stats=true
│         └─ chain-stats job (success-gated) → gh workflow run build-finals-stats.yml
│              --field active_only=true --field chain_leaderboards=true
│              └─ chain-leaderboards job (success-gated) → gh workflow run
│                   build-leaderboards.yml --field active_only=true
│       (Mon 15:00 UTC nightly = Tue 01:00 AEST; chain lands Tue early AM. Accepted
│        coupling: nightly chain halt ⇒ week's sweep skipped ⇒ manual re-dispatch.)
│
└─ retrigger (if games_remaining≠0; stops after 3 zero-progress runs)
     └─ gh workflow run nightly-crawl.yml (self, consecutive_zeros incremented)
```

### 1.3 The profile-stats matrix and the FOLD (critical operational detail)
```
fetch-profile-stats-matrix (self-retriggers; run cap 150; 3 zero-written runs = "stuck"=DONE)
│  [triggered by nightly with TARGETED shards, or manually with shards=[] for all 256]
│
├─ clear-stats-checked (only if force=true)
├─ generate-shards → fetch (256 matrix, max-parallel 20) → apply-and-commit
│                    each shard: fetch-profile-stats.js --shard=XX
│                    reads: players/indexes/{xx}, players/aliases/{xx}, players/{xx}/*, data/sports-index.json
│                    writes: players/{xx}/*.json (stats), possibly players/aliases/{xx}
│
└─ summary-and-retrigger
     ├─ if written>0 and run<150 → retrigger next run
     ├─ if 3 consecutive zero-written runs → status=STUCK (terminal):
     │     1. gh workflow run build-leaderboards.yml
     │     2. gh workflow run build-search-index.yml
     │     3. gh workflow run build-records.yml
     │     4. gh workflow run fold-diverged-players.yml --field mode=apply   ◄── THE FOLD
     │     5. gh workflow run build-team-stats.yml --field active_only=true   ◄── 2026-07-21
     │        roster-lag fix: roster stats come from player reg stats, which THIS matrix
     │        writes — the nightly's own team-stats job runs before the matrix and can
     │        never see tonight's stats, so rosters lagged the player view by a day
     └─ if run≥150 → max_runs (exit 1, manual intervention)
```

> **THE FOLD TRIGGER — how it actually fires (corrected 2026-07-16):**
> The fold is the 4th terminal action when the matrix reaches `status=stuck` (3 consecutive
> zero-written runs). Crucially, the matrix **preserves its targeted shard set across self-retriggers**
> (`NEXT_SHARDS = inputs.shards`, line 313), so a nightly-triggered run on a small shard set runs its
> OWN retrigger chain to completion: run 1 fetches the new players (written>0 → retrigger), then the
> next runs find nothing to write, and after 3 consecutive zero-write runs it hits `stuck` and fires
> the rebuilds + fold. **So the fold DOES fire at the tail of each nightly matrix cycle** — not on the
> first run, but at the drain-end of that cycle's self-retrigger chain, which the same invocation
> reaches on its own. (This corrects an earlier overstatement in this session that the fold "does not
> run on the nightly path" — it does.)
>
> **The real residual risk (narrower):** the retrigger chain is a series of SEPARATE `gh workflow run`
> dispatches passing `consecutive_zeros` run-to-run via `--field`, not one durable loop. If any single
> dispatch fails to fire (WORKFLOW_PAT hiccup, Actions queue delay), the chain breaks BEFORE reaching
> `stuck`, and the fold is skipped for that cycle. Also, a cycle that keeps finding just enough to write
> on every run could hit the run cap (150) before stringing 3 zeros — unlikely on a small targeted set.
> Neither is a wiring gap; both are reliability edges of a multi-dispatch chain. See §6.2.

### 1.4 The event-driven fold (steady-state identity maintenance)
`fold-diverged-players.yml` (mode=apply) reads every player file, finds those carrying an `apiId`
(diverged/recovered players whose filename is still their old spectator id), moves them to their
api-id path, relocates the index entry, and commits once. This is permanent steady-state, not
migration residue: PlayHQ mints fresh spectator ids per person over time (the "Micaela Chang" case
had 3), so stub→recover→alias→fold recurs. No schedule; event-driven only.

---

## 1z. SESSION 2026-08-23/24 — THE ALIAS TABLE, VERIFIED

The standing assumption was that `players/aliases` is correct. It had never been tested. Every entry
was written by matching NAMES, and the matcher never checked whether the profile it picked actually
credits the games the alias goes on to deliver.

**Three tiers of evidence, weakest last, each only reached when the one before ran out:**

1. **Credits** (`probe-alias-credits`) — does PlayHQ credit the target with these games?
   81,685 audited: **77,142 supported (98.9%)**, 874 not, 3,517 no answer.
2. **Identity** (`probe-alias-names`) — who does the SPECTATOR box score say the id is?
   746 asked: 739 name agrees, **0 genuine disagreements**, 5 folding artefacts (Zac/Zachary,
   hyphen-vs-space). Of the agreements, **652 settled** and **87 still open** because several players
   carry that name — a name test cannot settle a name collision (T40).
3. **Registrations** (`probe-shared-name-aliases`, OFFLINE) — which same-named candidate held a
   registration for that game's season to one of the two teams playing it?
   87 examined: 24 confirmed, **23 to repoint**, 4 ambiguous, 36 none-fit.

**Applied:** 88 repoints, each re-verified against PlayHQ at apply time, then `build-player-games`
rebuilt 27,373 player files. The 23 from tier 3 are pending §1.1 of OUTSTANDING_TASKS.

**The case that exposed it.** `900f4fe6-bec3` appears in PlayHQ box scores as "Jida McCrae-Cooper" and
is NOT a PlayHQ profile — exactly what aliases exist for. Ours pointed it at `d6c25c0c`, a different
profile with a similar name, while `60eeeaa9-ab28` is the one PlayHQ credits with those games. Roughly
198 appearances sat on the wrong player, and `size-report` had been listing that alias third in its
"worst offenders" table for days.

**How much of the session was wasted, and on what.** Five diagnostics each had their own id comparison
and all five were wrong the same way (T37), producing a false split-identity finding and a false "185
pairs are two people". A five-hour audit resolved almost nothing because the session went stale and
only the main loop refreshed it (T39). Three separate tools aborted on their first line because the
report they read lived in a workflow artifact rather than the repo. Every one of those was the same
fault class fixed one instance at a time. The two checks now at the top of `claude_context.md` exist
to stop that, and they are checks to perform, not principles to hold.

---

## 2. SCRIPTS (`scripts/*.js`, `scripts/lib/*.cjs`)

All scripts use `const ROOT = path.join(__dirname, '..')`. CJS by default; ESM for
build-finals-stats, build-leaderboards, build-player-games, build-records (they use `import`).

### 2.1 Live pipeline (run on schedule / by the nightly chain) — KEEP

| Script | Purpose | Triggered by | Reads | Writes |
|---|---|---|---|---|
| `nightly-crawl.js` | Ingest new/changed games for active seasons; reclassify hidden; stub new players; flag stat-rechecks; **2026-07-21: `--rounds-forward=N|all` fetches future rounds (default 0); no-current-round grades fetch their first unsettled round** | nightly-crawl.yml (cron) | games/bv, data/sports-index.json, data/forfeit-games.json, players/indexes | games/bv/{sid}.json, players/{xx}/*, players/indexes/{xx}, `.nightly-status.json`, `needs-matrix-shards.json` |
| `fetch-profile-stats.js` | Fetch career/season stats per player for one shard; alias-aware; writes records field; **populates `player.name` from `publicProfile` (account tenant) when the name is missing / a placeholder / a season string** | fetch-profile-stats-matrix.yml, fetch-profile-stats.yml, add-player.yml | players/indexes/{xx}, players/aliases/{xx}, players/{xx}/*, data/sports-index.json, scripts/lib/* | players/{xx}/*.json, players/aliases/{xx} (new aliases), shard-summary-{xx}.json |
| `salvage-spectator-names.js` | ONE-TIME batched spectator-roster name salvage for placeholdered stragglers; `--plan` / `--shard=N` / `--reconcile`; per-game exhaustion — only confirms a placeholder when EVERY game was reached, never freezes on a transient miss | salvage-spectator-names.yml (dispatch) | players/{xx}/*, spectator.playhq.com | players/{xx}/*.json, players/indexes/{xx} (reconcile only) |
| `fold-diverged-players.js` | Move apiId-bearing player files to their api-id path; relocate index entries. **2026-09-01: the MERGE keeper changed.** It kept whichever record held more `games[]` entries — a captured-side count deciding ownership of credited-side data, and inverted in the population it meets (stub median 69 games, real profile 1). It now keeps whichever record actually holds stats, drops `statsChecked` on a tie so the next matrix run settles it, and dispatches a targeted re-fetch for those players. Run #77 rescued **533 of 541 merges** | fold-diverged-players.yml (matrix terminal / manual) | players/**, players/indexes | players/{xx}/*, players/indexes/{xx} (moves), refetch-shards.json |
| `discover-seasons.js` | Detect seasons/grades; burst+cursor shard mode; roster backfill | discover-seasons-matrix.yml, discover-seasons.yml, test-backfill.yml, diagnose-season-grades.yml | data/sports-index.json, data/discover-progress.json, players | data/sports-index.json, data/discover-progress.json, players/{xx}/*, `.discover-*-progress` |
| `build-team-stats.js` | Per-team season stats; --active-only for nightly. **Roster stats sourced from player reg stats (games/bv p[] has NO stat lines)** — hence the matrix-terminal trigger (§1.3). TRUNC_LEN import + placeholder fix 2026-07-21. **2026-07-29: gitCommit upgraded to the house pattern (was the last 10-attempt outlier, and it SWALLOWED total push failure); dead `p[]` loop removed** | nightly-crawl.yml, weekly-indexes.yml, build-team-stats.yml, **matrix terminal (2026-07-21)** | games/bv, players | team-stats/bv/{sid}.json |
| `build-player-games.js` (ESM) | Per-player game index | weekly-indexes.yml, build-player-games.yml | games/bv, players | players/**/*.json, `.build-player-games-progress.json` |
| `seed-apiid-from-playhq-pairs.js` | Writes `player.apiId` on wrongly-keyed players paired to an api id by PlayHQ, so the fold can rekey them. Refuses on surname disagreement and on an unusable name into a merge. **2026-09-01: the `stubWouldOverwriteRealProfile` refusal was REMOVED** — it existed only because the fold's keeper rule let a bigger stub replace a real profile, which is fixed; `keeperOutlook` now mirrors the new rule and its warning block is a drift tripwire that must read 0 | seed-apiid-from-playhq-pairs.yml (dispatch) | reports/wrongly-keyed-census.json, PlayHQ | players/{xx}/*.json (apiId only), reports/apiid-seed-log.json |
| `measure-credited-coverage.js` | READ-ONLY. Samples players, fetches PlayHQ's credited game list and buckets every captured-not-credited game: forfeit / already in `u` / not in games/bv / no-registration season / **residue**. Also partitions `u` by whether PlayHQ credits it. One report file per stratum. Aborts if captured and credited share zero game ids — an id-form mismatch, not a finding | measure-credited-coverage.yml (dispatch) | players/**, games/bv, data/forfeit-games.json, PlayHQ | reports/measure-credited-coverage-{stratum}.json |
| `audit-diff-fields.js` | READ-ONLY, one shard. Checks `sports.Basketball.c`/`.x` were written and that `gp - games[] == c - x` holds. **Excludes withheld players** — `markNotObtainable` never reaches `finishOk`, so the diff never runs for them and comparing their stale `gp` reports the audit's own missing-field handling as a fault | audit-diff-fields.yml (dispatch) | players/{xx} (sparse) | stdout only |
| `find-lost-stats-from-folds.js` | Finds player files whose stats a pre-2026-09-01 fold destroyed, and un-checks them for re-fetch. **Narrowed 2026-09-04**: private + merged + checked also matches the ordinary public→private transition, so a `gp-ratio` test now separates stale-but-present from actually-lost | find-lost-stats-from-folds.yml (dispatch) | players/** | players/{xx}/*.json (statsChecked only), reports/lost-stats-from-folds.json, refetch-shards.json |
| `find-misrouted-appearances.js` | Finds `x` games another PlayHQ profile of the SAME PERSON is credited for, names the alias that carried them, and repoints it. Attributes games per alias — an alias carrying even one credited game is held back. Also runs the box-score verdict on every genuine gap | find-misrouted-appearances.yml (dispatch) | players/**, players/aliases/**, games/bv, scripts/lib/* | players/aliases/{xx}.json (apply only), reports/misrouted-appearances.json |
| `revert-alias-repoints.js` | Restores the 117 alias entries changed by the 2026-09-05 12:31 apply run. Old values embedded from that run's own report; each re-checked against disk before restoring | revert-alias-repoints.yml (dispatch) | players/aliases (sparse) | players/aliases/{xx}.json |
| `requeue-repointed-players.js` | Clears `statsChecked` on BOTH sides of every alias repoint so their stale `c`/`x` rebuild, then dispatches the matrix at only their shards. ~48 fetches instead of the ~70,000 a forced shard sweep would cost | requeue-repointed-players.yml (dispatch) | reports/misrouted-appearances.json, players/** | players/{xx}/*.json (statsChecked only), refetch-shards.json |
| `discover-org-seasons.js` | TOP-DOWN season discovery: asks every org in sports-index what competitions and seasons it runs via `discoverCompetitions(organisationID)`, adds any season the index lacks. Sees UPCOMING seasons with ZERO registrations, which the bottom-up probe cannot. `--season=<id>` looks one up directly | discover-org-seasons.yml (daily cron + dispatch) | data/sports-index.json, PlayHQ | data/sports-index.json |
| `verify-outstanding-claims.js` | READ-ONLY. Re-measures every documented figure in OUTSTANDING_TASKS/README against the database and prints MATCHES or DRIFT. Claims that cannot be checked from files are printed as unmeasurable rather than omitted — an omitted claim looks verified | verify-outstanding-claims.yml (dispatch) | players/**, reports/ | stdout / --json |
| `size-locked-resweep.js` | READ-ONLY sizing: locked re-sweep call volume, regs-only teams, no-rn/pending re-measures, parse health | size-locked-resweep.yml | games/bv, players/indexes, data | /tmp report only |
| `size-appearance-gaps.js` | READ-ONLY sizing: PlayHQ `reg.stats.gp` (T20-deduped) vs local appearance counts — the residue measure. Independent sources, unlike the retired `size-missing-gids` (T24) | size-appearance-gaps.yml | games/bv, players, data | /tmp report only |
| `size-spectator-queue.js` | READ-ONLY sizing: DIRECT count of scored games with no player list, split `spc`-unset (fetch queue) vs `spc`-set (asked, empty) | size-spectator-queue.yml | games/bv, data | /tmp report only |
| `size-missing-gids.js` | ⚠️ RETIRED 2026-08-05 — TAUTOLOGICAL (compared `games[]` to its own source; always 0). Kept only as the worked example behind trap T24 | — | — | — |
| `rebuild-chain.yml` (workflow only) | One-off sequencer, nightly's shape: player-games → win-loss FULL → finals FULL → search → leaderboards force → Deploy Pages dispatch. Full-ancestry failure gates, start_at resume, workflow-level data-write lock. Ran green 2026-08-06 | — | — | dispatches only |
| `size-pages-artifact.yml` (workflow only) | READ-ONLY: per-directory raw + COMPRESSED artifact composition + largest files. The 2026-08-06 table: players 553M / games 260M / team-stats 159M / leaderboard 126M compressed | — | working tree | /dev/stdout |
| `size-locked-split.yml` (workflow only) | READ-ONLY diagnostic for the split: gzip-9 size of the three per-season dirs split by the `locked` flag. Measured 2026-08-07: locked share 81.2% (82.6/80.1/79.9). Reports MiB (reference table is decimal MB). First version aborted on the real index shape by design — refuses to guess | — | working tree, data/sports-index.json | /dev/stdout |
| `post-drain-chain.yml` (workflow only) | The nightly derived-data builds as SEQUENTIAL jobs under one workflow-level data-write acquisition (T19 structural fix, 2026-08-07): team-stats(--active-only) → venue-indexes → search → records → leaderboards(bare) → Deploy Pages dispatch; fold dispatched fire-and-forget after team-stats (queues behind the chain's lock as the lone waiter). Full-ancestry single-line gates, start_at resume, ref:main everywhere. Chain #1 green 38 min | — | — | dispatches only |
| `graduate-seasons.yml` (workflow only) | Season graduation (split): select (locked, no archivedAt, past `grace_days` — THE central grace variable, default 28), dispatch+poll archive deploy cross-repo (`ARCHIVE_DISPATCH_PAT`), probe every candidate LIVE, flip `archivedAt` (JOB-level data-write — the run waits ~40 min and a workflow-level lock would sit in T19's one-slot queue), dispatch Deploy Pages. `archivedAt` = VERIFIED FACT. Failed probes: flags stay unset, season keeps serving from ACTIVE, retried next nightly dispatch, status job RED. Graduation #1 green 2026-08-07 | — | data/sports-index.json | data/sports-index.json + dispatches |
| `spectator-backfill.js` | One-off/rerunnable: the nightly's spectator step over games with NO roster at all (locked seasons + tournaments the nightly never reached). 13 blocks byte-identical to nightly-crawl.js; skips statsChecked/reg-discovery by design; stubs+aliases new players; progress = spc:1 committed per 2,000 games. **Ran 2026-08-06: 7,844 filled / 15,928 spectator-dead / 1,095 stubbed. A second full pass returned 0/15,928 — the remaining queue is permanently dead; do NOT re-dispatch.** Games with ANY roster are LEFT ALONE — the 2.03M partial lists are not this tool's business | spectator-backfill.yml | games/bv, players, data | games/bv, players/**, indexes, aliases |
| ↳ *(2026-08-07/10 additions)* | `--include-partial` (widens the queue to partial-roster games — the re-sweep), `--min-age-days` (default 30; the guard is FRESHNESS, not lock status), `--miss-attempts` (default 1; durable `spcm` counter, retirement REVERSIBLE, measured retry conversion 0.003%), `--heal-dangling` (re-fetch spc games whose `p[]` has unresolvable ids), `--locked-only`. Player phase now runs PER COMMIT WINDOW (crash consistency); `p[]` replaced only when the id SET differs | | | |
| `build-win-loss.js` | Win/loss records per player; --active-only nightly, full weekly. **2026-08-04: career totals deduped once-per-(sid,tid) in BOTH modes (T20 — per-reg iteration doubled every regraded career; deltas compounded nightly). FULL run required once to repair stored values** | nightly-crawl.yml, weekly-indexes.yml, build-win-loss.yml | games/bv, players | players/**/*.json |
| `build-leaderboards.js` (ESM) | All-time + per-season leaderboards. ⚠️ CORRECTED 2026-08-07: the nightly/chain run is BARE (resume, FULL scope) — the old "--active-only nightly" claim here was FALSE (the terminal's `force=false` dispatch adds no flags; the live workflow's header even corrects an older version of the same claim). `--active-only` belongs to the WEEKLY finals chain only | post-drain-chain (bare), weekly finals chain (--active-only), build-leaderboards.yml | players/**, games/bv | leaderboard/*, `.build-leaderboards-progress.json` |
| `build-search-index.js` | Player search index shards | post-drain-chain, build-search-index.yml | players/**, players/indexes | search/players/{xx}.json |
| `build-records.js` (ESM) | Single-game records | post-drain-chain, build-records.yml | games/bv, players | records/*, `.records-progress.json` |
| `build-finals-stats.js` (ESM) | Finals/GF apps+wins per player; resolver-aware. **2026-08-05 (v3): career `finalsStats={gp,boxedGp,pts,threePt,fouls,wins,losses,draws,gids}` + per-reg `fstats={gp,bg,pts,tp,f,w,l,d,g}`. Finals W/L from scores+side; `boxedGp` is the scoring denominator (box lines exist for ~0.15% of games); `gids` let StatTrack hydrate finals scoring client-side from the Worker. Forfeits excluded from finals GP. Appearance basis p[]∪hp∪ap. NO PROGRESS FILE (T22 — the old committed map hit 110MB); push fails fast on size rejections. KNOWN DEFECT: accumulator keyed per SID, so finals flags land on every reg in a season — see OUTSTANDING §2.4** | build-finals-stats.yml | games/bv, team-stats/bv, players | players/**/*.json |
| `build-venue-indexes.js` | Date→venue and season→venue indexes | post-drain-chain (moved from nightly 2026-08-07), build-venue-indexes.yml | venue-lookup, games/bv | date-venue-index/*, data/season-venue-index.json |
| `update-team-index.js` | Add AND correct data/team-index.json entries. ⚠️ **Input corrected 2026-09-08: it reads `players/indexes/` and the player files' `seasons[].regs[]`, NOT `team-stats/bv`** — it never opens team-stats. | nightly team-index job, update-team-index.yml | team-stats/bv | data/team-index.json |
| `update-venue-lookup.js` | Refresh venue-lookup shards | nightly venue-lookup job, update-venue-lookup.yml | games/bv, venue-lookup | venue-lookup/* |
| `scripts/lib/uuid-prefix.cjs` | Single source of truth for TRUNC_LEN (13), isFullUuid, isTruncatedPrefix, alias-aware resolver (index-first → alias trunc13+legacy-10 → self-wins) | required by many | — | — |
| `scripts/lib/namespace-resolve.cjs` | PlayHQ recovery queries + matchers; normName (OLD form, no NFKC); isPlaceholderName (canonical `Player #` test) | fetch-profile-stats, backfill, diagnostics | — | — |

### 2.2 On-demand tools (keep; not scheduled) — TOOL

| Script | Purpose | Reads | Writes |
|---|---|---|---|
| `probe-unresolved-aliases.js` | **Alias audit, tier 4.** For the 40 nothing settled, prints PlayHQ's box-score name, jersey number and TEAM per game, against every candidate's registration for that season. One screen each | reports/shared-name-alias-audit.json, PlayHQ spectator | reports/unresolved-alias-audit.json (COMMITTED) |
| `probe-selfalias-check.js` | Asks whether deleting a self-redirecting alias is safe: does a player file exist for the full uuid? OFFLINE | reports/unresolved-alias-audit.json, players | — |
| `seed-missing-profiles.js` | Seeds a player file + index entry from `publicProfile`, THEN deletes the alias. ⚠ Built on a premise that proved WRONG (T41) — the 40 ids are spectator-namespace and `publicProfile` returns NOT_FOUND, so it correctly seeded NOTHING. Retained for a genuine case | reports/unresolved-alias-audit.json, PlayHQ | players/, players/indexes/, players/aliases/ |
| `probe-alias-credits.js` | **Alias audit, tier 1.** Does the target profile CREDIT the games each alias delivers? All 81,685 name-matched entries, 2026-08-24: 77,142 supported (98.9%), 874 not. Resumes from a COMMITTED cache; refreshes the session on a cycle (T39) | players/aliases, games/bv, PlayHQ | reports/alias-credit-audit.json + caches (COMMITTED) |
| `probe-alias-names.js` | **Alias audit, tier 2.** For those the credit test could not settle, asks the SPECTATOR box score who the id actually IS. 739 name agrees (652 settled, 87 shared-name), 0 genuine disagreements | reports/alias-credit-audit.json, PlayHQ spectator | reports/alias-name-audit.json (COMMITTED) |
| `probe-shared-name-aliases.js` | **Alias audit, tier 3 — OFFLINE.** For names SEVERAL players share, which candidate held a registration for that game's SEASON to one of the two teams playing it? 24 confirmed, 23 repoint, 4 ambiguous, 36 none-fit | reports/alias-name-audit.json, players, games/bv | reports/shared-name-alias-audit.json ⚠️ artifact only |
| `repoint-aliases.js` | Applies confirmed repoints. Merges ALL THREE report sources, RE-VERIFIES every one against PlayHQ at apply time, records before/after BEFORE writing. 88 applied 2026-08-24 | the three reports, players/aliases | players/aliases, reports/alias-repoint-log.json |
| `probe-verdict-conflict.js` | **Settles the two-audit disagreement.** Splits each "two people" verdict by whether each side appears under its OWN id or only via an ALIAS — a verdict resting on our own alias is circular (T38) | reports/both-resolve-pairs.json, players/aliases, games/bv | reports/verdict-conflict-audit.json ⚠️ artifact only |
| `trace-player-game.js` | Traces ONE value: for each game in a player's games[], prints every roster id and its alias target, so "how did this get here" is answered by inspection not inference | players, players/aliases, games/bv | — |
| `scan-roster-id-forms.js` | Counts p[] ids by length and finds rosters listing the same person under BOTH forms. 2026-08-24: 99.24% truncated, 0.76% full, ZERO double-listed (T37) | games/bv | — |
| `probe-my-aliases.js` | Checks whether aliases written by a given merge deliver appearances their target is registered for | players/aliases, players, games/bv | reports/ ⚠️ artifact only |
| `fix-merge-aliases.js` | Recovers the exact set of alias entries a merge added by DIFFING GIT HISTORY, then verifies each against PlayHQ before removing any | git history, players/aliases, PlayHQ | players/aliases, reports/removed-merge-aliases.json |
| `db-audit.js` | Full DB audit + repo size + repo-hygiene (§11b: orphan progress files, stray reports) — READ-ONLY, flags only | whole tree | reports (audit only) |
| `diagnose.js` | General player/stats/hidden/game inspector (mode+arg) | targeted | diagnose-{arg}.json (artifact) |
| `diagnose-nightly-health.js` | Inspect last N nightly runs via Actions API | Actions API | — |
| `diagnose-id-field-lengths.js` | ID-length histogram in games/bv (checks for any lingering 10-char legacy ids) | games/bv, players/indexes | — |
| `audit-uuid-collisions.js` | Prefix-collision counter at --len=N (10 vs 13) | players/indexes | reports/uuid-collisions-len{N}.json |
| `recheck-forfeit-games.js` | Re-verify forfeit game records | games/bv | games/bv/{sid}.json |
| `recheck-private-profiles.js` | Monthly re-probe of private profiles | players | players/**/*.json |
| `find-players-by-team.js` | Player search by team/season/grade | players, scripts | — (report) |
| `find-flag-collisions.js` | Find flag collisions in games (until 49 resolved) | games/bv | — (report) |
| `clear-stats-checked.js` | Clear statsChecked to force re-fetch (--fix-corrupt-names path is dead) | players | players/**/*.json |
| `discover-game-backfill.js` | **SECOND roster capture path (2026-08-11).** Walks games spectator retired (`spcm` set, no `spc`), asks `api.playhq.com/graphql` `gameView` → `discoverGame` — the CANONICAL record, which holds paper-scored games spectator never had — and writes the same bare-id `p[]` plus `dg: 1`. Never writes `spc`, never touches `spcm`; own permanent failures → `dgm`. Query embedded VERBATIM from a browser capture, untrimmed. Profiles arrive as full uuids WITH names, so stubs are born named | api.playhq.com | games/bv, players/ | games/bv, players/ |
| `size-negative-gap.yml` (workflow only) | READ-ONLY, offline: players whose `games[]` exceeds the appearances PlayHQ credits. Separates candidate causes by provenance and flags duplicate season registrations. ⚠ Does NOT yet read the `private` flag, so it ranks private profiles as offenders and its `dg`-share conclusion line is worded backwards (OUTSTANDING §2.17) | — | games/bv, players/ | /dev/stdout |
| `size-misses.yml` (workflow only) | READ-ONLY anatomy of spectator misses: totals, per-year coverage, `profileOnly` share, and the clustering diagnostic (DEAD / MIXED / COVERED seasons) with sample game-centre URLs for spot-checking | — | games/bv, sports-index | /dev/stdout |
| `probe-player.js` | READ-ONLY single-player reconciliation against the profile API: every credited game classified ok / NOT-IN-P[] (with alias verdict) / GAME-ABSENT, per-season rollup, recovery estimate. Blocks verbatim from `probe-missing-games.js` | api.playhq.com | games/bv, players/, sports-index | /dev/stdout (no writes) |
| `repair-player.js` | Targeted per-player roster repair: appends the player + stat line to held games whose roster genuinely lacks them. **Alias-gated per game** — GENUINELY-ABSENT only; PRESENT-as-alias / PRESENT-legacy are fold problems where appending would DUPLICATE. Dry-run default; archive redeploy at tail | api.playhq.com | games/bv, players/ | games/bv |
| `repair-players-batch.js` | The same repair driven down a self-computed gap ranking (`--min-gap`). Progress file `reports/repair-batch-progress.json` committed every 25 players; dead profiles recorded and never retried; resume = re-dispatch. `gitCommit` verbatim from nightly-crawl.js | api.playhq.com | players/, games/bv | games/bv, reports/ |
| `synthesize-missing-games.js` | One-off (re-runnable) writer for games absent from games/bv entirely but proven by profile responses — writes `profileOnly` entries (no d/vid/hs/as: the profile carries none). Applied 2026-08-07: 9 synthesized + 69 appends to pre-existing profileOnly entries, 17 files | api.playhq.com | games/bv | games/bv |
| `size-gap-players.yml` (workflow only) | READ-ONLY, offline, zero API calls: per-player appearance-gap distribution (profile `gp` minus `games[]` length) with severity buckets and the worst 20 by name. ⚠️ Read ONLY after a `build-player-games` rebuild — its two inputs update on different clocks | — | players/ | /dev/stdout |
| `size-resweep.yml` (workflow only) | READ-ONLY: sizes the spectator re-sweep target (FINAL, partial pre-spc `p[]`, no `spc`) with a per-year breakdown. Baseline 2026-08-07: 2,026,441 games, avg 12.8 ids | — | games/bv | /dev/stdout |
| `scan-complete-rounds.js` | Backfill roundsComplete markers; --unlock reopens locked seasons AND clears `archivedAt` in the same write (split invariant, 2026-08-07) + prints the T23 deploy reminder | games/bv, data/sports-index.json | games/bv, data/sports-index.json |
| `discover-fixtures.js` | **Full-fixture tool via discoverTeamFixture (returns ALL rounds incl. FUTURE)**: `--all-seasons`/`--season` historical backfill + `--current-only` weekly future-fixtures mode (skips seasons with no game in 21 days). ⚠️ **staging bug — recorded here as "fixed 2026-07-21"; the deployed file did NOT have the fix. Corrected 2026-07-31 by reading it AND by reproducing the failure with its exact pathspec list.** One combined `git add` with any unmatched pathspec stages NOTHING (atomic), silently discarding a whole green run (30,426 games, 2026-07-19). ACTUALLY fixed 2026-07-31: per-path adds, `staging:` shortstat, inline identity, fail-fast on non-contention, THROW on exhaustion, and `cwd: ROOT` (which was missing entirely — it relied on `process.cwd()`). Candidate for a weekly cron (§6.8 pending decision). | games/bv, venue-lookup, data | games/bv/{sid}.json, venue-lookup/*, discover-fixtures-progress.json, zero-team-seasons.json |
| `find-code-refs.js` | *(no script — inline grep in `find-code-refs.yml`)* grep over scripts/ + .github/workflows/. **Exists because GitHub REFUSES to index this repo for code search** ("cannot be searched because it is too large", 6.13 GB, 2026-07-31) and returns "0 files" for every query, which is indistinguishable from "no matches". Scope hard-coded so it can never be aimed at games/ or players/ | scripts/, .github/workflows/ | — (report) |
| `audit-seasons-gaps.js` | READ-ONLY. Duplicate regs split by grade (regrade / null-gid / exact), regs missing gid, and the seasons[] gap across ALL games with an active/locked split | players/, games/bv, data/sports-index.json | — (report) |
| `repair-reg-sibling-sync.js` | ONE-OFF: makes regs sharing a (season, team) hold identical stats. Per-key MAX; idempotent; aborts if any value would decrease or a reg count changes. `--core-only` limits it to leaderboard-visible fields | players/ | players/{xx}/*.json |
| `repair-duplicate-regs.js` | ONE-OFF: merges regs duplicating the same `(tid, gid)`. Max-per-key merge; REFUSES groups where a shared key holds different values on every copy. Does NOT touch regrades or null-gid regs | players/ | players/{xx}/*.json |
| `build-search-index.js` shardKey v2 (2026-08-02) | Folds accents to base letters BEFORE stripping non a-z (Álvarez -> 'al', was 'lv'); stale cleanup deletes ANY shard the rebuild didn't produce (was hex-only — the gap that preserved 135 migrate-phase3 orphans for two months). Must stay identical to StatTrack searchPlayers' shard expression | players/indexes, players/ | search/players/{xx}.json |
| `size-opposition-index.js` | READ-ONLY sizer that retired the opposition-index builder: full-fidelity pass (build-win-loss classification), interned-pair accumulation, real serialized sample shards. Measured 2026-08-02: 16.2M pairs, 1,001.4 MB projected — not built. Re-runnable if the question reopens | players/, games/bv | — (report) |
| `db-audit.js` §11b (2026-08-02) | Hygiene rows show SIZE (files) / ENTRY COUNT (dirs), not age — mtime is checkout time in CI and git-log ages collapse at fetch-depth:1 | scripts/, reports/ | — (report) |
| `repair-legacy-flags.js` | ONE-OFF: deletes stale `legacy` from games where the flag is FALSIFIED — a score OR `st === 'UPCOMING'` (2026-08-02; strict equality, absent st clears nothing). Guards: per-game key diff, per-file game-count guard, full disk post-check before commit. `--dry-run`/`--season`/`--limit`. Applied 08-01 (3,114) and 08-02 (139); legacy population now exactly 3 | games/bv | games/bv/{sid}.json |
| `diagnose-forfeit-game.js` | READ-ONLY probe: one game's discoverGame result vs its stored record; verdict on fo-vs-scoreline (fo = WINNER id). Plumbing verbatim from recheck-forfeit-games.js; refuses to guess when the API returns no usable winner | games/bv, API | — (report) |
| `repair-forfeit-score.js` | ONE-OFF: rewrites hs/as of a single forfeit to winner-20/loser-0, winner derived from the record's OWN fo (never an input). Refuses non-forfeits and unusable fo; idempotent; key-diff + count + disk post-check. Closed ba9d21fe 2026-08-02 | games/bv | games/bv/{sid}.json |
| `probe-api-limits.js` | AIMD/endurance API concurrency probe | — (API) | — |
| `test-api.js` | API smoke test (concurrency/profile/game/schema/gps/fixture) | — (API) | — |
| `report-alias-index.js` | Read-only tally over players/aliases | players/aliases | reports/alias-index-report.json |
| `verify-enrich.js` | Read-only validity scan of every player file | players | reports/verify-enrich-report.json |
| `verify-p-redundancy.js` | One-off p[] redundancy diagnostic (run to close open Q) | games/bv | p-redundancy-examples.json (artifact) |
| `restore-deleted-file.js` | Restore a file from git history | git history | the restored file |
| `count-stats-checked.js` | Count statsChecked across player files | players | — |
| `find-root-json-refs.js` | *(inline in yml, no script)* grep root-json references | — | — |

### 2.3 Removed in cleanup (commit `fe8eedb`, 2026-07-16)

The api-canonical migration one-offs, the concluded diagnostics, the superseded proxy
cluster (`fetch-player-profiles.js`, `test-failed-uuids.js`), and the dead team-search
cluster (`search-team-stats.js`) have all been **deleted** from the repo. They are recoverable
from git history (parent commit `1faecc5`) if ever needed. The *knowledge* from the deleted
diagnostics is preserved in §6.7. There is no remaining "to delete" list — the cleanup is done.

`scripts/lib/uuid-prefix.cjs` and `scripts/lib/namespace-resolve.cjs` are the only libs; both KEEP.

## 3. WORKFLOWS (`.github/workflows/*.yml`)

### 3.1 Live / scheduled — KEEP
| Workflow | Trigger | Runs | Notes |
|---|---|---|---|
| `nightly-crawl.yml` | cron daily 15:00 UTC + dispatch | nightly-crawl.js + chains 6 downstream jobs | data-write lock; the heart. No setup-node in crawl (fetches PlayHQ). |
| `weekly-indexes.yml` | cron Sun 02:00 UTC + dispatch | build-team-stats, build-player-games, build-win-loss(full) | ~~FIX: player-games safety-net step~~ — **DONE 2026-07-16 (§6.1); marker was stale, cleared 2026-07-29** |
| `recheck-private-profiles.yml` | cron monthly + dispatch | recheck-private-profiles.js | — |
| `fetch-profile-stats-matrix.yml` | dispatch (by nightly / add-player / self) | fetch-profile-stats.js × 256; terminal fold+rebuilds+**team-stats (2026-07-21)** | git-add fixed 07-16; stop-button fixed 2026-07-21 (apply/summary gates → `!cancelled()`) |
| `discover-seasons-matrix.yml` | dispatch (by nightly Sundays / self) | discover-seasons.js × shards | setup-node STRIPPED from map+reduce 2026-07-21 (§6.3 resolved); Sunday trigger now backfill_teams=true; **2026-08-03: debug scaffolding stripped (VERBOSE block + verify-output job), self-retrigger on the retry helper, reduce/retrigger gates `!cancelled()`, dry_run gate on the robust boolean form — see §6.24** |
| `fold-diverged-players.yml` | dispatch (by matrix terminal) | fold-diverged-players.js | clean; event-driven only |
| `fetch-profile-stats.yml` | dispatch | fetch-profile-stats.js (single shard) | manual escape hatch |
| `measure-credited-coverage.yml` | dispatch | measure-credited-coverage.js | READ-ONLY; own concurrency group |
| `audit-diff-fields.yml` | dispatch | audit-diff-fields.js | READ-ONLY; sparse checkout is correct here — one shard, ~1,600 files |
| `find-lost-stats-from-folds.yml` | dispatch | find-lost-stats-from-folds.js | data-write; report committed in BOTH modes |
| `find-misrouted-appearances.yml` | dispatch | find-misrouted-appearances.js | data-write in apply mode; writes aliases |
| `revert-alias-repoints.yml` | dispatch | revert-alias-repoints.js | data-write; sparse (aliases only) |
| `requeue-repointed-players.yml` | dispatch | requeue-repointed-players.js | data-write; dispatches the matrix at the affected shards, force NOT set |
| `discover-org-seasons.yml` | cron 19:00 UTC daily + dispatch | discover-org-seasons.js | data-write; mode resolves to APPLY on a schedule (T40) |
| `verify-outstanding-claims.yml` | dispatch | verify-outstanding-claims.js | READ-ONLY; own concurrency group |
| `add-player.yml` | dispatch | inline stub + trigger matrix for shard | ~~FIX: git stash~~ — **DONE 2026-07-16 (§6.1 item 3): stash replaced with write→add→commit→fetch→merge -X ours→push. Marker was stale, cleared 2026-07-29.** Explicitly kept per cleanup-repo |

### 3.2 Build triggers (manual full rebuilds) — KEEP (safety-net strip COMPLETE, see §6.1)
`build-team-stats.yml` (clean, model; **data-write lock added 2026-07-21** — was the only team-stats writer outside it), `build-search-index.yml` (clean), `build-win-loss.yml` (clean),
`build-finals-stats.yml` (clean — the ⚠ previously recorded here was stale, its deployed YAML had no
safety-net step; 2026-07-21 second session: **data-write lock** + `chain_leaderboards` input + chain job),
`build-leaderboards.yml` (clean — same stale ⚠; 2026-07-21: `active_only` input added, fictional
"nightly calls --active-only" header corrected),
`build-player-games.yml`, `build-venue-indexes.yml`, `build-records.yml` — all clean.
(The ⚠ markers here flagged the `if: always()` + `git pull -X ours` safety-net step. §6.1 records it
REMOVED from all 6 build workflows and deployed on 2026-07-16; the markers were never updated and
sent readers hunting for bugs that no longer existed. Cleared 2026-07-29.)

### 3.3 On-demand tools — KEEP
`db-audit.yml`, `diagnose.yml`, `diagnose-nightly-health.yml`, `diagnose-id-field-lengths.yml`,
`audit-uuid-collisions.yml`, `recheck-forfeit-games.yml`, `find-players-by-team.yml`,
`find-flag-collisions.yml`, `find-root-json-refs.yml` (inline grep), `clear-stats-checked.yml`,
`scan-complete-rounds.yml`, `size-locked-split.yml` (read-only split diagnostic, 2026-08-07),
`probe-api-limits.yml`, `test-api.yml`, `report-alias-index.yml`,
`verify-enrich.yml`, `verify-p-redundancy.yml`, `restore-deleted-file.yml`, `count-stats-checked.yml`,
`update-team-index.yml`, `update-venue-lookup.yml`, `build-team-stats.yml`,
`find-code-refs.yml` (inline grep — the GitHub-code-search replacement), `repair-legacy-flags.yml`
(one-off, `data-write` lock, dry-run default), `generate-roster.yml`,
`diagnose-forfeit-game.yml` (read-only probe, no lock, sparse OK — reads ONE season file),
`repair-forfeit-score.yml` (one-off, `data-write` lock, dry-run default via `apply` boolean).

### 3.4 Removed in cleanup (commit `fe8eedb`, 2026-07-16)

All migration/one-off/throwaway workflows were **deleted** (rekey-*, repair-*, reconcile,
backfill-* one-offs and matrices, recover-uuids, resolve-known-collisions, strip-redundant,
migrate-*, fix-* one-offs, classify-flagged-merges, build-alias-index-matrix, build-alias-inverse,
commit-cleared-names, find-team-players, fetch-player-profiles, reorganise-repo, db-report,
hold-check, diagnose-season-grades, and every concluded diagnose-* workflow). Recoverable from
git history. The two migration matrix templates are gone; the live `fetch-profile-stats-matrix.yml`
is the reference self-triggering-matrix shape going forward.

## 4. JSON / DATA FILES — WRITER → READER GRAPH (derived mechanically)

### 4.1 Live data files (KEEP — actively read and written)
| File | Written by | Read by | Needed? |
|---|---|---|---|
*(Game-entry capture flags, 2026-08-11 — three distinct facts, keep them distinct: `spc:1` roster captured from the LIVE-SCORING service; `spcm:N` that service was asked and could not serve it; `dg:1` roster captured from the CANONICAL record; `dgm:N` the canonical record permanently failed. A game may legitimately carry `spcm` AND `dg`. Any "already captured" check must test `spc` OR `dg`.)*

| `data/sports-index.json` | discover-seasons, scan-complete-rounds, graduate-seasons (`archivedAt`, 2026-08-07) | nightly-crawl, discover-*, fetch-profile-stats, build-*, deploy-pages strip, deploy-archive-pages (archive repo), StatTrack routing, many | **YES — master season registry.** Per-season flags: `locked`/`lockedAt` (crawl state) + `archivedAt` (VERIFIED live on the archive origin; set only by graduate-seasons after probing; cleared with locked by --unlock) |
| `data/discover-progress.json` | discover-seasons (matrix reduce) | discover-seasons, discover-seasons-matrix (generate-shards) | YES — discovery resume state |
| `data/team-index.json` | update-team-index | StatTrack, db tools | YES |
| `data/forfeit-games.json` | nightly-crawl, recheck-forfeit-games | nightly-crawl, fetch-profile-stats, add-player | YES |
| `data/venue-index.json` | **build-venue-indexes** (added 2026-09-08 — it had NO writer at all before that; "(venue build)" was a placeholder, see T56) | StatTrack | YES |
| `data/season-venue-index.json` | build-venue-indexes | StatTrack | YES |
| `players/indexes/{xx}.json` | nightly-crawl, fetch-profile-stats, fold, backfill | resolver (uuid-prefix.cjs), everything | **YES — the player index (256 shards)** |
| `players/aliases/{xx}.json` | fetch-profile-stats, build-alias-index(migration) | resolver alias fallback | **YES — spectator→api redirects (~43k)** |
| `players/{xx}/{uuid}.json` | nightly-crawl, fetch-profile-stats, build-*, fold | StatTrack, all builds | **YES — the player files (~411k)** |
| `games/bv/{sid}.json` | nightly-crawl (Phase 2), discover-fixtures (historical-backfill TOOL) | everything | **YES — the game data** |
| `team-stats/bv/{sid}.json` | build-team-stats | build-finals-stats, update-team-index, StatTrack | YES |
| `leaderboard/*.json` | build-leaderboards | StatTrack | YES |
| `search/players/{xx}.json` | build-search-index | StatTrack search | YES |
| `records/*.json` | build-records | StatTrack | YES |
| `date-venue-index/{date}.json` | build-venue-indexes | StatTrack | YES |
| `venue-lookup/*` | update-venue-lookup, discover-fixtures (tool) | build-venue-indexes | YES |
| `explore-results/` (1.34 MB) | *(ad-hoc, historical)* | — | **KEEP** — output of exploratory API calls made while developing the tooling. Retained as reference for when the docs are unclear. Classified 2026-07-31; previously undocumented. |
| `roster-results/` (216 KB) | *(ad-hoc, historical)* | — | **KEEP** — output of grade-roster lookups. NOTE: `generate-roster.yml` does NOT produce it (that workflow only prints to the job log), so the writer is historical. Classified 2026-07-31. |
| `index.html` (repo root, 127 KB) | *(manual)* | GitHub Pages | **KEEP — MIRROR of `markjovic/stattrack/index.html`.** ⚠️ `markjovic/stattrack` is CANONICAL; this copy must be updated in the same pass or it drifts. Pages serves this repo, so a stale mirror is a stale LIVE app, not just a stale file — the same drift class already open on the fixture generator and the dashboard. Classified 2026-07-31. |
| `zero-team-seasons.json` | discover-fixtures.js | *(none — report)* | YES. ⚠️ OUTSTANDING_TASKS §1.2/§2.3 claimed this "appears nowhere in REPO_MANIFEST". It always did — §2.2 above lists it as a discover-fixtures output and §6.8 names it in the staging-bug pathspec. |

### 4.2 Transient runtime signals (KEEP — short-lived, regenerated)
| File | Written by | Read by | Notes |
|---|---|---|---|
| `.nightly-status.json` | nightly-crawl.js | nightly-crawl.yml status step | Per-run; regenerated each run |
| `needs-matrix-shards.json` | nightly-crawl.js | **nightly-crawl.yml status step (counts length → stats_rechecks)**, profile-stats-matrix trigger | **IS READ — deleting it makes rechecks read 0** (corrects earlier "dead file" claim). Deleted on success by nightly-crawl.js. |
| `matrix-force-pending.json` | (matrix force path) | fetch-profile-stats-matrix.yml (deletes on stuck) | Force-run signal |

### 4.3 Removed in cleanup (commit `fe8eedb`, 2026-07-16)

The migration report JSON (`reports/rekey-merges.json`, `reconcile-people.json`, `alias-repair.json`,
`rekey-flagged-classified.json`, `alias-index-report.json`, `uuid-recovery-misattribution-audit.json`,
`backfill-missing-players-report.json`, `missing-player-files-diagnosis.json`), the entire
`reports/backfill-collisions/` directory (256 shards), `players/alias-inverse/` (256 shards), and the
orphaned `scripts/.*-progress.json` dotfiles were all **deleted**. `reports/verify-enrich-report.json`
remains (it is regenerated by the live verify-enrich tool).

**Note on `players/aliases/`:** this is LIVE and was NOT deleted — it holds the ~43k spectator→api
redirects the resolver depends on. It is now maintained solely by `fetch-profile-stats.js` (which
writes new alias discoveries) and consumed by the alias-aware resolver. The migration-era builders
of it (`build-alias-index.js`, `build-alias-inverse.js`) are gone, so there is no longer any tool
that rebuilds `players/aliases/` from scratch — if a full rebuild is ever needed, it must be written
fresh, sourcing `player.spectatorIds[]` (see §6.7 namespace-divergence note).

## 5. PROGRESS FILES (resumable checkpoints — delete-on-SUCCESS only)

**Verified mechanically:** all 14 progress-file owners call `unlinkSync` gated on the success/allDone
path (or `--force` reset), never in an error handler. A progress file surviving a crash is CORRECT —
that is what enables resume. The standard is **delete on success only**; never treat a surviving
progress file as garbage without checking whether its owner is mid-run.

| Progress file | Owner | Deletes on |
|---|---|---|
| `.build-leaderboards-progress.json` | build-leaderboards.js | success (+ --force reset) — TRUE ONLY SINCE 2026-07-21: the pre-fix script never deleted it, so completed runs silently no-op'd later runs; also mode-keyed now |
| `.build-player-games-progress.json` | build-player-games.js | success |
| `.finals-progress.json` | build-finals-stats.js | success — mode-keyed 2026-07-21 (active/full progress never cross-resumes) |
| `.records-progress.json` | build-records.js | success |
| `discover-fixtures-progress.json` | discover-fixtures.js (TOOL — kept) | success |
| `data/discover-progress.json` | discover-seasons.js | success (allDone) / --fresh_start |

db-audit.js §11b classifies any dotfile-progress in scripts/ as **orphan** (owner deleted → safe remove)
vs **owner-exists** (mid-run / crashed / failed self-clean → surface, never auto-delete).

---

## 6. KNOWN ISSUES & OPEN DECISIONS

### 6.1 Live workflow bugs — FIXED & DEPLOYED (2026-07-16)
All three are resolved in the repo:
1. **Safety-net `git pull -X ours` + `if: always()` step — removed from all 6 build workflows**
   (`weekly-indexes.yml` player-games job, `build-player-games.yml`, `build-finals-stats.yml`,
   `build-venue-indexes.yml`, `build-records.yml`, `build-leaderboards.yml`). Each script already
   commits cleanly, so the redundant step was deleted.
2. **`fetch-profile-stats-matrix.yml`** apply-and-commit `git add -A` → explicit `git add players/ scripts/`.
3. **`add-player.yml`** `git stash`/`stash pop` → write→add→commit→fetch→merge -X ours→push (no stash).
Also deployed: `weekly-indexes.yml` now has a `fold-diverged` backstop job (triggers the fold after its
player-writing jobs, as insurance against a broken matrix retrigger chain — see §6.2); and the
`probe-setup-node-fingerprint` test workflow (see §6.3).

### 6.2 The FOLD reliability question (corrected — see §1.3)
The fold IS wired into the nightly path: the matrix preserves its targeted shards across self-retriggers,
runs its chain to `stuck` (3 consecutive zero-written runs), and fires the fold at the drain-end of each
nightly cycle. So it is NOT a missing-trigger problem (earlier overstatement retracted).
The residual concern is reliability of the multi-dispatch retrigger chain: each retrigger is a separate
`gh workflow run`, so a single failed dispatch breaks the chain before `stuck` and skips the fold for
that cycle. **HARDENING APPLIED (2026-07-16):** option (b) is now built — `weekly-indexes.yml` has a `fold-diverged`
job that triggers `fold-diverged-players.yml --mode=apply` after its player-writing jobs (needs:
team-stats, player-games, win-loss). The fold is idempotent, so this weekly sweep is a no-op when the
nightly chain already folded, and catches anything a broken retrigger chain skipped. Also added:
`probe-setup-node-fingerprint.yml` (+ .js) — a controlled test for the setup-node question (§6.3).

### 6.3 The setup-node × PlayHQ-fetch contradiction — RESOLVED 2026-07-20/21
The rule is CONFIRMED and ABSOLUTE, scoped **per JOB** (not per workflow). Evidence: the
discover-seasons matrix failed session acquisition on every shard for ~10 days; instrumented
per-attempt logging (added to `discover-seasons.js` 2026-07-20) showed `HTTP 403 CLOUDFRONT-BLOCK
(919b HTML)` on attempt 1 from a fresh runner WITH setup-node, while the same-day nightly-crawl
(no setup-node) refreshed its session on attempt 1. A block on request #1 from a zero-traffic IP is
a fingerprint rule, not rate-based. The old "working counterexamples" were environmental and expired
~2026-07-10 (runner image or WAF rule change) — the matrix worked WITH setup-node until ~07-09.
Per-JOB scope proven by `nightly-crawl.yml`'s `win-loss` job, which carries setup-node harmlessly
(build-win-loss.js makes no PlayHQ calls). **Fixed:** setup-node stripped from
`discover-seasons-matrix.yml` (map + reduce — reduce also fetches PlayHQ via discoverSeason) and
standalone `discover-seasons.yml`. `probe-setup-node-fingerprint.yml` (+ .js) is now redundant —
deletion candidate. The per-attempt session instrumentation stays (permanently useful).

### 6.4 Cleanup — DONE (commit `fe8eedb`, 2026-07-16)
The repo cleanup ran live: 111 obsolete files deleted (migration one-offs, concluded diagnostics,
superseded clusters, orphaned progress dotfiles, migration reports, alias-inverse + backfill-collisions
dirs). Restore point: parent commit `1faecc5`. `discover-fixtures.js` was confirmed LIVE (the
`--all-seasons` historical-backfill tool) and kept; `build-foulout-stats.js` was confirmed not-live
and deleted. No outstanding deletions remain.


### 6.5 Data-quality caveats (record; not blocking)
- **p[] recovery misattribution:** `recover-uuids-from-git-history.js` paired p[] slots by array index
  across months; the spectator API doesn't preserve order, so some recovered p[] ids landed on the wrong
  person (Jack Delaney `0000ed35` case). Canonical player data is UNAFFECTED (migration re-fetched records);
  the caveat is scoped to `games/bv` p[] provenance only.
- **normName never upgraded to NFKC at runtime:** rekey-plan's matching used NFKC, but runtime writers
  (fetch-profile-stats via namespace-resolve.cjs, nightly) and StatTrack still use the OLD normName
  (lowercase + collapse-space + trim). Open item #6.

### 6.6 Other outstanding (from prior sessions, still open)
- ~~Add `--active-only` to `build-finals-stats.js`~~ **DONE 2026-07-21 (second session)** — and the premise
  was wrong: BOTH scripts already parsed the flag; finals' implementation was DESTRUCTIVE (never ran live —
  fixed before first use) and leaderboards' was sound but its progress file never self-cleared. See §6.9.
  (The parallel foulout chain is not pursued — build-foulout-stats.js was deleted.)
- ~~`playhq_api_reference.md` correction: `gradePlayerStatistics` pagination~~ **DONE** — the reference now
  documents `filter.pagination {page,limit}` with `meta.totalPages/totalRecords` (verified live grade c952bf59).
  **CORRECTED 2026-07-29:** this previously claimed the `publicProfile` endpoint (account tenant, id→name) and the `seasonStatistics[0].name` season-label correction had been ADDED to `playhq_api_reference.md`. Neither had — the word `account` appeared zero times in that file and the season-name bug was still documented as CORRECT in three places. Both were actually written on 2026-07-29, copied from the deployed `fetch-profile-stats.js` (§6.10).
- ~~StatTrack (`index.html`, Beta 0.58): confirm private-boolean + alias-index resolution~~ **DONE (Beta 0.61,
  July 2026):** checks the `player.private` boolean (grey PRIVATE badge, PlayHQ link hidden for private
  players); resolves game→player via a faithful browser port of `resolveToFullUuid` (`players/indexes` first,
  `players/aliases` fallback, self-wins on full ids, COLLISION sentinel); TRUNC_LEN 13. **Depends on GitHub
  Pages serving BOTH `players/indexes/<xx>.json` AND `players/aliases/<xx>.json`** — a new runtime dependency
  to keep in mind for the repo-size / Pages question.
- UUID truncation saving across games/, leaderboard/, team-stats/, search/ — not yet actioned.
  **The long-quoted ~1.78 GB was computed at a REJECTED 10-char prefix** (36 bits ≈ 63% collision
  probability at ~370k players — the reason `TRUNC_LEN` is 13; see §6.7). First-order estimate at 13
  was **~1.57 GB — SUPERSEDED 2026-07-30 by the actual measurement: 57.61 MB.** The estimate was wrong
  by ~27× because it assumed `leaderboard/` held ~922 MB of full UUIDs; it holds none. §D7 is CLOSED as
  rejected. Historical note only — `db-audit.js` §13 (REMOVED 2026-07-31, question closed) was the figure to
  act on. (Corrected 2026-07-29, last of four sites: this bullet survived the first sweep because the
  bullets immediately above and below it were corrected and this one was not.)
- Repo size **6.18 GB / 529,498 files** (2026-07-30; was 6.03 GB on 07-16, ~8.6 GB before cleanup) — re-verify
  whether it still blocks GitHub Pages before further shrink. Truncation is NOT a lever (§D7 closed, 57.61 MB).

---

### 6.7 FINDINGS FROM CONCLUDED INVESTIGATIONS (knowledge preserved; scripts deleted)

These are the durable results of the diagnostic scripts that were deleted in the cleanup. The scripts
themselves are recoverable from git history if a re-run is ever needed, but the *conclusions* below
are the reason they existed — captured here so deleting the code does not lose the knowledge.

**Profile-identity namespace divergence (diagnose-profile-identity-namespace.js, diagnose-namespace-mismatch.js).**
`api.playhq.com` and `spectator.playhq.com` can return DIFFERENT profileIDs for the SAME real player.
Confirmed directly on 3 of 13 players in one sampled game (William Mallen, Charlie Raynor, Jack Delaney).
The project captures spectator profileIDs; the profile-stats backfill queries api.playhq.com with that
same id, and when the id has diverged the api returns a false "private"/"not found" — unrelated to any
real privacy setting. **This is the root cause the entire alias system + fold exist to handle.** The
recovery path (grade-tid → grade-roster name match → profileSearch) resolves the api id, which is stored
as `player.apiId` and later folded. Steady-state, not migration residue: PlayHQ mints fresh spectator ids
per person over time (the "Micaela Chang" case had 3 distinct ids).

**UUID prefix collision entropy (audit-uuid-collisions.js, diagnose-unresolved-prefixes.js).**
The original truncation used a 10-char prefix — but a uuid's first hyphen sits at index 8, so 10 chars is
only 9 real hex digits = 36 bits, not 40. Birthday-paradox collision probability at 36 bits across ~370k
players is ~63% (not the ~5–6% first assumed for 40 bits). This drove the move to **TRUNC_LEN = 13**
(12 real hex digits, 48 bits). The alias resolver still carries a LEGACY_TRUNC_LEN = 10 fallback for
ids written before the fix — run `diagnose-id-field-lengths.js` to confirm none remain before assuming
the legacy path is dead. The "2.6M unresolved" figure that once alarmed was mostly this legacy-length
mismatch, not true collisions; only 3 genuinely-ambiguous prefixes were ever found (shards 02, b0, dd),
resolved by hand via disjoint season history (resolve-known-collisions.js).

**gradePlayerStatistics DOES paginate (diagnose-grade-pagination.js).**
The old doc claim ("hard cap 50 results, no pagination") was measured with a query missing the `$filter`
argument. Verified live on grade `c952bf59` (86 records, 2 pages): pagination works via
`filter.pagination { page, limit }` with `meta.totalPages` / `meta.totalRecords`. **`playhq_api_reference.md`
must be corrected** (still outstanding, §6.6).

**p[] recovery misattribution (audit-uuid-recovery-misattribution.js).**
`recover-uuids-from-git-history.js` paired current vs pre-migration attendee-array entries BY ARRAY INDEX.
Safe for hp[]/ap[] (frozen legacy fields) but NOT for p[] (nightly rewrites it wholesale from a fresh
spectator call, and the API doesn't preserve player order across months). Result: some recovered p[] ids
landed on the wrong person (confirmed: `0000ed35-…` matched no actual player in its game). **Canonical
player data is UNAFFECTED** (the migration re-fetched records rather than trusting p[]); the caveat is
scoped to `games/bv` p[] provenance only. Two independent checks (prefix-consistency, needing no
commit-selection trust; and content-match vs pre-migration) were built to separate a real substitution
bug from a pre-migration-commit-selection error.

**API stability / same-person duplication (diagnose-api-stability.js, backfill-collision-stats.js).**
A single real player CAN have multiple valid spectator ids (measured directly by inverting the collision
shards: apiId → set of spectator ids). This multiplicity is the mechanism behind much of the un-indexed
backlog and the reason keying on spectator id multiplied records. This measurement was migration Gate 1;
the ~19.8%/name-mismatch figures it produced are the empirical basis for the alias-fold design.

**Candidate-pool sizing (diagnose-uuid-population.js, diagnose-uuid-classification.js).**
The un-indexed full-length-uuid candidate pool was sized at ≈86k before the sampled classification, split
indexed-real / indexed-placeholder / un-indexed. This sized the backfill effort; the backfill has since
completed (0 remaining).

**Season-name-in-name-field bug — RESOLVED (July 2026).**
`parseProfileStats` once read `seasonStatistics[0].name` (which is a SEASON label, e.g. "Winter 2023")
as the player name, writing season strings into `player.name` for ~40,034 files. Root cause fixed in
`fetch-profile-stats.js` — `parseProfileStats` no longer emits a name; names now come from `publicProfile`
(account tenant). Backfilled by `repair-season-names.js`: **39,980 resolved directly via `publicProfile`,
38 via spectator game rosters**; the final ~15 (old spectator-only profiles whose games are archived off
the spectator endpoint) carry `Player #<prefix>` placeholders. An independent read-only scan
(`scan-season-name-contamination.js`) reported **0 contaminated of 411,576 files** — ⚠️ **that result is
WRONG, corrected 2026-07-30**: one file has carried a season label since 2026-06-27 (OUTSTANDING §C14).
The write bug is dead; the self-heal fails silently. See the `publicProfile`
entry in `playhq_api_reference.md`.
NOTE: the retired `repair-season-names.js` originally had two bugs — a `remaining` metric that could never
reach 0 (loop never stopped) and a defer path that froze `Player #` placeholders on transient/unreachable
spectator failures (this placeholdered 15 recoverable players). Both fixed: `remaining` now counts
contaminated-not-done, and after MAX_DEFER it hands the player to `salvage-spectator-names.js` instead of
guessing a placeholder. `salvage-spectator-names.js` then proved the final 15 genuinely unrecoverable
(games archived) and is now dormant.

### 6.8 Session 2026-07-20/21 — future fixtures + roster lag (fixes and their evidence)

**Future fixtures root causes (two, independent):**
1. `nightly-crawl.js` NEVER fetched rounds after the current one (queue builder filtered
   `number < current.number` only) and skipped grades with no current round entirely. Fixed:
   `--rounds-forward=N|all` + first-unsettled-round fetch for no-current grades (default
   behaviour otherwise unchanged).
2. `discover-fixtures.js` — the purpose-built future-fixtures tool (discoverTeamFixture returns
   the FULL fixture incl. future rounds) — had a catastrophic persistence bug: ONE combined
   `git add -- games/ venue-lookup/ team-lookup/ discover-fixtures-progress.json zero-team-seasons.json`
   is ATOMIC across pathspecs; any single non-matching pathspec (team-lookup/ absent,
   zero-team-seasons.json untracked) exits 128 staging NOTHING, the empty catch swallowed it, and
   every commit printed "(no changes to commit)". The 2026-07-19 run fetched **30,426 games across
   25,448 teams in 28 minutes and committed ZERO — job green.** ~~Fixed: per-path `git add` (a miss
   skips only itself) + a `staging:` shortstat line.~~
   ⚠️ **THE FIX WAS RECORDED BUT NOT PRESENT. Corrected 2026-07-31**, by reading the deployed file and
   by re-running its exact pathspec list with `team-lookup/` absent — it printed "(no changes to
   commit)" and staged nothing, exactly as in 2026-07-19. Actually fixed 2026-07-31 (§6.17). The
   lesson is the one this repo keeps relearning: a fix recorded in a document is not a fix in a file.

**Roster-lag fix (team view vs player view):** `games/bv` `p[]` carries bare `{id}` only — NO stat
lines (box scores are Worker-on-demand, never pre-stored) — so `build-team-stats.js` roster stats
come from player reg stats (`seasons[].regs[].stats`), written by the profile-stats matrix. The
nightly's team-stats job runs before the matrix is even dispatched → rosters structurally lagged the
player view (Worker-live per-game + API-side aggregates) by a full day. Fixed: matrix terminal now
also fires `build-team-stats.yml --field active_only=true` (§1.3). Verified: single-season rebuild
of `96c25259` showed the missing round's stats immediately.

**Also this session:** `fetch-profile-stats-matrix.yml` stop-button fixed (`apply-and-commit` +
`summary-and-retrigger` gates `always()` → `!cancelled()`; the "audit other matrices" item is done
for this file — shard-step-level `always()` on artifact upload correctly kept); `build-team-stats.yml`
gained the `data-write` lock (was the only team-stats writer outside it); `build-team-stats.js`
TRUNC_LEN consistency (placeholder was `slice(0,10)`; roster keys were already 13 via truncateUuid —
comments lied); Sunday discovery now runs `backfill_teams=true` (weekly pre-game roster capture).

**PENDING (validation / decision):**
- Corrected discover-seasons matrix: validate with `shards=["00"]` → expect `Session refreshed (attempt 1)`;
  then full sweep to drain the ~10-day discovery backlog.
- Matrix terminal + stop-button: prove via a `shards=["00"]` run to `stuck` (Build Team Stats appears
  among terminal dispatches; cancelling a mid-chain run halts the chain).
- **Future-fixtures architecture decision:** schedule `discover-fixtures.yml --current-only` weekly
  (RECOMMENDED — proven fetch, ~25k team calls / ~24 min, also feeds venue-lookup) vs committing the
  ⚠️ ~~delivered-but-unrun~~ **NOT unrun — see §6.18. Its own cron had been firing every Saturday.**
  `weekly-future-fixtures.yml` (round-based via nightly-crawl `--rounds-forward=all`;
  rests on the unverified assumption that discoverGrade.rounds lists future rounds; 60–90k calls).
  Mark deferred until the fixed discover-fixtures run proved itself — it has.
- First `backfill_teams=true` Sunday sweep: watch volume/duration (fresh progress per mode is expected).
- Known nonconformances flagged, not changed: `build-team-stats.js` gitCommit uses a 10-attempt retry
  (not the 60/1–91s house pattern); its dead `p[]` attribution loop; `discover-fixtures.js` single-cookie
  session style (works).

### 6.9 Session 2026-07-21 (second session) — §A validations closed, weekly chain built

- **§A validations closed with evidence:** `Session refreshed (attempt 1)` on a fresh runner for BOTH
  fixed job types (matrix shard AND reduce); uncapped sweep cycle 1 probed 83,050/231,678 across all
  256 shards (all wall-stopped by design), cycle-2 persistence confirmed; matrix terminal proof
  (`Build Team Stats` among the stuck dispatches) + stop-button confirmed; `statsChecked` gating and
  application-403 non-persistence confirmed across two consecutive runs (same 3 players re-fetched,
  files untouched — retryable by design). ~~Cosmetic: the matrix summary's "Private profiles
  marked: N" is an in-run count, not a persisted write.~~ **SUPERSEDED 2026-07-29, recorded here
  2026-07-30:** the label now reads "Not obtainable (marked)" and the summary explains that these
  are withheld profiles marked done after recovery failed, and are a SUBSET of the writes above.
  (Found by the cross-doc grep, not by the audit that quoted it — this was the SECOND home of the
  claim corrected in OUTSTANDING §F, the same miss the last three passes made.)
- **§B5 decided: weekly future-fixtures CHAINED into the nightly** (not a standalone cron — a cron was
  built first, then discarded when Mark asked why it couldn't ride the nightly like Sunday discovery).
  `discover-fixtures-weekly` job in `nightly-crawl.yml`: terminal-gated, `dow=1` UTC, dispatches
  `current_only=true` + `chain_stats=true`. §B6 done: probe workflow + script deleted.
- **§C7 built** (infer-game-grades confirmed decommissioned — dropped from the chain):
  fixtures → finals (active) → leaderboards (active), each link a success-gated dispatch job.
- **`build-finals-stats.js --active-only` was a data-loss bug caught before first live use** (5 runs
  ever, all argless). Phase 2 recomputed career finals/gfApps/gfWins from the active-only finalsMap
  (clobbering veterans' career totals) and its `?? zeros` per-reg loop DELETED locked-season flags —
  with downstream propagation into all-time.json via leaderboards pass 1. Fix: `scopeSet` — scanned
  seasons scan-authoritative, out-of-scope seasons never touched and their existing flags folded into
  career totals (build-win-loss active-only Pass 2 is the house precedent for this pattern).
- **`build-leaderboards.js`:** progress file never deleted on success (this manifest's §5 claim was
  aspirational — corrected); fixed to delete-on-success. Both scripts' progress files now MODE-KEYED
  (`mode: 'active'|'full'`; cross-mode progress is discarded on load, never resumed).
- **Both scripts' gitCommit upgraded to the house pattern** (copied from `build-win-loss.js`):
  per-path adds, staged `--shortstat` printed, commit-first, 60-attempt/1–91s-jitter push retry,
  THROW on total failure. ~~`build-team-stats.js` (10-attempt retry) is now the remaining outlier.~~
  ⚠️ **WRONG — corrected 2026-07-31.** It was not "the remaining" one. `nightly-crawl.js` AND
  `discover-fixtures.js` both carried the 10-attempt loop with a swallowed total push failure, and
  the nightly is the heart of the system. Both fixed 2026-07-31 (§6.17).
- **Boolean workflow-input gates (corrected same day, proven live):** in job-level expression
  context a boolean input is a real boolean; `== 'true'` string-compares coerce to NaN and SKIP on
  true (this skipped the first chained leaderboards run). Robust form:
  `inputs.x == true || inputs.x == 'true'`. Bash run-step string compares are a different context
  and remain fine. The nightly's `inputs.dry_run != 'true'` job gates are SUSPECT for the inverse
  failure (not skipping on dry_run=true) — verify from a past dry-run's job list.
- **A1 proving COMPLETED same day (late PM):** finals catch-up 41,714 files / 23 retry-pattern
  commits; chained leaderboards proven after the gate fix; leaderboards active-only scoped 572
  (467 written + 105 skipped), mode-keying discarded a REAL stale full-run progress file on load,
  progress deleted on success; clobber check 70/70 top veterans, zero career shrinkage, locked
  flags intact. One-off `verify-finals-preservation.js/.yml` created for the check, then DELETED.
- **Remaining checklist: OUTSTANDING_TASKS.md §A** — A2 wiring commit was due before the Mon
  2026-07-21 15:00 UTC nightly (2026-07-21 WAS a Monday — the first automatic chain fires that
  night if A2 landed, else Mon 07-27); then A3 roster morning + A5 chain morning in one sitting;
  A4 Sunday backfill 07-26.
- Three stale doc/memory items closed by reading current files: API-reference pagination fix and
  claude_context filename-comment rule were already present; migration step 3b-2 was already done.

### 6.10 Session 2026-07-28/29 — first automatic weekly chain, matrix chain-break, A3 automated

- **First automatic weekly chain RAN (Mon 2026-07-27 16:00 UTC nightly → Tue 28 early AM AEST).**
  A2 landed Tue 2026-07-21, i.e. after that week's Monday nightly, so the first chain was the
  07-27 one as designed. Evidence: `discover-fixtures` with `--current-only` in resolved ARGS
  (251 active of 572 seasons), then `Build Finals Stats` #8 at 05:37. NOTE: chain-dispatched runs
  are labelled "Manually run by markjovic" in the Actions list because the dispatch uses
  `WORKFLOW_PAT` — that is NOT a manual run, and reading it as one wastes a morning.
- **Matrix chain BROKE on a lost dispatch (2026-07-27):** `gh workflow run` for the self-retrigger
  returned **HTTP 500**; the step was one-shot, so the chain simply stopped — no retrigger, no
  terminal, no `build-team-stats`. Separately (2026-07-26) `apply-and-commit` died in
  "Expand sparse checkout" with a promisor fetch reset (`curl 56` / `early EOF` /
  `could not fetch ... from promisor remote`); that run's shard writes were never applied, which is
  retryable-by-design, not data loss.
- **`fetch-profile-stats-matrix.yml` HARDENED** (all in one pass): a `/tmp/gh-dispatch.sh` retry
  helper (10 attempts, 10→90s backoff, **fail-fast on HTTP 4xx**, THROW when exhausted) used by all
  SIX dispatch sites; a persistence gate so `written` from shard summaries is NOT counted as
  progress when `apply-and-commit` failed (new `consecutive_apply_failures` input; 3 in a row →
  new `apply_stuck` status that halts WITHOUT firing the terminal or deleting
  `matrix-force-pending.json`); the missing push retry added to `apply-and-commit` (it had NONE)
  and to the pending-file delete step; combined `git add players/ scripts/` split into per-path
  adds; sparse-checkout/promisor retry; terminal fan-out steps gated
  `!cancelled() && status == 'stuck'` so one throwing dispatch cannot skip its siblings; `force`
  job gate and the `NEXT_SHARDS` expression fixed to the robust boolean form (directive 13).
- **Chain proven end to end afterwards:** matrix reached `stuck` at run 4/150 (211 outstanding,
  211 inaccessible, 0 written — application-403 players cannot produce a write, so the
  consecutive-zeros stop is the CORRECT terminal condition here), terminal dispatched
  `build-team-stats.yml --active-only`, which repaired 522 files, and the A3 check then passed
  20/20 on a game played that night.
- **§A3 AUTOMATED — `check-roster-freshness.js` + `.yml` (new, read-only).** Finds last night's
  candidate seasons from COMMIT HISTORY (`git log --since --name-only -- games/bv`, metadata only,
  no blob fetches) rather than scanning 572 season files, sparse-expands to just what it needs,
  picks the game with the most players, and verifies: game in BOTH teams' `fixtures[]` with a
  score; every resolvable player present in their team roster; and each roster stat line EQUAL to
  that player's `seasons[].regs[].stats`.
- **DIAGNOSTIC FINGERPRINT (worth remembering):** the first live run found all 18 players of a game
  behind by EXACTLY ONE GAME (`gp roster = player − 1`, with matching pts/fg/fouls deltas), on both
  teams, zero agreements. A *uniform* whole-roster one-game lag means a LOST TERMINAL DISPATCH —
  the player files were correct throughout. Sporadic per-player differences would mean something
  else entirely.
- **Commit-presence is not evidence of work.** The checker's original commit-ordering test was
  demoted to ADVISORY: a team-stats file that is already correct is rewritten byte-identically and
  therefore never committed (the 522-file repair run staged only ~148 files), and a bounded-depth
  clone cannot see a commit older than its shallow boundary. Comparing live VALUES on both sides is
  strictly stronger evidence than comparing commit timestamps.
- **Known nonconformance closed:** `build-team-stats.js` gitCommit (⚠️ described here as "the last
  10-attempt outlier" — **it was not; see §6.17.** `nightly-crawl.js` and `discover-fixtures.js` both
  still had it on 2026-07-31 —
  and it swallowed a total push failure, so a run could print "complete — N files", go green, and
  have pushed nothing) replaced with the house pattern copied from `build-finals-stats.js`; its
  dead `p[]` attribution loop removed. `discover-fixtures.js` single-cookie style remains, by choice.
- **Open from this session:** ~~the matrix terminal message still says "✅ Matrix complete — All
  players processed", which is FALSE when the sweep ends on inaccessible players~~ — **RETRACTED
  2026-07-30 by reading the deployed YAML: this was fixed on 07-29, in the same pass that wrote
  this bullet.** The message is now defended rather than reworded (withheld profiles get
  `statsChecked` via `markNotObtainable`, so every terminal outcome writes and 0-written across 3
  runs is a true terminal); the summary label reads "Not obtainable (marked)". See OUTSTANDING §C9.
  STILL OPEN: `Errors: 1` in the terminal run is unexplained; 144/256 shards produced summaries
  (expected — shards with nothing outstanding write no summary — but unverified).

---

## 7. CONVENTIONS (non-negotiable, enforced)

### 7.1 Git in scripts
- `git add <explicit path>` — **never `git add -A`**.
- `git diff --shortstat` — **never `--stat`** (ENOBUFS on large diffs).
- **COMMIT before MERGE**, then `git fetch` + `git merge -X ours FETCH_HEAD --no-edit --no-stat` — never `git pull`, never rebase.
- **Never `git stash`/`stash pop`** (wedges the working tree on conflict).
- Single-line commit messages.
- Proven push-with-retry (heavy-contention jobs): 60 attempts, random 1–91s jitter, `git merge --abort`
  before each retry, THROW on total failure. (Reference: repair-aliases.yml, reconcile-people.yml, classify-flagged-merges.yml.)
- **Chain-critical `gh workflow run` dispatches retry like pushes.** A workflow that dispatches the
  next link (self-retrigger, terminal fan-out) must wrap the call: retry transient failures with
  backoff, FAIL FAST on HTTP 4xx (422/404/401/403 are permanent — retrying buries the real error),
  and THROW when exhausted so a broken chain shows red. A one-shot dispatch stopped the matrix
  silently on 2026-07-27 (HTTP 500). Reference: `fetch-profile-stats-matrix.yml` `/tmp/gh-dispatch.sh`.

### 7.2 Workflows
- **No `actions/setup-node` in any JOB that fetches api.playhq.com** (changes outbound fingerprint →
  CloudFront 403 on EVERY request incl. session acquisition). ABSOLUTE and per-JOB — confirmed with
  instrumented evidence 2026-07-20 (§6.3); non-fetching jobs in the same workflow may carry it
  (e.g. nightly's win-loss job). The old "working counterexamples" expired ~2026-07-10.
- Self-triggering matrix: shards do NO git; ONE aggregator (`apply-and-commit`) downloads all shard
  artifacts and does a single commit/push. Retrigger jobs use `if: ${{ !cancelled() }}` (not `always()`).
- `gh workflow run` in a retrigger requires `permissions: actions: write`.
- `workflow_dispatch` inputs are referenced by the description text Mark sees on the form.
- Concurrency group `data-write` shared by every workflow that writes player files / the index, so they
  can never race (nightly-crawl, weekly-indexes, discover-seasons(-matrix) reduce, migration one-offs).
- Reference matrix shape: `fetch-profile-stats-matrix.yml` (live; the canonical self-triggering matrix).

### 7.3 Code style
- ESM: build-finals-stats.js, build-leaderboards.js, build-player-games.js, build-records.js. CJS: all others.
  **VERIFIED 2026-07-29** by reading all four (each opens with `import`). `claude_context.md` and
  `CLAUDE_CODE_PROMPT.md` (being RETIRED — decision 2026-07-29, `git rm` pending) both claimed only
  the first two were ESM; this list was correct and claude_context is now fixed. Evidence:
  `build-player-games.js` L24 and `build-records.js` L27 both open `import fs from 'fs'`. Do not re-open without reading the files.
- `const ROOT = path.join(__dirname, '..')`; all scripts in `scripts/`; workflows call `node scripts/<name>.js`.
- PlayHQ GraphQL queries/headers copied VERBATIM from proven scripts — never hand-written.
  Required headers (ALL api.playhq.com requests): `user-agent: PlayHQ/1.47.2 Android/28 (Android SDK built for x86)`,
  `tenant: basketball-victoria` (never `bv`), `origin: https://www.playhq.com`, `content-type: application/json`,
  `request-id: <uuid>`. Spectator endpoint (`spectator.playhq.com`) uses different headers (`tenant: bv`, `x-phq-tenant: bv`, 3-cookie).
- Player files stored MINIFIED (`JSON.stringify` no indent). Progress files delete on SUCCESS only.
- Long-running scripts commit+push their progress file at each save interval (in-memory progress is lost on timeout).

### 7.4 Delivery rules
- Every delivered file: repo path as line-1 comment (`// scripts/x.js`, `# .github/workflows/x.yml`).
- `node --check` before delivery. `present_files` after. Every script ships with its matching workflow YAML.

---

## 8. TOOLS & ENDPOINTS
- **PlayHQ GraphQL:** `api.playhq.com/graphql` (basketball-victoria tenant). Concurrency: start 500, cap 1000;
  429 → 60% + attempts×5s backoff, 3×429 → permanent −5, 2 clean → +10; 403 → null (not accessible); 404 → skip.
- **Spectator:** `spectator.playhq.com/graphql` (tenant bv; different 403 behaviour; blocks CORS from non-playhq origins).
- **Cloudflare Workers:** `solitary-snowflake-cb3e.insanoflash.workers.dev` (box/quarter scores for StatTrack);
  `playhq-profile-proxy.insanoflash.workers.dev` (profile proxy — DIFFERENT worker, used by the retired proxy fetcher).
- **GitHub Actions:** all automation; 256-bucket matrix for sharded ops. WAF is per-IP/per-shard, not aggregate.

---
### 6.11 · Session of 2026-07-30 (measurement + one real bug)

- **db-audit run (full, 5m 04s checkout).** Repo **6.18 GB / 529,498 files**; **413,577** players
  (index and detail agree exactly, 0 orphans either way); 2,311,358 games across 2,896 season files;
  3,227 seasons. `statsChecked` 99.9%, remainder 213 confirmed withheld.
- **§D7 UUID truncation CLOSED — measured and rejected.** §13 at TRUNC_LEN 13 = **57.61 MB**, not the
  ~1.57 GB estimate. `leaderboard/` holds ZERO full-length UUIDs. 0.9% of the repo; not worth a
  migration that must update every exact-string consumer in one pass. See OUTSTANDING §D7.
- **Season-name contamination is NOT repaired.** One file has carried a season label since
  2026-06-27; the write bug is dead but the self-heal in `finishOk` fails silently when
  `fetchPublicProfileName` returns null. Instrumentation delivered, not committed. See OUTSTANDING §C14.
  Any doc claiming "0 contaminated" is wrong.
- **`db-audit.js` carries the retracted `needs-matrix-shards.json` claim in code** — the fourth copy,
  and the first that no doc grep could reach. Two other stale checks (`alias-inverse/`, leaderboard
  `{id,v}` arrays) flag deliberate design as failures. See OUTSTANDING §C15.
- ~~**16 dangling alias targets** against 0 `apiId` fields — §3b invariant violated.~~ **RESOLVED
  2026-07-31**: grew to 284 after the big fold, then repaired 284/284. Cause was the fold deleting
  player files without repointing aliases. See OUTSTANDING §C16 and §6.12.
- **~140-minute full-checkout figure retired**: measured **5m 04s**. It lived only in session memory,
  never in a doc, and was the implicit justification for the `apply-and-commit` partial clone.
  Recommendation recorded in OUTSTANDING §B2: plain full checkout.
- **House `gitCommit` PROVEN IN PRODUCTION.** A live `build-records.js` run made 15 commits, each
  printing `staging: 2 files changed, …`; the final commit staged `records/all-time.json` plus the
  progress-file DELETION — the exact case §C6b predicted would fail. It did not. `git add` on a
  tracked deleted path stages the deletion; the atomic-add hazard was never firing, and the
  swallowed push was always the real exposure. See OUTSTANDING §C6b.
- **Season-name contamination RESOLVED for the affected file, root cause reclassified.** A targeted
  forced re-fetch repaired it (`"Ryder Fowler"`). The folded-identity hypothesis was WRONG — the api
  id resolves fine on the account tenant. The 2026-07-26 failure was transient. The open defect is
  that a transient heal failure is made PERMANENT by `statsChecked`; decision at OUTSTANDING §B3.
- **Targeted forced re-fetch now exists.** `force=true` previously implied a repo-wide
  `clear-stats-checked` regardless of `shards`, so a "targeted" force run became a 413k re-sweep.
  Now gated; the shard step passes `--force`. See OUTSTANDING §C20.
- **`db-audit.js` fixed (delivered, not committed):** three checks, one of them INVERTED — the
  leaderboard `{id,v}` assertion passed on the LEGACY schema. See OUTSTANDING §C15.
- **Still delivered but NOT committed:** `build-player-games.js` (same `gitCommit`; first full
  256-prefix pass Sunday 02:00 UTC), `db-audit.js`.

### 6.12 · Session of 2026-07-30/31 (the 413k day)

- **413,364 `statsChecked` values wiped by a broken safety gate.** A `>-` folded YAML scalar with a
  more-indented continuation preserved its newline; GitHub could not parse the multi-line `if`, treated
  it as a truthy literal string, and ran `clear-stats-checked` on a dispatch that targeted ONE shard.
  Recovered by a full re-sweep (~40 matrix runs, ~8h). See claude_context §T1–T3.
- **Two `refreshSession` bugs found under that load**: a socket throw escaped a 10-attempt retry loop
  entirely, and `sessionPromise` was left holding a REJECTED promise with no recovery path. Both fixed
  and committed. See §T4–T5.
- **Season-name contamination closed** — repaired to "Ryder Fowler" by a targeted forced re-fetch; the
  folded-identity hypothesis was WRONG (the api id resolves fine on the account tenant), the 07-26
  failure was transient. Audit now reads 0 contaminated. Open defect recorded at OUTSTANDING §B3.
- **Targeted forced re-fetch now exists** and the repo-wide-clear footgun is gated in bash, not only in
  a GitHub expression. See OUTSTANDING §C20.
- **The fold never repointed aliases** — 284 dangling repaired 284/284, root cause and fix at
  OUTSTANDING §C16. Post-check hardened; `--repoint-only` added. Bonus: 457,218 spectator ids,
  **0 ambiguous**, first time measured.
- **`db-audit.js` three stale checks fixed and committed** (one was INVERTED — it asserted the LEGACY
  leaderboard schema as ✅). Verified by the 23:04 audit printing the new strings.
- **§D7 UUID truncation CLOSED** — measured 57.61 MB, not the ~1.57 GB estimate. Do not action.
- **House `gitCommit` proven in production** across 15 `build-records` commits, including the
  post-cleanup commit §C6b predicted would fail. It did not.
- **Standing traps T1–T9 recorded in `claude_context.md`.** That section is the durable output of this
  session; every entry cost either data or hours.

### 6.13 · Session of 2026-07-31 (cleanup day)

- **§B2 DONE** — `apply-and-commit` now does a plain full checkout; 46 lines removed including the
  sparse expansion and its retry. Promisor-fetch and skip-worktree failure classes deleted, not
  mitigated. Shard jobs keep sparse-checkout.
- **§B3 DECIDED (a) and DONE** — bounded name-heal retry via `player.nameHealAttempts`, cap 3, reset
  on success and on `--force`. `db-audit.js` gained in-flight / gave-up rows.
- **§C17 `finalsPerSeason > 1` FIXED BY CONSTRUCTION** — numerator and denominator are now sets, so
  the ratio cannot exceed 1. Surfaced §C22: 218 seasons where a player appeared in a scanned game but
  the season is missing from their own `player.seasons[]`.
- **§C19 blank game context in `records/all-time.json` FIXED** — `leaderboard/all-time.json` stores
  TRUNCATED ids (`truncateUuid`, 13) and `build-records.js` built a player path straight from one,
  failing 100/100. Now resolved via `resolveToFullUuid()`. **db-audit §13 had already measured this**
  ("leaderboard/ … 0 instances" of full-length uuids) a day earlier; the number was never connected
  to the code.
- **§C21 hardcoded `slice(0, 10)`** in `build-leaderboards.js`'s placeholder-NAME minter replaced with
  `truncateUuid()`. No stored id was ever 10 chars — both id sites always used `truncateUuid()`.
- **§C23 bare `gh workflow run`** in `build-finals-stats.yml` replaced with the retry helper, copied
  verbatim from the matrix workflow.
- **Recurring pattern worth naming:** three of today's five bugs were already visible in data or docs
  before they were found — §13's zero-full-uuids line, the L38 "10-char" comment sitting above the
  broken code, and the fold's own header claiming aliases needed nothing. The information was present;
  the join was missing.

### 6.14 · 2026-07-31 late — T9, hygiene decisions, and a memory correction

- **T9 DONE.** The matrix retrigger now narrows to shards with outstanding work. Trap documented:
  empty means ALL 256, so an empty narrowed list falls back to forwarding `inputs.shards`.
- **`db-audit.js` keep-list extended** to four evidence files (`uuid-collisions-len10`,
  `git-history-recovery-report`, `season-name-contamination`, `unresolved-prefix-diagnosis`). Only
  `rekey-apply-cache.json` and `season-name-repair-progress.json` remain flagged — both real residue.
- **Root scripts:** move `fetch-playhq.js` and `find-players-by-team.js` to `scripts/reference/`.
- **⚠️ MEMORY CORRECTION — `fetch-playhq.js` is NOT an API-shape copy source.** A prior session's
  memory said it was; README §4 has always said it is permanently retired with double-counting bugs.
  The PlayHQ copy rule in `claude_context.md` has been rewritten around a principle instead of a file
  list: **authority comes from being exercised.** Copy from the live script that makes the same class
  of call (it runs nightly against the real API, so a wrong query fails loudly); use
  `playhq_api_reference.md` only as a cross-check, never alone (it taught the season-label-as-name bug
  at three sites on 07-29); never copy from anything the pipeline does not run.
- **§C21 verified safe:** `isPlaceholderName` is `/^player\s*#/i` — prefix-only, length-agnostic, so
  changing the placeholder mint length breaks no detection.

### 6.15 · 2026-07-31 — §B1 resolved by ordering

- **A nightly race existed and is now fixed.** `win-loss` and `profile-stats-matrix` both hung off
  `crawl` and ran in parallel; the matrix was dispatched as soon as `team-stats` finished, while
  `build-win-loss.js` could still be writing player files for up to 120 more minutes. The nightly's
  `data-write` lock did not cover it — the matrix is a separate workflow run. Fixed by adding
  `win-loss` to the dispatch job's `needs`. See claude_context §T10.
- **The concurrency lock is NOT the answer to the nightly case** and was not applied: it would make
  the matrix queue behind a workflow that holds the lock for its entire run.
- **Still open, narrower:** the Monday `discover-fixtures -> finals -> leaderboards` chain can overlap
  a still-running matrix chain. Weekly. Recorded in OUTSTANDING §1.1.
- Audit 06:49 confirms `root-level .js files ✅ none`, keep-list at 8, structural invariants OK.

### 6.16 · 2026-07-31 — audit slimmed, stale truncation claims retired

- **db-audit §13 REMOVED.** It measured a UUID-truncation saving for a question closed on 07-30
  (57.61 MB, rejected). Removing it also deleted a full extra scan of `team-stats/` (2,896 files,
  916 MB) that existed only for the byte tally, a per-game loop building three arrays across 2.3M
  games, and per-entry counting across all search shards and leaderboard files. 1,013 -> 999 lines,
  `TRUNC_LEN` import now unused and dropped.
- **Two other db-audit checks were stale.** The keep-list ✅ was UNREACHABLE (the condition assumed
  every keep-list file always exists on disk; once the list grew to 10 with 8 present it could never
  pass) — now reports `n/total` and names which are absent. The dangling-alias hint said only "pending
  fold"; it now names the second cause found on 07-30 (a fold deleting files without repointing
  aliases) and the repair command.
- **Stale truncation claims retired in two docs**, both of which still presented the work as open:
  `README.md` told the reader to "re-measure via db-audit §13", and `claude_context.md` contained a
  paragraph saying "NOT YET DONE" seven lines above an item saying "CLOSED" — the N-1 pattern inside a
  SINGLE document, which is a new variant of it.
- **§B1 closed by ordering, not locking** (see §6.15). Moved out of OUTSTANDING's live sections.

*End of REPO_MANIFEST.md — generated 2026-07-16 from a complete read of the pre-cleanup tree (78 scripts + 88 workflows); updated post-cleanup (commit `fe8eedb`) and post-workflow-fix deployment; updated 2026-07-21 (setup-node resolution, future-fixtures fixes, roster-lag fix, Sunday backfill — see §6.3/§6.8). updated 2026-07-28/29 (matrix hardening, A3 automation, doc-set audit corrections — see §6.10). Reflects the live repo as of 2026-07-29; 2026-07-30 pass retracted the §6.10 terminal-message item (already fixed 07-29) and retired the ~140-minute full-checkout figure — a full checkout is ~7 minutes, the old number lived only in session memory and in no doc.*

### 6.23 · 2026-08-02 evening — normName v2 in one pass, and the stale shard index it exposed

- **normName v2 at all seven comparison sites in a single delivery**: canonical in
  lib/namespace-resolve.cjs (with the one-pass invariant documented at the definition), one-liner
  copy in fetch-profile-stats.js, verbatim copies in repair-season-names / salvage-spectator-names
  / scan-season-name-contamination / db-audit, and StatTrack 0.67's tokenMatch (both operands
  folded at compare time; search-shard selection deliberately untouched at that stage). Fold =
  NFKC, curly/low/prime apostrophes -> ', curly doubles -> ", hyphen family + minus -> -, NFD +
  combining-mark strip, then the original lowercase/collapse/trim. Proof of the pass: normName
  extracted from all six server files and run over one vector — identical everywhere; ASCII
  regression = byte-identical to v1 (no existing match, heal, or contamination decision moved).
  Justification from measurement: the July namespace audit's 43 benign mismatches were exactly
  quote/hyphen/spacing variants; every matcher nulls on >1 hit so looser matching can only
  produce a non-recovery, never a mis-reconciliation.

- **THE SHARD FINDING (why "read the last file" matters):** build-search-index.js's shardKey
  stripped non a-z INCLUDING accents (Álvarez -> shard 'lv'), the client sliced the raw query
  (álvarez -> 'ál.json'), and 135 orphan shards from migrate-phase3's raw-first-two-chars rule
  had survived every rebuild since (cleanup was hex-pattern-only) — so accented and
  apostrophe-position-two queries were being answered from a TWO-MONTH-STALE parallel index:
  wrong club/team, missing every player indexed since June, invisible to db-audit (which counts
  shard files, never generation-checks them). 641 = 506 current + 135 orphans reconciled exactly.
- **Fix shipped and proven**: shardKey v2 folds accents THEN strips (legacy '_' fallback for
  non-Latin names preserved byte-for-byte — consistency is the requirement, not prettiness);
  StatTrack 0.68 mirrors the exact expression (13-case builder/client identity vector executed);
  stale cleanup generalized to "delete anything this rebuild didn't produce" since the fold MOVES
  keys between shards. Rebuild ran 2026-08-02: 412,100 players, 506 shards, 724,407 keys, 135
  stale removed, 55s. Deploy order honoured: index rebuilt BEFORE the 0.68 client commit, so the
  transition window only ever improved results.

### 6.22 · 2026-08-02 later — StatTrack 0.65/0.66, and the opposition index retired by a number

- **The opposition-index question closed the right way round: measured, then not built.**
  New `size-opposition-index.js/.yml` (KEPT — read-only, re-runnable): the builder minus the
  write — classification copied from build-win-loss.js read in full (pre-pass map, hp/ap sides,
  p[] fallback, gameTids disambiguation, forfeit exclusion inherited deliberately), ids interned,
  pairs packed into one Map<number,number>. Live run: **16,195,995 pairs / 404,819 players /
  avg 40 max 437 per player / 1,001.4 MB projected / largest shard 4.2 MB / 3.8 GB RSS / 2 min.**
  Verdict (Mark): 1 GB is too big for a very low value data point — the unit is the per-season
  tid, so the "career vs team" framing aggregates over shirt names, not identities. For once the
  envelope was right (cf. the truncation precedent where it was 27x wrong) — but the point of
  measuring is that nobody had to trust it.

- **StatTrack 0.65** (committed to both copies): (1) season head-to-head line in openOpp —
  player-exact, from fixtures already fetched, zero requests; pure seasonH2H() + h2hLine(),
  8-case matrix incl. missed-meetings split and null path. (2) Career W/L cell centred/nowrap/
  tabular, same for the per-season cell. (3) Column parity: game rows pad to 8 columns when the
  season header carries the W/L cell — including the THIRD buildGameStatRow call site (applyBox
  rewrites #gstats-{gid} on box-score load) found by the structural check after a full read had
  missed it; pad decision stamped on the DOM (ge.dataset.pad) so all three writers agree. Pad
  absent = output byte-identical to 0.64. (4) Season ordering: ord map was
  {Autumn:3,Winter:2,Summer:1,Spring:1} — completed Autumn above running Winter, Spring pinned
  last. Now start-date chronology within end-year: Spring>Winter>Autumn>Summer (Summer files
  under its END year). Mark's exact reported sequence tested. Limitation flagged in-code: start
  date is approximated from the season NAME; true first-round-date ordering needs a tiny
  {sid: firstGameDate} index built data-side if a season ever breaks the four-name pattern.

- **StatTrack 0.66** (committed to both copies): season h2h surfaced on the other two views.
  Fixtures tab: per-row "vs this team this season" PRIOR line — strictly-before-this-date
  meetings so a played row never counts itself; first meetings show nothing. Matchup preview:
  team-level line under the header, or an honest "No completed meetings between these teams
  this season". Load-bearing detail: fixture entries carry oppName only, and a display name is
  not an identity — opponent per row is resolved by gameId JOIN across the season's fixture
  lists (gameTidMap: each game appears in exactly two). Tested with two distinct teams sharing
  the display name "Lions": the impostor contributes nothing. 10-case matrix executed.

### 6.21 · 2026-08-02 — dispatch hardening, the legacy endgame, and one forfeit

- **Five of six bare dispatch sites converted to the retry helper** (§2.6 — which had counted
  four). `nightly-crawl.yml` x4 (matrix trigger, Sunday discovery, Monday fixtures, self-retrigger)
  and `discover-fixtures.yml`'s chain-stats hop — the Monday chain's SECOND hop, where a lost
  dispatch lands the fixtures and silently skips both stat rebuilds with the run green. Helper
  copied VERBATIM from `fetch-profile-stats-matrix.yml` and asserted byte-identical at every
  install; every job-level `if:` asserted byte-identical to the deployed file; every `--field`
  checked against the target's declared inputs (the helper's 4xx fail-fast turns a wrong name into
  a hard stop). Helper EXECUTED against a stubbed `gh`: transient-then-success on attempt 3, 422 in
  one attempt, exhaustion throws after 10. Matrix dispatch args now a bash array (old unquoted
  interpolation would word-split JSON whitespace; byte-identical for well-formed input).
  **`discover-seasons-matrix.yml`'s self-retrigger stays bare deliberately** — convert it when its
  debug scaffolding is stripped, not inside an unrelated commit. *(Done 2026-08-03, in exactly that
  pass — §6.24.)*

- **THE LEGACY FINDING: the 142 survivors were 139 FUTURE FIXTURES + 3 real ones.**
  `find-flag-collisions.js` Part 4 (new: survivor split by season lock state + month histogram;
  the `no-locked-field` case reported as its OWN bucket because nightly-crawl `locked === false`
  and db-audit `!locked` read an absent field oppositely — both buckets came back ZERO) ran live
  over 2,311,828 games: 139 in active seasons, every sample `st=UPCOMING`, dates to 2026-08-26.
  The old classifier probed unplayed games, got nothing (correctly) and stamped them "pre-history,
  nothing further obtainable". Lifetime record: **3,262 stamped, 3 correct — 0.09%.**
  §2.1 decided: NO rebuild; no-flag is the terminal state.

- **`repair-legacy-flags.js` extended and applied:** second criterion
  `flagFalsified = hasScore || st === 'UPCOMING'` (strict equality — absent `st` clears nothing),
  applied at clear decision, disk post-check and report. **139 cleared / 3 kept / 3 files**, dry
  run and apply identical, matching Part 4 from two independently written scans. Without it, each
  of the 139 would have tripped `legacy + score` as it was played (T11 mechanics), and StatTrack
  was rendering all 139 UPCOMING games as "Data unavailable" TODAY. Legacy population now EXACTLY
  3 (2021x2, 2023x1, scoreless locked FINALs), permanently — no writer, unreachable survivors.

- **ba9d21fe closed by live probe, then a one-line repair.** `fo` semantics settled from both
  writers first (fo = WINNER id — nightly-crawl L686, recheck-forfeit-games). New
  `diagnose-forfeit-game.js/.yml` (read-only; plumbing verbatim from recheck-forfeit-games.js;
  verdict function through a 15-case matrix incl. the real record) probed discoverGame:
  **AWAY_TEAM_WON_BY_FORFEIT** — fo RIGHT, scoreline stale (L659 entry-build: hs/as only overlay
  when non-null, so a stale score rides beneath fresher forfeit/fo). New
  `repair-forfeit-score.js/.yml` (winner derived from the record's OWN fo, never an input;
  refusals for non-forfeit/unusable fo; idempotent; key-diff + count + disk post-check; proven
  against a real repo with a bare remote) applied **10-0 -> 0-20**. W/L never contaminated:
  `build-win-loss.js` L55 excludes forfeits — read, not assumed. Both tools kept as on-demand.

- **§1.1 verifications closed from evidence:** leaderboard keys two-segment in live data (the
  `uuid|tid` revert REBUILT); `weekly-future-fixtures.yml` `on:` block holds no `schedule:`.

- **T1 flagged as OVERBROAD, correction pending in claude_context:** all four deployed
  nightly-crawl job gates are `if: |` block scalars WITH newlines and the retrigger gate
  demonstrably works (a truthy-literal gate would self-dispatch every drained nightly forever).
  T1's real case was a `>-` FOLDED scalar with a more-indented continuation. All four gates were
  deliberately left byte-identical this session; narrow the trap before someone "fixes" them.

- **db-audit §11b ages -> sizes (closed the last §2 work item), proven by the live 06:07 audit:**
  mtime is checkout time on a runner, and the git-log alternative is equally dead at
  fetch-depth:1 (one commit, one age for every file). Sizes for files, entry counts for dirs;
  verdicts untouched; executed against all five hygiene cases pre-delivery. The same audit
  confirmed the session's two staked predictions: `legacy: true — 3` and `legacy + score — none`.
  No `legacy + UPCOMING` invariant added — no writer exists, so the check could never fire.

- **find-flag-collisions.yml banner retired** — its "written from conventions, DIFF BEFORE
  COMMITTING" warning was discharged by reading the deployed file (they matched); a discharged
  caveat left standing is T12-shaped.

### 6.20 · 2026-08-01 late — sibling stats sync, and the winPct denominator

- **Every reg sharing a (season, team) must hold the same stats.** Not a new rule — both writers already
  enforce it and neither looks at `gid`: `fetch-profile-stats.js` L985-996 keys `${sid}:${reg.tid}`,
  `build-win-loss.js` L271/L313 uses `playerRecords[sid][tid]`. 169,566 groups had drifted anyway: 798
  in a CORE box-score field, 168,768 in `foulOuts` alone. Cause is STALENESS, not keying — a group only
  diverges when it has not been rewritten since the values changed, and the `wins`/`losses` cases
  persisted because the nightly runs `build-win-loss --active-only` while 97%+ of them sit in LOCKED
  seasons. Synced per-key MAX across 91,716 players / 263,440 regs; verified after at `differ >= 1 key`
  = 0 with an empty key histogram.

- **winPct / lossPct were the only categories mixing data sources**, and it showed. `wins/losses/draws`
  come from `build-win-loss.js` scanning games we HOLD; `gp` is PlayHQ's appearance count including
  games we do not. A 50-GP player with 10 known games, all won, read as 100% while carrying `gp:50`, and
  the browser's minimum-games filter reads `e.gp` — so they outranked a genuine 20-0-from-20 player.
  Fixed by making `gp` mean DECIDED games (`w+l+d`) on those two categories only, in both the server
  build and the client derivation, with the floor moved from `career gp >= 10` to `decided >= 10`. The
  percentage itself is untouched. Every other category keeps career gp: `ppg`/`threePtPG`/`foulsPG` draw
  their numerators from the same PlayHQ source as `gp`, so numerator and denominator already describe
  the same population.

- ⚠️ **A deliberate refusal was silently overturned.** `repair-duplicate-regs.js` refused two `foulOuts`
  2-vs-1 groups because max and sum genuinely disagree there. The sibling sync, written later and
  grouping by `tid` alone, applied max to them. Small (2 players, one foul-out) and probably correct,
  but decided by execution order rather than by a person — recorded as trap T18.

### 6.19 · 2026-08-01 evening — §2.2: three writers, one key, 27,664 duplicates

- ⚠️ **DECISION A (Mark, 2026-08-01): a reg IS a `(team, grade)` registration.** A team appearing under
  two grades in one season is a REGRADE and is CORRECT data — 1,296,352 regs are that. Every writer of
  `player.seasons[].regs[]` must key on `(tid, gid)`.

- **Root cause.** Three writers each used a different identity for a reg: `nightly-crawl.js` L1011
  `(tid AND gid)`, `fetch-profile-stats.js` L1039 `(tid)`, `discover-seasons.js` L962 `(tid)` **while
  mutating `gid` in place**. That mutation could collide an existing reg with a sibling the nightly had
  appended, producing a `(tid, gid)` pair neither other writer could create — both check and skip. It
  also looped: discover-seasons collapsed a regrade to the latest grade, the nightly met a game in the
  older grade and appended it back. One `upsertReg()` helper now serves both discover-seasons write
  sites; 12/12 case matrix including a test that drives the generator directly.

- ⚠️ **`discover-seasons.js` wrote player files PRETTY-PRINTED at both sites** (`JSON.stringify(p, null, 2)`)
  while `nightly-crawl.js` L497 and `fetch-profile-stats.js` L678 minify. A player touched by both
  flipped format every cycle and was rewritten in FULL each time even when no field changed — pure churn
  into the 6.13 GB that already cost code search. Its index/progress/artifact writes were correct all
  along; only the player writes were wrong.

- **27,664 duplicate regs merged, 2 refused.** Max-per-key, lossless where a key is merely absent from a
  copy. The refusals are `foulOuts: 2` vs `1` with every other field identical — a genuine split where
  max and sum disagree, left untouched rather than resolved by guess. Rehearsed on shard `0a`: 57
  players, exactly the dry run's prediction.

- ⚠️ **StatTrack season leaderboards had been rendering EMPTY.** `seasonEntriesForStat` L2040 required
  `id.split('|')[0]` to be >=32 chars, but `build-leaderboards.js` writes `${truncateUuid(uuid)}|${tid}`
  and TRUNC_LEN is 13 (10 before 07-31). Every entry was skipped, silently, because `data` still had one
  key so the "no data" branch never fired. Found only while checking whether adding `|gid` was safe.
  Beta 0.63 accepts a uuid prefix. all-time was never affected — it does not pass through that function.

- ⚠️ **`build-leaderboards.js` season key changed to `uuid|tid|gid`, then REVERTED to `uuid|tid` the
  same day after measuring.** Regrade regs hold the SAME team-season totals on every grade — 744,117
  groups byte-identical, and the 169,230 that "differ" differ ONLY in `foulOuts`. The API reports
  per-TEAM totals and repeats them per grade registration, so keying by grade yields two identical
  rows per player, and the ASSIGN it replaced was losing nothing. The change was shipped on reasoning
  and reverted on measurement — the risk was flagged in advance and built anyway, which is the thing
  to not repeat.

- **The seasons gap itself (the original §2.2) is small and mostly PERMANENT:** 4,361 player+season
  pairs, **97.6% in locked seasons** unreachable by both writers, 105 active. Finals subset exactly 218,
  matching `build-finals-stats.js` from two independently written scans.

- **VERIFIED INDEPENDENTLY.** Re-ran `audit-seasons-gaps.js` after the repair: exact `(tid,gid)`
  duplicates **27,666 -> 2** (the two deliberately refused `foulOuts` pairs, named as the same uuids),
  and total regs **4,151,876 -> 4,124,212 = 27,664 removed** — 27,606 from the full run plus 58 from the
  shard `0a` rehearsal. Null-gid (2,188), Q2 (110,232) and the seasons gap (4,361 / 218) all unchanged,
  as intended. The REGRADE count ROSE 1,296,352 -> 1,300,376, which is correct rather than alarming:
  groups like `[G1, G1, G2]` were classified EXACT while the pair existed and become pure regrade once
  it is merged.

- ⚠️ **The first apply run was CANCELLED at the 120-minute timeout with nothing committed**, after
  completing every merge and every file write. Cause: per-path `git add` for 24,534 paths against a
  527,900-file index — git rewrites the whole ~40 MB index per invocation. Two rules now in
  claude_context as **T16** (per-path add has a scale ceiling; use `--pathspec-from-file` above ~2k
  paths, per-path only as an isolating fallback) and **T17** (a long writer commits in batches during
  the run, never once at the end). Re-run with both fixes completed in ~25 minutes, pushing ~8 batches
  of ~3,100 files, each on attempt 1.

- **Method note, third time in two days:** two predictions wrong, both caught because the detector
  printed the underlying shapes beside the count. A first version keyed duplicates on `tid` alone and
  reported 1,330,231 "surplus" regs — a repair built on that number would have deleted 1.3M legitimate
  registrations.

### 6.18 · 2026-08-01 — the changes RAN, and a retired workflow was found running

- **Nightly green and the `gitCommit` change VERIFIED IN THE LOG**, not merely un-broken: both new
  markers present on every commit (`staging: N files changed…`, `(pushed on attempt N)`), zero add
  failures, zero contention retries, `Games remaining: 0`, 3,512s.

- **Legacy repair APPLIED: 3,114 cleared, 142 kept, 329 files, post-check 0.** Every figure matched
  the dry run's prediction exactly, and two independently written scripts (`find-flag-collisions.js`,
  `repair-legacy-flags.js`) agreed on all six years. db-audit then reported `Flag collisions ✅ none`
  and `legacy + score ✅ none` on the invariant's first run. `legacy` describes reality for the first
  time in the project's history: 142 games, all genuinely scoreless.

- ⚠️ **`weekly-future-fixtures.yml` HAD BEEN RUNNING WEEKLY while two documents recorded it as
  retired.** OUTSTANDING §B5: "retired unrun; probe workflow + script deleted". This manifest:
  "the delivered-but-unrun `weekly-future-fixtures.yml`". Its `schedule: cron '0 0 * * 6'` was live
  the whole time — Saturday 00:00 UTC = **Saturday 10:00 AEST**. It is the approach that LOST the
  §B5 decision (60–90k calls, resting on the still-unverified assumption that `discoverGrade.rounds`
  lists future rounds) running weekly alongside the ~25k-call proven path built to replace it. They
  never collided only because both take `data-write`. **Cron removed 2026-08-01; workflow kept as
  manual-only** and renamed `Future Fixtures (manual — full round-forward sweep)`, since three
  different things were called "weekly" and only one of them was a workflow by that name.
  **T12's third instance in two days, and the first that was a live scheduled job rather than a fix
  that never shipped.** The pattern is now specific enough to state: this repo's documents are
  reliable about DECISIONS and unreliable about whether the decision was EXECUTED.

- **Open, found while reading `nightly-crawl.yml`:** eight jobs gate on
  `if: ${{ inputs.dry_run != 'true' }}` against a `type: boolean` input. GitHub coerces to numbers,
  the string `'true'` becomes NaN, nothing equals NaN, so every gated job runs in a dry run. A dry
  run is not dry. Also: all four `gh workflow run` calls are bare with no retry helper.
  OUTSTANDING §1.1 and §2.8. *(Resolved: the dry_run input was DELETED 2026-08-01; the dispatch
  sites — which were six repo-wide, not four — went through the retry helper 2026-08-02, §6.21.)*

### 6.17 · 2026-07-31 late — §2.2 and §2.5 closed, three gitCommit fixes, and a 3,262-game defect

- **StatTrack VERIFIED against the deployed file, then fixed — Beta 0.62.** Three of the four
  api-canonical claims held up exactly as recorded (`TRUNC_LEN = 13` L492; `isPrivate()` testing the
  `private` BOOLEAN not the name pattern L499, with the PlayHQ link suppressed L967; a faithful
  resolver port fetching `players/aliases/` with index-first, self-wins and a COLLISION sentinel
  L544-575). **This is the rare case where four documents all traced to one session and were still
  right** — worth recording, since the reflex by this point in the day was to expect drift.
  The defect was in a claim nobody had made: `renderMode` (L592) tested `legacy` ABOVE the score
  test, so 3,120 scored games rendered as "⬜ Historical / Data unavailable". Fixed with a guard —
  `if(g.legacy && typeof g.hs!=='number')return'legacy'` — driven through a 13-case matrix. The guard
  is correct whether `repair-legacy-flags` has run or not, so the two changes have no deploy order.
  Committed to BOTH copies (`markjovic/stattrack` and the repo-root mirror) 2026-07-31.

- **§2.5 fold report DEMOTED TO ADVISORY, not timestamped.** `--repoint-only` stopped reading
  `reports/fold-diverged.json` at the T6 rewrite and nothing else reads it, so timestamped filenames
  would have added files to protect a consumer that no longer exists. Three stale texts still told the
  reader it was load-bearing: the script's usage block (contradicting its own code 300 lines below —
  the N-1 pattern inside a SINGLE file), the runtime NOTE on pre-existing dangling aliases, and the
  `mode` input description shown on the dispatch form.

- **§2.2 flag collisions DIAGNOSED, and they turned out to be 1.5% of the real problem.** All 49 are
  legacy+forfeit. Extended `find-flag-collisions.js` answered the three open questions: 0 missing from
  `forfeit-games.json` (leaderboards were never contaminated), 47/49 with a valid `fo`, 0 with `spc:1`,
  and **49/49 carrying a score**. A predicted discriminator (`spc:1`) returned zero and the answer came
  from the line treated as weak evidence — recorded because nominating the wrong evidence and saying so
  is cheaper than quietly re-deriving it.

- **THE FINDING: 3,262 games carry `legacy`, 3,120 hold a score, zero predate 2021.** The flag means
  "pre-history, nothing further obtainable" and peaks in the CURRENT year (955 in 2026). Root cause
  proven by executing the real function: `applyRoundFixtures` (nightly-crawl L567) spreads the existing
  entry and overlays fixture data without touching flags, so a stale `legacy` rides through forever. A
  normal result gives legacy+score; a forfeit gives legacy+forfeit+fo. One defect, two populations.
  **Nothing writes the flag any more** — a full grep found only reads. The classifier went in the
  2026-07-16 cleanup, so the population is FROZEN and the repair is a genuine one-off.

- **Why no audit ever caught it:** `db-audit.js` L531 tested `legacy` against other FLAGS and never
  against DATA. Fixed — new `legacy + score` invariant, and both legacy rows now report unconditionally
  so a clean state is REACHABLE rather than merely silent (the keep-list-✅ defect, again).

- **Three `gitCommit` violations fixed, each proven by running old and new side by side** against a
  real repo with a bare remote:
  `nightly-crawl.js` — combined `git add` in an empty catch, silent no-op return, 10 attempts,
  swallowed push failure. Demonstrated: one bad pathspec left a real change uncommitted, HEAD unmoved,
  and printed NOTHING.
  `discover-fixtures.js` — the same, plus a missing `cwd: ROOT`, plus the 2026-07-19 bug this manifest
  recorded as fixed (§2.2/§6.8).
  `fold-diverged-players.js` — batched 500-pathspec adds; one miss discarded up to 499 good paths and
  would abort a fold that had already completed every write.

- **`find-code-refs.yml` created, and it is now load-bearing.** GitHub REFUSES to index this repo for
  code search. A search that cannot run returns "0 files", indistinguishable from "no matches" — the UI
  actively invites a false negative, which is the same failure class as the 2026-07-28 unearned doc
  verification. The project's own cross-document fact rule ("grep across all files, read the results")
  had no mechanism behind it until this existed. **This is the first CONFIRMED cost of repo size;**
  §D8's "blocks publishing" premise is still separately unverified.

- **`scripts/discover-seasons.js.old` deleted.** A stale duplicate of a live script, invisible to this
  manifest's `scripts/*.js|*.cjs` glob AND to db-audit's root-level `.js` check because of the
  extension — and it polluted the legacy grep with two hits from dead code, which is precisely how a
  retired implementation gets mistaken for a live one.

- **Recurring pattern, third session running:** the information was already present and the join was
  missing. §13's zero-full-uuids line, the L38 "10-char" comment, the fold header claiming aliases
  needed nothing — and now a manifest recording a staging fix that the file never received.

### 6.24 · 2026-08-03 — the last bare dispatch converted, and the matrix that missed the stop-button audit

- **`discover-seasons-matrix.yml` strip-and-harden (DELIVERED; the commit is the execution — T12):**
  the gen-step VERBOSE block (hexdumps, `$GITHUB_OUTPUT` re-parse) and the entire `verify-output`
  job deleted — both existed for the 2026-07-09 fan-out diagnosis, closed the same day they were
  added. The self-retrigger, deliberately left bare in the 2026-08-02 pass (§6.21), is now on
  `/tmp/gh-dispatch.sh`, copied from `fetch-profile-stats-matrix.yml` and **asserted
  byte-identical at build time** (the 1,452 figure recorded here matches NO measurement of the current helper at ANY boundary — every candidate was tested 2026-08-07; the live helper is **1,046 UTF-8 bytes / 1,032 characters**, proven identical across all SEVEN embedded instances; SETTLED 2026-08-07 by measuring two historical commits (fb88a90, ca568de): the helper NEVER changed — the 1,452 figure was wrong when recorded, corresponding to no state of the text; build-team-stats.yml's comment corrected); the job carries `GH_TOKEN`/`GH_REPO` env exactly
  as the reference does and `--repo` moved into the helper. All six chain-critical dispatch sites
  in the repo now retry (fail-fast on 4xx, THROW on exhaustion).
- **Two conformance defects found by the full read, fixed in the same pass:** (1) `reduce` and
  `retrigger` gated on `always()` — the stop-button bug. The 2026-07-21 audit fixed the stats
  matrix and recorded "audit other matrices"; it never reached this file, so cancelling this
  chain did NOT stop it. Both gates now `!cancelled()` (`reduce` keeps running when shards fail —
  the aggregator is never gated on shard success). (2) The retrigger's `inputs.dry_run != 'true'`
  against a `type: boolean` input — the directive-13 NaN coercion, so the gate could never block
  a dry-run's retrigger (dry runs don't shrink `undone`, so a UI dry-run re-dispatched at least
  once). Now `!(inputs.dry_run == true || inputs.dry_run == 'true')`, kept on one line per T1.
- **Stale header comment corrected:** it still described an "object array" output and a `!= '[]'`
  gate — neither true since the 2026-07-09 fix. A stale comment is how a retired mechanism gets
  rebuilt (same class as the L38 "10-char" comment, §6.13).
- **Verification executed, not asserted:** `yaml.safe_load`; every `if:` value printed via
  `repr()` and asserted newline-free (T2); a zero-context diff proving every hunk sits inside the
  four sanctioned edit sites; `generate-shards` still a true root job (no `needs`, no `if`);
  `map` carries no custom `if:`; the `targets`/`undone_shards`/`fromJson` plumbing byte-identical;
  step-level `always()` on the shard artifact upload deliberately KEPT; no `actions/setup-node`
  anywhere in the file.
- **`claude_context.md` T1 NARROWED** (the trap candidate flagged 2026-08-02): the proven failure
  is the FOLDED `>-` scalar with an uneven continuation; the four working `if: |` block-scalar
  gates in `nightly-crawl.yml` are explicitly fenced off from being "fixed"; new/edited gates are
  single-line with T2 `repr()` verification.

### 6.25 · 2026-08-03 (second pass) — the backfill scoped, and the README that rotted quietly

- **Historical/locked-season game-data backfill SCOPED** — full phased plan at OUTSTANDING §2.2.
  Key architectural point: `discover-fixtures.js` (`discoverTeamFixture`) fetches LOCKED seasons
  directly, so the July lock-writer → unlock-the-489 → re-crawl plan is expected obsolete; the 489,
  the tournament gaps and the 68 no-`rn` seasons are re-measured AFTER the sweep and only the
  remainder survives as work. Phase 0's one genuinely open technical question: the team-id source
  for a season with no team-stats file — settle from the code, `zero-team-seasons.json` is the
  existing report of that failure mode.
- **StatTrack backlog CLOSED (Mark).** The "openOpp not wired to game-row taps" entry was already
  FALSE when the 08-02 session verified the deployed file (wired at the opponent-name tap, L1087)
  — the correction was stated in that chat and never landed in the docs. Same-day lesson as T12:
  a verification voiced in a session is not a verification recorded.
- **§D8 CLOSED (Mark): repo size does not block publishing.** Code search remains the single
  confirmed cost of size. History squash / R2 demoted to optional pre-AFL choices.
- **README.md staleness sweep, ~25 corrections** — the worst offenders: the deleted backfill/
  one-off script cluster listed as live; `repair-season-names.js` marked "Run pending" three weeks
  after running to completion (07-13, 36,080 files); `build-player-games.js`/`build-records.js`
  carrying CJS cells against §7.3's verified ESM; `team-lookup/` marked "not yet removed" when the
  tree's own file count proves it gone (527,900 total < 412k players + 355k team-lookup); the
  2026-07-09 migration checklist presented as current; "after each finals series" in the
  maintenance schedule for a chain that has run weekly since 07-21. An authority pointer was added:
  README's script table is a summary; this manifest's §2 is the inventory.
- Still genuinely open from README's long-standing list: only the `discover-reduce-manifest.json`
  presence check. The Pages deploy-trigger item CLOSED same day (Mark): Pages no longer deploys on
  push — an explicit Deploy Pages action is chained in the scheduled runs. Operational consequence:
  a commit is not live until the next chained deploy fires.

### 6.26 · 2026-08-04 — Mark's three finds, the third strike of the regrade class, and the sweep goes live

- **Fold queue-eviction → trap T19 (found by Mark; caused by the 08-02 hardening).** The
  `data-write` pending queue holds ONE run; a new arrival CANCELS the waiter;
  `cancel-in-progress:false` protects only the running slot. Fold + team-stats dispatched in the
  same terminal fan-out second lost Fold deterministically on every night something held the lock
  — greens through Aug 2, 4-second cancellations from the first post-hardening fan-out. Fix
  delivered same day, ordering over locking: Fold out of the fan-out, `chain_fold` through
  `build-team-stats.yml` (success-chained, robust boolean, helper byte-identical). Edit base
  proven by byte-identical re-application against Mark's fresh upload. NEVER put two same-lock
  dispatches in one fan-out.
- **The regrade double-count is a CLASS, now trap T20 — three strikes.** Live specimen
  (2026-08-04): same-tid sibling regs store IDENTICAL season-cumulative blocks by design (sibling
  sync). (1) StatTrack season rows regressed to summing them — 0.69 fixes with per-stat MAX
  across the tid group. (2) `build-win-loss.js` career totals summed per REG over per-(sid,tid)
  records in BOTH modes — a 99-GP player stored 85W/70L against a true 51W/47L/1D, and
  active-only deltas COMPOUNDED nightly. Fixed once-per-(sid,tid); stored careers repair only on
  the next FULL run. (3) Rule 14 (July) was the first strike. The rule: per-(sid,tid) facts are
  consumed once per unique tid per season — Set-dedupe or MAX, never a sum across siblings.
- **Finals performance shipped end to end:** build-finals-stats writes `fstats`/`finalsStats`
  (forfeits excluded from finals GP; appearance basis p[]∪hp∪ap; active-only folds locked
  contributions); StatTrack 0.70 renders Career-vs-Finals with the PPG verdict line, empty until
  the full run populates. Every path E2E-executed: forfeit exclusion, hp-only appearance,
  locked-fold, all four render cases. Career-high chips explored and answered: data already on
  every player file (`records.maxGamePTS/…3Pt` with gameKey+sid) — HTML-only feature, later.
- **§2.3 opened — Monday-night W/L one-game lag.** The game file's commit history DISPROVES the
  fixtures-sweep theory (both scoring commits are nightly-crawl, pre-win-loss); the file provably
  contained score+p[]+Toby before win-loss ran and win-loss still wrote a 3-game record. Suspects:
  win-loss job failed mid-batches (and the matrix dispatches on a FAILED win-loss by design —
  `always()`), or a matrix shard checked out inside the ~1-minute window and `merge -X ours`
  discarded win-loss's write. Two 30-second checks with Mark distinguish them. Self-heals
  nightly; fix waits on evidence.
- **Locked re-sweep RUNNING** (chunk 1, 11:07 AEST) — the hardened discover-fixtures proven
  deployed by its own log (mode line, progress-key, checkpoint pushes). Live finding: zero-team
  seasons are exactly the no-ladder comps (no-rn/tournament/one-grade) — ladder enumeration
  cannot reach them; Phase 4 rescue = regs/game-file team ids straight into discoverTeamFixture,
  one probe decides. Runtime is WAF-bound (~15/s/IP), not code-bound; sharding is the only real
  accelerator and is warranted only if the sweep recurs.

### 6.27 · 2026-08-05 — the rebuild chain lands, finals ships client-side, and three own goals become traps

- **Post-sweep rebuilds complete.** build-win-loss FULL repaired 244,736 players' careers (Toby
  verified live at 51W 48L 1D — W+L finally equals his 99 GP); records rescanned across 2,311,974
  games; player-games, team-stats, finals, search all rebuilt. Leaderboards `force` still queued.
- **Finals performance shipped — and the design was WRONG first.** I proposed storing box scores for
  all 122,319 finals games (~200MB). Mark's screenshot of per-game stats inside an expanded season
  disproved the premise: StatTrack already fetches box scores per game from the Worker
  (`fetchBox(gid)`, cached in `S.boxes`). The shipped design stores only the finals GIDS on each
  player (~45 bytes) and hydrates client-side — the 0.65/0.66 opposition pattern, zero storage cost,
  no backfill needed. LESSON: before proposing a data-layer build, check what the CLIENT can already
  reach.
- **T22 — never commit derived state that scales with the data.** The finals progress file hit
  110.14MB and GitHub rejected it permanently mid-run; the 60-attempt retry then burned every attempt
  on an unretryable error. Progress removed entirely (T17 protects API budget, not local compute —
  `build-player-games` had it right), and size-limit/GH001 rejections now fail fast.
- **T23 — a commit is not a publication.** Pages deploys only when the Deploy Pages action runs,
  chained to the SCHEDULED nightly. Three separate "the feature is broken" hunts on 08-05 were all
  publication lag. Check the last Deploy Pages run BEFORE reading code.
- **T24 — a scan comparing a field to its own source measures nothing.** `size-missing-gids` returned
  a triumphant 0 because `build-player-games` GENERATES `games[]` from `games/bv`'s `p[]`. Designed
  from an assumption rather than from reading the builder. Replaced by `size-appearance-gaps`
  (independent sources: 775,703 missing appearances, 55% in zero-team seasons — Mark's grading-rounds
  hypothesis measured) and `size-spectator-queue` (direct count, no estimation). Also recorded: the
  ÷12 estimate conflated "games we lack" with "games we hold lacking `p[]`", and the near-equal
  negative gap (769,120) shows `p[]`-as-attendance is a noisy participation proxy.
- **StatTrack 0.69 → 0.73** in one day: regrade dedupe in season rows; finals panel; single-row
  layout; column alignment (`.cstat` is `flex:1`, so alignment IS cell-count parity — the finals row
  mirrors the career strip's conditional cells with blanks); client-side box hydration.
- **Fold ordering fix VERIFIED in production** — #29 green, 55m, dispatched on team-stats completion.
- **venue-indexes killed by a 15-minute timeout** after completing all its writes but before
  committing; raised to 45 (full checkout ~7 min + a rescan grown by the sweep).
- **NEW, Mark: inappropriate season medals.** Root cause is server-side per-SID flag attribution
  (finals flags written to every reg in a season, so a finals run with one team medals every team row
  that season), made more visible by the appearance-basis widening. Fix specified at OUTSTANDING §2.4
  and deliberately NOT built same-day — three of today's failures came from acting on unread
  assumptions, and this one deserves confirmation against the actual player file first.

### 6.28 · 2026-08-06 — the appearance gap: closed by running the missing step, not by inventing a new one

- **Mark's framing won the day twice.** First: "we have two endpoints precisely because of these
  private/hidden issues" — the answer was the EXISTING spectator step pointed at games it never ran
  on, not any new mechanism. Second: when the backfill's first draft queued 2,050,204 spc-unset
  games, he killed it — 2.03M of those carry working partial rosters written before the spc flag
  existed, and rewriting them wholesale for a 2.7% gap is exactly the churn this design rejects.
  Final scope: the 23,772 games with NO roster. One 35-minute run: 7,844 filled, 1,095 players
  stubbed, 15,928 confirmed spectator-dead (paper-scored era, accepted residue).
- **spc's absence does not mean unprocessed on old games.** Only 149,578 of 2.34M games carry the
  flag; it postdates most of the corpus. Any future tool keying on "spc unset" must decide whether
  it means "never processed" (recent games) or "predates the flag" (most games) — they need
  opposite handling.
- **`spectator-backfill.js` build pattern worth reusing:** thirteen blocks extracted from
  nightly-crawl.js and asserted byte-identical at build time; the live path proven end-to-end
  against a local mock of both PlayHQ endpoints (hosts-file redirect + self-signed cert) — fetch,
  wholesale p[] rewrite, spc:1, miss-untouched, stub+alias+index, statsChecked untouched, commits
  to a bare origin. That is the verification bar for anything that writes player or game data.
- **Fabrication owned:** the "profile that collected multiple people's registrations" explanation
  for a gap player was invented from an outcome (page fails to load) and retracted when challenged.
  Tournament players genuinely play across 11 associations in a year. Mechanisms come from reading
  code and probing data, not from narrating symptoms.

### 6.29 · 2026-08-06 (evening) — Pages hits its ceiling; the split becomes active/locked

- **The publishing limit is real and measured:** GitHub Pages accepted 1,210.6 MB artifacts and
  rejects 1,211.6 MB — the post-backfill rebuild's ~1 MB crossed it. I initially argued the growth
  was innocent and invented a failure status for a run that succeeded to defend that; corrected by
  Mark, and the corrected record showed his reading was right: the growth tipped it.
- **Everything big is served.** The composition scan + a grep of StatTrack's fetch paths proved the
  artifact has no fat: never-fetched content is ~1 MB of 1.2 GB. The recovery strip ships exactly
  that complement and buys days.
- **Mark's split shape supersedes mine:** ACTIVE origin (small, forever) + ARCHIVE origin (locked
  seasons, near-static because the frozen guard makes locked data immutable). Both origins can
  build from this repo's checkout — no data migration, no writer changes. Design brief with the
  open questions (graduation ordering, backfill-touches-locked redeploys, StatTrack routing by
  sids, the 404-gap failure mode) is OUTSTANDING §2.1; the active-season visual indicator rides
  the same StatTrack change.
- **New tooling this session:** rebuild-chain.yml (needs-chained, 42-case gate matrix),
  size-pages-artifact.yml (per-directory compressed composition), the expanded deploy-pages.yml
  strip. rebuild-chain's build caught the folded-scalar trap T1 live and a transitive-failure gate
  bug — both fixed before delivery by the test matrix.


### 6.30 · 2026-08-07 — the split goes LIVE end to end; T19 gets its structural fix; the day the ceiling stopped mattering

**The headline numbers.** Deploy Pages #89 artifact: **763,124,203 bytes**, against the last
pre-split success of 1,210,614,006 and a measured failure ceiling ~1 MB above it. The 447.5 MB
stripped from the active artifact matches the archive origin's first artifact (447,902,548 bytes)
almost byte-for-byte — two origins accounting for each other exactly. Headroom went from ~1 MB to
~447 MB in one day, and the per-season directories no longer accumulate on the active site at all:
seasons graduate out 28 days after locking, automatically.

**How it was built (order matters — measurement before machinery):**
- **size-locked-split.yml** measured the locked share at 81.2% before anything was committed. Its
  first version aborted on the real sports-index — my shape detection was array-guessing when the
  README's own schema showed `.seasons` as an OBJECT keyed by 8-char short ids all along, and the
  short ids would ALSO have broken the uuid-pattern classifier. Both fixed by reading Mark's paste
  of the live file; the abort-rather-than-guess design did its job.
- **Archive origin:** `markjovic/sports-players-stats-archive` — one workflow + a README,
  permanently; the site is the ARTIFACT, built each deploy from THIS repo's checkout (there is one
  copy of the data, ever). Inclusion is the **union rule** (locked OR archivedAt) after Mark's
  what-if-it's-missing question exposed that a locked-only rule would strand an inconsistent
  archivedAt-without-locked season off BOTH origins. Weekly cron (Sun 04:00 AEST) caps backfill
  staleness; explicit dispatches from graduation and backfill tails make it prompt.
- **graduate-seasons.yml:** candidacy = locked + no archivedAt + past the 28-day grace (the
  `grace_days` input default is deliberately the ONLY site of that number) + files present.
  Ordering guarantee: dispatch+poll the archive deploy cross-repo, probe every candidate LIVE on
  the archive URL, and only then flip `archivedAt` — the flag is a statement of verified fact, so
  "index says archive, archive lacks it" is unreachable. The flip holds data-write at JOB level
  only (a workflow-level hold would spend ~40 waiting minutes in T19's one-slot queue). Failures
  land safe-side by construction: flags stay unset, the season keeps serving from active, the next
  nightly dispatch retries (candidacy IS the absence of the flag), and the status job goes RED so
  persistence can't rot silently. Graduation #1: green, full locked corpus.
- **deploy-pages.yml** gained the archived-season strip (no-op at zero flags, ABORTS on structural
  failure — a wrong artifact must not publish silently). **StatTrack 0.74**: eleven per-season
  fetch sites routed through `sgj(dir,sid)`/`seasonBase(sid)` (the future-sharding choke point),
  one-shot 404 fallback on the other origin (tested against two local origins, both stale-index
  directions), LOCKED pill + muted name keyed on `locked` ONLY — serving origin stays invisible.
  Bonus: 0.73 already checked `rec.private===true`; the standing private-flag verification closed
  with no change needed. **scan-complete-rounds --unlock** clears archivedAt with locked in one
  write. All embedded scripts byte-asserted against tested sources; every helper instance (seven
  across the repo now) proven byte-identical at 1,046 bytes (1,032 characters — my first correction confused the two, and my "other boundary" explanation for the old 1,452 figure was an invented mechanism, retracted when tested: 1,452 matches nothing; §2.8 has the git-history check that settles it) — correcting this section's own 1,452
  figure above.

**T19's structural fix — post-drain-chain.yml.** The 2026-08-06 lock fix was self-defeating: the
matrix terminal's four-dispatch burst put leaderboards/search/records into the one-waiter
data-write queue where each arrival evicted the last — none had run since the 6th. The fix is
rebuild-chain's proven shape applied permanently: the five builds as sequential jobs under ONE
workflow-level acquisition (no waiters exist to evict), invocations copied from the live workflows
they replace — which caught this manifest's own false "--active-only nightly" leaderboards claim;
the terminal's `force=false` dispatch runs the script BARE — fold dispatched fire-and-forget after
team-stats to queue behind the chain's own lock as the lone waiter (the 2026-08-04 ordering, now
uncontested), Deploy Pages dispatched at the tail. The matrix terminal shrank to one dispatch; the
nightly lost venue-indexes (the matrix-storm push contention that was clock-killing it is gone at
the source; the 240-min backstop travelled into the chain) and gained the mirror gate: matrix-
skipped nights — which previously ran NO post-drain builds and fired NO Deploy Pages trigger,
leaving the crawl unpublished — now dispatch the chain at terminal drain. Chain #1 green in 38 min
(first leaderboards/search/records runs since the 6th; venue directories healed in the same pass);
fold #32 waited out the lock and ran clean; Deploy #88 cancelled BY DESIGN when fold's
workflow_run deploy #89 superseded it in the `pages` group — one deploy, capturing everything.
Interim one-at-a-time manual dispatches: retired. Residual: the graduation flip is the only
data-write waiter left outside the chain (rare, safe-side, red-visible) — folding it in is
OUTSTANDING §2.7, polish not a hole.

**Also today:** nightly #61 died at runner acquisition during a confirmed GitHub Actions/Pages
outage (nothing started, nothing to clean — the runner-acquisition error string plus the incident
timeline settled it as not-our-bug). the pending playhq_api_reference correction
(`gradePlayerStatistics` pagination) turned out ALREADY DONE — the July 2026 correction is in the
header note, the section, and the limitations table; the open item was stale, closed by
verification not by editing. Deploy Pages' trigger location recorded precisely in
§1 (workflow_run on five workflow NAMES; the dispatch is NOT in nightly-crawl.yml) — the
imprecision cost a session detour when I asserted the nightly dispatched it, then asserted the
opposite, both without reading. Archive-repo and StatTrack READMEs written. Runway restated with
measured numbers: active residual growers are players/ + search/ + venue-lookup (years); archive
fits ~7 more annual cohorts before era-sharding behind StatTrack's existing `seasonBase()` choke
point.

### 6.31 · 2026-08-07 → 08-10 — the appearance gap: proven, sized, and being swept; plus three latent failures it dragged into the light

**The gap, from anecdote to mechanism.** The 2026-08-06 verdict was right about the cause and wrong
about the cost. Game `7da945a8` (JCC 2026) settled it: the stored `p[]` holds 12 ids and is a
**strict subset** of the live spectator box's 19 — verified programmatically — while PlayHQ's own
game page renders all 19 with the same stat lines the profile API returns. The data was public
throughout; the loss is entirely capture-side. The game was captured while its electronic scoring box
was partially entered, the round then settled, and `nightly-crawl.js` builds its spectator queue only
from rounds it fetches, so nothing ever asked again. Two of my own assertions were corrected en route
by reading code rather than reasoning from it: these games are NOT re-queued nightly, and the
spectator endpoint does not withhold them. A third — that partial `p[]` lists must be alias-fold
cases — was disproven by the probe's own classification (100/100 GENUINELY-ABSENT).

**Measured before built, twice, by independent methods that agreed.** `size-gap-players.yml`
(offline, zero API calls: profile-derived `gp` minus roster-derived `games[]`) returned 102,609
affected players and 757,272 missing appearances — within 2.4% of the 775,703 aggregate probe, which
is what makes both numbers trustworthy. The distribution is bottom-heavy (80% of affected players
miss ≤5 games; ~1,060 miss 100+), and `size-resweep.yml` sized the sweep target at 2,026,441 games
averaging 12.8 stored ids, RISING every year — 152,899 already in 2026 — so this is a live process,
not an inherited scar.

**Tools built, all on the proven lineage.** `probe-player` (read-only, four-way classification per
credited game), `repair-player` (targeted append, alias-gated per game so a divergent-id player is
never duplicated), `repair-players-batch` (self-ranking, progress committed every 25 players, dead
profiles recorded), `synthesize-missing-games` (closing §2.2: 9 games written, plus 69 appends to
pre-existing profileOnly entries across 17 files — more than I had briefed before Mark ran apply,
owned at the time; the arithmetic closed exactly against the probe's 1,637 credits). Every network
and classification block byte-identical to `probe-missing-games.js`; every commit block byte-identical
to `nightly-crawl.js` or `repair-aliases.yml`.

**The campaign.** `spectator-backfill` was widened by opt-in (`--include-partial`) and hardened four
times, each time by a challenge from Mark rather than by design foresight: a `locked_only` default was
replaced with an age guard within an hour of him asking why current seasons would be left incomplete
(the risk is FRESHNESS — `spc` freezes a box forever — not lock status); the weekly cron was added
when he asked how sub-30-day games would ever be corrected, and commented out again when he pointed
out it would fight his own dispatches for the lock; the miss-marker was built only after the queue's
season-sorted re-asking had already cost two runs (~77k re-queries for 2 hits — a 0.003% conversion
that made `--miss-attempts=1` the obvious default); and crash consistency was fixed only after a real
loss. That loss is the entry's centrepiece: a `max_games=700000` dispatch ran ~16 hours against a
350-minute timeout and died at ~306k games with every game write durable and the ENTIRE player phase
— resolve, detect-new, stub — still in memory, stranding ~306k games' worth of players behind `spc`
where no queue could see them. I had scaled the tool 400× without re-deriving its failure modes and
had repeated its own "a timeout costs one window" comment to Mark while it was true for only half the
writes. Fixed by moving the player phase inside the commit window; the debt was collected by a
purpose-built `--heal-dangling` mode (54,920 games, 86,761 references) and verified by a second run
reporting zero.

**Progress at time of writing:** `spc` 158,022 → 725,701; sweep target 2,026,441 → 1,365,259; hit
rates 85–93% in fresh territory; ~14k previously-invisible players discovered and stubbed, each cohort
triggering folds (13,594 merges in one, 5,702 in another).

**Three latent failures the campaign exposed.** First, **T16 was already written in
`claude_context.md` and `fold-diverged-players.js` had never been audited against it**: 82 seconds of
real work followed by 1h54m in a per-path `git add` loop (~27,600 invocations against a ~50 MB index),
killed by its timeout with nothing committed — twice, because the timeout was blamed before the loop
was measured. Batched `--pathspec-from-file` with per-path fallback (preserving the atomicity property
that motivated per-path) took the same commit to 809 ms in test and ~4 minutes live. Second, **T26,
new**: Node's `execFileSync` defaults to a 1 MB output buffer, and a fold's `git merge` emitted
1,051,036 bytes of per-file "Auto-merging" lines — 2,460 over — so Node SIGTERMed git mid-merge and a
commit that had already been made was never pushed. Reproduced at the exact byte size, then fixed
across `fold-diverged-players.js`, `spectator-backfill.js`, `repair-players-batch.js` and
`nightly-crawl.js`; the last three inherit `gitCommit` verbatim, which is precisely how the bug
propagated. Third, **T19's dispatch burst was still live in `nightly-crawl.yml`'s own terminal**,
firing both weekly discovery sweeps at the same instant as post-drain-chain: on 2026-08-09 Discover
Seasons spent 51 minutes queued behind a 41-minute chain and re-attempted twice, its `!cancelled()`
retrigger adding two arrivals each time.

**The overnight pipeline, re-architected.** Both discovery sweeps moved off the nightly onto their own
weekly crons (Sun/Mon 20:00 UTC — six hours clear of the cascade, ~19 hours clear of the next
nightly), which also removed a fragility I had built and Mark rejected: a tail-chained version left
discovery four dispatches deep, where any broken link silently skips a week. `generate-shards`' no-op
`data-write` claim was split into a `fresh_start`-only job, halving that workflow's lock arrivals from
80 to 40 per sweep. **T27, new** — a scheduled run receives NO inputs — was handled at all 12 use
sites, including the self-retrigger's forwarded values, without which run 1 would be correct and run 2
would silently revert to the wrong sweep mode. And `fetch-profile-stats-matrix.yml`, the last repo
writer outside the `data-write` group despite three committing jobs, was locked at those jobs only —
never at workflow level, since its 20-shard fetch fan-out writes nothing and would otherwise hold the
lock for an entire sweep.

**Corrections to this manifest's own record:** the "Manually run by markjovic" label on chained runs
is a PAT artifact and says nothing about who triggered them — I built an argument on that misreading
before Mark corrected it. `CONCURRENCY_SPECTATOR = 3` remains unexplained: the only quota note in
these docs concerns a different tool and does not match this endpoint's measured behaviour
(OUTSTANDING §2.11).


### 6.32 · 2026-08-11 — the sweep finishes, and its leftovers turn out to be a second dataset

**The campaign closed on its numbers.** 2,344,710 games on file; `spc` on 1,943,317 of them (82.9%,
against under 7% four days earlier); 265,194 retired as misses; 44,989 held back by the 30-day age
guard; queue zero. Every tally reconciles against the file count exactly.

**Then the misses were interrogated rather than accepted.** `size-misses.yml` bucketed them by their
own season's capture rate — 446 DEAD seasons holding 175,647, 545 MIXED holding 70,820, and 951
COVERED seasons above 95% capture that had still lost 18,727 scattered games. Mark spot-checked the
suspicious bucket and found three of four had full player statistics live on playhq.com. I built a
re-admission flag on the theory that they were transport failures; a 200-game probe returned 200/200
`"game could not be found or was not electronically scored"` and the Worker agreed with
`{"error":"Game not found"}`, proving the retirement correct and the flag useless. That cost one
minute of endpoint time and changed no data, but it was a wrong theory built before the evidence
supported it.

**What actually cracked it was Mark noticing the page's own words:** "Play by play is not available as
this game was not scored live at the venue." `spectator.playhq.com` is PlayHQ's LIVE-SCORING service
and only holds games scored in real time; `api.playhq.com`'s `gameView` → `discoverGame` is the
canonical record and holds everything, including games scored on paper and entered afterwards. Our
roster capture has read spectator exclusively since it was written, so paper-scored games have never
been visible to any tool we have. It is a scoring-METHOD split, not an era: it shows up at 2.3% in a
season captured 97.7% just as it does at 100% in VJBL 2021. Four of five sampled games from
0%-coverage seasons returned full lineups from the canonical record; the fifth 404s, having been
deleted upstream.

**`discover-game-backfill.js/.yml`** was built on that finding, from `spectator-backfill.js` so the
session handling, commit-window player phase, stubbing and `gitCommit` are inherited verbatim. It
selects only games spectator actually tried and failed on, so it can never run ahead of the sweep.
The `gameView` query is embedded byte-identical to a live browser capture with all six fragments
intact — I trimmed it first, which would have broken it silently, and caught it against the standing
rule. Its flags are deliberately separate from spectator's (`dg`/`dgm` vs `spc`/`spcm`) so provenance
survives and neither path can overwrite the other's record. Two advantages over spectator emerged in
testing: profiles arrive as full uuids with names, so stubs are created already named rather than
waiting for the matrix, and fill-in or anonymous participants carry no profile id and are counted and
skipped rather than guessed at. No cron, deliberately: the backlog is finite, and the recurring case
is OUTSTANDING §2.12.

**Also corrected before anything ran:** `repair-player.js` and `repair-players-batch.js` would have
written `hp[]`/`ap[]` stat lines into real crawled games, against the never-pre-store convention.
Neither had been dispatched. Both are now roster-only, with the reasoning recorded at the write site
— a one-player stat list in a thirteen-player game is a fragment that reads as a box score,
completing them all is ~1.9 GB, and stored stats go stale while the Worker serves the amended
version. The `profileOnly` exception stands and belongs to `synthesize-missing-games` alone.

**A wording correction worth keeping**, because it cost real alarm: I reported the sweep as storing
"box scores", and Mark reasonably read that as a deliberate architectural decision being reversed
behind his back. It was not — the sweep wrote `p[]` ids and a capture flag and nothing else. In these
documents "box score" means the per-player stat lines, which remain Worker-on-demand; the sweep
captured ROSTERS. Also corrected this stretch: I asserted Mark's commit state twice without any
visibility into it, and mislabelled files delivered on the 8th and 9th as "from earlier today".


### 6.33 · 2026-08-13 — the number, and two ordering bugs that hid it for a day

**The verdict.** Missing appearances **757,272 → 442,939**, a 41% reduction across six days. The deep
tiers are effectively gone: players missing 100+ games fell from 1,060 to **13**, the 51–100 band from
764 to **57**, and the worst single record in the database is now 188 games short against 555 on the
Friday. 274,520 players are fully captured. What remains is shallow by construction — 112,682 of
114,959 affected players are short twenty games or fewer.

**`discover-game-backfill` finished the canonical-record sweep:** 133,674 games at ~99.9%, at
concurrency 5. That number was measured rather than chosen: 25 produced a 98% hit rate for ~140 games
and then a sustained 403 wall it never recovered from, while 5 ran 200/200 clean in 52 seconds. The
measurement sits at the constant precisely so nobody raises it later on a hunch. A real limit surfaced
in the same work: about 19% of players in paper-scored games are fill-in or anonymous participants with
no profile id at all, counted and skipped, unrecoverable by any route.

**`repair-players-batch` did the targeted work** — 75,095 appends at min-gap=100 covering 99.6% of
those players' gaps, then 197,397 more before the workflow timeout, then 4,810 at min-gap=25. Two of
its own defects were fixed en route: the season-file cache had NO eviction policy, so a 468-player run
accumulated most of `games/bv` in the heap and died at 4 GB after ~90 players (a leak with a delay);
and it would append a player to a game with an EMPTY roster, which is not a gap but an UNCAPTURED game
— `43199a27` ended up with a two-id roster, both ids the tool's own top-ranked targets, in a game
holding a dozen. Same failure class as the `hp`/`ap` fragment caught on the 11th, and the same rule:
a fragment that looks like real data is worse than absence.

**Then a full day went on two ordering bugs, and the debugging is the part worth remembering.** A
player with 473 roster entries in `games/bv` showed a `games[]` of 30. I proposed six explanations —
fill-in players, mass mis-attribution, the resolver returning null, a missing `uuid` field on index
stubs, a 13-char prefix collision, a broken write path in the batch tool — and every one was wrong.
Each cost Mark a dispatch or a browser check, and every dispatch begins with a five-minute repo
checkout. What actually settled it was reproducing the real `build-player-games.js` in the sandbox
against real uploaded data: one season file, the genuine index shard, the genuine alias shard. The
resolver returned the correct uuid, `getCollisions()` was empty, and Phase 2 flagged the file for
update — proving the code correct by EXECUTION and leaving ordering as the only survivor. Running the
script standalone updated 13,046 files against the weekly's 9,353, and the player came out at 503.

**The bugs themselves (now T28 and T29).** Workflow-level `concurrency` serialises a workflow against
OTHER workflows, not its own jobs against each other — `weekly-indexes.yml` had three player-file
writers running in parallel from separate checkouts, each pushing with `merge -X ours`, which is a
lost-update path rather than merely a staleness one. And `build-player-games` derives `games[]`
entirely from `p[]` in the game files, yet ran alongside `discover-fixtures`' 360-minute window,
deriving from whatever its checkout captured at job start. The chain is now
`discover-fixtures → team-stats → win-loss → player-games → fold-diverged`, and both `setup-node`
steps were removed from that workflow while it was open — harmless there, since neither script fetches
PlayHQ, but one edit away from the CloudFront failure documented everywhere else.

**Two investigations closed by evidence rather than by building anything.** The negative-gap population
(26,445 players) is largely PRIVATE PROFILES: the API returns OK with no `seasonStatistics`, so the
credited total is near-zero by construction while the roster appearances are real — probed live on a
player with `private: true`, gp≈35, games=489. The fill-in theory was refuted by my own diagnostic:
canonical-record games are 5.1% of affected players' games, the same as their share of the database,
where fill-ins would have concentrated. So there is no fill-in tag to build, and the diagnostic needs
to read the `private` flag before it is trusted again.

**And a smaller correction worth keeping:** `discover-fixtures.js` froze the weekly with no output for
five minutes. Node's `fetch` has no default timeout, so a single stalled socket blocked its
`Promise.all` batch and therefore the entire run indefinitely; separately, the 429 branch retried
without incrementing its attempt counter, spinning silently forever. Both fixed, with every retry now
printing. Concurrency 40 was NOT the cause — it is the cron's proven value — and I argued otherwise
twice from my own assumptions instead of from the run log Mark had already pasted.

### 6.34 · 2026-09-01 → 09-06 — a wrong field name, a wrong keeper, and a wrong alias

Four faults, three of them mine, one of them PlayHQ's. Every number below came from a real file in
this repo, not a fixture.

**`g.h`/`g.a` is never sufficient.** A game carries `h`/`a` OR `t1`/`t2` — `README.md` L266 has said
so throughout. `build-player-games.js` L175 read only the first pair, so every hidden game produced
null team ids, the registration test in the `u` block could not pass, and every appearance in a
season the player holds a registration for was written into `u`. **1,115,172 → 39,128.** The same
bug in `build-win-loss.js`, five sites: every hidden game contributed zero wins and losses to every
player in it, silently, because `build-finals-stats.js` had always resolved both pairs and so finals
results were counted for games regular-season results were not. **44,195 players corrected.** And in
nineteen places in StatTrack, the worst being a season card that rendered "No game records found."
for a player who played every game in it. Now trap T34.

**The fold's keeper kept the wrong record.** It chose by `games[]` count — assigned by
`build-player-games` resolving rosters through the alias index, so before an alias exists the stub
collects everything. Across the 552 pairs the seeder had to refuse, the stub held a median of 69
games and the real api-keyed profile held 1. The stub won, and since only seasons/games/teams/
gameTids/name are unioned, the real profile's stats, records and `private` flag were replaced — and
the inherited `statsChecked` meant it was never re-fetched. Keeper now decides by which record holds
stats. **533 of 541 merges rescued.** The seeder's guard, which existed only to work around this,
came out.

**`proposal-store-playhq-credited-games.md` was retired and deleted**, its decision recorded in
`claude_context.md`. It had one number wrong that mattered: "roughly 450 refused seeding cases" was
523, and the guard it named lived in `seed-apiid-from-playhq-pairs.js`, a script written the same
session and never added to this manifest. That is why the guard could not be located from the docs.

**`c` and `x` shipped; `gamesAPI` was measured and rejected.** The full credited list is ~315 MB
against the 314 MB `games[]` already costs and 99.4% the same ids. The disagreements are ~4 MB.
Cross-check `gp - games[] == c - x` verified at 100.0% on shard 00 across 1,591 players.

**`x` found a defect in PlayHQ.** Of the 8,634 entries a stored box score can settle, **8,616 —
99.8% — have the player in PlayHQ's own box score while PlayHQ's own career totals leave the game
out.** Verified first on Toby Jovic (`0afc7690`, game `c7a6db82`), whose PlayHQ profile page skips
the round its own box score records him playing.

**And it found misrouted aliases.** The same child under two PlayHQ profiles with a spectator id
aimed at the wrong one. Jordan Uppal: 116 appearances on the wrong record. 46 aliases repointed, 22
held back, 37 identity aliases excluded, 17 partials left for reading. William Warren 262 → 78 games
against a gp of 78; Ben O'Connor's duplicate collapsed into `b9ca8d79` at 171/171.

**Three traps, all from the alias repair, all mine.** T35: an alias whose key is a prefix of its
target is the player's own id, and the first repair listed those under a heading saying "to repoint".
T36: one claimant holding all the misrouted games does not license repointing every alias — attribute
games to the alias that carried them; 117 candidates became 46 once that was done. T37: "another
profile holds this game and is credited for it" is true of every teammate; the claimant must be the
same person by name.

**T38 — test against real files.** Every one of the above passed a synthetic test first, because the
fixture was built out of the same wrong assumption as the code. Two-player rosters when real rosters
have ten. `h`/`a` games when 97% of that season used `t1`/`t2`.

**Memory, at 418k players.** `find-misrouted-appearances.js` died twice at the 4 GB heap limit. A
per-season map of wanted game ids is a cross product — one flat set and a single sweep of every
season file instead. Do not cache every parsed player file. Do per-player work per player.

---

### 6.35 · 2026-09-08 — three faults of one family, and the dates that were being thrown away

Every fault closed today was the same mistake wearing different clothes: **a failure to ASK
recorded as an ANSWER.**

**`discover-org-seasons.js` — the guard.** Its `discoverSeason` returned `null` for three
different things: PlayHQ answered with nothing, the request was forbidden, and the request
errored. `buildEntry` read "no grades came back" as "this season has no grades", and for a
`COMPLETED` season that wrote `{grades:[], locked:true, removed:true}` — permanent, because the
grade-refresh in `discover-seasons.js` selects `locked === false` only, so nothing ever re-asks.
80 seasons landed there on 2026-09-07 off a CloudFront wall. `lookupSeason` now returns a tagged
outcome and an unanswered season is **not written at all**; the run reports itself INCOMPLETE
rather than clean. Root cause of the divergence between the two scripts: `discover-seasons.js`'s
`aimdRun` has no give-up ceiling, so a blocked item is requeued forever and can never reach the
entry-writing loop — its `if (ds?.blocked) continue;` guard is unreachable belt-and-braces.
`discover-org-seasons.js` added `maxAttempts: 4` and then wrote the entry anyway.

**The repair, sized before built.** `audit-removed-org-seasons.js` (new, read-only) re-asked all
80: **52 have grades (239 total), 28 genuinely have none, 0 unanswered**, in six seconds with zero
blocks. Repairing all 80 would have been as wrong as leaving all 80. Applied via
`--repair-removed`, which selects `discoveredBy === 'org' && removed === true` — exactly 80,
leaving the 274 stubs from other sources untouched and asserting that before committing. Verified
on `55dcd845` and `af72a719`. Two independent live runs 17 minutes apart agreed on all 52 seasons
and the exact grade count of every one.

**`discover-seasons-matrix.yml` — the map fan-out.** Four weeks of green 30-second no-ops. See
T51. Fixed with one key, `map.if`; the parsed job graph was diffed key by key against the
pre-change file to confirm `needs`, `strategy`, permissions, concurrency, the `gen` step and the
whole `reduce` job were byte-identical. Proven by dispatch with `fresh_start` unticked — the exact
broken condition. The sweep then ran to completion across three chained runs: 256/256 shards,
233,617 players at 100%, 48 new seasons, 46 grade lists filled including `8f43ff68` going from a
bare pre-allocation to 42 grades.

**`--backfill-dates` — the dates that were already being fetched.** `discoverCompetitions` returns
`status`, `startDate` and `endDate` for every season an organisation has ever run, reaching back
to at least 2020. Line 483 discarded all of it for any season id already known. Measured before:
only 639 of 3,431 seasons carried an `endDate`, and **418 of the 703 unlocked seasons had never
had their status asked at all — holding 8,106 grades, 85% of the nightly's work.** The backfill
reads the same 183 calls properly: **1,984 filled, 63 corrected, 2,792 → 808 missing, in 17
seconds, no extra requests.** Metadata only — four assertions on count, `locked`, `removed` and
grade totals abort before commit. It does not lock a season even when PlayHQ says COMPLETED.

**`close-empty-seasons.js` (new) — closing on evidence.** 78 seasons held no games file at all. A
missing file is **not** evidence that no games exist; it is equally consistent with a capture
failure, and closing one of those buries recoverable data — the same mistake as `removed:true`,
from the other direction. So the tool asks PlayHQ per grade using the nightly's own `gradeRounds`
→ `discoverFixtureByRound` pair, and closes only what comes back empty. Three outcomes never
collapsed: confirmed empty → `locked:true` + `closedAt` + `closedReason`; PlayHQ holds games →
**not closed**, reported as a backfill job; blocked or errored → untouched, re-run. Seasons
touched in the last 3 days are skipped, which protected the 52 repaired hours earlier. Result:
**26 closed, 304 grades off the nightly, 0 holding games we had missed.** `6a36400d` had all 65 of
its grades asked individually and returned nothing.

**Two read-only audits also built.** `audit-finished-unlocked-seasons.js` — measures
finished-but-unlocked seasons against real game data on disk, two-phase checkout (`games/bv` is
1.94 GB / 2,939 files; a cone pattern is unusable, so phase 1 emits explicit paths and phase 2
takes them by name). `audit-pending-games-vs-playhq.js` — asks whether games we hold as PENDING
are still pending at PlayHQ. Answer: 685 asked, 0 finished. Its `not returned` counter is
defective; see OUTSTANDING_TASKS.

**Own goals, all caught by execution rather than reading, all now traps.** T52: a fixed 150 ms
sleep with no retry got `close-empty-seasons.js` walled after 5 seasons — the comment forbidding
exactly that had been written into `discover-org-seasons.yml` earlier the same session. T53: a
counter that read a mutated object reported 0 filled while filling 1,984; and a classifier that
tested `st === 'UPCOMING'` counted zero unplayed games in a season holding three, because real
data uses `PENDING` and `IN_PROGRESS`. T54: a revised file re-delivered under the same name with
no version marker was silently swapped, and the stale copy was run.

**Tools added:** `scripts/audit-removed-org-seasons.js`, `scripts/audit-finished-unlocked-seasons.js`,
`scripts/audit-pending-games-vs-playhq.js`, `scripts/close-empty-seasons.js` — each with its
workflow, all read-only except the last, all dispatch-only, none using `actions/setup-node`.
**Tools changed:** `scripts/discover-org-seasons.js` (guard + `--repair-removed` +
`--backfill-dates`) and its workflow; `.github/workflows/discover-seasons-matrix.yml` (`map.if`).

---

### 6.36 · 2026-09-08 (later) — the writers that had quietly stopped, and one that never started

Prompted by a simple question: why are the commit dates on files in `data/` months
apart? Three of the quiet files were correct. Two writers were broken.

**`data/venue-index.json` had never been updated once.** Created 2026-06-13 by the
Phase 1 migration — 532 entries against the 532 venue directories of that day — and no
ongoing writer was ever built. The writer→reader graph in §4.1 recorded it as
"(venue build)", which is not a script, and that placeholder was read back as though
it were a fact when the question was first asked. The project's own chat history had
the answer and was not searched until Mark insisted. That is now **T56**.
Fixed in `build-venue-indexes.js`, which already opens every file in `games/bv` for
part 3 and where every game carries `vid` **and** `vn` — the name was one field away
from the id already being collected. It merges rather than replaces, keeps and counts
entries no game mentions, and aborts if the file would ever shrink. First live run:
**532 → 541 venues, 9 added, 2 renamed, 0 orphaned**, pushed on the first attempt.
All 1,795,589 games with a `vid` also carry a `vn`. Two renames were real venue
changes, not noise.

**`build-venue-indexes.js` carried the combined-`git add`.** One add across three
pathspecs; a single unmatched pathspec stages nothing, atomically, exit 0. That is
the §2.2 fault that discarded 30,426 games from `discover-fixtures.js` on 2026-07-19,
fixed there on 2026-07-21 and never fixed here. Its `gitCommit` was also wrapped in a
try/catch that printed and returned, so any git failure exited zero and the job showed
green. Now per-path adds, staged shortstat, 60-attempt push retry with jitter, throws
on exhaustion.

**`update-team-index.js` broke four rules and never corrected a team.** `git add -A`
— the **third** instance of a violation this project explicitly forbids, after
`discover-seasons.js` and `build-leaderboards.js` on 2026-07-09; `--stat` where the
rule says `--shortstat`; `merge` without `--no-stat`; and the same swallowing catch,
with no push retry. Separately, `if (existingTids.has(tid)) continue;` ran BEFORE any
comparison, so a renamed or regraded team kept its original values permanently. It now
compares and corrects, prints each change, and will not let a blank team name from
PlayHQ overwrite a name already held. The §2.2 row describing its input as
`team-stats/bv` was also wrong — it reads player files.

**Two timeouts became wrong the moment the retry loops were added** — `update-team-index.yml`
15 → 150 and the `team-index` job in `nightly-crawl.yml` 15 → 150, with the arithmetic
written next to each number. The nightly's job graph was diffed key by key to prove
exactly one key changed. That is **T55**, and it is the same failure
`build-venue-indexes` suffered at 45 and again at 120 in August.

**Confirmed correct, do not re-investigate:** `zero-team-seasons.json` (a
`discover-fixtures` report), `seasons-discovered/invalid/skipped` (the never-re-queue
lists), and `season-venue-index.json` covering 2,116 of 2,939 seasons — a season only
appears there if one of its games carries a `vid`, and hidden games never do.

**Also fixed:** the `not returned` counter in `audit-pending-games-vs-playhq.js`,
which counted every game in a grade the run never queried as a fixture PlayHQ had
dropped. 632 phantom absences on the first run, 0 after. It now produces a count only
under full coverage.

---

### 6.37 · 2026-09-08 — the season lifecycle rule, and a guard mistaken for a bug

**Nothing had ever locked a season.** After the date backfill made the scale visible:
419 `COMPLETED` seasons unlocked holding 5,873 grades — **59% of everything the
nightly fetched every night** — 334 of them finished more than three months earlier,
41 more than three years, one in December 2019.

**`scripts/lock-quiet-seasons.js` + workflow (new).** Daily, 20:30 UTC, and it
APPLIES. A rule that only fires when someone remembers to dispatch it is a report with
extra steps, and the safety here is the evidence rather than a human in the loop:
PlayHQ says `COMPLETED`, games exist on disk, the season is old enough, and it is
reversible — `lockedAt` and `lockedReason` are the selector, exactly as
`discoveredBy:'org'` made the repair of 80 damaged seasons possible the same day.
Never `removed:true`; that means a `grades:[]` stub, and these hold real grades.

`lock_after_months` ships at **3, equal to `min_age_months`**, so age alone decides.
Drafted at 12, 6 considered; both were caution, not measurement. The fingerprinting
(sha1 over each game's id, status and both scores) still runs and became the CHECK on
that decision rather than a gate: a season locked on age whose fingerprint moved in
the same run was still receiving data when sealed, and is reported as **STILL
CHANGING** with every id named for reopening. That count must stay at zero — if it
does not, three months is too short and the log says so.

**The zero-games floor.** `lock-quiet-seasons` never locks an empty season. Proving
one is truly empty means asking PlayHQ per grade, which is `close-empty-seasons.js` —
given a **weekly cron** the same day, having been dispatch-only, because empty seasons
would otherwise pile up exactly as finished ones had. The two rules now cover the
whole space with nothing left to remember.

First dry run at 12 months: 69 locked, 485 grades off the nightly, 9,953 → 9,468;
238 still settling; 84 too young; 28 with no games; **0 with no endDate**.

**T57 — the guard that was not a bug.** `update-team-index.js` skipped known teams
before comparing them. Treated as a defect and "fixed" to correct `n`, `comp` and
`grade` keyed on `tid`; a `--all` dry run then reported **2,175,659 corrections across
360,777 teams**, the same tid rewritten repeatedly within one run. The skip was
Decision A working: a reg IS a `(team, grade)` pair and the identity is `(tid, gid)`.
This was **T14 rebuilt** in a new script. `grade` is now never corrected, and the
current grade cannot be recovered from registrations at all — measured on `0afc7690`,
the RES grade is `reg[1]` twice and `reg[0]` twice across four regrades, so array
order carries no chronology. `n` and `comp` are safe and the corrected run cleared
**2,628 teams, almost all holding an empty name** since the index was built and
therefore unsearchable in StatTrack.

**Tools added:** `scripts/lock-quiet-seasons.js` + `.github/workflows/lock-quiet-seasons.yml`.
**Tools changed:** `close-empty-seasons.yml` (weekly cron, applies),
`update-team-index.js` (grade excluded from correction),
`audit-pending-games-vs-playhq.js` (coverage-gated `not returned`).
**New data file:** `data/season-activity.json` — per-season games fingerprint and
unchanged-run streak. Written by `lock-quiet-seasons.js` on every run including
`--record-only`. Deleting it costs nothing but the streak history.

---

### 6.38 · 2026-09-10 — half the nightly gone, and a status nobody had ever counted

**The lifecycle rule ran.** 307 seasons locked, 4,927 grades, **9,956 → 5,029**.
`STILL CHANGING` 0 against 391 fingerprints; exactly one season moved between the two
runs (`01ffe236`, ended seven days earlier), which is the canary demonstrating it can
detect activity rather than always returning the same hash. `lock_after_months` is 3,
equal to `min_age_months`, so age alone decides — Mark's call, and the fingerprint is
now the check on it rather than a gate.

**`lock-quiet-seasons.yml` was given `data-write` the next day.** It shipped lockless
on T19 grounds and that reasoning did not survive scrutiny: every writer of
`sports-index.json` uses `merge -X ours`, so concurrent writers do not conflict — the
second to push silently keeps its own copy and discards the other's, which no push
retry can catch. T19's harm was to burst-dispatched workflows where an evicted waiter
loses its run outright; a daily cron that misses a day loses nothing. Prompted by the
2026-09-09 run starting at 22:41 against a 20:30 cron: GitHub queues scheduled runs,
and a two-hour drift closes the ninety-minute gaps between the three index writers.

**`db-audit.js` had been counting five statuses NOWHERE.** The catch-all branch read
`else if (!['BYE','LIVE','PRE_GAME','IN_PROGRESS','PENDING'].includes(st))` — so a
game in any of those fell through every counter. The status section totalled 2,360,109
of 2,424,380: **64,271 games tallied by nothing.** `inProgress` had also been computed
since the script was written and never displayed. Both fixed, plus a reconciliation
line that marks itself against the game total.

**That surfaced `LIVE` at 47,807** — the third-largest status in the database, never
once shown, and every single one inside a locked season. Establishing whether they
were recoverable took **five full runs and two wrong endpoints**, and the answer was
in this repository's own documents throughout (**T58**). The finding:
**nothing frozen is recoverable.** 320 games across 40 seasons asked of the canonical
record, **0 finished at PlayHQ**. 232 are no longer held by PlayHQ at all — the
competition withdrawn upstream, which is why those seasons have no `endDate` and no
organisation lists them; we hold the only surviving copy. 88 are still served and
still non-final, matching the 2026-09-08 PENDING work through a different endpoint.
Locking cost nothing.

**`build-search-index.js` — 79,566 players gained a club.** `extractClubTeam` returned
at the first season holding a team name and used THAT season's club even when the
field was absent, never looking further back, so 19% of the database rendered as
"— · TeamName" in player search. It now orders a player's seasons by their real
`endDate` from `sports-index` and prefers the most recent season holding BOTH a club
and a team, so the pair stays coherent: 261,490 of 265,481 come from a single season.
152,902 still have none, correctly. Its `gitCommit` also printed and returned on
failure — the fourth instance of that swallowing catch found this week.

**Smaller, all measured:** the two dangling aliases removed by
`prune-dangling-aliases.js` after `repoint-only` proved them unresolvable (499,607 →
499,605, §3b now 0); `playerCount` deleted from `sports-index.json` as unmaintained
(369,428 against 418,416 real files, no writer anywhere); organisation `59363a37`
skipped in both org sweeps as deleted upstream; `fold-diverged-players.js` L105
corrected and a `repoint-only-dry` mode added, that branch having been un-previewable.

**Three nightly timeouts corrected against their retry budgets (T55).** `team-index`
15 → 150, `team-stats` 60 → 240, `venue-lookup` 30 → 180. `build-team-stats.js` has
had a 60-attempt loop since 2026-07-28 — roughly 109 minutes for one commit, and it
commits every 50 seasons — inside a 60-minute timeout for six weeks.
`update-venue-lookup.js` was the reverse case: 30 was correct for its old 10-attempt
loop and became wrong the moment that loop was raised to the house pattern. Both
scripts swallowed failures and now throw.

**Tools added:** `scripts/prune-dangling-aliases.js`, `scripts/audit-nonfinal-games.js`
(both with workflows), and the one-off `scripts/drop-stale-playercount.js` which should
be deleted once run.
**Tools changed:** `db-audit.js`, `build-search-index.js`, `update-venue-lookup.js`,
`build-team-stats.js`, `discover-org-seasons.js`, `fold-diverged-players.js` + `.yml`,
`lock-quiet-seasons.yml`, `nightly-crawl.yml`, `audit-pending-games-vs-playhq.js`.
