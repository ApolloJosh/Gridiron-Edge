# Gridiron Edge 🏈

NFL matchup analysis tool for identifying betting edges. Built by Apollo Media.

Sister project to [Diamond Edge](https://github.com/ApolloJosh/diamond-edge) (MLB).

## What it does

### Edge Board (home)

Opens on a scan of the **entire slate** — every game, every qualifying player — ranked by
EDGE score, with the **top 10 at each position**: QB, RB, WR, TE and DEF. Click any row to
drop into that game's full matchup breakdown.

The scan reads the whole league in about two seconds using ESPN's bulk stats endpoint
(five requests instead of ~2,000), reconciles offseason team changes against current
rosters, pulls per-game weather, and scores every player through the same engine the
matchup cards use — so a player's EDGE is identical in both views by construction.

Qualifiers need 6+ games and meaningful volume, so one-game wonders stay off the board.
Bye teams are excluded automatically.

**Games already played are excluded by default.** A finished game can't be bet, and its
players would otherwise sit on the board all week crowding out the matchups still ahead of
you. An "Include played games" toggle brings them back, marked FINAL. Separately, if the
stat sample is from the same season as a completed game, that row is flagged
*result is in the stat sample* — the projection would be partly built from the outcome it
claims to predict. See [api-notes §10](docs/api-notes.md).

### Matchup view

For every player on the slate, it separates **what he has actually done** from **what to
expect this week**:

- **Season block** — real production, color-graded against fixed tiers
- **Projected line** — that season baseline run through a chain of matchup factors,
  with every factor and its multiplier shown on the card

Covered positions:

- **QB** — exactly one per team. The starter is resolved from the depth chart, filtered by this
  game's injury report *and the week's practice report*, and cross-checked against who's actually
  throwing the ball this season;
  a promoted backup or an unclear QB situation is flagged on the card. Backup QBs are never
  projected — unlike every other position, QB2 doesn't take snaps.
- **QB stats** — yards/game, passer rating, YPA, completion %, TD%, INT%, TD/game, rush yards/game
- **WR / TE** — yards/game, targets/game, receptions/game, YPR, TDs
- **RB** — yards/game, carries/game, YPC, receptions/game, TDs
- **Defenders** — tackles/game, sacks/game, INTs/game, passes defended, TFL, forced fumbles
  for the six most productive players on the defense being faced

Plus: league-wide defensive ranks (1–32) for every opponent, weather flags, injury report,
divisional-game flag, bye teams, and a week selector for any week of any recent season.

## How it's actually doing

The tool grades itself. Every scan snapshots its projections; once the week is final **The
Over Board** scores them the way they're actually bet: of the picks you'd have taken, how many
cleared their projected **median**, and where in the range they landed.

- **Cohorts** — Top 3 / Top 5 per position, EDGE 75+, or everything. Top 3 is the default
  because that's how the board gets played.
- **Landing chart** — every pick plotted in band-widths from its own median, so players at
  wildly different yardage scales sit on one axis.
- **Injury screen** — a pick where the player saw under 50% of his expected workload is set
  aside, not averaged in. A back with three carries was hurt, benched or game-scripted out; it
  says nothing about the matchup. Those are listed so the exclusion is auditable.
- **Table view** for the raw rows, and a plain-language read of what it means for next week.
- **Market picker** — score carries, receptions or a combination market instead of yards. Each
  scan snapshots every market with its own band and EDGE, so any of them can be graded after
  the fact.
- **Week coverage** — if a week isn't on the board, the board says why in plain language rather
  than omitting it: no snapshot was taken before kickoff, the week is still in progress (with
  the game count), or grading errored. A week graded on a partial slate is labeled as such.

**A week is only gradeable from projections captured before its games started.** Rebuilding a
projection after the fact would feed the week's own results back into the numbers meant to
predict them, so a missed week stays missed. To stop that happening by accident, scanning any
week now also snapshots the **next** week in the background — so skipping a week no longer
erases it.

It has already caught and fixed a real defect.

**Weeks 2–3** ([write-up](docs/weeks2-3-2026.md)) exposed a growing quarterback bias of −24
then −36 yards (projecting too low), traced to three separate causes: shrinking starters
toward a mean built half from backups, averaging relief appearances into starters' baselines,
and ignoring that 2026 passing is up 3.8% on 2025. Fixing all three took Week 2 bias to **−0.3**
and Week 3 to **−13.6**, with MAE improving in both weeks. Running backs and receivers were
already within a few yards and were left alone.

**First live week** ([full write-up](docs/week1-2026.md)):

| Week 1 2026 (n=188) | Result |
|---|---|
| Band coverage | **46.8%** vs ideal 50 — the range works out of sample |
| Overall bias | +0.6 yards — unbiased in aggregate |
| RB / WR-TE MAE | 25.4 / 25.7 |
| QB MAE | 71.0, correlation **−0.18** — no information |
| Projected players who never played | **17.2%** → fixed to 9.0% in v6 |

What it got wrong and what changed: elite baselines overshot by +12.8 yards (now shrunk toward
the positional mean), backup QBs were ranked as starters (depth charts now gate the board), and
the opponent term still isn't paying for itself (weight cut 40% → 15%).

## What the data actually supports

Every constant in the model was chosen by backtest, not by intuition — 3,084 player-games,
predicting each week from prior weeks only. Full write-up in [`docs/model.md`](docs/model.md),
re-runnable harness in [`docs/backtest.js`](docs/backtest.js); the closing-line work lives in
[`docs/lines.md`](docs/lines.md). New factors are now tested offline in a few seconds with
[`docs/bench.js`](docs/bench.js) — no ESPN, no browser ([how it works](docs/bench.md)). The
headlines:

- **Opponent rushing defense barely predicts anything.** Full-strength opponent adjustment made
  RB projections *worse* (MAE 26.57 → 27.04). Optimal exponent ≈ 0.10, i.e. almost off.
  Residual correlation: 0.049. Team rushing-defense stats are mostly a game-script artifact.
- **Opponent passing defense does predict, mildly.** QB yards improve at exponent 0.25
  (65.35 → 64.65), residual correlation 0.141. The asymmetry is measured, not assumed.
- **Recency helps volume, hurts passing.** Carries blend 50/50 season+last-3 (4.30 → 4.20 MAE);
  last-3 passing yards is 7% *worse* than the season average.
- **The closing line knows about points, not yards.** A team's implied total correlates
  **+0.428** with the points it actually scores, identically in 2024 and 2025 — but at the
  *player* level that collapses to nothing (residual corr −0.009 and +0.037 on ~2,950
  observations a season). Only **running backs** survived both seasons: +0.068 / +0.084, each
  season independently picking k≈0.6, worth 0.2 yards.
- **A falling MAE is not evidence of signal.** Quarterbacks showed a replicated −0.11 residual
  correlation and an MAE that improved — and the improvement was the *bias* column climbing
  from −10.58 toward zero, the factor absorbing an underprojection that belongs elsewhere. The
  test that separates them: does bias move **away** from zero while MAE falls? Running backs
  pass it in both seasons and in opposite directions; quarterbacks fail it in both.
- **Two traps found on the way.** The factor must be `implied ÷ this team's own prior mean`,
  not `implied ÷ league mean`, because a player's baseline already encodes how good his offense
  is — planted-effect tests recover a known exponent exactly under the first form and attenuate
  it to 0.6 under the second. And `bestK` alone cannot tell a grid's floor from a real interior
  minimum; read the whole curve. Full write-up in [lines.md](docs/lines.md).
- **Volume is twice as predictable as yardage, and combination markets beat their components.**
  Measured across every Fliff market ([markets.md](docs/markets.md)): passing attempts sit at CV
  0.299 against receiving yards' 0.651. Rush + Rec Yards is meaningfully tighter than Rush Yards
  alone, because the components cancel through game script instead of compounding. **Rushing
  attempts** is the one market that is both quiet (CV 0.383) and genuinely predicted by a
  player's own history (corr 0.454). Pass TD, Pass INT and FG Made are noise.
- **Snap counts are a second copy of the box score.** Snap share showed the largest residual
  correlation in the project (+0.30 for QBs) and did not survive two controls: against a
  starts-only baseline the quarterback effect mostly vanished, and divided by plain usage trend
  — carries, targets, attempts — nothing was left at any position. Free data, already known fact.
- **The range beats the point estimate.** Median game-to-game variation is ~60% of a player's
  average — a back averaging 65 yards has a standard deviation near 39. But the 25–75 band from
  his game log held the actual result **47.7%** of the time against an ideal 50%.

So the tool leads with a **range**, demotes the point estimate, and applies opponent factors at
the strength the data justifies rather than the strength that looks impressive.

## The projection model

```
projected line = season per-game baseline × factor₁ × factor₂ × …
```

Each factor declares whether it is modeled yet, so the card shows the full intended chain
and marks what is still pending. Adding a factor is one object in `buildFactors()`.

| Factor | Status | How it works |
|---|---|---|
| Opponent pass defense | **active ^0.25** | Real pass yards allowed per game ÷ league average, aggregated from every box score |
| Opponent run defense | **active ^0.10** | Real rush yards allowed and yards per carry — deliberately near-zero, because that's what it measured |
| Carry volume recency | **active** | 50/50 season + last 3 games, applied to carries only |
| Weather | **active** | Wind gusts and cold suppress passing, mildly help rushing; domes exempt |
| Defensive-player volume | **active** | Opposing offense's actual plays per game vs league average |
| Vegas implied team total | *context — tested, RB only* | Measured at player level over two seasons. No blanket signal (residual corr −0.009 / +0.037). **Running backs** clear it: +0.068 / +0.084, both seasons picking k≈0.6, MAE better in both while bias moves *away* from zero — signal, not bias absorption. QB looked promising and failed that same test. Gain is 0.2 yards; not yet wired in. See [lines.md](docs/lines.md) |
| Defense vs archetype | *pending* | Needs charting data ESPN doesn't expose publicly |

**Archetypes are already classified** from production shape — Deep threat, Volume WR1,
Possession WR, Receiving back, Bruiser, Explosive back, Move TE, Dual threat, Pocket passer.
The classification is live and tagged on each card; what's missing is the *defense vs that
archetype* half, which requires slot/wide snap counts and box-count data. Rather than invent
a number, that factor renders as pending.

### EDGE score

Still on every card: 0–100, **85% production grade + 15% opponent softness**. The opponent term
was 40% until Week 1 2026 showed it wasn't earning it — see [docs/week1-2026.md](docs/week1-2026.md).

| EDGE | Read |
|---|---|
| 72+ | Smash spot |
| 58–71 | Lean |
| 42–57 | Neutral |
| 28–41 | Soft fade |
| < 28 | Fade |

**Honest limitations.** ESPN's public feed does not expose yards allowed by position or
DVOA. Points allowed is *total* defense, not split pass/rush. The pass-D and run-D ranks are
composites of sack rate, passes-defended rate, run-stuff rate and tackles-for-loss rate —
directional signals, not opponent-adjusted efficiency. Treat a projection as a shortlist
generator, then price it against your book's actual number.

## How to use it

Open `index.html` in any browser. No build step, no install, no account, no API key.
Requires an internet connection to pull live ESPN data. Works on phones.

**Check the build stamp.** The header shows a version (e.g. `v13 · 2026-10-09`). If it doesn't
match the build you just updated to, you're looking at a cached or older copy — hard-reload
(⌘⇧R), and if you're on GitHub Pages give it a minute to publish.

**Rescan** drops every cached API response and re-pulls. Normal navigation reuses responses
for 5 minutes, so game states refresh on their own without hammering ESPN.

## Design

Field green with white chalk lines, goalpost-yellow accents for projections and highlights,
and football-leather brown for shadows and the projection plate. Barlow Condensed for
numbers, Inter for body text.

## Data source

ESPN public APIs — free, no key needed. See [`docs/api-notes.md`](docs/api-notes.md) for
verified endpoints and the fields that lie.

Early in a new season ESPN still reports the prior year's totals; the tool detects this,
falls back automatically, and labels which season each stat came from.

## Roadmap

- [ ] Run the closing-line factor at player level and ship or kill it ([lines.md](docs/lines.md))
- [ ] Live wind from a real forecast source — nflverse's wind is recorded after kickoff, not predicted
- [x] ~~Practice reports (DNP / Limited / Full)~~ — v13: badges on every row and card, Out/Doubtful filtered by default, and merged into the QB starter resolution
- [x] ~~Snap counts~~ — tested and rejected: the signal is usage signal the box score already has ([bench.md](docs/bench.md))
- [ ] Model the kickoff-window / game-script factor
- [ ] Defense vs archetype (needs a charting data source — PFF, Sports Info Solutions)
- [ ] True yards allowed by position (requires aggregating opponent box scores)
- [ ] Line movement tracker (reverse line movement, key numbers at 3 / 7 / 10)
- [x] ~~Project the quiet markets too~~ — v12: per-position market toggle, EDGE recomputed per market
- [x] ~~Grade the alternate markets on the Over Board~~ — v12
- [ ] Player prop comparison vs the book's posted line
- [ ] Depth chart ordering instead of production ordering for early-season slates

## Stack

Vanilla HTML + React via CDN + ESPN public APIs. No framework, no build tooling, no
dependencies to install.

---

Part of the Apollo Media sports tools suite. For entertainment and research purposes —
nothing here is financial advice.
