/**
 * The Edge Finder export must carry exactly the rows the weekly snapshot
 * stores, and be built from the live scan rather than the stored week (which
 * freezes at the first kickoff).
 *
 *   node docs/export.test.js
 */
const fs = require("fs");
const src = fs.readFileSync(__dirname + "/../index.html", "utf8")
  .match(/<script type="text\/babel"[^>]*>([\s\S]*?)<\/script>/)[1];
const grab = (re, l) => { const m = src.match(re); if (!m) throw new Error("missing " + l); return m[0]; };
const mem = {};
global.localStorage = {
  getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); },
  get length() { return Object.keys(mem).length; }, key: (i) => Object.keys(mem)[i],
};
eval([
  grab(/const BUILD = "[^"]+";/, "BUILD"),
  grab(/const BAND_VERSION = \d+;/, "BAND_VERSION"),
  grab(/const DEPTH_LIMIT = \{[^}]+\};/, "DEPTH_LIMIT"),
  grab(/const store = \{[\s\S]*?\n\};/, "store"),
  grab(/const USAGE_STAT = \{[^}]+\};/, "USAGE_STAT"),
  grab(/const USAGE_PROJ = \{[\s\S]*?\n\};/, "USAGE_PROJ"),
  grab(/const boardVisible = \(r\) => \{[\s\S]*?\n\};/, "boardVisible"),
  grab(/function snapMarkets\(r\) \{[\s\S]*?\n\}/, "snapMarkets"),
  grab(/function snapRows\(rows\) \{[\s\S]*?\n\}/, "snapRows"),
  grab(/function saveProjections\([\s\S]*?\n\}/, "saveProjections"),
  grab(/function exportPayload\(scan, week\) \{[\s\S]*?\n\}/, "exportPayload"),
].join("\n") + "\nglobal.G = { snapRows, saveProjections, exportPayload, store, BUILD, BAND_VERSION };");
const G = global.G;

let fails = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) fails++; };

const band = (m, a, b) => ({ medianAdj: m, p25adj: a, p75adj: b });
const qb = (id, name, depth, started, yds) => ({
  player: { id, name }, pos: "QB", kind: "QB", team: "CIN", opp: "DEN", depth, started, score: 70,
  game: { id: "g1" },
  analysis: {
    headline: { logKey: "passingYards", key: "yds" }, projected: { yds }, band: band(yds - 10, yds - 50, yds + 30),
    baselineAtt: 34,
    markets: { passYds: { id: "passYds", avail: true, proj: yds, band: band(yds - 10, yds - 50, yds + 30),
                          score: 70, label: "Pass Yds", keys: ["passingYards"], d: 1 } },
  },
});
const rows = [
  qb("1", "Starter", 1, false, 250),
  qb("2", "Backup", 2, false, 180),          // QB depth limit is 1
  qb("3", "Already Played", 1, true, 270),   // game kicked off
  { player: { id: "9", name: "D" }, pos: "DEF", kind: "DEF", started: false, analysis: {} },
];
const scan = { scanYear: 2026, rows };

const p = G.exportPayload(scan, 8);
ok(p.source === "gridiron-edge" && p.build === G.BUILD, "payload names its source and build");
ok(p.snapshot.year === 2026 && p.snapshot.week === 8 && p.snapshot.band === G.BAND_VERSION, "year, week and band version carried");
ok(p.snapshot.rows.length === 1 && p.snapshot.rows[0].name === "Starter", "only what the board shows: no backup QB, no started game, no DEF");
const mk = p.snapshot.rows[0].markets.passYds;
ok(mk && mk.median === 240 && mk.p25 === 200 && mk.p75 === 280 && mk.score === 70, "per-market median, p25, p75 and score present (what Edge Finder reads)");

G.saveProjections(2026, 8, rows);
const stored = G.store.get("gx_proj_2026_8");
ok(JSON.stringify(stored.rows) === JSON.stringify(G.snapRows(rows)), "weekly snapshot stores exactly snapRows()");
ok(JSON.stringify(stored.rows) === JSON.stringify(p.snapshot.rows), "export rows == snapshot rows for the same scan");

const later = [qb("1", "Starter", 1, false, 210), ...rows.slice(1)];
G.saveProjections(2026, 8, later, { live: true });
ok(G.store.get("gx_proj_2026_8").rows[0].proj === 250, "a live week's stored snapshot stays frozen");
ok(G.exportPayload({ scanYear: 2026, rows: later }, 8).snapshot.rows[0].proj === 210, "the export follows the current scan, not the frozen week");

console.log(fails ? `\n${fails} failed` : "\nall green");
process.exit(fails ? 1 : 0);
