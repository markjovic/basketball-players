# Claude Project Context — Sports Player Stats + StatTrack

This file is the instruction manual for Claude. Read it at the start of every session before writing any code or asking questions.

---

## The tools

### 1. Fixture Card Generator
- **Repo:** `markjovic/fixture-generator` — **Beta 0.154**

### 2. AFL Local Footy Dashboard
- **Repo:** `markjovic/junior-footy-dashboard` — **Beta 0.115** — `https://markjovic.github.io/junior-footy-dashboard/`

### 3. Sports Player Stats + StatTrack Viewer
- **Repo:** `markjovic/sports-players-stats`
- **StatTrack:** `https://markjovic.github.io/stattrack/` (hosted in `markjovic/stattrack`), BASE `https://markjovic.github.io/sports-players-stats`, **Beta 0.64** (0.61 api-canonical contract; 0.62 renderMode legacy-vs-score; 0.63 season-leaderboard key guard; 0.64 winPct/lossPct denominator). ⚠️ TWO copies: `markjovic/stattrack` is CANONICAL, the repo-root `index.html` is a MIRROR that Pages also serves — update both in the same pass or the mirror serves a stale app.
- **State (2026-07-16): API-CANONICAL MIGRATION COMPLETE AND VERIFIED IN PRODUCTION.** Every player file keyed by api id (411,514 files = index entries, 1:1 both ways), `players/aliases/` live (452,958+ entries, ~9.5% redirects), resolver alias-aware, nightly retrofitted (resolution at ingest + identity alias per stub), matrix recovery persists alias redirects, event-driven fold restores the invariant after every matrix cycle. Full lifecycle proven on real data night one (see the Micaela Chang case below). Season-name repair COMPLETE. `db-audit.js` section 3b audits the migration invariants — all relational/live, NO fixed baselines. Repo measured **6.18 GB / 529,498 files** (2026-07-30 audit; 6.03 GB on 07-16) — materially below the ~8.6–9.18 GB previously recorded; re-verify the "blocks publishing" claim before driving further shrink work. StatTrack (see the version line above for current) reached **Beta 0.62** on the new contract, and all three api-canonical claims were VERIFIED against the deployed file on 2026-07-31 rather than trusted: `TRUNC_LEN = 13` (L492), `isPrivate()` testing the `private` BOOLEAN (L499), alias-aware resolver fetching `players/aliases/` (L544-575). Runtime dependency: Pages must serve `players/indexes/` AND `players/aliases/`. 0.62 fixed `renderMode`, which tested `legacy` above the score check and so rendered 3,120 scored games as "Data unavailable". ⚠️ There are TWO deployed copies — `markjovic/stattrack` (canonical) and the repo-root `index.html` mirror, which Pages also serves. Update both in the same pass.
- **State (2026-07-21):** setup-node × PlayHQ RESOLVED (per-JOB fingerprint block, confirmed with instrumented evidence; stripped from both discover-seasons workflows). Future fixtures LIVE via the fixed `discover-fixtures.js` (its combined-`git add` staging bug silently discarded a whole green run — see directives 9–10); `nightly-crawl.js` gained `--rounds-forward` + no-current-round fetch. Roster-lag fixed: matrix terminal now fires `build-team-stats.yml` (roster stats come from player reg stats — `games/bv` `p[]` has NO stat lines). Sunday discovery now `backfill_teams=true` weekly. Matrix stop-button fixed (`!cancelled()`). See REPO_MANIFEST §6.3/§6.8 + OUTSTANDING_TASKS for pending validations and the future-fixtures architecture decision.
- **State (2026-07-29):** First automatic weekly chain RAN (Mon 07-27 nightly → Tue 28 AEST): discover-fixtures `--current-only` → Build Finals Stats → Build Leaderboards. Chain-dispatched runs show as "Manually run by markjovic" (the dispatch uses `WORKFLOW_PAT`) — not manual runs. The matrix chain broke on 07-27 when a `gh workflow run` returned HTTP 500 (one-shot dispatch, no retry): no terminal, no `build-team-stats`, so every active season's roster sat a day behind while the player files were correct. `fetch-profile-stats-matrix.yml` hardened (dispatch retry helper on all six sites; persistence gate on `written`; push retry added to apply-and-commit, which had none; per-path adds; `apply_stuck` halt status). §A3 is now automated by `check-roster-freshness.js` and was proven in BOTH directions in one sitting — it caught the stale state, the repair fixed it, the re-run passed 20/20. `build-team-stats.js` gitCommit is on the house pattern (last outlier closed). See REPO_MANIFEST §6.10.
- **State (2026-09-08): season discovery restored end to end, and three faults of the same family closed.** All three were a failure to ASK being recorded as an ANSWER. (1) `discover-org-seasons.js` wrote 80 `COMPLETED` seasons as `removed:true` because their grade lookup was CloudFront-blocked; its `discoverSeason` returned `null` for "answered with nothing", "forbidden" and "errored" alike, so `buildEntry` could not tell an answer from the absence of one. `lookupSeason` now returns a tagged outcome and a season we got no answer about is **not written at all** — left for the next daily run. Repair sized first (52 of 80 had grades, 239 in total; 28 genuinely had none and were correctly flagged), then applied. (2) `discover-seasons-matrix.yml`'s `map` job had no `if:` and inherited a skip from `fresh-start-reset` — see **T51**; fixed and proven with a full 256-shard sweep reaching 233,617 players at 100%, finding 48 new seasons and filling 46 grade lists. (3) `close-empty-seasons.js` now closes a finished season only when PlayHQ confirms it holds no games — 26 closed, 304 grades off the nightly, **zero** came back holding games we had missed. Also: `discover-org-seasons.js` gained `--backfill-dates`, which reads the `startDate`/`endDate`/`status` the daily sweep was already fetching and discarding — **end-date coverage went from 18.6% to 76.8% at no extra API cost** (2,047 seasons in 17 seconds). Index at **3,479 seasons / 803 unlocked** at session end. New read-only tools: `audit-removed-org-seasons.js`, `audit-finished-unlocked-seasons.js`, `audit-pending-games-vs-playhq.js`. New traps **T51–T54**, two of them own goals from this session. See REPO_MANIFEST §6.35.
- **State (2026-09-08, later): two writers were broken and one had never existed.**
  Prompted by commit dates in `data/` being months apart. **`data/venue-index.json`
  had no writer at all** — created once by the Phase 1 migration on 2026-06-13 and
  never updated, while REPO_MANIFEST's writer→reader graph carried "(venue build)", a
  placeholder that was read back as fact (**T56**). Now rebuilt by
  `build-venue-indexes.js` from `vid` + `vn` in the games pass it already runs: live
  result **532 → 541 venues, 9 added, 2 renamed, 0 orphaned**.
  **`build-venue-indexes.js`** carried the combined-`git add` that discarded 30,426
  games from `discover-fixtures.js` in July, plus a try/catch that made any git
  failure exit zero. **`update-team-index.js`** broke four explicit repo rules
  including a **third** `git add -A`, and had never corrected a renamed or regraded
  team in its life — `existingTids.has(tid)` skipped before comparing. All fixed, both
  now on the house git pattern. Adding those retry loops made two timeouts wrong
  (**T55**): `update-team-index.yml` and the `team-index` job in `nightly-crawl.yml`,
  both 15 → 150. Confirmed correct and not to be re-investigated:
  `zero-team-seasons.json`, the three `seasons-*` never-re-queue lists, and
  `season-venue-index.json` at 2,116 of 2,939 seasons. See REPO_MANIFEST §6.36.
- **State (2026-09-08, end of session): the season lifecycle rule exists and both
  halves of it run on a schedule.** `lock-quiet-seasons.js` (new) fingerprints every
  candidate season's games — sha1 over each game's id, status and both scores — and
  locks finished ones. Four conditions, all required: PlayHQ says `COMPLETED`, not
  already locked, ended more than `min_age_months` ago, and games exist on disk. A
  season with ZERO games is NEVER locked here; proving one is truly empty means asking
  PlayHQ, which is `close-empty-seasons.js`'s job — now on a weekly cron, having been
  dispatch-only. `lock-quiet-seasons` runs daily and **applies**: a rule that only
  fires when someone remembers to press a button is a report with extra steps.
  `lock_after_months` ships at **3, equal to `min_age_months`** (Mark's call), so age
  alone decides and the quiet streak never gates anything. The fingerprinting still
  runs and is the CHECK on that decision: a season locked on age whose games moved in
  the same run is reported as **STILL CHANGING** and named for reopening. **That count
  must stay at zero.** Measured before the rule existed: 419 `COMPLETED` seasons
  unlocked holding 5,873 grades, 59% of the nightly; 334 of them ended over three
  months ago. A 12-month dry run locked 69 seasons and took 485 grades off the
  nightly; at 3 months the whole 334 becomes eligible.
  Also this session: `update-team-index.js` corrected 2,628 teams — almost all of them
  holding an EMPTY NAME since the index was built, so unsearchable in StatTrack — plus
  6,589 new, total 368,003. And **T57**: the "never corrects a team" behaviour was a
  key, not a bug. See REPO_MANIFEST §6.37.
- **State (2026-09-10): the lifecycle rule is live and the LIVE-status question is
  closed.** The daily lock ran and took **307 seasons, 4,927 grades off the nightly —
  9,956 → 5,029, roughly half.** `STILL CHANGING` was 0 against 391 recorded
  fingerprints, and exactly one season moved between runs (`01ffe236`, ended seven
  days earlier), which is the canary proving it can detect activity rather than
  always returning the same hash. Nothing older than three months moved.
  Also fixed: `db-audit.js` counted five statuses NOWHERE — its status section
  totalled 2,360,109 of 2,424,380 games, and the exclusion list is gone with a
  reconciliation line that must equal the game total. That surfaced **LIVE at 47,807**,
  the third-largest status in the database and never once displayed. Investigating it
  cost five runs and two wrong endpoints — see **T58** — and the answer is: **nothing
  frozen is recoverable.** 320 games across 40 seasons, 0 finished at PlayHQ; 232 are
  no longer held by PlayHQ at all (the competition withdrawn upstream, which is why
  those seasons have no `endDate`), and 88 are still served and still non-final.
  Locking cost nothing.
  Also: `build-search-index.js` gave **79,566 players a club** in search that showed
  an em-dash before; `prune-dangling-aliases` cleared the two entries db-audit §3b had
  been flagging; `playerCount` deleted from `sports-index.json` as unmaintained;
  organisation `59363a37` skipped as deleted upstream; and three nightly timeouts
  corrected against their retry budgets. New traps **T58, T59**. See REPO_MANIFEST §6.38.

---

## ⚠️ Behavioral directives (added 2026-07-09 — read this section every session)

Today's session went very badly before it went well. ~20+ turns were spent chasing a GitHub Actions matrix bug through wrong theory after wrong theory (checkout refs, string comparisons, output size, secret-scanning, heredoc indentation) before the real, simple cause was found by actually diffing the full job graph against a proven-working reference file. Separately, real bugs (`git add -A` violating this project's own explicit rule) sat undiscovered in two scripts because their behavior was assumed from descriptions rather than read from the actual uploaded file. This cost a full day and many CI runs, and should never happen again.

1. **Read the whole file before touching or trusting it. No skimming, no exceptions.** If the person uploads a script, read it top to bottom before editing it or asserting what it currently does. Do not infer behavior from filenames, prior summaries, docs, or partial greps. This applies even under time pressure — skimming is what caused the bugs above, not thoroughness.
2. **"This should match the working version" is a claim to verify, not assert.** When comparing a new/broken script against a known-working reference, diff the FULL relevant structure — entire job graph, every `needs`/`if`, dependency topology, permissions, concurrency — not just the one piece currently under suspicion. Isolated-piece comparisons repeatedly produced false "this matches" conclusions today.
3. **When something has failed multiple times, stop and get instrumentation before the next theory.** Read-back diagnostics (proving exactly what a value resolved to, not just what was computed) are cheap and should be added early, not after the eighth guess.
4. **Own mistakes plainly and move on.** Don't re-litigate; don't over-apologize; fix and continue.

### Added 2026-08-24 — THE TWO CHECKS THAT WOULD HAVE PREVENTED MOST OF 2026-08-23/24

That session found real faults, but nearly every one was found by Mark noticing something wrong on a
page or in a log — never by a check catching it. Worse, the SAME fault class was fixed one instance at
a time, three and four times over, because after fixing the instance in front of me I never asked where
else it applied. These two checks are not principles. They are things to DO before pressing send.

**A. BEFORE DELIVERING A FIX: list every other place the same fault could exist, and state whether it
does.** Not "consider whether" — actually enumerate and say so in the reply.

  · The id-length fault lived in FIVE diagnostics, each with its own `uuid.slice(0, 13)` comparison
    against roster ids that are stored in BOTH 13-char and 36-char form. Fixing them one at a time
    across four turns produced a false "Bailey Walton is a split identity" and a false "185 pairs are
    two people". The fix was one shared `playerIdSet`/`rosterIdMatches` in lib/namespace-resolve.cjs,
    and it should have been that on the first sighting.
  · The stale-session fault lived in the main loop of probe-alias-credits AND in its resolver. Fixed in
    the loop, not the resolver, so 940 of 980 repoints came back "search error" after a five-hour run.
  · Copying a block from another script means copying ITS DEPENDENCIES AND ITS CLIENT. The session lock
    taken from repair-players-batch (which uses `fetch`) called `res.headers.get('set-cookie')` in a
    file using the raw https client, where `res.headers` is a plain object — dead on the first refresh.

**B. BEFORE DELIVERING A TOOL: name the file it reads, and confirm that file is COMMITTED TO THE REPO.**

  A report written to `reports/` and uploaded only as a workflow ARTIFACT does not exist to the next
  workflow. The checkout will not have it. This produced three separate ABORT-on-first-run failures in
  one session — probe-alias-credits could not find its own previous cache, repoint-aliases could not
  find alias-credit-audit.json, probe-verdict-conflict could not find both-resolve-pairs.json — each
  costing a checkout and a dispatch. Related: `actions/download-artifact` WITHOUT a `run-id` only sees
  artifacts from the CURRENT run, so an artifact-based cache silently restores nothing, every time.

  **If a tool writes a report another tool might read, the tool COMMITS it.** Per-path `git add`, the
  house push-retry, `contents: write` on the job. Artifacts are a convenience copy, never the channel.

**And a third, learned the same way:** a long job must COMMIT ITS PROGRESS, not just write it to disk.
A 54,328-profile audit written once at the end loses everything at the job ceiling. Write incrementally
AND commit on a slower cycle, or the next dispatch starts from nothing.

### Added 2026-07-17 (season-name contamination + name population)

5. **Do not assert a failure *mechanism* you haven't verified from logs or source.** This session I twice
   diagnosed confidently and wrongly: first that the repair's per-player `attempts` counter "wasn't persisting
   across runs" (the `resuming:` log proved it WAS — the players simply hadn't hit `MAX_DEFER` yet), then that a
   0/250 spectator result "must be quota" when it was archived games. The value that settles the question (a
   `resuming:` line; a per-game HTTP status) is cheap — get it before theorising.
6. **`publicProfile` (account tenant) is the ONLY direct id→name lookup, and it is the canonical name source.**
   `publicProfileStatistics` carries NO name; `seasonStatistics[0].name` is a SEASON label ("Winter 2023"), NOT
   a person's name. Reading it as a name is exactly what wrote 40,034 season strings into `player.name`. Never
   mine the stats query for a name. See `playhq_api_reference.md` → `publicProfile`.
7. **A placeholder (`Player #<prefix>`) is provisional — never frozen on a transient/unreachable failure.** Only
   write one when the answer is DEFINITIVE: the profile was reached AND every game was reachably checked AND no
   name exists. The old `repair-season-names.js` defer froze placeholders after `MAX_DEFER` *unreachable* passes,
   permanently mislabelling 15 recoverable players. Go-forward, a placeholder set by nightly is upgraded by
   `fetch-profile-stats.js` via `publicProfile` on the next matrix pass.
### Added 2026-07-21 (discover-fixtures silent data loss + setup-node resolution)

8. **One-time bounded-quota fetch jobs use the batched-shard + reconcile pattern.** The spectator endpoint has a
   ~30–35-call/session quota; batching all work into one run blows it (that starved the repair). Instead:
   `--plan` (chunk into shards of N within quota) → matrix `--shard=k` (fresh session each, uploads an artifact,
   zero git) → `--reconcile` (one aggregator downloads all artifacts, applies, commits). Only conclude
   "exhausted" when every unit was actually reached. See `salvage-spectator-names.js`.
9. **`git add` is ATOMIC across pathspecs — stage per-path, and never swallow git errors.** One combined
   `git add -- a/ b/ c.json` where ANY pathspec matches nothing (absent AND untracked) exits 128 and stages
   NOTHING — including the valid changes. An empty `catch {}` around it turned that into "(no changes to
   commit)" on every commit of a 28-minute run: 30,426 fetched games discarded, job green (discover-fixtures,
   2026-07-19). Per-path `git add` in a loop (each try/caught individually) makes a miss skip only itself.
   When staging succeeds, PRINT the `--shortstat` so the log proves what was staged.
10. **In-memory counters ("Added: 30,426") are not evidence of persistence.** Only repo commit history is.
   A script's own success summary can be entirely true about fetching and entirely false about saving.
   When a run's numbers and the repo disagree, believe the repo — and check the commit log before
   celebrating any green run of a new or long-dormant writer.

### Added 2026-07-21 second session (the finals --active-only near-miss)

11. **Any `--active-only` (or otherwise scoped) writer that recomputes aggregate/career values MUST
   preserve out-of-scope contributions and MUST NOT touch out-of-scope records.** `build-finals-stats.js`
   parsed the flag and scoped its SCAN correctly, but its write phase assumed full-scan data: career
   totals recomputed from the scoped map alone (a 12-career-finals veteran would get finals=1) and a
   `?? zeros` fallback that DELETED locked-season flags. Caught before its first live use only because
   the whole script was read before "adding" a flag it already had. The house-proven shape is
   build-win-loss.js active-only Pass 2: existing values are the baseline, scoped seasons are
   authoritative, everything else untouched. A flag parsing correctly is not a flag implemented safely.
12. **Verify "known pending" items against the current files before building them.** Three carried
   memory items were already done (API-reference pagination fix, the filename-comment rule, migration
   step 3b-2) and one premise was inverted ("scripts ignore the flag" — both parsed it). Session-carried
   task lists go stale; the current file is authoritative over any summary of it, including this one.
13. **Boolean workflow-input gates (CORRECTED same day, proven live):** in job-level `${{ }}`
   EXPRESSION context, a `type: boolean` input is a REAL boolean and GitHub coerces mismatched types
   to number ('true'→NaN never equals true→1) — so `inputs.x == 'true'` SKIPS on a true input. That
   exact gate skipped the first chained leaderboards run (2026-07-21). Bash run-step comparisons
   (`[ "${{ inputs.x }}" = "true" ]`) work because interpolation renders the boolean as a string —
   a DIFFERENT context; do not carry evidence across contexts (the original version of this very
   directive did, and codified the failing form). Robust job-gate form:
   `if: ${{ inputs.x == true || inputs.x == 'true' }}`. SUSPECT by the same mechanism: the deployed
   nightly's `inputs.dry_run != 'true'` job gates may fail to SKIP on dry_run=true — verify from a
   past dry-run run's job list before relying on dry-run.

### Added 2026-07-28/29 (the lost dispatch)

14. **A chain-critical single API call must retry, exactly like a push.** The matrix self-retrigger
   and its terminal fan-out were bare one-shot `gh workflow run` calls; one HTTP 500 (2026-07-27)
   stopped the sweep with no retrigger, no terminal and no `build-team-stats`, so rosters silently
   went stale repo-wide while every player file was correct. Retry transient failures with backoff,
   FAIL FAST on HTTP 4xx (422 bad input / 404 missing workflow / 401-403 bad token are permanent —
   retrying them for minutes buries the real error), and THROW when exhausted: a broken chain must
   be red. The same reasoning that produced the 60-attempt push retry applies to every network call
   the chain depends on.
15. **Directive 10 extended to sharded workflows: a progress number aggregated from shard artifacts
   is not persistence.** The matrix summed `written` from shard summaries and never consulted
   `needs.apply-and-commit.result`, so a run whose apply step DIED could report thousands of writes,
   reset the consecutive-zeros counter, and retrigger as if healthy. Any aggregator that reports
   progress must gate that report on the result of the job that actually committed.
16. **Absence of a commit is not evidence of absence of work.** A derived file that is already
   correct is rewritten byte-identically and therefore never committed (a 522-file repair run staged
   ~148), and a bounded-depth clone cannot see a commit older than its shallow boundary — "no commit
   found" means "could not look". Where a check can compare live VALUES on both sides, that is the
   verdict; commit timestamps are context. This does not weaken directive 10: a commit still PROVES
   persistence, it just cannot DISPROVE it.



