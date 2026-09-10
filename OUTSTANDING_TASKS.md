# OUTSTANDING TASKS — markjovic/sports-players-stats

---

## 2026-09-08 — current state

All figures measured 2026-09-08. The index grew 3,431 → 3,479 mid-session when the
matrix sweep completed; figures marked "(pre-sweep)" were taken before that point.

**Closed this session**

- Season discovery **verified working**. `5e26f10f` (Kilsyth Junior Domestic Summer
  2026/27) is in `sports-index.json` at `locked: false`, `discoveredBy: "org"`. Note
  `8f43ff68` carries no `discoveredBy` — the bottom-up route already had it, so only
  one of the two Kilsyth seasons is attributable to the org tool.
- **The `removed:true` guard.** 52 of 80 seasons repaired, +239 grades; 28 left alone
  as correctly flagged. Verified on `55dcd845` (8 grades, `locked:false`, no `removed`
  key, `repairedAt` set) and `af72a719` (untouched). See T51–T54 and REPO_MANIFEST §6.35.
- **`discover-seasons-matrix.yml` map fan-out fixed** — see T51. Full sweep: 256/256
  shards, 233,617 players at 100%, 48 new seasons, 46 grade lists filled.
- **Date backfill.** End dates 639 → 2,671 of 3,479 (18.6% → 76.8%), 17 seconds, no
  extra API requests.
- **26 empty seasons closed on evidence**, 304 grades off the nightly. Zero came back
  holding games we had missed.
- Two dangling aliases confirmed **unresolvable** by `fold-diverged-players.js
  --repoint-only` (417,971 files scanned, 499,914 ids; both point at
  `3f310c9f-0352-4c3c-b9fc-b24a292ff9b8`, which no player file claims).

## 2026-09-10 — current state

**The lifecycle rule ran and took half the nightly.** 307 seasons locked, 4,927
grades, **9,956 → 5,029**. `STILL CHANGING` 0 against 391 fingerprints, and one
season (`01ffe236`, ended seven days earlier) changed between runs — the canary
works. Nothing older than three months moved. 84 seasons remain too young and lock
themselves as they age past three months; 28 empty ones wait for the Sunday
`close-empty-seasons` cron.

**`db-audit.js` was counting five statuses nowhere.** Its status section totalled
2,360,109 of 2,424,380 — **64,271 games tallied by nothing**, because the catch-all
branch explicitly EXCLUDED `BYE`, `LIVE`, `PRE_GAME`, `IN_PROGRESS` and `PENDING`.
Fixed, with a reconciliation line that marks itself ✅ or ❌ against the game total,
and the `not yet final` count that had been computed every run and never displayed.

**That surfaced LIVE at 47,807 — and the answer is that none of it is recoverable.**
Every LIVE game is in a locked season; none is in an active one. 320 games across 40
seasons were asked of the canonical record: **0 finished at PlayHQ.** 232 are no
longer held by PlayHQ at all — the competition has been withdrawn upstream, which is
also why those seasons carry no `endDate` and no organisation lists them. 88 are still
served and still non-final, matching the PENDING finding of 2026-09-08 through a
different endpoint. **Locking those seasons cost nothing.**
> ⚠️ It took FIVE runs and two wrong endpoints to establish that, and the answer was
> in this repository's own documents the whole time. See **T58** and **T59**. Anything
> further on this topic should start by reading `playhq_api_reference.md`.

**Also closed 2026-09-10:**
- **79,566 players gained a club in search.** `build-search-index.js`'s
  `extractClubTeam` returned at the first season holding a team name and used THAT
  season's club even when absent, never looking further back — so 19% of the database
  rendered as "— · TeamName". It now orders seasons by real `endDate` and prefers the
  most recent season holding BOTH, so 261,490 of 265,481 pairs come from a single
  season. 152,902 still have no club, correctly: no season on their record carries one.
- **The two dangling aliases are gone.** `repoint-only` proved them unresolvable
  (417,971 files scanned, neither spectator id claimed by any player), so
  `prune-dangling-aliases.js` removed them: 499,607 → 499,605, db-audit §3b now 0.
- **`playerCount` deleted** from `sports-index.json`. Nothing wrote it; it read
  369,428 against 418,416 real files. The one-off that removed it should be deleted.
- **Organisation `59363a37` skipped.** Deleted at PlayHQ; its four seasons are test
  fixtures, all `removed:true` stubs. Skipped in the sweep rather than deleted from the
  index, because the org list is rebuilt from the index every run.
- **Three nightly timeouts corrected against their retry budgets (T55).**
  `team-index` 15 → 150, `team-stats` 60 → 240, `venue-lookup` 30 → 180.
  `build-team-stats.js` has had a 60-attempt loop since 2026-07-28 — about 109 minutes
  for a single commit — inside a 60-minute timeout for six weeks. `update-venue-lookup.js`
  was the reverse: 30 was correct for its old 10-attempt loop and became wrong the
  moment it was raised to the house pattern. Both scripts also swallowed failures and
  now throw.
- **`lock-quiet-seasons.yml` was given the `data-write` lock.** It shipped without one
  on T19 grounds, and that was wrong: every writer of `sports-index.json` uses
  `merge -X ours`, so two concurrent writers do not conflict — the second silently
  keeps its own copy and discards the other's. T19's harm applied to burst-dispatched
  workflows where an evicted waiter loses its run; a daily cron that misses a day loses
  nothing. Prompted by the 2026-09-09 cron starting at 22:41 instead of 20:30 — GitHub
  queues scheduled runs, and a two-hour drift closes a ninety-minute gap between the
  three index writers.

### THE SEASON LIFECYCLE RULE — built 2026-09-08, running on a schedule

**Nothing had ever locked a season.** `nightly-crawl.js` reads `sports-index.json` and
never writes it. Measured 2026-09-08 after the date backfill made the scale visible:
**419 `COMPLETED` seasons unlocked, holding 5,873 grades — 59% of the 9,953 the
nightly fetched every night.** 334 ended more than three months ago; 41 more than
three years; one in December 2019.

**`lock-quiet-seasons.js` + `.yml` (new).** Daily at 20:30 UTC, and it **applies** —
a rule that only fires when someone remembers to dispatch it is a report with extra
steps. Four conditions, all required: PlayHQ says `COMPLETED`; not already locked;
ended more than `min_age_months` ago; games exist on disk. Writes `locked: true`,
`lockedAt`, `lockedReason` — never `removed: true`. Reopen by clearing those three.

