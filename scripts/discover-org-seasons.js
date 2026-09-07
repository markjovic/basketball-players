// scripts/discover-org-seasons.js
//
// TOP-DOWN season discovery. Asks every organisation what competitions it runs
// and what seasons each has, and adds any season sports-index.json does not hold.
//
// WHY THIS EXISTS ALONGSIDE discover-seasons.js
// ─────────────────────────────────────────────
// discover-seasons.js works BOTTOM-UP: it probes players' publicProfileTeams and
// reads season ids off their registrations. That was the only route known to work
// - playhq_api_reference.md records "discoverOrganisation for BV: returns null for
// guest sessions" and "team roster before first game: not accessible - reconstruct
// BOTTOM-UP from individual players' UPCOMING regs".
//
// That note is about discoverOrganisation. `discoverCompetitions(organisationID)`
// is a different query and it works on a guest session. Captured 2026-09-07
// against Kilsyth Basketball (5433b0e3): it returned five competitions with every
// season each has ever run, INCLUDING two with status UPCOMING - Junior Domestic
// Summer 2026/27 (5e26f10f, starts 2026-10-06) and Senior Domestic Summer 2026/27
// (8f43ff68, starts 2026-09-20).
//
// The difference that matters: the bottom-up probe cannot see a season until a
// player has registered in it. This sees it the moment the association creates it,
// with no registrations at all. One request per organisation - a few hundred -
// against 418,000 player probes.
//
// It does NOT replace discover-seasons.js. That one also backfills player rosters
// and resolves grades from registrations; this only finds seasons.
//
// WHERE ORG IDS COME FROM
// ───────────────────────
// data/sports-index.json - every season already recorded carries orgId. So the
// org list is whatever associations we already know about, which is every one BV
// has ever run a season for. A brand-new association appears only once one of its
// seasons is found some other way; that is a real limit and it is stated here
// rather than hidden.
//
// EVERY REQUEST SHAPE IS COPIED FROM discover-seasons.js, NOT REWRITTEN. Headers,
// cookie queries, the promise-locked session, doFetch with keepAlive:false, the
// 403/429 ladder, and gitCommit. Those run against the real API on a schedule, so
// a wrong shape fails loudly there; a hand-written one fails quietly here.
//
// Run:
//   node scripts/discover-org-seasons.js --dry-run
//   node scripts/discover-org-seasons.js
//   node scripts/discover-org-seasons.js --season=5e26f10f     (one season, direct)
//   node scripts/discover-org-seasons.js --org=5433b0e3        (one organisation)

'use strict';

const fs           = require('fs');
const path         = require('path');
const https        = require('https');
const crypto       = require('crypto');
const { execSync } = require('child_process');

const ROOT           = path.join(__dirname, '..');
const INDEX_FILE     = path.join(ROOT, 'data', 'sports-index.json');
const INDEX_FILE_REL = 'data/sports-index.json';
const API_URL        = 'https://api.playhq.com/graphql';

