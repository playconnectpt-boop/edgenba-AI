# EDGE NBA AI — architecture and acceptance criteria

## Product workflow
1. Ingest the complete NBA slate for the selected day.
2. Ingest player game logs, minutes, starter status, opponent and schedule context.
3. Ingest timestamped injury/availability reports and build conditional scenarios for questionable players.
4. Evaluate points, rebounds, assists and made threes for every relevant player in every game.
5. Rank up to ten candidates. Never force ten: return fewer if quality gates fail.
6. User supplies the Spinbetter line and decimal odds.
7. Calculate fair odds and EV only from a stored, validated model prediction matching player, game, market and line.
8. Record outcomes and evaluate calibration and out-of-sample performance.

## Non-negotiable quality gates
- Every imported field has source, fetched_at/observed_at and provider-run traceability.
- No model probability if the relevant game logs, minutes projection or material injury context are missing.
- Separate confirmed availability from questionable/probable scenarios. Recompute dependent teammates under each plausible scenario.
- Use game-level observations; report sample size, mean, median, standard deviation, hit rates, missingness and outliers.
- A raw hit rate is descriptive, not a calibrated forecast.
- Evaluate models with rolling out-of-sample backtests, calibration curves, Brier score/log loss and market-specific performance.
- Apply uncertainty penalties; do not rank solely on a point estimate.
- Reject stale odds supplied by the user only when timestamp/line mismatch is known; always bind EV to exact line and price.
- If a data feed fails or the slate is incomplete, label the scan incomplete and do not publish a full-slate ranking.

## Provider policy
No undocumented endpoints, credential scraping or unapproved scraping. Each provider adapter must be tested for coverage, identifiers, timestamps, historical depth, rate limits, redistribution terms and outage behavior before production use. Spinbetter odds are user-entered; no Spinbetter odds integration is required for the intended workflow.

## Security and deployment
- Keep all API credentials server-side as Worker secrets.
- Restrict production access with Cloudflare Access (email one-time PIN) or an equivalent server-side identity layer.
- Restrict CORS to the deployed app origin; do not use wildcard CORS in production.
- Bind D1 and run `worker/schema.sql` before enabling data ingestion.
- The current project is a responsive PWA scaffold, not a production deployment. It has no real provider adapters, model, user authentication or persistent user quote endpoint yet.

## Acceptance tests before launch
1. Full-slate reconciliation: provider game count matches the official NBA schedule.
2. Player coverage: all active roster players and game logs reconciled.
3. Injury freshness: every relevant injury record timestamped and freshness threshold enforced.
4. Scenario test: changing one player's availability recalculates affected teammate projections.
5. No-fabrication test: missing source data produces `insufficient_data`, never a probability.
6. Ranking test: returns 0–10 candidates; never pads the list.
7. EV test: fair odds = 1/p; EV per unit = p*(odds-1)-(1-p), with exact model prediction reference.
8. Historical test: predictions are stored before tip-off and settled from verified box scores.

## Free-source implementation notes (v0.3)
See `FREE_DATA_STRATEGY.md`. ESPN scoreboard/injuries/game summaries are exposed through Worker proxy routes with short caching. BigBallsData player search and game logs are optional and require a secret API key. Do not publish Top 10 candidates until full slate coverage and player-level data coverage are reconciled; do not publish probabilities until walk-forward calibration is implemented.
