# PlayHQ GraphQL API Reference

> **Change log:**
> - **July 2026 (verified live):** `gradePlayerStatistics` is **paginated** via `filter.pagination {page, limit}`. `limit=50` is a PER-PAGE cap, NOT a total cap. Verified on grade `c952bf59` — `totalRecords=86`, `totalPages=2`. Prior "hard cap 50, no pagination" text was WRONG; corrected below and in Known limitations.
> - **July 2026:** Documented the two PlayHQ identity namespaces (spectator vs api) as a first-class concept — see "⚠️ Two identity namespaces" below. Feeding a spectator-namespace `profileID` to `api.playhq.com` returns NOT_FOUND for a meaningful fraction of real public players; this is a namespace mismatch, not a private/missing player.
> - **2026-07-29 (RETRACTION — this doc was wrong and it cost 40,034 files):** the June 2026 entry below claiming `seasonStatistics.name` is the player display name is **FALSE**. It is the SEASON label ("Autumn 2021", "Summer 2022/23"). Reading `seasonStatistics[0].name` as a person's name wrote season strings into `player.name` for every player who reached `finishOk` without a prior name — repaired by `repair-season-names.js` (40,034 files; 0 contaminated on the independent re-scan). The real name comes from `publicProfile` on the **`account` tenant** (new section below) or from spectator rosters (`nightly-crawl.js` Phase 3). Corrected at all three sites in this file.
> - ~~June 2026: `publicProfileStatistics` — `seasonStatistics.name` confirmed as player display name.~~ **WRONG — see retraction above.** (Kept, struck through, so anyone who read the old text knows it was retracted rather than assuming they misremembered.)
> - June 2026: `update-venue-lookup.js` — must include UPCOMING + POSTPONED games, not just FINAL.
> - June 2026: Per-reg stat key confirmed as `sid:tid` (not `sid:tid:gid` — `gid` in that context was always undefined).

## Endpoints

| Endpoint | Purpose |
|----------|---------|
| `https://api.playhq.com/graphql` | Main API — all queries except live game scoring |
| `https://spectator.playhq.com/graphql` | Live e-scoring + hidden game scores |

---

## ⚠️ Two identity namespaces (spectator vs api) — READ THIS BEFORE ANY PROFILE WORK

PlayHQ runs **two separate identity namespaces for the same human**, and their `profileID`s frequently differ:

| Namespace | Source | Where the id appears |
|-----------|--------|----------------------|
| **spectator** | `spectator.playhq.com` (live scoring / box scores) | Games in `games/bv` reference players by a spectator `profileID` in `p[]` / `hp[]` / `ap[]` |
| **api** | `api.playhq.com` (profiles / statistics) | `publicProfileStatistics(profileID)` and `publicProfileTeams(profileID)` expect an id from THIS namespace |

**The failure mode:** feeding a spectator-namespace id to `publicProfileStatistics` returns `NOT_FOUND` (200 OK, null data) for a meaningful fraction of players. This looked like "private/missing player" historically, but it is a **namespace mismatch** — the player is public, the id is just from the wrong namespace.

**Verified diverged validators (season `81545684`, game `a2e4b6c2`, grade `c952bf59`):**
- William Mallen — spectator `9c8403ae-…` → api `50705b28-…`
- Charlie Raynor — spectator `408c3c6e-…` → api `69e32567-…`
- Jack Delaney — spectator `0000ed35-…` → api `1cf5a2ba-…`

**Recovery (spectator id → api id):** use the box-score `name` + one of `gradePlayerStatistics` / grade-roster-by-name / `profileSearch` to resolve the api id. Implemented in `scripts/lib/namespace-resolve.cjs` (`matchFromGrade`, `matchFromGradeRosterByName`, `matchFromSearch`, `isPlaceholderName`). Measured recovery rate ~93–100% of diverged players.

**Measured population facts (July 2026):**
- **Spectator-multiplicity: 19.8%** of collision api ids have 2+ spectator ids (40,330 mappings; 31,224 distinct api ids; max 13 spectator ids for one person). 43 name-mismatch cases, **all benign** (nicknames + curly/straight-quote + hyphen/spacing variants), 0 mis-reconciliations.
- **api-stability: 0.09% duplicate rate** (368 same-person records, all foldable spectator/api-divergence duplicates) — **no evidence a person has two distinct api profiles.** The api id is treated as the stable per-player key.

**Rule:** the api id is canonical/stable; the spectator id is the axis that duplicates. Never write a player record keyed on the spectator id if the api id is recoverable and already indexed — that creates a duplicate of an existing person (see backfill collision-skip in README / `claude_context.md`).

---

## ⚠️ Critical: Headers

