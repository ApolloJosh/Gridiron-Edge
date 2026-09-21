# ESPN NFL API notes

Everything below was verified against live responses. The traps section exists because
each one returned **HTTP 200 with useless data** — the failure mode that cost the most
time on the Diamond Edge (MLB) build.

## Endpoints in use

| Purpose | URL |
|---|---|
| Slate for a week | `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week={n}&dates={year}` |
| Current week discovery | same URL with no parameters |
| Standings (points allowed, records) | `https://site.api.espn.com/apis/v2/sports/football/nfl/standings?season={year}` |
| Team + roster | `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/{teamId}?enable=roster` |
| Athlete season stats | `https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/{id}/stats` |
| Team defensive stats | `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/{year}/types/2/teams/{teamId}/statistics` |
| Weather + injuries | `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event={eventId}` |

No API key. No rate limit hit at ~40 requests per game view.

## Traps — verified, do not "fix" these back

**1. `team.athletes` is a flat array.**
With `?enable=roster` the roster comes back as a flat list of ~77 athlete objects, each
carrying its own `position`. It is *not* grouped into `{ position, items: [] }`. Code that
loops `group.items` silently yields zero players.

**2. Athlete stats are at `categories[].statistics[]`, not `splits.categories[].stats[]`.**
Each `statistics[]` entry is one **season** of a career. Its `stats` array is positionally
parallel to the category's `names` array — you index by position, not by key lookup:

```js
names.forEach((n, i) => { values[n] = latest.stats[i]; });
```

Real field names: `QBRating`, `adjQBR`, `completionPct`, `passingYards`,
`yardsPerPassAttempt`, `passingTouchdowns`, `interceptions`, `rushingAttempts`,
`rushingYards`, `yardsPerRushAttempt`, `rushingTouchdowns`, `receptions`,
`receivingTargets`, `receivingYards`, `yardsPerReception`, `receivingTouchdowns`,
`gamesPlayed`. There is no `YPA`, `TD%`, `INT%` or `passerRating` field — the percentages
are computed from attempts.

Values are display strings with thousands separators (`"2,267"`). Strip commas before
`parseFloat`.

**3. `yardsAllowed` and `pointsAllowed` in the core `defensive` category are always 0.**
Both fields exist on all 32 teams and both return `0` while the response is HTTP 200.
Real points allowed comes from the **standings** endpoint (`pointsAgainst`), which also
gives wins/losses/ties for the per-game divisor — all 32 teams in one request.

Fields in that category that *are* real: `sacks`, `passesDefended`, `stuffs`,
`tacklesForLoss`, `soloTackles`, `totalTackles`, `teamGamesPlayed`.

**4. The `/teams` list endpoint is not CORS-open.**
`.../nfl/teams` fails with `TypeError: Failed to fetch` from any origin other than ESPN's
own, so it can't be used from a `file://` page. The team id → abbreviation map is built
from the standings response instead. The scoreboard, standings, athlete-stats, core-stats
and summary endpoints all send permissive CORS headers and work fine from `file://`.

**5. Weather has no `windSpeed` field.**
`summary.gameInfo.weather` returns `temperature`, `highTemperature`, `conditionId` and
`gust`. Use `gust` as the wind proxy. The scoreboard's own `competitions[].weather` is
frequently absent entirely on unplayed games, so the summary endpoint is the reliable read.
Dome games still report outdoor conditions — check `venue.indoor` before flagging wind.

**6. Rosters are not in depth-chart order.**
The QB list for a team can come back with the third-stringer first. Players are ranked by
season volume (pass attempts / receiving yards / carries) rather than array order. Early in
a season, before volume exists, this ordering is unreliable — a real depth chart endpoint
is on the roadmap.

**7. Verify player IDs before debugging anything else.**
Carried over from the MLB build, where a long debugging session was spent on ID 605612
(Harold Castro, an infielder) while trying to diagnose Seth Lugo's pitching splits
(actual ID 607625). Check the name that comes back before assuming the endpoint is broken.

