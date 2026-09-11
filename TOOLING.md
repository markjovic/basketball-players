# TOOLING.md

Machine-readable classification of every script and workflow in this repository.

`scripts/audit-tooling-inventory.js` reads this file to decide two things: whether a file
is classified at all, and which category it belongs to. Those two facts drive the
keep/delete verdict, so a file missing from this list will be judged on age alone.

**It deliberately carries NO purpose text, no findings, no method and no history.** Those
live in the operator's own notes, outside this repository. Filenames are already visible
in `scripts/` and `.github/workflows/`, so this file discloses nothing that a directory
listing does not.

**When you add a script or workflow, add its name here in the same commit.** That is the
whole maintenance burden, and skipping it means the inventory cannot tell your new tool
from an abandoned one.

### 2.1 Live scripts — run on a schedule or by the nightly chain

- `audit-diff-fields.js`
- `build-finals-stats.js`
- `build-leaderboards.js`
- `build-player-games.js`
- `build-records.js`
- `build-search-index.js`
- `build-team-stats.js`
- `build-venue-indexes.js`
- `build-win-loss.js`
- `discover-org-seasons.js`
- `discover-seasons.js`
- `fetch-profile-stats.js`
- `find-lost-stats-from-folds.js`
- `find-misrouted-appearances.js`
- `fold-diverged-players.js`
- `graduate-seasons.yml`
- `measure-credited-coverage.js`
- `nightly-crawl.js`
- `post-drain-chain.yml`
- `rebuild-chain.yml`
- `requeue-repointed-players.js`
- `revert-alias-repoints.js`
- `salvage-spectator-names.js`
- `scripts/lib/namespace-resolve.cjs`
- `scripts/lib/uuid-prefix.cjs`
- `seed-apiid-from-playhq-pairs.js`
- `size-appearance-gaps.js`
- `size-locked-resweep.js`
- `size-locked-split.yml`
- `size-missing-gids.js`
- `size-pages-artifact.yml`
- `size-spectator-queue.js`
- `spectator-backfill.js`
- `update-team-index.js`
- `update-venue-lookup.js`
- `verify-outstanding-claims.js`

### 2.2 Kept scripts — on-demand tools, deliberately retained

- `audit-seasons-gaps.js`
- `audit-uuid-collisions.js`
- `build-alias-worklist.js`
- `build-search-index.js`
- `clear-stats-checked.js`
- `count-stats-checked.js`
- `db-audit.js`
- `diagnose-forfeit-game.js`
- `diagnose-id-field-lengths.js`
- `diagnose-nightly-health.js`
- `diagnose.js`
- `discover-fixtures.js`
- `discover-game-backfill.js`
- `find-code-refs.js`
- `find-flag-collisions.js`
- `find-players-by-team.js`
- `find-root-json-refs.js`
- `fix-merge-aliases.js`
- `probe-alias-credits.js`
- `probe-alias-names.js`
- `probe-api-limits.js`
- `probe-my-aliases.js`
- `probe-player.js`
- `probe-selfalias-check.js`
- `probe-shared-name-aliases.js`
- `probe-squad-evidence.js`
- `probe-unresolved-aliases.js`
- `probe-verdict-conflict.js`
- `recheck-forfeit-games.js`
- `recheck-private-profiles.js`
- `rebuild-player-index.js`
- `repair-duplicate-regs.js`
- `repair-forfeit-score.js`
- `repair-legacy-flags.js`
- `repair-player.js`
- `repair-players-batch.js`
- `repair-reg-sibling-sync.js`
- `repair-season-names.js`
- `repoint-aliases.js`
- `report-alias-index.js`
- `restore-deleted-file.js`
- `scan-complete-rounds.js`
- `scan-roster-id-forms.js`
- `seed-missing-profiles.js`
- `size-gap-players.yml`
- `size-misses.yml`
- `size-negative-gap.yml`
- `size-opposition-index.js`
- `size-report.js`
- `size-resweep.yml`
- `synthesize-missing-games.js`
- `test-api.js`
- `trace-player-game.js`
- `verify-enrich.js`
- `verify-p-redundancy.js`

### 2.3 Scripts removed in an earlier cleanup

- `fetch-player-profiles.js`
- `search-team-stats.js`
- `test-failed-uuids.js`

Removed 2026-09-11:

