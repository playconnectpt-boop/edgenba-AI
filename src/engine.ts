export type StatLine = {
  date: string;
  minutes: number;
  points: number;
  rebounds: number;
  assists: number;
  threes: number;
  threePointAttempts?: number;
  pra?: number;
  postseason?: boolean;
};

export type Market = 'points' | 'rebounds' | 'assists' | 'threes' | 'pra';

type ESPNGame = {
  date?: unknown; minutes?: unknown; points?: unknown; rebounds?: unknown;
  assists?: unknown; threes?: unknown; threePointAttempts?: unknown; postseason?: unknown;
};
type GamelogPayload = { data?: unknown };

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/** Converts ESPN boxscore rows returned by the Worker/D1 into engine StatLine records. */
export function adaptEspnGamelog(
  payload: unknown,
  options: { includePostseason?: boolean } = {}
): StatLine[] {
  const includePostseason = options.includePostseason ?? true;
  if (!payload || typeof payload !== 'object' || !('data' in payload)) {
    throw new Error('Resposta ESPN inválida: campo data em falta.');
  }
  const data = (payload as GamelogPayload).data;
  if (!Array.isArray(data)) throw new Error('Resposta ESPN inválida: data não é um array.');
  const rows: StatLine[] = [];
  for (const item of data as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const game = item as ESPNGame;
    if (!includePostseason && game.postseason === true) continue;
    const minutes = toNumber(game.minutes);
    const points = toNumber(game.points);
    const rebounds = toNumber(game.rebounds);
    const assists = toNumber(game.assists);
    const threes = toNumber(game.threes);
    const threePointAttempts = toNumber(game.threePointAttempts);
    if (typeof game.date !== 'string' || !Number.isFinite(Date.parse(game.date)) ||
      minutes === null || points === null || rebounds === null || assists === null || threes === null) continue;
    rows.push({ date: game.date, minutes, points, rebounds, assists, threes,
      ...(threePointAttempts !== null && threePointAttempts >= 0 ? { threePointAttempts } : {}),
      pra: points + rebounds + assists, postseason: game.postseason === true });
  }
  return rows.sort((a,b) => b.date.localeCompare(a.date));
}


export function describeSample(rows: StatLine[], market: Market, line?: number) {
  const values = rows
    .map(row => row[market])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .sort((a, b) => a - b);

  if (!values.length) {
    return {
      sample: 0,
      mean: null,
      median: null,
      standardDeviation: null,
      hitRate: null,
      overRate: null,
      underRate: null,
      pushRate: null
    };
  }

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const median = values.length % 2
    ? values[(values.length - 1) / 2]
    : (values[values.length / 2 - 1] + values[values.length / 2]) / 2;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;

  const overCount = typeof line === 'number' ? values.filter(value => value > line).length : null;
  const underCount = typeof line === 'number' ? values.filter(value => value < line).length : null;
  const pushCount = typeof line === 'number' ? values.filter(value => value === line).length : null;
  const overRate = overCount === null ? null : overCount / values.length;
  const underRate = underCount === null ? null : underCount / values.length;
  const pushRate = pushCount === null ? null : pushCount / values.length;

  return {
    sample: values.length,
    mean,
    median,
    standardDeviation: Math.sqrt(variance),
    hitRate: overRate,
    overRate,
    underRate,
    pushRate,
    min: values[0],
    max: values[values.length - 1]
  };
}

export function minutesStability(rows: StatLine[]) {
  const mins = rows.map(row => row.minutes).filter(value => Number.isFinite(value) && value > 0);
  if (!mins.length) return { sample: 0, mean: null, standardDeviation: null };

  const mean = mins.reduce((a, b) => a + b, 0) / mins.length;
  const variance = mins.reduce((sum, value) => sum + (value - mean) ** 2, 0) / mins.length;
  return { sample: mins.length, mean, standardDeviation: Math.sqrt(variance) };
}

// Descriptive statistics only: probabilities require out-of-sample calibration.
export function buildPlayerProfile(rows: StatLine[]) {
  const ordered = [...rows].sort((a, b) => b.date.localeCompare(a.date));
  const last10 = ordered.slice(0, 10);
  const last5 = ordered.slice(0, 5);

  return {
    gamesAvailable: ordered.length,
    minutes: {
      season: minutesStability(ordered),
      last10: minutesStability(last10)
    },
    markets: Object.fromEntries((['points', 'rebounds', 'assists', 'threes', 'pra'] as Market[]).map(market => [market, {
      season: describeSample(ordered, market),
      last10: describeSample(last10, market),
      last5: describeSample(last5, market)
    }]))
  };
}