17. **Run it. Every claim in this session that survived was executed; every one that didn't, wasn't.**
   The `legacy` root cause was proven by extracting `applyRoundFixtures`' real entry-construction and
   driving a legacy-flagged record through it. The `git add` failures were proven by running old and
   new against a real repo with a bare remote — the old code left a real change uncommitted, HEAD
   unmoved, and printed NOTHING. The StatTrack render bug was proven by a 13-case matrix. A predicted
   discriminator (`spc:1`) came back ZERO and the answer arrived from evidence I had called weak —
   which is the point: executing the check is what corrects the theory. Reading the code would have
   produced a plausible story for all four and been wrong about at least one.

---

## ⚠️ Standing traps (added 2026-07-30/31 — each cost real damage; read before editing YAML or trusting a check)

**T1 — A `>-` FOLDED scalar with a more-indented continuation preserves the newline, and GitHub
treats the unparseable multi-line `if` as a TRUTHY literal.**
```yaml
if: >-
  ${{ (a == true || a == 'true')
      && (b == '' || b == '[]') }}    # ← MORE indented: newline PRESERVED
```
YAML folding joins only equally-indented lines. GitHub received a multi-line value it could not
parse as an expression, fell back to a non-empty literal string — TRUTHY — and the job ran
unconditionally: `clear-stats-checked.js` wiped `statsChecked` from **413,364 files** on a dispatch
that targeted one shard.
**Scope (NARROWED 2026-08-03 — the original "keep every `if:` on one line" was OVERBROAD):** the
proven failure is the FOLDED (`>` / `>-`) form with an uneven continuation. All four job-level
gates in the deployed `nightly-crawl.yml` are `if: |` BLOCK scalars containing literal newlines
and demonstrably evaluate as expressions (a truthy-literal retrigger gate would re-dispatch every
drained nightly forever with new_zeros=0 — it does not). **Do not "fix" those four gates; leave
them byte-identical.** For NEW or edited gates: single-line `if:`, never a folded scalar; and
verify what actually shipped per T2 (`repr()` the value, and for single-line intent assert
`chr(10) not in value`) — `yaml.safe_load()` passing proves nothing about expression validity.

**T2 — `yaml.safe_load()` passing proves NOTHING about GitHub expression validity.**
It proves the file is well-formed YAML. T1's broken gate parsed perfectly. Worse, the check that was
supposed to catch it printed `' '.join(v.split())`, which NORMALISES AWAY the newline — the
verification destroyed the only evidence of the bug. **Print `repr()`, and assert
`chr(10) not in value`.**

**T3 — Put a bash guard in front of any destructive command.** Do not let a GitHub `if:` be the only
thing standing between a dispatch and a 413k wipe. Bash is testable from here; GitHub expression
semantics are not. Guards should FAIL TOWARD DOING LESS: an unrecognised input must mean "refuse",
never "proceed".

**T4 — A retry loop that only handles the response path is not a retry loop.**
`refreshSession()` had 10 attempts, but the loop only ever retried "response arrived without usable
cookies" (`continue`). A socket-level throw from `doFetch` (ECONNRESET) escaped BOTH for-loops and
killed the shard on attempt 1 of 10. **Catch network errors INSIDE the attempt loop.**

**T5 — Never cache a rejected promise in a lock.** `sessionPromise = null` sat AFTER the loop, so a
throw skipped it, leaving a REJECTED promise in the session lock. Every later `refreshSession()` hit
`if (sessionPromise) return sessionPromise` and got the same rejection forever — no recovery path
existed. **Release locks in `.finally()`, which runs on success, throw and rejection.**