## 8. The bulk endpoint — the whole league in one request

```
https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/statistics/byathlete
  ?region=us&lang=en&contentorigin=espn&isqualified=false
  &season={year}&seasontype=2&page=1&limit={n}&sort={category.field}:desc
```

Verified: `limit=250` returns 250 athletes, all 32 teams represented, every stat category
attached. This is what makes the Edge Board possible — scanning the slate by roster would be
roughly 2,000 athlete calls; five sorted pulls here cover the league in about two seconds.

Sorts in use: `passing.passingYards:desc`, `receiving.receivingYards:desc`,
`rushing.rushingYards:desc`, `defensive.totalTackles:desc`, `defensive.sacks:desc`.
Players appear in several pulls, so de-duplicate by athlete id.

**Its shape differs from the per-athlete feed.** Each athlete's `categories[]` carry a
`values` array with no field names on it; the schema lives at the **response** level in
`categories[].names`. Zip them by position:

```js
const schema = {};
(d.categories || []).forEach(c => { schema[c.name] = c.names || []; });
// then per athlete category: schema[c.name][i] -> c.values[i]
```

`count` and `pageCount` come back undefined and `pagination` is an empty object — page by
asking for a bigger `limit` rather than trusting a page count.

### 8a. Verified defensive field names

```
general:                 gamesPlayed, fumblesForced, fumblesRecovered, fumblesTouchdowns
defensive:               soloTackles, assistTackles, totalTackles, sacks, sackYards,
                         tacklesForLoss, passesDefended, longInterception
defensiveinterceptions:  interceptions, interceptionYards, interceptionTouchdowns
```

Note the casing: the bulk feed spells it **`defensiveinterceptions`** (all lowercase) while
the team-level feed uses `defensiveInterceptions`. `statOf()` is therefore case-insensitive.

It is also **scoped**, and that matters more than the casing: `interceptions` means *thrown*
picks inside `passing` and *caught* picks inside `defensiveinterceptions`. Reading it
globally would credit a quarterback's giveaways to a safety.

## 9. The bulk feed reports the team a player played for THAT SEASON

Not his current team. Combined with the season fallback (§ below), that means a scan run in
September is filing players under last year's rosters. Measured at Week 1 of 2026: **157 of
684 players in the slate had changed teams** — 23% of the board would have been matched
against the wrong defense.

The Edge Board fixes this by fetching the 32 current rosters for the week's games and
building an `athleteId → current team` map that overrides the stats feed. Players whose
production came with another team are tagged `stats w/ {OLD}` on the row, because the
production itself is still from a different offense and deserves a second look.

Spot-verified at Week 1 2026: Travis Etienne Jr. → NO, Kenny Gainwell → TB,
Wan'Dale Robinson → TEN, all confirmed against the live roster endpoint.

## 10. Played games on the board, and the leakage guard

ESPN's week endpoint returns the whole week, including games that have already finished —
`competitions[].status.type.state` is `pre` | `in` | `post`. Two separate problems follow.

**a) A finished game can't be bet.** At Week 1 of 2026, NE @ SEA and SF @ LAR were already
final, and their players occupied four of the top slots on the board (Stafford 1st QB, Nacua
1st WR, McCaffrey 2nd RB, Smith-Njigba 3rd WR) — 4 of 32 teams crowding out the 14 matchups
still ahead. The board now defaults to `state === "pre"` with an "Include played games"
toggle, and the sidebar shows FINAL with the score.

**b) Data leakage, once stats come from the current season.** While the stat sample falls
back a year, a completed game's result is *not* in the numbers. Verified at Week 1 2026: the
board projected Puka Nacua for 117.6 receiving yards; in the game that had already been
played he had 74. The projection didn't move toward the result, because it was built from his
2025 per-game (107.2) times the SF matchup multiplier.

That stops being true the moment `seasonHasSample()` flips to the current season (around Week
5). From then on, any `post` game on the board is being "projected" using a sample that
already contains its result — the projection is partly predicting an outcome it was fed.
`runScan()` therefore tags each row:

