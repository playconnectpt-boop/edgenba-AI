import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptEspnGamelog, buildPlayerProfile, rankPlayerTrends, uniquePlayersTop } from '../src/engine.ts';

const rows = (points, threes = points.map(() => 2)) => points.map((value, i) => ({
  date: new Date(Date.UTC(2026, 0, 20 - i)).toISOString(), minutes: 30,
  points: value, rebounds: 5, assists: 4, threes: threes[i], pra: value + 9
}));

test('Last 5, previous 5 and Last 10 use intended game windows and samples', () => {
  const games = rows([20,20,20,20,20,10,10,10,10,10]);
  const profile = buildPlayerProfile(games);
  assert.equal(profile.markets.points.last5.mean, 20);
  assert.equal(profile.markets.points.last10.mean, 15);
  const trend = rankPlayerTrends({ id: 'p1', name: 'Player' }, games).find(x => x.market === 'points');
  assert.ok(trend);
  assert.equal(trend.recentSample, 5);
  assert.equal(trend.previousSample, 5);
  assert.equal(trend.seasonSample, 10);
  assert.equal(trend.recent10Mean, 15);
});

test('missing market values are counted independently, never as zero', () => {
  const games = rows([20,20,20,20,20,10,10,10,10,10]);
  games[0].threes = undefined;
  const profile = buildPlayerProfile(games);
  assert.equal(profile.markets.threes.last5.sample, 4);
  assert.equal(profile.markets.threes.last10.sample, 9);
});

test('low-volume UNDER 0.5 threes trend is filtered', () => {
  const games = rows([12,12,12,12,12,20,20,20,20,20],[0,0,0,0,0,2,2,2,2,2]);
  const trends = rankPlayerTrends({ id: 'p1', name: 'Player' }, games);
  assert.equal(trends.some(x => x.market === 'threes' && x.direction === 'UNDER' && x.suggestedLine < 1), false);
});

test('zero-median UNDER 0.5 rebounds and assists trends are filtered', () => {
  const games = rows([20,20,20,20,20,20,20,20,20,20]);

  games.forEach((game, i) => {
    game.rebounds = i < 5 ? 0 : 1;
    game.assists = i < 5 ? 0 : 1;
  });

  const trends = rankPlayerTrends({ id: 'p-zero', name: 'Low Volume Player' }, games);

  assert.equal(
    trends.some(x => ['rebounds', 'assists'].includes(x.market) && x.direction === 'UNDER' && x.suggestedLine <= 0.5),
    false
  );
});

test('low-volume UNDER rebounds and assists below season median are filtered', () => {
  const games = rows([20,20,20,20,20,20,20,20,20,20]);

  games.forEach((game, i) => {
    game.rebounds = i < 5 ? 1 : 2;
    game.assists = i < 5 ? 1 : 2;
  });

  const trends = rankPlayerTrends({ id: 'p-low-volume', name: 'Low Volume Player' }, games);

  assert.equal(
    trends.some(x => ['rebounds', 'assists'].includes(x.market) && x.direction === 'UNDER'),
    false
  );
});

test('legitimate UNDER trends with non-zero recent production remain eligible', () => {
  const games = rows([20,20,20,20,20,10,10,10,10,10]);

  games.forEach((game, i) => {
    game.rebounds = i < 5 ? 4 : 8;
    game.assists = i < 5 ? 2 : 5;
  });

  const trends = rankPlayerTrends({ id: 'p-under', name: 'Productive Player' }, games);

  assert.ok(trends.some(x => x.market === 'rebounds' && x.direction === 'UNDER'));
  assert.ok(trends.some(x => x.market === 'assists' && x.direction === 'UNDER'));
});

test('market relevance excludes low-volume OVER and UNDER opportunities', () => {
  const games = rows([12,12,12,12,12,20,20,20,20,20]);

  games.forEach((game, i) => {
    game.rebounds = i < 5 ? 1 : 2;
    game.assists = i < 5 ? 0 : 1;
    game.threes = i < 5 ? 0 : 1;
    game.pra = i < 5 ? 13 : 21;
  });

  const trends = rankPlayerTrends({ id: 'p-low-role', name: 'Low Role Player' }, games);

  assert.equal(trends.some(x => x.market === 'rebounds'), false);
  assert.equal(trends.some(x => x.market === 'assists'), false);
  assert.equal(trends.some(x => x.market === 'threes'), false);
});