- `check-roster-freshness.js`
- `drop-stale-playercount.js`
- `merge-phantom-profiles.js`
- `probe-absent-games.js`
- `probe-both-resolve.js`
- `probe-duplicate-profiles.js`
- `probe-grade-ladder.js`
- `probe-missing-games.js`
- `probe-setup-node-fingerprint.js`
- `probe-shared-roster.js`
- `redirect-exposure.js`
- `scan-season-name-contamination.js`
- `size-duplicate-profiles.js`
- `diagnose-alias-conflicts.js`
- `diagnose-nameless-players.js`
- `probe-alias-stats.js`
- `probe-discover-teams.js`
- `probe-notfound.js`
- `probe-registrations.js`
- `probe-roster-sources.js`
- `probe-session-throwaway.js`
- `probe-stattrack-shapes.cjs`
- `probe-stattrack-shapes.js`
- `probe-wrong-rosters.js`
- `prove-player-files-intact.js`
- `size-locked-backfill.js`

### 2.4 Spent scripts — concluded; their findings are recorded outside this repo

None. The eight probes that sat here were deleted on 2026-09-11 and are listed in 2.3.
The twelve held probes were reviewed the same day and are in 2.3 as well; the three
kept out of that group are classified in 2.2.

### 3.1 Live workflows — scheduled

- `add-player.yml`
- `audit-diff-fields.yml`
- `discover-org-seasons.yml`
- `discover-seasons-matrix.yml`
- `fetch-profile-stats-matrix.yml`
- `fetch-profile-stats.yml`
- `find-lost-stats-from-folds.yml`
- `find-misrouted-appearances.yml`
- `fold-diverged-players.yml`
- `measure-credited-coverage.yml`
- `nightly-crawl.yml`
- `recheck-private-profiles.yml`
- `requeue-repointed-players.yml`
- `revert-alias-repoints.yml`
- `verify-outstanding-claims.yml`
- `weekly-indexes.yml`

### 3.2 Build-trigger workflows

- `build-finals-stats.yml`
- `build-leaderboards.yml`
- `build-player-games.yml`
- `build-records.yml`
- `build-search-index.yml`
- `build-team-stats.yml`
- `build-venue-indexes.yml`
- `build-win-loss.yml`

### 3.3 Kept workflows — on-demand, deliberately retained

- `audit-uuid-collisions.yml`
- `build-alias-worklist.yml`
- `build-team-stats.yml`
- `clear-stats-checked.yml`
- `count-stats-checked.yml`
- `db-audit.yml`
- `diagnose-forfeit-game.yml`
- `diagnose-id-field-lengths.yml`
- `diagnose-nightly-health.yml`
- `diagnose.yml`
- `discover-seasons.yml`
- `find-code-refs.yml`
- `find-flag-collisions.yml`
- `find-players-by-team.yml`
- `find-root-json-refs.yml`
- `generate-roster.yml`
- `probe-api-limits.yml`
- `probe-squad-evidence.yml`
- `rebuild-player-index.yml`
- `recheck-forfeit-games.yml`
- `repair-forfeit-score.yml`
- `repair-legacy-flags.yml`
- `repair-season-names.yml`
- `report-alias-index.yml`
- `restore-deleted-file.yml`
- `scan-complete-rounds.yml`
- `size-locked-split.yml`
- `size-report.yml`
- `test-api.yml`
- `update-team-index.yml`
- `update-venue-lookup.yml`
- `verify-enrich.yml`
- `verify-p-redundancy.yml`

### 3.4 Workflows removed in an earlier cleanup

Removed 2026-09-11:

- `backfill.yml`
- `check-roster-freshness.yml`
- `drop-stale-playercount.yml`
- `merge-phantom-profiles.yml`
- `probe-absent-games.yml`
- `probe-both-resolve.yml`
- `probe-duplicate-profiles.yml`
- `probe-grade-ladder.yml`
- `probe-missing-games.yml`
- `probe-setup-node-fingerprint.yml`
- `probe-shared-roster.yml`
- `redirect-exposure.yml`
- `scan-season-name-contamination.yml`
- `size-duplicate-profiles.yml`
- `diagnose-alias-conflicts.yml`
- `probe-alias-stats.yml`
- `probe-discover-teams.yml`
- `probe-notfound.yml`
- `probe-registrations.yml`
- `probe-roster-sources.yml`
- `probe-stattrack-shapes.yml`
- `probe-wrong-rosters.yml`
- `prove-player-files-intact.yml`
- `size-locked-backfill.yml`