**Main API** (`api.playhq.com`) — tenant full name, cookie in correct order:
```javascript
{
  'accept':       '*/*',
  'origin':       'https://www.playhq.com',
  'user-agent':   'PlayHQ/1.47.2 Android/28 (Android SDK built for x86)',
  'tenant':       'basketball-victoria',   // FULL name — never 'bv'
  'content-type': 'application/json',
  'request-id':   crypto.randomUUID(),
  'Cookie':       'phq_tier=cookie-no-jwt; phq_session=<jwt>; phq_sub=<sub>',  // ORDER MATTERS
}
```

**⚠️ Cookie order is critical.** Must be `phq_tier` first, then `phq_session`, then `phq_sub`. Wrong order causes CloudFront 403s.

**Spectator API** (`spectator.playhq.com`) — short tenant + extra header:
```javascript
{
  'accept':       '*/*',
  'origin':       'https://www.playhq.com',
  'user-agent':   'PlayHQ/1.47.2 Android/28 (Android SDK built for x86)',
  'tenant':       'bv',                    // SHORT name
  'x-phq-tenant': 'bv',                   // additional required header
  'content-type': 'application/json',
  'request-id':   crypto.randomUUID(),
  'Cookie':       'phq_tier=cookie-no-jwt; phq_session=<jwt>; phq_sub=<sub>',
}
```

Never split into separate public/mobile header objects. Missing user-agent = immediate 403 from CloudFront WAF.

---

## Authentication

PlayHQ issues a guest `phq_session` cookie on any valid request with the mobile user-agent. **Cookie TTL: ~30-40 minutes** in practice.

**Cookie order when constructing:** `phq_tier=cookie-no-jwt; phq_session=<jwt>; phq_sub=<sub>`
Extract all three from `set-cookie` headers, parse by name, reconstruct in this order.

**Cookie fetch must retry up to 10 times with backoff** — PlayHQ intermittently returns no Set-Cookie, especially when 256 matrix jobs all start simultaneously:

```javascript
async function refreshSession() {
  const cookieQueries = [
    { operationName: 'TenantConfig', variables: {},
      query: 'query TenantConfig { tenantConfiguration { label } }' },
    { operationName: 'ProfileSearch', variables: { fullName: 'a' },
      query: 'query ProfileSearch($fullName: String!) { profileSearch(fullName: $fullName) { result { id } } }' },
  ];
  for (let attempt = 1; attempt <= 10; attempt++) {
    if (attempt > 1) await sleep(attempt * 5000);
    for (const body of cookieQueries) {
      const res = await doFetch(API_URL, { method: 'POST', headers: HEADERS_BASE, body: JSON.stringify(body) });
      const raw = res.headers.get('set-cookie');
      if (!raw) continue;
      const parts = raw.split(',').map(c => c.trim().split(';')[0]);
      const get = name => parts.find(p => p.startsWith(name + '=')) || null;
      const tier = get('phq_tier'), session = get('phq_session'), sub = get('phq_sub');
      if (tier && session && sub) {
        sessionCookie = `${tier}; ${session}; ${sub}`;
        return;
      }
    }
  }
  throw new Error('Failed to obtain session cookie after 10 attempts');
}
```

**Rate limits:**
- `publicProfileStatistics` (`ProfileSeasonStatistics`) only: per-session JWT quota of ~30-35 calls. Refresh session between every batch of 30 requests.
- All other operations: **there IS a limit — a rate-based CloudFront WAF.** (The old claim here,
  "no effective rate limit, tested to 1000 concurrent with zero failures", was wrong and is removed.)
  It hard-blocks with **HTTP 403 + an HTML "Request blocked" body**, which is DISTINCT from an
  application 403 and is NOT a GraphQL 429 — detect it by testing the body for `DOCTYPE` /
  `Request blocked` before deciding what a 403 means (`fetch-profile-stats.js` L374–388).
  - **Per-shard / per-IP, NOT shared-IP aggregate** — parallel matrix jobs do NOT collectively trip
    it. Do not lower `max-parallel` to "help".
  - `discoverGrade` / `discoverFixtureByRound`: ~1,256–1,790 requests per ~80s window at
    concurrency ≈25; recovery is flat ~80s, no escalation.
  - `ProfileSeasonStatistics`: **far stricter** — roughly one 50-call batch per window; the matrix
    trips after ~50 calls/shard, which is why self-trigger-per-batch is the correct shape.
  - `publicProfileTeams`: friendlier — 200 probes returned `blocked: 0`.
  - **Rule:** type every call (`ok` / `empty` / `blocked` / `transient`); never collapse a failure
    into "no data". Canonical implementations: `fetch-profile-stats.js`, `nightly-crawl.js`
    (`gqlMain` → `{kind, data}`).