```js
leakage: league.season === year && meta.game.state === "post"
```

and those rows render a "result is in the stat sample" warning. The guard is deliberately
narrow: it fires only when the stat season and the scanned season match, so the honest
fallback case isn't flagged as dirty.

## 11. Two self-inflicted bugs worth not repeating

**The response cache had no expiry.** Every fetch was memoised by URL for the life of the
page, so the Rescan button re-ran the whole pipeline and got byte-identical cached data back
— it could not change anything, ever. Worse, a game flipping from `pre` to `post` while the
page sat open would never be noticed. Entries now expire after 5 minutes and a forced rescan
calls `clearCache()` first.

**The played-game filter trusted a single field.** `state === "post"` is correct (verified),
but if that one key were ever absent the filter fails *open* — finished games quietly return
to the board and nothing looks broken. `hasStarted()` now takes three independent signals:
`state` (`post`/`in`), `status.type.completed`, and kickoff timestamp vs now. Unit-tested
including a degraded feed with `state` and `completed` stripped, where the kickoff time alone
still catches both finished games.

Related: the header carries a `BUILD` stamp. Diagnosing "I updated the file but nothing
changed" without one is guesswork — bump it on every change.

## 12. Real yards allowed — built by inverting box scores

ESPN has no opponent split (`/statistics/{1..4}` all 404, `/statistics/opponent` 404) and its
`yardsAllowed` / `pointsAllowed` fields are phantom zeros. So the tool builds its own:

1. Walk weeks 1–18 of the stat season, collect every `state === "post"` event (272 for a full year).
2. `summary?event={id}` for each — `boxscore.teams[].statistics` carries both teams'
   `totalOffensivePlays`, `totalYards`, `rushingYards`, `rushingAttempts`,
   `yardsPerRushAttempt`, `netPassingYards`, `completionAttempts`.
3. A team's **defense** is every row where it appears as the opponent. What its opponents gained
   is what it allowed.

**Measured cost: 272 box scores in ~6 seconds** at concurrency 8 (~32 ms each), then cached in
`localStorage` under `gx_db_{season}_v5`. The payloads are large (~400 KB each) but they
transfer compressed and parse fast; only the extracted numbers are stored.

This matters beyond tidiness. The old rank proxy (stuffs + TFL + total points allowed) put
Baltimore **24th against the run** — a favorable matchup worth +5.8% on a back's projection.
The real box scores say BAL allowed **106.6 rush yards per game against a league average of
116.9**: an above-average run defense. The proxy had the direction backwards.

## 13. Odds are available, but only looking forward

`competitions[].odds[0]` carries `spread`, `overUnder` and `homeTeamOdds.favorite`
(provider: DraftKings). Implied team total is `overUnder/2 ± |spread|/2`.

It is present on **upcoming** games only. Of 272 completed 2025 games, **zero** retained a
closing line. That is why the implied total is displayed as context and not multiplied into
the projection — there is no way to backtest a weight for it from this feed. Validating it
needs a historical closing-line dataset from somewhere else.

## 14. teamrankings.com cannot be used at runtime

`fetch("https://www.teamrankings.com/…")` from any other origin fails with
`TypeError: Failed to fetch` — no CORS headers. A browser-based tool can never read it live, no
matter how the request is framed. That is a property of their server, not a thing a scraper
subscription changes.

Everything the site provides for team stats — rush/pass yards allowed, yards per carry allowed,
plays per game — is derivable free from the box-score aggregation in §12 and is live rather
than scraped. Paid scraping would only earn its keep for data ESPN genuinely lacks: historical
closing betting lines (§13), or snap counts / route participation / aDOT, which would unlock
the defense-vs-archetype factor.

## 15. Confirming the starting quarterback

Backups matter at every position except this one. A backup running back gets carries; a backup
quarterback gets nothing at all unless the starter goes down. Ranking QB2 isn't a low-value
play, it's a projection for a man who will not take a snap — Tommy DeVito was being projected
for ~100 yards behind a healthy Drake Maye.

