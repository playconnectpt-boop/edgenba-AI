import type { StatLine, Market } from './engine';

export type OnesToWatchConfidence = 'MUITO LIMITADA' | 'LIMITADA' | 'BAIXA' | 'MODERADA';

export type OnesToWatchCandidate = {
  playerId: string;
  playerName: string;
  teamName: string;
  position?: string;
  rows: StatLine[];
  minutesWithTeammates?: number[];
  minutesWithoutTeammates?: number[];
  statsWithTeammates?: Partial<Record<Market, number[]>>;
  statsWithoutTeammates?: Partial<Record<Market, number[]>>;
  absentTeammates?: string[];
  confirmedAbsences?: string[];
};

export type OnesToWatchPick = {
  playerId: string;
  playerName: string;
  teamName: string;
  market: Market;
  marketLabel: string;
  direction: 'OVER' | 'UNDER';
  suggestedLine: number;
  score: number;
  confidence: OnesToWatchConfidence;
  recentMean: number;
  seasonMean: number;
  contextualMean: number | null;
  recentMinutes: number | null;
  baselineMinutes: number | null;
  contextualSample: number;
  absentTeammates: string[];
  confirmedAbsences: string[];
  reasons: string[];
  risks: string[];
  limitations: string[];
};

const MARKETS: Market[] = ['points', 'rebounds', 'assists', 'threes', 'pra'];

const LABELS: Record<Market, string> = {
  points: 'Pontos',
  rebounds: 'Ressaltos',
  assists: 'Assistências',
  threes: 'Triplos',
  pra: 'PRA'
};

const average = (values: number[]): number | null => {
  const valid = values.filter(Number.isFinite);
  return valid.length
    ? valid.reduce((sum, value) => sum + value, 0) / valid.length
    : null;
};

const median = (values: number[]): number | null => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

const lineForAverage = (value: number, direction: 'OVER' | 'UNDER'): number =>
  direction === 'OVER'
    ? Math.max(0.5, Math.floor(value - 0.5) + 0.5)
    : Math.ceil(value + 0.5) - 0.5;

