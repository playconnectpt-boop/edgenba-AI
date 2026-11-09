import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adaptEspnGamelog,
  buildPlayerProfile,
  calibrateProbability,
  rankPlayerTrends,
  uniquePlayersTop
} from '../src/engine.ts';

const rows = (points, rebounds = points.map(() => 5), assists = points.map(() => 4), threes = points.map(() => 2)) =>
  points.map((value, i) => ({
    date: new Date(Date.UTC(2026, 0, 20 - i)).toISOString(),
    minutes: 30,
    points: value,
    rebounds: rebounds[i],
    assists: assists[i],
    threes: threes[i],
    pra: value + rebounds[i] + assists[i]
  }));

const candidate = (overrides = {}) => ({
  playerId: 'p1',
  playerName: 'Player 1',
  teamName: 'Team A',
  gameId: 'game-1',
  market: 'points',
  marketLabel: 'Pontos',
  direction: 'OVER',
  score: 80,
  probability: 82,
  confidencePercent: 78,
  calibrationStatus: 'PROVISIONAL',
  seasonMean: 20,
  recentMean: 22,
  recent10Mean: 21,
  previousMean: 20,
  seasonMedian: 20,
  suggestedLine: 20.5,
  trendHitRate: 0.8,
  trendHits: 4,
  lineHitRate: 0.8,
  lineHits: 4,
  linePushes: 0,
  lineSample: 5,
  previousLineHitRate: 0.6,
  previousLineHits: 3,
  previousLinePushes: 0,
  previousLineSample: 5,
  recentSample: 5,
  previousSample: 5,
  seasonSample: 10,
  recentResults: [22, 24, 21, 23, 19],
  minutesRecent: 30,
  minutesSeason: 30,
  explanation: '',
  quality: 'FORTE',
  confidence: 'MODERADA',
  ...overrides
});

test('profile reports last 5, last 10 and season statistics', () => {
  const games = rows([20,20,20,20,20,10,10,10,10,10]);
  const profile = buildPlayerProfile(games);

  assert.equal(profile.markets.points.last5.mean, 20);
  assert.equal(profile.markets.points.last10.mean, 15);
  assert.equal(profile.markets.points.season.mean, 15);
  assert.equal(profile.markets.points.season.median, 15);
  assert.equal(profile.minutes.last10.mean, 30);
});

test('missing market values are counted independently, never as zero', () => {
  const games = rows([20,20,20,20,20,10,10,10,10,10]);
  games[0].threes = undefined;
  const profile = buildPlayerProfile(games);

  assert.equal(profile.markets.threes.last5.sample, 4);
  assert.equal(profile.markets.threes.last10.sample, 9);
});

test('accepts small samples and exposes probability, confidence and combined score', () => {
  const trends = rankPlayerTrends(
    { id: 'p-small', name: 'Small Sample' },
    rows([30,30,30,30,0,30])
  );
  const points = trends.find(item => item.market === 'points');

  assert.ok(points);
  assert.equal(typeof points.probability, 'number');
  assert.equal(typeof points.confidencePercent, 'number');
  assert.equal(points.score, Math.round((points.probability + points.confidencePercent) / 2));
  assert.ok(points.confidencePercent < 100);
  assert.equal(points.calibrationStatus, 'PROVISIONAL');
});

test('medical context reduces confidence without changing statistical probability', () => {
  const player = { id: 'p-medical', name: 'Medical Player' };
  const games = rows([30,30,30,30,0,30]);

  const baseline = rankPlayerTrends(player, games)
    .find(item => item.market === 'points');

  assert.ok(baseline, 'baseline points candidate must exist');

  for (const [status, penalty] of [
    ['QUESTIONABLE', 18],
    ['PROBABLE', 6],
    ['RELATÓRIO INDISPONÍVEL', 20]
  ]) {
    const adjusted = rankPlayerTrends(player, games, {
      contextConfidenceAdjustment: penalty
    }).find(item => item.market === 'points');

    assert.ok(adjusted, `${status} candidate must exist`);
    assert.equal(adjusted.probability, baseline.probability);
    assert.equal(
      adjusted.confidencePercent,
      baseline.confidencePercent - penalty,
      `${status} must reduce confidence by ${penalty} points`
    );
    assert.equal(
      adjusted.score,
      Math.round((adjusted.probability + adjusted.confidencePercent) / 2)
    );
  }
});

