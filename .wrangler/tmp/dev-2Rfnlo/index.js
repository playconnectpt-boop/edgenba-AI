var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/ones-to-watch.ts
var MARKETS = ["points", "rebounds", "assists", "threes", "pra"];
var LABELS = {
  points: "Pontos",
  rebounds: "Ressaltos",
  assists: "Assist\xEAncias",
  threes: "Triplos",
  pra: "PRA"
};
var average = /* @__PURE__ */ __name((values) => {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}, "average");
var lineForAverage = /* @__PURE__ */ __name((value, direction) => direction === "OVER" ? Math.max(0.5, Math.floor(value - 0.5) + 0.5) : Math.ceil(value + 0.5) - 0.5, "lineForAverage");
function evaluateMarket(candidate, market) {
  const rows = [...candidate.rows].filter((row) => Number.isFinite(row[market]) && row.minutes > 0).sort((a, b) => b.date.localeCompare(a.date));
  if (!rows.length) return null;
  const recent = rows.slice(0, 5);
  const seasonValues = rows.map((row) => row[market]);
  const recentValues = recent.map((row) => row[market]);
  const seasonMean = average(seasonValues);
  const recentMean = average(recentValues);
  const recentMinutes = average(recent.map((row) => row.minutes));
  const baselineMinutes = average(rows.map((row) => row.minutes));
  if (seasonMean === null || recentMean === null) return null;
  const contextualValues = (candidate.statsWithoutTeammates?.[market] || []).filter(Number.isFinite);
  const contextualMean = average(contextualValues);
  const contextualSample = contextualValues.length;
  const minutesWithout = average(candidate.minutesWithoutTeammates || []);
  const minutesWith = average(candidate.minutesWithTeammates || []);
  const contextualLift = contextualMean !== null && seasonMean > 0 ? (contextualMean - seasonMean) / seasonMean : 0;
  const recentLift = seasonMean > 0 ? (recentMean - seasonMean) / seasonMean : 0;
  const minutesLift = minutesWithout !== null && minutesWith !== null && minutesWith > 0 ? (minutesWithout - minutesWith) / minutesWith : 0;
  const roleEvidence = contextualSample >= 2 ? contextualLift : 0;
  const hasRoleEvidence = contextualSample >= 2 && contextualMean !== null;
  const overSignal = recentLift * 50 + roleEvidence * 50;
  const direction = overSignal >= 0 ? "OVER" : "UNDER";
  const signal = Math.abs(overSignal);
  const hasDirectionalEvidence = signal >= 3;
  const referenceMean = hasRoleEvidence ? contextualMean : recentMean;
  const suggestedLine = lineForAverage(referenceMean, direction);
  const score = Math.max(0, Math.min(100, Math.round(
    Math.min(35, Math.abs(recentLift) * 100) + Math.min(35, Math.abs(roleEvidence) * 100) + Math.min(20, Math.abs(minutesLift) * 100) + Math.min(10, recent.length * 2)
  )));
  const reasons = [];
  const risks = [];
  const limitations = [];
  if (!hasDirectionalEvidence) {
    risks.push("Sem evid\xEAncia direcional clara; a dire\xE7\xE3o foi atribu\xEDda apenas para cumprir a sele\xE7\xE3o di\xE1ria.");
    limitations.push("N\xE3o existe tend\xEAncia estat\xEDstica suficiente para sustentar OVER ou UNDER.");
  }
  if (recentLift > 0.05) {
    reasons.push(`Produ\xE7\xE3o recente ${Math.round(recentLift * 100)}% acima da m\xE9dia da \xE9poca.`);
  } else if (recentLift < -0.05) {
    reasons.push(`Produ\xE7\xE3o recente ${Math.round(Math.abs(recentLift) * 100)}% abaixo da m\xE9dia da \xE9poca.`);
  }
  if (hasRoleEvidence) {
    reasons.push(
      `M\xE9dia de ${contextualMean.toFixed(1)} em ${contextualSample} jogos sem os colegas identificados.`
    );
  } else {
    limitations.push("N\xE3o existe amostra contextual suficiente para medir o efeito das aus\xEAncias.");
  }
  if (minutesLift > 0.05) {
    reasons.push(`Minutos no contexto de aus\xEAncia ${Math.round(minutesLift * 100)}% acima da refer\xEAncia.`);
  }
  if (candidate.absentTeammates?.length) {
    reasons.push(`Colegas ausentes identificados: ${candidate.absentTeammates.join(", ")}.`);
  }
  if (candidate.confirmedAbsences?.length) {
    reasons.push(`Aus\xEAncias confirmadas pela fonte m\xE9dica: ${candidate.confirmedAbsences.join(", ")}.`);
  } else if (candidate.absentTeammates?.length) {
    limitations.push("A aus\xEAncia dos colegas n\xE3o est\xE1 confirmada como m\xE9dica.");
  }
  if (rows.length < 10) limitations.push(`Apenas ${rows.length} jogos dispon\xEDveis no hist\xF3rico.`);
  if (recent.length < 5) limitations.push(`Amostra recente reduzida: ${recent.length} jogos.`);
  if (recentMinutes === null || baselineMinutes === null) {
    limitations.push("N\xE3o foi poss\xEDvel avaliar a estabilidade dos minutos.");
  } else if (recentMinutes < baselineMinutes * 0.85) {
    risks.push("Os minutos recentes est\xE3o abaixo da m\xE9dia hist\xF3rica.");
  }
  if (contextualSample > 0 && contextualSample < 3) {
    risks.push("A amostra de jogos sem os colegas \xE9 demasiado pequena para conclus\xF5es fortes.");
  }
  if (direction === "OVER" && recentLift <= 0 && !hasRoleEvidence) {
    risks.push("N\xE3o existe evid\xEAncia contextual ou recente clara de aumento de produ\xE7\xE3o.");
  }
  if (direction === "UNDER" && recentLift >= 0 && !hasRoleEvidence) {
    risks.push("N\xE3o existe evid\xEAncia contextual ou recente clara de redu\xE7\xE3o de produ\xE7\xE3o.");
  }
  let confidence = "MUITO LIMITADA";
  if (rows.length >= 10 && recent.length === 5) confidence = "LIMITADA";
  if (rows.length >= 15 && contextualSample >= 3 && recentMinutes !== null) confidence = "BAIXA";
  if (rows.length >= 20 && contextualSample >= 5 && candidate.confirmedAbsences?.length && recentMinutes !== null && baselineMinutes !== null && recentMinutes >= baselineMinutes * 0.85) confidence = "MODERADA";
  if (!hasDirectionalEvidence) confidence = "MUITO LIMITADA";
  return {
    playerId: candidate.playerId,
    playerName: candidate.playerName,
    teamName: candidate.teamName,
    market,
    marketLabel: LABELS[market],
    direction,
    suggestedLine,
    score,
    confidence,
    recentMean,
    seasonMean,
    contextualMean,
    recentMinutes,
    baselineMinutes,
    contextualSample,
    absentTeammates: candidate.absentTeammates || [],
    confirmedAbsences: candidate.confirmedAbsences || [],
    reasons,
    risks,
    limitations
  };
}
__name(evaluateMarket, "evaluateMarket");
function selectOnesToWatch(candidates) {
  const picks = candidates.flatMap(
    (candidate) => MARKETS.map((market) => evaluateMarket(candidate, market)).filter((pick) => pick !== null)
  );
  if (!picks.length) return null;
  return picks.sort(
    (a, b) => b.score - a.score || b.contextualSample - a.contextualSample || b.recentMean - a.recentMean
  )[0];
}
__name(selectOnesToWatch, "selectOnesToWatch");