**T6 — A single-path report file is overwritten by the next run.**
`reports/fold-diverged.json` is rewritten every run. A 1-player fold overwrote the 2,263-entry report
from the run that caused damage, so a repair reading it fixed 0 of 284. **Prefer reconstructing state
from the data itself.** The working fix used a guarantee already in the code (`spec.add(trunc(key))`
means the survivor always carries the deleted file's truncated id).

**T7 — A post-check must assert the invariant the change can break.** The fold's post-check asserted
"zero apiId fields" and passed cleanly on the run that orphaned 268 aliases. Scope blame: fail on what
THIS run caused, report what predates it.

**T8 — PlayHQ WAF tolerance DEGRADES under sustained load.** In a full sweep, run 1's shards got ~41
batches deep; four hours later shards were blocked INSIDE their first batch of 30, writing ~26 per run
across 6 shards regardless of how many players remained. The limit is the fresh runner's allowance,
not the work available. A sweep's tail is throttle-bound, not volume-bound — do not read a slow tail
as a stall. (Corroborated by the 2026-06 sweep: "CloudFront blocks ~175/256 shards per run".)

**T9 — ✅ FIXED 2026-07-31, but the trap is worth keeping in mind.** The matrix retrigger forwarded
`inputs.shards` VERBATIM. Narrowing lives in the CALLER (the
nightly passes a targeted list from `needs-matrix-shards.json`), not in `generate-shards`, which
expands empty -> all 256 unconditionally. So a manual `shards=[]` dispatch spins 256 jobs on EVERY
retrigger forever. Idle shards are harmless (`if (stats.toFetch === 0) return;` precedes
`refreshSession()`, so they make zero API calls) but it was ~250 wasted jobs per run.
**Fix:** the aggregate step now emits `next_shards` from the shard summaries — shards with
`remaining > 0` OR `blocked`, PLUS any expected shard that produced NO summary (a crashed shard's
state is unknown and must be retried, never silently dropped).
**The trap that shaped the design: an empty shards value means ALL 256 to `generate-shards`, not
"none".** So an empty narrowed list must NOT be emitted as `[]` — it falls back to forwarding
`inputs.shards` unchanged. A sentinel single shard was considered and REJECTED: if `remaining` were
ever wrong, a sentinel would narrow the sweep permanently and terminate early with work undone. The
fallback fails toward doing MORE. Cost of that choice: the final ~3 zero-progress runs still fan out
full-width. On the 07-30 tail this would have made 34 of 37 runs spin 6 jobs instead of 256.
`force -> '[]'` is deliberately untouched — it is a full-coverage guarantee after a repo-wide
`clear-stats-checked`.

**T10 — A workflow-level `concurrency` group does NOT cover workflows that workflow DISPATCHES.**
`nightly-crawl.yml` holds `data-write` for its whole run, and every player-file writer inside it is
therefore serialised. But it dispatches `fetch-profile-stats-matrix.yml`, which is a SEPARATE run and
not in the group — so the matrix started writing `players/` while `build-win-loss.js`, still running
inside the nightly, was writing `players/` too. Both push, `merge -X ours` keeps whichever lands
second, and the other's version of any shared file is silently discarded. A lock protects the runs in
its group, not the work those runs set in motion. **Prefer `needs:` ordering over adding locks** —
ordering costs nothing, while a lock on a high-frequency job makes it queue behind multi-hour jobs.
(Found 2026-07-31 by reading `nightly-crawl.yml`; the job graph is the evidence, not the lock
declaration.)

**T11 — A MERGE THAT PRESERVES UNKNOWN FIELDS ALSO PRESERVES WRONG ONES, FOREVER.**
Both writers of `games/bv` build their entry as `{ ...existing, ...newValues }`. That is correct and
deliberate for `p`/`spc` (fields the writer does not own), and `discover-fixtures.js` even declares a
`TRACKED` list to say so. But no flag is ever in the overlay, so a flag set ONCE by a since-deleted
classifier survives every subsequent write for all time. Cost: **3,262 games carrying `legacy`, 3,120
of them holding a score that contradicts it**, and 49 also carrying `forfeit` (the "flag collisions"
flagged by every audit run since forever and never diagnosed). Proven by executing
`applyRoundFixtures`' real entry-construction against a legacy-flagged record.
**The rule:** when a writer merges over an existing record, enumerate which fields it OWNS and which
it PRESERVES — and treat "preserved" as a decision to be justified per field, not a default. A field
nobody owns is a field nobody can correct.
**The second-order lesson:** `db-audit.js` had checked `legacy` against other FLAGS for months and
never against DATA, so a 3,120-row contradiction was invisible to every run. When adding an invariant,
ask what the flag ASSERTS about the world, then check the world — not the neighbouring flags.

**T12 — A FIX RECORDED IN A DOCUMENT IS NOT A FIX IN A FILE.**
`REPO_MANIFEST` §2.2 and §6.8 both recorded the `discover-fixtures.js` staging bug as fixed on
2026-07-21 ("now per-path adds + `staging:` visibility"). The deployed file still had the original
combined `git add` inside an empty catch — confirmed by reading it AND by re-running its exact
pathspec list with `team-lookup/` absent, which printed "(no changes to commit)" and staged nothing,
exactly as on 2026-07-19. Two documents asserting a fix is not evidence the fix shipped. This is the
same family as directive 12 ("a grep is not a read") and the 2026-07-28 unearned verification.

**T12b — …AND THE SAME IS TRUE OF RETIREMENTS. A WORKFLOW DOCUMENTED AS RETIRED CAN STILL BE ON CRON.**
`weekly-future-fixtures.yml` was recorded in TWO documents as "retired unrun" / "delivered-but-unrun".
Its `schedule: cron '0 0 * * 6'` had been firing every Saturday 00:00 UTC (= Sat 10:00 AEST) the entire
time, running the 60–90k-call approach that LOST the §B5 decision, weekly, beside the ~25k-call path
built to replace it. Found 2026-08-01 only because the run appeared in the Actions tab and looked
mistimed. **The refined rule: this repo's documents are reliable about DECISIONS and unreliable about
whether the decision was EXECUTED.** Retirement, deletion and "fixed on <date>" are all claims about
execution — verify each against the file, and for scheduled workflows verify against the `on:` block
specifically, because a live cron leaves no trace anywhere else. Three instances in two days: the
discover-fixtures staging fix (§6.8), this, and `discover-seasons.js.old` (deleted-in-docs, present on
disk).

**T18 — A DELIBERATE REFUSAL IN ONE SCRIPT IS INVISIBLE TO THE NEXT ONE.**
`repair-duplicate-regs.js` refused two `foulOuts` groups (2 vs 1) because max and sum genuinely
disagree there, left them untouched, and printed them for a human decision. `repair-reg-sibling-sync.js`
— written hours later, grouping by `tid` alone rather than `(tid, gid)` — swept them up and applied max.
The refusal was correct, the sweep was correct for ITS population, and nobody chose the outcome:
execution order did. Small here (2 players, one foul-out each), but the shape scales badly.
**The rule:** a decision to NOT touch data leaves no trace in the data. If a repair deliberately skips
records, either record the skip somewhere durable (a report file committed alongside, or a marker in the
record) or expect the next repair over the same rows to undo it. "It printed a warning in a log" is not
a durable record — the log is gone with the runner.

**T16 — PER-PATH `git add` HAS A SCALE CEILING, AND IT IS LOWER THAN YOU THINK.**
Directive 9 (stage per-path so one unmatched pathspec cannot silently discard the rest) is correct at
the scales it was written for: the fold stages ~5k paths, the nightly a few hundred.
`repair-duplicate-regs.js` staged **24,534**, and git rewrites its ENTIRE index on every invocation —
an index covering 527,900 files, roughly 40 MB. That is ~2 TB of index I/O. On 2026-08-01 it burned a
120-minute timeout AFTER completing every merge and every file write, and the run was cancelled with
NOTHING committed.
**The rule:** above ~2,000 paths use `git add --pathspec-from-file=<file>` — ONE invocation, still fully
explicit, never `-A` — and fall back to per-path ONLY if the batch fails, to isolate and report the
offender. That preserves directive 9's intent at any scale. Measured: 3,000 paths took 10,753 ms
per-path versus 96 ms batched, on a near-empty repo; against the real 527,900-file index the gap is far
wider, because per-path cost scales with index size and batched cost does not.

**2026-08-09 — the rule was already written here and `fold-diverged-players.js` had never been audited
against it.** A 13,675-player fold did all its real work in **82 seconds**, then spent **1h54m** staging
~27,600 paths one `git add` process at a time (~250 ms each against this repo's ~50 MB index) and was
killed by its 120-minute timeout with every write complete and NOTHING committed — the `staging:` line
never printed, which is the signature of dying inside the add loop. Batched staging with the per-path
fallback took the same commit to **809 ms** in test and ~4 minutes live. When a trap is recorded, grep
every writer for it; recording it protects nothing on its own.

**T17 — "WRITES INCREMENTALLY, COMMITS ONCE AT THE END" IS THE PROGRESS-FILE FAILURE IN DISGUISE.**
The progress rule says: persist AND push at every save interval, because in-memory progress is lost on
timeout or cancel. `repair-duplicate-regs.js` obeyed the letter of nothing — it wrote 24,534 player
files to the working tree and staked all of them on a single commit at the very end. A cancellation took
every one. The files were on disk the whole time; the runner is what vanished.
**The rule:** if a script writes N files across a long run, it commits in batches during the run, not
once at the end. Fixed with a 3,000-file flush; a cancellation now costs at most one batch, and the
script being idempotent means a re-run finishes the job. Ask of any long writer: *if this is cancelled
at 95%, what survives?* If the answer is "nothing", the commit structure is wrong regardless of how
correct the logic is.

**T14 — WHEN TWO WRITERS DISAGREE ABOUT A RECORD'S KEY, ONE OF THEM WILL SILENTLY GENERATE DUPLICATES.**
Three scripts wrote `player.seasons[].regs[]` and each used a different identity for a reg:
`nightly-crawl.js` `(tid AND gid)`, `fetch-profile-stats.js` `(tid)`, `discover-seasons.js` `(tid)` —
and the last one MUTATED `gid` in place, which could collide an existing reg with a sibling another
writer had appended. Result: 27,666 duplicate `(tid, gid)` regs that neither other writer could produce,
because both check and skip. It also formed a LOOP: one script collapsed a regrade to the latest grade,
the other met a game in the older grade, found no match, and appended it back.
**The rule:** before adding or editing a writer of a shared collection, write down the record's KEY and
check every other writer uses the same one. A find-or-create whose match key differs from a sibling's is
a duplicate generator, not a merge. And an in-place MUTATION of a key field is the worst case — it can
create a collision out of two records that were previously distinct.
**Second-order:** `build-leaderboards.js` keyed season rows on `uuid|tid` and ASSIGNED rather than
accumulated, so the same disagreement silently dropped one row per regraded team. A disagreement about a
key does not stay in the writers; it propagates to every consumer that indexes by it.

**T15 — A COUNTER WITHOUT EXAMPLES IS A NUMBER YOU CANNOT CHECK.**
The first duplicate detector keyed on `tid` alone and reported **1,330,231 surplus regs (32%)**. The
number was real; the interpretation was wrong — they were regrades, which are correct data. The only
reason a repair deleting 1.3M legitimate registrations was not built on it is that the detector printed
the reg SHAPES beside the count, and every sample showed two full-shape regs with different grades.
Same pattern twice more the same day: a `spc:1` discriminator predicted to be near-conclusive returned
ZERO, and a null-gid mechanism predicted to be most of the problem turned out to be 0.05% of it.
**The rule: every counter prints samples of what it counted.** Not for the reader's benefit — for the
author's, because it is the only cheap way a wrong theory announces itself before it becomes a script.

**T13 — GITHUB CANNOT CODE-SEARCH THIS REPO, AND ITS FAILURE LOOKS LIKE A CLEAN RESULT.**
`markjovic/sports-players-stats cannot be searched because it is too large` (6.13 GB, 2026-07-31).
The UI then shows **"0 files"** — indistinguishable from "no matches". Reading that as "nothing
matches" is a false negative the interface actively invites. **Use `find-code-refs.yml`** (dispatch,
inline grep over `scripts/` + `.github/workflows/`, scope hard-coded so it can never be aimed at
`games/` or `players/`). This matters beyond convenience: the cross-document fact rule below requires
grepping across all files, and until 2026-07-31 there was no mechanism behind it. It is also the
first CONFIRMED cost of repo size — and as of 2026-08-03 the ONLY one: Mark confirmed publishing
works fine at current size (§D8 closed).

**T19 — THE `data-write` PENDING SLOT HOLDS ONE RUN, AND A NEW ARRIVAL CANCELS THE WAITER.**
`cancel-in-progress: false` protects only the RUNNING slot. Dispatch two data-write workflows in
the same fan-out second while anything holds the lock (nightly, Sunday backfill, Monday fixtures
sweep) and the second arrival EVICTS the first from the queue — a 4-second "Canceling since a
higher priority waiting request for data-write exists" cancellation that leaves the night green.
Fold lost to team-stats this way 2/2 nights once the 2026-08-02 dispatch hardening made every
racer show up reliably (found by Mark 2026-08-04; the reliability work created the reachability).
Fix is ORDERING, not locking: chain the loser off the winner's completion (`chain_fold` via
build-team-stats, 2026-08-04). Never put two same-lock dispatches in one fan-out.
**STRUCTURALLY FIXED 2026-08-07 — and the trap bit its own fixer first:** giving
leaderboards/search/records the data-write lock (2026-08-06, to stop them stampeding the nightly)
put the matrix terminal's four-dispatch burst into this exact one-waiter queue — none of the three
ran again until post-drain-chain.yml replaced the burst with sequential jobs under ONE lock
acquisition (no waiters exist to evict). The trap's lesson generalises: a lock without ordering
CREATES this failure. The residual waiter (graduate-seasons' flip) was
removed later the same day by moving graduation's dispatch to the chain's tail (§2.7 CLOSED).
**2026-08-10 — the SAME burst was still in nightly-crawl.yml's own terminal and had never been
audited.** At drain it dispatched `discover-seasons-matrix` (Sun UTC) and `discover-fixtures` (Mon
UTC) at the SAME INSTANT as post-drain-chain; all three claim `data-write`. Evidence: 2026-08-09,
Post-Drain Chain took the lock at 03:42 and held it 41 minutes (workflow-level = until the whole run
ends) while Discover Seasons started at 03:40, burned **51 minutes** almost entirely in the queue,
and re-attempted at 04:31 and 04:49 before completing clean in 7m40s. Its retrigger gate is
`!cancelled()`, which fires on FAILURE too — so a contended run re-dispatches itself and adds two
more arrivals. Compounding it: `discover-seasons-matrix` claimed the lock TWICE per run
(`generate-shards` + `reduce`) with `MAX_RUNS: 40` self-retriggers = up to **eighty** arrivals per
weekly sweep, and `generate-shards` wrote nothing (its only write was the manual `fresh_start`
branch, since split into its own locked job). FIXED by removing both dispatches from the nightly and
giving each sweep its OWN weekly cron, well clear of the cascade — chaining them off the tail was
built first and rejected the same day, because it left discovery four dispatches deep where any
broken link silently skips a week.

**T20 — ITERATING PER REG OVER DATA THAT IS KEYED PER (SEASON, TID) DOUBLE-COUNTS EVERY
REGRADED PLAYER — AND THIS CLASS HAS NOW STRUCK THREE TIMES.**
Same-season sibling regs SHARE a tid and carry IDENTICAL season-cumulative stat blocks (the
pipeline's sibling sync keeps them in step — verified against a live specimen 2026-08-04:
`gp:13,pts:99` stored twice for a B→BRES regrade). Any consumer that loops `for reg of
season.regs` and SUMS therefore counts every regraded season twice. Strikes: StatTrack season
rows (regressed after an earlier fix, re-fixed 0.69 with per-stat MAX across the tid group);
`build-win-loss.js` career totals in BOTH modes (85W/70L stored for a 99-GP player whose true
record is 51W/47L/1D; fixed 2026-08-04, once-per-(sid,tid) — a FULL run must repair stored
values); and the original per-reg W/L rule 14. THE RULE: per-(sid,tid) facts are consumed once
per unique tid per season — dedupe (Set) or MAX, never sum across siblings. When touching ANY
regs[] consumer, check this first.

**T21 — `actions/checkout` WITHOUT `ref:` PINS EVERY JOB TO THE RUN-TRIGGER TREE — A CONSUMER
JOB NEVER SEES ITS SIBLING WRITER'S PUSHES.**
`github.sha` is frozen when the run triggers. In nightly-crawl, the crawl job pushed the night's
scores + spectator data to main, and then win-loss/team-stats/venue-* /matrix-dispatch all checked
out the PRE-CRAWL snapshot — computing yesterday's games, every night, since the job split
(2026-08-04, found via a live `gp:4` beside a stored `1W 2L`; the attribution logic was proven
innocent by executing it against the real game entry). Self-heals daily, which is exactly why it
was invisible. THE RULE: any job that consumes a sibling job's pushes checks out `ref: main`
(fetches main as of THAT JOB'S start). Writer jobs can stay on the trigger SHA — their
fetch/merge/push machinery reconciles. When debugging "the data was on main but the job didn't
see it": read the checkout step's `HEAD is now at` line FIRST, before any theory.

**T22 — NEVER COMMIT DERIVED STATE THAT SCALES WITH THE DATA. GitHub's 100MB FILE LIMIT IS A
HARD, PERMANENT REJECTION.**
`build-finals-stats.js` serialised its ENTIRE player→season map into
`scripts/.finals-progress.json` and committed it at every checkpoint. The 2026-08-05 fields grew
each entry from 3 numbers to 11 and the file hit **110.14 MB** — `remote: error: GH001` — killing a
full run mid-flight, and the 60-attempt push retry then burned every attempt on a rejection that
could never succeed. Compacting would only have deferred the crash: any serialised full map grows
with the corpus. THE RULE: the commit-progress rule (T17) exists to protect API BUDGET on FETCH
jobs. Pure local compute does not qualify — a lost scan costs a re-scan. `build-player-games.js`
had this right all along: the map lives in memory, nothing is persisted. Corollary: a push
rejection matching size-limit/GH001/LFS patterns is the git equivalent of an HTTP 4xx — fail fast,
never retry.

**T23 — A COMMIT IS NOT A PUBLICATION. MANUAL REBUILDS NEED A DEPLOY PAGES RUN.**
Pages deploys only when the Deploy Pages action runs, and it is chained to the SCHEDULED nightly —
not to manually dispatched rebuilds. On 2026-08-05 `build-finals-stats` committed correct data to
main and StatTrack kept rendering the morning's published snapshot for hours; three separate "the
feature is broken" investigations traced to this. THE RULE: when a manual rebuild changes data
StatTrack reads, dispatch Deploy Pages afterwards, then hard-refresh. When debugging "the data is
right on main but the app shows old values", check the last Deploy Pages run time BEFORE reading
any code.

**T24 — A SCAN THAT COMPARES A FIELD TO ITS OWN SOURCE MEASURES NOTHING. READ THE BUILDER FIRST.**
`size-missing-gids.js` compared `player.games[]` against `games/bv` and returned a triumphant 0 —
because `build-player-games.js` GENERATES `games[]` from those same files' `p[]` arrays. The
difference was empty by construction, on a wasted dispatch, because the scan was designed from an
assumption about where `games[]` comes from instead of from reading the 200-line script that writes
it. THE RULE: before measuring a gap between two datasets, read the writer of BOTH and confirm they
have independent sources. The valid replacement (`size-appearance-gaps.js`) compares PlayHQ's own
`reg.stats.gp` against local appearance counts — genuinely independent. Related: prefer a DIRECT
count to an estimate whenever one exists (775,703 missing appearances ÷ ~12 attendees ≈ 64k games
was an estimate conflating two populations; counting scored games with no `p[]` is exact).

**T25 — EVERY WORKFLOW THAT WRITES TO THE REPO MUST HOLD `data-write`, EVEN WHEN ITS PATHS
CANNOT CONFLICT.**
`build-leaderboards`, `build-search-index` and `build-records` wrote to the repo with NO lock. The
matrix terminal fans all three out the moment the matrix chain drains — which is typically while
nightly-crawl is still running — so they rewrote main underneath it. On 2026-08-06 the nightly's
`venue-indexes` job finished its own work in **20 seconds**, then spent **40 minutes** stuck in
fetch/merge/push and died at the job timeout. The paths never overlapped (`venue-lookup/` vs
`leaderboards/`): **push contention on a 6 GB repo is path-agnostic — every push must merge the
others' commits**, and merges over tens of thousands of changed files are slow enough to exhaust a
retry loop. THE RULE: writes-to-repo ⇒ `data-write`, no exceptions for "different directories".
Corollary for diagnosis: a job that logs its work quickly and then goes SILENT for tens of minutes
is stuck in git, not in its own logic — read the timestamps between the last log line and the
cancellation before touching timeout values. Raising the timeout treats the symptom.
Second corollary: chain-dispatched runs are labelled "Manually run by <user>" (the PAT). A cluster
of "manual" runs at 4am is the terminal fan-out, NOT a person — never diagnose it as operator
behaviour.

**T26 — `execFileSync` HAS A 1 MB DEFAULT OUTPUT BUFFER, AND EXCEEDING IT SIGTERMs THE CHILD
MID-OPERATION.** Node's default `maxBuffer` is 1,048,576 bytes. 2026-08-09: a fold's
`git merge -X ours FETCH_HEAD` printed **1,051,036 bytes** of per-file "Auto-merging …" lines across
25,593 changed files — 2,460 bytes over — so Node killed git *during the merge* with ENOBUFS/SIGTERM,
the script crashed, and a commit that had ALREADY been made was never pushed. Reproduced at the exact
byte size before fixing. This fails in the worst possible way: after the work, before the push, with
a stack trace that names the buffer and not the cause. **The rule:** every `execFileSync` git call in
a tool that commits at scale passes an explicit `maxBuffer` (512 MB is the house value), and every
merge passes `-q --no-stat` so the per-file lines are never emitted. Fixed the same day in
`fold-diverged-players.js`, `spectator-backfill.js`, `repair-players-batch.js` and `nightly-crawl.js`
(seven git calls each) — the last three inherit `gitCommit` verbatim, so the bug propagated with the
pattern. Anything that copies that block inherits it again unless it carries the buffer.

**T27 — A SCHEDULED RUN RECEIVES NO INPUTS. `workflow_dispatch` DEFAULTS DO NOT APPLY TO `cron`.**
Every `inputs.*` is empty on a schedule trigger, and empties degrade silently: a boolean reads false,
a string reads "", and shell arithmetic on "" throws. Concretely (2026-08-10, adding weekly crons to
the discovery sweeps): `backfill_teams` empty would have run the weekly sweep in `current` mode
instead of `all+backfill` — the wrong sweep, green; `concurrency` empty would pass `--concurrency=`;
`run_number` empty makes `[ "" -ge 40 ]` a bash error that kills the self-retrigger after run one.
**The rule:** a workflow with BOTH triggers resolves every input through an explicit fallback at each
use site (`${{ inputs.x || '<default>' }}`, and `${{ (github.event_name == 'schedule' && 'true') ||
inputs.x }}` where the schedule needs a non-default), OR branches on
`github.event_name == 'schedule'` and sets its arguments explicitly. A self-retriggering workflow must
pass the RESOLVED values forward, never the raw inputs — otherwise run 1 is correct and run 2 silently
reverts to defaults. `spectator-backfill.yml` (weekly tail) and both discovery sweeps carry this.

### Added 2026-08-07 (the active/locked split — invariants that must survive every future edit)

The served data lives on TWO Pages origins since 2026-08-07 (manifest §6.30). These are the
invariants; violating any of them recreates a designed-out failure:
- **`archivedAt` is a statement of VERIFIED FACT** — set only by graduate-seasons.yml, only after
  the season's file was probed live on the archive origin. Nothing else may ever set it. Routing,
  the active-artifact strip, and the archive all key on it; because of the ordering, "index says
  archive but archive lacks it" is unreachable.
- **The 28-day grace lives in EXACTLY ONE place:** the `grace_days` input default in
  graduate-seasons.yml. Never add a second site (graduation is deliberately dispatched
  UNCONDITIONALLY — since later on 2026-08-07, from post-drain-chain.yml's tail, so its flip can
  never share the data-write pending slot with anything — and no pre-check anywhere may carry a
  drifting copy of the grace).
- **Union rule on the archive:** it includes seasons that are locked OR carry archivedAt, so no
  flag combination can strand a season off both origins. Do not "simplify" it back to locked-only.
- **Unlock clears BOTH flags in ONE write** (scan-complete-rounds --unlock). Any new tool that
  clears `locked` must clear `archivedAt` in the same commit.
- **StatTrack: per-season fetches go through `sgj`/`seasonBase` ONLY** — never a hand-built
  BASE url. Serving origin stays INVISIBLE in the UI: markers key on `locked`, never `archivedAt`.
- **Failure direction is designed:** anything that goes wrong leaves the season serving from
  ACTIVE with its flag unset, self-retried nightly, red-visible. Keep it that way — never flip a
  flag before a live probe.
- **Any workflow that WRITES locked-season files** (games/bv, team-stats/bv, leaderboard/season)
  dispatches deploy-archive-pages at its tail; the archive's weekly cron (Sun 04:00 AEST) is the
  backstop, capping staleness at a week.
- **The archive repo holds NO data, ever** — one workflow + README; the site is the artifact,
  built from THIS repo's checkout each deploy.


### Added 2026-08-10 (the appearance gap — mechanism PROVEN, and the sweep that closes it)

The 2026-08-06 conclusion ("partial rosters predating the spectator flag, not worth chasing") was
right about the cause and wrong about the cost. Proven this week, per game, with evidence:

- **The mechanism, caught with a 2026 specimen.** Game `7da945a8` (JCC 2026, Ballarat v Colac): our
  stored `p[]` holds 12 ids and is a **strict subset** of the live spectator box's 19 — verified
  programmatically, not by eye. PlayHQ's own game page shows all 19 with the same stat lines the
  profile API returns, so the data was public the whole time and the gap is entirely on the capture
  side. The game was captured while its e-scoring box was PARTIALLY ENTERED, by a pre-`spc` writer;
  the round then settled, and `nightly-crawl.js` builds its spectator queue only from rounds it
  fetches (`roundsComplete` + ROUNDS_BACK), so nothing ever asked again. My earlier claim that such
  games are "re-queued every nightly" was WRONG and was corrected by reading the queue-build code.
- **`spc: 1` IS A CAPTURE-ONCE FLAG AND IT FREEZES THE GAME FOREVER.** The nightly queries spectator
  once, at FINAL-within-window, and sets `spc` on whatever the box contained at that moment. A box
  that completes later is never revisited, and the game is invisible to every queue including the
  re-sweep's. This is the one failure mode no sweep can detect after the fact (a frozen partial is
  indistinguishable from a complete small roster) and it is the headline requirement for the
  capture-at-source design: stop freezing at FINAL, let the aged sweep be the roster authority.
- **Scale, measured twice by independent methods that agree.** `size-gap-players.yml` (offline:
  profile-derived career `gp` minus roster-derived `games[]` length) — 102,609 players with a
  positive gap, 757,272 missing appearances, against the 775,703 aggregate probe: 2.4% apart.
  Bottom-heavy: 80% of affected players miss ≤5 games; ~1,060 miss 100+. `size-resweep.yml` sized
  the sweep target at 2,026,441 games (avg 12.8 ids each), rising every year — 152,899 in 2026 — so
  the population is being PRODUCED NOW, not just inherited.
- **The metric cannot be read mid-campaign.** Its two inputs update on different clocks: profile `gp`
  nightly, `games[]` only on the WEEKLY rebuild. Between rebuilds every player who played that
  weekend adds +1, so readings inflate and the sweep's recoveries stay invisible until `games[]` is
  rebuilt. Readings taken on 2026-08-07..10 rose from 102,609 to 151,856 for exactly this reason,
  plus newly-stubbed players becoming measurable for the first time. **Read it only after a
  `build-player-games` rebuild, at campaign end.**
- **Retries do not convert: 0.003%.** A run that re-asked 77,397 previously-missed games returned
  **2** hits. Misses are dead eras (associations that never e-scored), not flaky responses — hence
  `--miss-attempts` defaulting to **1**: one real ask per game, then retired via a durable `spcm`
  counter. The retirement is REVERSIBLE by construction (`spcm`, never `spc`), so a future route to
  that data can always re-admit them with `--miss-attempts=0`.
- **Misses must leave the queue or the campaign eats itself.** Before the marker existed, misses wrote
  NOTHING, so every later run re-asked every accumulated miss at its head (the queue is season-sorted)
  — by run 5 that head-tax was ~77k re-queries, ~2 hours, for 2 hits. The marker was filed as an
  endgame cleanup and should have shipped before the first `--include-partial` dispatch: analyse a
  tool as a CAMPAIGN, not as one run.
- **A per-player recovery route exists and is proven.** The profile API returns every game it credits
  a player with, so a targeted repair can append them to held games' rosters — gated per game by the
  alias inspection (GENUINELY-ABSENT only; PRESENT-as-alias / PRESENT-legacy are fold problems where
  appending would DUPLICATE). Nate Parker: 555 credits, 92 held, 462 recoverable, 0 alias cases.
  Route is profile-gated: a private/removed profile 403s and is dead for that player. The website's
  statistics view erroring on a profile does NOT mean the mobile API refuses it — the app renders
  from the same endpoint the crawl uses.

**Campaign invariants (keep these true):** the sweep's age guard (`--min-age-days`, default 30)
exists because `spc` freezes a box — never sweep games whose boxes may still be completing; the
guard is FRESHNESS, not lock status (guarding by `locked` deferred months of settled current-season
data for up to a year, and was replaced the same day it was proposed). Deferred games self-drain as
they age, which is what the weekly cron is for. The write path replaces `p[]` only when the fetched
id SET differs — a widened sweep would otherwise rewrite ~2M entries whose only change is element
order.

### Added 2026-08-11 (THE TWO-SERVICE DISCOVERY — the assumption the roster pipeline was built on was wrong)

**PlayHQ has TWO game services and we only ever read one.**
`spectator.playhq.com` is the **live-scoring** service: it holds games scored in real time at the
venue. `api.playhq.com` (`gameView` → `discoverGame`) is the **canonical record**: it holds every
game, including those scored on PAPER and entered afterwards. Those paper-scored games have a full
box score in the canonical record and DO NOT EXIST in spectator, which answers
`"game could not be found or was not electronically scored"` for them. Our entire roster capture —
nightly, backfill, everything — read spectator only. **So paper-scored games have been invisible to
us since day one.** This is a scoring-METHOD split, not an era or a rollout, which is why it shows up
at 2.3% in EDJBA Summer 2022/23 (97.7% captured) just as it does at 100% in VJBL 2021.

**How it was found (the tell was Mark's, not mine).** After the sweep, 265,194 games sat retired as
misses. A read-only analyser (`size-misses.yml`) bucketed them by their own season's capture rate;
Mark spot-checked the suspicious bucket and found **3 of 4 had full player statistics live on
playhq.com**. I then built a re-admission flag on the wrong theory (transport failures) — a 200-game
probe returned **200/200** `"game could not be found or was not electronically scored"`, and the
Worker returned `{"error":"Game not found"}` for the same id, proving the retirement CORRECT and the
flag useless. What broke it open was Mark noticing the page said **"Play by play is not available as
this game was not scored live at the venue"** — the site telling us plainly which service it uses.
DevTools then showed the page calling `gameView` on the main API with the same game id.

**Evidence for the scale.** Five games sampled from seasons at 0% spectator coverage: FOUR returned
full lineups from `discoverGame`; the fifth 404s (deleted upstream — a small separate population
worth remembering: games we hold that PlayHQ no longer has). So the "pre-2022 dead era" in the
coverage table is largely NOT dead — those associations were scoring on paper.

**Flags — keep these distinct, they are three different facts:**
- `spc: 1` — roster captured from the live-scoring service.
- `spcm: N` — the live-scoring service was ASKED and could not serve it. Never overwritten by the
  other path; it stays true forever.
- `dg: 1` — roster captured from the canonical record (`discover-game-backfill.js`).
- `dgm: N` — the canonical record was asked and permanently failed (404 / not found).
A game may legitimately carry `spcm` AND `dg`: spectator couldn't serve it, the canonical record
could. Any queue check for "already captured" must test `spc` OR `dg`.

**`gameView` returns MORE than spectator did:** player profiles arrive as FULL uuids with first and
last names, so stubs are created already named instead of waiting for the matrix to name them.
Fill-in and anonymous participants carry no profile id and are counted and skipped, never guessed.

**Two rules this episode confirms.**
1. *A negative result from one endpoint is not a fact about the data.* "Not electronically scored" was
   PlayHQ describing its own service, and I read it as a statement about the game. Before concluding
   data does not exist, check whether another service holds it.
2. *Never trim an exercised PlayHQ query.* The `gameView` query is embedded verbatim from Mark's
   browser capture, all fragments intact. I trimmed it first and caught myself; partial queries break
   silently, which is exactly the trap that rule exists for.

### Added 2026-08-11 (rosters are NOT box scores — a rule I nearly broke)

`p[]` holds bare `{id}` entries: WHO played. Box scores (points, fouls, per-player stat lines) are
Worker-on-demand and never pre-stored — see "Data-structure gotchas". The 2026-08-07..11 sweep wrote
ONLY `p[]` ids plus a capture flag, so the convention held; but `repair-player.js` and
`repair-players-batch.js` as first built would have appended `hp[]`/`ap[]` stat lines into REAL
crawled games. Corrected 2026-08-11 before either was ever run. Three reasons, recorded at the write
site in both files so nobody "helpfully" restores it:
- a stat line for ONE appended player in a game where thirteen played is a FRAGMENT that reads as a
  box score — one scorer, twelve apparent no-shows. Misleading data is worse than absent data,
  because absent data makes the consumer fetch the real thing;
- completing them all is ~25M stat lines / ~1.9 GB, larger than the whole dataset and straight
  through the Pages ceiling;
- stored stats go STALE — scorers amend box scores, and the Worker always serves the amended version
  while a stored copy freezes the day we fetched it.
The sole exception is `profileOnly` (hidden) games, where no real game exists for the Worker to
serve, so the fragment is the only version that will ever exist and is flagged incomplete by nature.
That is `synthesize-missing-games.js`'s business and nothing else's.

### Added 2026-08-13 (T28/T29 — two ordering traps, and a day lost to theorising instead of reading)

**T28 — `concurrency` AT WORKFLOW LEVEL DOES NOTHING BETWEEN A WORKFLOW'S OWN JOBS.** It serialises
that workflow against OTHER workflows in the group. Inside one run, jobs are parallel unless `needs`
says otherwise. `weekly-indexes.yml` had three jobs — `team-stats`, `win-loss`, `player-games` — all
`needs: [discover-fixtures]`, all writing player files, each with its OWN checkout, all pushing with
`merge -X ours` ("on conflict keep my copy"). That is a LOST-UPDATE path, not merely a staleness one.
The file's own `fold-diverged` comment already said jobs are "otherwise parallel"; nobody drew the
conclusion. FIXED 2026-08-13: chained `discover-fixtures → team-stats → win-loss → player-games`.

**T29 — ANYTHING THAT DERIVES FROM `games/bv` MUST RUN AFTER EVERY WRITER OF `games/bv`.**
`build-player-games.js` rebuilds each player's `games[]` ENTIRELY from `p[]` in the game files. In
`weekly-indexes.yml` it ran in parallel with `discover-fixtures`, whose job timeout is 360 minutes and
which commits games throughout — so it derived from whatever its own checkout captured at job start.
Symptom: the weekly reported 9,353 player files updated; the identical script run standalone
immediately afterwards updated 13,046 and correctly filled a player who had 473 roster entries in
games/bv and a `games[]` of 30. Nothing was wrong with the script, the resolver, the alias index, the
game data or the repair tools. Only the ordering. `player-games` is now LAST in the chain, and the
job carries a comment saying anything added that writes games/bv goes BEFORE it.

**The debugging failure is the real lesson here, and it cost most of a day.** Six theories were
proposed and every one was wrong: fill-in players, mass mis-attribution, resolver returning null, a
missing `uuid` field on index stubs, a 13-char prefix collision, and a broken write path in the batch
tool. Each cost Mark a dispatch or a browser check — and each dispatch costs ~5 minutes of repo
checkout before it does anything. What finally worked was reproducing the real script against real
uploaded data in the sandbox (one season file, the real index shard, the real alias shard): the
resolver returned the correct uuid, `getCollisions()` was empty, and Phase 2 flagged the file for
update — proving the code correct by EXECUTION and leaving ordering as the only survivor.
**Rules taken from it:** when a derived value looks wrong, check WHEN the deriving script last ran
over the current data BEFORE hypothesising about how it works; prefer one read-only reproduction over
three plausible theories; and never assert what a workflow did without reading its YAML — the whole
day rested on assuming the weekly had run `build-player-games` over final data.

**Also corrected the same day:** `build-win-loss` needs no forced pass after roster writes — the
weekly's `win-loss` job already covers it, and a repeat run correctly reports 0 updated. I put a
"forced Build Win/Loss" step on every checklist for four days without checking the workflow.

### Added 2026-08-13 (repair tools: never append to an UNCAPTURED game)

`repair-player.js` and `repair-players-batch.js` appended a player to any held game whose roster
lacked them — including games with an EMPTY `p[]`. An empty roster is not a gap; it is a game NO
sweep has captured (no `spc`, no `dg`). Proven on `43199a27` (2026-08-04, Berwick College White):
after the batch, that game's entire roster was TWO ids — both of them the tool's own top-ranked
repair targets — in a game that holds a dozen or more. Every consumer reading `p[]` (team stats,
leaderboards, opposition lookup, StatTrack) treats that as the full team. Same failure class as the
`hp`/`ap` fragment caught on 2026-08-11: a fragment that LOOKS like real data is worse than absence,
because absence makes a consumer fetch the real thing. FIXED: both tools skip and count games where
`inspectP` reports `n === 0`. Those games need a CAPTURE (spectator or discoverGame sweep), never a
repair. **Outstanding:** games already carrying a repair-written roster with neither `spc` nor `dg`
are countable offline and have not yet been counted (OUTSTANDING §2.15).

### Added 2026-08-13 (the negative gap is mostly PRIVATE PROFILES, not a bug)

26,445 players / 182,199 appearances have MORE games in `games[]` than PlayHQ's profile credits.
Investigated and largely explained: **private profiles return OK with no `seasonStatistics` at all**,
so `gp` is near-zero by construction while the roster appearances are genuine. Probed live on
`0d577cf8-836e-464f-bfd8-6217f0a45eb5` ("Taylor Henderson" [PRIVATE], gp≈35, games=489). The same
shape recurs across the top of the list (gp=1 with 213 games, gp=3 with 219). **The FILL-IN theory
was refuted by its own diagnostic:** canonical-record (`dg`, paper-scored) games are 5.1% of affected
players' games — the same as their share of the whole database, i.e. NOT enriched, where fill-ins
would have concentrated there. `size-negative-gap.yml` cannot currently tell a private profile from a
wrong one and ranks private players as offenders; it should read the `private` flag (already in every
player file) and separate them. **Consequence: do NOT build a fill-in tag** — it would label a
measurement artefact as a feature.

### Added 2026-08-13 (probe mislabels a player present under their OWN id) — ⚠️ HALF WRONG, CORRECTED 2026-08-14

> **The original claim, kept for the record:** "`inspectP` returns `PRESENT-canonical` when the
> player's own 13-char truncation is in `p[]`, and both `probe-player.js` and
> `repair-players-batch.js` report that under the heading 'alias cases (fold problems)'. So a game the
> batch itself appended on a previous pass is counted as an alias/fold case on the next run. This is
> why alias-skips appeared to climb — 1,537 against 4,810 appends at min-gap=25, and 473 for one
> player. The counts are not evidence of fold backlog."

**Half of that is false, and the false half was doing real damage: it explained away a number that
turned out to be real.** Established 2026-08-14 by reading all three files end to end:

- `probe-player.js` DID have the bug. Its bucketing test was `insp.verdict.startsWith('PRESENT')`,
  which swallows `PRESENT-canonical` along with the genuine alias verdicts.
- `repair-players-batch.js` NEVER had it. `if (insp.verdict === 'PRESENT-canonical') continue;` sits
  immediately ABOVE the alias counter, so own-id presence was skipped before it could be counted.
- `repair-player.js` never had it either — it counted own-id presence as `ok`.

**The 1,537 alias-skips at min-gap=25 came from the BATCH, so they are not an artefact of this bug and
must not be explained away as one.** The one thing that number does contain is a small contaminant:
the batch's alias counter also swept up `game-not-in-that-season-file`, which means a season file
would not parse — a fault, not a finding. It now has its own bucket.

**The lesson is the one this file keeps re-learning from the other direction.** T12 says a fix
recorded in a document is not a fix in a file. This is the mirror: **a BUG recorded in a document is
not a bug in a file.** Both are claims about code, and both are cheap to settle by opening the code.
This one was written from a plausible mechanism that fitted the symptom, and it cost a real finding —
the alias population was declared measurement noise for a day when nothing had measured it.

### Added 2026-08-14 (T30, and the verdict rename that makes the bug unrepresentable)

**T30 — GITHUB EVALUATES `${{ }}` ANYWHERE IN A `run:` BLOCK, AND A `#` HIDES NOTHING FROM IT.**
A shell comment is a comment to bash. It is not a comment to GitHub's expression parser, which scans
the whole `run:` string. Writing an empty expression pair inside such a comment — to ILLUSTRATE the
directive-13 point about expression context — rejected the entire workflow file:
`Invalid workflow file … (Line: 88, Col: 14): An expression was expected`. Nothing ran.
**And `yaml.safe_load()` passed the file cleanly**, because it IS valid YAML: the broken expression
lives inside a string. That is T2 restated in a new place — YAML validity proves nothing about
expression validity — and my pre-delivery check missed it because it verified `if:` gates for
multi-line values and never looked at the expressions themselves.
**The check that catches it:** regex every `${{ ... }}` out of the RAW file text, wherever it sits,
and assert each body is non-empty and single-line. Run it over every workflow before delivery, not
just the ones with `if:` gates.
**The rule:** never write a bare, empty expression pair in prose inside a workflow file. Write
"dollar-brace-brace" in words instead. The same applies to any illustrative expression in a comment —
GitHub will try to evaluate it.

**The §2.16 fix is a RENAME, not a branch, and that is the point.** `inspectP`'s own-id verdict is now
`SELF-PRESENT` in all three tools. `PRESENT-canonical` was correct as a description and dangerous as a
string, because the obvious way to bucket the verdicts — `startsWith('PRESENT')` — silently captures
it. A verdict that does not begin with "PRESENT" cannot be caught by that test in the file that had
the bug, or in anything written later. Fixing the one call site would have left the trap loaded.
⚠️ **This makes the inspection block NO LONGER byte-identical to the copy in
`probe-missing-games.js`**, which still uses the old name and was not touched. Deliberate, recorded at
the write site in all three files, and worth aligning next time that script is open — the three copies
of `inspectP` are independent by history, not by design.

**`games[]` membership is the discriminator that turned two numbers into four.** For a credited game
where the player is present in the roster, whether the game is ALSO in their `games[]` separates
finished work from pending work, and it costs one small file read per player:
- own id + in `games[]` = **self**: correct, nothing to do.
- own id + NOT in `games[]` = **lag**: the next `build-player-games` run closes it. No tool needed.
  This is the direct measurement of the "ordinary weekly lag" remainder, which had only ever been
  assumed.
- other id + in `games[]` = **aliasOk**: the alias index already resolved it. Nothing is wrong.
- other id + NOT in `games[]` = **aliasGap**: the alias is unregistered. THIS is fold work, and it is
  the only part of the alias population that costs anything.
Eight buckets in total (add `appended`, `uncap` for an empty roster, `absent`, and `odd` for an
unreadable season file). Split by gap band, because deep gaps are not a random sample of shallow ones
and the ratio has to be SEEN to hold before it is extrapolated downward.

**A TRANSPORT FAILURE IS NOT A DEAD PROFILE — the third strike for this class.** Until now
`repair-players-batch` wrote every non-ok status to `progress.dead` and never retried it, so one
CloudFront block permanently retired a perfectly recoverable player. Identical in shape to
`gqlSpectator` returning a bare `null` for 403/429/5xx/network (fixed 2026-08-11), and to the
`spectator-backfill` miss-retirement before it. Now: `private` / `notfound` / `gql-error` / 4xx are
permanent and recorded; blocks, socket errors, bad JSON and 5xx are retried three times and then left
UNRECORDED for the next dispatch; five consecutive transport failures stop the run cleanly rather than
marching through the queue producing nothing while looking like progress. `--retry-dead` re-admits
anyone retired under the old behaviour. **The general rule, now proven three times: classify the
outcome, and never let a failure to ASK become a recorded ANSWER.**

**The measurement lives in the progress file, not beside it.** The campaign rollup is recomputed from
`reports/repair-batch-progress.json` at every commit window rather than accumulated in memory or
written to a second report file. One durable record means a timeout costs the run's log and never the
measurement, and there is no second file that can disagree with the first (T14). Entries written
before the breakdown existed carry no `v` and are reported SEPARATELY, never blended into the shares —
their `alias` field counted a different population, and mixing two populations into one number is what
made the 1,330,231-surplus-regs figure meaningless (T15). Every bucket prints capped examples beside
its count for the same reason.

**Method note, and it worked.** The classification was proven by EXECUTION before delivery, not by
reading: a synthetic repo with one player and ten credited games covering every case — own id in
`games[]`, own id not in it, alias resolved, alias unresolved, legacy 10-char, empty roster, absent
game, appends into `spc` / `dg` / neither — with only the network call stubbed. All three tools were
run against it and agreed on every bucket. It immediately caught a real defect nobody had reported:
`probe-player` counted EMPTY-roster games as recoverable, so its "a targeted repair would recover ~N"
line promised appends the batch has skipped since 2026-08-13. That is directive 17 doing its job.

### Added 2026-08-18 (the rosters are RIGHT — and four assertions made without reading)

**THE FINDING. `games/bv` is confirmed sound against PlayHQ's own API.** `probe-wrong-rosters`
re-fetched 60 games from spectator that an audit had flagged as "wrong":

| | |
|---|---|
| identical to the live box | 37 of 55 (67.3%) |
| we hold MORE than the live box | 18 (32.7%), 31 ids |
| live holds ids we never captured | **0** |
| differ in both directions | **0** |
| live box empty (paper-scored) | 5 of 60 (8.3%) |
| player absent from a NON-empty live box | 1 of 60 (1.7%) |

Every difference runs one way: our roster is a SUPERSET of what spectator returns. That is the
frozen-partial mechanism recorded on 2026-08-10 (`7da945a8`: 12 stored of a live 19) with the gap
since closed. Zero unclosed partials in 55 games means the sweep has taken everything spectator will
give. The empty boxes are paper-scored games spectator has never held — the reason
`discover-game-backfill` exists. **Nothing in `games/bv` needs stripping, and the campaign's 812,554
appends are corroborated by PlayHQ.**

**WHAT THE 1,251,535 FIGURE ACTUALLY MEASURES — AND IT IS NOT WRONG APPEARANCES.** The consolidation
audit counts appearances where the player holds the game but their REGISTRATION list names neither
team. Since the rosters are right, that is a **registration-coverage** measure, not an attribution
one. It also explains the 26,834 "more games than PlayHQ credits" players in one step: `gp` is
derived from registrations, so a missing registration understates the credited total while the
appearances stay real. One cause, not two mysteries. Every conclusion drawn from that 4.2% before
2026-08-18 needs re-reading in that light.

**Supporting measurements from the same day, all of which stand:**
- Truncated-id collisions: **0** across 421,290 player files, against a birthday expectation of 0.00.
  TRUNC_LEN=13 is sufficient. Ruled out.
- Capture path of the flagged appearances: spc 1,115,014 · dg 31 · no-flag 127. The repair campaign
  writes into games without setting spc or dg, so its appends land in the no-flag bucket — 127 of
  1.1 million. **This week's runs did not write them.**
- Delivering id: 87.0% arrived under the player's OWN 13-char id (no resolution involved), 13.0% via
  an alias across 9,091 distinct mappings. That 13% is one in eight and is a SECOND question, not
  noise — I called it noise and was corrected.

### The process failures of 2026-08-18, recorded because they were all the same failure

Four assertions made confidently, none of them checked first, each costing a round trip:

1. **The game-centre URL, wrong three times.** I put the season id, then the org id, in a slot that
   takes the SEASON SLUG. Each time I "verified" by loading a NEARBY url — the season page, which
   resolves on an id — and treated that as confirmation of the game path. One real URL, clicked
   through by hand, settled in seconds what three rounds of inference did not. **Verifying something
   adjacent to the claim is not verifying the claim.**
2. **"Genuine mis-attribution", from a web page.** Max Thomson was absent from a PlayHQ game page, so
   I reported hard evidence of corruption. The API returns him for that same game. The website and
   the API do not show the same set, and I had no basis for preferring the one I happened to look at.
3. **Two documented mechanisms reported as unexplained anomalies.** An empty live box is a
   paper-scored game — the entire reason there are two endpoints and the reason
   `discover-game-backfill` exists. Stored-larger-than-live is the appearance gap being closed. Both
   are in this file, written weeks ago. I had it open and asserted instead of reading. Mark's
   response was the correct one: *"Why do you think we have been doing this backfill? Why do you
   think there are two different endpoints?"*
4. **A test harness that hid the bug it was written to catch.** `probe-wrong-rosters` shipped missing
   `sleep`, `API_URL` and `SPECTATOR_URL` — all defined ABOVE the block copied out of
   `spectator-backfill.js`. The harness stubbed the whole region including the code that needed them,
   and defined `sleep` itself. **A stub that supplies a missing dependency tests the stub.** Worse,
   `refreshSession` wraps each attempt in `catch (_) {}`, so an undefined `API_URL` threw silently ten
   times and reported "Failed to obtain session after 10 attempts" — an error naming the endpoint when
   the endpoint was fine.

**T31 — WHEN COPYING A BLOCK OUT OF ANOTHER SCRIPT, DIFF ITS DEPENDENCIES, NOT JUST ITS SYNTAX.**
`node --check` passes on a file referencing undefined names. The check that works: list every
identifier defined ABOVE the extraction point in the source file, and assert none of them is
referenced by the copy without being redefined. Run it before delivery. And intercept only the
network layer when testing — never stub the region under test.

**T32 — A COUNT WITHOUT A DIRECTION IS NOT A MEASUREMENT.** "88.8% overlap" hid three distinct
populations: empty boxes, supersets, and one genuine outlier. Averaging them produced a number that
supported whatever story was being told. The fix was to report the SET DIFFERENCE per game and sort
each into a named shape. Mark's objection — *"your standards are woefully low, this should be 100%
across the board"* — was right, and the answer was not a better average but a breakdown.

**Standing rule, restated because it was broken four times in one day: this file and
`OUTSTANDING_TASKS.md` are the first place to look, not the last.** Every mechanism in items 1-3
above was already written down. Reading costs a minute; asserting cost a day and Mark's confidence in
the data.

### Added 2026-08-18, later — ⚠️ SUPERSEDED 2026-09-05, READ THE CORRECTION BELOW FIRST

**The 1,115,172 figure this section is built on was a BUG, not a finding.** See
"2026-09-05 — the `u` field was measuring a wrong field name" further down. The conclusion
"nothing to fix, stop treating the 4.2% as a fault" was drawn from a number that was 96.5%
artefact. The rest of the section — the `publicProfileTeams` query faults, T33, the NOT_FOUND
population — still stands.

### Added 2026-08-18, later (the registration question is CLOSED — there is nothing to fetch)

**`publicProfileTeams` returns NOTHING for the teams in question. 0 of 1,114, across 75 players.**
It returns FEWER registrations than we already store (4.1 per player against our 5.2) and adds
**zero** we lack. PlayHQ has no registration for these teams either.

So the 1,115,172 appearances-without-a-registration are not a fetching gap and never were. They are
**fill-ins and unregistered appearances**: the player physically played, the box score names them
(verified — `probe-wrong-rosters`, 55 games, spectator still returns them), and no registration
exists on PlayHQ's side to be fetched. **Nothing to fix. Stop treating the 4.2% as a fault.**

That also settles the 26,834 "more games than PlayHQ credits" players for good. `gp` derives from
registrations; a fill-in appearance is a real game with no registration behind it, so the appearance
count exceeds the credited total BY DESIGN. Four candidate causes were tested and eliminated over
two days — fill-in games as a category (dg at 5.2% against a 5.7% baseline), split identities (393
probed, 73.3% exact), uncountable game types (6.37 per 100 games against a control of 7.71, i.e.
LOWER), and mis-attribution (rosters verified against PlayHQ's own API) — and the answer turned out
to be the first one in a form none of those tests could see: not fill-in GAMES, fill-in APPEARANCES.

**A real finding in the other direction, currently unexplained and worth its own look.** For a large
minority, `publicProfileTeams` returns FEWER registrations than we hold, sometimes zero:
Thorn McIntosh (1 stored, 0 returned), James Arturi (5, 0), Joe Jovic (3, 0), Matilda Coles (8, 0),
Nikolas Roumeliotis (3, 0). And **25 of 100 returned `5 NOT_FOUND: failed to find profile` outright**
— the same status the repair campaign recorded for 637 dead profiles. Either those profiles have been
deleted since we fetched them, or a population of ids is failing to resolve on this endpoint. Not
investigated. Do NOT treat our stored registrations as suspect on this basis without measuring it
first.

**The query itself took FOUR dispatches to get right, and every fault was in this repo's own docs:**
- `publicProfileTeams` at line 539 of `playhq_api_reference.md` is **WRONG**: it shows a `teams { }`
  wrapper. `DiscoverTeam` is a union member and needs `... on DiscoverTeam { ... }` — as SEVEN other
  sites in the same file already show (lines 214, 271, 321, 343, 432, 441), and as the live
  `PROFILE_QUERY` in `repair-players-batch.js` already does. **That block should be corrected.**
- `ID!` was right throughout. My "maybe it needs `String!` like discoverSeason" guess added a SECOND
  error on top of the first and cost another dispatch.
- A CloudFront hard-block is a 403 with an HTML body, DISTINCT from an application 403
  (`fetch-profile-stats.js` L458). The first version returned `private` for both, which would have
  recorded a throttle as a fact about the player.
- `publicProfileTeams` expects an **api-namespace** id, so `player.apiId || uuid` is required
  (`fetch-profile-stats.js` L839). Feeding it the wrong namespace returns 200 with null data —
  indistinguishable from "no registrations".
- Line 643 caveat: **grade is NULL for COMPLETED seasons.** Any query relying on it silently loses
  historical data.

**T33 — READ THE WHOLE SECTION AND GREP THE TYPE NAME BEFORE WRITING AN API CALL.** Four dispatches
were spent patching whatever the last error named, each time treating the rest of the call as already
verified when none of it had been. The rule is not "fix the reported fault" — it is: read the
reference section end to end, grep the reference for every TYPE the query touches to find working
examples, check the caveats table for the field, and check how the live scripts handle 403 and
namespace for that endpoint. Five minutes, once, before the first dispatch.

**WHERE THE DATA STANDS AFTER TWO DAYS OF AUDITS.** Verified sound: the rosters in `games/bv`
(against PlayHQ's own API), identity resolution (0 truncation collisions in 421,290 files, 0
unresolved p[] ids across 29.5M appearances), and the repair campaign's 812,554 appends (127 of
1.1M flagged appearances came through the no-flag path it writes to). Confirmed as PlayHQ semantics
rather than faults: the 1.1M unregistered appearances and the 26,834 over-counted players. The real
remaining work is unchanged from where it started: **133,459 missing appearances**, overwhelmingly
`game-absent` and `uncaptured` — discovery and capture, which `discover-game-backfill` and the
weekly sweep address.

### Added 2026-08-19 (a grading grade has no ladder — and seven seasons were invisible because of it)

**THE FAULT.** `discover-fixtures.js` resolves a season's teams from `discoverGrade.ladder`. A
**GRADING** grade returns `ladder: []` — HTTP 200, no GraphQL error — because grading rounds are the
pre-season sorting phase and are not a competition. So a season whose stored grade list is ALL grading
grades enumerates **zero teams**, fetches **no fixtures**, and logs `Teams: 0 — no ladder data` every
week, indefinitely, while looking green.

EDJBA Winter 2026 (`1ae60211`) was in that state: 55 stored grades, every one `* Grading`, against
**263** live competition grades that have never been in the index. The ladder for
`cce1a7da "Boys U13 AR"` is visibly on playhq.com with 13 rounds played.

**THE FIX, MEASURED BEFORE IT WAS WRITTEN.** `discoverTeams(filter:{seasonID})` returns a season's
teams without touching a ladder. It came from the junior-footy-dashboard import and was recorded
UNTESTED on this tenant, so it was tested first:

| season | teams | grades | orgs |
|---|---|---|---|
| `1ae60211` EDJBA | 2,093 | 263 | 22 |
| `aacc7335` Camberwell | 672 | 82 | 14 |
| `7ccb2e98` Altona (control) | 385 | 51 | 20 |

`discover-fixtures.js` now runs BOTH routes and **unions** them. Three things that would have been
wrong to assume:
- **`ID!` is the variable type here** — the OPPOSITE of `discoverSeason` on the same tenant, which
  needs `String!`. Both were tried; the working one is recorded rather than guessed.
- **It is NOT a strict superset of the ladder route.** Camberwell returned 13 of the 16 grades our
  held games use. Replacing the old path would have lost three grades. It is additive, and
  `--no-season-teams` restores the old behaviour if it ever needs isolating.
- **`grade` can be NULL on a returned team** (EDJBA's first team: `z101`, U7, no grade). Anything
  reading `team.grade.id` must tolerate it.

**THE RESULT. EDJBA went from 4,928 games to 11,505 — 6,577 new games from ONE season**, confirmed by
the total moving 2,350,942 → 2,357,519, exactly +6,577. The first ~420 teams returned nothing; those
are `z`-prefixed placeholder teams with no fixtures. Six more seasons were swept the same way:
`aacc7335`, `1c70d59d`, `83a38877`, `98dc2b10`, `e0f9dedc`, `9358e51a` (locked — needs the archive
redeploy).

**WHY THE INDEX GOES STALE, AND WHY IT NO LONGER MATTERS MUCH.** `discover-seasons.js` writes `grades`
once at season creation (L526) and its refresh only re-reads seasons sitting at `grades: []` (L542).
A season captured during its grading phase therefore keeps grading grades forever. That is still true
and still unfixed — but it now costs only metadata accuracy, because the sweep no longer depends on
the grade list.

### The measurement I got badly wrong on 2026-08-19, and the correction

The first version of the `grades` section counted seasons whose stored grade list is missing grade ids
that our OWN HELD GAMES reference, and reported **36% of seasons "provably stale", 18,642 grade ids
missing, 562,956 games affected**. Both numbers were correct. The conclusion was worthless.

**Those games are on disk.** They arrived because `discover-fixtures` resolves teams from a ladder and
then calls `discoverTeamFixture` PER TEAM, which returns that team's ENTIRE fixture regardless of
grade. One team found in one indexed grade brings back every game it played, including games in grades
the index never knew about. A short grade list is a bookkeeping inaccuracy, not data loss — and the
very output that showed the staleness also showed the games present, in the same table, which I did
not check before calling it a crisis.

Mark's response was the correct one: *"I don't believe that there is a 1/3 issue — please actually
read all previous chats and project docs before you go making another mountain out of a molehill."*

Rewritten to ask the question that matters — **can a season's teams be ENUMERATED at all?** — the real
answer is:
- **2,867** seasons where at least one indexed grade is in use: the route works.
- **1,131** of those where the index covers only some grades: explicitly labelled harmless.
- **0** seasons where NO indexed grade is in use.
- **7** seasons whose indexed grades are all grading grades. That is the entire fault.

**T34 — A COUNT OF WHAT IS MISSING FROM AN INDEX IS NOT A COUNT OF WHAT IS MISSING FROM THE DATA.**
Before reporting a bookkeeping discrepancy as data loss, check whether the data it supposedly explains
is present. It usually is, and the same scan almost always already knows. The corrected framing asks
what a fault would COST, not how large it is.

**Also fixed 2026-08-19: the report script no longer lives in the workflow.** It was a heredoc inside
`size-report.yml`, so Actions echoed all ~1,000 lines into the run log before executing anything,
every dispatch, ahead of any output worth reading. It is now `scripts/size-report.js` — `.js` and not
`.cjs` because there is no `package.json` setting `type: module`, and `scripts/` and not `scripts/lib`
because that directory is reserved for the two libraries. `size-appearance-gaps.js` is the precedent.

### Added 2026-08-20 (the chain proven end to end — and every writer could hang silently)

**THE RESULT. The appearance gap more than halved: 133,459 → 76,082, across 36,975 players rather
than 51,846.** Roster-less games fell 39,061 → 17,067. Total appearances 29,498,698 → 29,873,273.
`Unresolved p[] ids: 0` again on 29.9M appearances.

That is the whole chain proven end to end for the first time: `discoverTeams` finds the teams →
`discover-fixtures` writes the games → `spectator-backfill` captures the rosters →
`build-player-games` turns them into appearances → the gap closes. Each step was verified by its own
output rather than assumed.

The seven-season sweep in numbers: 6,632 games queued, **6,545 captured, ZERO real misses**. The 87
"transport failures" were 86 × `game could not be found or was not electronically scored` — paper-
scored games, which is precisely what the chained `discover-game-backfill` exists for, and they stay
queued. Only **115 new player stubs** across 6,545 games: the associations' players were already
known, which is a good independent signal for identity consistency.

**`spectator-backfill` now takes a COMMA-SEPARATED season list.** Seven dispatches meant seven
checkouts of a 6 GB repo — ~50 minutes of clone before any work. One dispatch, one checkout. It also
names any id with no `games/bv` file, because a typo in a list of seven is otherwise invisible: the
run sweeps six and reports success.

**And `min_age_days` matters more than it looks.** The 30 default is right for the weekly tail but
SKIPS A CURRENT SEASON almost entirely — six of the seven were in progress. 7 was used: it clears
settled rounds while leaving this week's boxes alone, because `spc` FREEZES a box permanently and 0
risks freezing one still being entered.

### T35 — EVERY execSync/execFileSync NEEDS A TIMEOUT, AND THE AUDIT MUST PARSE, NOT GREP

`build-player-games` hung on 2026-08-20 after printing `staging: 1353 files changed` and produced
nothing further. That line sits between `git diff --staged` and `git commit`, so it was stuck inside a
git command — and NOT in the retry loop, which would have printed `push attempt N failed`.

**execSync is SYNCHRONOUS: it blocks the whole Node process, event loop included, so nothing can time
it out from outside.** `git fetch` and `git push` talk to the network against a 6 GB repo. Without a
timeout a stalled connection hangs the job until the workflow ceiling kills it, silently. This is the
THIRD script found with it — `repair-players-batch` on 08-14, `build-player-games` on 08-20 — so an
audit of every writer followed.

**The audit had to PARSE each call's options object, not grep for one spelling of it.** A first pass
grepping `stdio: 'pipe' }` reported `discover-game-backfill` and `spectator-backfill` as clean; they
had 7 untimed calls each under a different options shape. Walking the parentheses and reading the
actual argument list — resolving shared constants like `GIT_OPTS` — found 31 untimed calls across six
writers. All now carry a 10-minute timeout and a 512 MB `maxBuffer`, with backoff `sleep` calls capped
separately since they are not git.

Each fixed writer also prints `… fetch/merge/push (attempt N)` before the network step, so a future
hang names itself instead of leaving a bare `staging:` as the last line.

### `discover-seasons.js` had four faults the rest of the repo already guards against

The timeout was the least of it. Found in the same audit, in a SCHEDULED writer:

1. **Combined `git add a b c`.** `git add` is ATOMIC across pathspecs — one unmatched path exits 128
   and stages NOTHING, including the valid paths beside it. That is the 2026-07-19 failure exactly:
   30,426 games fetched across 25,448 teams in 28 minutes, zero committed, job green.
2. **No push retry at all.** One contended push lost the run's work, on a repo with many writers on
   one branch where every other writer retries with jitter.
3. **Commit AFTER merge.** Merging over uncommitted changes fails outright when concurrent pushes
   touch the same files.
4. **`catch` printed and returned.** A lost push left the job GREEN with the work discarded.

Rewritten to the house pattern: per-path add with a benign-absent exemption, staged shortstat, commit
before merge, 60-attempt retry with pure jitter, and it THROWS when exhausted. **Expect a new RED
where there was green** if it has been quietly losing pushes — that is the fix working, not a
regression.

### WHERE THE REMAINING GAP ACTUALLY SITS (2026-08-20)

**Positive gap — 76,082 appearances across 36,975 players.** The shape is the finding:
- **26,211 players are short by exactly ONE**, and 9,108 by 2–5. Together 95% of the affected.
- Only **239** are short by more than 20.
- The worst are a distinct and much smaller population: `gp=389 games=1`, `gp=370 games=1`,
  `gp=270 games=1` — players credited with hundreds of games where we hold ONE. That is not a capture
  gap, it is a player whose appearances sit under an identity we have not connected. ~20 such
  players, not thousands.

**Negative gap — 82,424 across 39,834 non-private players**, plus 3,140 private with 127,675
(expected and explained). This ROSE with the new games, which is correct: it is the fill-in and
unregistered-appearance population established on 2026-08-18, and more games means more of them.
`dg 4.9%` against a `5.7%` baseline — still no signal, fill-in theory still unsupported as a
*category* explanation.

**So the remaining work is three separate things, and only one is large:**
1. **Off-by-one, ~35,000 players.** Cause unknown after eliminating fill-in games, split identities,
   uncountable game types and mis-attribution. The scale says systematic; the size says low-value.
2. **~20 players with hundreds of credited games and one held.** Small, specific, and the only group
   where a fix would visibly change a player's page.
3. **17,067 roster-less games**, which the weekly sweep and the chained canonical-record pass drain
   on their own.

### T36 — ABSENCE FROM A LOOKUP TABLE IS NOT EVIDENCE OF CANONICAL STATUS

`spectator-backfill` decided whether to create a player file by calling `resolveToFullUuid()`. That
function looks an id up in `players/aliases` and returns it unchanged when absent. The code read
"unchanged" as "this IS an api-canonical id" and stubbed a player file. Absent from the alias table
means only NOT ALIASED — nothing about what the id is. Since the alias builders were retired, only
`fetch-profile-stats` writes new aliases, so discovery always outruns aliasing and any spectator id
seen first became a phantom player. 2,482 of them. The gate is now an explicit `isApiProfile(uuid)`
call, with `unknown` (transport failure) deferring rather than guessing in either direction.

### T37 — ROSTER IDS ARE STORED IN TWO LENGTHS AND EVERY COMPARISON MUST HANDLE BOTH

`p[]` holds the 13-char truncation `e9dee630-ab52` AND the full 36-char uuid, and BOTH FORMS APPEAR IN
THE SAME ROSTER. Measured 2026-08-24: 29,755,869 truncated (99.24%), 228,861 full (0.76%), across
64,491 games holding both. `build-player-games` copes because it calls `resolveToFullUuid`. FIVE
diagnostics did not — each built its own set from `uuid.slice(0, 13)` and compared literally.

The damage was not a mis-count. `trace-player-game` reported "NOTHING IN THIS ROSTER" for all 19 of
Bailey Walton's games while printing his FULL uuid in every roster listing on the same screen, and
`probe-shared-roster` had already produced the "6 games, only A present" result that made him look like
a split identity. He never was one.

Use `playerIdSet(uuid, player, aliasTo)` and `rosterIdMatches(rosterId, idSet)` from
`lib/namespace-resolve.cjs`. Never write a fresh comparison. A separate scan confirmed the data itself
is clean: ZERO rosters list the same person under both forms, so the mixture double-counts nobody.

### T38 — A TEST BUILT ON OUR OWN OUTPUT IS NOT EVIDENCE

`probe-both-resolve` concluded "two people" when BOTH uuids appeared in one team sheet. But an id can
be in that team sheet BECAUSE AN ALIAS PUT IT THERE, and the aliases are our own output. Where one side
of a pair is present only via an alias, the verdict is circular: if the alias is wrong, so is the
verdict. `probe-verdict-conflict.js` splits every shared appearance by whether each side appears under
its OWN id or only through an alias, and reports the pairs whose verdict does not survive that test.
Before trusting any identity conclusion, ask which parts of the evidence WE generated.

### T39 — THE SESSION EXPIRES MID-RUN AND MUST BE REFRESHED ON A CYCLE

`probe-alias-credits` got 503 profiles in, then every call failed — 8 of 8, then 4 of 4, down to 1 of 1
— and the backoff read that as the endpoint refusing us. It was not. The session had gone stale, and
the script only refreshed when `sessionCookie` was falsy, which happens exactly once at startup.
`fetch-profile-stats` logs `↺ Session refresh before batch 2` because it re-obtains the session EVERY
batch; `spectator-backfill` does the same on a cycle. Refresh on a fixed call count AND immediately
when a whole chunk fails, because a whole chunk failing is the signature of a dead session.

Two related traps in the same backoff: recovery keyed on "a chunk with ZERO failures" can never fire at
concurrency 1, where any failure is 100%; and a hard stop guarded by `chunk.length > 1` is exempt at
concurrency 1, so a collapsed run burns the whole job ceiling doing nothing while LOOKING busy.

### T40 — A NAME TEST CANNOT SETTLE A CASE CAUSED BY A NAME COLLISION

The whole alias table was built by matching names. Auditing it by comparing names therefore proves
nothing where several players share one — that is precisely the case the matcher got wrong. 739 of 746
unresolved aliases came back "name agrees"; splitting by how many players carry that name showed 652
settled (only ONE player has it) and 87 still open. Any "same name" verdict must be split that way or
it is self-confirming. And note the 5 that came back DIFFERENT were all folding artefacts — Zac vs
Zachary, hyphen vs space — not errors: normName folds hyphen CHARACTERS but not hyphen-versus-space,
and cannot do anything about short forms.

### T41 — ID SHAPE IS NOT IDENTITY. THE TWO NAMESPACES DO NOT DIFFER BY LENGTH

On 2026-08-24 the box score for 40 unresolved aliases returned a profileID in full 36-character
form whose first 13 characters were the alias id. I concluded these were api profiles being
redirected away from themselves, that the alias should be DELETED, and built a tool to seed the
missing player files so deletion would be safe.

**Wrong.** `publicProfile` on the account tenant returns NOT_FOUND for all 40. They are
SPECTATOR ids that happen to be stored full-length in the box score. A spectator id is not
shorter than an api id — the 13-char form is OUR truncation, not PlayHQ's namespace marker.
The alias was doing exactly its job.

The error was reading a SHAPE as an ANSWER: "the ids match, so it is the same thing", without
making the one call that tests whether that id is a profile at all. The same shape as reading
`Men` vs `Boys` as a gender conflict, and as reading two ids in a roster as two people.

**Before concluding that two ids are the same thing, ask what each one IS.** For PlayHQ that is
one `publicProfile` call, and it is cheap.

`seed-missing-profiles.js` is retained: its guard refused to seed anything without an obtainable
name, so the bad premise produced no writes. A tool that refuses on missing evidence survives a
wrong theory; one that assumes would have written 40 fabricated player files.

### T42 — A SIGNAL THAT IS IDENTICAL FOR BOTH CANDIDATES IS NOISE, NOT EVIDENCE

`probe-squad-evidence` scored candidates partly on how many teammates they shared with the squad
in question. Two PlayHQ profiles belonging to the same human, on the same team, share THE SAME
SQUAD — so that number came back identical for both, by construction: Sage Horn 59/59, Yashvi
Shah 39/39, Bailey Sheen 66/66. Weighted into the score it added a large equal amount to both
sides and buried the field that DOES separate them. 17 cases were reported "too close to call"
that were not close at all.

Removing it from the score — keeping it on screen as context — took those 17 down to 5.

**Before weighting a signal, ask whether it can differ between the candidates at all.** If two
same-named profiles must score the same on it, it cannot decide anything and it will drown what
can.

### T43 — REGISTRATION IS THE STRONGEST OFFLINE STATEMENT ABOUT WHO PLAYED

Of everything held offline, a registration is the club entering that player in that competition.
It outranks a game count, which is derived from rosters WE assembled, and it outranks career size
entirely — a 397-game profile with no registration that season is less likely than a 15-game one
with a registration.

Consequence for verification: **the credit test cannot judge a repoint that came from
`probe-squad-evidence`.** Those aliases reached that tool BECAUSE no candidate credits their
games. Re-asking the same question in `repoint-aliases` would reject every one for the reason
they exist, while looking like careful verification. They are re-checked on registration in the
live player files instead, and each repoint prints which check verified it.

## Files in this Claude project

**12 files** (this table listed 5 until 2026-07-29, omitting the two most load-bearing docs).
`CLAUDE_CODE_PROMPT.md` is gone from the project as of 2026-07-31 — the count is settled.
`CLAUDE_CODE_PROMPT.md` is **RETIRED — decision 2026-07-29; removed from the Claude project 2026-07-31. Whether `git rm` ran in the REPO is unverified (T12: a decision recorded is not a decision executed) — check the repo, not this file** — Claude Code is no longer used, and a third
briefing document duplicating this file and `REPO_MANIFEST.md` was a standing drift risk (it had
come to mandate `git stash`, which §7.1 forbids). Brief any coding agent from `REPO_MANIFEST.md`
+ this file directly.

| filename | repo path | notes |
|---|---|---|
| `claude_context.md` | Claude project only | not committed — this file |
| `REPO_MANIFEST.md` | repo root | **authoritative** on scripts/workflows/data shapes; §6 = session history, §7 = conventions |
| `OUTSTANDING_TASKS.md` | repo root | **the live checklist** — §A verification, §B open decisions, §C work items |
| `playhq_api_reference.md` | repo root | **CORRECTED 2026-07-29.** ⚠️ Its own note here previously claimed it was "updated 2026-07-17 — added `publicProfile` (account tenant, id→name); corrected the `seasonStatistics[0].name`-is-a-name claim". **That was false** — the same false claim sat in REPO_MANIFEST §6.6. Neither edit had been made; `account` appeared zero times and the season-name bug was documented as CORRECT in three places. Both were actually written on 2026-07-29 from the deployed `fetch-profile-stats.js`. |
| `README.md` | repo root | **CORRECTED 2026-07-29** (was 2026-07-09 and pre-migration: it told readers not to code against the live shape, omitted the identity layer, and held the retracted `needs-matrix-shards.json` "dead file" claim) |
| `stattrack_html_design.md` | repo root | **banner corrected 2026-07-29** (had "api-canonical NOT yet live" over sections already rewritten for it). Body is still the Beta 0.18 / June-2026 snapshot — treat as design intent, not current state |
| `index.html` | `markjovic/fixture-generator` | **the Fixture Card Generator**, NOT StatTrack — StatTrack's `index.html` lives in `markjovic/stattrack` and is uploaded separately when needed |
| `config.json` | `markjovic/junior-footy-dashboard` | dashboard competition config |
| `colours.json` | `markjovic/junior-footy-dashboard` | club colour map |
| `fixture_card_README.md` | `markjovic/fixture-generator` | see version-drift warning below |
| `dashboard_README.md` | `markjovic/junior-footy-dashboard` | see version-drift warning below |
| `pull_player_data.ps1` | local utility | PowerShell player-data pull |

**⚠️ VERSION DRIFT — settle before editing either app (flagged 2026-07-29, UNRESOLVED).** The project
copies and this file disagree by ~20 versions, and nobody has established which side is current:

| Source | Fixture Card Generator | Local Footy Dashboard |
|---|---|---|
| `fixture_card_README.md` L1 + project `index.html` badge L403 | Beta 0.132 | — |
| `dashboard_README.md` L1 | — | Beta 0.92 |
| this file (above) | Beta 0.154 | Beta 0.115 |

Delivering against the 0.132/0.92 copies when 0.154/0.115 are live would silently revert ~20
versions of work. **Check the deployed `index.html` badge in each repo before touching either.**

---

## Shared conventions (NON-NEGOTIABLE)

- **Filename comment** on line 1/2 of every delivered file. JS `// scripts/x.js`; YAML `# .github/workflows/x.yml`.
- **Scripts in `scripts/`**, `const ROOT = path.join(__dirname, '..')`.
- **Every script ships with its matching workflow.**
- **`git add [specific path]`, NEVER `-A`.** Repo is multi-GB with 370k+ files — `-A` risks ENOBUFS. Found and fixed live violations of this exact rule in `discover-seasons.js` and `build-leaderboards.js` on 2026-07-09 (both had a `dirs`/`extraPaths` parameter that was silently ignored in favor of blanket `-A`) — check for this pattern specifically whenever touching a `gitCommit`-style function.
- **Version increment** on every HTML delivery (0.9 → 0.10, never 1.0).
- **`present_files` after every delivery.**
- **No unsolicited refactoring.**
- **Read before touching.** Never fabricate fields/structure. **Never infer a rule from N=1** — sample across competitions before concluding.
- **Verify deployment.** Deployed copies repeatedly lagged the latest version. `node --check` proves parse only, NOT that a branch fires, NOT that a workflow behaves as intended once run on GitHub's infrastructure.
- **`node --check`** after every JS change; for workflow YAML, `yaml.safe_load()` proves syntax only — same caveat as above.
- **Never guess file contents; never re-ask for a file already provided this session.**
- **Python `str.replace` for edits**, `assert s.count(old)==1` first.
- **Never `new Date()` for date parsing** — split `YYYY-MM-DD`.
- **Git:** `git add [specific path]` → single-line `git commit` **FIRST** → `git fetch origin main` → `git merge -X ours FETCH_HEAD --no-edit --no-stat` → `git push`. **COMMIT BEFORE MERGE** — merging over uncommitted changes fails outright when concurrent pushes touch the same files (build-win-loss lost a full run's 78k updates to this, 2026-07-16). `git diff --shortstat` (never `--stat`). Never rebase, never stash/pop.
- **Push retry pattern (proven):** 60 attempts, pure random 1-91s jitter (not linear/exponential), `git merge --abort` cleanup before each attempt, THROW on total failure (a red job beats silently discarded work). Copy from `fold-diverged-players.js` / `build-win-loss.js`.
- **Event-driven over periodic.** Maintenance reacting to a pipeline stage (e.g. the fold) chains off that stage's completion trigger — never a cron that leaves a staleness window. An idempotent event-driven sweep needs no cron "safety net"; the cron only masks trigger failures (fold cron removed 2026-07-16).
- **Player files are stored MINIFIED** — `JSON.stringify(player)` with NO indentation, exactly as `fetch-profile-stats.js` `writePlayer()` (line ~560) does. Do NOT reformat to `null, 2`; pretty-printing is the deviation. Pretty-printed files in the repo are legacy (older writer / stub-creation path) and get minified whenever the pipeline next touches them. Enrich-style diffs showing huge `-`/`+` line counts are usually just a pretty→minified flip, NOT data loss — confirm by parsing, never by eyeballing the diff.
- **Sharded writers do NO git per shard.** House pattern: shards write files (or emit artifacts), a single aggregator job packages and does ONE commit/push (`fetch-profile-stats.js` line ~943). Do NOT add per-shard commit/push loops — they cause push races and `MERGE_HEAD` wedges. "Compile and commit in the final step."
- **Whole-repo reads:** never `sparse-checkout` for a job that must read many player files — it makes a blobless clone that fetches each file over the network (~1s each, unusable at 400k). Use a plain checkout (files land on local disk). The runner cannot hold two full ~8.6 GB trees, so exhaustive baseline byte-diffs of all player files are not feasible — validity-scan the current files instead.
- **ESM (VERIFIED 2026-07-29 by reading all four files):** `build-finals-stats.js`, `build-leaderboards.js`, `build-player-games.js`, `build-records.js` — all four use `import`. Evidence, first import line of each: `build-player-games.js` **L24** `import fs   from 'fs';`; `build-records.js` **L27** `import fs from 'fs';`; `build-finals-stats.js` **L41** `import fs from 'fs';`; `build-leaderboards.js` (ESM, long-established). Counter-evidence for CJS: `build-win-loss.js` **L29** and `build-team-stats.js` **L28** both `const fs = require('fs')`. All others CommonJS (`build-win-loss.js`, `build-team-stats.js`, `fetch-profile-stats.js`, … confirmed by reading). **This line previously said "finals + leaderboards ONLY" and was WRONG**; REPO_MANIFEST §2.1/§7.3 was right all along. `CLAUDE_CODE_PROMPT.md` rule 20 carried the same error (that file is being retired — see the file table).
- **PlayHQ API — never write a query, header set or result traversal from scratch. Copy it. But
  copy from something that is CONTINUOUSLY PROVEN, in this order:**
  1. **The live script that makes the same class of call**, because it runs against the real API on a
     schedule and a wrong query shows up as a failed run. Profile/stats → `fetch-profile-stats.js`.
     Games/spectator/box scores → `nightly-crawl.js` or the Cloudflare Worker. Fixtures/rounds →
     `discover-fixtures.js`. Seasons/grades → `discover-seasons.js`.
  2. **`playhq_api_reference.md` as a CROSS-CHECK, never on its own.** It is documentation and it
     drifts: on 2026-07-29 it was teaching the season-label-as-player-name bug at THREE separate
     sites, and its `publicProfile` section was missing entirely while two other docs claimed it
     existed. If the doc and a live script disagree, the live script wins and the doc gets fixed.
  3. **NEVER `fetch-playhq.js`.** It is PERMANENTLY RETIRED with known double-counting bugs
     (README §4), it sits outside the pipeline, it is never run, and nothing validates it. Copying
     from it propagates a dead script's errors into live code with no signal. It is retained as a
     historical artifact ONLY.
     ⚠️ Corrected 2026-07-31: a prior session's memory described `fetch-playhq.js` as the source for
     correct query and header shapes. That was WRONG and no doc ever said it — README has called it
     retired-and-buggy the whole time. Do not reinstate it from memory.
  **The principle underneath: authority comes from being exercised, not from being on disk.** A file
  nothing runs cannot be known to be right.
- **Documentation first** before asking about internals — but documentation describes intent; the real file is authoritative when they conflict (see behavioral directives above).
- **Never re-stub/re-queue** IDs in `data/seasons-invalid.json`, `data/seasons-skipped.json`, or any `removed:true` season.
- **No UI-side data masking.** Fix the data.
- **No incremental patching of broken logic** — read full function, rewrite cleanly.
- **Do not clear `statsChecked` unless intentional.**
- **Protect existing data from empty API responses** (see below).
- **`data/` prefix** for all root JSON.

---

## GitHub Actions matrix pattern (hard-won 2026-07-09 — read before building or debugging any self-triggering matrix)

Two matrices exist: `fetch-profile-stats-matrix.yml` (player stats, was already working) and `discover-seasons-matrix.yml` (season discovery + roster backfill, fixed today). Both should now follow this exact shape — deviating from it is what caused the entire day's debugging saga.

**The proven-working shape:**
- `generate-shards` is a **true root job — zero `needs:`, no `if:`**. Any pre-work that must happen first (e.g. resetting a progress file) goes in as an earlier **step inside this same job**, gated with a step-level `if:`, never as a separate job this one depends on. An extra dependency hop here was the actual root cause of today's failure.
- `generate-shards` emits **bare shard strings only** — `["00","01",...,"ff"]` — never objects with embedded cursor/state data. Anything per-shard-variable (like a resume cursor) is read by each shard job itself from a committed state file, not passed through the matrix output.
- The output write pattern: Python `print()`s ONLY the JSON array to stdout (diagnostics go to stderr), bash captures it into a variable, **bash** does `echo "key=$value" >> $GITHUB_OUTPUT`. Do not have Python open and write `$GITHUB_OUTPUT` directly.
- The `map`/`fetch` job that consumes the matrix has **no custom `if:` gating the output value** (no `!= '[]'`, no `fromJson(...)[0] != null`). It relies on GitHub's default success-gating from `needs:` alone, exactly like `fromJson(needs.generate-shards.outputs.X)` in its `matrix:` block. Adding a redundant job-level `if:` checking the same output value was the second real bug found today — remove it if present, don't add it "for safety."
- Add `timeout-minutes: 10` (or similar, tuned to expected per-shard runtime) on any matrix job whose shards normally finish in 1-2 minutes — this catches a hung shard fast instead of waiting for GitHub's 6-hour hard cap (happened once on shard `60`, 2026-07-09). Downstream reduce/retrigger logic already tolerates a missing shard artifact the same way it tolerates a wall-hit shard, so no other changes are needed for this to be safe.
- `discover-seasons.js`'s SHARD/MAP role now self-resolves its cursor from `data/discover-progress.json` when `--cursor` isn't passed explicitly (matching the mode key exactly) — this is what lets the matrix output stay bare strings.
- **Self-triggering matrix STOP-BUTTON:** the retrigger job (and any apply-and-commit job) must gate on **`if: ${{ !cancelled() && ... }}`, NOT `if: always()`**. `always()` fires even when the run is cancelled, so cancelling does NOT stop the loop (you'd have to Actions → Disable workflow). The live `fetch-profile-stats-matrix.yml` is the reference self-triggering matrix (generate-shards → matrix → apply-and-commit → retrigger with run cap; terminal `stuck` fires the rebuilds + fold). (apply-and-commit now uses explicit `git add players/ scripts/`, fixed & deployed 2026-07-16; its `apply-and-commit` + `summary-and-retrigger` gates flipped `always()` → `!cancelled()` 2026-07-21 — cancel now actually stops the chain; step-level `always()` on shard artifact upload correctly kept; terminal now also fires `build-team-stats.yml` for the roster-lag fix; the 6 build workflows had their forbidden `git pull` safety-net steps removed; add-player.yml no longer uses git stash.)
- **apply-and-commit must NOT be gated on `needs.<shard>.result == 'success'`** (2026-07-13): one failing bucket then skips the commit for ALL buckets. Gate it on `if: ${{ !cancelled() }}` and let a `git diff --cached` check no-op when there's nothing staged. The retrigger's printed "Remaining …" count is the true progress signal — NOT job colours (the commit job now runs even if some buckets failed; a CloudFront block alone exits 0).
- **`gh workflow run` in a retrigger needs `permissions: actions: write`** — otherwise it 403s ("Resource not accessible by integration").
- **Sticky `max_per_bucket`:** a capped test dispatch propagates the cap to every retrigger, so it stays capped forever. For a real uncapped loop, dispatch uncapped from the start; if you tested capped, cancel the queued retrigger and re-dispatch uncapped.

If a self-triggering matrix misbehaves again: diff its ENTIRE job graph against this shape and against whichever sibling matrix is currently working, before writing a single new theory.

---

## PlayHQ WAF — sustained-throughput limit

Rate-based CloudFront WAF on `api.playhq.com/graphql`; hard-blocks with HTTP 403 + HTML "Request blocked" body (distinct from application 403). NOT GraphQL 429.

- **Per-shard / per-IP, NOT shared-IP aggregate** — parallel matrix jobs do NOT collectively trip it. Don't lower `max-parallel` to "help".
- **discoverGrade/discoverFixtureByRound:** ~1,256–1,790 req per ~80s window at conc≈25; recovery flat ~80s, no escalation.
- **ProfileSeasonStatistics: far stricter** — ~one 50-call batch per window. Matrix trips after ~50 calls/shard → self-trigger-per-batch is correct.
- **publicProfileTeams: friendlier** — 200 probes = `blocked:0`.
- **Rule:** type every call (`ok`/`empty`/`blocked`/`transient`), never collapse a failure into "no data". Canonical: `fetch-profile-stats.js`, `nightly-crawl.js` (`gqlMain` → `{kind,data}`).
- **FINGERPRINT block (distinct from the rate-based limit above, RESOLVED 2026-07-20):** `actions/setup-node`
  in a JOB that fetches api.playhq.com changes the runner's outbound fingerprint → `403 CLOUDFRONT-BLOCK` on
  EVERY request including session acquisition, from request #1 on a fresh IP. Rule is ABSOLUTE and per-JOB
  (non-fetching jobs in the same workflow may carry setup-node — nightly's win-loss job does, harmlessly).
  Confirmed via instrumented per-attempt session logging in `discover-seasons.js` vs a same-day no-setup-node
  control. Symptom signature: no `Session refreshed` line ever; all concurrent probes reject in the same
  second (session promise-lock fan-out); ~4.5 min between rejection bursts (the 10-attempt retry sleep sum).

---

## Data protection (empty/stripped response must never delete data)

PlayHQ increasingly withholds junior data; the API will sometimes return LESS than we hold. Guards in `nightly-crawl.js`:
- **`loadGameFile`:** existing file that fails to parse → THROWS (no empty fallback).
- **`flushGameFiles` shrink guard:** refuses to write fewer games than on disk.
- **`applyRoundFixtures`:** keyed upsert on `game.id` — never appends, never deletes absent games.
- **Multi-sport (future):** profile merge must preserve other sports' seasons; abort the write on raw-fetch failure, never write empty `existingDetail`.

---

## Namespace identity + api-canonical target architecture (2026-07-11/13)

### The two namespaces (see `playhq_api_reference.md` for the API detail)
PlayHQ runs two identity namespaces for the same human. **spectator** ids live in `games/bv` (`p[]`/`hp[]`/`ap[]`); **api** ids are what `publicProfileStatistics`/`publicProfileTeams` expect. They frequently differ. Feeding a spectator id to the api → NOT_FOUND → historically looked private/missing. The api id is the STABLE/canonical key; the spectator id is the axis that DUPLICATES.

### What was measured + done this session
- **Backfill COMPLETE:** ~81,806 un-indexed spectator ids → 0 remaining (256-bucket matrix + single-runner `--gentle` tail). Genuinely-new players (the ~45–48% direct-hit share) written; collisions (~93% of *recovered* ids are already indexed under their api id) SKIPPED and recorded to `reports/backfill-collisions/{spectatorPrefix}.json` = `{ spectatorId: {apiId, name} }` — this IS the spectator→api alias seed for the migration.
- **Gate 1 — spectator-multiplicity = 19.8%** of collision api ids (40,330 mappings, 31,224 distinct api ids, max 13). 43 name-mismatches, ALL benign → recovery matching is trustworthy for alias-folding.
- **Gate 2 — api-stability = 0.09%** duplicate rate (368 same-person records, all foldable spectator/api divergence). No evidence a person has two api profiles. **Both gates passed → migration is UNBLOCKED.**
- **Season-name bug:** the profile API query has no player-name field (its only `name` is the SEASON name), so `buildPublicPlayer` was stamping season names ("Winter 2023") as player names. FIXED FORWARD in `backfill-missing-players.js` (probe spectator name FIRST → `buildPublicPlayer(uuid, apiData, gids, realName)`, never uses the season field). The deployed pipeline's `!player.name` guard held, so 0 pre-backfill contamination — fetch-profile-stats/nightly-crawl need no change for THIS bug. Contamination measured against the KNOWN season-name set (not a regex guess): 35,824 records / 8.69%, all backfill-era, all public. Repair matrix built + proven live (`repair-season-names.js` re-probes each record's own `games[]` for the real spectator name and rewrites `player.name` + index name; idempotent, sharded, gentle tail).

### LIVE shape (migration completed 2026-07-15/16 — everything below is deployed and production-verified)
One file per player keyed by the STABLE api id, all spectator aliases folded in:
```
players/{apiPrefix}/{apiId}.json        # { uuid: apiId, spectatorIds:[...], name, private, sports, seasons, records, games }
players/aliases/{spectatorPrefix}.json  # { spectatorIdTrunc: apiId } — sharded by SPECTATOR prefix (NOT api prefix)
players/indexes/{apiPrefix}.json        # name/history, now keyed by api id
```
- CRITICAL SHARDING SUBTLETY: player files shard by api-id prefix, but a game looks up by spectator id whose prefix is unrelated. So the alias index CANNOT live in the api-id shards — it is its own structure, sharded by SPECTATOR-id prefix.
- In-file `spectatorIds[]` is the durable source of truth; `players/aliases/*` is its rebuildable inverse for O(1) game→player lookup.
- Games store the TRUNCATED spectator id (`TRUNC_LEN = 13`); key the alias index by that truncated form; truncate before resolving (idempotent).
- Migration executed 2026-07-15/16: 908 merges + 1,392 promotes (2,693 old files deleted), all records RE-FETCHED from the API rather than trusted, `games[]` unioned (spectator-crawl data the API never returns), stats NEVER summed. Index rebuilt 1:1 with enriched-field carry-over (`gender`/`sports`/`updatedAt` exist ONLY in the index — not derivable from player files; the apply log's old-key mapping is how re-keyed people kept them).

### POST-MIGRATION INVARIANTS (audited by `db-audit.js` section 3b — all relational, no fixed baselines)
- One file per person, keyed by api id; `player.uuid` === filename ALWAYS.
- **NO `apiId` fields at rest.** `apiId` present = "pending fold" (legitimate transient between matrix recovery and the fold), and its count MUST equal the dangling-alias-target count — same players, two views. Persisting across cycles = the fold trigger is broken.
- `players/indexes/` <-> player files: 1:1 set equality both ways.
- Every alias value points at an existing file (post-fold).
- **`players/aliases/` has no from-scratch rebuilder anymore** (the migration builders `build-alias-index.js`/`build-alias-inverse.js` were deleted in the 2026-07-16 cleanup). It is maintained incrementally by `fetch-profile-stats.js` (writes new alias discoveries) and consumed by the resolver. If a full rebuild is ever needed it must be written fresh, sourcing `player.spectatorIds[]` — NOT from `apiId` fields (post-migration files carry none; a naive rebuild would destroy all ~43k redirects).

### Alias lifecycle (all writers deployed)
- **Identity at birth:** nightly Phase 4 writes `trunc13(uuid) -> uuid` per stub (`writeAliasIdentity`, never clobbers a redirect). Closes the alias-gap class permanently.
- **Redirect at discovery:** matrix recovery (`fetch-profile-stats.js` `recordAliasDiscovery`) writes `trunc13(spectatorId) -> apiId` + unions `spectatorIds` at the moment `apiId` is found. Shard sparse-checkout MUST include `players/aliases/{shard}.json`; apply-and-commit's sparse expansion must include `players/aliases` BEFORE tar extraction (skip-worktree silently drops it otherwise).
- **Fold at cycle end:** `fold-diverged-players.js`, event-driven — triggered `mode=apply` by the matrix completion block alongside leaderboards/search/records; NO cron. Promotes/merges `apiId`-carrying files to their api path, moves index entries with enriched fields, post-checks zero `apiId` before committing. Idempotent.
- **Resolution everywhere:** `resolveToFullUuid` (uuid-prefix.cjs) — index first, alias fallback (trunc13 + legacy-10), SELF WINS on full ids (an id that IS a known player never redirects to a prefix-sharing other). Nightly re-keys `playerDeltas` through it once before Phase 3-cont; deltas for two ids resolving to one person are CONCATENATED, never summed.

### Field lessons (production, night one — the Micaela Chang case)
- **Spectator ids are NOT stable per person** — PlayHQ mints fresh ones over time (Micaela: three distinct spectator ids). "Existing player under a never-seen id" is a PERMANENT trickle, not migration residue; stub -> recover -> alias -> fold is the system's steady state.
- The live spectator endpoint now largely emits canonical/api-namespace ids — nightly `redirected=0` is HEALTHY; historical game-file ids resolve via aliases (verified: 8,231 active-file redirects, resolver correct on all; `redirect-exposure.js` is the standing read-only diagnostic).
- Exactly ONE standing disagreement in exposure output is expected (pending-fold artifacts self-clear; a genuine prefix overlap resolves index-first). One != evidence of breakage.
- **Recurring audits are relational only** (compare live state to live state). The migration used frozen-snapshot gate scripts (rekey-apply EXPECTED_* constants, reconcile-people anchors) — those are now DELETED; never model a recurring check on that frozen-gate pattern.

### Name normalization improvement (surfaced 2026-07-12; do it in the migration's name handling)
Current `normName()` (lowercase + collapse-whitespace + trim; used in the live `namespace-resolve.cjs` — consumed by `fetch-profile-stats.js` recovery — and in StatTrack) MISSES matches on curly vs straight quotes/apostrophes, en/em dashes, and inconsistent accents (e.g. `tre o'connor` U+2019 vs U+0027 treated as different). Extend it to `.normalize('NFKC')` + fold curly→straight quotes + consider accent stripping, applied EVERYWHERE a name is compared (incl. StatTrack). Low urgency (nicknames are the common case and correctly stay distinct), but fold it into the migration so the alias/dedupe layer doesn't inherit the gap.

---

## Season discovery + lifecycle — CONFIRMED GAP (2026-07-09)

`discover-seasons.js` (via `discover-seasons-matrix.yml`, now working) discovers new seasons and backfills player registrations into `sports-index.json` and player files. This is separate from, and does NOT feed, actual game-data fetching.

**The gap:** `nightly-crawl.js` is the *only* writer of `games/bv/`, `team-stats/bv/`, and (downstream) `leaderboard/season/`. ⚠️ **Corrected 2026-09-08: nothing locks a season, ever.** This sentence used to claim `nightly-crawl.js` locks a newly-discovered `COMPLETED` season on sight. It does not. It reads `data/sports-index.json` once and there is **no `writeFileSync` for `INDEX_FILE` anywhere in the file** — its only writes are `games/bv/`, `team-stats/bv/` and its own progress files. Locked seasons are indeed skipped by the crawl, but a season only becomes locked if some other tool sets the flag, and until 2026-09-08 no tool did. Consequence, measured that day: **86 `COMPLETED` seasons sat at `locked: false`**, re-crawled every night for an answer that cannot change, 82 of them predating that week. `close-empty-seasons.js` is now the first writer of the flag, and it sets it only on evidence. So a season discovered via `discover-seasons.js`'s backfill mode can exist in `sports-index.json` with full player registrations and **never have any game data fetched for it at all** — nothing currently bridges that gap. `discover-fixtures.js` does NOT cover this either; it backfills fixtures for teams *within already-known* seasons, not games for brand-new historical ones.

This is why `sports-index.json`'s season count (3,202 as of 2026-07-09) has grown well ahead of `games/bv/`, `team-stats/bv/`, and `leaderboard/season/` file counts (2,860 / 2,860 / 2,803 at that same 2026-07-09 snapshot; **currently 2,870 / 2,870 / 2,806** — the gap the argument describes has if anything widened, so the point stands) — and will keep growing every time a backfill sweep runs, since nothing closes the loop. **Not yet built. Needs its own scoping session** — `discover-fixtures.js --all-seasons` (staging bug now fixed) is the natural tool, at real API volume. Do not attempt this as a quick patch.

**2026-07-21 — FUTURE fixtures for ACTIVE seasons (the other fixture gap) is SOLVED:** `discover-fixtures.js`
(via discoverTeamFixture, full fixture incl. future rounds) works after its staging fix; `nightly-crawl.js`
additionally gained `--rounds-forward=N|all` + first-unsettled-round fetch for no-current-round grades.
Architecture decision pending: weekly `discover-fixtures --current-only` cron (recommended) vs the delivered
`weekly-future-fixtures.yml`. Sunday discovery now dispatches `backfill_teams=true` (weekly pre-game rosters).

- **`removed` flag:** season-level only; distinct from game-level `legacy`/`hidden`. StatTrack reads only `.name` from `index.seasons`.
- **`publicProfileTeams` grade:** present for CURRENT rego, NULL for COMPLETED regos.
- **Roster-fill:** now built and working via `discover-seasons-matrix.yml` backfill mode (`all_players=true, backfill_teams=true`) — writes registration deltas into player files via `reduce`'s delta-apply loop.
- **Auto-lock/verify:** still NOT BUILT.

---

## Leaderboard architecture — RESTRUCTURED 2026-07-09

`leaderboard/season/{seasonId}.json` used to carry a `players` map PLUS 17 separate pre-sorted `{id,v}` arrays (one per stat category), each repeating every qualifying player's `uuid|tid` up to 17 times per file. Since `SEASON_LIMIT` was already "effectively unlimited" (no real top-N trimming ever happened for season files), those 17 arrays held the same ~500–1500 ids as the players map, just redundantly repeated. This was the single largest directory in the repo (`leaderboard/` = 2.82 GB, 30.7% of repo) and the biggest concentration of avoidable redundancy found in the whole audit.

**New schema — season files now contain ONLY the players map, no per-category arrays:**
```json
{
  "players": {
    "uuid1|tid1": {
      "n": "...", "team": "...", "org": "...", "comp": "...", "grade": "...",
      "age": "...", "gender": "...", "gp": 14,
      "foulOuts": 1, "foulOutsPG": 0.071, "threePtPG": 0.5, "foulsPG": 2.1,
      "finals": 1, "gfApps": 1, "gfWins": 0,
      "pts": 180, "threePt": 7, "fouls": 29,
      "wins": 10, "losses": 4, "draws": 0,
      "club": "Knox"
    }
  }
}
```
`pts`, `threePt`, `fouls`, `wins`, `losses`, `draws` are NEW fields added specifically so the client can derive every category from raw values alone — the old schema was missing 9 of the 17 categories' worth of raw data from the players map (it only had 8; the 17 arrays were the only place the rest lived).

**`all-time.json` is UNCHANGED** — it does genuine top-2000-of-369k trimming via a real heap, which is necessary work, not redundancy. Do not apply this restructure there.

**StatTrack (`index.html`) side:** `denormSeason()` replaced with `statValueForPlayer(m, stat)` + `seasonEntriesForStat(playersMap, stat)`, which reproduce every inclusion rule the server used to apply (type-only for pts/gp/threePt/fouls/ppg; `>0` gate for the per-game and finals/gfApps/gfWins/wins/losses/draws categories; `gp>=10` + non-zero total for winPct/lossPct). `S.lbRaw[sid]` caches the raw players map per season id (fetched once); `S.lbData[scope]` still holds `{[currentStat]: computedEntries}` exactly as before, so the several call sites that read `S.lbData[scope]?.[S.lbStat]` directly without a fresh fetch (filter changes on org/comp/grade/age/gender/minGP) keep working unchanged. When merging same-named seasons across multiple sids, entries are computed **per-sid then concatenated** — never merge the raw player maps by key first, since a `uuid|tid` collision across sids would silently drop one season's data (the original array-concat approach never had this risk).

**Deployment order matters:** old-format season files are missing the 6 new raw fields. If the new `index.html` deploys before `build-leaderboards.js --force` has rebuilt all season files, those specific categories will show empty for any season not yet rebuilt (not broken — just incomplete until the rebuild catches up). **Always run the full leaderboard rebuild first, confirm it completes, then deploy the new HTML.**

`build-leaderboards.js`'s `gitCommit` also had the same `-A`-instead-of-`dirs` bug as `discover-seasons.js` — fixed in the same pass.

---

## Round-completion markers (BUILT)

- **Marker:** `gf.roundsComplete[gid][roundName] = {at,n}`.
- **Terminal:** FINAL/CANCELLED/ABANDONED/BYE or forfeit. Round complete iff ≥1 game and all terminal; never mark current round.
- **Grace:** `COMPLETE_GRACE_MS`=7d.
- **`scan-complete-rounds.js`:** offline marker writer + `--unlock` (only reopens, never locks; since 2026-08-07 the unlock ALSO clears `archivedAt` in the same write — split invariant — and prints the T23 deploy reminder).

---

## Database state — LATEST: 2026-07-30 23:04 audit
> ⚠️ **SUPERSEDED IN PART, 2026-08-01.** Four items listed below as open are CLOSED: `finalsPerSeason > 1`
> (audit reads all ≤ 1), the 49 flag collisions (all were legacy+forfeit; repaired, audit reads `✅ none`),
> the `reports/` orphans, and the two root-level scripts. The 08-01 audit also supersedes the counts:
> 412,058 players / 2,311,712 games / 4,124,212 regs after the duplicate merge and sibling sync.
> Re-run `db-audit.yml` rather than trusting the figures below.
- **411,964** players (index and detail agree exactly, 0 orphans either way) · **6.13 GB** / 527,900 files
- `statsChecked` missing: **14** · season-name contaminated: **0** · dangling aliases: **0** (after the 07-31 repoint)
- 2,311,527 games / 2,896 season files · 3,227 seasons · 455,065 alias entries · 457,218 spectator ids, 0 ambiguous
- **Player count FELL 413,577 -> 411,964 and that is CORRECT**: the fold merged 1,640 duplicate
  identities (merge = delete source into existing target, net -1; promote = move, net 0), the nightly
  added 28, then a second fold merged 1 more. 413,577 - 1,640 + 28 - 1 = 411,964. Both intermediate
  figures match the fold's own `files scanned`. Do NOT read a falling player count as data loss without
  checking the fold reports first.
- Still open in the audit: `finalsPerSeason > 1` on 1 player (propagated to `leaderboard/all-time.json`),
  49 flag collisions, `reports/` orphans, two scripts at repo ROOT.

## Older database state (2026-07-16 audit — post-migration; counts grow nightly, re-run db-audit.js)

| Metric | Value |
|---|---|
| Seasons (sports-index.json) | 3,202 (557 active, 2,645 locked) |
| Player index entries / detail files | 411,514 / 411,514 (1:1 both ways) |
| Alias entries | 452,958 (90.5% identity, 9.5% redirect) |
| Game entries | 2,271,939 (games/bv/ — 2,870 season files) |
| Team-stats files | 2,870 |
| Leaderboard season files | 2,806 |
| Repo size | 6.03 GB (this is the 2026-07-16 figure — see the LATEST section above for current) |

**Confirmed DB-shrink opportunities (measured, not yet actioned):**
1. **Zero-risk deletions, no code changes:** `discover-reduce-manifest.json` (50.99 MB, dead artifact from an abandoned pipeline stage, zero consumer) + `team-lookup/` (154.58 MB, 355,164 files, zero consumer — not in StatTrack's file-path reference table, writes already disabled, appears superseded by `team-stats/`+`team-index.json`, not a planned feature).
2. ~~**UUID truncation**~~ — **CLOSED 2026-07-30: MEASURED AND REJECTED. Do not re-open.**
   Measured saving at TRUNC_LEN 13: **57.61 MB** on a 6.13 GB repo — 0.9%. `leaderboard/` holds
   **ZERO** full-length UUIDs (the 2026-07-09 restructure already removed them), which is why every
   earlier estimate was wrong by ~27×: ~1.78 GB was computed at a REJECTED 10-char prefix, and the
   ~1.57 GB "rescale to 13" inherited that error plus an assumption that `leaderboard/` held ~922 MB
   of full UUIDs. Every figure in that chain was derived from another figure; none was measured until
   2026-07-30.
   ⚠️ This entry previously read "NOT YET DONE — re-measure via db-audit section 13" while item 7
   below already said CLOSED. Same file, two contradictory states — the N-1 pattern inside a SINGLE
   document. Corrected 2026-07-31.
   `db-audit.js` §13 was REMOVED 2026-07-31: it answered a question that is now closed, and carried a
   full extra scan of `team-stats/` (2,896 files, 916 MB) plus per-item counting across games, search
   and leaderboard purely for the byte tally.
3. ~~**`needs-matrix-shards.json`** — zero functional value, delete it~~ **RETRACTED 2026-07-29.**
   The narrow observation was right — neither `fetch-profile-stats-matrix.yml` nor
   `fetch-profile-stats.js` reads it, and `fetch-profile-stats.js` gates per-player on
   `statsChecked` regardless of which shard it scans. The CONCLUSION was wrong: the file **IS
   READ** — `nightly-crawl.yml`'s status step counts its length to report `stats_rechecks`, so
   **deleting it makes recheck counts read 0.** It is not a deletion candidate. See
   REPO_MANIFEST §4.2, which corrected this first; README carried the same retracted claim in
   three places and is now fixed too.
4. Structural, big-ticket, unstarted: history squash, R2 hosting.

---

## Architecture — data layers (single writer each; never cross-write)

- **L1 Game data** — `nightly-crawl.js` only. `games/bv/`, `team-stats/bv/`, `venue-lookup/`, `date-venue-index/`. Skips locked seasons (see gap above).
- **L2 Player data** — `fetch-profile-stats.js` (matrix, + alias redirects at recovery); `nightly-crawl.js` (new stubs + reg entries + identity aliases); `discover-seasons.js`; `build-win-loss.js`; `build-finals-stats.js`; `build-player-games.js` (the canonical rebuilder of games[]); `fold-diverged-players.js` (event-driven re-key of pending-fold files). `players/{xx}/{uuid}.json`, `players/indexes/{xx}.json`, `players/aliases/{xx}.json`. Weekly/discover share `concurrency: group: data-write`; the MATRIX's apply-and-commit does NOT (open decision, Outstanding #5).
- **L3 Derived** — `leaderboard/` (restructured, see above), `search/`, `records/`, `data/*.json` (incl. `sports-index.json`, written by `discover-seasons.js`).

---

## Data-structure gotchas

- `S.games[sid]` → `{ games:{[gid]:game}, roundsComplete?:{} }` — always `.games`.
- `S.teamStats[sid]` → `{ [tid]:{meta,roster,fixtures} }` (keyed by tid).
- `g.p[]` = all players no side; use `hp`/`ap` or team-stats roster. **NOT confirmed redundant with hp+ap** — flagged as a candidate to verify (games with `spc:1` might make `p[]` fully derivable from `hp+ap`, but early-phase-discovered games without box scores might populate `p[]` alone) — do not assume without checking real files.
- `g.p[]` entries are BARE `{id}` — NO stat lines (box scores are Worker-on-demand, never pre-stored).
  Therefore team-stats roster stats CANNOT come from games — `build-team-stats.js` sources them from
  player reg stats (`seasons[].regs[].stats`), which is why the matrix terminal rebuilds team-stats (2026-07-21).
- `team-stats` roster keys are the truncated TRUNC_LEN (13) uuid prefix.
- `g.rn` = round NAME; `g.gid` = grade UUID; no round UUID stored.
- `player.seasons[].regs[]` = `{sid,tid,gid,gn,stats}`.
- `reg.stats.wins/losses/draws` same across regs w/ same tid+season; StatTrack use `regs[0]`.
- `sports-index.json` season: `{id,name,grades:[{id,name,age,gender}],fullName,compName,compId,orgName,orgId,tenant,locked,addedAt,lockedAt?}`. `removed:true` stubs = `grades:[],locked:true`.
- `leaderboard/season/{sid}.json` → **now `{players: {...}}` only, no per-category arrays** (see restructure above).

---

## Stripped fields (do not re-add)
Player: `season.sport`, `player.uuid`, ~~`reg.gid`~~, zero-valued `reg.stats.*`.

⚠️ **`reg.gid` REMOVED FROM THIS LIST 2026-07-31 — it was WRONG, and acting on it would have caused
data damage.** This file contradicted itself eight lines apart: the gotcha above gives
`regs[]` = `{sid,tid,gid,gn,stats}` while this list called `gid` stripped. README's player schema
agrees with the gotcha. Settled from CODE, not by majority: `nightly-crawl.js` **writes** `gid` into
every new reg (L1017 existing-player path, L1123 Phase-4 stub path) and **reads it as a match key**
(L1011, L1122: `r.tid === playerTid && r.gid === gradeId`). Stripping `gid` would make that match
fail for every reg and mint a DUPLICATE reg per player per night. The N-1 stale-doc pattern inside a
single document — third instance found in this file (see also the truncation paragraph corrected
2026-07-31). Game: `g.url`, `g.p[].n`. Leaderboard season files: the 17 per-category `{id,v}` arrays (removed 2026-07-09 — see restructure above).

---

## OUTSTANDING WORK — ordered (rewritten 2026-07-16, post-migration)
✅ ready · 🔧 built, review first · 🚧 not built

**Migration track — DONE (2026-07-15/16), all one-off scripts since DELETED (cleanup commit `fe8eedb`, 2026-07-16):** alias index (3a), rekey-enrich (3b-1), name repair, rekey APPLY (3b-2), index rebuild (3b-3), alias-aware resolver + self-wins, nightly retrofit, recovery alias write-back, event-driven fold, db-audit 3b. The migration *scripts* are gone from the repo (recoverable from git history at parent `1faecc5`); the migration *outcome* is the current live state (see architecture below). Durable findings preserved in REPO_MANIFEST.md §6.7. Search-index scoping bug fixed; build-win-loss gitCommit fixed (commit-before-merge + retry).

**Immediate:**
0. ✅→🔧 **§C7 weekly stats chain BUILT + A1-PROVEN 2026-07-21 (second session, late PM)** —
   fixtures → finals(active) → leaderboards(active), Mondays via the nightly. Proving run: 41,714
   files, chain link proven after the boolean-gate fix (directive 13), leaderboards scoped 572 with
   mode-keying + delete-on-success both firing live, clobber check 70/70 clean. Remaining: A2
   wiring commit (due before the Mon 07-21 nightly — first automatic chain that night or 07-27)
   and the §A3–A5 morning/calendar checks in OUTSTANDING_TASKS.md.
1. ✅ ~~**StatTrack update**~~ **DONE (Beta 0.61, July 2026 — see REPO_MANIFEST §6.6):** `player.private`
   boolean honoured, alias-aware resolver ported (trunc13, self-wins, COLLISION sentinel). Runtime
   dependency: Pages must serve `players/indexes/` AND `players/aliases/`. Original scope for reference:
   alias-index game→player resolution (trunc13 + legacy-10, mirroring `resolveToFullUuid` semantics incl. self-wins), `player.private` boolean (~~deployed HTML still infers privacy from the `Player #` name pattern~~ — **FALSE as of the 2026-07-31 verification: the deployed file uses `rec.private===true` at L499 and has since 0.61**), TRUNC_LEN 13. Also: alias-target-404 fallback (a redirect can briefly point at a not-yet-folded api path mid-cycle — fall back to the raw id path). The data side is fully live; StatTrack is the last consumer on the old contract.
2. ✅ Re-run `build-win-loss.js` (fixed) when the matrix is quiet — lands the 78k updates a failed run discarded; doubles as weekly-indexes validation.
3. ✅ Re-enable `weekly-indexes.yml` after #2 runs clean (disabled 2026-07-16 pre-fix — its win-loss full mode was data-destructive against the old index).
4. ✅ Repo cleanup DONE (commit `fe8eedb`, 2026-07-16): 111 obsolete files deleted — all migration one-offs, concluded diagnostics, superseded clusters, orphaned progress dotfiles, migration reports, and the `players/alias-inverse/` + `reports/backfill-collisions/` directories. Restore point: `1faecc5`. `discover-fixtures.js` kept (live `--all-seasons` tool); `build-foulout-stats.js` deleted.
5. 🚧 Decide: `concurrency: group: data-write` on the matrix's apply-and-commit job — serializes all player-file writers (recommended after the win-loss race), at the cost of matrix commits queueing behind long jobs. Not yet decided.

**Carried forward (unchanged in substance):**
6. 🚧 `normName()` NFKC/quote-fold normalization — was slated to fold into the migration and DID NOT happen; still open, applies everywhere names are compared incl. StatTrack.
7. ✅ ~~UUID truncation migration~~ — **CLOSED 2026-07-30: MEASURED AND REJECTED.** db-audit §13 at TRUNC_LEN 13 = **57.61 MB** (not ~1.78 GB, not ~1.57 GB — both were estimates derived from estimates, wrong by ~27×; `leaderboard/` holds ZERO full-length UUIDs). 0.9% of a 6.18 GB repo, for a migration touching every exact-string UUID consumer in one pass. Do not action. Publish-blocking premise remains separately unverified (§D8).
8. 🚧 Historical/locked-season game-data gap — own session.
9. 🚧 Verify `games/bv` `p[]` redundancy with `hp[]+ap[]` for `spc:1` games.
10. 🚧 Season-lock writer + verify; unlock the 489 provably-incomplete locked seasons after it exists.
11. 🚧 Tournament-gap fix; 68 no-`rn` seasons (84,515 games).
12. 🚧 `build-opposition-index.js` — weekly per-player opponent W/L/D.
13. 🚧 History squash / R2 hosting before AFL expansion.
14. ✅ RESOLVED 2026-07-20/21 — setup-node × PlayHQ: rule confirmed absolute per-JOB with instrumented evidence; stripped from `discover-seasons-matrix.yml` (map+reduce) and `discover-seasons.yml`; `probe-setup-node-fingerprint.yml` now a deletion candidate. See REPO_MANIFEST §6.3.

**Explicitly deprioritized:** `needs-matrix-shards.json` efficiency wiring — the feature stays unwired. **The FILE IS NOT DELETED** (this line previously said "the FILE gets deleted per #4" — corrected 2026-07-29): `nightly-crawl.yml`'s status step reads its length for `stats_rechecks`, so deleting it makes rechecks report 0.

**Future:** AFL/cricket — separate game repo, shared player identity; multi-sport merge guard becomes load-bearing.

---

## Why the above exists (session highlights, 2026-07-09)

A GitHub Actions self-triggering matrix (`discover-seasons-matrix.yml`) that should have fanned out cleanly instead skipped its `map` job on every self-triggered run for most of a day, across many wrong theories, before being fixed by diffing its full job graph against the sibling matrix that already worked. Root causes were an unnecessary extra job dependency (should have been a step, not a job) and a redundant `if:` condition checking an output value that GitHub's default success-gating already covered correctly. Along the way: `db-audit.js` was fixed (stale root-level paths for files that moved to `data/` in an earlier migration; a hardcoded "June 2026 baseline" that flagged normal nightly growth as a false anomaly; a factually wrong "obsolete script" attribution) and extended with a real UUID-storage-footprint measurement. The leaderboard was restructured to remove genuine, measurable redundancy in its biggest directory. Two live `git add -A` violations of this project's own rule were found and fixed, only because the actual uploaded files were finally read in full rather than assumed from description.

---

## 2026-09-05/06 — the `u` field was measuring a wrong field name

**`build-player-games.js` line 175 read `g.h` and `g.a` only.** A game in `games/bv` carries
`h`/`a` OR `t1`/`t2` and never both — `README.md` line 266 has documented this the whole time:
"Hidden game (uses `t1`/`t1n`/`t2`/`t2n` instead of `h`/`a`)". For every hidden game both came
back null, the registration test in the `u` block could not pass, and **every appearance in a
season the player holds a registration for was emitted as unregistered.**

Measured on one real season file, `eeaf6409`: 2,758 games, 2,684 hidden carrying `t1`/`t2`, 74
`profileOnly` carrying `h`/`a`, none with both. Player `d303b9c7` is registered to team `0eb8ec62`
in that season; that tid appears as `t1`/`t2` fourteen times and as `h`/`a` zero times. Their games
`0069bcdf` and `0e4d35aa` both carry it — their own team — and both were written into `u`.

**Result of the fix: `u` fell from 1,115,172 to 39,128 across 7,501 players.** 96.5% of that field
was the bug.

**The same bug was in `build-win-loss.js`, in five places.** For a hidden game `resultForTeam`
matched neither branch and returned null, the hp/ap path received `tid=undefined` and skipped, and
the `p[]` path evaluated `tids.has(undefined)` as false and skipped. **Every hidden game contributed
zero wins and losses to every player in it.** Silent, because a skipped game is indistinguishable
from a game with no resolvable players — and because `build-finals-stats.js` L248/L254 has always
resolved both pairs, so finals results were counted for the same games regular-season results were
not. Fixing it updated **44,195 players**. Note the shape: an `--active-only` run touched 37, the
full run touched 44,195, because hidden games are concentrated in seasons that are no longer active.

**And in nineteen places in StatTrack.** The worst was the season card filter: a hidden game matched
neither side, so a season whose games are all hidden rendered "No game records found." for a player
who played every one of them. Also the head-to-head tally (three sites, each dropping hidden games
with a `continue`), box-score side highlighting, game titles reading "? vs ?", and a destructure
taking five slots from a four-element return.

**T44 — `g.h`/`g.a` IS NEVER SUFFICIENT.** Any new read of a game's team ids must use both pairs.
`teamNames(g)` in StatTrack and `hTid`/`aTid` in `build-win-loss.js` are the resolvers; use them
rather than writing a sixth fallback.

---

## 2026-09-05/06 — `sports.Basketball.c` and `.x`

`fetch-profile-stats.js` builds `seenGameKeys` — the set of games PlayHQ credits — and threw it away
at the return. It is now diffed against `player.games` and the DISAGREEMENTS are stored:

- **`c`** — PlayHQ credits it, `games[]` does not hold it. ~224k repo-wide. The appearance-gap
  recovery queue; nothing offline could produce this before.
- **`x`** — `games[]` holds it, PlayHQ does not credit it, not a forfeit. ~80k repo-wide.

Both are DELETED rather than written empty, so absent means zero. Forfeits are excluded on both
sides — `seenGameKeys` skips them at the parse (L393), so leaving them in `x` would make three
quarters of it an artefact of our own filter.

**DECISION RECORD — `proposal-store-playhq-credited-games.md` is RETIRED and the file deleted.**
It asked whether to store PlayHQ's full credited game list per player, as
`sports.Basketball.gamesAPI`. **The answer is no.** What follows is the whole of that decision; the
document itself holds nothing else that is still true.

**Why not the full credited list.** The proposal asked for `gamesAPI`, the whole thing. Measured:
73.1 credited games per player, ~30.1M entries, **~315 MB against the 314 MB `games[]` already
costs, and 99.4% the same ids.** The disagreements are ~4 MB. Verified on shard 00 after a full
force sweep: 1,591 players in scope, 288 carry `c`, 144 carry `x`, 66 carry both, and the
cross-check `gp - games[] == c - x` holds at **100.0%**.

**The proposal's own numbers were wrong in one place worth remembering.** It put the refused seeding
cases at "roughly 450". The real figure was 523, and the guard it referred to was
`stubWouldOverwriteRealProfile` in `seed-apiid-from-playhq-pairs.js` — written that same session and
never added to `REPO_MANIFEST.md`, which is why it could not be found from the docs at all. A tool
that exists but is not in the manifest is a tool nobody can reason about.

**Withheld players are out of scope for that cross-check.** `markNotObtainable` writes `private` and
`statsChecked` and returns without reaching `finishOk`, so the diff never runs — correctly, there is
no credited list to diff against. It also leaves any prior capture intact, so a player who was public
when last fetched and is withheld now keeps their old `gp`. An audit that does not exclude them
reports its own missing-field handling as a fault.

---

## 2026-09-05/06 — what `x` turned out to mean

Two different things, and separating them is the whole value of the field.

**1. PlayHQ undercounts its own box score.** Verified on Toby Jovic (`0afc7690`), game `c7a6db82`,
02 Aug 2025 v MLBC B32: PlayHQ's own box score gives him 2 points and 3 fouls; PlayHQ's own profile
page skips that round and totals the season at 14 games. Measured across the database: of the 8,634
`x` entries where a stored box score can settle it, **8,616 — 99.8% — have the player in PlayHQ's own
box score while its own career totals leave the game out.** 18 are named-but-no-box-row. 62,753 have
no stored box score and are undecidable from files. This is a defect on PlayHQ's side and StatTrack
is now the only place it is visible.

**2. Misrouted aliases — the same person under two PlayHQ profiles.** Jordan Uppal exists twice:
`8a30488e` ("Jordan singh Uppal", gp 34, games 150, x 116) and `296747c1` ("Jordan Uppal", gp 184,
games 184, x 0). All 116 of the first's `x` games are in the second's `games`, and the second credits
every one. `players/aliases/88.json` mapped `88f43f9d-ddb4` to the FIRST. Repointing it took him from
150 games to exactly 34, matching his gp, with `x` at zero.

**This is NOT the fold.** Both records are real, separate PlayHQ profiles with their own credited
stats. Nothing merged them. The fold's keeper rule decides which record's stats survive a merge and
has no opinion on whether two records are the same person.

Campaign result: 46 aliases repointed, 22 held back, 37 identity aliases excluded, 17 partials left
for reading. William Warren went 262 → 78 games against a gp of 78; Ben O'Connor's duplicate
collapsed into `b9ca8d79` at 171/171.

---

## 2026-09-05/06 — three traps from the alias repair, all mine

> ⚠️ **Numbering note, 2026-09-08.** These were first written as T34–T40 and collided
> with the existing traps — this file already ran T1–T43 contiguously. Renumbered to
> **T44–T50**. If anything elsewhere cites "T39" for `discoverCompetitions` or "T34"
> for the `g.h`/`g.a` rule, it means **T49** and **T44**. Before adding a trap, run
> `grep -oE "T[0-9]+ —" claude_context.md | grep -oE "[0-9]+" | sort -n | tail -1`.


**T45 — AN ALIAS WHOSE KEY IS A PREFIX OF ITS TARGET IS THE PLAYER'S OWN ID.** The first repair
listed those alongside foreign aliases under a heading saying "to repoint". For Jordan Uppal it
printed `8a30488e-5554 -> 296747c1` — his own id aimed at a stranger. Acting on that list unfiltered
would have destroyed the record the repair was meant to fix. Detect with `target.startsWith(spec)`,
exclude, and re-check the exclusion at write time.

**T46 — ONE CLAIMANT HOLDING ALL THE MISROUTED GAMES DOES NOT MEAN EVERY ALIAS IS WRONG.** The first
apply repointed every foreign alias aimed at a player whose misrouted games all went to one claimant.
William Warren had three: two carried the misrouted games, one carried 13 games PlayHQ credits to
HIM. Repointing all three took 262 games to 65 against a gp of 78. **Attribute games to the alias
that carried them** — walk every game the player holds, find the roster id that resolves to them,
group by it — and repoint only where EVERY game an alias carried is misrouted. 117 candidates became
46, with 22 held back. One of those held back, `51b6242d-28ab`, carries 175 credited games and zero
misrouted.

**T47 — "ANOTHER PROFILE HOLDS THIS GAME AND IS CREDITED FOR IT" IS TRUE OF EVERY TEAMMATE.** The
first detector asked only that. On a ten-player roster it produced nine claimants: 466 of 840 entries
fell into `ambiguous` and the 40 reported as misrouted were only games with rosters small enough to
leave one. Its synthetic test passed because it used TWO-PLAYER rosters — it confirmed the fixture,
not the logic. The claimant must also be the same person by name (`normName` from
`namespace-resolve.cjs`, surnames exact, first names equal or a prefix). With that, ambiguous went to
zero on real rosters.

**T48 — TEST AGAINST REAL FILES FROM THE REPO, NOT A FIXTURE YOU WROTE.** Every failure above passed
a synthetic test first, because the fixture was built out of the same wrong assumption as the code:
two-player rosters, `h`/`a` games, `u` entries shaped the way `u` was assumed to be shaped. Where
real files were used — `eeaf6409.json`, a real player JSON, fold #76's own committed report — the
checks held. If the real file is not to hand, ask for it before writing the test, not after it fails.

---

## 2026-09-06 — memory, at 418k players

`find-misrouted-appearances.js` died twice on `FATAL ERROR: Reached heap limit` at 4 GB, both times
in the same place, and neither was the algorithm.

**A per-season map of wanted games is a CROSS PRODUCT.** `neededBySid` held, for every player, every
one of their `x` game ids against every one of their seasons. William Warren alone is 24 seasons ×
184 games = 4,416 entries. Across 40,216 x-carrying players that is tens of millions. Game ids are
unique across `games/bv`, so the season prefix bought nothing: use ONE flat set and sweep every
season file once.

**Do not cache every parsed player file.** `readPlayer` is called for every candidate on every team
sheet before a name test can reject them — roughly 1.5M calls across hundreds of thousands of files.
Bound the cache.

**Do per-player work per player.** Attribution needs every game a player holds, which is fine for the
~100 being repaired and fatal for all 40,216. Read the player's seasons inside the function and let
them go on return.

---

## 2026-09-07 — season discovery was dead for a month, and the org route was never closed

**The weekly sweep had been a 30-second no-op since at least 2026-08-17.**
`discover-seasons-matrix.yml`'s `generate-shards` treated `done` as permanent for a
mode, and the cron always resolves to the same mode (`backfill_teams` is true on a
schedule). So the first sweep finished, marked all 256 shards done, and every run
after it selected ZERO shards: empty map matrix, no artifacts uploaded,
`download-artifact` never created `/tmp/discoveries`, and the reduce died on its own
`--reduce needs --in=<dir>` guard.

**And it showed GREEN.** `node scripts/discover-seasons.js $ARGS | tee /tmp/reduce.log`
reports `tee`'s exit code, not node's. A run that fails its own precondition and is
recorded as a success is worse than one that fails, because it looks healthy forever.
`data/sports-index.json` had not moved in a month and nobody had reason to look.

`fresh-start-reset` could never have fixed it: its gate is `inputs.fresh_start`, and
**scheduled runs receive no inputs** — the workflow's own header says so. Manual
dispatch only.

**Fixed two ways.** `done` now EXPIRES: `generate-shards` re-selects any shard whose
`updatedAt` is older than 6 days (6, not 7, so a late start cannot skip a week).
`updatedAt` was already written on every progress entry — `discover-seasons.js` L681
— so nothing new is stored. A missing or unparseable timestamp counts as stale: a
shard that cannot prove it ran recently must run. And `set -o pipefail` on the reduce,
so it can never again fail silently.

Verified by extracting the real `gen` step from the YAML and driving it: 250 stale
plus one with no timestamp selects 251; all-fresh selects 0; a mode change selects
256; an explicit shard list is honoured verbatim; a missing progress file selects 256.

---

**T49 — `discoverCompetitions(organisationID)` WORKS ON A GUEST SESSION, and it is the
top-down season route.**

`playhq_api_reference.md` records "discoverOrganisation for BV: ❌ returns null for
guest sessions" and, directly under it, "team roster before first game: ❌ not
accessible — reconstruct BOTTOM-UP from individual players' UPCOMING
publicProfileTeams regs". Read together those look like the org route is closed. They
are about a DIFFERENT query.

Captured 2026-09-07 against Kilsyth Basketball (`5433b0e3`): `discoverCompetitions`
returned five competitions with every season each has ever run, each carrying
`startDate`, `endDate` and `status`, **including two UPCOMING** — Junior Domestic
Summer 2026/27 (`5e26f10f`, starts 2026-10-06) and Senior Domestic Summer 2026/27
(`8f43ff68`, starts 2026-09-20). The same response also returned
`discoverOrganisation` fine, so the reference's note may itself be stale or specific
to querying by `code` alone.

The difference this makes: the bottom-up probe cannot see a season until somebody has
registered in it. This sees it the moment the association creates it, at **one request
per organisation** — a few hundred — against 418,000 player probes.

`scripts/discover-org-seasons.js` implements it, scheduled daily. It does NOT replace
`discover-seasons.js`, which also backfills player rosters and recovers grades from
registrations.

**Its one real limit, stated rather than hidden:** org ids come from
`sports-index.json`, so a brand-new association with no season already recorded is
invisible to it until one of its seasons is found another way.

**Season entries it creates are indistinguishable from `discover-seasons.js`'s**, same
shape and the same locked/removed rules, plus `discoveredBy: 'org'` for provenance. An
UPCOMING season normally has no grades yet and is written `locked: false, grades: []` —
"pre-allocated", live, awaiting grades — which is exactly the state the nightly needs
to start crawling it.

---

**T50 — SCHEDULED RUNS RECEIVE NO INPUTS, AND A DRY-RUN DEFAULT IS A NO-OP ON CRON.**
`workflow_dispatch` defaults do not apply to a `schedule` trigger, so every input must
be read through an explicit fallback at its use site. `discover-org-seasons.yml`
resolves `mode` to **apply** on a schedule for exactly this reason: a daily dry run
would find seasons and throw them away. This is the same class of fault as the weekly
sweep above — a job that runs, reports success, and does nothing.

**T51 — A SKIP PROPAGATES DOWN THE WHOLE CHAIN, AND A CONDITION ON ONE JOB DOES NOT
CLEAR IT FOR THE JOBS BEHIND IT.** `discover-seasons-matrix.yml` fanned out zero map
jobs for four weeks while `generate-shards` went green printing "Shards selected: 256".
`fresh-start-reset` is skipped whenever `fresh_start` is false — nearly every run.
`generate-shards` survived that on `!cancelled()`. `map`, the only job in the file with
no `if:` of its own, inherited the skip and was skipped UNEXPANDED; `reduce` then died
on its own `--in` guard with no artifacts to read. The whole run took 28 seconds.
**An empty matrix and an inherited skip render identically** in the Actions job list —
a single bare `map` entry, greyed. They are told apart by replaying the
`generate-shards` step offline and reading what actually lands in `$GITHUB_OUTPUT` (it
was a valid 256-element array), not by looking at the graph.
The file's own header made this worse: it said "no custom `if:` on map" matched the
reference workflow. **It does not.** `fetch-profile-stats-matrix.yml`'s matrix job
carries `always() && !cancelled() && needs.clear-stats-checked.result != 'failure'` and
depends on a job gated on `inputs.force` — the identical shape. The reference hit this
and solved it with a condition on the matrix job. That wrong sentence is why the fault
survived: anyone reading the file was told the omission was deliberate.
Fixed 2026-09-08 with `if: ${{ always() && !cancelled() && needs.generate-shards.result == 'success' }}`,
proven by dispatching with `fresh_start` unticked — the exact broken condition — and
watching all 256 shard-suffixed jobs run green.
**Rule:** if any ancestor of a job can be skipped, every job downstream of it needs its
own condition. Check the whole path, not the direct dependency.

**T52 — A FIXED SLEEP IS NOT PACING. A SEQUENTIAL PLAYHQ CALLER NEEDS BACKOFF AND
RETRY.** `close-empty-seasons.js` shipped on 2026-09-08 with a fixed 150 ms sleep and no
retry. It fired 165 grade lookups plus their rounds in 80 seconds: **5 seasons answered,
then every remaining call was CloudFront-blocked and 22 of 27 seasons went unanswered.**
Identical shape to the `discover-org-seasons.js` run the day before — 14 through, then
164 refused — which is the failure that wrote 80 seasons to `removed:true`.
The AIMD ladder used elsewhere is about concurrency and does not apply to a sequential
caller; there the lever is the **gap between calls**. Same principles though: retry the
blocked call rather than discarding it (5 s × attempt, capped at 60 s, six attempts),
widen the base gap when blocks cluster, decay it after a run of clean calls. The re-run
absorbed 3 blocks, recovered by the third retry, and answered 26 of 27 in three and a
half minutes.
**Rule:** any script making more than a handful of sequential `api.playhq.com` calls
needs backoff and retry before it is dispatched, not after it is walled. The comment in
`discover-org-seasons.yml` already said this. It was written and then not followed, in
the same session.

**T53 — `Object.values(x)` HOLDS THE SAME REFERENCES. YOU CANNOT ASK IT WHAT A FIELD
USED TO BE.** The `backfill-dates` counter reported **0 filled while filling 1,984**. It
did `before = Object.values(index.seasons)`, mutated `index.seasons[id].endDate`, then
asked `before.find(x => x.id === id)?.endDate` whether the season previously had one.
Same object. Always yes. The branch could never fire. Fixed by snapshotting up front:
`const hadEndDate = new Set(before.filter(s => s.endDate).map(s => s.id))`.
**Rule:** to compare before and after, capture a primitive snapshot — a `Set` of ids, a
count, a hash — before any mutation. A "before" array of object references is not a
before.
Second instance the same session: `audit-finished-unlocked-seasons.js` tested
`st === 'UPCOMING'` for unplayed games. Real data uses `PENDING` and `IN_PROGRESS`, so it
counted zero unplayed games in a season holding three and declared it safe to lock.
**Test terminal states against an allowlist and treat everything else as unfinished** —
never test for a specific non-terminal value.

**T54 — RE-DELIVERING A FILE UNDER THE SAME NAME WITH NO VERSION MARKER IS A SILENT
SWAP.** On 2026-09-08 `audit-finished-unlocked-seasons.js` was delivered, found to have
the `UPCOMING` bug above, rewritten, and delivered again under the identical filename
with nothing in the message saying it had been replaced. The first one was pasted and
run, and the resulting report named a season as safe to lock that had already been
measured as holding three unfinished games. From the reader's side there was no way to
tell the two apart.
**Rule:** when re-delivering a file already handed over, say plainly that it replaces the
earlier one, and name something visible in its output that distinguishes them ("the new
one prints a status vocabulary block").

**T55 — ADDING A RETRY LOOP OBSOLETES EVERY TIMEOUT THAT BOUNDS IT.** On 2026-09-08
`update-team-index.js` was given the house 60-attempt push retry. Its workflow had
`timeout-minutes: 15`, and the `team-index` job inside `nightly-crawl.yml` also had
15. The loop's worst case is ~114 minutes of jitter and git cycles plus ~10 minutes
to scan 418k player files, so both timeouts now sat INSIDE the budget and would have
killed the job mid-retry, hiding the real cause — while the log showed a timeout
rather than a push error.
This is not hypothetical. `build-venue-indexes` was given 45, then 120, and both sat
inside its loop's ~3-hour worst case; it died at the clock for days with ~17 seconds
of real work in each run before a 240-minute backstop was fitted in August 2026.
**Rule:** a timeout is a BACKSTOP ABOVE a self-bounding loop, never a budget for it.
Whenever a retry loop is added, changed, or has its attempt count or jitter altered,
re-check every timeout that bounds it — the standalone workflow AND any job that
calls the script directly. Write the arithmetic in the file next to the number.

**T56 — A WRITER→READER TABLE ENTRY THAT NAMES NO SCRIPT IS A GAP, NOT A FACT.**
`REPO_MANIFEST.md`'s writer→reader graph listed `data/venue-index.json` as written by
"(venue build)". No such script exists. The file was created ONCE, on 2026-06-13, by
the Phase 1 migration — 532 entries against the 532 venue directories that existed
that day — and **nothing ever updated it again**. By 2026-09-08 it held 532 entries
against 537 venue directories and 541 venues named in game data, and StatTrack reads
it to name venues, so nine venues could not be named. It had been broken for three
months and looked documented the whole time.
Worse, when asked who wrote it, the answer was read back out of that table as though
it were established. It was a placeholder nobody had resolved.
**Rule:** a parenthesised or hedged writer in that table is an OPEN QUESTION. Resolve
it by reading the named script's actual writes, not by repeating the table. And when
this project's own chat history exists, search it before concluding a fact is
unrecoverable — the 2026-06-13 session recorded exactly when and how this file was
created, and it was not consulted.

**T57 — A SKIP IN A WRITER IS OFTEN THE KEY, NOT A BUG. ESTABLISH THE RECORD'S KEY
BEFORE TOUCHING IT.** `update-team-index.js` did `if (existingTids.has(tid)) continue;`
before comparing anything. That reads as a defect — a known team never being
corrected — and on 2026-09-08 it was "fixed" to compare and overwrite `n`, `comp`
and `grade` keyed on `tid`.
A `--all` dry run reported **2,175,659 corrections across 360,777 teams**, six per
team, with the same tid rewritten repeatedly inside one run and the last writer
winning. Sample output showed `3fca39c4` going "Miniball 2" → "3" → "4" and
`0a01ac30` going "C" → "CR" → "A/AR" in a single pass.
The skip was not a bug. **Decision A (2026-08-01): a registration IS a (team, grade)
pair, and a team under two grades in one season is a REGRADE — correct data.** The
identity is `(tid, gid)`, never `tid`. 1,296,352 regs are that shape. This is **T14
rebuilt**, in a new script, in a codebase whose context file warns about it twice.
Nor can the CURRENT grade be recovered from registrations at all. Measured on Toby
Jovic (`0afc7690`), four regrades: the RES grade is `reg[1]` twice and `reg[0]` twice.
Array order carries no chronology and a reg has no date. Current grade is the `gid`
of the team's most recent GAME — `games/bv` or `team-stats/bv` fixtures.
`n` and `comp` ARE safe: the team name is identical across every reg of every regrade
(MMB66, MMB74, MMB70, MMB71), and `comp` comes from `sports-index`.
**Rule:** before adding or editing a writer of a shared collection, find the record's
key in the decisions log — not by reading what the code currently does. A guard that
looks redundant is usually load-bearing.

**T58 — READ THE DOCUMENTATION BEFORE WRITING THE PROBE, NOT AFTER IT FAILS TWICE.**
On 2026-09-10, `db-audit.js`'s status fix surfaced 47,807 games at status `LIVE` —
the third-largest status in the database, previously counted by nothing. The question
was whether they were recoverable. It took FIVE full runs, each costing a ~7-minute
checkout, and the answer was in the repository's own documents throughout.
- Runs 1 and 2 asked `gradeRounds` → `discoverFixtureByRound`, the route the nightly
  uses. Every `discoverGrade` returned null: 16 grades, 8 seasons, no failures,
  nothing asked. **`REPO_MANIFEST` §1629 and `OUTSTANDING_TASKS` §352 already recorded
  that `spectator.playhq.com` is the LIVE-SCORING service and `api.playhq.com`'s
  `gameView` → `discoverGame` is the canonical record.** `LIVE` is a live-scoring
  status, so those games were never reached through a grade listing and the grade
  endpoint could not possibly answer for them.
- Run 3 used the right endpoint and got a clean answer, but sampled `.slice(0, N)` —
  consecutive games from one round, which share a state. Eight agreeing answers were
  closer to one observation than eight.
- Run 4 fixed the round axis but still drew all six printed examples from a single
  season, because the example list fills from the first season producing that outcome
  and stops. The axis that was asked about was not the axis that was fixed.
- Run 5 added an "unallocated placeholder" detector testing `no date AND no venue AND
  no court`. It found 1 of 89,665, while the same run reported 52,996 with no venue.
  **`README.md` L314 defines `hidden: true` as an admin-hidden grade,
  `playhq_api_reference.md` L780 records that venue is NOT AVAILABLE via any route for
  hidden games, and `REPO_MANIFEST` L1907 — written the day before, by me — says
  hidden games never carry a `vid`.** The absence of a venue is the documented
  signature of a hidden game. The "placeholder" theory was built on a field never
  read from a real record; the stored game turned out to be `{d, rn, h, hn:"z3", a,
  an:"z4", st:"PENDING"}` — a grading-round game hidden after the fact, captured
  already redacted.
**Rules:** (1) Before writing a probe against PlayHQ, name the SERVICE the data came
from and check it in `playhq_api_reference.md`. Endpoint families are not
interchangeable and the reference records which is which. (2) Before writing a
detector for a data shape, read one real record of that shape. (3) When a sample is
challenged as too narrow, ask which axis — round, season, competition, era — and
widen that one; widening a different axis looks like a fix and is not.

**T59 — A SAMPLE THAT FILLS FROM THE FIRST MATCH IS NOT A SAMPLE.**
`audit-nonfinal-games.js` capped its printed examples at six and filled them in
iteration order, so all six "still served" came from one season and all six "not held"
from another — out of 40 seasons queried. The counts underneath were correct and
spread; only the examples anyone actually opens were not.
**Rule:** an example list must be capped PER GROUP, not globally. One or two per
season across N seasons, never the first six encountered.