test('market activity thresholds are proportional to available sample', () => {
  const games = rows(
    [30,30,30,30,0,30],
    [4,4,4,4,0,4],
    [6,6,6,6,0,6],
    [5,5,5,5,0,5]
  );
  // Supply real 3PA data: UNDER threes must not be inferred when attempts are unknown.
  games.forEach(game => { game.threePointAttempts = 5; });
  const trends = rankPlayerTrends({ id: 'p-proportional', name: 'Proportional' }, games);

  assert.ok(trends.some(item => item.market === 'points'));
  assert.ok(trends.some(item => item.market === 'rebounds'));
  assert.ok(trends.some(item => item.market === 'assists'));
  assert.ok(trends.some(item => item.market === 'threes'));
});

test('activity filter is market-specific', () => {
  const games = rows(
    [30,30,30,30,0,30,30,30,30,30],
    Array(10).fill(0),
    [5,5,5,5,0,5,5,5,5,5],
    [5,5,5,5,0,5,5,5,5,5]
  );
  const trends = rankPlayerTrends({ id: 'p-filter', name: 'Filter' }, games);

  assert.ok(trends.some(item => item.market === 'points'));
  assert.equal(trends.some(item => item.market === 'rebounds'), false);
  assert.ok(trends.some(item => item.market === 'assists'));
  assert.ok(trends.some(item => item.market === 'threes'));
});

test('suggested lines use half points and avoid trivial UNDER 0.5', () => {
  const games = rows(
    [20,20,20,20,20,10,10,10,10,10],
    [4,4,4,4,4,8,8,8,8,8],
    [3,3,3,3,3,5,5,5,5,5],
    [2,2,2,2,2,3,3,3,3,3]
  );
  const trends = rankPlayerTrends({ id: 'p-lines', name: 'Line Player' }, games);

  for (const item of trends) {
    assert.equal(item.suggestedLine % 1, 0.5);
    if (item.direction === 'UNDER') assert.ok(item.suggestedLine > 0.5);
  }
});

test('prefers the most demanding eligible OVER line within one point', () => {
  const games = rows([
    40,40,40,0,29,
    ...Array(10).fill(40),
    ...Array(5).fill(10)
  ]);
  const trends = rankPlayerTrends(
    { id: 'p-demanding-over', name: 'Demanding Over' },
    games
  );
  const points = trends.find(item => item.market === 'points' && item.direction === 'OVER');

  assert.ok(points, 'should retain an eligible OVER opportunity');
  assert.ok(points.suggestedLine >= points.recentMean,
    'OVER line must not be below the recent five-game mean');
  assert.ok(points.probability >= 60);
});

test('rejects OVER below recent mean and does not fall back when the qualifying line is below 60%', () => {
  const games = rows(
    Array(10).fill(20),
    Array(10).fill(5),
    [...Array(5).fill(2), ...Array(5).fill(1)],
    Array(10).fill(2)
  );
  const trends = rankPlayerTrends(
    { id: 'p-recent-mean-floor', name: 'Recent Mean Floor' },
    games
  );
  const assistsOver = trends.find(item => item.market === 'assists' && item.direction === 'OVER');

  assert.equal(assistsOver, undefined,
    'OVER 1.5 is below the recent mean of 2.0, while OVER 2.5 fails 60%; no OVER should be selected');
});

test('never generates UNDER opportunities', () => {
  const games = rows([
    ...Array(10).fill(10),
    ...Array(10).fill(30)
  ]);
  const trends = rankPlayerTrends(
    { id: 'p-no-under', name: 'No Under' },
    games
  );

  assert.ok(trends.every(item => item.direction === 'OVER'));
});

test('calibration remains provisional without sufficient history', () => {
  const history = Array.from({ length: 29 }, () => ({
    market: 'points', predictedProbability: 75, hit: true
  }));

  assert.deepEqual(calibrateProbability(75, 'points', history), {
    probability: 75,
    status: 'PROVISIONAL'
  });
});

test('calibration is specific to market and historical probability range', () => {
  const history = Array.from({ length: 40 }, (_, index) => ({
    market: 'points',
    predictedProbability: 75,
    hit: index < 24
  }));
  const calibrated = calibrateProbability(75, 'points', history);
  const otherMarket = calibrateProbability(75, 'rebounds', history);

  assert.equal(calibrated.status, 'CALIBRATED');
  assert.ok(calibrated.probability < 75);
  assert.equal(otherMarket.status, 'PROVISIONAL');
});