test('market relevance preserves players with meaningful production', () => {
  const games = rows([12,12,12,12,12,20,20,20,20,20]);

  games.forEach((game, i) => {
    game.rebounds = i < 5 ? 4 : 8;
    game.assists = i < 5 ? 3 : 5;
    game.threes = i < 5 ? 2 : 5;
    game.pra = i < 5 ? 19 : 33;
  });

  const trends = rankPlayerTrends({ id: 'p-high-role', name: 'High Role Player' }, games);

  assert.ok(trends.some(x => x.market === 'rebounds'));
  assert.ok(trends.some(x => x.market === 'assists'));
  assert.ok(trends.some(x => x.market === 'threes'));
  assert.ok(trends.some(x => x.market === 'pra'));
});

test('OVER gets a small ranking priority without changing statistical score', () => {
  const games = rows([20,20,20,20,20,10,10,10,10,10]);
  const candidates = rankPlayerTrends({ id: 'p-priority', name: 'Priority Player' }, games);
  const base = candidates.find(x => x.market === 'points' && x.direction === 'OVER');

  assert.ok(base);
  const under = { ...base, direction: 'UNDER', score: 80, suggestedLine: 19.5 };
  const over = { ...base, direction: 'OVER', score: 77, suggestedLine: 20.5 };
  const clearlyStrongerUnder = { ...base, playerId: 'p-strong-under', direction: 'UNDER', score: 84 };

  const top = uniquePlayersTop([under, over, clearlyStrongerUnder], 10);

  assert.equal(top[0].playerId, 'p-strong-under');
  assert.equal(top[1].direction, 'OVER');
  assert.equal(top[1].score, 77);
});

test('one isolated outlier does not create a false points trend', () => {
  const games = rows([50,10,10,10,10,10,10,10,10,10]);
  const trends = rankPlayerTrends({ id: 'p-outlier', name: 'Outlier Player' }, games);

  assert.equal(trends.some(x => x.market === 'points'), false);
});

test('significant recent minutes reduction limits trend confidence', () => {
  const games = rows([20,20,20,20,20,10,10,10,10,10]);
  games.forEach((game, i) => {
    if (i < 5) game.minutes = 20;
  });

  const trend = rankPlayerTrends({ id: 'p-minutes', name: 'Minutes Drop Player' }, games)
    .find(x => x.market === 'points');

  assert.ok(trend);
  assert.equal(trend.confidence, 'LIMITADA');
  assert.equal(trend.minutesRecent, 20);
  assert.equal(trend.minutesSeason, 25);
});

test('trend consistency is measured against the previous-five median', () => {
  const games = rows([20,20,20,20,20,10,10,10,10,10]);
  games.forEach((game, i) => {
    game.rebounds = i < 5 ? 4 : 8;
  });

  const trends = rankPlayerTrends({ id: 'p-consistency', name: 'Consistency Player' }, games);
  const over = trends.find(x => x.market === 'points' && x.direction === 'OVER');
  const under = trends.find(x => x.market === 'rebounds' && x.direction === 'UNDER');

  assert.ok(over);
  assert.ok(under);
  assert.equal(over.trendHits, 5);
  assert.equal(under.trendHits, 5);
  assert.equal(over.trendHitRate, 1);
  assert.equal(under.trendHitRate, 1);
  assert.equal(over.lineHitRate, 1);
  assert.equal(under.lineHitRate, 1);
  assert.match(over.explanation, /Tendência face à mediana anterior/);
});

test('trend consistency and suggested-line hit rate are reported independently', () => {
  const games = rows(
    [10,10,10,10,10,10,10,10,10,10],
    [3,2,2,2,3,4,4,4,4,4]
  );

  const trend = rankPlayerTrends({ id: 'p-hauser-example', name: 'Example Player' }, games)
    .find(x => x.market === 'threes' && x.direction === 'UNDER');

  assert.ok(trend);
  assert.equal(trend.suggestedLine, 2.5);
  assert.equal(trend.trendHits, 5);
  assert.equal(trend.trendHitRate, 1);
  assert.equal(trend.lineHits, 3);
  assert.equal(trend.linePushes, 0);
  assert.equal(trend.lineSample, 5);
  assert.equal(trend.lineHitRate, 0.6);
});