function evaluateMarket(
  candidate: OnesToWatchCandidate,
  market: Market
): OnesToWatchPick | null {
  const rows = [...candidate.rows]
    .filter(row => Number.isFinite(row[market]) && row.minutes > 0)
    .sort((a, b) => b.date.localeCompare(a.date));

  if (!rows.length) return null;

  const recent = rows.slice(0, 5);
  const seasonValues = rows.map(row => row[market]);
  const recentValues = recent.map(row => row[market]);
  const seasonMean = average(seasonValues);
  const recentMean = average(recentValues);
  const recentMinutes = average(recent.map(row => row.minutes));
  const baselineMinutes = average(rows.map(row => row.minutes));

  if (seasonMean === null || recentMean === null) return null;

  const contextualValues = (candidate.statsWithoutTeammates?.[market] || [])
    .filter(Number.isFinite);
  const contextualMean = average(contextualValues);
  const contextualSample = contextualValues.length;

  const minutesWithout = average(candidate.minutesWithoutTeammates || []);
  const minutesWith = average(candidate.minutesWithTeammates || []);

  const contextualLift = contextualMean !== null && seasonMean > 0
    ? (contextualMean - seasonMean) / seasonMean
    : 0;

  const recentLift = seasonMean > 0
    ? (recentMean - seasonMean) / seasonMean
    : 0;

  const minutesLift = minutesWithout !== null && minutesWith !== null && minutesWith > 0
    ? (minutesWithout - minutesWith) / minutesWith
    : 0;

  const roleEvidence = contextualSample >= 2 ? contextualLift : 0;
  const hasRoleEvidence = contextualSample >= 2 && contextualMean !== null;

  // Os minutos valorizam o candidato, mas não determinam a direção.
  // OVER/UNDER depende exclusivamente da evolução da produção estatística.
  const overSignal =
    recentLift * 50 +
    roleEvidence * 50;

  const direction: 'OVER' | 'UNDER' = overSignal >= 0 ? 'OVER' : 'UNDER';
  const signal = Math.abs(overSignal);
  const hasDirectionalEvidence = signal >= 3;

  const referenceMean = hasRoleEvidence
    ? contextualMean!
    : recentMean;

  const suggestedLine = lineForAverage(referenceMean, direction);

  const score = Math.max(0, Math.min(100, Math.round(
    Math.min(35, Math.abs(recentLift) * 100) +
    Math.min(35, Math.abs(roleEvidence) * 100) +
    Math.min(20, Math.abs(minutesLift) * 100) +
    Math.min(10, recent.length * 2)
  )));

  const reasons: string[] = [];
  const risks: string[] = [];
  const limitations: string[] = [];

  if (!hasDirectionalEvidence) {
    risks.push('Sem evidência direcional clara; a direção foi atribuída apenas para cumprir a seleção diária.');
    limitations.push('Não existe tendência estatística suficiente para sustentar OVER ou UNDER.');
  }

  if (recentLift > 0.05) {
    reasons.push(`Produção recente ${Math.round(recentLift * 100)}% acima da média da época.`);
  } else if (recentLift < -0.05) {
    reasons.push(`Produção recente ${Math.round(Math.abs(recentLift) * 100)}% abaixo da média da época.`);
  }

  if (hasRoleEvidence) {
    reasons.push(
      `Média de ${contextualMean!.toFixed(1)} em ${contextualSample} jogos sem os colegas identificados.`
    );
  } else {
    limitations.push('Não existe amostra contextual suficiente para medir o efeito das ausências.');
  }

  if (minutesLift > 0.05) {
    reasons.push(`Minutos no contexto de ausência ${Math.round(minutesLift * 100)}% acima da referência.`);
  }

  if (candidate.absentTeammates?.length) {
    reasons.push(`Colegas ausentes identificados: ${candidate.absentTeammates.join(', ')}.`);
  }

  if (candidate.confirmedAbsences?.length) {
    reasons.push(`Ausências confirmadas pela fonte médica: ${candidate.confirmedAbsences.join(', ')}.`);
  } else if (candidate.absentTeammates?.length) {
    limitations.push('A ausência dos colegas não está confirmada como médica.');
  }

  if (rows.length < 10) limitations.push(`Apenas ${rows.length} jogos disponíveis no histórico.`);
  if (recent.length < 5) limitations.push(`Amostra recente reduzida: ${recent.length} jogos.`);
  if (recentMinutes === null || baselineMinutes === null) {
    limitations.push('Não foi possível avaliar a estabilidade dos minutos.');
  } else if (recentMinutes < baselineMinutes * 0.85) {
    risks.push('Os minutos recentes estão abaixo da média histórica.');
  }

  if (contextualSample > 0 && contextualSample < 3) {
    risks.push('A amostra de jogos sem os colegas é demasiado pequena para conclusões fortes.');
  }

  if (direction === 'OVER' && recentLift <= 0 && !hasRoleEvidence) {
    risks.push('Não existe evidência contextual ou recente clara de aumento de produção.');
  }

  if (direction === 'UNDER' && recentLift >= 0 && !hasRoleEvidence) {
    risks.push('Não existe evidência contextual ou recente clara de redução de produção.');
  }

  let confidence: OnesToWatchConfidence = 'MUITO LIMITADA';
  if (rows.length >= 10 && recent.length === 5) confidence = 'LIMITADA';
  if (rows.length >= 15 && contextualSample >= 3 && recentMinutes !== null) confidence = 'BAIXA';
  if (
    rows.length >= 20 &&
    contextualSample >= 5 &&
    candidate.confirmedAbsences?.length &&
    recentMinutes !== null &&
    baselineMinutes !== null &&
    recentMinutes >= baselineMinutes * 0.85
  ) confidence = 'MODERADA';

  if (!hasDirectionalEvidence) confidence = 'MUITO LIMITADA';

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

/**
 * Selects one descriptive daily opportunity.
 * The score is a ranking index, never a calibrated probability.
 */
export function selectOnesToWatch(
  candidates: OnesToWatchCandidate[]
): OnesToWatchPick | null {
  const picks = candidates.flatMap(candidate =>
    MARKETS.map(market => evaluateMarket(candidate, market))
      .filter((pick): pick is OnesToWatchPick => pick !== null)
  );

  if (!picks.length) return null;

  return picks.sort((a, b) =>
    b.score - a.score ||
    b.contextualSample - a.contextualSample ||
    b.recentMean - a.recentMean
  )[0];
}
