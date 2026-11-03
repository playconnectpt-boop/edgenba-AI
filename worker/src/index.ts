export interface Env {
  DB: any;
  BIGBALLSDATA_API_KEY?: string;
  APP_ORIGIN?: string;
  APP_PASSWORD: string;
  SESSION_SECRET: string;
}

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
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

export default {
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
      app: 'EDGE NBA AI', version: '0.3.0', status: 'data-connectors-available',
      providers: {
        espn: 'public-endpoints-configured_not-yet-validated-in-production',
        bigBallsData: env.BIGBALLSDATA_API_KEY ? 'secret-configured' : 'api-key-required-for-player-game-logs',
        database: env.DB ? 'bound' : 'not-bound'
      }, productionReady: false
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
  if (url.pathname === '/api/bbd/matches') {
    if (!env.BIGBALLSDATA_API_KEY) return json({ error: 'bigballsdata_key_missing' }, 503, env);
    const now = new Date();
    const end = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const dates: string[] = [];
    for (let d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())); d <= end; d.setUTCDate(d.getUTCDate() + 1)) dates.push(d.toISOString().slice(0, 10));
    const cache = (caches as unknown as { default: Cache }).default;
    const key = new Request(`https://edge-nba-cache.internal/bbd/matches-48h-${dates.join('-')}-${Math.floor(now.getTime()/60000)}`);
    const cached = await cache.match(key);

    const persistMatches = async (rows: Record<string, unknown>[]) => {
      let saved = 0;
      for (let i = 0; i < rows.length; i += 40) {
        const statements = rows.slice(i, i + 40).map((m) => {
          const home = m.home && typeof m.home === 'object' ? m.home as Record<string, unknown> : {};
          const away = m.away && typeof m.away === 'object' ? m.away as Record<string, unknown> : {};
          const gameId = String(m.id ?? m.match_id ?? '');
          const seasonValue = Number(m.season);
          const gameDate = String(m.game_date ?? '');
          const homeId = String(home.id ?? '');
          const awayId = String(away.id ?? '');
          const status = String(m.status ?? 'unknown');
          if (!gameId || !Number.isInteger(seasonValue) || !/^\d{4}-\d{2}-\d{2}$/.test(gameDate) || !homeId || !awayId) {
            throw new Error(`Jogo com campos obrigatórios inválidos: ${gameId || 'sem ID'}`);
          }
          return env.DB.prepare(`
            INSERT INTO games (game_id, season, game_date, home_team_id, away_team_id, status, source, fetched_at)
            VALUES (?, ?, ?, ?, ?, ?, 'bigballsdata', CURRENT_TIMESTAMP)
            ON CONFLICT(game_id) DO UPDATE SET
              season = excluded.season,
              game_date = excluded.game_date,
              home_team_id = excluded.home_team_id,
              away_team_id = excluded.away_team_id,
              status = excluded.status,
              source = excluded.source,
              fetched_at = CURRENT_TIMESTAMP
          `).bind(gameId, seasonValue, gameDate, homeId, awayId, status);
        });
        if (statements.length) {
          await env.DB.batch(statements);
          saved += statements.length;
        }
      }
      return saved;
    };

    if (cached) {
      try {
        const payload = await cached.json() as { data?: Record<string, unknown>[]; meta?: Record<string, unknown> };
        const complete = payload.meta?.complete === true;
        const saved = complete ? await persistMatches(payload.data || []) : 0;
        const body = JSON.stringify({ ...payload, meta: { ...payload.meta, d1_synced: complete && saved === (payload.data || []).length, d1_saved: saved } });
        return new Response(body, { status: 200, headers: { ...cors(env), 'content-type': 'application/json', 'x-edge-cache': 'HIT' } });
      } catch (error) { return json({ error: 'd1_match_sync_failed', detail: String(error) }, 500, env); }
    }
    try {
      const found = new Map<string, Record<string, unknown>>();
      const errors: string[] = []; let truncated = false;
      for (const date of dates) {
        for (let page = 1; page <= 10; page++) {
          const u = new URL('https://api.bigballsdata.com/v1/matches');
          u.searchParams.set('sport','basketball'); u.searchParams.set('league','nba'); u.searchParams.set('date',date); u.searchParams.set('limit','200'); u.searchParams.set('page',String(page));
          const r = await fetch(u.toString(), { headers: { authorization: `Bearer ${env.BIGBALLSDATA_API_KEY}`, accept: 'application/json' } });
          if (!r.ok) { errors.push(`${date}: HTTP ${r.status}`); break; }
          const payload = await r.json() as { data?: unknown };
          const rows = Array.isArray(payload.data) ? payload.data : [];
          for (const item of rows) if (item && typeof item === 'object') { const m = item as Record<string, unknown>; const id = String(m.id ?? m.match_id ?? "");
          const homeTeam = m.home && typeof m.home === 'object' ? m.home as Record<string, unknown> : {};
          const awayTeam = m.away && typeof m.away === 'object' ? m.away as Record<string, unknown> : {};
          const home = String(homeTeam.id ?? homeTeam.name ?? '').toLowerCase();
          const away = String(awayTeam.id ?? awayTeam.name ?? '').toLowerCase();
          const kickoff = String(m.kickoff_utc ?? m.start_time ?? m.starts_at ?? "");
          const key = kickoff && home && away ? `${kickoff}|${[home, away].sort().join("|")}` : id;
          if (key) found.set(key,m); }
          if (rows.length < 200) break;
          if (page === 10) truncated = true;
        }
      }
      const time = (m: Record<string, unknown>) => new Date(String(m.kickoff_utc ?? m.start_time ?? m.starts_at ?? '')).getTime();
      const data = Array.from(found.values()).filter(m => Number.isFinite(time(m)) && time(m) >= now.getTime() && time(m) <= end.getTime()).sort((x,y) => time(x)-time(y));
      const complete = errors.length === 0 && !truncated;
      const saved = complete ? await persistMatches(data) : 0;
      const body = JSON.stringify({ data, meta: { window_hours: 48, timezone_display: 'Europe/Lisbon', window_start_utc: now.toISOString(), window_end_utc: end.toISOString(), dates_queried: dates, matches_count: data.length, complete, pagination_truncated: truncated, errors, d1_synced: complete && saved === data.length, d1_saved: saved } });
      const response = new Response(body, { headers: { 'content-type':'application/json', 'cache-control':'public, max-age=30' } });
      await cache.put(key,response);
      return new Response(body, { headers: { 'content-type':'application/json', ...cors(env), 'x-edge-cache':'MISS' } });
    } catch (error) { return json({ error:'bigballsdata_matches_unavailable', detail:String(error) },502,env); }
  }


    if (url.pathname === '/api/bbd/players') {
      if (!env.BIGBALLSDATA_API_KEY) {
        return json({ error: 'bigballsdata_key_missing' }, 503, env);
      }
      if (!env.DB) {
        return json({ error: 'd1_database_not_bound' }, 503, env);
      }

      const season = 2026; // NBA 2026/27
      const cache = (caches as unknown as { default: Cache }).default;
      const cacheKey = new Request(`https://edge-nba-cache.internal/bbd/players-nba-season-${season}-v2`);

      const officialTeams = new Set([
        'Atlanta Hawks', 'Boston Celtics', 'Brooklyn Nets', 'Charlotte Hornets',
        'Chicago Bulls', 'Cleveland Cavaliers', 'Dallas Mavericks', 'Denver Nuggets',
        'Detroit Pistons', 'Golden State Warriors', 'Houston Rockets', 'Indiana Pacers',
        'LA Clippers', 'Los Angeles Lakers', 'Memphis Grizzlies', 'Miami Heat',
        'Milwaukee Bucks', 'Minnesota Timberwolves', 'New Orleans Pelicans',
        'New York Knicks', 'Oklahoma City Thunder', 'Orlando Magic', 'Philadelphia 76ers',
        'Phoenix Suns', 'Portland Trail Blazers', 'Sacramento Kings', 'San Antonio Spurs',
        'Toronto Raptors', 'Utah Jazz', 'Washington Wizards'
      ]);

      type PlayerRow = {
        id: string;
        name: string;
        position?: string | null;
        jersey_number?: string | number | null;
        headshot_url?: string | null;
        team?: { id?: string | number | null; name?: string | null } | null;
      };

      const savePlayers = async (rows: PlayerRow[]) => {
        let saved = 0;
        for (let i = 0; i < rows.length; i += 25) {
          const chunk = rows.slice(i, i + 25);
          const statements = chunk.flatMap((player) => {
            const teamId = player.team?.id == null ? null : String(player.team.id);
            const teamName = player.team?.name ?? null;
            return [
              env.DB!.prepare(`
                INSERT INTO players (player_id, name, team_id, position, updated_at)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(player_id) DO UPDATE SET
                  name = excluded.name,
                  team_id = excluded.team_id,
                  position = excluded.position,
                  updated_at = CURRENT_TIMESTAMP
              `).bind(
                player.id,
                player.name,
                teamId,
                player.position ?? null
              ),
              env.DB!.prepare(`
                INSERT INTO player_seasons (player_id, season, team_id, team_name)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(player_id, season) DO UPDATE SET
                  team_id = excluded.team_id,
                  team_name = excluded.team_name
              `).bind(player.id, season, teamId, teamName)
            ];
          });
          await env.DB.batch(statements);
          saved += chunk.length;
        }
        return saved;
      };

      // A cache hit may speed up the API response, but it must never bypass D1 sync.
      const cached = await cache.match(cacheKey);
      if (cached) {
        try {
          const cachedPayload = await cached.json() as {
            data?: PlayerRow[];
            meta?: { complete?: boolean };
          };
          if (cachedPayload.meta?.complete === true && Array.isArray(cachedPayload.data)) {
            const saved = await savePlayers(cachedPayload.data);
            return json({
              ...cachedPayload,
              meta: { ...cachedPayload.meta, d1_synced: true, d1_saved: saved, cache: 'HIT' }
            }, 200, env);
          }
        } catch (error) {
          // Ignore malformed/stale cache and rebuild from the source below.
          console.warn('Cache de jogadores ignorada:', String(error));
        }
      }

      const players = new Map<string, PlayerRow>();
      const teams = new Set<string>();
      const errors: string[] = [];
      let total = -1;
      let fetched = 0;
      let offset = 0;

      while (total < 0 || offset < total) {
        const upstreamUrl = new URL('https://api.bigballsdata.com/v1/stored/players');
        upstreamUrl.searchParams.set('league', 'nba');
        upstreamUrl.searchParams.set('limit', '50');
        upstreamUrl.searchParams.set('offset', String(offset));

        try {
          const upstream = await fetch(upstreamUrl.toString(), {
            headers: {
              authorization: `Bearer ${env.BIGBALLSDATA_API_KEY}`,
              accept: 'application/json'
            }
          });
          if (!upstream.ok) {
            errors.push(`offset ${offset}: HTTP ${upstream.status}`);
            break;
          }

          const payload = await upstream.json() as {
            data?: Record<string, unknown>[];
            pagination?: { total?: number };
          };
          const pageRows = Array.isArray(payload.data) ? payload.data : [];
          const pageTotal = Number(payload.pagination?.total);

          if (!Number.isInteger(pageTotal) || pageTotal < 0) {
            errors.push(`offset ${offset}: total inválido`);
            break;
          }
          if (total < 0) total = pageTotal;
          else if (pageTotal !== total) {
            errors.push('O total da API mudou durante a recolha');
            break;
          }
          if (pageRows.length === 0 && offset < total) {
            errors.push(`Página vazia antes do fim: offset ${offset}`);
            break;
          }

          for (const raw of pageRows) {
            fetched++;
            const team = raw.team && typeof raw.team === 'object'
              ? raw.team as { id?: string | number | null; name?: string | null }
              : null;
            const id = String(raw.id ?? '').trim();
            const name = String(raw.name ?? '').trim();
            const teamName = String(team?.name ?? raw.team_name ?? '').trim();
            if (!id || !name) {
              errors.push('Jogador sem ID ou nome');
              continue;
            }
            if (!officialTeams.has(teamName)) {
              errors.push(`Equipa não reconhecida: ${teamName || 'sem equipa'}`);
              continue;
            }
            teams.add(teamName);
            players.set(id, {
              id,
              name,
              position: raw.position == null ? null : String(raw.position),
              jersey_number: raw.jersey_number == null ? null : String(raw.jersey_number),
              headshot_url: raw.headshot_url == null ? null : String(raw.headshot_url),
              team: { id: team?.id ?? null, name: teamName }
            });
          }

          offset += pageRows.length;
          if (pageRows.length < 50 && offset < total) {
            errors.push('Página incompleta antes do total anunciado');
            break;
          }
        } catch (error) {
          errors.push(`offset ${offset}: ${String(error)}`);
          break;
        }
      }

      const playerList = Array.from(players.values());
      const complete = errors.length === 0 &&
        total >= 0 && fetched === total && playerList.length === total && teams.size === 30;

      // Persist every valid player collected, even when the upstream scan is partial.
      // Completeness describes source coverage; it must not control whether valid rows
      // are written to D1.
      let d1Saved = 0;
      if (playerList.length > 0) {
        try {
          d1Saved = await savePlayers(playerList);
        } catch (error) {
          // Emit the underlying D1 exception in Worker logs so the failing
          // SQL statement can be identified from `wrangler tail`.
          console.error('D1_PLAYER_SYNC_FAILED', error);
          return json({
            error: 'd1_player_sync_failed',
            detail: error instanceof Error
              ? `${error.name}: ${error.message}`
              : String(error),
            meta: {
              total_api: total,
              total_fetched: fetched,
              total_unique: playerList.length,
              teams_found: teams.size,
              complete,
              errors,
              d1_synced: false,
              d1_saved: 0
            }
          }, 500, env);
        }
      }

      const body = {
        sport: 'basketball',
        league: 'NBA',
        data: playerList,
        meta: {
          total_api: total,
          total_fetched: fetched,
          total_unique: playerList.length,
          teams_found: teams.size,
          teams: Array.from(teams).sort(),
          complete,
          errors,
          d1_synced: playerList.length > 0 && d1Saved === playerList.length,
          d1_saved: d1Saved,
          cache: 'MISS'
        }
      };

      if (complete && d1Saved === playerList.length) {
        await cache.put(cacheKey, new Response(JSON.stringify(body), {
          headers: { 'content-type': 'application/json', 'cache-control': 'max-age=21600' }
        }));
      }
      return json(body, 200, env);
    }
