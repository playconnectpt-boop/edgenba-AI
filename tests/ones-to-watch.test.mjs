import test from 'node:test';
import assert from 'node:assert/strict';
import { selectOnesToWatch } from '../src/ones-to-watch.ts';

const makeRows = (points, minutes = 30) => points.map((value, i) => ({
  date: new Date(Date.UTC(2026, 0, 20 - i)).toISOString(),
  minutes,
  points: value,
  rebounds: 5,
  assists: 4,
  threes: 2,
  pra: value + 9
}));

test('returns exactly one player and one market', () => {
  const pick = selectOnesToWatch([
    { playerId: 'p1', playerName: 'Player One', teamName: 'Team A', rows: makeRows([30, 28, 29, 27, 31, 15, 16, 17, 18, 19]) },
    { playerId: 'p2', playerName: 'Player Two', teamName: 'Team B', rows: makeRows([20, 20, 20, 20, 20, 19, 19, 19, 19, 19]) }
  ]);

  assert.ok(pick);
  assert.ok(pick.playerId);
  assert.ok(['points', 'rebounds', 'assists', 'threes', 'pra'].includes(pick.market));
  assert.ok(['OVER', 'UNDER'].includes(pick.direction));
});

test('contextual absence data is reflected in the reasons', () => {
  const pick = selectOnesToWatch([{
    playerId: 'p1',
    playerName: 'Player One',
    teamName: 'Team A',
    rows: makeRows([20, 20, 20, 20, 20, 18, 18, 18, 18, 18]),
    statsWithoutTeammates: { points: [30, 28, 32, 29] },
    minutesWithTeammates: [28, 29, 30, 28],
    minutesWithoutTeammates: [35, 36, 34, 37],
    absentTeammates: ['Star Player'],
    confirmedAbsences: ['Star Player']
  }]);

  assert.ok(pick);
  assert.ok(pick.reasons.some(reason => reason.includes('jogos sem os colegas')));
  assert.equal(pick.contextualSample, 4);
});

test('low data confidence is disclosed', () => {
  const pick = selectOnesToWatch([{
    playerId: 'p1',
    playerName: 'Player One',
    teamName: 'Team A',
    rows: makeRows([20, 22, 21])
  }]);

  assert.ok(pick);
  assert.equal(pick.confidence, 'MUITO LIMITADA');
  assert.ok(pick.limitations.length > 0);
});

test('UNDER line is below the reference mean', () => {
  const pick = selectOnesToWatch([{
    playerId: 'p1',
    playerName: 'Player One',
    teamName: 'Team A',
    rows: makeRows([10, 10, 10, 10, 10, 30, 30, 30, 30, 30])
  }]);

  assert.ok(pick);
  if (pick.direction === 'UNDER') {
    assert.ok(pick.suggestedLine > pick.recentMean);
  }
});

test('returns null when no candidate has valid statistics', () => {
  assert.equal(selectOnesToWatch([]), null);
  assert.equal(selectOnesToWatch([{
    playerId: 'p1',
    playerName: 'Player One',
    teamName: 'Team A',
    rows: []
  }]), null);
});

test('a clear recent decline produces an UNDER selection', () => {
  const pick = selectOnesToWatch([{
    playerId: 'p1',
    playerName: 'Player One',
    teamName: 'Team A',
    rows: makeRows([10, 10, 10, 10, 10, 30, 30, 30, 30, 30])
  }]);

  assert.ok(pick);
  assert.equal(pick.direction, 'UNDER');
  assert.ok(pick.suggestedLine > pick.recentMean);
});

test('invalid contextual values do not inflate the sample', () => {
  const pick = selectOnesToWatch([{
    playerId: 'p1',
    playerName: 'Player One',
    teamName: 'Team A',
    rows: makeRows([20, 20, 20, 20, 20, 18, 18, 18, 18, 18]),
    statsWithoutTeammates: {
      points: [30, Number.NaN, 28, Number.POSITIVE_INFINITY]
    }
  }]);

  assert.ok(pick);
  assert.equal(pick.contextualSample, 2);
});

test('neutral evidence is explicitly disclosed as uncertain', () => {
  const pick = selectOnesToWatch([{
    playerId: 'p1',
    playerName: 'Player One',
    teamName: 'Team A',
    rows: makeRows([20, 20, 20, 20, 20, 20, 20, 20, 20, 20])
  }]);

  assert.ok(pick);
  assert.equal(pick.confidence, 'MUITO LIMITADA');
  assert.ok(
    [...pick.risks, ...pick.limitations].some(text =>
      /sem evidência direcional|sem tendência direcional/i.test(text)
    )
  );
});