test('TOP 10 keeps at most one opportunity per player', () => {
  const selected = uniquePlayersTop([
    candidate({ score: 90 }),
    candidate({ market: 'rebounds', score: 89 }),
    candidate({ playerId: 'p2', playerName: 'Player 2', score: 80 })
  ]);

  assert.equal(selected.length, 2);
  assert.equal(selected.filter(item => item.playerId === 'p1').length, 1);
  assert.equal(selected[0].score, 90);
});

test('TOP 10 enforces two opportunities per team and three per game', () => {
  const selected = uniquePlayersTop([
    candidate({ playerId: 'p1', teamName: 'A', gameId: 'g1', score: 99 }),
    candidate({ playerId: 'p2', teamName: 'A', gameId: 'g1', score: 98 }),
    candidate({ playerId: 'p3', teamName: 'A', gameId: 'g1', score: 97 }),
    candidate({ playerId: 'p4', teamName: 'B', gameId: 'g1', score: 96 }),
    candidate({ playerId: 'p5', teamName: 'C', gameId: 'g1', score: 95 }),
    candidate({ playerId: 'p6', teamName: 'D', gameId: 'g2', score: 94 })
  ]);

  assert.equal(selected.filter(item => item.teamName === 'A').length, 2);
  assert.equal(selected.filter(item => item.gameId === 'g1').length, 3);
});

test('TOP 10 excludes probability below 60 and ranks by score then confidence', () => {
  const selected = uniquePlayersTop([
    candidate({ playerId: 'p-low', probability: 59, score: 99 }),
    candidate({ playerId: 'p-score', probability: 80, confidencePercent: 70, score: 75 }),
    candidate({ playerId: 'p-confidence', probability: 78, confidencePercent: 90, score: 84 })
  ]);

  assert.deepEqual(selected.map(item => item.playerId), ['p-confidence', 'p-score']);
});

test('TOP 10 excludes UNDER even when its score is higher', () => {
  const selected = uniquePlayersTop([
    candidate({ playerId: 'p-under', direction: 'UNDER', score: 99 }),
    candidate({ playerId: 'p-over', direction: 'OVER', score: 70 })
  ]);

  assert.equal(selected.length, 1);
  assert.equal(selected[0].playerId, 'p-over');
  assert.ok(selected.every(item => item.direction === 'OVER'));
});

test('TOP 10 never fills missing places with UNDER opportunities', () => {
  const overs = Array.from({ length: 7 }, (_, i) =>
    candidate({
      playerId: `over-${i}`,
      playerName: `Over ${i}`,
      teamName: `Over Team ${i}`,
      gameId: `over-game-${i}`,
      direction: 'OVER',
      score: 70 - i
    })
  );

  const unders = Array.from({ length: 10 }, (_, i) =>
    candidate({
      playerId: `under-${i}`,
      playerName: `Under ${i}`,
      teamName: `Under Team ${i}`,
      gameId: `under-game-${i}`,
      direction: 'UNDER',
      score: 99 - i
    })
  );

  const selected = uniquePlayersTop([...unders, ...overs]);

  assert.equal(selected.length, 7);
  assert.ok(selected.every(item => item.direction === 'OVER'));
});

test('ESPN adapter validates payload and derives PRA', () => {
  assert.throws(() => adaptEspnGamelog({ nope: [] }));

  const result = adaptEspnGamelog({
    data: [{
      date: '2026-01-01',
      minutes: '30',
      points: '10',
      rebounds: '3',
      assists: '2',
      threes: '1'
    }]
  });

  assert.equal(result[0].pra, 15);
});

test('ESPN adapter preserves 3PA and leaves missing attempts absent', () => {
  const result = adaptEspnGamelog({
    data: [
      {
        date: '2026-01-02', minutes: '30', points: '10',
        rebounds: '3', assists: '2', threes: '2', threePointAttempts: '7'
      },
      {
        date: '2026-01-01', minutes: '28', points: '8',
        rebounds: '4', assists: '1', threes: '1', threePointAttempts: null
      }
    ]
  });

  assert.equal(result[0].threePointAttempts, 7);
  assert.equal(Object.hasOwn(result[1], 'threePointAttempts'), false);
});