**Concurrency policy (main API, from REPO_MANIFEST §8)** — the AIMD loop a new fetcher should copy
rather than invent: start **500**, system cap **1000**; on 429 → drop to **60%** and retry the same
request with `attempts × 5s` backoff; **3 consecutive 429s → permanently lower the cap by 5**;
**2 clean batches → +10**; `403` → return null (not accessible, not a session problem); `404` → skip.
`fetch-profile-stats.js` does NOT use this loop — `ProfileSeasonStatistics` is governed by the
per-session JWT quota instead (batches of 30 with a session refresh between batches, 1s inter-batch
sleep, and `keepAlive: false` so every request opens a fresh TCP connection).

**⚠️ `actions/setup-node` must NEVER appear in a JOB that fetches `api.playhq.com`.** It changes the
runner's outbound fingerprint and produces `403 CLOUDFRONT-BLOCK` on EVERY request — including
session acquisition, from request #1, on a fresh IP. The rule is absolute and **per-job** (a
non-fetching job in the same workflow may carry setup-node harmlessly). See REPO_MANIFEST §6.3/§7.2.

**403 handling:**
- For `ProfileSeasonStatistics`: 403 = private/inaccessible profile — return null, do not refresh session.
- For all other operations: 403 = session expired — refresh and retry.
- Spectator 403: attempt ONE refresh then skip — do not loop.

---

## Three-Step Game Classification Probe (⚠️ ASPIRATIONAL — NOT IMPLEMENTED)

> **Corrected 2026-08-01.** This section was headed "(MANDATORY)". No code performs it. Neither writer
> of `games/bv` — `nightly-crawl.js` or `discover-fixtures.js` — calls `discoverGame` to classify, and a
> full grep of `scripts/` found only reads of `legacy`, never a write. The classifier was removed in the
> 2026-07-16 cleanup, and a game that fails everything today simply gets NO flag. `README` data-integrity
> rule 5 was corrected the same day; this file was the last one still asserting it. Kept as the spec that
> WOULD apply if the probe is rebuilt — do not read it as a description of current behaviour.
> See OUTSTANDING_TASKS §2.1.

Any code path that classifies games MUST follow all three steps. **Never classify as `legacy: true` without probing the spectator endpoint first.**

```
Step 1: discoverGame(gameId) on api.playhq.com
  → data returned:
      FORFEIT outcome     → forfeit: true, fo, desc; add to forfeit-games.json; STOP
      CANCELLED status    → cancelled: true; STOP
      ABANDONED status    → abandoned: true; STOP
      BYE status          → bye: true; STOP
      score data          → normal game, hs/as/venue; STOP
  → null (200 OK)         → MUST proceed to Step 2

Step 2: game(id) on spectator.playhq.com
  → data returned         → hidden: true, hs/as, hq/aq, hp/ap; STOP
  → null                  → MUST proceed to Step 3

Step 3: publicProfileStatistics for any player in the game
  → game found in profile → profileOnly: true, h/a/rn from profile; STOP
  → not found             → legacy: true
```

**discoverGame forfeit outcome values** (in `result.outcome.value`):
- `HOME_TEAM_WON_BY_FORFEIT` — home team won by forfeit
- `AWAY_TEAM_WON_BY_FORFEIT` — away team won by forfeit

**noProfile / noVenue retry flags:**
- `noProfile: new Date().toISOString()` — skip for 30 days when Step 3 exhausts all player candidates
- `noVenue: new Date().toISOString()` — skip for 30 days when hidden game has no venue
- These are SEPARATE flags — do not conflate

```graphql
query discoverGame($gameID: ID!) {
  discoverGame(gameID: $gameID) {
    id
    status { name value }
    result {
      outcome { name value }
      winner  { name value }
      home {
        outcome { name value }
        gameOutcomeDescription
        statistics { count type { value } }
      }
      away {
        outcome { name value }
        gameOutcomeDescription
        statistics { count type { value } }
      }
    }
    home { ... on DiscoverTeam { id name } }
    away { ... on DiscoverTeam { id name } }
    round { name number isFinalsRound }
    date
  }
}
```

---

## Key queries

### gradeRounds

```graphql
query gradeRounds($gradeID: ID!) {
  discoverGrade(gradeID: $gradeID) {
    id name type hideScores dates
    rounds {
      id name abbreviatedName
      current
      number
      isFinalsRound
      provisionalDates
    }
    season {
      id
      competition {
        id
        organisation { id name }
      }
    }
    ladder {
      pool { name }
      standings {
        team { id name }
        won lost ties
      }
    }
  }
}
```