// worker/src/index.ts
var ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
var nbaSeasonForDate = /* @__PURE__ */ __name((date = /* @__PURE__ */ new Date()) => {
  const year = date.getUTCFullYear();
  return date.getUTCMonth() >= 6 ? year : year - 1;
}, "nbaSeasonForDate");
var espnTeamIdsFromIndex = /* @__PURE__ */ __name((payload) => {
  const teams = payload?.sports?.flatMap(
    (sport) => (sport?.leagues || []).flatMap((league) => league?.teams || [])
  ) || [];
  const ids = teams.map((entry) => String(entry?.team?.id || entry?.id || "")).filter((id) => /^\d+$/.test(id));
  return Array.from(new Set(ids));
}, "espnTeamIdsFromIndex");
var cors = /* @__PURE__ */ __name((env) => ({
  "access-control-allow-origin": env.APP_ORIGIN || "null",
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "content-type,authorization",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "vary": "Origin"
}), "cors");
var signSession = /* @__PURE__ */ __name(async (payload, secret) => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}, "signSession");
var createSession = /* @__PURE__ */ __name(async (secret) => {
  const payload = String(Date.now() + 7 * 24 * 60 * 60 * 1e3);
  return `${payload}.${await signSession(payload, secret)}`;
}, "createSession");
var validSession = /* @__PURE__ */ __name(async (token, secret) => {
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !/^\d+$/.test(payload) || Number(payload) < Date.now()) return false;
  const expected = await signSession(payload, secret);
  const a = new TextEncoder().encode(signature);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}, "validSession");
