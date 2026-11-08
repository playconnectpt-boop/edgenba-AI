export interface Env {
  DB: any;
  APP_ORIGIN?: string;
  APP_PASSWORD: string;
  SESSION_SECRET: string;
}

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';

// A época NBA começa em julho: julho-dezembro usa o ano civil; janeiro-junho usa o anterior.
const nbaSeasonForDate = (date = new Date()) => {
  const year = date.getUTCFullYear();
  return date.getUTCMonth() >= 6 ? year : year - 1;
};

const espnTeamIdsFromIndex = (payload: any): string[] => {
  const teams: any[] = payload?.sports?.flatMap((sport: any) =>
    (sport?.leagues || []).flatMap((league: any) => league?.teams || [])
  ) || [];
  const ids: string[] = teams
    .map((entry: any) => String(entry?.team?.id || entry?.id || ''))
    .filter((id: string) => /^\d+$/.test(id));
  return Array.from(new Set<string>(ids));
};
const cors = (env: Env) => ({
  'access-control-allow-origin': env.APP_ORIGIN || 'null',
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'content-type,authorization',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'vary': 'Origin'
});

const signSession = async (payload: string, secret: string) => {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
};

const createSession = async (secret: string) => {
  const payload = String(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return `${payload}.${await signSession(payload, secret)}`;
};

const validSession = async (token: string, secret: string) => {
  const [payload, signature] = token.split('.');
  if (!payload || !signature || !/^\d+$/.test(payload) || Number(payload) < Date.now()) return false;
  const expected = await signSession(payload, secret);
  const a = new TextEncoder().encode(signature);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
};

const getCookie = (request: Request, name: string) => {
  const cookie = request.headers.get('cookie') || '';
  const entry = cookie.split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : '';
};

const json = (data: unknown, status = 200, env?: Env, cache = 'no-store') => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache, ...(env ? cors(env) : {}) }
});
const validDate = (value: string | null) => !!value && /^\d{8}$/.test(value);