`rounds[].current: true` identifies the active round. `ladder.standings` gives team IDs — `discoverGrade.teams` does not exist. Ladder fields: `won`, `lost`, `ties` — NOT `wins`, `losses`.

⚠️ **A GRADING GRADE RETURNS `ladder: []` AND IT IS NOT AN ERROR.** Measured 2026-08-19 on EDJBA
Winter 2026: `697208de "Boys U09 A Grading"` → `{"id":"697208de","name":"Boys U09 A Grading","ladder":[]}`,
HTTP 200, no GraphQL error. Grading rounds are the pre-season sorting phase and carry no ladder
because they are not a competition. A competition grade in the same season answers normally —
`cce1a7da "Boys U13 AR"` → 1 pool, 8 teams.

**Consequence, and it is a live fault as at 2026-08-19:** anything that resolves a season's teams from
`discoverGrade.ladder` gets ZERO teams for a season whose stored grade list is all grading grades, and
cannot tell that apart from a season with no teams. `discover-fixtures.js` reported
`Teams: 0 — no ladder data` for all 55 stored EDJBA grades on exactly this basis. Note `pool` is
`null` on a real ladder (not an object) — read `standings` directly and do not depend on `pool`.

---

### discoverFixtureByRound

```graphql
query discoverFixtureByRound($roundID: ID!) {
  discoverFixtureByRound(roundID: $roundID) {
    byes { id name season { id name } organisation { id name } }
    games {
      id alias
      pool { id name }
      home {
        ... on DiscoverTeam { id name season { id name competition { id name } } organisation { id name } }
        ... on ProvisionalTeam { name pool { id name } }
      }
      away {
        ... on DiscoverTeam { id name season { id name competition { id name } } organisation { id name } }
        ... on ProvisionalTeam { name pool { id name } }
      }
      result {
        winner { name value }
        outcome { name value }
        home { outcome { name value } statistics { count type { value } } gameOutcomeDescription }
        away { outcome { name value } statistics { count type { value } } }
      }
      status { name value }
      date dates
      allocation {
        time
        dateTimeList { date time }
        court {
          id name abbreviatedName
          venue { id name abbreviatedName latitude longitude address suburb state postcode country }
        }
      }
      isStale
      gameType { name value }
    }
  }
}
```

Works for active seasons only. Use `discoverTeamFixture` for historical seasons.

---

### discoverTeamFixture

```graphql
query TeamFixture($teamID: ID!) {
  discoverTeam(teamID: $teamID) {
    id grade { id name }
    season { id name competition { id name organisation { id name } } status { value } }
    organisation { id name }
  }
  discoverTeamFixture(teamID: $teamID) {
    id name isFinalsRound
    grade { id name season { id name competition { id name organisation { id name } } } }
    fixture {
      games {
        id dates
        status { value }
        home { ... on DiscoverTeam { id name organisation { id name } } }
        away { ... on DiscoverTeam { id name organisation { id name } } }
        result {
          home { statistics { count type { value } } }
          away { statistics { count type { value } } }
        }
      }
    }
  }
}
```

---

### discoverGame (full — for classification)

```graphql
query DiscoverGame($gameId: ID!) {
  discoverGame(gameID: $gameId) {
    id date
    status { name value }
    round { id name isFinalsRound }
    home { ... on DiscoverTeam { id name } }
    away { ... on DiscoverTeam { id name } }
    result {
      winner { value }
      outcome { name value }
      home { outcome { name value } gameOutcomeDescription statistics { count type { value } } }
      away { outcome { name value } statistics { count type { value } } }
    }
    allocation {
      dateTimeList { date time }
      court { id name abbreviatedName venue { id name abbreviatedName latitude longitude address suburb state postcode country } }
    }
  }
}
```

Returns null (200 OK) for hidden grades and legacy games — not an error.

---

### game(id) — spectator endpoint

**Endpoint: `https://spectator.playhq.com/graphql`**

```graphql
query game($id: ID!, $scope: PeriodScore) {
  game(id: $id) {
    id status updatedAt
    statistics {
      home {
        statisticsV2 { type { value } count }
        players {
          id profileID name playerNumber
          statistics { type { value } count }
          periodStatistics { period { value } statistics { type { value } count } }
        }
      }
      away {
        statisticsV2 { type { value } count }
        players {
          id profileID name playerNumber
          statistics { type { value } count }
          periodStatistics { period { value } statistics { type { value } count } }
        }
      }
    }
    result {
      home {
        statistics { type { value } count }
        periods(scope: $scope) { period { label shortName value } statistics { type { value } count } overtimeSequenceNo }
      }
      away {
        statistics { type { value } count }
        periods(scope: $scope) { period { label shortName value } statistics { type { value } count } overtimeSequenceNo }
      }
    }
  }
}
```