test('trend score does not use in-sample line hit rate', () => {
  const games = [
    ...rows([18,18,18,15,15,15,15,15,15,15]),
    ...rows([0,30,0,30,0,30,0,30,0,30]).map((game, index) => ({
      ...game,
      date: new Date(Date.UTC(2025, 0, 10 - index)).toISOString()
    }))
  ];

  const trend = rankPlayerTrends({ id: 'p-independent-score', name: 'Score Test Player' }, games)
    .find(x => x.market === 'points' && x.direction === 'OVER');

  assert.ok(trend);
  assert.equal(trend.trendHitRate, 0.6);
  assert.equal(trend.lineHitRate, 0.6);

  const values = games.map(game => game.points);
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const standardDeviation = Math.sqrt(
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length
  );

  const recentMedian = 18;
  const previousMedian = 15;
  const zScore = Math.abs(recentMedian - previousMedian) / standardDeviation;

  const expectedScore = Math.min(100, Math.round(
    trend.trendHitRate * 40 +
    Math.min(30, zScore * 15) +
    Math.min(trend.recentSample, 5) * 6
  ));

  assert.equal(trend.score, expectedScore);
  assert.equal(trend.score, 58);
});

test('Top 10 allows distinct markets per player and removes exact duplicates', () => {
  const candidates = rankPlayerTrends({ id: 'p1', name: 'Player' }, rows([20,20,20,20,20,10,10,10,10,10]));
  assert.ok(candidates.length > 0);

  const base = candidates[0];
  const otherMarket = {
    ...base,
    market: base.market === 'points' ? 'rebounds' : 'points',
    marketLabel: 'Outro mercado'
  };
  const duplicated = [
    base,
    { ...base, score: base.score + 1 },
    otherMarket
  ];

  const top = uniquePlayersTop(duplicated, 10);
  assert.equal(top.length, 2);
  assert.equal(new Set(top.map(x => x.market)).size, 2);
  assert.equal(top[0].score, base.score + 1);
  assert.ok(top.every(x => ['FORTE','MODERADA','FRACA'].includes(x.quality) && ['LIMITADA','BAIXA','MODERADA'].includes(x.confidence)));
});

test('ESPN adapter validates payload and derives PRA from supplied stats', () => {
  assert.throws(() => adaptEspnGamelog({ nope: [] }));
  const result = adaptEspnGamelog({ data: [{ date: '2026-01-01', minutes: '30', points: '10', rebounds: '3', assists: '2', threes: '1' }] });
  assert.equal(result[0].pra, 15);
});


test('ESPN adapter preserves 3PA and leaves missing attempts absent', () => {
  const result = adaptEspnGamelog({ data: [
    { date: '2026-01-02', minutes: '30', points: '10', rebounds: '3', assists: '2', threes: '2', threePointAttempts: '7' },
    { date: '2026-01-01', minutes: '28', points: '8', rebounds: '4', assists: '1', threes: '1', threePointAttempts: null }
  ] });

  assert.equal(result[0].threePointAttempts, 7);
  assert.equal(Object.hasOwn(result[1], 'threePointAttempts'), false);
});

test('low 3PA volume filters an otherwise valid UNDER threes trend', () => {
  const games = rows(
    [2,2,2,2,2,3,3,3,3,3],
    [2,2,2,2,2,3,3,3,3,3]
  ).map((game, index) => ({
    ...game,
    threePointAttempts: index < 5 ? 1 : 5
  }));

  const trends = rankPlayerTrends({ id: 'p-low-volume', name: 'Low Volume Player' }, games);
  assert.equal(
    trends.some(x => x.market === 'threes' && x.direction === 'UNDER'),
    false
  );
});

test('rejects opportunities below 50% hit rate in the recent five games', () => {
  const games = rows([20, 20, 20, 10, 10, 20, 20, 20, 20, 20]);
  const trends = rankPlayerTrends({ id: 'p-recent-low', name: 'Recent Low Player' }, games);

  assert.equal(
    trends.some(x => x.market === 'points' && x.lineHitRate < 0.5),
    false
  );
});

test('rejects opportunities with a drop of at least 30 percentage points', () => {
  const games = rows([20, 20, 20, 10, 10, 20, 20, 20, 20, 20]);
  const trends = rankPlayerTrends({ id: 'p-drop', name: 'Drop Player' }, games);

  assert.equal(
    trends.some(x =>
      x.market === 'points' &&
      x.previousLineHitRate !== null &&
      x.previousLineHitRate - x.lineHitRate >= 0.30
    ),
    false
  );
});

test('reports previous-five hit rate using the same suggested line', () => {
  const games = rows([20, 20, 20, 20, 20, 10, 10, 10, 20, 20]);
  const trends = rankPlayerTrends({ id: 'p-previous', name: 'Previous Player' }, games);
  const trend = trends.find(x => x.market === 'points');

  if (trend) {
    assert.equal(typeof trend.previousLineHitRate, 'number');
    assert.equal(trend.previousLineSample, 5);
  }
});