async function espn(path: string, ttlSeconds = 60): Promise<unknown> {
  const cache = (caches as unknown as { default: Cache }).default;
  const url = `${ESPN}/${path}`;
  const key = new Request(url, { method: 'GET' });
  const cached = await cache.match(key);
  if (cached) return cached.json();
  const upstream = await fetch(url, { headers: { 'accept': 'application/json', 'user-agent': 'EDGE-NBA-AI/0.3' } });
  if (!upstream.ok) throw new Error(`ESPN respondeu HTTP ${upstream.status}`);
  const data = await upstream.json();
  const response = new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttlSeconds}` } });
  await cache.put(key, response);
  return data;
}

const ESPN_WEB = 'https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba';

async function espnPlayerGamelog(athleteId: string, espnSeason: number): Promise<any> {
  const cache = (caches as unknown as { default: Cache }).default;
  const url = `${ESPN_WEB}/athletes/${encodeURIComponent(athleteId)}/gamelog?season=${espnSeason}&seasontype=2`;
  const key = new Request(url, { method: 'GET' });
  const cached = await cache.match(key);
  if (cached) return cached.json();
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`ESPN gamelog HTTP ${response.status}`);
  const data = await response.json();
  const cachedResponse = new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' }
  });
  await cache.put(key, cachedResponse);
  return data;
}

const parseStatNumber = (value: unknown): number | null => {
  const parsed = Number.parseFloat(String(value ?? '').trim());
  return Number.isFinite(parsed) ? parsed : null;
};

const parseMinutes = (value: unknown): number | null => {
  const raw = String(value ?? '').trim();
  if (!raw || raw === '--' || raw.toUpperCase() === 'DNP') return null;
  if (raw.includes(':')) {
    const parts = raw.split(':').map(Number);
    return parts.length === 2 && parts.every(Number.isFinite) ? parts[0] + parts[1] / 60 : null;
  }
  return parseStatNumber(raw);
};

const madeValue = (value: unknown): number | null => {
  if (value == null) return null;
  const first = String(value).trim().split('-')[0];
  return parseStatNumber(first);
};

type ScheduledContext = { waitUntil(promise: Promise<unknown>): void };
type ScheduledControllerLike = { scheduledTime: number; cron: string };
type WorkerHandler = {
  fetch(request: Request, env: Env): Promise<Response>;
  scheduled(controller: ScheduledControllerLike, env: Env, ctx: ScheduledContext): void;
};

const worker: WorkerHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(env) });

    if (url.pathname === '/api/login' && request.method === 'POST') {
      let body: { password?: string };
      try { body = await request.json() as { password?: string }; }
      catch { return json({ error: 'invalid_json' }, 400, env); }
      if (!body.password || body.password !== env.APP_PASSWORD) return json({ error: 'invalid_password' }, 401, env);
      const token = await createSession(env.SESSION_SECRET);
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: {
          ...cors(env),
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'set-cookie': `edge_session=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=604800`
        }
      });
    }

    if (url.pathname === '/api/logout' && request.method === 'POST') {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...cors(env), 'content-type': 'application/json; charset=utf-8', 'set-cookie': 'edge_session=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0' }
      });
    }

    const sessionToken = getCookie(request, 'edge_session');
    if (!sessionToken || !(await validSession(sessionToken, env.SESSION_SECRET))) {
      return json({ error: 'unauthorized' }, 401, env);
    }

    if (url.pathname === '/api/health') return json({
      app: 'EDGE NBA AI', version: '0.4.0', status: 'espn-only',
      providers: { espn: 'public-endpoints-configured_not-yet-validated-in-production', database: env.DB ? 'bound' : 'not-bound' },
      productionReady: false
    }, 200, env);

    if (url.pathname === '/api/espn/scoreboard') {
      const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10).replaceAll('-', '');
      if (!validDate(date)) return json({ error: 'date deve ter o formato YYYYMMDD.' }, 400, env);
      try { return json({ source: 'ESPN', retrievedAt: new Date().toISOString(), data: await espn(`scoreboard?dates=${date}`, 60) }, 200, env, 'public, max-age=60'); }
      catch (e) { return json({ error: 'scoreboard_unavailable', detail: String(e) }, 502, env); }
    }

    if (url.pathname === '/api/espn/injuries') {
      try { return json({ source: 'ESPN', retrievedAt: new Date().toISOString(), data: await espn('injuries', 120) }, 200, env, 'public, max-age=120'); }
      catch (e) { return json({ error: 'injuries_unavailable', detail: String(e) }, 502, env); }
    }

    if (url.pathname === '/api/espn/summary') {
      const event = url.searchParams.get('event');
      if (!event || !/^\d+$/.test(event)) return json({ error: 'event id inválido.' }, 400, env);
      try { return json({ source: 'ESPN', eventId: event, retrievedAt: new Date().toISOString(), data: await espn(`summary?event=${event}`, 30) }, 200, env, 'public, max-age=30'); }
      catch (e) { return json({ error: 'summary_unavailable', detail: String(e) }, 502, env); }
    }
    if (url.pathname === '/api/espn/games') {
      if (!env.DB) return json({ error: 'd1_database_not_bound' }, 503, env);
      const now = new Date();
      const end = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const dates = new Set<string>();
      for (const d of [now, end]) dates.add(d.toISOString().slice(0, 10).replace(/-/g, ''));
      try {
        const found = new Map<string, any>();
        for (const date of dates) {
          const board: any = await espn(`scoreboard?dates=${date}`, 60);
          for (const event of board.events || []) {
            const kickoff = new Date(event.date || event.competitions?.[0]?.date || '');
            if (!Number.isFinite(kickoff.getTime()) || kickoff < now || kickoff > end) continue;
            const competition = event.competitions?.[0];
            const competitors = competition?.competitors || [];
            const home = competitors.find((team: any) => team.homeAway === 'home') || competitors[0];
            const away = competitors.find((team: any) => team.homeAway === 'away') || competitors[1];
            if (!home?.team?.id || !away?.team?.id) continue;
            found.set(String(event.id), {
              id: String(event.id), date: kickoff.toISOString(), game_date: kickoff.toISOString().slice(0, 10),
              home_team_id: String(home.team.id), away_team_id: String(away.team.id),
              home_team: home.team.displayName || home.team.name || '',
              away_team: away.team.displayName || away.team.name || '',
              status: event.status?.type?.description || event.status?.type?.name || 'scheduled'
            });
          }
        }
        const games = Array.from(found.values()).sort((a, b) => a.date.localeCompare(b.date));
        if (games.length) {
          const statements = games.map(game => env.DB.prepare(`
            INSERT INTO games (game_id, season, game_date, home_team, away_team, status)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(game_id) DO UPDATE SET game_date=excluded.game_date,
              home_team=excluded.home_team, away_team=excluded.away_team, status=excluded.status
          `).bind(game.id, Number(game.game_date.slice(5, 7)) >= 7 ? Number(game.game_date.slice(0, 4)) : Number(game.game_date.slice(0, 4)) - 1, game.game_date, game.home_team, game.away_team, game.status));
          for (let i = 0; i < statements.length; i += 50) await env.DB.batch(statements.slice(i, i + 50));
        }
        return json({ source: 'ESPN', data: games, meta: { window_hours: 24, window_start: now.toISOString(), window_end: end.toISOString(), games_count: games.length, d1_saved: games.length } }, 200, env, 'private, max-age=30');
      } catch (error) { return json({ error: 'espn_games_unavailable', detail: String(error) }, 502, env); }
    }

    if (url.pathname === '/api/espn/players' || url.pathname === '/api/espn/sync-player-ids') {
      if (!env.DB) return json({ error: 'd1_database_not_bound' }, 503, env);
      const season = nbaSeasonForDate();
      const errors: string[] = [];
      let teamIds: string[] = [];
      try {
        const index: any = await espn('teams?limit=100', 21600);
        teamIds = espnTeamIdsFromIndex(index);
      } catch (error) {
        return json({ error: 'espn_teams_index_failed', detail: String(error) }, 502, env);
      }
      if (!teamIds.length) return json({ error: 'espn_teams_index_empty', detail: 'A ESPN não devolveu IDs de equipas válidos.' }, 502, env);
      let rostersRead = 0;
      let athletesRead = 0;
      let savedPlayers = 0;
      let mappedHistorical = 0;
      const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
      try {
        await env.DB.prepare(`CREATE TABLE IF NOT EXISTS player_seasons (player_id TEXT NOT NULL, season INTEGER NOT NULL, team_id TEXT, team_name TEXT, PRIMARY KEY (player_id, season))`).run();
        // Não recriar a tabela: a migração existente não inclui matched_by.
        await env.DB.prepare(`CREATE TABLE IF NOT EXISTS player_source_ids (player_id TEXT NOT NULL, source TEXT NOT NULL, source_player_id TEXT NOT NULL, season INTEGER NOT NULL, verified INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (player_id, source, season))`).run();
        const dbResult = await env.DB.prepare('SELECT p.player_id, p.name, ps.team_name FROM players p LEFT JOIN player_seasons ps ON ps.player_id=p.player_id AND ps.season=?').bind(season).all();
        const existing = (dbResult.results || []) as any[];
        const existingByNameTeam = new Map<string, any[]>();
        for (const player of existing) {
          const key = `${normalize(String(player.name || ''))}|${normalize(String(player.team_name || ''))}`;
          const list = existingByNameTeam.get(key) || [];
          list.push(player);
          existingByNameTeam.set(key, list);
        }
        const inserts: any[] = [];
        const mappings: any[] = [];
        for (const teamId of teamIds) {
          try {
            const roster: any = await espn(`teams/${teamId}/roster`, 21600);
            const teamName = String(roster.team?.displayName || '').trim();
            const athletes = Array.isArray(roster.athletes) ? roster.athletes : [];
            if (!teamName) { errors.push(`Roster ESPN ${teamId}: nome de equipa ausente`); continue; }
            rostersRead++;
            for (const athlete of athletes) {
              athletesRead++;
              const espnId = String(athlete.id || '').trim();
              const name = String(athlete.displayName || athlete.fullName || '').trim();
              if (!espnId || !name) continue;
              const key = `${normalize(name)}|${normalize(teamName)}`;
              const candidates = existingByNameTeam.get(key) || [];
              const legacy = candidates.length === 1 ? candidates[0] : null;
              const internalId = legacy ? String(legacy.player_id) : espnId;
              const position = athlete.position?.abbreviation || athlete.position?.name || null;
              const teamEspnId = String(roster.team?.id || teamId);
              inserts.push(env.DB.prepare(`INSERT INTO players (player_id,name,team_id,position,updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(player_id) DO UPDATE SET name=excluded.name,team_id=excluded.team_id,position=excluded.position,updated_at=CURRENT_TIMESTAMP`).bind(internalId, name, teamEspnId, position));
              inserts.push(env.DB.prepare(`INSERT INTO player_seasons (player_id,season,team_id,team_name) VALUES (?,?,?,?) ON CONFLICT(player_id,season) DO UPDATE SET team_id=excluded.team_id,team_name=excluded.team_name`).bind(internalId, season, teamEspnId, teamName));
              mappings.push(env.DB.prepare(`INSERT INTO player_source_ids (player_id,source,source_player_id,season,verified,updated_at) VALUES (?,'ESPN',?,?,1,CURRENT_TIMESTAMP) ON CONFLICT(player_id,source,season) DO UPDATE SET source_player_id=excluded.source_player_id,verified=1,updated_at=CURRENT_TIMESTAMP`).bind(internalId, espnId, season));
              if (legacy) mappedHistorical++;
              savedPlayers++;
            }
          } catch (error) { errors.push(`Roster ESPN ${teamId}: ${String(error)}`); }
        }
        const allStatements = [...inserts, ...mappings];
        for (let i = 0; i < allStatements.length; i += 50) await env.DB.batch(allStatements.slice(i, i + 50));
        return json({ success: errors.length === 0, source: 'ESPN', season, espn_rosters_read: rostersRead, espn_athletes_read: athletesRead, players_processed: savedPlayers, historical_ids_mapped: mappedHistorical, errors }, 200, env);
      } catch (error) { return json({ error: 'espn_player_sync_failed', detail: String(error), errors }, 500, env); }
    }


    // Inicia o backfill automático sem repor um cursor já guardado na mesma época.
    if (url.pathname === '/api/espn/backfill/start' && (request.method === 'POST' || request.method === 'GET')) {
      if (!env.DB) return json({ error: 'd1_database_not_bound' }, 503, env);
      const season = nbaSeasonForDate();
      const start = new Date(Date.UTC(season, 9, 1));
      const today = new Date();
      const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
      const totalDays = Math.max(0, Math.floor((todayUtc.getTime() - start.getTime()) / 86400000) + 1);
      try {
        await env.DB.prepare(`CREATE TABLE IF NOT EXISTS espn_backfill_state (id INTEGER PRIMARY KEY CHECK(id=1), season INTEGER NOT NULL, next_offset INTEGER NOT NULL DEFAULT 0, total_days INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'running', locked_until INTEGER, last_result TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`).run();
        await env.DB.prepare(`INSERT INTO espn_backfill_state (id,season,next_offset,total_days,status,locked_until,last_result,updated_at) VALUES (1,?,0,?,'running',NULL,NULL,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET next_offset=CASE WHEN espn_backfill_state.season=excluded.season THEN espn_backfill_state.next_offset ELSE 0 END, total_days=excluded.total_days, status=CASE WHEN espn_backfill_state.season=excluded.season THEN espn_backfill_state.status ELSE 'running' END, locked_until=CASE WHEN espn_backfill_state.season=excluded.season THEN espn_backfill_state.locked_until ELSE NULL END, last_result=CASE WHEN espn_backfill_state.season=excluded.season THEN espn_backfill_state.last_result ELSE NULL END, season=excluded.season, updated_at=CURRENT_TIMESTAMP`).bind(season,totalDays).run();
        const state = await env.DB.prepare(`SELECT season,next_offset,total_days,status FROM espn_backfill_state WHERE id=1`).first() as any;
        return json({ success: true, ...state, cadence: 'um dia por execução diária' }, 200, env);
      } catch (error) { return json({ error: 'backfill_start_failed', detail: String(error) }, 500, env); }
    }

    if (url.pathname === '/api/espn/backfill/status') {
      try {
        const state = await env.DB.prepare(`SELECT season,next_offset,total_days,status,last_result,updated_at FROM espn_backfill_state WHERE id=1`).first();
        return json({ success: true, backfill: state || null }, 200, env);
      } catch (error) { return json({ success: false, error: 'backfill_not_started', detail: String(error) }, 200, env); }
    }

    // Backfill incremental por datas e boxscores oficiais ESPN (não usa athlete gamelog, que devolve HTTP 403).
    if (url.pathname === '/api/espn/backfill') {
      if (!env.DB) return json({ error: 'd1_database_not_bound' }, 503, env);
      const season = Number(url.searchParams.get('season') || nbaSeasonForDate());
      const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
      const days = Math.min(7, Math.max(1, Number(url.searchParams.get('days') || 7)));
      if (!Number.isInteger(season) || season !== nbaSeasonForDate() || !Number.isInteger(offset) || !Number.isInteger(days)) {
        return json({ error: 'Parâmetros inválidos. O backfill aceita a época atual, offset em dias e lotes até 7 dias.' }, 400, env);
      }
      try {
        const start = new Date(Date.UTC(season, 9, 1)); // início operacional do backfill: 1 de outubro.
        const today = new Date();
        const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
        const totalDays = Math.max(0, Math.floor((todayUtc.getTime() - start.getTime()) / 86400000) + 1);
        const endOffset = Math.min(offset + days, totalDays);
        const ids = await env.DB.prepare(
          "SELECT source_player_id,player_id FROM player_source_ids WHERE source='ESPN' AND season=? AND verified=1"
        ).bind(season).all();
        const playerMap = new Map<string, string>((ids.results || []).map((x: any) => [String(x.source_player_id), String(x.player_id)]));
        if (playerMap.size === 0) {
          return json({ success: false, error: 'espn_player_mappings_missing', detail: 'Não existem IDs ESPN verificados para esta época; sincroniza os plantéis antes de avançar o backfill.', mappings_available: 0 }, 409, env);
        }
        const gameRows = new Map<string, any>();
        const statRows = new Map<string, any>();
        const errors: string[] = [];
        let datesChecked = 0;
        let gamesSeen = 0;
        let completedGames = 0;
        for (let dayOffset = offset; dayOffset < endOffset; dayOffset++) {
          const dateObj = new Date(start.getTime() + dayOffset * 86400000);
          const date = dateObj.toISOString().slice(0, 10).replace(/-/g, '');
          datesChecked++;
          let board: any;
          try { board = await espn(`scoreboard?dates=${date}`, 3600); }
          catch (e) { errors.push(`${date} scoreboard: ${String(e)}`); continue; }
          const events = Array.isArray(board?.events) ? board.events : [];
          gamesSeen += events.length;
          for (const event of events) {
            if (event?.status?.type?.completed !== true) continue;
            const eventId = String(event.id || '');
            const competition = event.competitions?.[0];
            const competitors = competition?.competitors || [];
            if (!/^\d+$/.test(eventId) || competitors.length < 2) continue;
            const home = competitors.find((x: any) => x.homeAway === 'home') || competitors[0];
            const away = competitors.find((x: any) => x.homeAway === 'away') || competitors[1];
            const homeName = String(home?.team?.displayName || home?.team?.name || '');
            const awayName = String(away?.team?.displayName || away?.team?.name || '');
            const isoDate = dateObj.toISOString().slice(0, 10);
            gameRows.set(eventId, { id: eventId, date: isoDate, home: homeName, away: awayName, status: event.status?.type?.description || 'Final' });
            try {
              const summary: any = await espn(`summary?event=${eventId}`, 86400);
              const teams = Array.isArray(summary?.boxscore?.players) ? summary.boxscore.players : [];
              if (!teams.length) { errors.push(`${eventId}: boxscore ausente`); continue; }
              completedGames++;
              for (const team of teams) {
                const teamId = String(team?.team?.id || '');
                const opponent = String(competitors.find((x: any) => String(x.team?.id || '') !== teamId)?.team?.displayName || '');
                for (const group of team.statistics || []) {
                  const labels: string[] = (group.labels || group.names || []).map((x: unknown) => String(x).toUpperCase());
                  for (const item of group.athletes || []) {
                    const athleteId = String(item?.athlete?.id || '');
                    const playerId = playerMap.get(athleteId);
                    if (!playerId) continue;
                    const values = Array.isArray(item.stats) ? item.stats : [];
                    const stat: Record<string, unknown> = {};
                    labels.forEach((label, index) => { stat[label.replace(/[^A-Z0-9]/g, '')] = values[index]; });
                    const minRaw = stat.MIN ?? stat.MINUTES;
                    const minutes = parseMinutes(minRaw);
                    if (minutes === null) continue;
                    const pair = (value: unknown): [number | null, number | null] => {
                      const parts = String(value ?? '').split('-');
                      return [parseStatNumber(parts[0]), parseStatNumber(parts[1])];
                    };
                    const [fgm, fga] = pair(stat.FG);
                    const [tpm, tpa] = pair(stat['3PT']);
                    const key = `${playerId}:${eventId}`;
                    statRows.set(key, {
                      playerId, eventId, season, date: isoDate, opponent: opponent || null, minutes,
                      points: parseStatNumber(stat.PTS), rebounds: parseStatNumber(stat.REB), assists: parseStatNumber(stat.AST),
                      steals: parseStatNumber(stat.STL), blocks: parseStatNumber(stat.BLK), turnovers: parseStatNumber(stat.TO ?? stat.TOV),
                      threes: tpm, fgm, fga, tpa
                    });
                  }
                }
              }
            } catch (e) { errors.push(`${eventId} summary: ${String(e)}`); }
          }
        }
        const gameStatements = Array.from(gameRows.values()).map(game => env.DB.prepare(
          `INSERT INTO games (game_id,season,game_date,home_team,away_team,status) VALUES (?,?,?,?,?,?)
           ON CONFLICT(game_id) DO UPDATE SET game_date=excluded.game_date,home_team=excluded.home_team,away_team=excluded.away_team,status=excluded.status`
        ).bind(game.id, season, game.date, game.home, game.away, game.status));
        const statStatements = Array.from(statRows.values()).map(row => env.DB.prepare(
          `INSERT INTO player_game_stats
           (player_id,game_id,season,game_date,opponent,minutes,points,rebounds,assists,steals,blocks,turnovers,three_pointers_made,field_goals_made,field_goals_attempted,three_pointers_attempted)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(player_id,game_id,season) DO UPDATE SET game_date=excluded.game_date,opponent=excluded.opponent,minutes=excluded.minutes,
           points=excluded.points,rebounds=excluded.rebounds,assists=excluded.assists,steals=excluded.steals,blocks=excluded.blocks,
           turnovers=excluded.turnovers,three_pointers_made=excluded.three_pointers_made,field_goals_made=excluded.field_goals_made,
           field_goals_attempted=excluded.field_goals_attempted,three_pointers_attempted=excluded.three_pointers_attempted,updated_at=CURRENT_TIMESTAMP`
        ).bind(row.playerId,row.eventId,row.season,row.date,row.opponent,row.minutes,row.points,row.rebounds,row.assists,row.steals,row.blocks,row.turnovers,row.threes,row.fgm,row.fga,row.tpa));
        for (let i = 0; i < gameStatements.length; i += 50) await env.DB.batch(gameStatements.slice(i, i + 50));
        for (let i = 0; i < statStatements.length; i += 50) await env.DB.batch(statStatements.slice(i, i + 50));
        return json({ success: errors.length === 0, source: 'ESPN scoreboard + game summaries', internal_season: season,
          range: { start: new Date(start.getTime() + offset * 86400000).toISOString().slice(0,10), days_checked: datesChecked, next_offset: endOffset, total_days: totalDays, complete: endOffset >= totalDays },
          mappings_available: playerMap.size, games_seen: gamesSeen, completed_games_with_boxscore: completedGames,
          games_upserted: gameRows.size, player_game_stats_upserted: statRows.size, errors }, 200, env);
      } catch (error) { return json({ error: 'espn_backfill_failed', detail: String(error) }, 500, env); }
    }

    if (url.pathname === '/api/espn/player-search') {
      if (!env.DB) return json({ error: 'd1_database_not_bound' }, 503, env);
      const query = (url.searchParams.get('name') || '').trim();
      if (query.length < 2 || query.length > 80) return json({ error: 'Indica pelo menos 2 caracteres.' }, 400, env);
      try {
        const rows = await env.DB.prepare(`SELECT p.player_id AS id,p.name,ps.team_name,p.position FROM players p LEFT JOIN player_seasons ps ON ps.player_id=p.player_id AND ps.season=? WHERE lower(p.name) LIKE ? ORDER BY p.name LIMIT 30`).bind(nbaSeasonForDate(), `%${query.toLowerCase()}%`).all();
        return json({ source: 'ESPN / D1', data: rows.results || [] }, 200, env, 'private, max-age=60');
      } catch (error) { return json({ error: 'espn_player_search_failed', detail: String(error) }, 500, env); }
    }

    if (url.pathname === '/api/espn/player-gamelog') {
      if (!env.DB) return json({ error: 'd1_database_not_bound' }, 503, env);
      const playerId = url.searchParams.get('playerId') || '';
      const season = Number(url.searchParams.get('season') || nbaSeasonForDate());
      if (!playerId || playerId.length > 80 || !Number.isInteger(season)) return json({ error: 'Parâmetros inválidos.' }, 400, env);
      try {
        const rows = await env.DB.prepare(`SELECT game_date AS date,minutes,points,rebounds,assists,three_pointers_made AS threes,three_pointers_attempted AS threePointAttempts FROM player_game_stats WHERE player_id=? AND season=? ORDER BY game_date DESC`).bind(playerId,season).all();
        return json({ source: 'ESPN / Cloudflare D1', data: rows.results || [], meta: { sample: (rows.results || []).length, season } }, 200, env, 'private, max-age=60');
      } catch (error) { return json({ error: 'espn_gamelog_failed', detail: String(error) }, 500, env); }
    }

    if (url.pathname === '/api/espn/player-gamelogs' && request.method === 'POST') {
      if (!env.DB) return json({ error: 'd1_database_not_bound' }, 503, env);
      let body: { playerIds?: unknown; season?: number };
      try { body = await request.json() as { playerIds?: unknown; season?: number }; } catch { return json({ error: 'invalid_json' }, 400, env); }
      const ids = Array.isArray(body.playerIds) ? [...new Set(body.playerIds.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 80))].slice(0,20) : [];
      const season = Number(body.season || nbaSeasonForDate());
      if (!ids.length || !Number.isInteger(season)) return json({ error: 'Indica IDs e época válidos.' }, 400, env);
      try {
        const results = [];
        for (const playerId of ids) {
          const rows = await env.DB.prepare(`SELECT game_date AS date,minutes,points,rebounds,assists,three_pointers_made AS threes,three_pointers_attempted AS threePointAttempts FROM player_game_stats WHERE player_id=? AND season=? ORDER BY game_date DESC LIMIT 100`).bind(playerId,season).all();
          results.push({ playerId, data: rows.results || [] });
        }
        return json({ source: 'ESPN / Cloudflare D1', results }, 200, env, 'private, max-age=30');
      } catch (error) { return json({ error: 'espn_gamelogs_failed', detail: String(error) }, 500, env); }
    }

    if (url.pathname === '/api/scan/players') {
      if (!env.DB) return json({ error: 'd1_database_not_bound' }, 503, env);
      const teams = Array.from(new Set((url.searchParams.get('teams') || '')
        .split('|').map(value => value.trim()).filter(Boolean)));
      if (teams.length < 1 || teams.length > 30 || teams.some(team => team.length > 80)) {
        return json({ error: 'Indica entre 1 e 30 nomes de equipas válidos.' }, 400, env);
      }
      const placeholders = teams.map(() => '?').join(',');
      try {
        // Considerar os últimos jogos efetivamente disputados em 2025/26 e 2026/27.
        // Lesões/suspensões não são critério de exclusão: o frontend anexa o estado ESPN.
        // A elegibilidade vem da utilização histórica, incluindo jogos anteriores à lesão.
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
        const players = (result.results || []).map((row: Record<string, unknown>) => ({
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
        const foundTeams = Array.from(new Set(players.map((player: { team_name: string }) => player.team_name))).sort();
        return json({
          source: 'Cloudflare D1 / ESPN',
          season: nbaSeasonForDate(),
          requested_teams: teams,
          found_teams: foundTeams,
          missing_teams: teams.filter(team => !foundTeams.includes(team)),
          players,
          meta: { players_count: players.length, rotation_count: players.filter((player: { rotation_eligible: boolean }) => player.rotation_eligible).length, teams_requested: teams.length, teams_found: foundTeams.length }
        }, 200, env, 'private, max-age=300');
      } catch (error) {
        return json({ error: 'scan_players_query_failed', detail: String(error) }, 500, env);
      }
    }

    if (url.pathname === '/api/scan/status') return json({
      status: 'espn-only-data-mode', maxDailyCandidates: 10,
      connectedSources: ['ESPN scoreboard', 'ESPN rosters', 'ESPN injury report', 'ESPN game summaries (on demand)'],
      requiresSetup: ['Deploy Worker', 'Sync ESPN rosters', 'Validate ESPN response schemas'],
      blockedClaims: ['No calibrated probability until historical backtesting is complete', 'No Top 10 publication until complete slate and player coverage are verified'],
      markets: ['points', 'rebounds', 'assists', 'threes', 'PRA']
    }, 200, env);

    if (url.pathname === '/api/analysis/ev' && request.method === 'POST') {
      const body = await request.json() as { probability?: number; odds?: number; modelReference?: string; calibrated?: boolean };
      const p = body.probability, odds = body.odds;
      if (typeof p !== 'number' || p <= 0 || p >= 1 || typeof odds !== 'number' || odds <= 1 || !body.modelReference || body.calibrated !== true)
        return json({ error: 'É necessária uma probabilidade do modelo calibrado, odd decimal > 1 e referência verificável. Não são aceites probabilidades introduzidas manualmente.' }, 400, env);
      return json({ fairOdds: 1 / p, evPerUnit: p * (odds - 1) - (1 - p), modelReference: body.modelReference }, 200, env);
    }

    if (url.pathname === '/api/espn/sync-boxscore' && request.method === 'POST') {
      const body = await request.json() as { date?: string };
      const date = body.date || new Date().toISOString().slice(0,10).replace(/-/g,'');
      if (!/^\d{8}$/.test(date)) return json({error:'date inválida'},400,env);
      const iso = `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`;
      const season = Number(date.slice(4,6)) >= 7 ? Number(date.slice(0,4)) : Number(date.slice(0,4)) - 1;
      const ids = await env.DB.prepare(
        "SELECT source_player_id,player_id FROM player_source_ids WHERE source='ESPN' AND season=? AND verified=1"
      ).bind(season).all();
      const playerMap = new Map((ids.results || []).map((x:any)=>[String(x.source_player_id),x.player_id]));
      const saved = new Set<string>();
      const errors:string[] = [];
      const board:any = await espn(`scoreboard?dates=${date}`,60);
      for (const event of board.events || []) {
        // Só sincronizar boxscores de jogos oficialmente concluídos.
        if (event.status?.type?.completed !== true) continue;
        const comp = event.competitions?.[0];
        const competitors = comp?.competitors || [];
        const espnTeamIds = competitors.map((x:any)=>String(x.team?.id || ''));
        if (competitors.length < 2) continue;
        const home = competitors.find((x:any)=>x.homeAway==='home') || competitors[0];
        const away = competitors.find((x:any)=>x.homeAway==='away') || competitors[1];
        const game = { game_id: String(event.id), game_date: iso, season,
          home_team: String(home.team?.displayName || home.team?.name || ''),
          away_team: String(away.team?.displayName || away.team?.name || '') };
        try {
          await env.DB.prepare(`INSERT INTO games (game_id,season,game_date,home_team,away_team,status) VALUES (?,?,?,?,?,?) ON CONFLICT(game_id) DO UPDATE SET game_date=excluded.game_date,home_team=excluded.home_team,away_team=excluded.away_team,status=excluded.status`).bind(game.game_id,game.season,game.game_date,game.home_team,game.away_team,event.status?.type?.description || 'final').run();
          const summary:any = await espn(`summary?event=${event.id}`,30);
          const teams = summary.boxscore?.players || [];
          if (!teams.length) continue;
          for (const team of teams) {
            const teamName = team.team?.displayName || '';
            const teamId = String(team.team?.id || '');
            const opponent = String(competitors.find((x:any)=>String(x.team?.id || '') !== teamId)?.team?.displayName || '') || null;
            for (const group of team.statistics || []) {
              const labels = group.labels || group.names || [];
              for (const item of group.athletes || []) {
                const athleteId = String(item.athlete?.id || '');
                const playerId = playerMap.get(athleteId);
                if (!playerId) continue;
                const vals = item.stats || [];
                const stat:any = {};
                labels.forEach((label:string,i:number)=>stat[label.toUpperCase()]=vals[i]);
                const num = (v:any) => {
                  const n=Number.parseFloat(String(v ?? ''));
                  return Number.isFinite(n)?n:null;
                };
                const minutesValue = String(stat.MIN ?? '').trim();
                const minutes = minutesValue.includes(':') ? (() => { const parts=minutesValue.split(':').map(Number); return parts.length===2 && parts.every(Number.isFinite) ? parts[0] + parts[1]/60 : null; })() : num(minutesValue);
                const pair = (v:any) => {
                  const a=String(v || '').split('-');
                  return [num(a[0]),num(a[1])];
                };
                const [fgm,fga]=pair(stat.FG);
                const [tpm,tpa]=pair(stat['3PT']);
                const [ftm,fta]=pair(stat.FT);
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
                ).bind(playerId,game.game_id,Number(game.season),game.game_date,opponent,minutes,num(stat.PTS),num(stat.REB),num(stat.AST),num(stat.STL),num(stat.BLK),num(stat.TO),tpm,fgm,fga,tpa).run();
              }
            }
          }
        } catch(e) { errors.push(`${event.id}: ${String(e)}`); }
      }
      return json({source:'ESPN',date:iso,games_found:(board.events||[]).length,players_saved:saved.size,errors},200,env);
    }

    return json({ error: 'not_found' }, 404, env);
  },

  scheduled(controller: ScheduledControllerLike, env: Env, ctx: ScheduledContext): void {
    ctx.waitUntil((async () => {
      // Existem dois Cron Triggers UTC (09:00 e 10:00). Este filtro garante
      // uma única execução às 10:00 em Europe/Lisbon, com horário de verão/inverno.
      const now = new Date();
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Lisbon', hour: '2-digit', minute: '2-digit',
        year: 'numeric', month: '2-digit', day: '2-digit', hourCycle: 'h23'
      }).formatToParts(now);
      const local = Object.fromEntries(parts.map(part => [part.type, part.value]));
      if (!env.DB) throw new Error('D1 não está ligada ao Worker.');

      // Uma das duas execuções UTC diárias não coincide com as 10:00 locais
      // e avança exatamente um dia do backfill, preservando a cadência diária.
      if (local.hour !== '10' || local.minute !== '00') {
        try {
          const state = await env.DB.prepare(`SELECT season,next_offset,total_days,status,locked_until FROM espn_backfill_state WHERE id=1`).first() as any;
          if (!state || state.status !== 'running') return;
          const nowMs = Date.now();
          if (state.locked_until && Number(state.locked_until) > nowMs) return;
          const claimed = await env.DB.prepare(`UPDATE espn_backfill_state SET locked_until=?,updated_at=CURRENT_TIMESTAMP WHERE id=1 AND status='running' AND (locked_until IS NULL OR locked_until<=?)`).bind(nowMs + 4 * 60 * 1000, nowMs).run();
          if (!claimed.meta?.changes) return;
          const token = await createSession(env.SESSION_SECRET);
          const response = await worker.fetch(new Request(`https://edge-nba-ai.internal/api/espn/backfill?season=${state.season}&offset=${state.next_offset}&days=1`, { headers: { cookie: `edge_session=${encodeURIComponent(token)}` } }), env);
          const body = await response.text();
          let result: any;
          try { result = JSON.parse(body); } catch { throw new Error(`Resposta inválida no backfill automático: ${body}`); }
          // Só avançar o cursor quando o dia foi importado sem erros.
          // Se houver falhas parciais, repetir o mesmo dia é seguro graças aos UPSERTs.
          if (!response.ok || !result.range || result.success !== true || (Array.isArray(result.errors) && result.errors.length > 0)) {
            throw new Error(`Backfill automático incompleto HTTP ${response.status}: ${body}`);
          }
          const nextOffset = Number(result.range.next_offset);
          if (!Number.isInteger(nextOffset) || nextOffset <= Number(state.next_offset)) {
            throw new Error(`Cursor de backfill inválido: ${String(result.range.next_offset)}`);
          }
          const complete = result.range.complete === true;
          await env.DB.prepare(`UPDATE espn_backfill_state SET next_offset=?,status=?,locked_until=NULL,last_result=?,updated_at=CURRENT_TIMESTAMP WHERE id=1`).bind(nextOffset, complete ? 'complete' : 'running', JSON.stringify(result).slice(0, 12000)).run();
          console.log(`Backfill automático: offset ${state.next_offset} -> ${nextOffset}; estado ${complete ? 'complete' : 'running'}`);
        } catch (error) {
          console.error('Backfill automático falhou:', error);
          try { await env.DB.prepare(`UPDATE espn_backfill_state SET locked_until=NULL,last_result=?,updated_at=CURRENT_TIMESTAMP WHERE id=1`).bind(JSON.stringify({ error: String(error) })).run(); } catch {}
        }
        return;
      }

      const localDate = `${local.year}-${local.month}-${local.day}`;
      const previous = new Date(`${localDate}T12:00:00Z`);
      previous.setUTCDate(previous.getUTCDate() - 1);
      const date = previous.toISOString().slice(0, 10).replace(/-/g, '');
      const token = await createSession(env.SESSION_SECRET);
      const cookie = `edge_session=${encodeURIComponent(token)}`;

      // Revalidar plantéis/IDs e depois importar apenas os jogos do dia anterior.
      const rosterResponse = await worker.fetch(new Request('https://edge-nba-ai.internal/api/espn/sync-player-ids', {
        method: 'POST', headers: { cookie }
      }), env);
      const rosterBody = await rosterResponse.text();
      if (!rosterResponse.ok) throw new Error(`Sincronização de plantéis falhou: HTTP ${rosterResponse.status} ${rosterBody}`);
      let rosterResult: any;
      try { rosterResult = JSON.parse(rosterBody); } catch { throw new Error(`Resposta inválida na sincronização de plantéis: ${rosterBody}`); }
      if (rosterResult.success !== true) throw new Error(`Sincronização de plantéis incompleta: ${JSON.stringify(rosterResult.errors || rosterResult)}`);

      const boxscoreResponse = await worker.fetch(new Request('https://edge-nba-ai.internal/api/espn/sync-boxscore', {
        method: 'POST', headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ date })
      }), env);
      const boxscoreBody = await boxscoreResponse.text();
      if (!boxscoreResponse.ok) throw new Error(`Sincronização de boxscores falhou: HTTP ${boxscoreResponse.status} ${boxscoreBody}`);
      console.log(`Sincronização diária ESPN concluída para ${date}: ${boxscoreBody}`);
    })());
  }
};

export default worker;