export type CalibrationRecord = {
  market: Market;
  predictedProbability: number; // 0..100, recorded before the game
  hit: boolean;
};

export type TrendCandidate = {
  playerId: string;
  playerName: string;
  teamName: string;
  gameId?: string;
  market: Market;
  marketLabel: string;
  direction: 'OVER' | 'UNDER';
  score: number; // ranking index, NOT a win probability
  probability: number; // provisional estimate unless calibrationStatus is CALIBRATED
  confidencePercent: number;
  calibrationStatus: 'PROVISIONAL' | 'CALIBRATED';
  seasonMean: number;
  recentMean: number;
  recent10Mean: number;
  previousMean: number;
  seasonMedian: number;
  suggestedLine: number;
  trendHitRate: number;
  trendHits: number;
  lineHitRate: number | null;
  lineHits: number;
  linePushes: number;
  lineSample: number;
  previousLineHitRate: number | null;
  previousLineHits: number;
  previousLinePushes: number;
  previousLineSample: number;
  recentSample: number;
  previousSample: number;
  seasonSample: number;
  recentResults: number[];
  minutesRecent: number | null;
  minutesSeason: number | null;
  explanation: string;
  quality: 'EXCELENTE' | 'FORTE' | 'MODERADA' | 'FRACA';
  confidence: 'LIMITADA' | 'BAIXA' | 'MODERADA' | 'ALTA';
};

type Direction = 'OVER' | 'UNDER';
type Player = { id: string; name: string; team_name?: string; game_id?: string };
type RankingOptions = {
  calibration?: CalibrationRecord[];
  // Optional external context, supplied by a future ESPN-only integration.
  contextConfidenceAdjustment?: number;
};

const MARKETS: Market[] = ['points', 'rebounds', 'assists', 'threes', 'pra'];
const LABELS: Record<Market, string> = {
  points: 'Pontos', rebounds: 'Ressaltos', assists: 'Assistências',
  threes: 'Triplos', pra: 'PRA'
};
const ACTIVITY: Record<Market, { threshold: number; requiredOf10: number }> = {
  points: { threshold: 5, requiredOf10: 7 },
  rebounds: { threshold: 1, requiredOf10: 7 },
  assists: { threshold: 1, requiredOf10: 7 },
  threes: { threshold: 1, requiredOf10: 5 },
  pra: { threshold: 7, requiredOf10: 7 }
};

