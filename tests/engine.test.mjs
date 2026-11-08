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

test('Top 10 list keeps only the highest scoring market per player and labels quality', () => {
  const candidates = rankPlayerTrends({ id: 'p1', name: 'Player' }, rows([20,20,20,20,20,10,10,10,10,10]));
  const duplicated = [...candidates, ...candidates.map(x => ({ ...x, score: x.score + 1 }))];
  const top = uniquePlayersTop(duplicated, 10);
  assert.equal(top.length, candidates.length ? 1 : 0);
  assert.equal(new Set(top.map(x => x.playerId)).size, top.length);
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
