/**
 * Unit tests for getRoster -- the roster parser.
 *
 *   node docs/roster.test.js
 *
 * v16 moved rosters off `site.api/teams/{id}?enable=roster`, which ESPN closed
 * to CORS, onto `site.web.api/teams/{id}/roster`, which is still open. The two
 * differ in SHAPE: the old one was a flat `team.athletes` array, the new one is
 * six groups under `athletes`, each with `items`.
 *
 * The failure this is guarding against is not a wrong number, it is a SILENT
 * one. safeJSON turns a CORS rejection into null, so the dead endpoint handed
 * back an empty roster instead of an error: every matchup page failed while the
 * Edge Board kept showing EDGEs, because the scan only uses rosters to
 * reconcile offseason moves and quietly fell back to each player's stale team.
 * So these tests pin that an empty or malformed payload yields [] rather than
 * throwing or inventing players, AND that a good payload actually yields some
 * -- a parser that always returns [] would satisfy half of this file.
 *
 * Shapes are fixtures taken from the live endpoint on 2026-10-18 (HOU, id 34).
 * getRoster is extracted from index.html with safeJSON stubbed, so this tests
 * the shipped parser against each shape without touching the network.
 */
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')
  .match(/<script type="text\/babel"[^>]*>([\s\S]*?)<\/script>/)[1];
function grab(re, label) { const m = src.match(re); if (!m) throw new Error('missing ' + label); return m[0]; }

let PAYLOAD = null;   // what the stubbed safeJSON will hand back
const code = [
  grab(/const ESPN_ROSTER = "[^"]*";/, 'ESPN_ROSTER'),
  grab(/const ROSTER_ACTIVE = \[[^\]]*\];/, 'ROSTER_ACTIVE'),
  grab(/async function getRoster\(teamId\) \{[\s\S]*?\n\}/, 'getRoster'),
  'const safeJSON = async () => PAYLOAD;',
].join('\n');
eval(code + '\nglobal.R={getRoster,ROSTER_ACTIVE,ESPN_ROSTER};');
const R = global.R;

let pass = 0, fail = 0;
/* cond is passed as a thunk where it could throw: an assertion that aborts the
   run would hide every assertion after it, which is how a broken parser can
   look like a short clean report. */
const ok = (name, cond, got) => {
  let v;
  try { v = typeof cond === 'function' ? cond() : cond; }
  catch (e) { fail++; console.log('  FAIL ' + name + '   threw: ' + e.message); return; }
  if (v) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (got !== undefined ? '   got: ' + JSON.stringify(got) : '')); }
};
const ath = (id, name, pos) => ({ id, displayName: name, jersey: '1', position: { abbreviation: pos } });

/* The live 2026-10-18 shape: six named groups, each with items. */
const GROUPED = { athletes: [
  { position: 'offense',  items: [ath('7', 'C.J. Stroud', 'QB'), ath('2', 'Nico Collins', 'WR'), ath('3', 'Lineman', 'OT')] },
  { position: 'defense',  items: [ath('4', 'Will Anderson', 'DE')] },
  { position: 'specialTeam', items: [ath('5', 'Kicker', 'PK')] },
  { position: 'injuredReserveOrOut', items: [ath('6', 'Hurt Guy', 'RB')] },
  { position: 'suspended', items: [ath('8', 'Suspended Guy', 'WR')] },
  { position: 'practiceSquad', items: [ath('9', 'Practice Guy', 'QB')] },
]};
/* The pre-v16 flat shape, kept working in case ESPN moves back. */
const FLAT = { athletes: [ath('7', 'C.J. Stroud', 'QB'), ath('2', 'Nico Collins', 'WR')] };

const run = async (payload) => { PAYLOAD = payload; return R.getRoster('34'); };