const average = (values: number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;
const medianOf = (values: number[]): number => {
  const ordered = [...values].sort((a, b) => a - b);
  const mid = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[mid] : (ordered[mid - 1] + ordered[mid]) / 2;
};
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const validValues = (rows: StatLine[], market: Market) =>
  rows.map(row => market === 'pra'
    ? (typeof row.pra === 'number' ? row.pra : row.points + row.rebounds + row.assists)
    : row[market]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0);
const hits = (values: number[], line: number, direction: Direction) =>
  values.filter(value => direction === 'OVER' ? value > line : value < line).length;
const qualityFor = (score: number): TrendCandidate['quality'] =>
  score >= 85 ? 'EXCELENTE' : score >= 75 ? 'FORTE' : score >= 60 ? 'MODERADA' : 'FRACA';
const confidenceFor = (value: number): TrendCandidate['confidence'] =>
  value >= 85 ? 'ALTA' : value >= 70 ? 'MODERADA' : value >= 50 ? 'BAIXA' : 'LIMITADA';

/**
 * Historical reliability adjustment by market and forecast-probability neighborhood.
 * Never uses outcomes of the game currently being predicted.
 * With fewer than 30 prior resolved forecasts in the market, no calibration is claimed.
 */
export function calibrateProbability(
  probability: number, market: Market, history: CalibrationRecord[] = []
): { probability: number; status: 'PROVISIONAL' | 'CALIBRATED' } {
  const eligible = history.filter(item =>
    item.market === market &&
    Number.isFinite(item.predictedProbability) &&
    item.predictedProbability >= 0 && item.predictedProbability <= 100 &&
    typeof item.hit === 'boolean'
  );
  if (eligible.length < 30) return { probability: Math.round(probability), status: 'PROVISIONAL' };
  const local = eligible.filter(item => Math.abs(item.predictedProbability - probability) <= 15);
  if (local.length < 15) return { probability: Math.round(probability), status: 'PROVISIONAL' };
  const observed = 100 * local.filter(item => item.hit).length / local.length;
  // Shrink empirical accuracy toward the prior forecast; avoid large corrections on small histories.
  const weight = local.length / (local.length + 60);
  return {
    probability: Math.round(clamp(probability * (1 - weight) + observed * weight, 0, 100)),
    status: 'CALIBRATED'
  };
}

/**
 * Select TOP 10 in score order. No more than one pick per player,
 * two per team and three per identified game.
 * Game limits require a gameId; an unknown game is not invented.
 */
export function uniquePlayersTop(candidates: TrendCandidate[], limit = 10): TrendCandidate[] {
  const result: TrendCandidate[] = [];
  const players = new Set<string>();
  const teams = new Map<string, number>();
  const games = new Map<string, number>();
  const ordered = [...candidates].sort((a, b) =>
    b.score - a.score ||
    b.confidencePercent - a.confidencePercent ||
    (a.direction === 'OVER' ? -1 : 1) - (b.direction === 'OVER' ? -1 : 1) ||
    a.playerName.localeCompare(b.playerName)
  );
  for (const candidate of ordered) {
    if (!Number.isFinite(candidate.probability) || candidate.probability < 60) continue;
    const player = candidate.playerId || candidate.playerName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const team = candidate.teamName.trim().toLowerCase();
    const game = candidate.gameId?.trim();
    if (players.has(player)) continue;
    if ((teams.get(team) || 0) >= 2) continue;
    if (game && (games.get(game) || 0) >= 3) continue;
    result.push(candidate);
    players.add(player);
    teams.set(team, (teams.get(team) || 0) + 1);
    if (game) games.set(game, (games.get(game) || 0) + 1);
    if (result.length >= Math.max(0, limit)) break;
  }
  return result;
}

/**
 * Generates provisional model-based opportunities from ESPN game logs.
 * Probabilities are NOT validated win probabilities until sufficient historical
 * out-of-sample predictions/outcomes are supplied to calibrateProbability.
 * Injury, defense, opponent and teammate context are not invented here.
 */
export function rankPlayerTrends(
  player: Player,
  rows: StatLine[],
  options: RankingOptions = {}
): TrendCandidate[] {
  const ordered = [...rows].filter(row => Number.isFinite(Date.parse(row.date)))
    .sort((a, b) => b.date.localeCompare(a.date));
  if (!ordered.length) return [];
  const recent = ordered.slice(0, 5);
  const last10 = ordered.slice(0, 10);
  const previous = ordered.slice(5, 10);
  const minutesRecentValues = recent.map(row => row.minutes).filter(value => Number.isFinite(value) && value > 0);
  const minutesSeasonValues = ordered.map(row => row.minutes).filter(value => Number.isFinite(value) && value > 0);
  const minutesRecent = minutesRecentValues.length ? average(minutesRecentValues) : null;
  const minutesSeason = minutesSeasonValues.length ? average(minutesSeasonValues) : null;
  const output: TrendCandidate[] = [];

  for (const market of MARKETS) {
    const recentValues = validValues(recent, market);
    const tenValues = validValues(last10, market);
    const seasonValues = validValues(ordered, market);
    const previousValues = validValues(previous, market);
    if (!recentValues.length || !tenValues.length || !seasonValues.length) continue;

    const rule = ACTIVITY[market];
    const activityHits = tenValues.filter(value => value >= rule.threshold).length;
    if (activityHits < Math.ceil(tenValues.length * rule.requiredOf10 / 10)) continue;

    const recentMean = average(recentValues);
    const recent10Mean = average(tenValues);
    const seasonMean = average(seasonValues);
    const seasonMedian = medianOf(seasonValues);
    const previousMean = previousValues.length ? average(previousValues) : recent10Mean;
    const baseline = 0.65 * recent10Mean + 0.35 * seasonMean;
    const divergence = Math.abs(recentMean - baseline) / Math.max(1, baseline);
    const recentWeight = clamp(0.55 - 0.25 * divergence, 0.25, 0.55);
    const target = recentWeight * recentMean + (1 - recentWeight) * baseline;

    // Search meaningful half-point lines close to the forecast, never UNDER 0.5.
    // This avoids automatically selecting an extremely low line to inflate hit rates.
    const centralLine = Math.floor(target) + 0.5;
    const lineOptions = [...new Set([
      centralLine - 1, centralLine, centralLine + 1
    ])].filter(line => line >= 0.5);
    const candidates: TrendCandidate[] = [];

    for (const line of lineOptions) {
      for (const direction of ['OVER', 'UNDER'] as Direction[]) {
        if (direction === 'UNDER' && line <= 0.5) continue;
        const recentHits = hits(recentValues, line, direction);
        const tenHits = hits(tenValues, line, direction);
        const seasonHits = hits(seasonValues, line, direction);
        const recentRate = recentHits / recentValues.length;
        const tenRate = tenHits / tenValues.length;
        const seasonRate = seasonHits / seasonValues.length;
        // Pseudocount shrinkage avoids treating a 1/1 or 2/2 sample as certainty.
        const shrink = (successes: number, n: number) => (successes + 2) / (n + 4);
        const rawProbability = 100 * (
          0.45 * shrink(recentHits, recentValues.length) +
          0.35 * shrink(tenHits, tenValues.length) +
          0.20 * shrink(seasonHits, seasonValues.length)
        );
        const calibrated = calibrateProbability(rawProbability, market, options.calibration);
        if (calibrated.probability < 60) continue;

        // Penalize forecast-vs-line disagreement and unstable minutes, not merely raw variance.
        const lineMargin = direction === 'OVER' ? target - line : line - target;
        if (lineMargin <= 0) continue;
        const minutesRatio = minutesRecent !== null && minutesSeason !== null
          ? minutesRecent / Math.max(1, minutesSeason) : null;
        const minutesDrop = minutesRatio === null ? 8 : clamp((0.95 - minutesRatio) * 50, 0, 20);
        const sampleFactor = Math.sqrt(Math.min(10, tenValues.length) / 10);
        const disagreement = Math.abs(recentRate - seasonRate);
        const contextPenalty = options.contextConfidenceAdjustment ?? 0;
        const confidencePercent = Math.round(clamp(
          40 + 42 * sampleFactor + 12 * (1 - disagreement) -
          minutesDrop - clamp(divergence * 15, 0, 15) -
          clamp(contextPenalty, 0, 30) -
          (calibrated.status === 'PROVISIONAL' ? 8 : 0),
          0, 100
        ));
        const score = Math.round((calibrated.probability + confidencePercent) / 2);
        const previousLineHits = hits(previousValues, line, direction);
        const trendReference = previousValues.length ? medianOf(previousValues) : seasonMedian;
        const trendHits = recentValues.filter(value =>
          direction === 'OVER' ? value > trendReference : value < trendReference
        ).length;
        const lineHitRate = recentHits / recentValues.length;
        const previousLineHitRate = previousValues.length
          ? previousLineHits / previousValues.length : null;
        candidates.push({
          playerId: player.id, playerName: player.name,
          teamName: player.team_name || 'Equipa não indicada',
          ...(player.game_id ? { gameId: player.game_id } : {}),
          market, marketLabel: LABELS[market], direction, score,
          probability: calibrated.probability,
          confidencePercent, calibrationStatus: calibrated.status,
          seasonMean, recentMean, recent10Mean, previousMean, seasonMedian,
          suggestedLine: line, trendHitRate: trendHits / recentValues.length,
          trendHits, lineHitRate, lineHits: recentHits, linePushes: 0,
          lineSample: recentValues.length,
          previousLineHitRate, previousLineHits, previousLinePushes: 0,
          previousLineSample: previousValues.length,
          recentSample: recentValues.length, previousSample: previousValues.length,
          seasonSample: seasonValues.length, recentResults: [...recentValues],
          minutesRecent, minutesSeason, quality: qualityFor(score),
          confidence: confidenceFor(confidencePercent),
          explanation: `Últimos 5: ${recentMean.toFixed(1)}; últimos 10: ${recent10Mean.toFixed(1)}; ` +
            `época: ${seasonMean.toFixed(1)} (mediana ${seasonMedian.toFixed(1)}). ` +
            `${direction} ${line.toFixed(1)}: ${recentHits}/${recentValues.length} nos últimos 5, ` +
            `${tenHits}/${tenValues.length} nos últimos 10. ` +
            `Estimativa ${calibrated.status === 'CALIBRATED' ? 'calibrada' : 'provisória'}: ` +
            `${calibrated.probability}%; confiança: ${confidencePercent}%.`
        });
      }
    }
    // Only the strongest line/direction per market, to avoid trivial variants.
    candidates.sort((a, b) =>
      b.score - a.score || b.confidencePercent - a.confidencePercent ||
      (a.direction === 'OVER' ? -1 : 1) - (b.direction === 'OVER' ? -1 : 1)
    );
    if (candidates.length) output.push(candidates[0]);
  }
  return output.sort((a, b) => b.score - a.score || b.confidencePercent - a.confidencePercent);
}