if (url.pathname === '/api/espn/sync-player-ids') {
    const teamIds = Array.from({ length: 30 }, (_, i) => i + 1);
      const errors: string[] = [];
        const matches: any[] = [];
          let rostersRead = 0;
            let athletesRead = 0;

              const normalize = (value: string) =>
                  value.normalize('NFD')
                        .replace(/[\u0300-\u036f]/g, '')
                              .toLowerCase()
                                    .replace(/[^a-z0-9]/g, '');

                                      const dbResult = await env.DB.prepare(
                                          'SELECT p.player_id, p.name AS name, ps.team_name FROM players p JOIN player_seasons ps ON ps.player_id = p.player_id WHERE ps.season = 2026'
                                            ).all();

                                              const dbPlayers = dbResult.results ?? [];
                                                const playerMap = new Map<string, any[]>();

                                                  for (const p of dbPlayers as any[]) {
                                                      const key = `${normalize(String(p.name))}|${normalize(String(p.team_name))}`;
                                                          const list = playerMap.get(key) ?? [];
                                                              list.push(p);
                                                                  playerMap.set(key, list);
                                                                    }

                                                                      for (const teamId of teamIds) {
                                                                          try {
                                                                                const response = await fetch(
                                                                                        `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamId}/roster`
                                                                                              );

                                                                                                    if (!response.ok) {
                                                                                                            errors.push(`Equipa ESPN ${teamId}: HTTP ${response.status}`);
                                                                                                                    continue;
                                                                                                                          }

                                                                                                                                const payload: any = await response.json();
                                                                                                                                      const teamName = String(payload.team?.displayName ?? '').trim();
                                                                                                                                            const athletes = payload.athletes ?? [];

                                                                                                                                                  if (!teamName || !Array.isArray(athletes)) {
                                                                                                                                                          errors.push(`Resposta inválida na equipa ESPN ${teamId}`);
                                                                                                                                                                  continue;
                                                                                                                                                                        }

                                                                                                                                                                              rostersRead++;

                                                                                                                                                                                    for (const athlete of athletes) {
                                                                                                                                                                                            athletesRead++;

                                                                                                                                                                                                    const espnId = String(athlete.id ?? '').trim();
                                                                                                                                                                                                            const name = String(athlete.displayName ?? '').trim();

                                                                                                                                                                                                                    if (!espnId || !name) continue;

                                                                                                                                                                                                                            const key = `${normalize(name)}|${normalize(teamName)}`;
                                                                                                                                                                                                                                    const candidates = playerMap.get(key) ?? [];

                                                                                                                                                                                                                                            if (candidates.length !== 1) continue;

                                                                                                                                                                                                                                                    matches.push({
                                                                                                                                                                                                                                                              player_id: candidates[0].player_id,
                                                                                                                                                                                                                                                                        source: 'espn',
                                                                                                                                                                                                                                                                                  source_player_id: espnId,
                                                                                                                                                                                                                                                                                            team_id: null,
                                                                                                                                                                                                                                                                                                      team_name: teamName,
                                                                                                                                                                                                                                                                                                                matched_name: name,
                                                                                                                                                                                                                                                                                                                          match_method: 'exact_name_team'
                                                                                                                                                                                                                                                                                                                                  });
                                                                                                                                                                                                                                                                                                                                        }
                                                                                                                                                                                                                                                                                                                                            } catch (error) {
                                                                                                                                                                                                                                                                                                                                                  errors.push(`Equipa ESPN ${teamId}: ${String(error)}`);
                                                                                                                                                                                                                                                                                                                                                      }
                                                                                                                                                                                                                                                                                                                                                        }

                                                                                                                                                                                                                                                                                                                                                          let saved = 0;

                                                                                                                                                                                                                                                                                                                                                            for (let i = 0; i < matches.length; i += 25) {
                                                                                                                                                                                                                                                                                                                                                                const chunk = matches.slice(i, i + 25);

                                                                                                                                                                                                                                                                                                                                                                    const statements = chunk.map((m: any) =>
                                                                                                                                                                                                                                                                                                                                                                          env.DB.prepare(`
                                                                                                                                                                                                                                                                                                                                                                                  INSERT INTO player_source_ids
        (player_id, source, source_player_id, season, matched_by, verified)
        VALUES (?, ?, ?, 2026, 'exact_name_team', 1)
        ON CONFLICT(player_id, source, season) DO UPDATE SET
        source_player_id = excluded.source_player_id,
        season = excluded.season,
        matched_by = excluded.matched_by,
        verified = 1,
        updated_at = CURRENT_TIMESTAMP
                                                                                                                                                                                                                                                                                                                                                                                                                `).bind(m.player_id, m.source, m.source_player_id)
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  );

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      const results = await env.DB.batch(statements);
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          saved += results.reduce((sum: number, r: any) => sum + (r.meta?.changes ?? 0), 0);
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            }

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              return json({
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  success: errors.length === 0,
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      season: 2026,
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          bbd_players: dbPlayers.length,
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              espn_rosters_read: rostersRead,
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  espn_athletes_read: athletesRead,
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      exact_matches: matches.length,
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          saved,
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              errors
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                }, 200, env);
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                
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
        const result = await env.DB.prepare(`
          SELECT p.player_id AS id, p.name AS name, ps.team_name, p.position
          FROM players p
          JOIN player_seasons ps ON ps.player_id = p.player_id
          WHERE ps.season = 2026 AND ps.team_name IN (${placeholders})
          ORDER BY ps.team_name, p.name
        `).bind(...teams).all();
        const players = (result.results || []).map((row: Record<string, unknown>) => ({
          id: String(row.id),
          name: String(row.name),
          team_name: String(row.team_name),
          position: row.position == null ? null : String(row.position),
          headshot_url: null
        }));
        const foundTeams = Array.from(new Set(players.map((player: { team_name: string }) => player.team_name))).sort();
        return json({
          source: 'Cloudflare D1 / BigBallsData',
          season: 2026,
          requested_teams: teams,
          found_teams: foundTeams,
          missing_teams: teams.filter(team => !foundTeams.includes(team)),
          players,
          meta: { players_count: players.length, teams_requested: teams.length, teams_found: foundTeams.length }
        }, 200, env, 'private, max-age=300');
      } catch (error) {
        return json({ error: 'scan_players_query_failed', detail: String(error) }, 500, env);
      }
    }

    if (url.pathname === '/api/bbd/player-search') {
      if (!env.BIGBALLSDATA_API_KEY) return json({ error: 'bigballsdata_key_missing', message: 'Configura BIGBALLSDATA_API_KEY como secret no Worker.' }, 503, env);
      const name = url.searchParams.get('name')?.trim();
      if (!name || name.length > 80) return json({ error: 'Indica um nome de jogador válido.' }, 400, env);
      const upstream = await fetch(`https://api.bigballsdata.com/v1/players?sport=basketball&league=nba&name=${encodeURIComponent(name)}`, { headers: { authorization: `Bearer ${env.BIGBALLSDATA_API_KEY}`, accept: 'application/json' } });
      return new Response(upstream.body, { status: upstream.status, headers: { 'content-type': 'application/json', ...cors(env), 'cache-control': 'public, max-age=3600' } });
    }

    if (url.pathname === '/api/bbd/player-gamelog') {
      if (!env.BIGBALLSDATA_API_KEY) return json({ error: 'bigballsdata_key_missing' }, 503, env);
      const playerId = url.searchParams.get('playerId');
      const season = url.searchParams.get('season');
      if (!playerId || !/^[a-zA-Z0-9-]{6,80}$/.test(playerId) || !season || !/^20\d{2}$/.test(season)) return json({ error: 'playerId ou season inválido.' }, 400, env);
      const upstream = await fetch(`https://api.bigballsdata.com/v1/players/${encodeURIComponent(playerId)}/gamelog?season=${season}`, { headers: { authorization: `Bearer ${env.BIGBALLSDATA_API_KEY}`, accept: 'application/json' } });
      return new Response(upstream.body, { status: upstream.status, headers: { 'content-type': 'application/json', ...cors(env), 'cache-control': 'public, max-age=1800' } });
    }

    if (url.pathname === '/api/bbd/player-gamelogs' && request.method === 'POST') {
      if (!env.BIGBALLSDATA_API_KEY) return json({ error: 'bigballsdata_key_missing' }, 503, env);
      let body: { playerIds?: unknown; season?: number };
      try { body = await request.json() as { playerIds?: unknown; season?: number }; }
      catch { return json({ error: 'invalid_json' }, 400, env); }
      const season = body.season;
      const ids = Array.isArray(body.playerIds) ? [...new Set(body.playerIds)] : [];
      if (!Number.isInteger(season) || !/^20\d{2}$/.test(String(season)) || ids.length < 1 || ids.length > 20 || ids.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9-]{6,80}$/.test(id))) {
        return json({ error: 'Indica 1 a 20 IDs BBD válidos e uma época válida.' }, 400, env);
      }

      const cache = (caches as unknown as { default: Cache }).default;
      const results: Array<{ playerId: string; data?: unknown; error?: string; attempts?: number }> = [];

      // Processamento controlado: no máximo 2 chamadas simultâneas à BBD.
      for (let i = 0; i < ids.length; i += 2) {
        const group = ids.slice(i, i + 2) as string[];
        const fetched = await Promise.all(group.map(async playerId => {
          const cacheKey = new Request(`https://edge-nba-cache.internal/bbd/gamelog/${season}/${playerId}`);
          try {
            const cached = await cache.match(cacheKey);
            if (cached) {
              const cachedPayload = await cached.json() as { data?: unknown } | unknown;
              // A cache guarda o envelope original { data: [...] }; o frontend
              // precisa de receber apenas o array. Também aceita entradas antigas
              // que já tenham sido guardadas diretamente como array.
              const cachedData = Array.isArray(cachedPayload)
                ? cachedPayload
                : (cachedPayload && typeof cachedPayload === 'object' && Array.isArray((cachedPayload as { data?: unknown }).data)
                    ? (cachedPayload as { data: unknown[] }).data
                    : null);
              if (cachedData) return { playerId, data: cachedData, attempts: 0 };
              // Cache antiga/inválida: apagar e consultar novamente a origem.
              await cache.delete(cacheKey);
            }

            let lastError = 'BBD request failed';
            for (let attempt = 1; attempt <= 3; attempt++) {
              try {
                const upstream = await fetch(`https://api.bigballsdata.com/v1/players/${encodeURIComponent(playerId)}/gamelog?season=${season}`, {
                  headers: { authorization: `Bearer ${env.BIGBALLSDATA_API_KEY}`, accept: 'application/json' }
                });
                if (upstream.ok) {
                  const payload = await upstream.json() as { data?: unknown };
                  if (!Array.isArray(payload.data)) {
                    lastError = 'BBD response missing data array';
                  } else {
                    const response = new Response(JSON.stringify({ data: payload.data }), {
                      headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=1800' }
                    });
                    await cache.put(cacheKey, response);
                    return { playerId, data: payload.data, attempts: attempt };
                  }
                } else {
                  lastError = `BBD HTTP ${upstream.status}`;
                  if (upstream.status < 500 && upstream.status !== 429 && upstream.status !== 408 && upstream.status !== 425) break;
                }
              } catch (error) {
                lastError = String(error);
              }
              if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 400 * attempt));
            }
            return { playerId, error: lastError, attempts: 3 };
          } catch (error) {
            return { playerId, error: String(error), attempts: 1 };
          }
        }));
        results.push(...fetched);
      }

      const loaded = results.filter(result => Array.isArray(result.data)).length;
      return json({ season, requested: ids.length, loaded, failed: ids.length - loaded, results }, 200, env);
    }

    if (url.pathname === '/api/scan/status') return json({
      status: 'partial-data-mode', maxDailyCandidates: 10,
      connectedSources: ['ESPN scoreboard', 'ESPN injury report', 'ESPN game summaries (on demand)'],
      requiresSetup: ['Deploy Worker', 'Validate ESPN response schemas', 'Add BigBallsData free API key for player game logs'],
      blockedClaims: ['No calibrated probability until historical backtesting is complete', 'No Top 10 publication until complete slate and player coverage are verified'],
      markets: ['points', 'rebounds', 'assists', 'threes']
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
      const games = await env.DB.prepare(
        `SELECT g.game_id,g.game_date,g.home_team_id AS home,g.away_team_id AS away
         FROM games g WHERE g.game_date=?`
      ).bind(iso).all();
      const ids = await env.DB.prepare(
        "SELECT source_player_id,player_id FROM player_source_ids WHERE source='ESPN' AND season=2026 AND verified=1"
      ).all();
      const playerMap = new Map((ids.results || []).map((x:any)=>[String(x.source_player_id),x.player_id]));
      const norm = (v:string) => v.toLowerCase().replace(/[^a-z0-9]/g,'');
      const saved = new Set<string>();
      const errors:string[] = [];
      const board:any = await espn(`scoreboard?dates=${date}`,60);
      for (const event of board.events || []) {
        const comp = event.competitions?.[0];
        const names = (comp?.competitors || []).map((x:any)=>x.team?.displayName || '');
        const game:any = (games.results || []).find((g:any)=>
          names.some((n:string)=>norm(n)===norm(g.home)) &&
          names.some((n:string)=>norm(n)===norm(g.away))
        );
        if (!game) continue;
        try {
          const summary:any = await espn(`summary?event=${event.id}`,30);
          const teams = summary.boxscore?.players || [];
          if (!teams.length) continue;
          for (const team of teams) {
            const teamName = team.team?.displayName || '';
            const opponent = names.find((n:string)=>norm(n)!==norm(teamName)) || null;
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
                  const n=Number.parseFloat(String(v ?? '').replace(':','.'));
                  return Number.isFinite(n)?n:null;
                };
                const pair = (v:any) => {
                  const a=String(v || '').split('-');
                  return [num(a[0]),num(a[1])];
                };
                const [fgm,fga]=pair(stat.FG);
                const [tpm,tpa]=pair(stat['3PT']);
                const [ftm,fta]=pair(stat.FT);
                const minutes = num(stat.MIN);
                const key = `${playerId}:${game.game_id}`;
                if (saved.has(key)) continue;
                saved.add(key);
                await env.DB.prepare(
                  `INSERT INTO player_game_stats
                   (player_id,game_id,minutes,points,rebounds,assists,threes,opponent_team_id,is_home,starter_status,source,fetched_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
                   ON CONFLICT(player_id,game_id) DO UPDATE SET
                   minutes=excluded.minutes,points=excluded.points,rebounds=excluded.rebounds,
                   assists=excluded.assists,threes=excluded.threes,opponent_team_id=excluded.opponent_team_id,
                   is_home=excluded.is_home,starter_status=excluded.starter_status,
                   source=excluded.source,fetched_at=CURRENT_TIMESTAMP`
                ).bind(playerId,game.game_id,minutes,num(stat.PTS),num(stat.REB),num(stat.AST),tpm,opponent,null,'unknown','espn').run();
              }
            }
          }
        } catch(e) { errors.push(`${event.id}: ${String(e)}`); }
      }
      return json({date:iso,games_found:(games.results||[]).length,players_saved:saved.size,errors},200,env);
    }

    return json({ error: 'not_found' }, 404, env);
  }
};
