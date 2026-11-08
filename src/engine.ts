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
  quality: 'FORTE' | 'MODERADA' | 'FRACA';
  confidence: 'LIMITADA' | 'BAIXA' | 'MODERADA';
};

/** Keep distinct market opportunities, removing only exact duplicates. */
export function uniquePlayersTop(candidates: TrendCandidate[], limit = 10): TrendCandidate[] {
  const seen = new Set<string>();
  const result: TrendCandidate[] = [];
  for (const candidate of [...candidates].sort((a, b) => {
    const priorityA = a.score + (a.direction === 'OVER' ? 5 : 0);
    const priorityB = b.score + (b.direction === 'OVER' ? 5 : 0);
    return priorityB - priorityA || b.score - a.score;
  })) {
    const playerKey = candidate.playerId || candidate.playerName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const key = `${playerKey}|${candidate.market}|${candidate.direction}|${candidate.suggestedLine}`;
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
    const recentMedian = median(recentValues);
    const recent10Mean = mean(last10Values);
    const previousMean = mean(previousValues);
    const previousMedian = median(previousValues);
    const seasonMedian = median(seasonValues);

    // Market relevance is independent of OVER/UNDER direction.
    const relevanceRules: Record<Market, { minMean: number; meaningfulValue: number; minFrequency: number }> = {
      points: { minMean: 8, meaningfulValue: 5, minFrequency: 0.60 },
      rebounds: { minMean: 3, meaningfulValue: 2, minFrequency: 0.60 },
      assists: { minMean: 1.5, meaningfulValue: 1, minFrequency: 0.60 },
      threes: { minMean: 1, meaningfulValue: 1, minFrequency: 0.50 },
      pra: { minMean: 12, meaningfulValue: 10, minFrequency: 0.60 }
    };

    const relevance = relevanceRules[market];
    const meaningfulGames = seasonValues.filter(
      value => value >= relevance.meaningfulValue
    ).length;
    const meaningfulFrequency = seasonValues.length
      ? meaningfulGames / seasonValues.length
      : 0;

    if (
      seasonMean === null ||
      seasonMean < relevance.minMean ||
      meaningfulFrequency < relevance.minFrequency
    ) continue;

    if (
      seasonMean === null ||
      recentMean === null ||
      recentMedian === null ||
      recent10Mean === null ||
      previousMean === null ||
      previousMedian === null ||
      seasonMedian === null ||
      seasonValues.length < 8 ||
      recentValues.length < 5 ||
      previousValues.length < 5
    ) continue;

    const variance = seasonValues.reduce(
      (sum, value) => sum + (value - seasonMean) ** 2,
      0
    ) / seasonValues.length;
    const standardDeviation = Math.sqrt(variance);
    if (standardDeviation === 0) continue;

    // Use medians to identify the shift, reducing sensitivity to isolated outliers.
    const delta = recentMedian - previousMedian;
    if (delta === 0) continue;

    const direction: 'OVER' | 'UNDER' = delta > 0 ? 'OVER' : 'UNDER';
    const suggestedLine = lineForAverage(recentMean, direction);

    // Reject UNDER lines that are not below the player's typical season production.
    // This is adaptive to each player and market, avoiding arbitrary fixed line floors.
    if (direction === 'UNDER' && suggestedLine >= seasonMedian) continue;

    if (market === 'threes') {
      if (recentMean < 1 || suggestedLine < 0.5) continue;

      const recentAttempts = recent
        .map(game => game.threePointAttempts)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
      const attemptsMean = mean(recentAttempts);

      // Só aplicar o filtro de volume quando existirem pelo menos 4 registos de 3PA.
      if (recentAttempts.length >= 4 && attemptsMean !== null && attemptsMean < 3) continue;
    }
    // Trend consistency is measured against the preceding-five median.
    const trendHits = recentValues.filter(value =>
      direction === 'OVER' ? value > previousMedian : value < previousMedian
    ).length;
    const trendHitRate = trendHits / recentValues.length;

    // Line hit rate is a separate, in-sample descriptive statistic.
    const lineHits = recentValues.filter(value =>
      direction === 'OVER' ? value > suggestedLine : value < suggestedLine
    ).length;
    const linePushes = recentValues.filter(value => value === suggestedLine).length;
    const lineSample = recentValues.length - linePushes;
    const lineHitRate = lineSample > 0 ? lineHits / lineSample : null;

    // Avaliar a mesma linha e direção nos cinco jogos anteriores.
    const previousLineHits = previousValues.filter(value =>
      direction === 'OVER' ? value > suggestedLine : value < suggestedLine
    ).length;
    const previousLinePushes = previousValues.filter(
      value => value === suggestedLine
    ).length;
    const previousLineSample = previousValues.length - previousLinePushes;
    const previousLineHitRate = previousLineSample > 0
      ? previousLineHits / previousLineSample
      : null;

    const zScore = Math.abs(delta) / standardDeviation;

    // Descriptive trend index only: in-sample line hit rate does not affect the score.
    const consistencyScore = trendHitRate * 40;
    const shiftScore = Math.min(30, zScore * 15);
    const sampleScore = Math.min(recentValues.length, 5) * 6;
    const score = Math.min(100, Math.round(
      consistencyScore + shiftScore + sampleScore
    ));

    // Mínimo de 50% na linha nos cinco jogos mais recentes.
    if (
      zScore < 0.25 ||
      trendHitRate < 0.6 ||
      lineHitRate === null ||
      lineHitRate < 0.5 ||
      previousLineHitRate === null ||
      score < 50
    ) continue;

    // Excluir deterioração recente de 30 pontos percentuais ou mais.
    // A média dos últimos dez jogos não pode mascarar esta quebra.
    if (previousLineHitRate - lineHitRate >= 0.30) continue;

    const minutesNote = minutesRecent !== null && minutesSeason !== null
      ? `Minutos: ${minutesRecent.toFixed(1)} nos últimos 5 vs ${minutesSeason.toFixed(1)} na época.`
      : 'Minutos insuficientes para comparação.';

    const quality: TrendCandidate['quality'] =
      score >= 80 &&
      trendHitRate >= 0.8 &&
      recentValues.length >= 5 &&
      previousValues.length >= 5
        ? 'FORTE'
        : score >= 58 && trendHitRate >= 0.6
          ? 'MODERADA'
          : 'FRACA';
    const minutesUnstable = minutesRecent !== null && minutesSeason !== null &&
      minutesRecent < minutesSeason * 0.85;
    const confidence: TrendCandidate['confidence'] =
      seasonValues.length < 10 || recentValues.length < 5 || previousValues.length < 5 || minutesUnstable
        ? 'LIMITADA'
        : score >= 75 ? 'MODERADA' : 'BAIXA';
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
      trendHitRate,
      trendHits,
      lineHitRate,
      lineHits,
      linePushes,
      lineSample,
      previousLineHitRate,
      previousLineHits,
      previousLinePushes,
      previousLineSample,
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
        `Tendência face à mediana anterior: ${trendHits}/${recentValues.length} (${(trendHitRate * 100).toFixed(0)}%). ` +
        `Linha ${suggestedLine.toFixed(1)} ${direction}: ${lineHits}/${lineSample} acertos` +
        `${linePushes ? ` e ${linePushes} pushes` : ''}` +
        `${lineHitRate === null ? ' (sem resultados decisivos)' : ` (${(lineHitRate * 100).toFixed(0)}%)`}. ` +
        `Mesma linha nos 5 jogos anteriores: ${previousLineHits}/${previousLineSample} acertos` +
        `${previousLinePushes ? ` e ${previousLinePushes} pushes` : ''} (${(previousLineHitRate! * 100).toFixed(0)}%). ` +
        `${minutesUnstable ? 'MINUTOS RECENTES REDUZIDOS: confiança limitada. ' : ''}` +
        `${seasonValues.length < 10 || recentValues.length < 5 || previousValues.length < 5 ? 'AMOSTRA REDUZIDA: confiança estatística limitada. ' : ''}${minutesNote}`
    });
  }

  return output.sort((a, b) => b.score - a.score);
}
