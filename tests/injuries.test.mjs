import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEspnInjuryReport } from '../src/injuries.ts';

const injury = (athleteId, status, injuryId = 537995) => ({
  id: injuryId,
  status,
  athlete: {
    links: [{
      href: `https://www.espn.com/nba/player/_/id/${athleteId}/player-name`
    }]
  }
});

test('extracts athlete ESPN ID, never the injury record ID', () => {
  const result = parseEspnInjuryReport({
    data: { injuries: [{ injuries: [injury('4585618', 'Out', 537995)] }] }
  });

  assert.equal(result.valid, true);
  assert.equal(result.statuses.get('4585618'), 'LESIONADO');
  assert.equal(result.statuses.has('537995'), false);
});

test('maps ESPN injury statuses to the expected labels', () => {
  const result = parseEspnInjuryReport({
    injuries: [
      { injuries: [
        injury('1001', 'Out'),
        injury('1002', 'Day-To-Day'),
        injury('1003', 'Doubtful'),
        injury('1004', 'Probable'),
        injury('1005', 'Suspended'),
        injury('1006', 'Inactive')
      ]}
    ]
  });

  assert.deepEqual([...result.statuses.entries()], [
    ['1001', 'LESIONADO'],
    ['1002', 'QUESTIONÁVEL'],
    ['1003', 'DUVIDOSO'],
    ['1004', 'PROVÁVEL'],
    ['1005', 'SUSPENSO'],
    ['1006', 'INATIVO']
  ]);
});

test('accepts an empty but structurally valid ESPN injury report', () => {
  const result = parseEspnInjuryReport({ data: { injuries: [] } });

  assert.equal(result.valid, true);
  assert.equal(result.statuses.size, 0);
});

test('rejects malformed or unexpected report structures', () => {
  for (const payload of [
    null,
    {},
    { data: {} },
    { data: { injuries: {} } },
    { injuries: null }
  ]) {
    const result = parseEspnInjuryReport(payload);
    assert.equal(result.valid, false);
    assert.equal(result.statuses.size, 0);
  }
});

test('does not guess an athlete ID when links contain conflicting IDs', () => {
  const result = parseEspnInjuryReport({
    injuries: [{
      injuries: [{
        status: 'Out',
        athlete: {
          links: [
            { href: 'https://example.com/first/id/111' },
            { href: 'https://example.com/second/id/222' }
          ]
        }
      }]
    }]
  });

  assert.equal(result.valid, true);
  assert.equal(result.statuses.size, 0);
});
