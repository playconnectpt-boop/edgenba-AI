export type StatLine = {
  date: string;
  minutes: number;
  points: number;
  rebounds: number;
  assists: number;
  threes: number;
  pra?: number;
  postseason?: boolean;
};

export type Market = 'points' | 'rebounds' | 'assists' | 'threes' | 'pra';

type ESPNGame = {
  date?: unknown; minutes?: unknown; points?: unknown; rebounds?: unknown;
  assists?: unknown; threes?: unknown; postseason?: unknown;
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
    if (typeof game.date !== 'string' || !Number.isFinite(Date.parse(game.date)) ||
      minutes === null || points === null || rebounds === null || assists === null || threes === null) continue;
    rows.push({ date: game.date, minutes, points, rebounds, assists, threes,
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


export type TrendCandidate = {
  playerId: string;
  playerName: string;
  teamName: string;
  market: Market;
  marketLabel: string;
  direction: 'OVER' | 'UNDER';
  score: number;
  seasonMean: number;
  recentMean: number;
  recent10Mean: number;
  previousMean: number;
  seasonMedian: number;
  suggestedLine: number;
  recentHitRate: number;
  recentHits: number;
  recentSample: number;
  previousSample: number;
  seasonSample: number;
  recentResults: number[];
  minutesRecent: number | null;
  minutesSeason: number | null;
  explanation: string;
  quality: 'FORTE' | 'MODERADA' | 'FRACA';
  confidence: 'LIMITADA' | 'BAIXA' | 'MODERADA';
};

/** Keep the strongest market for each player so one athlete cannot dominate a shortlist. */
export function uniquePlayersTop(candidates: TrendCandidate[], limit = 10): TrendCandidate[] {
  const seen = new Set<string>();
  const result: TrendCandidate[] = [];
  for (const candidate of [...candidates].sort((a, b) => b.score - a.score)) {
    const key = candidate.playerId || candidate.playerName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
    if (result.length >= limit) break;
  }
  return result;
}

/**
 * Identifies recent statistical deviations from a player's preceding baseline.
 * The suggested line is descriptive: it is derived from the last-five average,
 * not from bookmaker odds and not from a calibrated probability model.
 */
export function rankPlayerTrends(
  player: { id: string; name: string; team_name?: string },
  rows: StatLine[]
): TrendCandidate[] {
  const ordered = [...rows].sort((a, b) => b.date.localeCompare(a.date));
  if (ordered.length < 8) return [];

  const recent = ordered.slice(0, 5);
  const previous = ordered.slice(5, 10);
  const last10 = ordered.slice(0, 10);
  if (previous.length < 1) return [];

  const markets: Market[] = ['points', 'rebounds', 'assists', 'pra', 'threes'];
  const labels: Record<Market, string> = {
    points: 'Pontos',
    rebounds: 'Ressaltos',
    assists: 'Assistências',
    pra: 'PRA',
    threes: 'Triplos'
  };

  const mean = (values: number[]) =>
    values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  };

  // Half-point line immediately below an OVER average or above an UNDER average.
  const lineForAverage = (average: number, direction: 'OVER' | 'UNDER') =>
    direction === 'OVER'
      ? Math.floor(average - 0.5) + 0.5
      : Math.ceil(average + 0.5) - 0.5;

  const minutesRecent = mean(recent.map(game => game.minutes).filter(value => value > 0));
  const minutesSeason = mean(ordered.map(game => game.minutes).filter(value => value > 0));
  const output: TrendCandidate[] = [];

  for (const market of markets) {
    const seasonValues = ordered
      .map(game => game[market])
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const recentValues = recent
      .map(game => game[market])
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const previousValues = previous
      .map(game => game[market])
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const last10Values = last10
      .map(game => game[market])
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

    const seasonMean = mean(seasonValues);
    const recentMean = mean(recentValues);
    const recent10Mean = mean(last10Values);
    const previousMean = mean(previousValues);
    const seasonMedian = median(seasonValues);

    if (
      seasonMean === null ||
      recentMean === null ||
      recent10Mean === null ||
      previousMean === null ||
      seasonMedian === null ||
      seasonValues.length < 8 ||
      recentValues.length < 4 ||
      previousValues.length < 3
    ) continue;

    const variance = seasonValues.reduce(
      (sum, value) => sum + (value - seasonMean) ** 2,
      0
    ) / seasonValues.length;
    const standardDeviation = Math.sqrt(variance);
    if (standardDeviation === 0) continue;

    const delta = recentMean - previousMean;
    if (delta === 0) continue;

    const direction: 'OVER' | 'UNDER' = delta > 0 ? 'OVER' : 'UNDER';
    const suggestedLine = lineForAverage(recentMean, direction);
    if (market === 'threes' && (recentMean < 1 || suggestedLine < 0.5)) continue;
    const recentHits = recentValues.filter(value =>
      direction === 'OVER' ? value > suggestedLine : value < suggestedLine
    ).length;
    const recentHitRate = recentHits / recentValues.length;
    const zScore = Math.abs(delta) / standardDeviation;

    // Prioritise meaningful and repeated shifts, not players with high raw averages.
    const consistencyScore = recentHitRate * 40;
    const shiftScore = Math.min(40, zScore * 20);
    const sampleScore = Math.min(recentValues.length, 5) * 4;
    const score = Math.min(100, Math.round(consistencyScore + shiftScore + sampleScore));

    // A candidate needs both a real change against the preceding five and
    // repeated results on the corresponding side of its automatically derived line.
    if (zScore < 0.25 || recentHitRate < 0.6 || score < 45) continue;

    const minutesNote = minutesRecent !== null && minutesSeason !== null
      ? `Minutos: ${minutesRecent.toFixed(1)} nos últimos 5 vs ${minutesSeason.toFixed(1)} na época.`
      : 'Minutos insuficientes para comparação.';

    const quality: TrendCandidate['quality'] = score >= 75 && recentValues.length >= 5 && previousValues.length >= 5 ? 'FORTE' : score >= 58 ? 'MODERADA' : 'FRACA';
    const confidence: TrendCandidate['confidence'] = seasonValues.length < 10 || recentValues.length < 5 || previousValues.length < 5 ? 'LIMITADA' : score >= 75 ? 'MODERADA' : 'BAIXA';
    output.push({
      playerId: player.id,
      playerName: player.name,
      teamName: player.team_name || 'Equipa não indicada',
      market,
      marketLabel: labels[market],
      direction,
      score,
      seasonMean,
      recentMean,
      recent10Mean,
      previousMean,
      seasonMedian,
      suggestedLine,
      recentHitRate,
      recentHits,
      recentSample: recentValues.length,
      previousSample: previousValues.length,
      seasonSample: seasonValues.length,
      recentResults: recentValues,
      minutesRecent,
      minutesSeason,
      quality,
      confidence,
      explanation:
        `Últimos 5: ${recentMean.toFixed(1)}; linha sugerida: ${suggestedLine.toFixed(1)} ${direction}. ` +
        `Últimos 10: ${recent10Mean.toFixed(1)}; 5 jogos anteriores: ${previousMean.toFixed(1)}; ` +
        `época: ${seasonMean.toFixed(1)} (mediana ${seasonMedian.toFixed(1)}). ` +
        `${recentHits}/${recentValues.length} dos últimos jogos ficaram do lado ${direction} da linha. ${seasonValues.length < 8 || recentValues.length < 4 || previousValues.length < 3 ? 'AMOSTRA REDUZIDA: confiança estatística limitada. ' : ''}${minutesNote}`
    });
  }

  return output.sort((a, b) => b.score - a.score);
}