const args   = process.argv.slice(2);
const argVal = (n, d) => { const a = args.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const DRY_RUN     = args.includes('--dry-run');
const ONE_SEASON  = argVal('season', '');
const ONE_ORG     = argVal('org', '');
const CONCURRENCY = Math.max(1, parseInt(argVal('concurrency', '8'), 10) || 8);

const log = (m) => console.log(`[org-seasons] ${new Date().toISOString()} ${m}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── Headers: the full set, never split. Copied from discover-seasons.js L150. ─
const HEADERS_BASE = {
  'accept':       '*/*',
  'origin':       'https://www.playhq.com',
  'user-agent':   'PlayHQ/1.47.2 Android/28 (Android SDK built for x86)',
  'tenant':       'basketball-victoria',
  'content-type': 'application/json',
};

// ─── Session: promise-locked, copied from discover-seasons.js L161-236 ────────
let sessionCookie = null, sessionPromise = null, sessionAt = 0;
const SESSION_MAX_AGE_MS = 15 * 60 * 1000;
const COOKIE_QUERIES = [
  { operationName: 'TenantConfig', variables: {}, query: 'query TenantConfig { tenantConfiguration { label } }' },
  { operationName: 'ProfileSearch', variables: { fullName: 'a' }, query: 'query ProfileSearch($fullName: String!) { profileSearch(fullName: $fullName) { result { id } } }' },
];

async function ensureSession() {
  if (sessionCookie && (Date.now() - sessionAt) < SESSION_MAX_AGE_MS) return;
  await refreshSession();
}

async function refreshSession() {
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    for (let attempt = 1; attempt <= 10; attempt++) {
      if (attempt > 1) await sleep(attempt * 5000);
      for (const body of COOKIE_QUERIES) {
        let res;
        try {
          res = await doFetch(API_URL, { method: 'POST', headers: { ...HEADERS_BASE, 'request-id': crypto.randomUUID() }, body: JSON.stringify(body) });
        } catch (err) {
          console.log(`  ⚠ session attempt ${attempt} ${body.operationName}: fetch threw ${err.code || ''} ${err.message}`);
          throw err;
        }
        const raw = res.headers.get('set-cookie');
        if (!raw) {
          // The same instrumentation discover-seasons.js carries: a silent continue
          // here is where a CloudFront block page vanishes without trace.
          let b = ''; try { b = await res.text(); } catch {}
          const sniff = b.includes('Request blocked') ? `CLOUDFRONT-BLOCK (${b.length}b HTML)`
                      : b.includes('DOCTYPE')         ? `HTML page (${b.length}b): ${b.slice(0, 80)}`
                      : (b.slice(0, 120) || '(empty body)');
          console.log(`  ⚠ session attempt ${attempt} ${body.operationName}: HTTP ${res.status}, NO set-cookie, body: ${sniff.replace(/\s+/g, ' ')}`);
          continue;
        }
        const parts = raw.split(',').map(c => c.trim().split(';')[0]);
        const get = (n) => parts.find(c => c.startsWith(n + '=')) || null;
        const tier = get('phq_tier'), session = get('phq_session'), sub = get('phq_sub');
        if (!tier || !session || !sub) {
          console.log(`  ⚠ session attempt ${attempt} ${body.operationName}: set-cookie PRESENT but missing phq_* — names seen: ${parts.map(c => c.split('=')[0]).join(', ')}`);
          continue;
        }
        sessionCookie = `${tier}; ${session}; ${sub}`;
        sessionAt = Date.now(); sessionPromise = null;
        log(`session refreshed (attempt ${attempt})`);
        return;
      }
    }
    sessionPromise = null;
    throw new Error('Failed to obtain session cookie after 10 attempts');
  })();
  return sessionPromise;
}

// ─── doFetch: copied from discover-seasons.js L515. keepAlive:false is what keeps
//     CloudFront's per-connection rate limiting off us - do not pool. ───────────
function doFetch(url, options) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const body = options.body || '';
    const req = https.request({
      hostname: parsed.hostname, path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: { ...options.headers, 'content-length': Buffer.byteLength(body) },
      agent: new https.Agent({ keepAlive: false }),
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8');
        const hdrs = res.headers;
        const headers = { get(name) { const v = hdrs[name.toLowerCase()]; return v == null ? null : (Array.isArray(v) ? v.join(', ') : v); } };
        resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, headers, text: () => Promise.resolve(rawBody), json: () => Promise.resolve(JSON.parse(rawBody)) });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── AIMD, copied from discover-seasons.js L293-418 ──────────────────────────
// The 2026-09-07 run resolved grades in a plain for-loop with a fixed 120ms sleep
// and NO backoff. It got 14 seasons through, hit the CloudFront wall, and then
// asked 164 more times at a steady 130ms apart — every one blocked. The seasons
// were still created, but 84 landed with grades:[] because the lookup was refused,
// not because PlayHQ has none. Compare the ones that got through first: Bendigo 72
// grades, Altona Bay 38, Swan Hill 16.
//
// aimdRun requeues a blocked item to the BACK of the queue instead of dropping it,
// cuts concurrency to 60% on any blocked batch, lowers the cap after three
// consecutive blocked batches, backs off 5s × consecutive blocked batches, and
// recovers +10 after two clean ones. Nothing here is tuned differently - the
// numbers are the ones already proven against this API.
const AIMD_MIN         = 3;
const AIMD_CUT         = 0.6;
const AIMD_RECOVER     = 10;
const AIMD_CLEAN_BATCHES_TO_RECOVER = 2;
const AIMD_BLOCKED_BATCHES_TO_LOWER_CAP = 3;
const AIMD_BACKOFF_MS  = 5000;

async function aimdRun(items, label, worker, opts = {}) {
  const cap0 = Math.max(AIMD_MIN, opts.cap || 25);
  const queue = items.slice();          // blocked items go to the BACK, never dropped
  let cap = cap0, concurrency = cap0;
  let consecutiveBlocked = 0, cleanBatches = 0;
  let done = 0, blockedEvents = 0, givenUp = 0;
  const attempts = new Map();
  const startTime = Date.now();
  let lastLog = startTime;

  while (queue.length) {
    const batch = queue.splice(0, concurrency);
    const results = await Promise.allSettled(batch.map(async (item) => {
      const r = await worker(item);
      return { item, blocked: !!(r && r.blocked) };
    }));

    let batchBlocked = 0;
    for (const res of results) {
      if (res.status === 'fulfilled' && res.value.blocked) {
        const key = opts.key ? opts.key(res.value.item) : res.value.item;
        const n = (attempts.get(key) || 0) + 1;
        attempts.set(key, n);
        // A ceiling, so a permanently-refused item cannot spin the queue forever.
        // Giving up is REPORTED, never silent: a season left without grades because
        // we stopped asking must not look like a season with no grades.
        if (n >= (opts.maxAttempts || 4)) { givenUp++; done++; continue; }
        batchBlocked++; blockedEvents++; queue.push(res.value.item);
      } else done++;
    }

    if (batchBlocked > 0) {
      consecutiveBlocked++; cleanBatches = 0;
      concurrency = Math.max(AIMD_MIN, Math.floor(concurrency * AIMD_CUT));
      if (consecutiveBlocked >= AIMD_BLOCKED_BATCHES_TO_LOWER_CAP) { cap = Math.max(AIMD_MIN, cap - 5); concurrency = Math.min(concurrency, cap); }
      const backoff = Math.min(60000, consecutiveBlocked * AIMD_BACKOFF_MS);
      console.log(`    ⚠ ${label}: ${batchBlocked} blocked in batch → conc=${concurrency} cap=${cap}, backoff ${backoff / 1000}s (queued ${queue.length})`);
      await sleep(backoff);
    } else {
      consecutiveBlocked = 0; cleanBatches++;
      if (cleanBatches >= AIMD_CLEAN_BATCHES_TO_RECOVER) { concurrency = Math.min(cap, concurrency + AIMD_RECOVER); cleanBatches = 0; }
    }

    const now = Date.now();
    if (now - lastLog >= 15000) {
      lastLog = now;
      const el = (now - startTime) / 1000, rate = el > 0 ? done / el : 0;
      console.log(`    …${label} ${done} done, ${queue.length} queued  conc=${concurrency} cap=${cap}  rate=${rate.toFixed(1)}/s`);
    }
  }
  return { done, blockedEvents, givenUp };
}

// ─── The query ────────────────────────────────────────────────────────────────
// Reduced to the fields this needs from the shape captured off PlayHQ's own site
// on 2026-09-07. Their version also pulls OrganisationDetails, logos, contacts and
// tenantConfiguration; none of that is used here and asking for it would be a
// bigger response for nothing. The competitions/seasons selection is unchanged.
//
// organisationID and organisationCode are the SAME value in the captured call
// (both "5433b0e3"), so only organisationID is needed once discoverOrganisation is
// dropped.
const Q_ORG_COMPETITIONS = {
  operationName: 'discoverCompetitions',
  query: `query discoverCompetitions($organisationID: ID!) {
  discoverCompetitions(organisationID: $organisationID) {
    id
    name
    seasons(organisationID: $organisationID) {
      id
      name
      startDate
      endDate
      status { name value }
    }
    organisation { id name }
  }
}`,
};

// discoverSeason, for --season and for resolving grades on a newly found season.
// Copied from discover-seasons.js L258.
const Q_DISCOVER_SEASON = {
  operationName: 'gradeListDiscoverSeason',
  query: `query gradeListDiscoverSeason($id: String!) {
  discoverSeason(seasonID: $id) {
    id name
    competition { id name type organisation { id name } }
    grades { id name age { name } gender { name } }
  }
}`,
};

async function gql(body, label) {
  await ensureSession();
  let res;
  try {
    res = await doFetch(API_URL, {
      method: 'POST',
      headers: { ...HEADERS_BASE, 'request-id': crypto.randomUUID(), 'Cookie': sessionCookie },
      body: JSON.stringify(body),
    });
  } catch (err) { return { kind: 'error', err }; }

  if (res.status === 403) {
    let b = ''; try { b = await res.text(); } catch {}
    // A CloudFront block is a transport problem; an application 403 is an answer.
    // Conflating them is how a blocked run gets recorded as "nothing found".
    if (b.includes('DOCTYPE') || b.includes('Request blocked')) return { kind: 'blocked' };
    return { kind: 'forbidden' };
  }
  if (res.status === 429 || res.status === 503) return { kind: 'blocked' };
  if (!res.ok) return { kind: 'error', err: new Error(`HTTP ${res.status} (${label})`) };

  let json; try { json = await res.json(); } catch (err) { return { kind: 'error', err }; }
  if (json.errors?.length) return { kind: 'error', err: new Error(json.errors[0]?.message || 'gql') };
  return { kind: 'ok', data: json.data || json };
}

const discoverSeason = async (id) => {
  const r = await gql({ ...Q_DISCOVER_SEASON, variables: { id } }, 'discoverSeason');
  return r.kind === 'ok' ? (r.data.discoverSeason || null) : (r.kind === 'blocked' ? { blocked: true } : null);
};

// ─── git: copied from discover-seasons.js L465 ────────────────────────────────
const GIT_OPTS = { cwd: ROOT, stdio: 'pipe', timeout: 10 * 60 * 1000, maxBuffer: 512 * 1024 * 1024 };
const PUSH_ATTEMPTS = 60;

function gitCommit(msg, paths = []) {
  if (DRY_RUN) return;
  const uniq = [...new Set(paths)].filter(Boolean);
  if (!uniq.length) { log('nothing to commit (no paths given).'); return; }
  let addFailures = 0;
  for (const p of uniq) {
    try { execSync(`git add -- ${p}`, GIT_OPTS); }
    catch (e) {
      const detail = ((e.stderr && e.stderr.toString()) || e.message || '').trim().split('\n')[0];
      if (/did not match any file/i.test(detail)) continue;
      addFailures++;
      console.error(`  ⚠ git add FAILED "${p}": ${detail}`);
    }
  }
  const staged = execSync('git diff --staged --shortstat', GIT_OPTS).toString().trim();
  if (!staged) {
    if (addFailures) throw new Error(`gitCommit: nothing staged and ${addFailures} path(s) failed to stage — refusing to report a clean no-op ("${msg}")`);
    log('nothing to commit.'); return;
  }
  log(`staging: ${staged}`);
  execSync(`git commit -q -m "${msg}"`, GIT_OPTS);
  for (let attempt = 1; attempt <= PUSH_ATTEMPTS; attempt++) {
    try { execSync('git merge --abort', GIT_OPTS); } catch {}
    try {
      execSync('git fetch origin main', GIT_OPTS);
      execSync('git merge -q -X ours FETCH_HEAD --no-edit --no-stat', GIT_OPTS);
      execSync('git push origin main', GIT_OPTS);
      log(`pushed${attempt > 1 ? ` (attempt ${attempt})` : ''}`);
      return;
    } catch (e) {
      if (attempt === PUSH_ATTEMPTS) throw new Error(`push failed after ${PUSH_ATTEMPTS} attempts: ${e.message.split('\n')[0]}`);
      execSync(`sleep ${1 + Math.floor(Math.random() * 91)}`, { stdio: 'pipe' });
    }
  }
}

// ─── Build a season entry ─────────────────────────────────────────────────────
// Same shape and the same locked/removed rules as discover-seasons.js L562-587,
// so an entry created here is indistinguishable from one created there.
function buildEntry(sid, meta, ds) {
  const grades  = (ds?.grades || []).map(g => ({ id: g.id, name: g.name, age: g.age?.name, gender: g.gender?.name }));
  const compName = ds?.competition?.name || meta.compName || '';
  const orgName  = ds?.competition?.organisation?.name || meta.orgName || '';
  const base = {
    id: sid,
    name: ds?.name || meta.name,
    fullName: `${compName} — ${ds?.name || meta.name}`,
    compName,
    compId: ds?.competition?.id || meta.compId,
    orgName,
    orgId: ds?.competition?.organisation?.id || meta.orgId,
    tenant: 'bv',
    status: meta.status || null,
    startDate: meta.startDate || null,
    endDate: meta.endDate || null,
    discoveredBy: 'org',        // provenance: which route found it
  };
  if (grades.length > 0) return { entry: { ...base, grades, locked: false, addedAt: new Date().toISOString() }, kind: 'created' };
  // COMPLETED with no grades is not crawlable - record existence only. Anything
  // else with no grades is a pre-allocation: live, awaiting grades. That is the
  // normal state of an UPCOMING season and exactly what this tool is for.
  if (meta.status === 'COMPLETED') return { entry: { ...base, grades: [], locked: true, removed: true, addedAt: new Date().toISOString() }, kind: 'removed' };
  return { entry: { ...base, grades: [], locked: false, addedAt: new Date().toISOString() }, kind: 'pre-allocated' };
}

async function main() {
  log(`discover-org-seasons${DRY_RUN ? '  (DRY RUN)' : ''}${ONE_SEASON ? `  season=${ONE_SEASON}` : ''}${ONE_ORG ? `  org=${ONE_ORG}` : ''}`);
  console.log('─'.repeat(70));

  const index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
  index.seasons = index.seasons || {};
  const known = new Set(Object.keys(index.seasons));
  log(`known seasons: ${known.size}`);

  const found = [];     // { sid, meta }
  let blocked = 0, errors = 0;

  // ── --season: one id, straight to discoverSeason ────────────────────────────
  if (ONE_SEASON) {
    if (known.has(ONE_SEASON)) {
      const e = index.seasons[ONE_SEASON];
      log(`ALREADY KNOWN: ${ONE_SEASON}  ${e.fullName || e.name}  locked=${e.locked}  grades=${(e.grades || []).length}  status=${e.status}`);
      log('nothing to do. If the nightly is not crawling it, locked/grades is where to look.');
      return;
    }
    const ds = await discoverSeason(ONE_SEASON);
    if (ds && ds.blocked) { console.error('BLOCKED by CloudFront — try again from a fresh runner.'); process.exit(1); }
    if (!ds) { console.error(`discoverSeason returned nothing for ${ONE_SEASON}. Wrong id, or PlayHQ will not serve it.`); process.exit(1); }
    found.push({ sid: ONE_SEASON, meta: { name: ds.name, compName: ds.competition?.name, compId: ds.competition?.id, orgName: ds.competition?.organisation?.name, orgId: ds.competition?.organisation?.id, status: null, startDate: null, endDate: null }, ds });
    log(`found ${ONE_SEASON}  "${ds.name}"  ${ds.competition?.organisation?.name || ''}  ${(ds.grades || []).length} grades`);
  } else {
    // ── Org sweep ────────────────────────────────────────────────────────────
    const orgs = new Map();
    for (const se of Object.values(index.seasons)) {
      if (se.orgId && !orgs.has(se.orgId)) orgs.set(se.orgId, se.orgName || se.orgId);
    }
    const orgList = ONE_ORG ? [[ONE_ORG, orgs.get(ONE_ORG) || ONE_ORG]] : [...orgs];
    log(`organisations to ask: ${orgList.length}`);

    let done = 0;
    for (let i = 0; i < orgList.length; i += CONCURRENCY) {
      const batch = orgList.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map(async ([orgId, orgName]) => {
        const r = await gql({ ...Q_ORG_COMPETITIONS, variables: { organisationID: orgId } }, 'discoverCompetitions');
        return { orgId, orgName, r };
      }));
      for (const { orgId, orgName, r } of results) {
        done++;
        if (r.kind === 'blocked')   { blocked++; continue; }
        if (r.kind === 'forbidden') { continue; }
        if (r.kind !== 'ok')        { errors++; console.log(`  ⚠ ${orgId} ${orgName}: ${r.err?.message}`); continue; }
        for (const comp of (r.data.discoverCompetitions || [])) {
          for (const se of (comp.seasons || [])) {
            if (!se?.id || known.has(se.id)) continue;
            if (found.some(f => f.sid === se.id)) continue;
            found.push({ sid: se.id, meta: {
              name: se.name, compName: comp.name, compId: comp.id,
              orgName: comp.organisation?.name || orgName, orgId: comp.organisation?.id || orgId,
              status: se.status?.value || null, startDate: se.startDate || null, endDate: se.endDate || null,
            } });
            console.log(`  ✦ new: ${se.id}  ${comp.name} — ${se.name}  (${se.status?.value || '?'}, ${se.startDate || '?'})  ${orgName}`);
          }
        }
      }
      if (done % 50 === 0 || done === orgList.length) log(`asked ${done}/${orgList.length} organisations, ${found.length} new season(s) so far`);
      if (i + CONCURRENCY < orgList.length) await sleep(300);
    }
    if (blocked) log(`⛔ ${blocked} organisation(s) were CloudFront-blocked and were NOT asked — re-run for those.`);
  }

  if (!found.length) {
    log(`no seasons found that are not already in the index.${blocked ? ' NOTE: some orgs were blocked, so this is not a complete answer.' : ''}`);
    return;
  }

  // ── Resolve grades for each new season ─────────────────────────────────────
  const needGrades = found.filter(f => !f.ds);
  if (needGrades.length) {
    log(`\nresolving grades for ${needGrades.length} new season(s) (AIMD, cap ${CONCURRENCY})…`);
    const r = await aimdRun(needGrades, 'grades', async (f) => {
      const ds = await discoverSeason(f.sid);
      if (ds && ds.blocked) return { blocked: true };   // requeued, not discarded
      f.ds = ds;
      return { blocked: false };
    }, { cap: CONCURRENCY, key: (f) => f.sid, maxAttempts: 4 });
    const stillNone = needGrades.filter(f => !f.ds).length;
    log(`grades resolved for ${needGrades.length - stillNone}/${needGrades.length}  (${r.blockedEvents} block events, ${r.givenUp} gave up after 4 attempts)`);
    if (stillNone) {
      // Stated, not buried. A season written with grades:[] because we were refused
      // looks identical on disk to one PlayHQ genuinely has no grades for, and the
      // difference decides whether anyone should go looking.
      log(`⚠ ${stillNone} season(s) will be written with grades:[] because the lookup was BLOCKED, not because PlayHQ has none.`);
      log('  discover-seasons.js grade-refresh fills these on the weekly sweep; they are live either way.');
    }
  }

  let created = 0, removedN = 0, prealloc = 0;
  const byStatus = new Map();
  for (const f of found) {
    const { entry, kind } = buildEntry(f.sid, f.meta, f.ds);
    index.seasons[f.sid] = entry;
    if (kind === 'created') created++; else if (kind === 'removed') removedN++; else prealloc++;
    byStatus.set(f.meta.status || '?', (byStatus.get(f.meta.status || '?') || 0) + 1);
    console.log(`  ${kind === 'removed' ? '~' : '+'} ${kind.padEnd(14)} ${f.sid}  ${entry.fullName}  (${(entry.grades || []).length} grades, ${entry.status || '?'})`);
  }

  console.log(`\n  new seasons      : ${found.length}`);
  console.log(`    with grades    : ${created}`);
  console.log(`    pre-allocated  : ${prealloc}  (live, awaiting grades — the UPCOMING case)`);
  console.log(`    recorded only  : ${removedN}  (COMPLETED, 0 grades, not crawlable)`);
  console.log(`  by status        : ${[...byStatus].map(([k, v]) => `${k}=${v}`).join('  ')}`);
  const blockedGradeless = found.filter(f => !f.ds && (f.meta.status !== 'COMPLETED')).length;
  if (blockedGradeless) console.log(`  \u26a0 of the pre-allocated, ${blockedGradeless} have grades:[] from a BLOCKED lookup, not from having none`);

  if (DRY_RUN) { log('dry run — sports-index.json not written.'); return; }
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index));
  gitCommit(`discover-org-seasons: ${found.length} new season(s) (${prealloc} pre-allocated)`, [INDEX_FILE_REL]);
  log('the nightly crawl picks up anything with locked:false on its next run.');
}

main().catch(err => { console.error(`FATAL: ${err.stack || err.message}`); process.exit(1); });