Variables: `{ "id": "<gameId>", "scope": "BY_PERIOD" }`

**Stored hp/ap format (after spectator processing):**
```json
[{"profileID": "uuid", "name": "Sam B", "number": 7, "pts": 12, "pt1": 0, "pt2": 4, "pt3": 1, "fouls": 2}]
```

Note: `name` field in stored `hp`/`ap` was stripped June 2026 along with `p[].n`. Do not re-add.

---

### publicProfileStatistics — player career and per-game history

**⚠️ THIS CALL RETURNS NO PLAYER NAME.** `seasonStatistics[].name` is the **SEASON label**, not the person. The deployed `PROFILE_QUERY` in `fetch-profile-stats.js` still REQUESTS the field (L175) but `parseProfileStats()` hard-sets `playerName = null` (L218–224) — do NOT "restore" a name read here, and do NOT strip `name` from the query below without reading the deployed query first. For a real name use **`publicProfile` (account tenant)** — see the section immediately after this one.

**Per-reg stat key:** `sid:tid` (NOT `sid:tid:gid` — the gid in this context is always undefined on reg objects).

```graphql
query ProfileSeasonStatistics($profileID: ID!) {
  publicProfileStatistics(profileID: $profileID) {
    seasonStatistics {
      name                      # SEASON label ("Winter 2026") — NOT the player's name
      player { hasGamePermit }
      statistics {
        season { id name competition { id name organisation { id name } } }
        role
        club { id name }
        totalStatistics { count details { value } gameFormat }
        teamStatistics {
          team { ... on DiscoverTeam { id name } }
          totalStatistics { count details { value } gameFormat }
          gradeStatistics {
            grade { id name }
            totalStatistics { count details { value } gameFormat }
            gameStatistics {
              game {
                id
                round { name number isFinalsRound abbreviatedName }
                home { ... on DiscoverTeam { id name } }
                away { ... on DiscoverTeam { id name } }
              }
              statistics { count details { value } }
            }
          }
        }
      }
    }
  }
}
```

**Stat type values:** `APPEARANCE`, `TOTAL_FOULS`, `TOTAL_SCORE`, `1_POINT_SCORE`, `2_POINT_SCORE`, `3_POINT_SCORE`

**Field mappings:**
- `gp`: `APPEARANCE`
- `pts`: `TOTAL_SCORE`
- `fg`: `2_POINT_SCORE`
- `ft`: `1_POINT_SCORE`
- `threePt`: `3_POINT_SCORE`
- `fouls`: `TOTAL_FOULS`
- `foulOuts`: count games per season where `TOTAL_FOULS >= 5`
- `name`: **NOT AVAILABLE from this call.** `seasonStatistics[0].name` is the season label — see the warning above. Use `publicProfile` (account tenant).
- `gameTids`: built from `teamStatistics[].gradeStatistics[].gameStatistics[].game.id` → `teamStatistics[].team.id` — written to player file for players with multiple tids in same season

**`seenGameKeys` dedup:** Always deduplicate by `game.id` — same game may appear in multiple `gradeStatistics` entries. **NEVER remove `seenGameKeys` from `fetch-profile-stats.js`.**

**Forfeit filtering:** Skip any `game.id` in `data/forfeit-games.json`.

Path: `seasonStatistics[].statistics[].teamStatistics[].gradeStatistics[].gameStatistics[]`

---

### publicProfile — the ONLY direct id → name lookup (ACCOUNT tenant)

**Added 2026-07-29 — COPIED VERBATIM, NOT RECONSTRUCTED.** The query string below was extracted
from the deployed `scripts/fetch-profile-stats.js` and compared byte-for-byte (string equality, not
eyeballed); the header form and every cited line number were checked against the same file the same
day. **To re-verify without trusting this note:** open `scripts/fetch-profile-stats.js`, find
`PUBLIC_PROFILE_QUERY` (L328) and `fetchPublicProfileName()` (L332–350), and diff. If the script has
moved on, the script wins and this section is what gets updated — never the reverse. This matters
more here than anywhere else in the file: the call this section documents exists because the
*previous* documented answer to "where does a player's name come from" caused the 40,034-file
season-name incident.

Previously undocumented despite being referenced by `claude_context.md`
directive 6 and claimed as present by `REPO_MANIFEST.md` §6.6 — neither was true, so anyone
following the pointer found nothing.

**The tenant is the whole point.** This is the ONLY call that uses `tenant: 'account'` — PlayHQ's
cross-sport identity tenant — instead of `basketball-victoria`. That is why it resolves
**spectator-keyed ids too**, and why `fetch-profile-stats.js` calls it with the STORED uuid rather
than a recovered `apiId` (L737). Everything else in the header set is unchanged.