**`lock_after_months` ships at 3, the same as `min_age_months`** (Mark's call), so a
season locks the moment it is three months past its end date and the quiet streak
never gates anything. It was drafted at 12 and 6 was considered; both were caution
rather than evidence. His reasoning: a season is over within a week or two of its last
fixture, and three months already allows for deferred finals and the summer break.

**The fingerprint is now the check on that decision, not a gate.** Every candidate's
games are hashed each run (sha1 over each game's id, status and both scores) and
compared with last time. A season locked on age whose fingerprint moved in the same
run was still receiving data when it was sealed — reported as **STILL CHANGING** and
every one named for reopening. **THAT COUNT MUST STAY AT ZERO.** If it is ever above
zero, three months is too short and the log says so rather than anyone guessing again.

**The zero-games floor is not negotiable.** `lock-quiet-seasons` never locks a season
with no games; burying one would be the same failure as writing `removed: true` off a
CloudFront block. `close-empty-seasons.yml` — which asks PlayHQ per grade — is now on
a **weekly cron (Sunday 21:30 UTC, applying)**, having been dispatch-only. Between
them the two rules cover the whole space with nothing left to remember.

- **First dry run (12 months, 2026-09-09):** 69 locked by age, 485 grades off the
  nightly, 9,953 → 9,468. 238 still settling (4,442 grades), 84 too young (852),
  28 with no games (94), **0 with no endDate** — the backfill covered every candidate.
- **Open, low priority:** partial seasons. `361e5374` holds 12 games across 18 grades
  and locks on age at 72 months. `close-empty-seasons` asks PlayHQ about seasons with
  NO games; nobody has ever asked about seasons with SOME games and missing grades.
  Same machinery, pointed differently. Age-locking closes over that gap.
- **Open:** `lock_after_months` is set from instinct, not measurement. After a few
  weeks the "changed this run" rows in `data/season-activity.json` will show how old a
  season is when its data last moves. Set it from that.

### STALE AND BROKEN WRITERS — found and fixed 2026-09-08 (later the same day)

Found by asking why `data/` files had commit dates months apart. All three quiet
files turned out to be correct; two writers turned out to be broken.

- **`data/venue-index.json` had NO WRITER for three months.** Created once on
  2026-06-13 by the Phase 1 migration (532 entries / 532 venue directories) and never
  updated again. REPO_MANIFEST's writer→reader graph recorded it as "(venue build)",
  a placeholder nobody resolved — see **T56**. StatTrack reads it to name venues.
  **Fixed:** `build-venue-indexes.js` now rebuilds it in the pass that already opens
  every games file, from `vid` + `vn`, merging rather than replacing and aborting if
  the file would ever shrink. First live run: **532 → 541 venues, 9 added, 2 renamed,
  0 orphaned.** All 1,795,589 games carrying a `vid` also carry a `vn`, so the data
  was always there. The two renames are real: "Forest Hill Chase" → "THE SUMMIT SPORTS
  COMPLEX (Forest Hill Chase)." and "Sydenham-Hillside Primary School - Hillside
  Campus" → "Hillside Primary School".
- **`build-venue-indexes.js` had the combined-`git add` bug** — one add across three
  pathspecs, where a single unmatched pathspec stages NOTHING atomically. That is the
  fault that discarded a green run of 30,426 games from `discover-fixtures.js` on
  2026-07-19; that script was fixed on 2026-07-21 and this one never was. Its whole
  `gitCommit` was also wrapped in a try/catch that printed `✗ git error` and returned,
  so a failed push exited ZERO and the job showed green. **Fixed:** per-path adds,
  staged shortstat, 60-attempt push retry with jitter, throws on exhaustion.
- **`update-team-index.js` broke FOUR of this repo's own rules.** `git add -A`
  (forbidden, claude_context L1286 — this is the **third** instance after
  `discover-seasons.js` and `build-leaderboards.js` on 2026-07-09); `--staged --stat`
  instead of `--shortstat` (L1296; L475 records the ENOBUFS kill at 25,593 files);
  `merge --no-edit` without `--no-stat`; and the same swallowing catch. No push retry
  either. **All fixed.**
- **`update-team-index.js` only ever ADDED teams, never corrected one.** It did
  `if (existingTids.has(tid)) continue;` before comparing anything, so a team that was
  renamed or regraded kept its original name and grade permanently and nothing in the
  pipeline ever corrected it. **Fixed:** it now compares and updates, prints each
  correction, and a blank team name from PlayHQ will never overwrite a name already
  held. **Not yet sized** — see OPEN WORK below.
- **Two timeouts were sized INSIDE a retry budget** once that retry was added — see
  **T55**. `update-team-index.yml` 15 → 150, and the `team-index` job inside
  `nightly-crawl.yml` 15 → 150 (exactly one key changed in that file; job graph diffed
  key by key to prove it).

**The three quiet files are CORRECT. Do not investigate them again.**

- `data/zero-team-seasons.json` (1,002 entries) — a `discover-fixtures.js` report,
  per REPO_MANIFEST §391. It moves when discover-fixtures finds something. Silence is
  the normal state.
- `data/seasons-discovered.json` (2,552), `data/seasons-invalid.json` (895),
  `data/seasons-skipped.json` (366) — the never-re-queue lists named in
  claude_context L1323. Append-only, and they only grow when something new goes
  wrong. A quiet one is a correct one.
- `data/season-venue-index.json` covers **2,116 of 2,939** seasons, and that is
  expected, not a gap: a season only appears if at least one of its games carries a
  `vid`, and hidden games never do.

### NEEDS YOU — added 2026-09-08

- **`reports/manual-alias-decisions.json` — 5 entries, all still `decision: null`.**
  Zachary Price, Samara Ballis, Ethan Belcher, Harrison Belcher, Kevin Huang. Each needs
  a human to open the three linked game pages, find the child on the team sheet, note
  the club, and set `decision` to the matching uuid. `repoint-aliases` re-verifies every
  entry before writing, so nothing moves until these are filled. Two weeks old as of
  2026-09-08. Five children are currently attributed by guess.
- **Two dead aliases need a decision: delete, or leave.** `005c9694-d2a1` and
  `9d69fac4-2d40` both point at `3f310c9f-0352-4c3c-b9fc-b24a292ff9b8`. That file does
  not exist and no player file claims either spectator id, so `repoint-only` cannot
  derive a target and deliberately will not delete. Until they go, `db-audit.js` §3b's
  "dangling targets must equal apiId-field count (0)" keeps reporting ❌. Neither id
  appears in `reports/alias-repoint-log.json` (13 entries, applied 2026-08-26) — though
  that log covers one batch, not the full 46-alias campaign, so absence from it is weak
  evidence rather than proof.

### OPEN WORK — added 2026-09-08

- **The season lifecycle rule and its state file.** Agreed shape: a new JSON state file
  that the nightly (and anything else) may write, recording per season whether anything
  changed on the last pass. A season becomes lockable when it is `COMPLETED`, its last
  game is well past, and successive checks have found nothing changed — "quiet for N
  consecutive checks" rather than a fixed timer, because **age does not predict
  completeness**: `a9fcd2a0` ended 2020-09-20 and 387 of its 387 games are still
  unresolved. Much easier than it looked, because 76.8% of seasons now carry PlayHQ's
  own `endDate` and `status`; the season-name year (present on 100% of seasons and never
  once contradicting `endDate` across 639 checks, pre-sweep) is a fallback that may no
  longer be needed. **N is deliberately unspecified — nobody has measured it.**
  **Floor condition, non-negotiable:** never lock a season with zero games unless PlayHQ
  has been asked and confirmed it holds none. `close-empty-seasons.js` is that check and
  is the model.
- ~~**`update-team-index.js` correction backlog is unmeasured.**~~ **DONE 2026-09-08.**
  A `scan_all` run corrected **2,628 teams and added 6,589**, total 368,003. Almost
  every correction was `n "" -> "<real name>"` — teams written into the index with an
  EMPTY NAME and never revisited, so unsearchable in StatTrack, which matches on `t.n`.
  Many `comp "" -> "..."` too, from seasons whose `compName` was empty when the team
  was first seen and has since been filled — quite possibly by the same day's date
  backfill. Only one genuine rename in the visible sample.
  **A first attempt at this was badly wrong and is worth knowing about — see T57.**
  It corrected `grade` as well, keyed on `tid`, and reported 2,175,659 "corrections"
  across 360,777 teams: the same team rewritten repeatedly within one run because a
  team legitimately holds several grades (Decision A). `grade` is now never corrected.
- **Current grade in `team-index.json` is still ill-defined, and always was.** It holds
  whichever grade was seen first when the team was created, and StatTrack renders it
  at line 1640 as a search subtitle (`[t.comp, t.grade].join(' · ')`) — a display hint
  read as a STRING, so an array would render comma-joined and wrong. Mark's preference:
  the current/most recent grade. That is derivable — the `gid` of the team's latest
  GAME — but only from `games/bv` or `team-stats/bv` fixtures, never from
  registrations, which carry no chronology (measured on `0afc7690`: the RES grade is
  `reg[1]` twice and `reg[0]` twice across four regrades). Probably belongs in
  `build-team-stats.js`, which already reads fixtures.
- **Player search shows no club for many players.** StatTrack line 935 renders
  `${h.c||'—'} · ${h.t||''}` — club then team — so the dash is a MISSING CLUB, not a
  missing team. Source is `search/players/{xx}.json`, written by
  `build-search-index.js`, which has not been examined.
- **`nightly-crawl.yml` has other short timeouts that may now be wrong.**
  `team-stats` is 60, `venue-lookup` is 30. Neither was examined on 2026-09-08. If
  either script carries a push-retry loop, T55 applies and the timeout needs checking
  against it.
- ~~**The `not returned` counter in `audit-pending-games-vs-playhq.js` is wrong.**~~
  **FIXED 2026-09-08.** It now reports a count only when every grade in a season was
  successfully queried, and prints `COVERAGE n/m grades — no count produced` otherwise.
  Verified on the live re-run: 632 phantom absences → 0, five seasons correctly
  refusing to produce a count, three fully-covered seasons reporting a real zero. The
  finding itself was unaffected — 649 still pending, 0 finished at PlayHQ.
- **The old text, for reference:** It
  counts every game in a grade the run never queried as "not returned by PlayHQ",
  merging "PlayHQ dropped the fixture" with "we never looked". With `max_grades=4`
  against a 16-grade season it reported 315 phantom absences. The tool's actual finding
  (685 asked, 0 finished at PlayHQ) is unaffected. Fix: only count games in grades that
  were successfully queried.
- **`sports-index.json.playerCount` reads 369,428 against 417,971 actual files.** Stale
  by ~48,500. Find its writer and either refresh it or delete the field.
- **Organisation `59363a37` "Testing Basketball Association 1" no longer exists at
  PlayHQ** — `discoverCompetitions` returns "Organisation could not be found". It will
  error on every daily org sweep forever. Harmless, but a permanent error line trains
  everyone to ignore the error line. Decide: suppress by id, or resolve its seasons.
- **`fold-diverged-players.js` line 105 comment is wrong.** It says `--repoint-only`
  repairs aliases "using the oldKey -> apiId pairs recorded in
  `reports/fold-diverged.json`". It does not — `repointOnlyMode` calls
  `buildSpectatorMap` and reconstructs everything from the player files' own
  `spectatorIds`. The workflow already carries this correction dated 2026-07-31, noting
  that trusting the report is what made the 2026-07-30 repair fix 0 of 284 dangling
  aliases. The wrong version survived in the script header.
- **`repoint-only` cannot be dry-run from the workflow.** The case statement passes
  `--repoint-only` alone, so `--dry-run` is never set and that branch always writes.
  Selecting `mode: dry-run` runs the *fold's* dry run, a different code path that says
  nothing about aliases.

### DATA-QUALITY CAVEATS — added 2026-09-08

- **808 seasons are returned by no organisation and still have no `endDate`.** Not a
  transport gap — zero organisations were blocked on the run that established this.
  Those competitions are no longer listed under any org PlayHQ will talk to: archived,
  or the org merged or renamed. It will not shrink by re-running. Examples: `15105141`,
  `17416075`, `19517459`, `29536804`, `48874698`, `50712173`.
- **2,503 of 7,086 games in finished-but-unlocked seasons read `PENDING`, and they are
  never coming back.** Established by asking PlayHQ directly: **685 games asked, 0
  finished at PlayHQ.** Three seasons got complete coverage with no failures —
  `63ef78f5`, `1c6ddc98`, `16dd975c`, 524 games — and every one is still pending on
  PlayHQ's own fixture today. `63ef78f5` ended December 2025. These competitions were run
  and never scored on PlayHQ. **This is not a capture failure and there is nothing to
  backfill.**
- **`db-audit.js` does not count `PENDING` or `IN_PROGRESS`.** Its status section names
  FINAL, UPCOMING, POSTPONED, CANCELLED, ABANDONED and no-status, totalling 2,360,109 of
  2,424,380 games — leaving roughly **64,000 games under statuses it neither names nor
  counts**. Measured vocabulary across two real game files: FINAL, PENDING, IN_PROGRESS,
  ABANDONED. Add the missing two, and print any unrecognised value rather than dropping it.
- **11 seasons carry no `gid` on any of their games**, so grade coverage cannot be
  established for them at all. `fe2002db` holds 96 games and not one `gid`. Reporting
  these as "a grade has no games" is wrong — the check cannot be performed, which is a
  different statement from failing it. Examples: `e16f3b33`, `f5d8954a`, `d34090ba`,
  `1d956c78`, `a15c09c1`, `fe2002db`.
- **`data/discover-progress.json` is deleted by the reduce when a sweep completes**
  ("all tracked shards complete — progress file removed"). So it does not exist between
  sweeps, every sweep starts cold and selects all 256 shards, and the `done`-expiry fix
  added 2026-09-07 **can only ever matter to a sweep that stalls partway**. That is
  correct behaviour, but the expiry logic is inert in the normal case and should not be
  re-diagnosed as broken.
- **78 seasons had no games file at all** (531 grades) when measured. 26 were then
  confirmed empty at PlayHQ and closed; 54 were skipped as touched within 3 days (the
  repair had unlocked 52 of them hours earlier, before any nightly could reach them).
  `19446969` cannot be judged — it has no grades in the index to ask with.

## 2026-09-06 — current state

### Closed this session

- **The `t1`/`t2` field bug.** `build-player-games.js`, `build-win-loss.js` and nineteen sites in
  StatTrack. `u` 1,115,172 → 39,128; 44,195 players with corrected win/loss.
- **The fold's merge keeper.** Decides by which record holds stats, not by `games[]` count. 533 of
  541 merges rescued. Drops `statsChecked` on a tie and dispatches a targeted re-fetch.
- **`gamesAPI`** — measured (~315 MB, 99.4% duplicate) and rejected. `c`/`x` shipped instead, ~4 MB,
  cross-check 100.0% on shard 00.
- **`--active-only` for `build-finals-stats.js`** — already implemented (L69/203/220/398); the
  workflow already declares and passes the input. **`build-foulout-stats.js` does not exist** — it
  was deleted 2026-07-16 (commit `fe8eedb`) because `fetch-profile-stats.js` writes `foulOuts`. That
  item was carrying a task for a deleted script.
- **The misrouted-alias campaign.** 46 repointed, 22 held back, 37 identity aliases excluded.
- **`proposal-store-playhq-credited-games.md` RETIRED and deleted.** The decision it asked for is
  recorded in full in `claude_context.md` under "2026-09-05/06 — `sports.Basketball.c` and `.x`".

### Correction to this section

An earlier draft listed `--active-only` for `build-finals-stats.js` / `build-foulout-stats.js` as
"the last prerequisite before the nightly chain can be built". Wrong on every count, and this file
already said so: `build-foulout-stats.js` was deleted 2026-07-16, `build-finals-stats.js` has had the
flag since before that, and **§C7 further down records the chain as already BUILT** —
`discover-fixtures → build-finals-stats --active-only → build-leaderboards --active-only`, Tuesdays,
each link success-gated. The item was carried in from a handover note and never checked against this
document.

### Added 2026-09-07 — season discovery

- **The weekly sweep was a no-op for a month** and showed green. Two fixes were made
  on 2026-09-07: `done` expiry, and `set -o pipefail` on the reduce.
  > ⚠️ **RESOLVED 2026-09-08, and the diagnosis above was wrong.** Blaming `done`
  > permanence requires a progress file recording shards as done, and
  > `data/discover-progress.json` **does not exist** — the reduce deletes it on
  > completion and is its only writer. Run #162 confirms it: `generate-shards`
  > reported "256 targets (0 re-selected as stale)", exactly what an absent progress
  > file produces, and `map` was skipped anyway. **The real cause was the missing
  > condition on `map` — see T51 in `claude_context.md`.** Of the two fixes made,
  > `done` expiry is correct but inert until a sweep stalls partway, and
  > `set -o pipefail` **worked**: run #162 failed red in 28 seconds with the reason
  > printed, where the same failure previously reported green. Fixed and proven —
  > full sweep completed 256/256 shards, 233,617 players at 100%.
- **`discover-org-seasons.js` added**, daily cron. Finds UPCOMING seasons with zero
  registrations via `discoverCompetitions(organisationID)`.
  > ✅ **Run live 2026-09-07/08.** 183 organisations, 178 new seasons. But its first
  > run wrote **80 COMPLETED seasons as `removed:true`** off a CloudFront wall — a
  > failure to ask recorded as an answer, and permanent, because the grade-refresh
  > selects `locked === false` only. Guarded and repaired 2026-09-08; see the
  > 2026-09-08 block above.
- **Open question:** is the new season in `data/sports-index.json` with `locked:false`?
  That is the whole test of whether any of this worked.

### Open

1. **The 17 partials** in `reports/misrouted-appearances.json`. A claimant takes most but not all of
   the player's `x`, so no rule settles them. Each is listed with every claimant, the leftover and
   the aliases involved. Read individually.
2. **The 22 held-back aliases.** Each carries games PlayHQ credits to the player, so a few
   appearances stay misrouted rather than risk moving a real one. `51b6242d-28ab` carries 175
   credited games and zero misrouted. Left alone deliberately.
3. **46 merged files that are public, checked, and have `gp` 0** despite real captured games. Never
   investigated. Listed with names and dates in `reports/lost-stats-from-folds.json`.
4. **The 158 season-label / placeholder names.** One targeted matrix run with `heal_names` ticked.
5. **`find-misrouted-appearances.js` header** prints `players=Infinity` when the input is 0.
   Cosmetic.
6. **Leaderboards have not been rebuilt** since the `t1`/`t2` fix corrected 44,195 win/loss records.
   Check whether they need it.
7. **`games !== gp` on 92,162 of 411,094 fetched-and-public players (22%).** Never
   sized before 2026-09-07. For the 363,998 players with no `c`/`x` this is the ONLY
   signal that capture and credit disagree. Some is forfeit and fill-in semantics that
   are correct by design; how much is unknown. The distribution of `|gp - games|`
   would say whether it matters, and is a file scan.
8. **363,998 players — 88% — have no `c`/`x` at all**, having been last fetched before
   the field shipped. The recovery queue covers the other 12%. Extending it is a forced
   sweep of all 256 shards. Largest open DECISION rather than a bug.
9. **The 62,753 undecidable `x` entries.** No stored box score, so files cannot say whether PlayHQ
   holds the player. Fetching those box scores through the Worker would settle them and turn the
   99.8% figure from a sample into a total.

---

**As of 2026-08-13 (Thursday AEST).** THE RECOVERY IS DONE AND MEASURED. Missing appearances
**757,272 → 442,939** (−41%). Players missing 100+ games: **1,060 → 13**. Missing 51–100: **764 → 57**.
The worst record in the database is now 188 games short, against 555 on Friday. What got it there: the
spectator re-sweep (1.94M games captured), the canonical-record backfill via `discoverGame`
(133,674 games PlayHQ's live-scoring service never held), and ~277,000 targeted roster appends. What
remains is shallow — 112,682 of 114,959 affected players are short twenty games or fewer, and 94,235
are short five or fewer.

Two ordering bugs were found and fixed on the last day (new **T28**/**T29**): workflow-level
`concurrency` does nothing between a workflow's own jobs, so three player-file writers in
`weekly-indexes.yml` ran in parallel from separate checkouts pushing `merge -X ours`; and
`build-player-games` ran alongside `discover-fixtures`' 360-minute window, deriving `games[]` from a
partial view of `games/bv`. The chain is now serialised with `player-games` last. Finding those cost
most of a day and six wrong theories — recorded in `claude_context.md` as a debugging lesson, not just
a fix.

**Previous state (2026-08-11, Tuesday AEST):** THE SWEEP IS DONE AND A SECOND CAPTURE PATH HAS OPENED. The
spectator re-sweep drained: 2,026,441 games targeted, `spc` now on **1,943,317** of 2,344,710 games
(82.9%, from under 7% on Friday), 265,194 retired as misses. Then the misses turned out to be a
finding rather than a residue: **`spectator.playhq.com` is PlayHQ's LIVE-SCORING service and
`api.playhq.com`/`discoverGame` is its canonical record**, so games scored on paper and entered
afterwards were never visible to any of our tooling. Four of five sampled games from "dead" 0%
seasons returned full lineups from the canonical record. `discover-game-backfill.js` was built to
close that and is running now. Also this stretch: the repair tools were corrected to write ROSTERS
only, never stat lines, before either was ever run.

**Previous state (2026-08-10, Monday AEST):** THE APPEARANCE GAP IS BEING CLOSED, and the overnight pipeline
was re-architected around three failures it exposed. The gap's mechanism is PROVEN per game (stored
`p[]` a strict subset of the live spectator box; captured mid-scoring, round settled, never
re-queried) and the fix is a spectator re-sweep of **2,026,441** games — roughly a third done, `spc`
at 725k+, running at 85–93% hits per dispatch. Along the way: `fold-diverged-players` was dying for
two hours in a per-path `git add` loop (T16, already documented, never audited against that file) and
now commits in ~4 minutes; every git call in four scripts was killing itself on Node's 1 MB
`execFileSync` buffer (new **T26**) after the work and before the push; and the nightly's terminal
still fired both weekly discovery sweeps at the same instant as post-drain-chain (T19's burst, in the
one place never audited), which now run on their own weekly crons with the cron-gets-no-inputs trap
handled at every site (new **T27**). `fetch-profile-stats-matrix` was the last repo writer outside
the `data-write` group and is now locked at its three writing jobs.

**Previous state (2026-08-07, Friday AEST):** THE SPLIT IS LIVE, END TO END, IN ONE DAY: designed, measured,
built, and executed. Active artifact **763,124,203 bytes** (was 1,210,614,006 — ~447 MB of headroom
against the ceiling we were ~1 MB from); archive origin serving 447.9 MB of locked seasons at
`markjovic.github.io/sports-players-stats-archive`; graduation #1 green; StatTrack **0.74** routing
per-season fetches by `archivedAt` with a one-shot cross-origin 404 fallback and a LOCKED marker.
The T19 regression (the 2026-08-06 lock fix self-evicting leaderboards/search/records from the
one-waiter queue) is STRUCTURALLY fixed: **post-drain-chain.yml** runs the five derived-data builds
as sequential jobs under ONE data-write acquisition — chain #1 green in 38 min, fold queued as the
lone waiter and ran clean, venue-indexes healed and MOVED out of the nightly. Growth on the active
origin is now bounded: seasons graduate out 28 days after locking, automatically, nightly.

**Previous state (2026-08-05, Wednesday AEST):** The locked re-sweep is DONE (+23,264 games, one dispatch)
and the whole post-sweep rebuild chain has run: careers repaired (Toby 85W/70L → 51W/48L/1D,
verified live), records rescanned, leaderboards rebuilt, team-stats full. **Finals performance
shipped and verified on screen** — 5 GP / 12 PTS / 2.4 PPG / 9 F / 4W 1L against a 4.7 career PPG —
with scoring hydrated CLIENT-SIDE from the Worker at zero storage cost (StatTrack 0.73; the
122,319-game server backfill I proposed was unnecessary). Three self-inflicted failures today, all
now traps: the 110MB progress file that killed a full finals run (T22), a Pages-publication lag that
produced three phantom bug hunts (T23), and a tautological sizing scan that measured a field against
its own source (T24). §2 holds one NEW regression — inappropriate season medals, root cause
identified, fix not yet built (§2.4) — plus the Phase 4 residue, now measured instead of guessed.

**Previous state (2026-08-04, Tuesday AEST):** locked re-sweep launched; §2.1's first observation
came back NO overlap (63-min gap, lock serialised the chain to the minute); Mark found the Fold
queue-eviction (T19) and the regrade double-count in two more places (StatTrack season rows → 0.69;
`build-win-loss.js` career totals both modes → T20); the W/L one-game lag was root-caused to
`github.sha` freezing every job to the run-trigger tree (T21, fixed with `ref: main`).

**Previous state (2026-08-02, Sunday AEST):** closed §2.1, §2.2, §2.5 and §2.6 end to end, all
verified by execution — legacy population exactly 3 (all genuinely scoreless locked-season
FINALs), the ba9d21fe forfeit repaired from a live probe, five of six chain-critical dispatches
on the retry helper, leaderboard two-segment keys confirmed from live data.

Structure: what needs YOU, then what's open, then everything finished in a reference section at
the bottom. Full detail on completed items lives in `REPO_MANIFEST.md` §6.11+ — this file records
WHAT, the manifest records WHY.

Database is healthy as of the **2026-08-02 06:07 audit**: `✅ Structural invariants OK`, 412,100
players, 2,314,197 games, 6.13 GB, zero contamination, zero dangling aliases, zero name-heal
failures — and the two predictions this session staked are now MEASURED FACT:
**`legacy: true — 3`** (0.0%) and **`legacy + score — ✅ none`**, permanently. §11b printing
sizes instead of ages in the same run is the live proof the edited db-audit.js is what executed.

---

## 1. NEEDS YOU — nothing moves until these happen

**1.1 — DEPLOY PAGES.** 124 alias corrections are committed and `build-player-games` has
rebuilt from them, but StatTrack reads the published origin. A commit is not a publication.

**1.2 — FIVE ALIASES NEED A TEAM SHEET.** Everything automated has run out on these: BOTH
candidate profiles were registered and active that season, so registration cannot separate them.
`reports/manual-alias-decisions.json` holds one entry each with the game URLs to open, the name
and jersey to look for, the club it should be, and every candidate with its profile link. Set
`decision` to the winning uuid, then run `repoint-aliases` — it re-verifies before writing.
Zachary Price, Samara Ballis, Ethan Belcher, Harrison Belcher, Kevin Huang.

---

## 1a. THE MATCHER STILL WRITES ALIASES WITHOUT CHECKING SEASON ACTIVITY — NOT YET FIXED

Everything above is cleanup. **This is the fix that stops it recurring, and it is NOT BUILT.**

`matchFromGradeRosterByName` in `lib/namespace-resolve.cjs` matches a name against one grade's
aggregated roster and writes an alias when exactly one player in that grade carries the name. It
never asks whether that player was in THE GAME. A fill-in from another grade or club is not in
that roster at all, so the one same-named player who IS in the grade gets the alias — which is
precisely the Jida McCrae-Cooper error.

`matchFromGrade` is safe: it requires `team.id` to match, so the candidate was on that team.
`matchFromSearch` is the loosest — a tenant-wide name search narrowed only by
`lastInteractedOrganisation`.

**What the fix needs to be:** before an alias is written, the chosen profile must be shown to be
ACTIVE IN THE SEASON THE GAME BELONGS TO — a registration, or games played there. A profile with
no presence in that season cannot be the player on that team sheet. That is exactly the test that
settled 35 of the last 40 by hand, and it belongs in the matcher rather than in an audit run
afterwards.

**Why it is not done:** the matchers are pure functions over API results and do not have the
season context. The caller (`fetch-profile-stats`) does. So the change is a predicate passed in,
not a rewrite of the matcher — but it needs the caller read in full first (directive: read the
whole function before changing flag or state logic), and that was not done this session.

## 2. OPEN WORK — I can do these, they just need a "go"

**2.9 — END-OF-CAMPAIGN CHECKLIST (in order, once the sweep queue is drained).**
1. **Re-enable the weekly tail:** uncomment the `schedule:` block in `spectator-backfill.yml` (Sat
   10:00 UTC). It is deliberately commented out for the duration of the campaign so a scheduled run
   and a manual dispatch can never share the one-slot pending queue; the file says so in place.
2. **`build-win-loss --force`, once.** The nightly runs it in DELTA mode, which never saw the swept
   games — every recovered appearance is missing from W/L until one forced pass.
3. **Read the verdict:** re-run `size-gap-players.yml` — but ONLY after a `build-player-games`
   rebuild (weekly indexes, Sundays). Its two inputs update on different clocks, so any reading
   before that is meaningless and will look WORSE, not better. Compare against the 2026-08-07
   baseline: 102,609 players / 757,272 appearances.
4. **Mop up the residue with `repair-players-batch.yml`** at descending `min_gap` (100, then 50, then
   20) for players spectator could not serve. Progress file carries across dispatches; dead profiles
   are recorded and never retried.
5. **Design capture-at-source** (§3, below) with the two settled requirements.

**2.10 — Capture-at-source design session.** Two requirements are already settled by evidence: stop
`spc`-freezing at FINAL (a box that completes later is invisible forever — the one gap no sweep can
detect), and let the aged sweep be the roster authority instead. The natural implementation reuses
data the pipeline ALREADY fetches and discards: `fetch-profile-stats.js` walks every profile's
`gameStatistics` to build `gameTids` and throws away the game-membership we don't hold. Constraint:
matrix shards must not write game files, so they emit append-intents and one aggregator applies them
under `data-write`. Needs a design doc + approval before any build. NOTE the partition: the systemic
fix only ever touches players the matrix still fetches, so retired players' gaps are permanently
`repair-players-batch` territory — the two are complements, not alternatives.

**2.11 — Spectator concurrency is 3 and nobody knows why.** `CONCURRENCY_SPECTATOR = 3` is commented
"unchanged" (inherited, not measured). Measured behaviour: ~11–15 games/second, ~270 ms per request,
session refreshes in bursts of three every ~300 games. The only quota note in these docs (~30 calls
per session, 2026-07-21) concerns `salvage-spectator-names.js` and does NOT match this endpoint's
observed behaviour, so it explains nothing here. Untested hypothesis: the pool width, not the
endpoint, is the throughput limit. Cheap experiment declined 2026-08-08 mid-campaign; revisit when
the sweep is done and only weekly trickle work remains.

**2.13 — Games we hold that PlayHQ has deleted.** One of five sampled 2021 games (`10161401`) 404s on
both the website and the API while sitting in our `games/bv`. Small population, unknown size, no
action decided — but `dgm` now records them distinctly, so after the backfill the count is a simple
scan away.

**2.14 — `retry_covered` is built but PROVEN INEFFECTIVE — do not use.** It re-admits retired misses
in well-captured seasons. A 200-game probe returned 200/200 `"game could not be found or was not
electronically scored"`; the flag is only useful if a NEW route to those games appears, which is now
what `discover-game-backfill` is. Kept in the code, documented in place, left off.

**2.19 — 25% of `publicProfileTeams` calls return NOT_FOUND, and a large minority return fewer
registrations than we hold.** Measured 2026-08-18 over 100 players: 25 returned
`5 NOT_FOUND: failed to find profile`; several more returned 0 teams for players whose files hold 1–8
registrations (Thorn McIntosh 1→0, James Arturi 5→0, Matilda Coles 8→0). Either those profiles have
been deleted since we fetched them, or a population of ids fails to resolve on that endpoint. **Not
investigated. Do not treat stored registrations as suspect on this basis without measuring it.**
Related to §2.13 (games PlayHQ has deleted) and to the 637 `gql-error` dead profiles the repair
campaign recorded with the identical message.

**2.20 — `discover-seasons.js` never refreshes a season's grades once it has any.** It writes
`grades` at season creation (L526) and its refresh only re-reads seasons sitting at `grades: []`
(L542). A season captured during its GRADING phase therefore keeps grading grades permanently — 7
seasons are in that state as at 2026-08-19, 6 of them active, and any new season caught mid-grading
joins them. **No longer costs data**: `discover-fixtures` now resolves teams via
`discoverTeams(filter:{seasonID})` as well as ladders, so the sweep works regardless of the grade
list. What remains wrong is metadata accuracy — EDJBA holds 55 grades against 263 live. The fix is to
widen the L542 condition to also re-read seasons whose stored grades are all `* Grading`. Small, and
it self-heals as each season leaves grading.

**2.21 — Off-by-one positive gap: ~35,000 players, cause unknown.** 26,211 players are short by
exactly ONE appearance and 9,108 by 2–5 — together 95% of the 36,975 with any positive gap. Four
explanations have been tested and eliminated: fill-in games as a category (dg 4.9% against a 5.7%
baseline, no signal), split identities (393 probed, 73.3% exact), uncountable game types (6.37 per 100
games held against a control of 7.71 — LOWER), and mis-attribution (rosters verified against PlayHQ's
own API, 55 games re-fetched). The scale says systematic; the size says low-value. **Do not re-run
those four tests** — they are recorded in claude_context 2026-08-16/18.

**2.22 — ~20 players credited with hundreds of games where we hold ONE.** `20b2df06` Tahlia Parker
gp=389 games=1 · `11fdc0c2` Jade Chow gp=370 games=1 · `5ce73543` Charlie Thompson gp=270 games=1 ·
`67a0b22f` Deegan Mathews gp=247 games=1. Not a capture gap — a capture gap does not leave exactly
one. These look like players whose appearances sit under an identity that was never connected. Small
and specific, and the ONLY remaining group where a fix would visibly change a player's page.
`probe-player` on one of them is the cheapest next step.

## 3. BACKLOG — bigger, not started, no urgency

- **Multi-sport expansion** (AFL, cricket). Identity layer decided (Option B: shared player identity,
  per-sport game repos). Repo size is not a prerequisite (§D8 closed); history squash / R2 are
  optional pre-AFL choices. ⚠️ Blocking prerequisite (also in `claude_context.md`): the
  `existingDetail` merge in `fetchPlayerProfile` MUST preserve other sports' seasons, and a failed
  GitHub raw fetch MUST abort the player write rather than proceed with an empty `existingDetail`.
  Safe today only because basketball is the sole sport.

---

## 4. CLOSED THIS WEEK — reference only

### Closed 2026-08-23/24 — THE ALIAS TABLE IS NOW VERIFIED, NOT ASSUMED

The open question was whether `players/aliases` could be trusted. Every entry was created by matching
NAMES (`matchFromGrade` / `matchFromGradeRosterByName`), and nothing had ever checked whether the
profile chosen actually credits the games that alias delivers. It has now been checked end to end.

**The population.** 498,570 entries, of which 416,885 are self-mappings (a player's own prefix) and
**81,685 are name-matched decisions** — the ones that could be wrong.

**probe-alias-credits** asked PlayHQ, for every one, whether the target profile's
`publicProfileStatistics` credits the games it delivers. 54,328 distinct profiles, ~5 hours:
- **77,142 SUPPORTED (98.9%)** — backed by PlayHQ
- **874 unsupported**, of which 128 had exactly one same-named profile that DOES credit them
- 3,517 no answer (private/throttled), 103 targets crediting nothing at all

**repoint-aliases** applied **88** of those 128 after re-verifying each against PlayHQ at apply time.
`build-player-games` rebuilt 27,373 player files from the corrected table. The rest were skipped
correctly: already pointing at the proposed target, would point an id at itself, or no player file.

**probe-alias-names** took the 746 the credit test could not settle and asked the SPECTATOR box score
who each id actually is — the check that settled Jida McCrae-Cooper by hand:
- **739 name agrees**, split by how many players carry that name: **652 SETTLED** (only one does),
  **87 still open** (several do — the Jida shape, see T40)
- **5 "disagree" that are folding artefacts, not errors**: Zac/Zachary, `Edwards-Cooper` vs
  `Edwards Cooper`, `Jonah - Holland` vs `Jonah-Holland`
- **0 genuine disagreements**

**probe-shared-name-aliases** then attacked the 87 offline, with evidence neither PlayHQ test used:
which same-named candidate held a registration for that game's SEASON to one of the two teams playing
it. 24 confirmed, 23 to repoint, 4 ambiguous, 36 none-fit. Those 23 are §1a.

**The worked example that started it.** `900f4fe6-bec3` is in PlayHQ box scores as "Jida McCrae-Cooper"
and is NOT a PlayHQ profile. Our alias sent it to `d6c25c0c`, a DIFFERENT profile with a similar name;
`60eeeaa9-ab28` is the one that credits those games. ~198 appearances on the wrong player, and
`size-report` had listed that alias third in "worst offenders" for days without the cause being chased.

**Also closed in the same window:**
- **Phantom players.** 2,482 removed, duplicated appearances 122,866 → 6,616. `spectator-backfill` now
  calls `isApiProfile()` before stubbing, so no new phantom can be created (T36).
- **Season drift.** `build-player-games` back-filled 12,951 seasons across 4,710 players that were
  present in `games[]` and missing from `seasons[]`, and now reconciles every run — the next run added
  **0**, so it is holding.
- **Season-name contamination.** 158 → **1** (a private profile with no name to heal). The old scan
  reported **0 of 411,576** because it only matched a name against that player's OWN season strings;
  `looksLikeSeasonName` in the lib now catches the shape, shared by the scanner and the guard.
- **Name heal.** `--heal-names` and `--heal-season-names` added with a give-up counter, so the matrix
  chain terminates instead of looping for ever on unhealable players. Tahlia Parker went from ONE named
  season out of thirty to all thirty with grades, GP and points.
- **StatTrack Beta 0.78** — season cards derive GP from `games[]` via `gameTids` when PlayHQ gives no
  per-season `gp`, so a card no longer reads 0 GP for a player with 27 games.
- **Roster id forms measured.** 29,984,730 `p[]` entries: 99.24% truncated, 0.76% full uuid, and **ZERO
  rosters list the same person under both** — the mixture broke five diagnostics but corrupts nothing
  (T37).


**MOVED FROM §2 ON 2026-08-19** — these were completed but left sitting in OPEN WORK,
which is how a closed item gets re-litigated. Section 2 is open work only.

**2.12 — RECURRING path for paper-scored games. ✅ DONE 2026-08-16, chain CONFIRMED FIRING.** Chained, not folded — the opposite of my earlier preference, for a reason the code
settled: `discover-game-backfill.js` line 679 selects on `spcm > 0` ("so this never races ahead of
the spectator sweep"), so it can only see games the sweep has ALREADY asked for and been refused. A
standalone cron would fire against whatever last week left and find nothing if it ran first. So
`spectator-backfill.yml` now dispatches it on finish (weekly cron, or `chain_discover=yes` on a
manual run), which also captures a paper-scored game the SAME Saturday spectator retires it rather
than the following one. Field names were diffed mechanically against the target workflow's declared
inputs — a wrong one is an HTTP 422 and a silently broken chain every Saturday. Proven by dispatching
Spectator Backfill with `dry_run=true, chain_discover=yes`: Discover Game Backfill was triggered.

**2.15 — Flagless rosters: CLOSED, and the premise was wrong.** ~~Count games carrying a
repair-written roster.~~ 201,405 games hold a roster with no `spc`/`dg` flag, but they are NOT
repair-written: the entire campaign made 812,554 appends across all games ever, while that population
alone holds 2.3M appearances. They are captures that PREDATE the flags. My first tool split them by
`spcm` and labelled the `spcm`-set group repair-written; that was wrong — `spcm` records THAT
spectator failed, never WHEN, so a roster captured years earlier looks identical. **Do not strip
either group.** The useful follow-up, if any, is back-filling a provenance flag so they stop reading
as anomalies. Verified separately: the rosters themselves are correct against PlayHQ's own API.

**2.16 — `inspectP` verdict: DONE 2026-08-14.** Own-id presence now returns `SELF-PRESENT`, a name no
`startsWith('PRESENT')` test can capture, in all three tools. Note the original claim here was half
wrong: only `probe-player` mislabelled it. `repair-players-batch` skipped it before its alias counter
and `repair-player` counted it as `ok`, so the 1,537 alias-skips at min-gap=25 were never the
artefact this item blamed them on.

**2.17 — `size-negative-gap` private flag: DONE 2026-08-16, and the tool is now a section of
`size-report.yml`.** Private profiles are separated (3,133 players, 127,664 excess) and excluded. The
`dg` verdict is computed against a baseline measured from the data rather than a remembered "~6%",
and states which way the evidence points instead of printing a standing claim. Measured: 5.2% against
a 5.7% baseline — no signal, fill-in theory unsupported.

**2.18 — Route to zero: MEASURED, and all three assumed remainders were wrong.** The campaign ran to
completion (135,613 players processed, 812,554 appends). What the per-band breakdown established:
- **Alias divergence is not a remainder at all.** 9 alias-blocked credits out of ~477,000 actionable,
  and `build-player-games` independently reports 0 unresolved `p[]` ids across 29.5M appearances. The
  three "likely fold cases" named in this item — Emmett Schroen 180/1, Toby Jacobsen 154/1, Xavier
  Mifsud 108/1 — were nothing of the kind; they appended 178, 148 and 107 respectively.
- **The appendable share collapses as gaps shallow**: 99.5% at 101+, 97.8% at 21–50, 84.8% at 6–20,
  **52.5% at 1–5**. The shallow band is roughly half discovery-limited.
- **The floor is not hand-written fill-ins.** It is `game-absent` (~121,852) and `uncaptured`
  (~39,061) — games we do not hold, and held games no sweep has captured. Both are addressable, and
  both belong to §2.12 and the sweep rather than to any repair tool.
- **133,459 appearances remain missing across 51,846 players.** "Zero outstanding" in the batch log
  means the QUEUE is empty — every player processed — not that every gap is closed.


**2026-08-13 (end of day) — PUBLISHED.** Deploy Archive Pages and Deploy Pages both run, so the
week's recovery is live on both origins: ~1.25M rewritten locked-season games on the archive, and the
active site serving the rebuilt player files and indexes. All 2026-08-13 fixes committed
(`weekly-indexes.yml` chain + setup-node removal, the repair tools' uncaptured-game guard,
`discover-fixtures` timeout and 429 cap). §1 is empty: nothing is waiting on Mark.

**2026-08-13 — the recovery measured, and two ordering bugs that hid it.**
- **VERDICT: 442,939 missing appearances, from 757,272 on 2026-08-07** (−41%). Deep tiers effectively
  cleared: 101+ from 1,060 players to **13**; 51–100 from 764 to **57**; 21–50 from 6,547 to 2,207.
  Worst single record 188 (was 555). 274,520 players now fully captured.
- **`discover-game-backfill` completed:** 133,674 games captured from the canonical record at ~99.9%,
  concurrency **5** (measured: 25 hit a sustained 403 wall after ~140 games, 5 ran 200/200 clean in
  52 s — recorded at the constant so it is not "optimised" upward later). ~19% of players in those
  paper-scored games are fill-in or anonymous with no profile id: counted, skipped, unrecoverable.
- **`repair-players-batch` applied** 75,095 appends at min-gap=100 (463 players, 99.6% of their gaps)
  plus 197,397 more at min-gap=20 before its timeout, and 4,810 at min-gap=25. Its OOM at ~90 players
  was fixed by evicting the season-file cache at each commit window (the cache had no eviction policy
  at all — a leak with a delay) and the workflow timeout raised 240 → 350.
- **T28/T29 found and fixed** — see `claude_context.md`. `weekly-indexes.yml` chained; both
  `setup-node` steps removed from it (harmless there, but one edit from the documented 403 failure).
- **`discover-fixtures.js`: two silent-hang bugs fixed.** The weekly froze after "Teams: 594" with no
  output for five minutes. Cause: Node's `fetch` has NO default timeout, so one stalled socket blocked
  its `Promise.all` batch and therefore the whole run forever; and the 429 branch `continue`d without
  incrementing `attempts`, spinning at ten seconds a turn with no output and no exit. Both fixed with
  an explicit timeout and a capped retry, and every retry now PRINTS. **Concurrency 40 was NOT the
  cause** — the weekly cron runs at 40 and that is the proven working value; I argued otherwise twice
  from assumption instead of from Mark's log.
- **Repair tools: uncaptured-game guard added** before either was run again (see claude_context).
- **Negative gap explained as private profiles**, fill-in theory refuted by its own diagnostic, and
  no fill-in tag to be built.
- **`build-win-loss` needs no forced pass** — the weekly's own job covers it; a repeat correctly
  reports 0 updated. That step sat on my checklists for four days without being checked.


**2026-08-11 — SWEEP COMPLETE, and the misses turned out to be a discovery.**
- **Campaign final numbers:** 2,344,710 games on file; `spc` 1,943,317 (82.9%, from 158,022 on
  Friday); 265,194 retired misses; 44,989 deferred by the 30-day age guard; queue zero. Every tally
  reconciles against the file count exactly.
- **`size-misses.yml`** (new, read-only) gave the misses an anatomy: 131,520 are `profileOnly`
  records with no real game behind them (only 9 of which we synthesized — the rest pre-date this
  work); the year table shows 2020 at 0% capture rising to 98.8% in 2026; and the clustering
  diagnostic split them into 446 DEAD seasons (175,647 misses), 545 MIXED (70,820) and 951 COVERED
  seasons above 95% capture that still lost 18,727 scattered games.
- **The classification fix.** `gqlSpectator` returned a bare `null` for every failure — 403, 429,
  5xx, GraphQL error, network fault — indistinguishable from a genuinely empty box, so with
  `miss_attempts=1` a single bad network moment retired a game FOREVER, and the weekly cron would
  have kept doing it. Now classified: genuine empties and 404s retire; transport failures write
  nothing and stay queued. Reported per run with cause breakdown.
- **A wrong theory, cheaply killed.** I built `retry_covered` believing the covered-season misses
  were transport failures. A 200-game probe: 200/200 `"game could not be found or was not
  electronically scored"`, and the Worker agreeing with `{"error":"Game not found"}`. Retirement was
  CORRECT; the flag is retained but documented as ineffective. Cost: two probe runs, ~1 minute of
  endpoint time, no data changed. My permanence regex ALSO missed that message ("could not be found"
  does not match a naive /not found/), which is why 200/200 were labelled transient — corrected.
- **THE FINDING, and it was Mark's observation that cracked it:** the game page says "Play by play is
  not available as this game was not scored live at the venue". `spectator.playhq.com` is the
  live-scoring service; `api.playhq.com`/`discoverGame` is the canonical record; paper-scored games
  exist only in the latter and have been invisible to every tool we have. Full detail in
  `claude_context.md` ("Added 2026-08-11"). Four of five sampled games from 0%-coverage seasons
  returned full lineups from the canonical record.
- **`discover-game-backfill.js/.yml`** (new): walks games spectator retired (`spcm` set, no `spc`),
  asks `gameView` on the main API, writes the same bare-id `p[]` and marks `dg: 1`. Never writes
  `spc`, never touches `spcm`; its own permanent failures go to `dgm`. Query embedded VERBATIM from
  Mark's browser capture, untrimmed, all six fragments intact (I trimmed it first and caught it).
  Bonus: profiles arrive as full uuids WITH names, so stubs are created already named. Fill-in and
  anonymous participants have no profile and are skipped, counted.
- **Repair tools corrected before first use:** `repair-player.js` and `repair-players-batch.js` would
  have written `hp[]`/`ap[]` stat lines into real crawled games, against the never-pre-store rule.
  Now roster-only. Reasoning recorded at both write sites (see `claude_context.md`, "rosters are NOT
  box scores").
- **Wording correction worth keeping:** I described the sweep as storing "box scores", which alarmed
  Mark into thinking a deliberate architectural decision had been reversed. It had not — the sweep
  wrote `p[]` ids and a flag, nothing else. Say "rosters" or "capture flag"; "box score" means the
  stat lines, which remain Worker-on-demand.
- **The weekly cron** on `spectator-backfill.yml` was commented out 2026-08-08 for the campaign's
  duration and re-enabled 2026-08-11. Anything that aged past the guard during those three days waits
  for the first Saturday run, or one manual dispatch.


**2026-08-07 → 08-10 — THE APPEARANCE GAP: mechanism proven, tooling built, campaign underway; and
three latent failures it exposed, all fixed.**

*The gap — investigation and tools.*
- **§2.2 CLOSED.** `synthesize-missing-games.js/.yml` applied: the 9 profile-proven games written as
  `profileOnly` entries across 3 season files. It ALSO appended 69 players to pre-existing
  `profileOnly` entries across 14 further files (17 written in total) — beyond the briefing I gave
  Mark before he ran apply, owned at the time. The writes were correct (identical provenance, same
  class of capture) and the arithmetic closed exactly: 1,637 API credits − 9 synthesized − 69
  appended = the 1,559 held games left untouched.
- **Mechanism PROVEN** on game `7da945a8`, and the full record is in `claude_context.md`
  (§ "Added 2026-08-10"): stored `p[]` a strict 12-of-19 subset of the live box, PlayHQ's own game
  page showing all 19, capture mid-scoring, round settled, never re-queried. Two of my own claims
  were corrected en route by reading code instead of asserting: such games are NOT "re-queued every
  nightly", and the spectator endpoint does NOT withhold them.
- **Read-only measurement first, as always:** `size-gap-players.yml` (102,609 players / 757,272
  appearances — within 2.4% of the independent 775,703 probe) and `size-resweep.yml` (2,026,441
  target games, rising every year, 152,899 already in 2026).
- **New tools:** `probe-player.js/.yml` (read-only single-player reconciliation, 4-way
  classification), `repair-player.js/.yml` (targeted append, alias-gated), `repair-players-batch.js/
  .yml` (self-ranking, progress file committed every 25 players, dead profiles recorded). Every
  network and classification block byte-identical to `probe-missing-games.js`; `gitCommit` byte-
  identical to `nightly-crawl.js`.

*The campaign.*
- `spectator-backfill` gained `--include-partial` (opt-in; the 2026-08-06 partial-exclusion was
  correct on its evidence and is reversed only for these runs), `--min-age-days` (default 30 — the
  guard is FRESHNESS not lock status; a `--locked-only` default was built and replaced the same day
  after Mark asked why current seasons would be left incomplete), `--miss-attempts` (default 1;
  measured retry conversion 0.003%), `--heal-dangling`, a weekly cron (currently commented out for
  the campaign's duration), and a set-comparison write path that only replaces `p[]` when the id SET
  differs.
- **Crash consistency, after a real loss.** A `max_games=700000` dispatch (~16 h against a 350-min
  timeout) died at ~306k games: game writes were durable per window, but the player phase ran ONLY at
  completion and died in memory, stranding ~306k games' worth of never-stubbed players behind `spc`.
  Owned: the tool was scaled 400× without re-deriving its failure modes, and its own "a timeout costs
  one window" comment — which I repeated to Mark — was true for only half the writes. Fixed: the
  player phase now runs per commit window and commits games + players together. Debt collected by
  `--heal-dangling`: 54,920 games / 86,761 dangling references re-fetched and stubbed, verified by a
  second run reporting **0**.
- **Progress at last reading:** `spc` 158,022 → 725,701; target 2,026,441 → 1,365,259; hit rates
  85–93% in fresh territory; ~14k new players discovered and stubbed so far (each triggering folds —
  13,594 merges in one, 5,702 in another).

*Three latent failures the campaign exposed, all fixed.*
- **T16 was documented and unapplied.** `fold-diverged-players.js` did 82 seconds of work then spent
  1h54m in a per-path `git add` loop (~27,600 invocations) and was killed by its timeout with nothing
  committed, twice. Batched `--pathspec-from-file` with per-path fallback: 809 ms in test, ~4 min
  live. The timeout was blamed first and was not the cause.
- **T26 (new): Node's 1 MB `execFileSync` buffer.** A fold's `git merge` emitted 1,051,036 bytes of
  "Auto-merging" lines, Node SIGTERMed git mid-merge, and an already-made commit was never pushed.
  Reproduced at the exact byte size, then fixed in `fold-diverged-players.js`,
  `spectator-backfill.js`, `repair-players-batch.js` and `nightly-crawl.js` (7 git calls each,
  `maxBuffer` + `-q --no-stat`).
- **T19's burst survived in nightly-crawl.yml.** Both weekly discovery sweeps were dispatched at the
  same instant as post-drain-chain; on 2026-08-09 Discover Seasons spent 51 minutes queued behind a
  41-minute chain and re-attempted twice. Fixed by giving each sweep its own weekly cron
  (Sun/Mon 20:00 UTC), removing both dispatches from the nightly, splitting `generate-shards`' no-op
  `data-write` claim into a `fresh_start`-only job (80 → 40 arrivals per sweep), and handling **T27**
  (cron receives no inputs) at all 12 use sites plus the self-retrigger's forwarded values. A
  tail-chained design was built first and rejected the same day — Mark's suggestion — because it left
  discovery four dispatches deep where any broken link silently skips a week.
- **`fetch-profile-stats-matrix.yml` held NO lock at any level** while three of its jobs commit and
  push — the last repo writer outside the `data-write` group (T25). Locked at the three writing jobs
  only; never at workflow level, because the 20-shard fetch fan-out writes nothing and would hold the
  lock for the whole sweep.


**2026-08-07 (later) — §1.2, §2.7 and §2.8 CLOSED.**
- **§2.8 settled by measurement, not history-reading:** Mark supplied two historical commits of
  fetch-profile-stats-matrix.yml (fb88a90, ca568de) — the helper is byte-identical across both and
  the current file: 1,046 UTF-8 bytes / 1,032 characters in every version examined. **The helper
  never changed; the 1,452 figure never corresponded to any state of the text — it was wrong when
  recorded.** build-team-stats.yml's comment corrected to 1,046 by Mark.
- **§1.2 done** (Mark): zero-team-seasons.json renamed to data/.
- **§2.7 done, by moving the DISPATCH POINT rather than the flip:** graduate-seasons is now
  dispatched from post-drain-chain.yml's tail (parallel with the Deploy Pages dispatch, same
  ancestry gate), and the nightly's graduate job is removed. The flip's lock request therefore
  always arrives after the chain has released data-write — the last waiter that could share the
  one-slot pending queue with anything is gone. A data-handoff design (feeding verified sids INTO
  the chain) was rejected: the chain has two dispatchers and graduation's verify takes ~40+ min,
  so a handoff creates ordering and double-run problems the dispatch move avoids entirely.
  Graduation stays unconditional; a failed chain night skips it and the 28-day grace makes the
  one-night delay irrelevant. Gate matrix re-run with the new job: correct for all start_at values
  and failure propagation.

**2026-08-07 — THE ACTIVE/LOCKED SPLIT: designed, measured, built, executed, and PROVEN in one day
(closes §2.1 and §1.1); T19 structurally fixed (post-drain-chain); StatTrack 0.74.**
- **Design settled with Mark before any build:** ACTIVE + ARCHIVE Pages origins, both built from
  this repo's checkout, zero data migration, zero writer changes (one maintenance-tool amendment).
  Key decisions: graduation is automatic from the nightly at terminal drain; **28-day grace** after
  `lockedAt` before a season may graduate (central variable: the `grace_days` input default in
  graduate-seasons.yml — deliberately the ONLY site, so it can never drift); `archivedAt` is a
  statement of VERIFIED FACT (set only after the season's file was probed live on the archive), so
  "index says archive but archive lacks it" is unreachable; **union inclusion rule** on the archive
  (locked OR archivedAt) so no flag state can strand a season off both origins — Mark's probing
  question found that hole in the first shipped version, fixed same day; failed verifications keep
  serving from ACTIVE and self-retry nightly (candidacy = absence of the flag), with a RED status
  job so persistent failure can't rot silently; weekly unconditional archive redeploy (Sun 04:00
  AEST) caps backfill staleness at a week.
- **Measured before built** (size-locked-split.yml, read-only): locked share **81.2%** overall
  (82.6/80.1/79.9 by directory), inside the 75–85% estimate. First delivery aborted on the real
  sports-index (my shape detection guessed wrong — `.seasons` is an OBJECT keyed by 8-char short
  ids, exactly as README's schema showed all along); corrected version classified every file, both
  warning buckets empty. Method note: script reports MiB; the reference table is decimal MB —
  converting closes most of the apparent 6–8% gap.
- **Archive origin live:** `markjovic/sports-players-stats-archive` (one workflow + README, no data,
  ever — the site is the artifact, built from THIS repo's checkout). First deploy 447,902,548 bytes,
  landing inside the projected 440–450 MB. deploy-archive-pages.yml: dispatch + weekly cron, union
  rule, refuses to build empty.
- **Graduation #1 green:** graduate-seasons.yml selected the full locked corpus past grace,
  dispatched + polled the archive deploy cross-repo (ARCHIVE_DISPATCH_PAT), probed every candidate
  live in parallel, flipped `archivedAt` under a JOB-level data-write lock (deliberately not
  workflow-level: the run spends ~40 min waiting, and a waiting workflow-level lock would sit in
  T19's one-slot queue), committed once with the repair-aliases push pattern, dispatched Deploy
  Pages. Exact counts in the run log.
- **The number: Deploy Pages artifact 763,124,203 bytes** (#89) vs last pre-split success
  1,210,614,006 — 447.5 MB stripped, matching the archive artifact almost byte-for-byte. Headroom
  ≈ 447 MB; residual growers are players/ + search/ + venue-lookup only (per-season dirs now stay
  ~flat: seasons graduate out). Archive has room for ~7 more annual cohorts before era-sharding
  (future design; StatTrack's `seasonBase()` is the ready choke point).
- **T19 STRUCTURAL FIX — post-drain-chain.yml** (closes the owed rebuild of the matrix terminal):
  team-stats(--active-only) → venue-indexes → search → records → leaderboards(bare) → Deploy Pages
  dispatch, sequential jobs in rebuild-chain's proven shape (workflow-level data-write, ref:main,
  full-ancestry single-line gates — gate matrix executed for all six start_at values + failure
  propagation), fold dispatched fire-and-forget after team-stats (queues behind the chain's own
  lock as the LONE waiter — the 2026-08-04 ordering with nothing left to evict it). Matrix terminal:
  four-dispatch burst → ONE chain dispatch. Nightly: venue-indexes job REMOVED (the matrix-storm
  contention is gone at the source; the 240-min backstop travelled with it into the chain);
  mirror-gate job added — matrix-skipped nights (which previously ran NO post-drain builds and fired
  NO Deploy Pages trigger at all, leaving the crawl unpublished) now dispatch the chain directly at
  terminal drain. Chain #1: green, 38 min; fold #32 green after waiting out the lock; Deploy #88
  cancelled BY DESIGN (fold's workflow_run deploy #89 superseded it in the `pages` group — the
  documented collapse, one deploy capturing everything). Interim one-at-a-time manual dispatches:
  retired.
- **StatTrack 0.74** (canonical + mirror): `seasonBase(sid)`/`sgj(dir,sid)` route the 11 per-season
  fetch sites by `archivedAt`; one-shot 404 fallback on the other origin (functionally tested
  against two local origins, both stale-index directions + missing-everywhere). LOCKED pill + muted
  name on season cards, padlock on fully-locked picker groups — keyed on `locked` ONLY; where a
  season is SERVED from stays invisible. Bonus closure: the deployed file checks `rec.private===true`
  (not the placeholder-name pattern) — the standing private-flag verification is DONE, no change
  needed.
- **scan-complete-rounds.js `--unlock` now clears `archivedAt` in the same write as `locked`**
  (split invariant: both routing flags move in one commit), prints the T23 dispatch-Deploy-Pages
  reminder; unlock + dry-run paths executed against a fake root.
- **§1.1 CLOSED:** the expanded strip shipped, and deploy-pages.yml additionally strips archived
  seasons' files (structural-failure aborts; zero-archived = no-op).
- **Doc corrections landed the same day:** REPO_MANIFEST's leaderboards row claimed "--active-only
  nightly" — FALSE; the terminal's `force=false` dispatch runs the script BARE (resume, full scope);
  --active-only belongs to the WEEKLY finals chain only (the live workflow's header even corrects an
  older version of the same false claim — reading the live file prevented shipping the wrong
  invocation in the chain). gh-dispatch.sh is 1,046 bytes / 1,032 characters (not the recorded 1,452 — see §2.8), proven identical
  across all seven live instances. the pending playhq_api_reference correction
  (`gradePlayerStatistics` pagination) turned out ALREADY DONE — the July 2026 correction is in the
  header note, the section, and the limitations table; the open item was stale, closed by
  verification not by editing. Deploy Pages trigger location now recorded precisely (workflow_run on five
  workflow NAMES — a gap that cost a session detour).
- **Not our bug:** nightly #61 died at runner acquisition ("job was not acquired") during a
  confirmed GitHub Actions/Pages outage — nothing started, nothing to clean, recovered by re-run.

**2026-08-06 (evening) — post-backfill rebuild chain SHIPPED and RUN; Pages hit its ceiling; the
recovery and the split direction settled.**
- **rebuild-chain.yml** built in the nightly's shape (six needs-chained jobs, workflow-level
  data-write lock, ref:main everywhere, start_at resume input, Deploy Pages dispatched at the tail
  via the verbatim retry helper). Building it caught two of my bugs pre-delivery: three gates
  written as folded >- scalars (trap T1, the proven folded-scalar failure) and gates that checked
  only the direct parent, which would let the chain resume itself past a failure two steps up —
  the exhaustive 42-case gate matrix caught it; every gate now checks full ancestry. The chain ran:
  player-games, win-loss FULL, finals FULL, search, leaderboards force all green.
- **Deploy Pages then failed at the artifact limit.** Established empirically across #79–#82:
  successes at 1,210,614,006 and 1,210,625,974 bytes, failures at 1,211,586,679 — the chain's ~1 MB
  of growth crossed a real cutoff sitting just above the last success. I argued "today didn't push
  it over" and fabricated a failure status for run #80 to support that; Mark corrected both. The
  artifact size prints in every deploy log — the growth curve is free to read.
- **Composition measured** (size-pages-artifact.yml): players 553M, games 260M, team-stats 159M,
  leaderboard 126M, venue-lookup 66M compressed — 97% of 1.2G. StatTrack's fetch list (grepped from
  0.73) proves every large directory is served; never-fetched content totals ~1 MB.
- **Recovery shipped:** deploy-pages.yml strip expanded to the full never-fetched set (~800 KB–1 MB
  vs the 973 KB gap — a days-long bridge). zero-team-seasons.json found in root against the repo's
  own data/ convention (the re-sweep wrote it there — my miss); rename queued, strip covers both.
- **Split direction chosen by Mark: ACTIVE vs LOCKED origins** (not the flat directory split I
  first proposed) — locked data's immutability makes the archive origin near-static and stops the
  active site growing at all. Design work is §2.1; nothing gets built before it's approved.

**2026-08-06 — the appearance-gap investigation CLOSED: measured, understood, and fixed exactly as
far as the design allows.**
- **The finding, in one paragraph:** PlayHQ counts ~776k appearances (2.7% of 28.4M) that our game
  rosters don't name. Four measurements and one probe established why: rosters are written by the
  spectator step, the spc flag is younger than most of the data (149,578 of 2.34M games carry it),
  and the probe's 100/100 sampled cases were all games whose roster the spectator step had never
  completed — no alias problem, no missing games (9 exceptions). The gap concentrates in tournament
  and representative players (VJBL, country tournaments).
- **What was fixed:** `spectator-backfill.js` (+yml) ran the nightly's own spectator step — thirteen
  blocks copied byte-identical — over the 23,772 games with NO roster at all: **7,844 games gained
  rosters, 26,944 players touched, 2,073 ids alias-folded, 1,095 new players stubbed**, 35 minutes,
  progress committed every 2,000 games, no progress file. The 15,928 misses are games spectator has
  nothing for (paper-scored era); left unmarked, faithful to nightly semantics. **CONFIRMED by a
  second full pass (2026-08-06): 0 hits of 15,928 — permanently dead. The tool's queue is now
  exactly this dead set; do NOT re-dispatch spectator-backfill, there is nothing left to gain.**
- **What was deliberately NOT fixed:** the 2,026,432 games with partial rosters. The first backfill
  draft queued all of them; Mark rejected it — rewriting two million working rosters to chase a 2.7%
  gap is churn the design exists to avoid, and spc's ABSENCE does not mean unprocessed on old games.
  The queue rule is now "no roster at all", stated in the script with the rejected number.
- **Fabrications owned along the way:** a "merged registrations" story for a player whose PlayHQ
  page fails to load (retracted — outcome-based invention; tournament players genuinely do play 11
  associations in a year), and a 1.9 GB repo-growth figure that ignored git delta compression.
- **Probe evolution:** probe-missing-games took three passes to report what one should have — game
  absent vs player-absent-from-roster vs present-under-another-id. The final version checks all
  three per game. Four scan dispatches were spent where two were needed; counted honestly at Mark's
  insistence.

**2026-08-05 — post-sweep rebuild chain complete; finals performance SHIPPED; three self-inflicted
failures turned into traps T22–T24.**
- **Post-sweep rebuilds all run:** build-win-loss FULL (244,736 players updated — every regraded
  career repaired; **Toby verified live: 51W 48L 1D, W+L now equals his 99 GP**), build-player-games,
  build-finals-stats FULL, Build Single-Game Records (2,311,974 games checked, 745,513 with box
  scores — the 23k swept games record-scanned for the first time), Build Team Stats FULL, Build
  Search Index, Build Leaderboards. Leaderboards `force` still queued (§1.2).
- **Finals performance SHIPPED and verified on screen (StatTrack 0.73):** 5 GP / 12 PTS / 2.4 PPG /
  0 3PT / 9 F / 4W 1L (80%) against a 4.7 career PPG. **Design correction worth keeping:** I first
  proposed storing box scores for all 122,319 finals games (~200MB). Mark's screenshot of per-game
  stats in an expanded season disproved the premise — StatTrack ALREADY fetches box scores per game
  from the Worker (`fetchBox(gid)`). The shipped design instead stores only the finals GIDS
  (~45 bytes/player) and hydrates client-side, exactly the 0.65/0.66 opposition pattern. Zero
  storage cost; the backfill is unnecessary.
- **Finals data model (build-finals-stats v3):** career `finalsStats {gp, boxedGp, pts, threePt,
  fouls, wins, losses, draws, gids}` + per-reg `fstats {gp,bg,pts,tp,f,w,l,d,g}`. W/L attributed from
  scores + side (complete today); `boxedGp` is the honest denominator for scoring rates — box lines
  exist for ~0.15% of games (10 of 6,501 in a live season file), so unboxed players render "—" and
  never fake zeros. Forfeits excluded from finals GP.
- **StatTrack 0.69 → 0.73:** 0.69 regrade dedupe in season rows (per-stat MAX across same-tid
  siblings); 0.70 finals panel; 0.71 single-row layout, no Career repeat, dashes not zeros;
  0.72 column-aligned with the career strip (`.cstat` is `flex:1` — alignment IS cell-count parity,
  so the finals row mirrors the strip's conditional cells with blanks); 0.73 client-side box-score
  hydration.
- **T22 — the 110MB progress file.** `build-finals-stats` committed its entire serialised map every
  checkpoint; v2's wider fields pushed it to 110.14MB, past GitHub's hard 100MB limit, killing a full
  run — and the 60-attempt push retry burned every attempt on a permanent rejection. Fixed: progress
  mechanism REMOVED (pure local compute; `build-player-games` had it right), legacy file's deletion
  staged, and size-limit/GH001 rejections now fail fast (0.1s, verified against a real pre-receive
  hook).
- **T23 — a commit is not a publication.** Pages deploys only when the Deploy Pages action runs, and
  it is chained to the SCHEDULED nightly. Correct data sat on main for hours while StatTrack served
  the morning's snapshot; it produced three phantom "the feature is broken" investigations before
  the cause was found.
- **T24 — the tautological scan.** `size-missing-gids` compared `player.games[]` to `games/bv` and
  returned 0 because `build-player-games` generates the former from the latter. Designed from an
  assumption instead of from reading the 200-line builder. Replaced by `size-appearance-gaps`
  (independent sources) and `size-spectator-queue` (direct count, no estimation).
- **venue-indexes timeout:** the 08-05 nightly's venue job did all its work and was killed at
  `timeout-minutes: 15` before committing (full checkout ~7 min + a rescan grown by the sweep's
  23k games). Fixed 15 → 45 in `nightly-crawl.yml` — commit queued at §1.1.
- **Fold ordering fix VERIFIED:** Fold #29 ran green for 55m, dispatched when Build Team Stats
  finished — no 4-second cancellation. T19 closed in practice.
- **NEW regression found by Mark:** inappropriate season medals → §2.4 (root cause identified,
  fix deliberately not built same-day).

**2026-08-04 — Fold eviction found+fixed (T19); regrade double-count struck twice more (T20);
finals-performance feature shipped; re-sweep launched; §2.1 first observation clean.**
- **§2.1 Tuesday observation: NO overlap** (details in §2.1). One more clean Monday closes it.
- **Fold queue-eviction (Mark's find, T19):** Fold cancelled in 4s at fan-out, 2/2 nights since
  the 08-02 hardening — the `data-write` pending slot holds ONE run and a new arrival cancels the
  waiter; `cancel-in-progress:false` protects only the RUNNING slot. Timeline proof: greens
  #22–#26 through Aug 2, cancellations #27/#28 from the first post-hardening fan-outs. Recorded as
  caused-by-the-hardening (the reliability work made the racers show up), found-by-Mark. FIX
  (ordering over locking, delivered 08-04): Fold removed from the matrix terminal fan-out;
  `build-team-stats.yml` gains `chain_fold` (robust boolean gate, success-chained, retry helper
  byte-identical 1,452); matrix passes `chain_fold=true`. Edit base proven current: the same four
  edits re-applied to Mark's fresh upload reproduced the delivered file byte-for-byte. Residual
  stated honestly: eviction still possible if another data-write dispatch arrives while Fold sits
  pending (Sunday's backfill self-retrigger) — occasional loss for a nightly-retried job vs the
  deterministic every-contended-night loss. Verify: tonight's fan-out (§1.2).
- **StatTrack 0.69 (regrade double-count in season rows, Mark's find):** `groupRegs` survived a
  prior fix but the stat cells regressed to a SUM across same-tid siblings — which carry IDENTICAL
  season-cumulative blocks (live specimen: gp:13/pts:99 stored twice → rendered 26/198). Fixed
  with per-stat MAX across the tid group (identity for singles/synced siblings; the T18-documented
  resolution otherwise); comment now ends "Do NOT change back to a sum". Verified by extracting
  the real reduce and running it over the specimen: all 7 season rows exact. Rule-14 W/L (regs[0])
  was never affected — it sat 8 lines below the bug.
- **build-win-loss.js career totals (Mark's find — same class, server side, BOTH modes):** career
  accumulation iterated per REG over records keyed per (sid,tid) — every regraded season counted
  twice, and active-only deltas DOUBLED nightly increments, compounding. Toby: stored 85W/70L;
  true 51W/47L/1D (= exactly his 99 GP). Fixed once-per-(sid,tid) both modes; per-reg writes
  unchanged (siblings stay identical; 0.69 handles display). E2E-proven in a synthetic repo with a
  real origin: full mode 3W1L not 5W2L; delta applies a new win once. **A FULL run repairs stored
  careers (§1.4) — deltas only stop the compounding.** Third strike of the class → trap T20.
- **Finals performance vs career (the "turns it on" USP):** `build-finals-stats.js` now also
  writes per-season `reg.stats.fstats={gp,pts,tp,f}` and career
  `sports.Basketball.finalsStats={gp,pts,threePt,fouls}` from finals games' hp/ap box lines,
  FORFEITS EXCLUDED from GP (a forfeited final deflates finals PPG); appearance basis deliberately
  widened p[] → p[]∪hp∪ap (a box line is proof of appearance). Active-only preserves AND folds
  locked-season fstats exactly like the flags; locked-only players get their block at the next
  FULL run (§1.4), same scan-scope rule as always. E2E-proven across forfeit/hp-only/locked-fold
  cases. **StatTrack 0.70:** "Finals performance" panel — Career vs Finals across GP/PPG/PTS/3PT/F
  with the verdict line (🔥 "+2.6 PPG in finals vs career" / muted shrink); renders nothing until
  the data run, so it ships safely first. Real function extracted and executed across all four
  render cases. **Career-high explore answered, not built:** `records.maxGamePTS/maxGameThreePt`
  already carry value+gameKey+sid on every player file — chips + existing game-detail sheet are an
  HTML-only feature whenever wanted; fold into a later release, not 0.70.
- **§2.3 opened** (W/L lag — evidence and suspects in §2.2/§2.3; fixtures-sweep theory disproven).
- **Re-sweep launched** (§2.2 status) — hardened discover-fixtures deployment proven by its own
  run log. Runtime question answered for the record: WAF-bound, not code-bound.

**2026-08-03 (second pass) — §2.2 backfill SCOPED; StatTrack + §D8 closed; README staleness sweep.**
- Historical/locked-season backfill scoped end to end (§2.2): Phase 0 read+measure (team-id source
  for file-less seasons is THE open question, settled from code; sizing script with samples),
  rehearsal, resumable batched sweep, full derived rebuilds, audit + re-measure. The July
  lock-writer→unlock-489 plan is expected obsolete — the tool fetches locked seasons directly.
- StatTrack backlog CLOSED (Mark). Past-chat verification: the "openOpp not wired" claim was
  disproven from the deployed file on 2026-08-02 (wired at the opponent-name tap, L1087) — the
  backlog entry should have died that day and did not. 0.65/0.66 shipped the opposition feature's
  substance client-side.
- **§D8 CLOSED (Mark): repo size does not block publishing.** The one confirmed size cost remains
  code search. History squash / R2 demoted from prerequisites to optional pre-AFL choices.
- README.md full staleness sweep (~25 corrections, every one traced to a dated event): counts to
  the 08-02 audit; StatTrack row to 0.68; season-name contamination row to RESOLVED (bounded
  name-heal retry, §B3); legacy rows to final-state-3; publishing row closed; team-lookup proven
  GONE by file-count arithmetic (527,900 total < 412k players + 355k team-lookup — the "not yet
  removed" note was weeks stale); the 07-09 migration checklist marked all-closed; scripts table
  fixed (deleted backfill/one-off cluster was listed as live; repair-season-names carried "Run
  pending" three weeks after running to completion 07-13; build-player-games and build-records are
  ESM not CJS; finals/leaderboards/discover-fixtures rows moved to the Monday-chain reality) plus
  an authority pointer to REPO_MANIFEST §2; long-standing list resolved (opposition index RETIRED
  entry propagated; lock-writer/489/tournament/no-rn folded into §2.2; the Pages deploy-trigger
  item was marked the untouched survivor and then CLOSED the same day — Mark confirmed an explicit
  Deploy Pages action is chained in the scheduled runs); maintenance schedule's "after each finals
  series" row replaced
  with the Monday chain. `discover-reduce-manifest.json` presence remains UNVERIFIED — one web-UI
  check closes it either way.

**2026-08-03 — discover-seasons-matrix strip-and-harden DELIVERED (commit pending §1.1); T1
narrowed; residue files closed.**
- `.github/workflows/discover-seasons-matrix.yml`: gen-step VERBOSE block and the entire
  `verify-output` job deleted (both served the 2026-07-09 fan-out diagnosis, closed the same day);
  the self-retrigger — the sixth and last bare chain-critical `gh workflow run` in the repo —
  converted to `/tmp/gh-dispatch.sh`, copied from `fetch-profile-stats-matrix.yml` and ASSERTED
  byte-identical (1,452 bytes) at build; job-level `GH_TOKEN`/`GH_REPO` env per the reference,
  `--repo` moved into the helper; field list unchanged (shards deliberately still not forwarded —
  generate-shards recomputes from the progress file).
- Two conformance defects found by the full read and fixed in the same pass — documented house
  rules with proven failure modes, not refactors: (1) `reduce` + `retrigger` gated `always()` →
  `!cancelled()` (stop-button — the 2026-07-21 audit fixed the stats matrix and its "audit other
  matrices" item never reached this file; until now, cancelling this chain did NOT stop it);
  (2) the retrigger's `inputs.dry_run != 'true'` against a `type: boolean` input — the
  directive-13 NaN coercion, so the gate could never block a dry-run's retrigger — now
  `!(inputs.dry_run == true || inputs.dry_run == 'true')`, single line.
- Stale header comment corrected: it still claimed an "object array" output and a `!= '[]'` gate,
  neither true since 2026-07-09.
- Verification EXECUTED before delivery: yaml.safe_load; every `if:` value repr()'d and asserted
  newline-free (T2); zero-context diff proving every hunk sits inside the four edit sites;
  generate-shards still a true root job; map has no custom `if:`; outputs/fromJson plumbing
  byte-identical; step-level `always()` on the shard artifact upload deliberately KEPT; no
  setup-node anywhere.
- `claude_context.md` T1 NARROWED (the trap candidate above, applied).
- §2.2 residue files closed (Mark, web UI, prior to this session).
- §2.1 first observable window is tonight; checklist embedded in §2.1.

**2026-08-02 — §2.1, §2.2, §2.5, §2.6 all closed; §1 emptied. Every claim below was executed,
not reasoned.**

**[archived §2.4] — db-audit §11b file ages meaningless in CI.** **CLOSED 2026-08-02, proven by
the live 06:07 run.** Both `ageDays` sites replaced: file SIZE for dotfiles and off-list reports
(truthful from statSync however the tree arrived, and the actionable number for residue), ENTRY
COUNT for off-list directories (a dir's own stat size is filesystem noise). Verdict paths
untouched — orphan-vs-owner stays a name match, keep-list stays membership. The doc's suggested
alternative was itself a trap, now recorded in the section comment: `git log -1 --format=%ct` on
db-audit.yml's fetch-depth:1 checkout sees ONE commit, so every file reports the same age — the
same lie with a different constant. §11b executed in isolation against all five hygiene cases
before delivery; the live audit's `98 B` / `3.4 MB` / `8/10` lines are the deployment proof.
Deliberately NOT added: a `legacy + UPCOMING` invariant — nothing writes the flag, the class
cannot recur without a new writer, and a check that can never fire is the unreachable-✅ noise
this same script removed on 07-31.

**[archived §2.6] — Bare `gh workflow run` dispatch sites.** **CLOSED 2026-08-02 — and the count
was SIX, not the four this file recorded.** The two it missed were chain-critical:
`discover-fixtures.yml`'s chain-stats dispatch (the Monday chain's SECOND hop — a 500 there lands
the fixtures and silently skips both stat rebuilds, run green) and `discover-seasons-matrix.yml`'s
self-retrigger. Five of six converted to the `/tmp/gh-dispatch.sh` helper, copied VERBATIM from
`fetch-profile-stats-matrix.yml` (asserted byte-identical, 4x + 1x): all four sites in
`nightly-crawl.yml` and the chain-stats hop in `discover-fixtures.yml`. Every job-level `if:`
asserted byte-identical to the deployed file; every `--field` name checked against the target's
declared inputs (the helper fails FAST on 4xx, so a wrong field name would turn a transient retry
into a hard stop). The helper itself was EXECUTED against a stubbed `gh`: 500x2-then-success
dispatches on attempt 3; a 422 fails in one attempt; exhaustion throws after 10. One behaviour
change: the matrix dispatch builds its args as a bash array (the old unquoted `$shards_arg` would
word-split JSON containing whitespace; byte-identical for well-formed input).
**The sixth site — `discover-seasons-matrix.yml` L319's self-retrigger — is DELIBERATELY still
bare:** that file also carries the verbose debug scaffolding the manifest says to strip, and the
retry fix was not folded into an unrelated 40-line deletion. Convert it when the scaffolding goes.
**(DONE 2026-08-03 — converted in the scaffolding-strip pass, exactly as specified here. See the
§4 top entry.)**

**[archived §2.5 + §2.1] — Measure the 142 legacy survivors; decide the classifier question.**
**CLOSED 2026-08-02 — measured, and the answer killed the classifier question outright.**
`find-flag-collisions.js` Part 4 (new: active/locked split + month histogram, run live over
2,311,828 games): **139 of 142 in ACTIVE seasons, and every one `st=UPCOMING`** — the old
classifier had probed FUTURE FIXTURES, got nothing back (correctly; they hadn't been played), and
stamped them "pre-history, nothing further obtainable". The other 3 (2021x2, 2023x1, all FINAL,
scoreless, LOCKED) are the flag's entire legitimate population. The `no-locked-field` and
`not-in-index` buckets — reported separately because nightly-crawl (`locked === false`) and
db-audit (`!locked`) read an absent field OPPOSITELY — were both ZERO.
**§2.1 DECISION: no classifier rebuild.** Lifetime record: 3,262 games stamped, 3,114 held scores
(repaired 08-01), 139 were future fixtures (repaired 08-02), 3 correct — a 0.09% hit rate.
No-flag is the terminal state; the spec text already reads ASPIRATIONAL.
**Repair applied 2026-08-02:** `repair-legacy-flags.js` gained a second clear criterion —
`flagFalsified(g) = hasScore(g) || g.st === 'UPCOMING'` (strict equality; absent `st` clears
nothing) — applied at all three sites (clear decision, disk post-check, report). Dry run and
apply both read **139 cleared / 3 kept / 3 files**, matching Part 4's prediction exactly from two
independently written scans. Without this, each of the 139 would have become a fresh
`legacy + score` violation as it was played (T11 — `applyRoundFixtures` preserves flags),
drip-feeding the audit red for a month, and StatTrack 0.62 was rendering all 139 UPCOMING games
as "Data unavailable" (its guard is legacy && no score). The legacy population is now EXACTLY 3,
permanently: no writer exists, and the survivors are unreachable by design.

**[archived §2.2] — One forfeit record disagrees with its own scoreline.** **CLOSED 2026-08-02 —
probed live, repaired, W/L never contaminated.** Precondition settled from CODE, not the field
name: both writers (`nightly-crawl.js` L686, `recheck-forfeit-games.js`) write `fo` = the
WINNER's team id. `diagnose-forfeit-game.js` (new read-only probe; plumbing copied verbatim from
`recheck-forfeit-games.js`, verdict function driven through a 15-case matrix including the real
record) probed `discoverGame(ba9d21fe)` live: **outcome=AWAY_TEAM_WON_BY_FORFEIT, winner=AWAY** —
`fo` was RIGHT, the 10-0 scoreline was the stale half, via nightly-crawl L659's entry-build
(hs/as only overlay when non-null, so a stale score rides beneath a fresher forfeit/fo — the same
preserved-field class as the legacy flags). `repair-forfeit-score.js` (new one-off; winner derived
from the record's OWN verified `fo`, never from an input; refuses non-forfeits and unusable fo;
idempotent; key-diff + count guard + disk post-check) applied **10-0 -> 0-20** (winner-20/loser-0,
the exact convention `recheck-forfeit-games.js` scans for). `forfeit`, `fo` and the
forfeit-games.json membership were correct and untouched. **W/L was never affected:**
`build-win-loss.js` L55 `if (g.forfeit) return null;` — forfeits contribute nothing to W/L/D
regardless of scoreline, read from the uploaded file. Both tools kept as on-demand: the probe
answers any single game, the repair fixes any forfeit whose fo is verified.

**[archived §1.1] — Three T12 verifications.** **CLOSED 2026-08-02.** Leaderboard keys
two-segment in live data (rebuild ran); `weekly-future-fixtures.yml` `on:` block read — no
`schedule:`, dispatch only. StatTrack copies are Mark's own process and are not tracked here.

**Trap candidate for claude_context, NOT yet applied — T1 is OVERBROAD as written.**
**APPLIED 2026-08-03** — `claude_context.md` T1 replaced with the narrowed form: proven failure =
folded `>-` scalar with uneven continuation; the four working `if: |` gates explicitly fenced off
from "fixing"; new gates single-line + T2 repr verification. Original statement kept below: All four
job-level gates in the deployed `nightly-crawl.yml` are `if: |` block scalars containing literal
newlines, and the `retrigger` gate demonstrably WORKS (were it a truthy literal, every drained
nightly would re-dispatch itself forever with new_zeros=0 and never reach the 3-zero halt). T1's
actual failure case was a `>-` FOLDED scalar with a more-indented continuation line. The trap
should be narrowed to that form, or someone will eventually "fix" four working gates — the edits
this session deliberately left all four byte-identical for exactly that reason.


**[archived §2.2] — Two duplicate regs REFUSED by the merge, both `foulOuts` splits.** **CLOSED 2026-08-01 —
resolved to 2 by `repair-reg-sibling-sync.js`, which groups by `tid` alone and had no way to know the
refusal was deliberate. Decided by execution order rather than by anyone; see trap T18.**
`5d5a48b3…` sid `15908988` tid `db8e6d2e`, and `a211e03a…` sid `2e623bd2` tid `778908f5`. Every other
field is identical; one copy holds `foulOuts:2`, the other `foulOuts:1`. In all 27,664 clean merges the
pattern is foulOuts present on one copy and ABSENT from the other, so max == sum. These two are a real
split, and the answer depends on whether one copy is simply behind (max = 2) or the events were divided
between the regs (sum = 3). The merge refused rather than guessing. Impact: 2 players, ±1 foul-out,
out of 412,058. Left as-is deliberately.


**Moved here from §1/§2 on 2026-08-01** — these were sitting in the open sections marked CLOSED
rather than being moved, which is the wrong place for them. Full text retained:

**[archived §1.1] — Let one nightly run.** **CLOSED 2026-08-01 — green, and the change is VERIFIED, not just
un-broken.** Every commit printed both new markers (`staging: N files changed…` and
`(pushed on attempt N)`), so the deployed file is the new one. No `⚠ git add failed`, no
`(no changes to commit)`, no contention retries. `Games remaining: 0`, 12,084 rounds, 3,512s.
22,761 `statsChecked` cleared across all 256 shards is ~89 per shard — random distribution, NOT the
07-30 gate failure, which was 413,364.

**[archived §1.2] — Run the repairs.** **CLOSED 2026-08-01.** Rehearsed on `017feb6a` (6 games), then applied:
3,114 cleared, 142 kept, 329 files, post-check 0. Audit confirms `Flag collisions ✅ none` and
`legacy + score ✅ none`. See §4.

**[archived §1.1] — MEASURE THE REGRADE RISK.** **CLOSED 2026-08-01 — MEASURED, AND THE ANSWER WAS
"DUPLICATED". `build-leaderboards.js` has been REVERTED to `uuid|tid`.**
Regrade regs hold the SAME team-season totals on every grade: of ~913,000 groups, 744,117 are
byte-identical and the 169,230 that "differ" differ ONLY in `foulOuts`, which lands on whichever copy
the foul-out writer matched first — `gp/pts/fg/ft/threePt/fouls/wins/losses` agree across grades in
every sample. So the API reports per-TEAM season totals and repeats them per grade registration.
Keying by grade produced two identical leaderboard rows per player, and the ASSIGN it replaced was
losing nothing. **Re-dispatch the leaderboard rebuild after committing the revert.**
⚠️ **This one shipped before it was measured** — flagged as an open risk and built anyway. The v5
classifier then reported SPLIT/DUPLICATED without saying WHICH keys differed, so the first read of it
was wrong too; v6 reports a key histogram and a CORE-field count, which is trap T15 applied one turn
after writing it. Original statement of the risk: Dispatch `audit-seasons-gaps.yml`; v5 answers it
under "§1.1" in the Q1 output. Read the two lines:
`SPLIT (different stats per grade)` non-zero and `DUPLICATED (identical totals)` **zero** -> the key
change is CORRECT and recovered data the old `uuid|tid` key was silently overwriting; mark this closed.
`DUPLICATED` non-zero -> revert `build-leaderboards.js` to `uuid|tid` and re-dispatch the rebuild.
Original statement of the risk: Under decision A a regraded team is two regs. Before the
change, L340 ASSIGNED on `uuid|tid`, so the second reg silently overwrote the first and one grade never
reached the season leaderboard. After the change both survive as separate rows. That is correct **iff
regrade regs hold SPLIT stats** (e.g. 5 games in grade A, 10 in grade B). **If instead they hold
DUPLICATED team totals** (both saying gp=15), the change produces TWO leaderboard rows for one player
with identical stats — worse than the overwrite it replaced.
1,296,352 regs share a tid with a sibling across 929,597 seasons, so this is not a corner case.
**Built 2026-08-01** — `audit-seasons-gaps.js` v5 now applies the same stats comparison to REGRADE
groups and reports SPLIT / DUPLICATED / only-one-grade-has-stats, with samples of each. Tested against
all three classes. Still worth eyeballing one regraded player in StatTrack after the rebuild.

**[archived §1.2] — `dry_run` DOES NOT WORK in `nightly-crawl.yml`, and it is the tool you would reach for to
test safely.** Eight jobs are gated `if: ${{ inputs.dry_run != 'true' }}` against an input declared
`type: boolean`. GitHub coerces mismatched types to numbers for comparison: `true`→1, `false`→0, and
the STRING `'true'`→**NaN**. Nothing equals NaN, so `!=` is ALWAYS true and every gated job runs
regardless. `team-stats` has no guard at all.
**Consequence: a dry run writes team-stats, win-loss, team-index, venue-lookup and venue-indexes, and
dispatches the matrix.** The only guard that works is the bash one inside the crawl step
(`[ "${{ inputs.dry_run }}" = "true" ]`), because bash renders the boolean as the string `true` —
trap T3 demonstrated correctly once and incorrectly eight times in one file. Fix is the documented
robust form: `inputs.dry_run == true || inputs.dry_run == 'true'`. **CLOSED 2026-08-01 — the input was DELETED**
rather than fixed (Mark's call: the crawl is idempotent and never needed a dry run). Removing it changed
no runtime behaviour, because the gates never worked and the jobs already always ran.

**[archived §1.2] — Decide: soften the new `gitCommit` guard.** **CLOSED 2026-08-01 — made PRECISE rather than
softened.** The guard throws when an add fails and nothing else staged. Softening it wholesale would
have reopened the silent-loss door it exists to shut. Instead `nightly-crawl.js` now distinguishes the
two failures: with PER-PATH adds a pathspec that "did not match any files" is provably harmless — it
staged nothing AND, unlike the old combined add, took nothing else down with it. That is the ordinary
case for an optional path such as `needs-matrix-shards.json`, which the script deletes when there are
no affected shards and which a forward-mode run legitimately never recreates. Any OTHER add error
(permissions, locked index, corruption) still throws. Both branches proven against a real repo.
The repair scripts keep the strict guard deliberately: they are operator-run one-offs whose paths are
files they just wrote, so a non-match there means something removed them mid-run — which IS alarming.

**[archived §2.2] — `player.seasons[]` is incomplete for some players.** **CLOSED 2026-08-01.** It was not one
defect; it was three, and the 218 was a 5%-of-corpus slice of the least important one.

**(i) The seasons gap is real, small and mostly PERMANENT.** Measured across all games, not just finals:
**4,361 player+season pairs** — 1,189 where the sid is absent from `seasons[]`, 3,172 where it is present
with an empty `regs[]`. **97.6% are in LOCKED seasons**, unreachable by both writers forever: the
nightly's reg-discovery is one-shot per game (`!game.spc`) and active-seasons-only, and the matrix can
only add seasons the API reports. Just **105 are active**. The finals subset was exactly **218**, an
exact match with `build-finals-stats.js` from two independently written scans. `build-finals-stats`
already handles it correctly by trusting the game scan (L383), so this needs no repair — it is a known
floor, recorded here rather than fixed.

**(ii) 110,232 regs carry a null `gid`** — `publicProfileTeams` returns `grade=NULL` for COMPLETED
registrations and `discover-seasons.js` wrote it straight through. Only 2,188 of them collide with
anything. Now handled: a null-grade reg is COMPLETED in place when the grade appears, and a null grade
never adds a row beside one that already names a grade.

**(iii) THE REAL FIND — 27,666 duplicate regs, from three writers disagreeing about the key:**

| writer | matched on | on conflict |
|---|---|---|
| `nightly-crawl.js` L1011 | `tid` AND `gid` | append |
| `fetch-profile-stats.js` L1039 | `tid` | skip |
| `discover-seasons.js` L962 | `tid` | **mutate `gid` in place** |

The mutation was the generator: rewriting one reg's grade could collide it with a sibling the nightly
had already appended, producing a pair sharing `(tid, gid)` that neither other writer could create,
since both check and skip. It also fought the nightly in a loop — discover-seasons collapsed a regrade
to one reg with the latest grade, the nightly met a game in the older grade, found no match, and
appended it straight back.
**Decision A (Mark, 2026-08-01): a reg IS a `(team, grade)` registration.** Fixed at source; 27,664
merged, 2 refused (below).

**[archived §2.1] — 3,262 stale `legacy` flags.** ✅ **APPLIED 2026-08-01: 3,114 cleared, 142 kept,
post-check 0, audit confirms both invariants `✅ none`.** Text below is the original statement of the
problem, kept for the diagnosis; the "NOT YET RUN" it opened with is no longer true.
`legacy: true` is defined as "pre-history game, no further data obtainable" — the terminal state of the
three-step classification probe. Measured against the live corpus: **3,262 games carry it, 3,120 (95.6%)
hold a SCORE, and ZERO are dated 2020 or earlier.** It peaks in the CURRENT year (955 in 2026). The flag
has never once been used for its documented purpose.

Root cause found and reproduced by running the real code: `applyRoundFixtures` (nightly-crawl.js L567)
spreads the existing entry, overlays fresh fixture data, and never touches flags — so a stale `legacy`
survives every subsequent write forever. A normal result yields legacy+score; a forfeit result yields
legacy+forfeit+fo, which is the 49 collisions (§4). One defect, two visible populations.

**Nothing writes the flag any more** — verified by grepping all of `scripts/` and `.github/workflows/`:
every one of 55 matches is a read, a display string, or an unrelated sense of the word. The classifier
went in the 2026-07-16 cleanup. The population is FROZEN; there is no writer to race.

Blast radius is narrow: `build-win-loss`, `build-team-stats`, `build-finals-stats`, `build-records` and
`build-player-games` do not mention `legacy` at all, so these games were never excluded from stats. The
harm is StatTrack, which tests `legacy` before the score test (§1.3).

`repair-legacy-flags.js/.yml` clears the flag from scored games and leaves the ~142 scoreless ones,
where it remains unfalsified. Guards: per-game key diff aborts if anything but `legacy` changed;
per-file game-count guard; full post-check re-read before the commit is allowed.


Detail in `REPO_MANIFEST.md` §6.11–6.14. Listed here so nobody re-opens them.

**2026-08-01 (late) — sibling stats sync + winPct/lossPct denominator fix**
- **Reg sibling stats synced.** Both writers key on `sid`+`tid` and never on `gid`
  (`fetch-profile-stats.js` L985-996, `build-win-loss.js` L271/L313), so EVERY reg sharing a season and
  team is meant to hold the same per-team totals. 169,566 groups had drifted — 798 in a CORE box-score
  field, 168,768 in `foulOuts` alone — not a keying bug but staleness, since a group only diverges when
  it has not been rewritten since the values changed. The `wins`/`losses` ones persisted because the
  nightly runs `build-win-loss --active-only` and 97%+ of them sit in LOCKED seasons that scope never
  revisits. `repair-reg-sibling-sync.js` merges per-key MAX (season totals only grow, so the larger copy
  is the more complete one; idempotent, aborts if any value would decrease). 91,716 players,
  263,440 regs. **Verified after: `differ in >=1 key` = 0, CORE = 0, key histogram empty.**
- **winPct / lossPct now use DECIDED games as their denominator AND their filter value.** These are the
  only two categories that MIX SOURCES: `wins/losses/draws` are counted by `build-win-loss.js` from
  games we actually hold, while `gp` is PlayHQ's appearance count including games we have no result for.
  A player with 50 GP but only 10 known games, all won, showed 100% while carrying `gp:50` — and the
  browser filter reads `e.gp`, so they survived a "min 50" filter on the strength of 10 results, ranking
  level with someone who genuinely went 20-0 across 20 known games. The percentage is UNCHANGED (10 from
  10 IS 100%); `gp` on those two categories now carries the decided count, so the 10-of-50 player only
  appears at min<=10. Qualifying floor moved from `career gp >= 10` to `decided >= 10`. Applied in BOTH
  places, since all-time is built server-side and season is derived client-side: `build-leaderboards.js`
  and StatTrack **Beta 0.64**. Every other category keeps career gp deliberately — `ppg`/`threePtPG`/
  `foulsPG` take their numerators from the SAME PlayHQ source as `gp`, so there is nothing to correct.
  Side effect: the displayed GP beside those percentages is now the decided count, and players with
  fewer than 10 decided games drop off those two boards entirely.
- ⚠️ **The two `foulOuts` pairs `repair-duplicate-regs.js` deliberately REFUSED were resolved to 2 by the
  sibling sync**, which groups by `tid` alone and had no way to know the refusal was deliberate. For
  regrade siblings max is provably right; for those two it was the ambiguous case (2 vs 1, where the
  truth might have been 3). 2 players, one foul-out each, and 2 is the likelier answer — but it was
  decided by execution order, not by anyone. See claude_context T18.

**2026-08-01 (evening) — §2.2 closed end to end, VERIFIED**
- **Verification (independent script):** exact `(tid,gid)` duplicates **27,666 -> 2**, total regs
  **4,151,876 -> 4,124,212** (27,664 removed = 27,606 full run + 58 rehearsal). Everything the merge
  deliberately does not touch is unchanged: null-gid 2,188, regs missing gid 110,232, seasons gap
  4,361 / 218 finals. REGRADE rose 1,296,352 -> 1,300,376 — correct, since a `[G1, G1, G2]` group counted
  as EXACT while the pair existed and becomes pure regrade once merged.
- ⚠️ **The first apply run was CANCELLED at the 120-minute timeout with NOTHING committed**, having
  completed every merge and every write. Per-path `git add` for 24,534 paths against a 527,900-file
  index is ~2 TB of index I/O. Now: one `--pathspec-from-file` call with per-path only as an isolating
  fallback, plus a commit every 3,000 files. Recorded as traps **T16** and **T17**. Measured: 3,000
  paths, 10,753 ms per-path vs 96 ms batched.
- **Root cause: three writers, three different reg keys.** `discover-seasons.js` mutating `gid` in place
  was the exact-duplicate generator. Fixed under decision A: both its reg-write sites now go through one
  `upsertReg()` helper matching on `(tid, gid)`, never overwriting a real grade, completing null grades
  in place, and refusing to add a null-grade row beside one that names a grade. 12/12 case matrix.
- ⚠️ **`discover-seasons.js` was writing player files PRETTY-PRINTED** (`JSON.stringify(player, null, 2)`
  at both sites) while `nightly-crawl.js` L497 and `fetch-profile-stats.js` L678 write minified. Any
  player touched by both flipped format every cycle and was rewritten in FULL each time even with no
  data change — straight into the 6.13 GB that already cost code search. Both now minified.
- **27,664 duplicate regs merged, 2 refused** (§2.4). Rehearsed on shard `0a`: 57 players, exactly the
  dry run's prediction. Merge rule is max-per-key, lossless where a key is merely absent; groups where a
  shared key holds different values on every copy are REFUSED and listed rather than silently resolved.
- **`build-leaderboards.js` season key `uuid|tid` -> `uuid|tid|gid`.** L340 assigns rather than
  accumulates, so a regraded team's second reg was overwriting the first. ⚠️ **This change was REVERTED
the same day** — measurement showed regrade regs hold DUPLICATED team totals, so keying by grade made
two identical rows per player and the overwrite it replaced was losing nothing. See §4.
- ⚠️ **StatTrack season leaderboards were rendering EMPTY, and had been for a long time.** L2040 required
  the key's first segment to be >=32 chars; `build-leaderboards` writes `${truncateUuid(uuid)}|${tid}`
  and TRUNC_LEN is 13 (10 before 07-31). Every entry failed the guard, and because `data` still had one
  key the "no data" branch never fired — so it showed an empty list, not an error. Found only because I
  checked whether adding `|gid` to the key was safe. **Beta 0.63** accepts a uuid prefix.
- **`audit-seasons-gaps.js` + `.yml` created** — the diagnostic behind all of the above.

**2026-08-01**
- **Nightly §1.1 PASSED with the new `gitCommit` verified in the log** — see §1.1 above.
- **Legacy repair APPLIED.** Dry run 3,120/142/330 files; rehearsal on `017feb6a` cleared 6; full run
  3,114 cleared / 142 kept / 329 files / **post-check 0**. Every figure matched prediction exactly, and
  the diagnostic and the repair — two independently written scripts — agreed on all six years.
  `329 insertions(+), 329 deletions(-)` confirmed minification survived the rewrite.
- **db-audit confirms both invariants `✅ none`** on their first run, and `Normal (no flag)` rose to
  1,723,470 as the 3,114 fell through to the right bucket.
- **StatTrack Beta 0.62 committed to BOTH copies.** Audit incidentally corroborated it — repo-root
  `index.html` reads 130.2 KB against 0.61's 129.4 KB.
- **Retrospective validation of the `private` boolean:** audit shows `private w/ real name 5,959
  (98.7%)`. The old name-pattern inference would have mislabelled 98.7% of private players as public.
- ⚠️ **`weekly-future-fixtures.yml` was RUNNING, having been documented as retired.** Its own cron
  (`0 0 * * 6` = Sat 00:00 UTC = **Sat 10:00 AEST**) had been firing every week. §B5 of this file said
  "retired unrun; probe workflow + script deleted" and `REPO_MANIFEST` called it "delivered-but-unrun".
  Both wrong. Worse, it is the approach that was explicitly REJECTED — 60–90k calls resting on the
  still-unverified assumption that `discoverGrade.rounds` lists future rounds — running weekly beside
  the ~25k-call proven path that replaced it. They never collided only because both take `data-write`.
  **Cron removed 2026-08-01, workflow KEPT as manual-only** (Mark's call: useful when the Monday chain
  is skipped). Renamed to `Future Fixtures (manual — full round-forward sweep)` because three separate
  things were called "weekly" and that is what made it unidentifiable in the Actions tab.
  This is T12's third instance in two days — and the only one that was a live scheduled job rather
  than a fix that never shipped.

**2026-07-31 (late session)**
- **§2.2 flag collisions CLOSED as diagnosis.** All 49 are the same pair, legacy+forfeit. Verdicts:
  0 missing from `forfeit-games.json` (so leaderboards were never contaminated), 47/49 with a valid
  `fo`, 0 carrying `spc:1`, **49/49 carrying a score**. The score is the contradiction — `hs`/`as`
  come from a fixture query, which is exactly what `legacy` asserts did not answer. Rolled into §2.1;
  the repair covers both populations.
- **§2.5 fold report CLOSED.** `reports/fold-diverged.json` demoted to advisory rather than
  timestamped: `--repoint-only` stopped reading it at the T6 rewrite and nothing else does, so
  timestamping would have added files to protect a consumer that no longer exists. THREE stale texts
  corrected that still told the reader it was load-bearing — the script's usage block, its runtime
  NOTE, and the `mode` input description on the dispatch form.
- **Three `gitCommit` violations fixed**, all proven by running the old and new code side by side
  against a real repo with a bare remote:
  `nightly-crawl.js` — combined `git add` in an empty catch, silent no-op return, 10-attempt retry,
  swallowed total push failure. Demonstrated: one bad pathspec left a real change uncommitted, HEAD
  unmoved, and printed NOTHING.
  `discover-fixtures.js` — the same, plus a missing `cwd: ROOT`. Reproduced the 2026-07-19 trigger
  exactly (`team-lookup/` and `zero-team-seasons.json` both absent) and confirmed it now commits.
  Both now: per-path adds, `staging:` shortstat, inline identity, fail-fast on non-contention,
  60 attempts / 1-91s jitter, THROW on exhaustion.
- **`db-audit.js` gained the missing invariant.** `flagCollisions` only ever tested `legacy` against
  other FLAGS, never against DATA — which is why a 3,120-game contradiction was invisible to every
  audit run. New `legacy + score` row. Both legacy rows now report unconditionally so the clean state
  is reachable. Also removed a truncated orphan comment left behind when §13 was deleted.
- **`find-code-refs.yml` created** (§2.6) and **`repair-legacy-flags.js/.yml` created** (§2.1).
- **Three unclassified paths CLASSIFIED, and one claim of mine was wrong.** `explore-results/` =
  exploratory API-call output, KEEP for reference. `roster-results/` = grade-roster lookup output.
  Root `index.html` = a MIRROR of StatTrack's, kept so it is available in the data repo — and Pages
  serves it, so a stale mirror is a stale live app, not just a stale file. ⚠️ `zero-team-seasons.json`
  was NEVER undocumented: `REPO_MANIFEST` §2.2 L183 lists it as a `discover-fixtures.js` output and
  §6.8 names it in the staging-bug pathspec. The claim that all four "appear nowhere" was false for
  one of them, in both §1.2 and §2.3 of this file.
- **`generate-roster.yml` documented** — it appeared in NO document. It does not write
  `roster-results/`; it only prints to the job log.
- **`scripts/discover-seasons.js.old` deleted.** A stale duplicate of a live script, invisible to
  both `REPO_MANIFEST`'s `scripts/*.js` glob and db-audit's root-level `.js` check because of the
  extension — and it polluted the legacy grep with two hits from dead code.

**2026-07-31**
- Nightly race between `build-win-loss.js` and the matrix fixed by ORDERING, not locking — the
  dispatch job now needs `win-loss`. The nightly's own lock could not cover it because the matrix is
  a separate workflow run (trap T10). This closed §B1, which had been open since 07-16.
- db-audit §13 (UUID truncation footprint) REMOVED — the question is closed, and it carried a full
  extra scan of `team-stats/` (916 MB) plus per-item counting in three other loops.
- db-audit keep-list success state made reachable (it could never show ✅ once the list grew), and the
  dangling-alias hint now names BOTH causes rather than just "pending fold".
- Matrix retrigger now narrows to shards with outstanding work (T9). Trap: an empty shards value
  means ALL 256, so an empty narrowed list falls back to forwarding the original.
- `finalsPerSeason > 1` fixed by construction — numerator and denominator are now sets, so the ratio
  cannot exceed 1. Verified `✅ all ≤ 1` in both the player files and the leaderboard.
- `records/all-time.json` blank game context fixed — the leaderboard stores 13-char truncated ids and
  `build-records.js` built a file path straight from one, failing 100/100. Now resolved first.
- Hardcoded `slice(0, 10)` in `build-leaderboards.js`'s placeholder-name minter → `truncateUuid()`.
  No stored id was ever 10 chars; only the `Player #…` display name was affected.
- Bare `gh workflow run` in `build-finals-stats.yml` → the retry helper.
- `apply-and-commit` uses a plain full checkout — promisor-fetch and skip-worktree failure classes
  deleted, not mitigated.
- Bounded name-heal retry (§B3, option a): `nameHealAttempts`, cap 3, reset on success and on
  `--force`. db-audit gained in-flight / gave-up rows.
- 284 dangling aliases repaired 284/284. The fold now repoints inline and its post-check refuses to
  commit if it leaves any.
- Nightly race found and fixed by ordering: the matrix dispatch now waits for `win-loss`. Audit
  confirms `root-level .js files ✅ none` and the keep-list at 8.
- Repo hygiene actioned: `fetch-playhq.js` and
  `find-players-by-team.js` moved out of the repo root. The four evidence files
  (`uuid-collisions-len10`, `git-history-recovery-report`, `season-name-contamination`,
  `unresolved-prefix-diagnosis`) are on db-audit's keep-list so it stops flagging them.
- `db-audit.js`: three stale checks fixed (one was INVERTED — it asserted the legacy leaderboard
  schema as ✅), keep-list extended to four evidence files.
- PlayHQ query-copying rule rewritten around a principle: authority comes from being exercised.
  `fetch-playhq.js` is NOT a reference source — it's retired with known double-counting bugs.

**2026-07-30**
- 413,364 `statsChecked` values wiped by a broken YAML gate; recovered by a full re-sweep.
  Traps T1–T3 in `claude_context.md`.
- Two `refreshSession` bugs: a socket throw escaped a 10-attempt retry loop, and a rejected promise
  was cached in the session lock with no recovery path.
- Season-name contamination closed — the write bug was already dead; the self-heal was failing
  silently. Audit now reads 0 contaminated.
- Targeted forced re-fetch now exists; the repo-wide-clear footgun is gated in bash, not only in a
  GitHub expression.
- §D7 UUID truncation CLOSED — measured 57.61 MB, not the ~1.57 GB estimate. Do not action.
- House `gitCommit` proven across 15 production commits.

---

## 5. DATA-QUALITY CAVEATS (recorded; not action items unless they surface)

**GitHub cannot index this repo for code search — STANDING CONSTRAINT, not a work item.**
(Moved out of §2 on 2026-08-01: `find-code-refs.yml` already exists, so there is nothing to "go" on.)
`markjovic/sports-players-stats cannot be searched because it is too large` (confirmed 2026-07-31 at
6.13 GB). A search that cannot run returns "0 files", which reads exactly like "no matches" — the UI
invites a false negative. This matters because the cross-document fact rule (§5) requires grepping
across all files, and that mechanism did not exist. `find-code-refs.yml` is the replacement: a real
grep over `scripts/` and `.github/workflows/`, dispatchable, with the scope hard-coded so it can never
be pointed at `games/` or `players/`. **This is also the first CONFIRMED cost of repo size** — §D8's
"blocks publishing" premise remains separately unverified, but "blocks code search" is now measured.


- **p[] recovery misattribution:** scoped to `games/bv` p[] provenance only; canonical player
  data unaffected.
- **~15 permanently-placeholdered players** (2020–2022 spectator-only, unrecoverable).
- **Roster coverage limitation (by design):** bare `p[]` entries can't be team-attributed, so a
  fill-in without a registration won't appear on a team roster until they carry one.
- **A grep is not a read.** Checking one claim in a document and reporting the DOCUMENT as verified
  is a false verification, and it is worse than silence because it stops the next reader looking.
  If the verdict is about a whole file, the whole file has to have been read (directive 12).
- **"No commit" does not mean "not built".** A derived file that is already correct is rewritten
  byte-identically and never committed — the 522-file team-stats repair staged only ~148 files — and
  a bounded-depth clone cannot see a commit older than its shallow boundary. Commit-presence checks
  are advisory; comparing live values on both sides is the verdict (see directive 16).


**Appearance gap — mechanism PROVEN 2026-08-10, actively being closed (supersedes the 2026-08-06
"not worth chasing" note above for the recoverable portion).** ~2.7% of appearances credited by
PlayHQ profiles are absent from our rosters because games were captured while their e-scoring boxes
were partially entered and never revisited once the round settled. Recoverable by spectator re-sweep
(campaign underway, §1.4) and per-player profile repair (§2.9). NOT recoverable: games the nightly
`spc`-froze at FINAL while the box was still filling — indistinguishable after the fact from a
complete small roster, and the reason capture-at-source (§2.10) exists. Also permanently absent:
15,929 FINAL games with no roster at all, and the ~250k+ games whose spectator data the endpoint
simply does not serve (retired after one attempt, `spcm` marked, reversible).

## 6. ARCHIVE — closed 2026-07-28/29

- **`fetch-profile-stats-matrix.yml` hardened** after a lost dispatch (HTTP 500) stopped the chain:
  `/tmp/gh-dispatch.sh` retry helper on all SIX dispatch sites (10 attempts, 10→90s backoff,
  fail-fast on HTTP 4xx, THROW when exhausted); persistence gate so shard-summary `written` is not
  counted as progress when `apply-and-commit` failed (new `consecutive_apply_failures` input;
  3 consecutive → `apply_stuck`, which halts WITHOUT firing the terminal or deleting
  `matrix-force-pending.json`); push retry added to `apply-and-commit` (it had NONE) and to the
  pending-file delete step; combined `git add players/ scripts/` split per-path;
  sparse-checkout/promisor retry (the 2026-07-26 `curl 56` / early-EOF failure); terminal fan-out
  steps gated `!cancelled() && status == 'stuck'` so one throwing dispatch cannot skip its siblings;
  `force` gate + `NEXT_SHARDS` expression moved to the robust boolean form.
- **Whole chain proven end to end afterwards:** matrix → `stuck` at run 4/150 → terminal dispatched
  `build-team-stats.yml --active-only` → 522 files repaired → A3 passed 20/20.
- **`check-roster-freshness.js` + `.yml` created** (read-only §A3 tool; see §A3 above).
- **`build-team-stats.js`** gitCommit on the house pattern; dead `p[]` loop removed (§C6).
- **`playhq_api_reference.md` CORRECTED 2026-07-29** (five defects, one pass, all copied from the
  deployed `scripts/fetch-profile-stats.js` rather than reconstructed):
  1. The season-name bug was documented as CORRECT at L6 / L380 / L428 ("`seasonStatistics.name`
     confirmed as player display name"). That is the bug that wrote season strings into 40,034
     player files. Retracted at all three sites; the old changelog line is kept struck-through so a
     reader who saw it knows it was retracted. The `name` field is annotated IN the GraphQL block
     rather than stripped, because the deployed `PROFILE_QUERY` (L175) still requests it and
     `parseProfileStats()` (L218–224) deliberately ignores it.
  2. `publicProfile` (ACCOUNT tenant) had NO section — `account` appeared zero times in the file —
     while `claude_context.md` directive 6 pointed at it and REPO_MANIFEST §6.6 claimed it had been
     added. Section written from `fetchPublicProfileName()` L328–350: query, tenant override,
     response path, the 403→refresh→retry-once behaviour, and the three conditions that trigger it.
  3. "All other operations: no effective rate limit. Tested to 1000 concurrent" replaced with the
     WAF reality (403 + HTML "Request blocked", per-IP not aggregate, per-endpoint thresholds).
  4. The AIMD concurrency policy (manifest §8) added — this is the document a new fetcher gets
     written from, and it carried no concurrency guidance at all.
  5. The `actions/setup-node` fingerprint rule cross-referenced — it is an API-access failure mode
     and belonged here.

- **⚠️ MY PRIOR ENTRY HERE WAS FALSE, and this is the lesson worth keeping.** The 2026-07-28 version
  of this section read: "`playhq_api_reference.md` needed NO change this session — verified by
  reading the file, not assumed." It was NOT read. It was grepped for the pagination correction,
  that one item was found clean, and the verdict was generalised to the whole document — while
  defects 1 and 2 above were sitting in it. Stating an unearned verification is worse than leaving
  a file unexamined, because it tells the next reader the check has already been done. **A grep is
  not a read** (directive 12; see also §F).

## 7. ARCHIVE — closed 2026-07-21

- **§A validations closed:** `Session refreshed (attempt 1)` on a fresh matrix shard runner AND
  on the reduce job (both job types the fix touched); full uncapped sweep cycle 1 = 83,050 /
  231,678 probed, all 256 shards wall-stopped as designed, cycle-2 persistence confirmed;
  matrix terminal (`Build Team Stats` in the stuck dispatches) + stop-button confirmed;
  fetch-profile-stats `statsChecked` gating and application-403 retryability confirmed across
  two runs (same 3 players re-fetched, files untouched — correct).
- **Future-fixtures decision (§B5): chained into the nightly, NOT a standalone cron.**
  `discover-fixtures-weekly` job added to `nightly-crawl.yml`: terminal-gated
  (`games_remaining == 0`), Mondays UTC (`dow=1`), dispatches `discover-fixtures.yml` with
  `current_only=true` + `chain_stats=true`. Mirrors the Sunday discovery job. Accepted coupling:
  chain halt = week's sweep skipped, manual re-dispatch is the fallback.
  `weekly-future-fixtures.yml` retired unrun; probe workflow + script deleted (§B6).
- **§C7 weekly stats chain BUILT** (infer-game-grades confirmed decommissioned — dropped):
  `discover-fixtures → build-finals-stats --active-only → build-leaderboards --active-only`,
  Tuesdays early AM AEST via dispatch links, each success-gated.
- **`build-finals-stats.js` `--active-only` was DESTRUCTIVE — fixed before first live use**
  (5 runs ever, all argless — never triggered). Phase 2 recomputed career finals from the
  active-only scan (clobbering veterans' totals) and its `?? zeros` per-reg loop deleted
  locked-season flags. Fix: scanned-scope set; out-of-scope seasons never touched, their
  existing flags preserved into career totals (build-win-loss active-only precedent).
  Progress file now mode-keyed.
- **`build-leaderboards.js`:** progress file was NEVER deleted on success (manifest §5's claim
  was aspirational) — a completed run left every sid done and later runs silently no-op'd
  without `--force`. Fixed: delete-on-success; progress mode-keyed; `active_only` input added
  to its yml (didn't exist); fictional "nightly calls --active-only" header corrected.
- **Both scripts' gitCommit** upgraded to the house pattern (per-path adds, staged shortstat
  printed, commit-first, 60-attempt/1–91s-jitter push retry, THROW on total failure).
- **`build-finals-stats.yml`:** `data-write` lock added (writes `players/`); `chain_leaderboards`
  input + success-gated chain job. Stale doc claim corrected: neither build-finals nor
  build-leaderboards yml carried the ⚠ safety-net step anymore.
- **A1 proving completed same day** (see §A1 above for the evidence). The chain-gate boolean bug
  was the only failure encountered; found live (chained leaderboards SKIPPED), fixed in both chain
  gates, directive 13 + manifest §6.9 corrected same day (the original directive had codified the
  failing form from cross-context "deployed evidence"). Stale FULL-run leaderboards progress file
  existed in the repo and was discarded live by the new mode-keying — the fixed bug's trigger
  condition was real, not hypothetical. `verify-finals-preservation.js/.yml` created, used
  (70/70 pass), deleted.
- **Stale memory items closed by evidence:** `playhq_api_reference.md` pagination correction and
  `claude_context.md` filename-comment rule were BOTH already in the docs; migration step 3b-2
  (rekey APPLY) was already completed in the 07-15/16 migration.