**The signals, in order of authority:**

1. **Depth chart** — `sports.core.api.espn.com/v2/…/seasons/{year}/teams/{id}/depthcharts`.
   Three charts per team; the offensive one is whichever carries a `qb` group (name varies:
   "3WR 1TE", "2WR 2TE"). `positions.qb.athletes[]` gives `rank` and an athlete `$ref`.
   Use the **current** season here — a 2025 chart names last year's starter.
2. **This game's injury report** — `summary?event={id}` → `injuries[].injuries[]`. Drop any QB
   listed Out / Doubtful / IR / suspended, then take the highest surviving rank.
3. **Season usage** — bulk `byathlete` sorted by `passing.passingAttempts:desc`, one request,
   gives the attempts leader per team. Fallback when there's no chart, and a cross-check.

**The per-athlete injuries endpoint is useless.** `…/athletes/{id}/injuries` returned **zero
items for every quarterback tested**, including Sam Darnold while he was listed Out. The game
summary's injury block is the only feed that carries it.

**Measured across all 32 teams, Week 2 2026:**

- All 32 resolved to exactly one quarterback.
- Depth chart and usage agreed on **29 of 32**.
- Seattle: chart said Darnold, report said **Darnold Out**, so Drew Lock was promoted — and
  usage confirms it (22 attempts). The rule got this right without special-casing.
- Atlanta and Minnesota disagreed with no injury to explain it (chart: Penix / Murray; usage:
  Rush 22 att / Wentz 19 att). Those are genuine quarterback controversies, so the pick is
  **flagged in the UI rather than silently made**.

Where this is enforced matters. The Edge Board had a depth filter from v6, but the matchup view
did not — it took the top two quarterbacks by attempts, which is exactly how a backup got a
projection. Both paths now run through `resolveStarterQB()`.

## 16. Pin the athlete-stats season, or players get measured over different spans

`athletes/{id}/stats` returns a category per stat type, each holding one entry **per season of
a career**. Taking "the latest season with data" works in the offseason and breaks the moment
the new year starts:

- Jaxson Dart, who had played Week 1 2026, resolved to a **29-attempt 2026** sample.
- Jameis Winston, who had not, resolved to a **66-attempt 2025** season.

Two players on the same depth chart, measured over different spans, sorted against each other
and fed to a model whose constants were fitted on full seasons. `getAthleteSeason(id, season)`
now pins the requested season and falls back only to the most recent **earlier** one.

This is also how a backup displaced a starter in the matchup view. The QB selection had a
fallback — if the resolved starter wasn't in the stats pool, take whoever threw most — and
"threw most" was Winston's full 2025 against Dart's single 2026 game. **Never substitute a
different player for the one you resolved.** If the confirmed starter has no prior line
(a rookie, a first-time starter), show him with what exists and say so.

Verified after the fix, Week 2 2026, all 32 teams: NYG resolves to Jaxson Dart, NE to Drake
Maye, WSH promotes Marcus Mariota (Jayden Daniels Doubtful), SEA promotes Drew Lock
(Sam Darnold Out).

## Season rollover

In early September the new season exists on the scoreboard but every stat endpoint still
holds only the prior year. `getAthleteSeason()` picks the highest season year present, and
`getLeagueDefense()` falls back a year when the current season lacks a usable sample. The
season used is labeled in the UI so a stale number is never presented as current.

**Week 1 is a trap for the fallback test.** After a Thursday opener the standings show two
teams with one game played and thirty with none. A "no games played league-wide" check
therefore does *not* trigger, and the tool computes ranks off a two-team sample — 30 teams
tie on a default and the resulting pass-defense and run-defense ranks come back identical
and meaningless. The test is the **median** team's games played (`>= 4`), not the sum.

Verified: with the median rule at Week 1 of 2026, the tool falls back to 2025 and returns
all 32 teams with real separation (SEA 17.2 PPG allowed, DAL 30.1), and pass-defense and
run-defense ranks differ from one another as they should.
