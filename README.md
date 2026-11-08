# EDGE NBA AI — v0.3 (free-data foundation)

Single responsive PWA foundation for Android tablet and iPhone. This is still a development build, not a deployed or production-ready betting model.

## Included
- Responsive PWA shell and install instructions.
- ESPN public endpoints proxy: scoreboard, injuries, and per-game summary.
- Optional BigBallsData player lookup and player game-log proxy; API key is stored as a Cloudflare Worker secret, never in frontend code.
- Descriptive statistics engine for points, rebounds, assists, threes and minutes (sample size, mean, median, standard deviation, hit rate when a line is supplied).
- Strict rule: no calibrated probability or EV verdict until an out-of-sample model validation pipeline exists.
- Free-source strategy and data-quality gates in `docs/FREE_DATA_STRATEGY.md`.

## Free sources and limits
- ESPN public site API is not a supported API product with a published SLA or formal rate limit. Treat it as best-effort, cache responses and monitor failures.
- BigBallsData free tier documents 250 requests/day (500 with GitHub) and endpoints for player game logs/box scores; historical access depth depends on the plan. Published dataset coverage is through 2025-26. Confirm free-tier access and 2026-27 coverage before relying on it. Free API key required.
- BALLDONTLIE free is not used for individual game stats or injuries: its current free tier lists only teams, players and games, 5 requests/minute.
- NBA.com remains an independent validation source, not a production integration until endpoint stability and access conditions are verified.

## Run locally
Requires Node.js 20+ and a terminal:
```bash
npm install
npm run dev
npm run build
```

## Worker setup
1. Create a Cloudflare Worker and bind D1 only when persistence is implemented.
2. Deploy `worker/` with Wrangler.
3. Add the free BigBallsData key as a Worker secret: `wrangler secret put BIGBALLSDATA_API_KEY`.
4. Set `APP_ORIGIN` to the exact deployed frontend origin.
5. Test `/api/health`, `/api/espn/scoreboard?date=YYYYMMDD`, `/api/espn/injuries`, `/api/espn/summary?event=EVENT_ID`.
6. Test BigBallsData endpoints using a known player and verify season coverage before batch ingestion.

## Not yet implemented
- Production authentication / private deployment.
- Automated full-slate historical ingestion and roster reconciliation.
- Full 2026-27 data coverage verification.
- Injury-to-teammate impact model and rotation scenarios.
- Candidate ranking based on validated projections.
- Walk-forward backtesting and probability calibration.
- Persistent user accounts/history and multi-device sync.

Never describe this version as automatically analysing every NBA player or as producing profitable bets. It is the free-data foundation for those components.