var getCookie = /* @__PURE__ */ __name((request, name) => {
  const cookie = request.headers.get("cookie") || "";
  const entry = cookie.split(";").map((v) => v.trim()).find((v) => v.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : "";
}, "getCookie");
var json = /* @__PURE__ */ __name((data, status = 200, env, cache = "no-store") => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache, ...env ? cors(env) : {} }
}), "json");
var validDate = /* @__PURE__ */ __name((value) => !!value && /^\d{8}$/.test(value), "validDate");
async function espn(path, ttlSeconds = 60) {
  const cache = caches.default;
  const url = `${ESPN}/${path}`;
  const key = new Request(url, { method: "GET" });
  const cached = await cache.match(key);
  if (cached) return cached.json();
  const upstream = await fetch(url, { headers: { "accept": "application/json", "user-agent": "EDGE-NBA-AI/0.3" } });
  if (!upstream.ok) throw new Error(`ESPN respondeu HTTP ${upstream.status}`);
  const data = await upstream.json();
  const response = new Response(JSON.stringify(data), { headers: { "content-type": "application/json", "cache-control": `public, max-age=${ttlSeconds}` } });
  await cache.put(key, response);
  return data;
}
__name(espn, "espn");
var parseStatNumber = /* @__PURE__ */ __name((value) => {
  const parsed = Number.parseFloat(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}, "parseStatNumber");
var parseMinutes = /* @__PURE__ */ __name((value) => {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "--" || raw.toUpperCase() === "DNP") return null;
  if (raw.includes(":")) {
    const parts = raw.split(":").map(Number);
    return parts.length === 2 && parts.every(Number.isFinite) ? parts[0] + parts[1] / 60 : null;
  }
  return parseStatNumber(raw);
}, "parseMinutes");
var worker = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: cors(env) });
    if (url.pathname === "/api/login" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "invalid_json" }, 400, env);
      }
      if (!body.password || body.password !== env.APP_PASSWORD) return json({ error: "invalid_password" }, 401, env);
      const token = await createSession(env.SESSION_SECRET);
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: {
          ...cors(env),
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "set-cookie": `edge_session=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=604800`
        }
      });
    }
    if (url.pathname === "/api/logout" && request.method === "POST") {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...cors(env), "content-type": "application/json; charset=utf-8", "set-cookie": "edge_session=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0" }
      });
    }
    const sessionToken = getCookie(request, "edge_session");
    if (!sessionToken || !await validSession(sessionToken, env.SESSION_SECRET)) {
      return json({ error: "unauthorized" }, 401, env);
    }
    if (url.pathname === "/api/health") return json({
      app: "EDGE NBA AI",
      version: "0.4.0",
      status: "espn-only",
      providers: { espn: "public-endpoints-configured_not-yet-validated-in-production", database: env.DB ? "bound" : "not-bound" },
      productionReady: false
    }, 200, env);
    if (url.pathname === "/api/ones-to-watch" && request.method === "GET") {
      if (!env.DB) return json({ error: "d1_database_not_bound" }, 503, env);
      try {
        const parts = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Europe/Lisbon",
          year: "numeric",
          month: "2-digit",
          day: "2-digit"
        }).formatToParts(/* @__PURE__ */ new Date());
        const part = /* @__PURE__ */ __name((type) => parts.find((item) => item.type === type)?.value || "", "part");
        const selectionDate = `${part("year")}-${part("month")}-${part("day")}`;
        const season = nbaSeasonForDate(/* @__PURE__ */ new Date(`${selectionDate}T12:00:00Z`));
        const readSaved = /* @__PURE__ */ __name(async () => {
          const saved2 = await env.DB.prepare(`
            SELECT selection_date, player_id, player_name, team_name, market,
              direction, suggested_line, score, confidence, explanation_json,
              source_data_json, engine_version, generated_at
            FROM ones_to_watch_daily
            WHERE selection_date = ?
          `).bind(selectionDate).first();
          if (!saved2) return null;
          return {
            date: saved2.selection_date,
            playerId: saved2.player_id,
            playerName: saved2.player_name,
            teamName: saved2.team_name,
            market: saved2.market,
            direction: saved2.direction,
            suggestedLine: Number(saved2.suggested_line),
            score: Number(saved2.score),
            confidence: saved2.confidence,
            explanation: JSON.parse(saved2.explanation_json),
            source: JSON.parse(saved2.source_data_json),
            engineVersion: saved2.engine_version,
            generatedAt: saved2.generated_at
          };
        }, "readSaved");
        const existing = await readSaved();
        if (existing) return json({ success: true, cached: true, pick: existing }, 200, env);
        const result = await env.DB.prepare(`
          WITH eligible_players AS (
            SELECT
              p.player_id,
              p.name AS player_name,
              COALESCE(ps.team_name, p.team_name, '') AS team_name,
              p.position
            FROM players p
            JOIN player_seasons ps ON ps.player_id = p.player_id
            WHERE ps.season = ?
              AND EXISTS (
                SELECT 1
                FROM player_game_stats history
                WHERE history.player_id = p.player_id
                  AND history.season IN (?, ?)
                  AND history.minutes > 0
                GROUP BY history.player_id
                HAVING COUNT(*) >= 3
              )
          )
          SELECT
            ep.player_id AS playerId,
            ep.player_name AS playerName,
            ep.team_name AS teamName,
            ep.position AS position,
            s.game_date AS date,
            s.minutes AS minutes,
            s.points AS points,
            s.rebounds AS rebounds,
            s.assists AS assists,
            s.three_pointers_made AS threes,
            (COALESCE(s.points, 0) + COALESCE(s.rebounds, 0) + COALESCE(s.assists, 0)) AS pra,
            s.three_pointers_attempted AS threePointAttempts
          FROM eligible_players ep
          JOIN player_game_stats s ON s.player_id = ep.player_id
          WHERE s.season IN (?, ?)
            AND s.game_date < ?
            AND s.minutes > 0
          ORDER BY ep.player_id, s.game_date DESC
          LIMIT 12000
        `).bind(
          season,
          season - 1,
          season,
          season - 1,
          season,
          selectionDate
        ).all();
        const grouped = /* @__PURE__ */ new Map();
        for (const row of result.results || []) {
          const playerId = String(row.playerId);
          let candidate = grouped.get(playerId);
          if (!candidate) {
            candidate = {
              playerId,
              playerName: String(row.playerName),
              teamName: String(row.teamName || ""),
              position: row.position == null ? void 0 : String(row.position),
              rows: []
            };
            grouped.set(playerId, candidate);
          }
          candidate.rows.push({
            date: String(row.date),
            minutes: Number(row.minutes),
            points: Number(row.points ?? 0),
            rebounds: Number(row.rebounds ?? 0),
            assists: Number(row.assists ?? 0),
            threes: Number(row.threes ?? 0),
            threePointAttempts: Number(row.threePointAttempts ?? 0),
            pra: Number(row.pra ?? 0)
          });
        }
        const pick = selectOnesToWatch(Array.from(grouped.values()));
        if (!pick) {
          return json({
            success: false,
            error: "insufficient_player_statistics",
            date: selectionDate,
            season,
            message: "Ainda n\xE3o existem dados estat\xEDsticos v\xE1lidos suficientes para gerar uma sele\xE7\xE3o."
          }, 422, env);
        }
        const explanation = {
          marketLabel: pick.marketLabel,
          recentMean: pick.recentMean,
          seasonMean: pick.seasonMean,
          contextualMean: pick.contextualMean,
          recentMinutes: pick.recentMinutes,
          baselineMinutes: pick.baselineMinutes,
          contextualSample: pick.contextualSample,
          absentTeammates: pick.absentTeammates,
          confirmedAbsences: pick.confirmedAbsences,
          reasons: pick.reasons,
          risks: pick.risks,
          limitations: [
            ...pick.limitations,
            "A an\xE1lise atual n\xE3o integra ainda o relat\xF3rio de les\xF5es ESPN nem o hist\xF3rico de produ\xE7\xE3o com e sem colegas ausentes.",
            "O hist\xF3rico pode combinar jogos de duas \xE9pocas; altera\xE7\xF5es de equipa ou fun\xE7\xE3o podem limitar a compara\xE7\xE3o."
          ]
        };
        const source = {
          provider: "ESPN / Cloudflare D1",
          season,
          seasonsIncluded: [season, season - 1],
          candidateCount: grouped.size,
          playerSample: grouped.get(pick.playerId)?.rows.length || 0
        };
        await env.DB.prepare(`
          INSERT OR IGNORE INTO ones_to_watch_daily (
            selection_date, player_id, player_name, team_name, market,
            direction, suggested_line, score, confidence,
            explanation_json, source_data_json, engine_version
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          selectionDate,
          pick.playerId,
          pick.playerName,
          pick.teamName,
          pick.market,
          pick.direction,
          pick.suggestedLine,
          pick.score,
          pick.confidence,
          JSON.stringify(explanation),
          JSON.stringify(source),
          "ones-to-watch-v1"
        ).run();
        const saved = await readSaved();
        if (!saved) throw new Error("A sele\xE7\xE3o di\xE1ria n\xE3o ficou persistida em D1.");
        return json({ success: true, cached: false, pick: saved }, 200, env);
      } catch (error) {
        return json({
          error: "ones_to_watch_generation_failed",
          detail: String(error)
        }, 500, env);
      }
    }
    if (url.pathname === "/api/ones-to-watch/history" && request.method === "GET") {
      if (!env.DB) return json({ error: "d1_database_not_bound" }, 503, env);
      const requestedLimit = Number(url.searchParams.get("limit") || 30);
      const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(60, requestedLimit)) : 30;
      try {
        const result = await env.DB.prepare(`
          SELECT selection_date, player_id, player_name, team_name, market,
            direction, suggested_line, score, confidence, explanation_json,
            source_data_json, engine_version, generated_at
          FROM ones_to_watch_daily
          ORDER BY selection_date DESC
          LIMIT ?
        `).bind(limit).all();
        const history = (result.results || []).map((row) => ({
          date: row.selection_date,
          playerId: row.player_id,
          playerName: row.player_name,
          teamName: row.team_name,
          market: row.market,
          direction: row.direction,
          suggestedLine: Number(row.suggested_line),
          score: Number(row.score),
          confidence: row.confidence,
          explanation: JSON.parse(row.explanation_json),
          source: JSON.parse(row.source_data_json),
          engineVersion: row.engine_version,
          generatedAt: row.generated_at
        }));
        return json({ success: true, history }, 200, env);
      } catch (error) {
        return json({
          error: "ones_to_watch_history_failed",
          detail: String(error)
        }, 500, env);
      }
    }
    if (url.pathname === "/api/espn/scoreboard") {
      const date = url.searchParams.get("date") || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10).replaceAll("-", "");
      if (!validDate(date)) return json({ error: "date deve ter o formato YYYYMMDD." }, 400, env);
      try {
        return json({ source: "ESPN", retrievedAt: (/* @__PURE__ */ new Date()).toISOString(), data: await espn(`scoreboard?dates=${date}`, 60) }, 200, env, "public, max-age=60");
      } catch (e) {
        return json({ error: "scoreboard_unavailable", detail: String(e) }, 502, env);
      }
    }
    if (url.pathname === "/api/espn/injuries") {
      try {
        return json({ source: "ESPN", retrievedAt: (/* @__PURE__ */ new Date()).toISOString(), data: await espn("injuries", 120) }, 200, env, "public, max-age=120");
      } catch (e) {
        return json({ error: "injuries_unavailable", detail: String(e) }, 502, env);
      }
    }
    if (url.pathname === "/api/espn/summary") {
      const event = url.searchParams.get("event");
      if (!event || !/^\d+$/.test(event)) return json({ error: "event id inv\xE1lido." }, 400, env);
      try {
        return json({ source: "ESPN", eventId: event, retrievedAt: (/* @__PURE__ */ new Date()).toISOString(), data: await espn(`summary?event=${event}`, 30) }, 200, env, "public, max-age=30");
      } catch (e) {
        return json({ error: "summary_unavailable", detail: String(e) }, 502, env);
      }
    }
    if (url.pathname === "/api/espn/games") {
      if (!env.DB) return json({ error: "d1_database_not_bound" }, 503, env);
      const now = /* @__PURE__ */ new Date();
      const end = new Date(now.getTime() + 24 * 60 * 60 * 1e3);
      const dates = /* @__PURE__ */ new Set();
      for (const d of [now, end]) dates.add(d.toISOString().slice(0, 10).replace(/-/g, ""));
      try {
        const found = /* @__PURE__ */ new Map();
        for (const date of dates) {
          const board = await espn(`scoreboard?dates=${date}`, 60);
          for (const event of board.events || []) {
            const kickoff = new Date(event.date || event.competitions?.[0]?.date || "");
            if (!Number.isFinite(kickoff.getTime()) || kickoff < now || kickoff > end) continue;
            const competition = event.competitions?.[0];
            const competitors = competition?.competitors || [];
            const home = competitors.find((team) => team.homeAway === "home") || competitors[0];
            const away = competitors.find((team) => team.homeAway === "away") || competitors[1];
            if (!home?.team?.id || !away?.team?.id) continue;
            found.set(String(event.id), {
              id: String(event.id),
              date: kickoff.toISOString(),
              game_date: kickoff.toISOString().slice(0, 10),
              home_team_id: String(home.team.id),
              away_team_id: String(away.team.id),
              home_team: home.team.displayName || home.team.name || "",
              away_team: away.team.displayName || away.team.name || "",
              status: event.status?.type?.description || event.status?.type?.name || "scheduled"
            });
          }
        }
        const games = Array.from(found.values()).sort((a, b) => a.date.localeCompare(b.date));
        if (games.length) {
          const statements = games.map((game) => env.DB.prepare(`
            INSERT INTO games (game_id, season, game_date, home_team, away_team, status)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(game_id) DO UPDATE SET game_date=excluded.game_date,
              home_team=excluded.home_team, away_team=excluded.away_team, status=excluded.status
          `).bind(game.id, Number(game.game_date.slice(5, 7)) >= 7 ? Number(game.game_date.slice(0, 4)) : Number(game.game_date.slice(0, 4)) - 1, game.game_date, game.home_team, game.away_team, game.status));
          for (let i = 0; i < statements.length; i += 50) await env.DB.batch(statements.slice(i, i + 50));
        }
        return json({ source: "ESPN", data: games, meta: { window_hours: 24, window_start: now.toISOString(), window_end: end.toISOString(), games_count: games.length, d1_saved: games.length } }, 200, env, "private, max-age=30");
      } catch (error) {
        return json({ error: "espn_games_unavailable", detail: String(error) }, 502, env);
      }
    }
    if (url.pathname === "/api/espn/players" || url.pathname === "/api/espn/sync-player-ids") {
      if (!env.DB) return json({ error: "d1_database_not_bound" }, 503, env);
      const season = nbaSeasonForDate();
      const errors = [];
      let teamIds = [];
      try {
        const index = await espn("teams?limit=100", 21600);
        teamIds = espnTeamIdsFromIndex(index);
      } catch (error) {
        return json({ error: "espn_teams_index_failed", detail: String(error) }, 502, env);
      }
      if (!teamIds.length) return json({ error: "espn_teams_index_empty", detail: "A ESPN n\xE3o devolveu IDs de equipas v\xE1lidos." }, 502, env);
      let rostersRead = 0;
      let athletesRead = 0;
      let savedPlayers = 0;
      let mappedHistorical = 0;
      const normalize = /* @__PURE__ */ __name((value) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, ""), "normalize");
      try {
        await env.DB.prepare(`CREATE TABLE IF NOT EXISTS player_seasons (player_id TEXT NOT NULL, season INTEGER NOT NULL, team_id TEXT, team_name TEXT, PRIMARY KEY (player_id, season))`).run();
        await env.DB.prepare(`CREATE TABLE IF NOT EXISTS player_source_ids (player_id TEXT NOT NULL, source TEXT NOT NULL, source_player_id TEXT NOT NULL, season INTEGER NOT NULL, verified INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (player_id, source, season))`).run();
        const dbResult = await env.DB.prepare("SELECT p.player_id, p.name, ps.team_name FROM players p LEFT JOIN player_seasons ps ON ps.player_id=p.player_id AND ps.season=?").bind(season).all();
        const existing = dbResult.results || [];
        const sourceIdsResult = await env.DB.prepare(
          "SELECT source_player_id, player_id FROM player_source_ids WHERE source='ESPN' AND season=?"
        ).bind(season).all();
        const existingByEspnId = new Map(
          (sourceIdsResult.results || []).map((row) => [String(row.source_player_id), String(row.player_id)])
        );
        const existingByNameTeam = /* @__PURE__ */ new Map();
        for (const player of existing) {
          const key = `${normalize(String(player.name || ""))}|${normalize(String(player.team_name || ""))}`;
          const list = existingByNameTeam.get(key) || [];
          list.push(player);
          existingByNameTeam.set(key, list);
        }
        const inserts = [];
        const mappings = [];
        for (const teamId of teamIds) {
          try {
            const roster = await espn(`teams/${teamId}/roster`, 21600);
            const teamName = String(roster.team?.displayName || "").trim();
            const athletes = Array.isArray(roster.athletes) ? roster.athletes : [];
            if (!teamName) {
              errors.push(`Roster ESPN ${teamId}: nome de equipa ausente`);
              continue;
            }
            rostersRead++;
            for (const athlete of athletes) {
              athletesRead++;
              const espnId = String(athlete.id || "").trim();
              const name = String(athlete.displayName || athlete.fullName || "").trim();
              if (!espnId || !name) continue;
              const key = `${normalize(name)}|${normalize(teamName)}`;
              const candidates = existingByNameTeam.get(key) || [];
              const legacy = candidates.length === 1 ? candidates[0] : null;
              const mappedInternalId = existingByEspnId.get(espnId);
              const internalId = mappedInternalId || (legacy ? String(legacy.player_id) : espnId);
              const position = athlete.position?.abbreviation || athlete.position?.name || null;
              const teamEspnId = String(roster.team?.id || teamId);
              inserts.push(env.DB.prepare(`INSERT INTO players (player_id,name,team_id,position,updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(player_id) DO UPDATE SET name=excluded.name,team_id=excluded.team_id,position=excluded.position,updated_at=CURRENT_TIMESTAMP`).bind(internalId, name, teamEspnId, position));
              inserts.push(env.DB.prepare(`INSERT INTO player_seasons (player_id,season,team_id,team_name) VALUES (?,?,?,?) ON CONFLICT(player_id,season) DO UPDATE SET team_id=excluded.team_id,team_name=excluded.team_name`).bind(internalId, season, teamEspnId, teamName));
              mappings.push(env.DB.prepare(`INSERT INTO player_source_ids
                (player_id,source,source_player_id,season,verified,updated_at)
                VALUES (?,'ESPN',?,?,1,CURRENT_TIMESTAMP)
                ON CONFLICT DO NOTHING
              `).bind(internalId, espnId, season));
              mappings.push(env.DB.prepare(`UPDATE player_source_ids
                SET verified=1,updated_at=CURRENT_TIMESTAMP
                WHERE source='ESPN' AND source_player_id=? AND season=?
              `).bind(espnId, season));
              if (legacy) mappedHistorical++;
              savedPlayers++;
            }
          } catch (error) {
            errors.push(`Roster ESPN ${teamId}: ${String(error)}`);
          }
        }
        const allStatements = [...inserts, ...mappings];
        for (let i = 0; i < allStatements.length; i += 50) await env.DB.batch(allStatements.slice(i, i + 50));
        return json({ success: errors.length === 0, source: "ESPN", season, espn_rosters_read: rostersRead, espn_athletes_read: athletesRead, players_processed: savedPlayers, historical_ids_mapped: mappedHistorical, errors }, 200, env);
      } catch (error) {
        return json({ error: "espn_player_sync_failed", detail: String(error), errors }, 500, env);
      }
    }
    if (url.pathname === "/api/espn/backfill/start" && (request.method === "POST" || request.method === "GET")) {
      if (!env.DB) return json({ error: "d1_database_not_bound" }, 503, env);
      const season = nbaSeasonForDate();
      const start = new Date(Date.UTC(season, 9, 1));
      const today = /* @__PURE__ */ new Date();
      const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
      const totalDays = Math.max(0, Math.floor((todayUtc.getTime() - start.getTime()) / 864e5) + 1);
      try {
        await env.DB.prepare(`CREATE TABLE IF NOT EXISTS espn_backfill_state (id INTEGER PRIMARY KEY CHECK(id=1), season INTEGER NOT NULL, next_offset INTEGER NOT NULL DEFAULT 0, total_days INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'running', locked_until INTEGER, last_result TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`).run();
        await env.DB.prepare(`INSERT INTO espn_backfill_state (id,season,next_offset,total_days,status,locked_until,last_result,updated_at) VALUES (1,?,0,?,'running',NULL,NULL,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET next_offset=CASE WHEN espn_backfill_state.season=excluded.season THEN espn_backfill_state.next_offset ELSE 0 END, total_days=excluded.total_days, status=CASE WHEN espn_backfill_state.season=excluded.season THEN espn_backfill_state.status ELSE 'running' END, locked_until=CASE WHEN espn_backfill_state.season=excluded.season THEN espn_backfill_state.locked_until ELSE NULL END, last_result=CASE WHEN espn_backfill_state.season=excluded.season THEN espn_backfill_state.last_result ELSE NULL END, season=excluded.season, updated_at=CURRENT_TIMESTAMP`).bind(season, totalDays).run();
        const state = await env.DB.prepare(`SELECT season,next_offset,total_days,status FROM espn_backfill_state WHERE id=1`).first();
        return json({ success: true, ...state, cadence: "um dia por execu\xE7\xE3o di\xE1ria" }, 200, env);
      } catch (error) {
        return json({ error: "backfill_start_failed", detail: String(error) }, 500, env);
      }
    }
    if (url.pathname === "/api/espn/backfill/status") {
      try {
        const state = await env.DB.prepare(`SELECT season,next_offset,total_days,status,last_result,updated_at FROM espn_backfill_state WHERE id=1`).first();
        return json({ success: true, backfill: state || null }, 200, env);
      } catch (error) {
        return json({ success: false, error: "backfill_not_started", detail: String(error) }, 200, env);
      }
    }
    if (url.pathname === "/api/espn/backfill") {
      if (!env.DB) return json({ error: "d1_database_not_bound" }, 503, env);
      const season = Number(url.searchParams.get("season") || nbaSeasonForDate());
      const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
      const days = Math.min(7, Math.max(1, Number(url.searchParams.get("days") || 7)));
      if (!Number.isInteger(season) || season !== nbaSeasonForDate() || !Number.isInteger(offset) || !Number.isInteger(days)) {
        return json({ error: "Par\xE2metros inv\xE1lidos. O backfill aceita a \xE9poca atual, offset em dias e lotes at\xE9 7 dias." }, 400, env);
      }
      try {
        const start = new Date(Date.UTC(season, 9, 1));
        const today = /* @__PURE__ */ new Date();
        const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
        const totalDays = Math.max(0, Math.floor((todayUtc.getTime() - start.getTime()) / 864e5) + 1);
        const endOffset = Math.min(offset + days, totalDays);
        const ids = await env.DB.prepare(
          "SELECT source_player_id,player_id FROM player_source_ids WHERE source='ESPN' AND season=? AND verified=1"
        ).bind(season).all();
        const playerMap = new Map((ids.results || []).map((x) => [String(x.source_player_id), String(x.player_id)]));
        if (playerMap.size === 0) {
          return json({ success: false, error: "espn_player_mappings_missing", detail: "N\xE3o existem IDs ESPN verificados para esta \xE9poca; sincroniza os plant\xE9is antes de avan\xE7ar o backfill.", mappings_available: 0 }, 409, env);
        }
        const gameRows = /* @__PURE__ */ new Map();
        const statRows = /* @__PURE__ */ new Map();
        const errors = [];
        let datesChecked = 0;
        let gamesSeen = 0;
        let completedGames = 0;
        for (let dayOffset = offset; dayOffset < endOffset; dayOffset++) {
          const dateObj = new Date(start.getTime() + dayOffset * 864e5);
          const date = dateObj.toISOString().slice(0, 10).replace(/-/g, "");
          datesChecked++;
          let board;
          try {
            board = await espn(`scoreboard?dates=${date}`, 3600);
          } catch (e) {
            errors.push(`${date} scoreboard: ${String(e)}`);
            continue;
          }
          const events = Array.isArray(board?.events) ? board.events : [];
          gamesSeen += events.length;
          for (const event of events) {
            if (event?.status?.type?.completed !== true) continue;
            const eventId = String(event.id || "");
            const competition = event.competitions?.[0];
            const competitors = competition?.competitors || [];
            if (!/^\d+$/.test(eventId) || competitors.length < 2) continue;
            const home = competitors.find((x) => x.homeAway === "home") || competitors[0];
            const away = competitors.find((x) => x.homeAway === "away") || competitors[1];
            const homeName = String(home?.team?.displayName || home?.team?.name || "");
            const awayName = String(away?.team?.displayName || away?.team?.name || "");
            const isoDate = dateObj.toISOString().slice(0, 10);
            gameRows.set(eventId, { id: eventId, date: isoDate, home: homeName, away: awayName, status: event.status?.type?.description || "Final" });
            try {
              const summary = await espn(`summary?event=${eventId}`, 86400);
              const teams = Array.isArray(summary?.boxscore?.players) ? summary.boxscore.players : [];
              if (!teams.length) {
                errors.push(`${eventId}: boxscore ausente`);
                continue;
              }
              completedGames++;
              for (const team of teams) {
                const teamId = String(team?.team?.id || "");
                const opponent = String(competitors.find((x) => String(x.team?.id || "") !== teamId)?.team?.displayName || "");
                for (const group of team.statistics || []) {
                  const labels = (group.labels || group.names || []).map((x) => String(x).toUpperCase());
                  for (const item of group.athletes || []) {
                    const athleteId = String(item?.athlete?.id || "");
                    const playerId = playerMap.get(athleteId);
                    if (!playerId) continue;
                    const values = Array.isArray(item.stats) ? item.stats : [];
                    const stat = {};
                    labels.forEach((label, index) => {
                      stat[label.replace(/[^A-Z0-9]/g, "")] = values[index];
                    });
                    const minRaw = stat.MIN ?? stat.MINUTES;
                    const minutes = parseMinutes(minRaw);
                    if (minutes === null) continue;
                    const pair = /* @__PURE__ */ __name((value) => {
                      const parts = String(value ?? "").split("-");
                      return [parseStatNumber(parts[0]), parseStatNumber(parts[1])];
                    }, "pair");
                    const [fgm, fga] = pair(stat.FG);
                    const [tpm, tpa] = pair(stat["3PT"]);
                    const key = `${playerId}:${eventId}`;
                    statRows.set(key, {
                      playerId,
                      eventId,
                      season,
                      date: isoDate,
                      opponent: opponent || null,
                      minutes,
                      points: parseStatNumber(stat.PTS),
                      rebounds: parseStatNumber(stat.REB),
                      assists: parseStatNumber(stat.AST),
                      steals: parseStatNumber(stat.STL),
                      blocks: parseStatNumber(stat.BLK),
                      turnovers: parseStatNumber(stat.TO ?? stat.TOV),
                      threes: tpm,
                      fgm,
                      fga,
                      tpa
                    });
                  }
                }
              }
            } catch (e) {
              errors.push(`${eventId} summary: ${String(e)}`);
            }
          }
        }
        const gameStatements = Array.from(gameRows.values()).map((game) => env.DB.prepare(
          `INSERT INTO games (game_id,season,game_date,home_team,away_team,status) VALUES (?,?,?,?,?,?)
           ON CONFLICT(game_id) DO UPDATE SET game_date=excluded.game_date,home_team=excluded.home_team,away_team=excluded.away_team,status=excluded.status`
        ).bind(game.id, season, game.date, game.home, game.away, game.status));
        const statStatements = Array.from(statRows.values()).map((row) => env.DB.prepare(
          `INSERT INTO player_game_stats
           (player_id,game_id,season,game_date,opponent,minutes,points,rebounds,assists,steals,blocks,turnovers,three_pointers_made,field_goals_made,field_goals_attempted,three_pointers_attempted)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(player_id,game_id,season) DO UPDATE SET game_date=excluded.game_date,opponent=excluded.opponent,minutes=excluded.minutes,
           points=excluded.points,rebounds=excluded.rebounds,assists=excluded.assists,steals=excluded.steals,blocks=excluded.blocks,
           turnovers=excluded.turnovers,three_pointers_made=excluded.three_pointers_made,field_goals_made=excluded.field_goals_made,
           field_goals_attempted=excluded.field_goals_attempted,three_pointers_attempted=excluded.three_pointers_attempted,updated_at=CURRENT_TIMESTAMP`
        ).bind(row.playerId, row.eventId, row.season, row.date, row.opponent, row.minutes, row.points, row.rebounds, row.assists, row.steals, row.blocks, row.turnovers, row.threes, row.fgm, row.fga, row.tpa));
        for (let i = 0; i < gameStatements.length; i += 50) await env.DB.batch(gameStatements.slice(i, i + 50));
        for (let i = 0; i < statStatements.length; i += 50) await env.DB.batch(statStatements.slice(i, i + 50));
        return json({
          success: errors.length === 0,
          source: "ESPN scoreboard + game summaries",
          internal_season: season,
          range: { start: new Date(start.getTime() + offset * 864e5).toISOString().slice(0, 10), days_checked: datesChecked, next_offset: endOffset, total_days: totalDays, complete: endOffset >= totalDays },
          mappings_available: playerMap.size,
          games_seen: gamesSeen,
          completed_games_with_boxscore: completedGames,
          games_upserted: gameRows.size,
          player_game_stats_upserted: statRows.size,
          errors
        }, 200, env);
      } catch (error) {
        return json({ error: "espn_backfill_failed", detail: String(error) }, 500, env);
      }
    }
    if (url.pathname === "/api/espn/player-search") {
      if (!env.DB) return json({ error: "d1_database_not_bound" }, 503, env);
      const query = (url.searchParams.get("name") || "").trim();
      if (query.length < 2 || query.length > 80) return json({ error: "Indica pelo menos 2 caracteres." }, 400, env);
      try {
        const rows = await env.DB.prepare(`SELECT p.player_id AS id,p.name,ps.team_name,p.position FROM players p LEFT JOIN player_seasons ps ON ps.player_id=p.player_id AND ps.season=? WHERE lower(p.name) LIKE ? ORDER BY p.name LIMIT 30`).bind(nbaSeasonForDate(), `%${query.toLowerCase()}%`).all();
        return json({ source: "ESPN / D1", data: rows.results || [] }, 200, env, "private, max-age=60");
      } catch (error) {
        return json({ error: "espn_player_search_failed", detail: String(error) }, 500, env);
      }
    }
    if (url.pathname === "/api/espn/player-gamelog") {
      if (!env.DB) return json({ error: "d1_database_not_bound" }, 503, env);
      const playerId = url.searchParams.get("playerId") || "";
      const season = Number(url.searchParams.get("season") || nbaSeasonForDate());
      if (!playerId || playerId.length > 80 || !Number.isInteger(season)) return json({ error: "Par\xE2metros inv\xE1lidos." }, 400, env);
      try {
        const rows = await env.DB.prepare(`SELECT game_date AS date,minutes,points,rebounds,assists,three_pointers_made AS threes,three_pointers_attempted AS threePointAttempts FROM player_game_stats WHERE player_id=? AND season=? ORDER BY game_date DESC`).bind(playerId, season).all();
        return json({ source: "ESPN / Cloudflare D1", data: rows.results || [], meta: { sample: (rows.results || []).length, season } }, 200, env, "private, max-age=60");
      } catch (error) {
        return json({ error: "espn_gamelog_failed", detail: String(error) }, 500, env);
      }
    }
    if (url.pathname === "/api/espn/player-gamelogs" && request.method === "POST") {
      if (!env.DB) return json({ error: "d1_database_not_bound" }, 503, env);
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "invalid_json" }, 400, env);
      }
      const ids = Array.isArray(body.playerIds) ? [...new Set(body.playerIds.filter((x) => typeof x === "string" && x.length > 0 && x.length <= 80))].slice(0, 20) : [];
      const season = Number(body.season || nbaSeasonForDate());
      if (!ids.length || !Number.isInteger(season)) return json({ error: "Indica IDs e \xE9poca v\xE1lidos." }, 400, env);
      try {
        const results = [];
        for (const playerId of ids) {
          const rows = await env.DB.prepare(`SELECT game_date AS date,minutes,points,rebounds,assists,three_pointers_made AS threes,three_pointers_attempted AS threePointAttempts FROM player_game_stats WHERE player_id=? AND season=? ORDER BY game_date DESC LIMIT 100`).bind(playerId, season).all();
          results.push({ playerId, data: rows.results || [] });
        }
        return json({ source: "ESPN / Cloudflare D1", results }, 200, env, "private, max-age=30");
      } catch (error) {
        return json({ error: "espn_gamelogs_failed", detail: String(error) }, 500, env);
      }
    }
    if (url.pathname === "/api/scan/players") {
      if (!env.DB) return json({ error: "d1_database_not_bound" }, 503, env);
      const teams = Array.from(new Set((url.searchParams.get("teams") || "").split("|").map((value) => value.trim()).filter(Boolean)));
      if (teams.length < 1 || teams.length > 30 || teams.some((team) => team.length > 80)) {
        return json({ error: "Indica entre 1 e 30 nomes de equipas v\xE1lidos." }, 400, env);
      }
      const placeholders = teams.map(() => "?").join(",");
      try {
        const result = await env.DB.prepare(`
          WITH ranked_minutes AS (
            SELECT
              s.player_id,
              s.minutes,
              ROW_NUMBER() OVER (PARTITION BY s.player_id ORDER BY g.game_date DESC, g.game_id DESC) AS rn
            FROM player_game_stats s
            JOIN games g ON g.game_id = s.game_id
            WHERE g.season IN (?, ?)
              AND s.minutes IS NOT NULL
              AND s.minutes > 0
          ), rotation AS (
            SELECT
              player_id,
              COUNT(*) AS appearances,
              AVG(minutes) AS avg_minutes,
              AVG(CASE WHEN rn <= 10 THEN minutes END) AS recent10_avg_minutes,
              SUM(CASE WHEN rn <= 10 THEN 1 ELSE 0 END) AS recent10_appearances
            FROM ranked_minutes
            GROUP BY player_id
          )
          SELECT
            p.player_id AS id,
            p.name AS name,
            ps.team_name,
            p.position,
            (
              SELECT psi.source_player_id
              FROM player_source_ids psi
              WHERE psi.player_id = p.player_id
                AND psi.source = 'ESPN'
                AND psi.season = ps.season
                AND psi.verified = 1
              ORDER BY psi.updated_at DESC
              LIMIT 1
            ) AS espn_id,
            COALESCE(r.appearances, 0) AS rotation_games,
            COALESCE(r.avg_minutes, 0) AS avg_minutes,
            COALESCE(r.recent10_avg_minutes, 0) AS recent10_avg_minutes,
            COALESCE(r.recent10_appearances, 0) AS recent10_appearances,
            CASE WHEN COALESCE(r.appearances, 0) >= 3
              AND (COALESCE(r.recent10_avg_minutes, 0) >= 8 OR COALESCE(r.avg_minutes, 0) >= 12)
              THEN 1 ELSE 0 END AS rotation_eligible
          FROM players p
          JOIN player_seasons ps ON ps.player_id = p.player_id
          LEFT JOIN rotation r ON r.player_id = p.player_id
          WHERE ps.season = ? AND ps.team_name IN (${placeholders})
          ORDER BY rotation_eligible DESC, ps.team_name, p.name
        `).bind(nbaSeasonForDate() - 1, nbaSeasonForDate(), nbaSeasonForDate(), ...teams).all();
        const players = (result.results || []).map((row) => ({
          id: String(row.id),
          name: String(row.name),
          team_name: String(row.team_name),
          espn_id: row.espn_id == null ? null : String(row.espn_id),
          position: row.position == null ? null : String(row.position),
          rotation_games: Number(row.rotation_games) || 0,
          avg_minutes: Number(row.avg_minutes) || 0,
          recent10_avg_minutes: Number(row.recent10_avg_minutes) || 0,
          recent10_appearances: Number(row.recent10_appearances) || 0,
          rotation_eligible: Number(row.rotation_eligible) === 1,
          headshot_url: null
        }));
        const foundTeams = Array.from(new Set(players.map((player) => player.team_name))).sort();
        return json({
          source: "Cloudflare D1 / ESPN",
          season: nbaSeasonForDate(),
          requested_teams: teams,
          found_teams: foundTeams,
          missing_teams: teams.filter((team) => !foundTeams.includes(team)),
          players,
          meta: { players_count: players.length, rotation_count: players.filter((player) => player.rotation_eligible).length, teams_requested: teams.length, teams_found: foundTeams.length }
        }, 200, env, "private, max-age=300");
      } catch (error) {
        return json({ error: "scan_players_query_failed", detail: String(error) }, 500, env);
      }
    }
    if (url.pathname === "/api/scan/status") return json({
      status: "espn-only-data-mode",
      maxDailyCandidates: 10,
      connectedSources: ["ESPN scoreboard", "ESPN rosters", "ESPN injury report", "ESPN game summaries (on demand)"],
      requiresSetup: ["Deploy Worker", "Sync ESPN rosters", "Validate ESPN response schemas"],
      blockedClaims: ["No calibrated probability until historical backtesting is complete", "No Top 10 publication until complete slate and player coverage are verified"],
      markets: ["points", "rebounds", "assists", "threes", "PRA"]
    }, 200, env);
    if (url.pathname === "/api/analysis/ev" && request.method === "POST") {
      const body = await request.json();
      const p = body.probability, odds = body.odds;
      if (typeof p !== "number" || p <= 0 || p >= 1 || typeof odds !== "number" || odds <= 1 || !body.modelReference || body.calibrated !== true)
        return json({ error: "\xC9 necess\xE1ria uma probabilidade do modelo calibrado, odd decimal > 1 e refer\xEAncia verific\xE1vel. N\xE3o s\xE3o aceites probabilidades introduzidas manualmente." }, 400, env);
      return json({ fairOdds: 1 / p, evPerUnit: p * (odds - 1) - (1 - p), modelReference: body.modelReference }, 200, env);
    }
    if (url.pathname === "/api/espn/sync-boxscore" && request.method === "POST") {
      const body = await request.json();
      const date = body.date || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10).replace(/-/g, "");
      if (!/^\d{8}$/.test(date)) return json({ error: "date inv\xE1lida" }, 400, env);
      const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
      const season = Number(date.slice(4, 6)) >= 7 ? Number(date.slice(0, 4)) : Number(date.slice(0, 4)) - 1;
      const ids = await env.DB.prepare(
        "SELECT source_player_id,player_id FROM player_source_ids WHERE source='ESPN' AND season=? AND verified=1"
      ).bind(season).all();
      const playerMap = new Map((ids.results || []).map((x) => [String(x.source_player_id), x.player_id]));
      const saved = /* @__PURE__ */ new Set();
      const errors = [];
      const board = await espn(`scoreboard?dates=${date}`, 60);
      for (const event of board.events || []) {
        if (event.status?.type?.completed !== true) continue;
        const comp = event.competitions?.[0];
        const competitors = comp?.competitors || [];
        const espnTeamIds = competitors.map((x) => String(x.team?.id || ""));
        if (competitors.length < 2) continue;
        const home = competitors.find((x) => x.homeAway === "home") || competitors[0];
        const away = competitors.find((x) => x.homeAway === "away") || competitors[1];
        const game = {
          game_id: String(event.id),
          game_date: iso,
          season,
          home_team: String(home.team?.displayName || home.team?.name || ""),
          away_team: String(away.team?.displayName || away.team?.name || "")
        };
        try {
          await env.DB.prepare(`INSERT INTO games (game_id,season,game_date,home_team,away_team,status) VALUES (?,?,?,?,?,?) ON CONFLICT(game_id) DO UPDATE SET game_date=excluded.game_date,home_team=excluded.home_team,away_team=excluded.away_team,status=excluded.status`).bind(game.game_id, game.season, game.game_date, game.home_team, game.away_team, event.status?.type?.description || "final").run();
          const summary = await espn(`summary?event=${event.id}`, 30);
          const teams = summary.boxscore?.players || [];
          if (!teams.length) continue;
          for (const team of teams) {
            const teamName = team.team?.displayName || "";
            const teamId = String(team.team?.id || "");
            const opponent = String(competitors.find((x) => String(x.team?.id || "") !== teamId)?.team?.displayName || "") || null;
            for (const group of team.statistics || []) {
              const labels = group.labels || group.names || [];
              for (const item of group.athletes || []) {
                const athleteId = String(item.athlete?.id || "");
                const playerId = playerMap.get(athleteId);
                if (!playerId) continue;
                const vals = item.stats || [];
                const stat = {};
                labels.forEach((label, i) => stat[label.toUpperCase()] = vals[i]);
                const num = /* @__PURE__ */ __name((v) => {
                  const n = Number.parseFloat(String(v ?? ""));
                  return Number.isFinite(n) ? n : null;
                }, "num");
                const minutesValue = String(stat.MIN ?? "").trim();
                const minutes = minutesValue.includes(":") ? (() => {
                  const parts = minutesValue.split(":").map(Number);
                  return parts.length === 2 && parts.every(Number.isFinite) ? parts[0] + parts[1] / 60 : null;
                })() : num(minutesValue);
                const pair = /* @__PURE__ */ __name((v) => {
                  const a = String(v || "").split("-");
                  return [num(a[0]), num(a[1])];
                }, "pair");
                const [fgm, fga] = pair(stat.FG);
                const [tpm, tpa] = pair(stat["3PT"]);
                const [ftm, fta] = pair(stat.FT);
                const key = `${playerId}:${game.game_id}`;
                if (saved.has(key)) continue;
                saved.add(key);
                await env.DB.prepare(
                  `INSERT INTO player_game_stats
                   (player_id,game_id,season,game_date,opponent,minutes,points,rebounds,assists,steals,blocks,turnovers,three_pointers_made,field_goals_made,field_goals_attempted,three_pointers_attempted)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                   ON CONFLICT(player_id,game_id,season) DO UPDATE SET
                   game_date=excluded.game_date,opponent=excluded.opponent,minutes=excluded.minutes,
                   points=excluded.points,rebounds=excluded.rebounds,assists=excluded.assists,
                   steals=excluded.steals,blocks=excluded.blocks,turnovers=excluded.turnovers,
                   three_pointers_made=excluded.three_pointers_made,field_goals_made=excluded.field_goals_made,
                   field_goals_attempted=excluded.field_goals_attempted,three_pointers_attempted=excluded.three_pointers_attempted,
                   updated_at=CURRENT_TIMESTAMP`
                ).bind(playerId, game.game_id, Number(game.season), game.game_date, opponent, minutes, num(stat.PTS), num(stat.REB), num(stat.AST), num(stat.STL), num(stat.BLK), num(stat.TO), tpm, fgm, fga, tpa).run();
              }
            }
          }
        } catch (e) {
          errors.push(`${event.id}: ${String(e)}`);
        }
      }
      return json({ source: "ESPN", date: iso, games_found: (board.events || []).length, players_saved: saved.size, errors }, 200, env);
    }
    return json({ error: "not_found" }, 404, env);
  },
  scheduled(controller, env, ctx) {
    ctx.waitUntil((async () => {
      const now = /* @__PURE__ */ new Date();
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Lisbon",
        hour: "2-digit",
        minute: "2-digit",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hourCycle: "h23"
      }).formatToParts(now);
      const local = Object.fromEntries(parts.map((part) => [part.type, part.value]));
      if (!env.DB) throw new Error("D1 n\xE3o est\xE1 ligada ao Worker.");
      if (local.hour !== "10" || local.minute !== "00") {
        try {
          const state = await env.DB.prepare(`SELECT season,next_offset,total_days,status,locked_until FROM espn_backfill_state WHERE id=1`).first();
          if (!state || state.status !== "running") return;
          const nowMs = Date.now();
          if (state.locked_until && Number(state.locked_until) > nowMs) return;
          const claimed = await env.DB.prepare(`UPDATE espn_backfill_state SET locked_until=?,updated_at=CURRENT_TIMESTAMP WHERE id=1 AND status='running' AND (locked_until IS NULL OR locked_until<=?)`).bind(nowMs + 4 * 60 * 1e3, nowMs).run();
          if (!claimed.meta?.changes) return;
          const token2 = await createSession(env.SESSION_SECRET);
          const response = await worker.fetch(new Request(`https://edge-nba-ai.internal/api/espn/backfill?season=${state.season}&offset=${state.next_offset}&days=1`, { headers: { cookie: `edge_session=${encodeURIComponent(token2)}` } }), env);
          const body = await response.text();
          let result;
          try {
            result = JSON.parse(body);
          } catch {
            throw new Error(`Resposta inv\xE1lida no backfill autom\xE1tico: ${body}`);
          }
          if (!response.ok || !result.range || result.success !== true || Array.isArray(result.errors) && result.errors.length > 0) {
            throw new Error(`Backfill autom\xE1tico incompleto HTTP ${response.status}: ${body}`);
          }
          const nextOffset = Number(result.range.next_offset);
          if (!Number.isInteger(nextOffset) || nextOffset <= Number(state.next_offset)) {
            throw new Error(`Cursor de backfill inv\xE1lido: ${String(result.range.next_offset)}`);
          }
          const complete = result.range.complete === true;
          await env.DB.prepare(`UPDATE espn_backfill_state SET next_offset=?,status=?,locked_until=NULL,last_result=?,updated_at=CURRENT_TIMESTAMP WHERE id=1`).bind(nextOffset, complete ? "complete" : "running", JSON.stringify(result).slice(0, 12e3)).run();
          console.log(`Backfill autom\xE1tico: offset ${state.next_offset} -> ${nextOffset}; estado ${complete ? "complete" : "running"}`);
        } catch (error) {
          console.error("Backfill autom\xE1tico falhou:", error);
          try {
            await env.DB.prepare(`UPDATE espn_backfill_state SET locked_until=NULL,last_result=?,updated_at=CURRENT_TIMESTAMP WHERE id=1`).bind(JSON.stringify({ error: String(error) })).run();
          } catch {
          }
        }
        return;
      }
      const localDate = `${local.year}-${local.month}-${local.day}`;
      const previous = /* @__PURE__ */ new Date(`${localDate}T12:00:00Z`);
      previous.setUTCDate(previous.getUTCDate() - 1);
      const date = previous.toISOString().slice(0, 10).replace(/-/g, "");
      const token = await createSession(env.SESSION_SECRET);
      const cookie = `edge_session=${encodeURIComponent(token)}`;
      const rosterResponse = await worker.fetch(new Request("https://edge-nba-ai.internal/api/espn/sync-player-ids", {
        method: "POST",
        headers: { cookie }
      }), env);
      const rosterBody = await rosterResponse.text();
      if (!rosterResponse.ok) throw new Error(`Sincroniza\xE7\xE3o de plant\xE9is falhou: HTTP ${rosterResponse.status} ${rosterBody}`);
      let rosterResult;
      try {
        rosterResult = JSON.parse(rosterBody);
      } catch {
        throw new Error(`Resposta inv\xE1lida na sincroniza\xE7\xE3o de plant\xE9is: ${rosterBody}`);
      }
      if (rosterResult.success !== true) throw new Error(`Sincroniza\xE7\xE3o de plant\xE9is incompleta: ${JSON.stringify(rosterResult.errors || rosterResult)}`);
      const boxscoreResponse = await worker.fetch(new Request("https://edge-nba-ai.internal/api/espn/sync-boxscore", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ date })
      }), env);
      const boxscoreBody = await boxscoreResponse.text();
      if (!boxscoreResponse.ok) throw new Error(`Sincroniza\xE7\xE3o de boxscores falhou: HTTP ${boxscoreResponse.status} ${boxscoreBody}`);
      console.log(`Sincroniza\xE7\xE3o di\xE1ria ESPN conclu\xEDda para ${date}: ${boxscoreBody}`);
    })());
  }
};
var src_default = worker;

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-AUKnwH/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-AUKnwH/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker2) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker2;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker2.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker2.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker2,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker2.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker2.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