```javascript
const PUBLIC_PROFILE_QUERY = {
  operationName: 'publicProfile',
  query: 'query publicProfile($profileID: ID!) { publicProfile(profileID: $profileID) { id firstName lastName __typename } }',
};
// headers: { ...HEADERS_BASE, 'tenant': 'account', 'request-id': crypto.randomUUID(), 'Cookie': sessionCookie }
```

**Response path:** `data.publicProfile` → name is `` `${firstName} ${lastName}`.trim() ``, or `null`
if that is empty.

**Failure handling (as deployed):** non-200 → `null`; `json.errors` present → `null`; missing
`data.publicProfile` → `null`; **403 → ONE `refreshSession()` then ONE retry**, then `null`. `null`
means "not found / hidden / transient" — the caller KEEPS the existing name and retries on a later
run. Never overwrite a stored name with an empty result.

**When it is called** (`finishOk`, L734–739) — only when the stored name is unusable, so players
with an established real name cost no extra request:
- no `player.name` at all, OR
- `isPlaceholderName(player.name)` (a `Player #<prefix>` stub), OR
- **contaminated**: the stored name matches one of the player's own season names under `normName()`
  — i.e. wreckage from the season-name bug above.

---

### discoverTeams

✅ **VERIFIED ON basketball-victoria 2026-08-19.** Returns every team in a season WITHOUT going
through a ladder — the only route that reaches a season whose stored grades are all GRADING grades
(a grading grade returns `ladder: []`, so the ladder route enumerates zero teams).

```graphql
query discoverTeamsBySeason($seasonId: ID!) {
  discoverTeams(filter: {seasonID: $seasonId}) {
    id
    name
    gender { value }
    ageGroup { value }
    grade { id name }
    organisation { id name }
  }
}
```

**`ID!`, not `String!`** — the opposite of `discoverSeason` immediately below. Both were tried; this
is the one that works.

Measured results: `1ae60211` EDJBA Winter 2026 → 2,093 teams / 263 grades / 22 orgs ·
`aacc7335` Camberwell → 672 / 82 / 14 · `7ccb2e98` Altona Bay (control) → 385 / 51 / 20.