(async () => {
  console.log('\nthe live grouped shape');
  let r = await run(GROUPED);
  /* 3 offense + 1 defense + 1 specialTeam + 1 IR + 1 suspended + 1 practice = 8 */
  ok('every athlete across every group is returned', r.length === 8, r.length);
  ok('ids and positions survive',
    r.find((p) => p.id === '7')?.pos === 'QB' && r.find((p) => p.id === '7')?.name === 'C.J. Stroud');
  ok('the group travels with each athlete', r.find((p) => p.id === '6')?.group === 'injuredReserveOrOut');
  ok('offense / defense / specialTeam are active',
    ['7', '2', '3', '4', '5'].every((id) => r.find((p) => p.id === id)?.active === true));
  /* The whole point of keeping groups: an IR or practice-squad player must
     never be projected as though he were playing. */
  ok('IR, suspended and practice squad are NOT active',
    ['6', '8', '9'].every((id) => r.find((p) => p.id === id)?.active === false),
    r.filter((p) => !p.active).map((p) => p.id));
  ok('they are still RETURNED, because reconciling a team move needs them',
    ['6', '8', '9'].every((id) => r.some((p) => p.id === id)));

  console.log('\nwhat the matchup view actually gets');
  const OFF_POS = ['QB', 'RB', 'FB', 'WR', 'TE'];
  const offWant = r.filter((p) => p.active && OFF_POS.includes(p.pos));
  ok('the QB on the active offense is included', offWant.some((p) => p.id === '7'));
  ok('the practice-squad QB is excluded', !offWant.some((p) => p.id === '9'));
  ok('the IR running back is excluded', !offWant.some((p) => p.id === '6'));
  ok('offensive linemen are excluded by position', !offWant.some((p) => p.pos === 'OT'));
  ok('the active offense is non-empty, so the view does not throw', offWant.length > 0, offWant.length);

  console.log('\nthe legacy flat shape still parses');
  r = await run(FLAT);
  ok('flat athletes are returned', r.length === 2, r.length);
  ok('with no group, nothing is excluded', r.every((p) => p.active === true));

  console.log('\na dead endpoint yields [] -- never a throw, never a fabrication');
  /* safeJSON returns null on a CORS rejection; this is the exact payload the
     closed endpoint produced, and it must not look like a successful parse. */
  for (const [label, payload] of [
    ['null (what safeJSON returns on a CORS rejection)', null],
    ['undefined', undefined],
    ['an empty object', {}],
    ['athletes missing', { team: { id: '34' } }],
    ['athletes not an array', { athletes: { offense: [] } }],
    ['the old payload shape, now empty', { team: { athletes: [] } }],
    ['groups with no items', { athletes: [{ position: 'offense' }] }],
    ['items that are not athletes', { athletes: [{ position: 'offense', items: [{}, null, { id: '1' }] }] }],
  ]) {
    let res, threw = null;
    try { res = await run(payload); } catch (e) { threw = e; }
    ok(`${label} -> []`, !threw && Array.isArray(res) && res.length === 0, threw ? 'threw: ' + threw.message : res);
  }
  /* An athlete with an id but no position is unusable, but one with both in a
     malformed group must still come through. */
  const MIXED = { athletes: [{ position: 'offense', items: [
    { id: '1' }, { position: { abbreviation: 'WR' } }, ath('2', 'Real Guy', 'WR'), null,
  ] }] };
  const mixed = await run(MIXED);
  ok('unusable entries are dropped but usable ones survive',
    mixed.length === 1 && mixed[0].id === '2', mixed);

  console.log('\nthe endpoint is the one that is actually open');
  ok('rosters no longer point at the CORS-closed site.api /teams family',
    !/site\.api\.espn\.com/.test(R.ESPN_ROSTER), R.ESPN_ROSTER);
  ok('ESPN_ROSTER is the site.web.api host', /site\.web\.api\.espn\.com/.test(R.ESPN_ROSTER), R.ESPN_ROSTER);
  ok('getRoster requests the /roster path, not ?enable=roster',
    /\/roster`/.test(grab(/async function getRoster\(teamId\) \{[\s\S]*?\n\}/, 'getRoster')) &&
    !/enable=roster/.test(grab(/async function getRoster\(teamId\) \{[\s\S]*?\n\}/, 'getRoster')));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