⚠️ **`grade` CAN BE NULL** on a returned team (EDJBA's first: `z101`, U7, no grade). Anything reading
`team.grade.id` must tolerate it.

⚠️ **NOT A STRICT SUPERSET OF THE LADDER ROUTE.** Camberwell returned 13 of the 16 grades our held
games use. `discover-fixtures.js` therefore UNIONS the two rather than replacing one with the other.

⚠️ **Placeholder teams come back too** — `z`-prefixed names (`z101`, `zTeam 43`) with no fixtures.
Harmless, but they inflate the team count: the first ~420 of EDJBA's 2,093 produced zero games.

It also returns the real grade list as a by-product, which is the recovery route for a stale
`sports-index` grade list, and the owning CLUB per team (`Western Wildcats Basketball Club`, not the
association) — currently inferred elsewhere.

### discoverSeason

⚠️ **USE THIS TO REFRESH A SEASON'S GRADES — the stored list goes stale.** A season captured during
its grading phase keeps those grade ids forever unless something re-reads it. EDJBA Winter 2026 held
55 grading grades against 263 live ones on 2026-08-19. `discoverSeason` returns the current list and
is the recovery route.

Note the variable type below: **`String!`, not `ID!`** — that is the opposite of `publicProfileTeams`
and most other fields, and it is tenant-specific.

```graphql
query DiscoverSeason($id: String!) {
  discoverSeason(seasonID: $id) {
    id name
    status { value }
    startDate endDate
    competition { id name organisation { id name type } }
    grades { id name }
  }
}
```

Variable type is `String!` not `ID!` for basketball-victoria tenant.

---

### publicProfileTeams

⚠️ **THE SHAPE BELOW WAS WRONG UNTIL 2026-08-18 AND COST THREE DISPATCHES.** It showed a
`teams { status, team { ... } }` wrapper. There is no wrapper: the field returns the team list
DIRECTLY, and `DiscoverTeam` is a UNION MEMBER requiring an inline fragment — exactly as the seven
other `DiscoverTeam` sites in this file already show (`discoverFixtureByRound`, `gameView`,
`discoverTeamFixture`, `gradePlayerStatistics`). Sending the wrapper returns
`Cannot query field "teams" on type "DiscoverTeam". Did you mean "name"?` on every request.

**VERIFIED LIVE 2026-08-18** — 75 of 100 sampled players returned data with this exact query:

```graphql
query PublicProfileTeams($profileID: ID!) {
  publicProfileTeams(profileID: $profileID) {
    ... on DiscoverTeam {
      id
      name
      season { id name competition { id name } }
      organisation { id name }
    }
  }
}
```

`ID!` is correct — do NOT substitute `String!`. (That substitution is required for `discoverSeason`,
two sections above; applying it here produces a SECOND validation error on top of the first.)

Returns `UPCOMING`, `ACTIVE`, `COMPLETED` registrations.

**What it does NOT return, measured 2026-08-18 across 75 players / 1,114 cases:** a registration for
a team the player only ever APPEARED for. 0 of 1,114. It also returns FEWER registrations than the
repo already stores (4.1 per player against 5.2) and added zero we lacked. So it cannot be used to
close the appearance-without-registration population — those are fill-ins and PlayHQ holds no
registration for them either.

**25 of 100 returned `5 NOT_FOUND: failed to find profile`**, and a further large minority returned
strictly fewer teams than we hold, several returning zero. Unexplained as at 2026-08-18 — do not
assume a smaller result means our stored registrations are wrong.

---

### gradePlayerStatistics

**PAGINATED (verified live July 2026 — grade `c952bf59`: `totalRecords=86`, `totalPages=2`).** `filter.pagination.limit=50` is a PER-PAGE cap, not a total cap. Iterate `page` from 1..`totalPages` to get every record. **Never assume 50 is the full set.**

```graphql
query GradePlayerStatistics($gradeID: ID!, $filter: GradePlayerStatisticsFilter) {
  gradePlayerStatistics(gradeID: $gradeID, filter: $filter) {
    meta { totalPages totalRecords page }
    results {
      profile { id firstName lastName }
      team { id name }
      statistics { count details { value } }
    }
  }
}
```

Variables (page through until `meta.page >= meta.totalPages`):
```json
{ "gradeID": "c952bf59-...", "filter": { "pagination": { "page": 1, "limit": 50 } } }
```

- `meta.totalRecords` / `meta.totalPages` drive the loop; `limit` max observed = 50 per page.
- `team { id name }` is present on each result.
- Sort columns available: `APPEARANCE`, `TOTAL_SCORE`, `1_POINT_SCORE`, `2_POINT_SCORE`, `3_POINT_SCORE`, `TOTAL_FOULS`.
- Canonical implementation: `scripts/lib/namespace-resolve.cjs` (`gradePageFilter`, `matchFromGrade`). Copy from there — do NOT hand-write a minimised single-page version.

---

### profileSearch

```graphql
query ProfileSearch($fullName: String!) {
  profileSearch(fullName: $fullName) {
    result {
      id firstName lastName
      lastInteractedOrganisation { id name }
    }
  }
}
```

---

## Score extraction

```javascript
function parseScore(statistics) {
  return statistics?.find(s => s.type?.value === 'TOTAL_SCORE')?.count ?? null;
}

function statValue(statistics, typeValue) {
  if (!Array.isArray(statistics)) return 0;
  const match = statistics.find(s => s?.details?.value === typeValue);
  return match ? (match.count || 0) : 0;
}
```

---

## Game URL construction

Only the gameId matters:
```
https://www.playhq.com/basketball-victoria/org/a/a/a/game-centre/{gameId}
```

---

## `discoverCompetitions` — org → competitions → seasons (added 2026-09-07)

**Works on a guest session.** This is the top-down season route, and it returns
UPCOMING seasons that have no registrations at all — which the bottom-up
`publicProfileTeams` probe cannot see, because it can only read a season off a
player who has already registered in it.

```
query discoverCompetitions($organisationID: ID!) {
  discoverCompetitions(organisationID: $organisationID) {
    id name
    seasons(organisationID: $organisationID) {
      id name startDate endDate
      status { name value }        # UPCOMING | ACTIVE | COMPLETED
    }
    organisation { id name }
  }
}
```

`seasons` takes `organisationID` again — it is an argument on the field, not
inherited from the parent. Omitting it fails.

**Verified live 2026-09-07** against Kilsyth Basketball (`5433b0e3`): five
competitions, every season each has run since 2020, including Junior Domestic Summer
2026/27 (`5e26f10f`, UPCOMING, starts 2026-10-06) and Senior Domestic Summer 2026/27
(`8f43ff68`, UPCOMING, starts 2026-09-20). A full sweep the same day asked 183
organisations in 18 seconds and found **178 seasons** the index did not hold, 80 of
them UPCOMING.

**Second use, added 2026-09-08: this is the cheapest source of season dates in the
whole API.** `seasons(organisationID:)` returns `status`, `startDate` and `endDate` per
season for **every** season the organisation has ever run — one call per organisation,
~186 calls covers the entire index. The daily sweep was already receiving all of it and
discarding it for any season id already known. `discover-org-seasons.js
--backfill-dates` now reads it properly: **end-date coverage went from 18.6% (639 of
3,431) to 76.8% (2,671 of 3,479) in 17 seconds at no extra request cost** — 1,984
filled, 63 corrected. Before that backfill, **418 of the 703 unlocked seasons had never
had their status asked at all**, and those seasons held 8,106 grades, 85% of what the
nightly fetched every night.

**Limit: 808 seasons in the index are returned by NO organisation.** Not a transport
failure — zero organisations were blocked on the run that established this. Those
competitions are no longer listed anywhere PlayHQ will serve them: archived, or the
organisation merged or renamed. Re-running does not shrink the number.

**One organisation is permanently dead:** `59363a37` "Testing Basketball Association 1"
returns "Organisation could not be found" and will do so on every sweep.

**PlayHQ's own site sends this as one call with `discoverOrganisation` and
`tenantConfiguration` attached, and `organisationCode` set to the same value as
`organisationID`.** `scripts/discover-org-seasons.js` drops all of that — the logo,
contacts, address and tenant blocks are unused and make the response several times
larger. Only `organisationID` is needed once `discoverOrganisation` is not selected.

> ⚠️ **This does NOT contradict the `discoverOrganisation` row in Known limitations —
> it is a different query.** That row records `discoverOrganisation` returning null
> for guest sessions, and combined with the "reconstruct BOTTOM-UP" note it reads as
> though the whole org route is closed. It is not, and treating it that way meant the
> only season discovery was a 418,000-player probe. Note also that the 2026-09-07
> capture returned `discoverOrganisation` populated, so that row may itself be stale
> or specific to querying by `code` alone — untested either way.

**Grade resolution after discovery is a separate call and it walls.** `discoverSeason`
for each new season hit CloudFront after 14 of 178 on the first run. It needs AIMD
backoff with requeue, not a fixed sleep — see T44–T50 in `claude_context.md`.

## Known limitations

| What | Status |
|------|--------|
| `discoverFixtureByRound` for completed historical seasons | ❌ Returns empty — use `discoverTeamFixture` |
| Hidden grade games via `discoverGame` | ❌ Returns null — use spectator `game(id)` |
| Venue for hidden games | ❌ Not available via any route |
| Legacy orphaned games | ❌ All three classification steps null |
| `discoverGrade.teams` field | ❌ Doesn't exist — use `ladder.standings` |
| Season data pre-2020 | ❌ BV migrated to PlayHQ ~2020 |
| `gradePlayerStatistics` pagination | ✅ Paginated via `filter.pagination {page,limit}` — `limit=50` is PER-PAGE, not a total cap. Loop pages using `meta.totalPages` (verified July 2026). |
| `discoverOrganisation` for BV | ❌ Returns null for guest sessions |
| Team roster before first game | ❌ Not accessible via public API — reconstruct BOTTOM-UP from individual players' UPCOMING publicProfileTeams regs |
| `publicProfileTeams` grade for COMPLETED seasons | ❌ Returns NULL (grade only present for the player's CURRENT rego) — no bottom-up grade recovery for old seasons |
| `discoverSeason` grades for junior-stripped seasons | ❌ Returns null/0 for seasons holding only 1–2 grades (PlayHQ withholds junior grades). 3+ grade seasons resolve fine; some return MORE than the index holds (recoverable) |
| `discoverGrade.ladder` on a GRADING grade | ⚠️ Returns `[]` on HTTP 200 with no error — grading rounds are not a competition and carry no ladder. Indistinguishable from "no teams" unless the grade list is checked against `discoverSeason` |
| `sports-index` grade lists going STALE across a season's phases | ⚠️ **CONFIRMED 2026-08-19.** EDJBA Winter 2026 (`1ae60211`): index holds **55** grades, all of them `* Grading`; `discoverSeason` returns **263**, the real competition grades. 209 missing, 1 stale. The season was captured during its grading phase and never re-read, so every downstream sweep queries grading grades forever. Scope across other seasons UNMEASURED — Camberwell `aacc7335` shows the same shape (16 stored, 2 teams found) |
| `discoverSeason` returning MORE grades than the index | ✅ Not an error — it is the recovery route. Re-reading it is what closes the staleness above |
| `removed:true` seasons (0 grades, nothing fetchable) | ❌ discoverSeason null + discoverTeamFixture 0 games + nothing on disk — record existence only |
| PlayHQ partner API access | ❌ Applied, rejected — do not raise again |
| Spectator venue/allocation | ❌ Not returned — only scores + players |
