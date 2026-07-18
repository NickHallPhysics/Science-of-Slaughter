import { describe, it, expect } from 'vitest';
import {
  needForBS,
  needForWound,
  pFromNeed,
  resolveHitAndWound,
} from './combatMath.js';
import {
  SPECIAL_RULE_DEFINITIONS,
} from './specialRules.js';

describe('resolveHitAndWound — Rending', () => {
  it('falls back to normal hit/wound math with no active rules', () => {
    const r = resolveHitAndWound(4, 4, 4, []);
    expect(r.pHit).toBeCloseTo(pFromNeed(needForBS(4)), 9);
    expect(r.pWound).toBeCloseTo((7 - needForWound(4, 4)) / 6, 9);
  });

  it('BS10 + rending: always hits and always wounds', () => {
    const r = resolveHitAndWound(10, 1, 10, [{ id: 'rending', value: 4 }]);
    expect(r.pHit).toBe(1);
    expect(r.pWound).toBe(1);
  });

  it('rendingX <= hitNeed: every hit auto-wounds', () => {
    const r = resolveHitAndWound(3, 1, 10, [{ id: 'rending', value: 3 }]);
    expect(r.pHit).toBeCloseTo(4 / 6, 9);
    expect(r.pWound).toBeCloseTo(1, 9);
  });

  it('unknown rule ids are ignored rather than throwing', () => {
    const r = resolveHitAndWound(4, 4, 4, [{ id: 'notARealRule', value: 99 }]);
    expect(r.pHit).toBeCloseTo(pFromNeed(needForBS(4)), 9);
  });
});

describe('applyPoisonedRule / resolveHitAndWound — Poisoned', () => {
  it('poison threshold worse than the normal wound chance: normal chance wins', () => {
    // S >= T+2 -> needs 2+ to wound normally (pWound = 5/6)
    const r = resolveHitAndWound(4, 6, 4, [{ id: 'poisoned', value: 6 }]); // poison needs 6+ (1/6)
    const expectedPWound = (7 - needForWound(6, 4)) / 6; // 5/6
    expect(r.pWound).toBeCloseTo(expectedPWound, 9);
  });

  it('poison threshold better than the normal wound chance: poison wins', () => {
    // S <= T-3 -> cannot wound normally at all (pWound = 0)
    const r = resolveHitAndWound(4, 1, 10, [{ id: 'poisoned', value: 4 }]); // poison needs 4+ (0.5)
    expect(r.pWound).toBeCloseTo(0.5, 9);
  });

  it('poison rescues an otherwise-impossible wound roll (wNeed is null)', () => {
    const r = resolveHitAndWound(4, 1, 20, [{ id: 'poisoned', value: 2 }]);
    expect(needForWound(1, 20)).toBeNull(); // sanity check: normally cannot wound at all
    expect(r.pWound).toBeCloseTo(5 / 6, 9); // poison 2+ = 5/6, and wins since normal is 0
  });

  it('matching thresholds: no change either way', () => {
    // S = T -> needs 4+ (0.5); poison also 4+ (0.5)
    const r = resolveHitAndWound(4, 4, 4, [{ id: 'poisoned', value: 4 }]);
    expect(r.pWound).toBeCloseTo(0.5, 9);
  });

  it('poison never affects pHit', () => {
    const withoutPoison = resolveHitAndWound(4, 4, 4, []);
    const withPoison = resolveHitAndWound(4, 4, 4, [{ id: 'poisoned', value: 2 }]);
    expect(withPoison.pHit).toBeCloseTo(withoutPoison.pHit, 9);
  });

  it('pWound never exceeds 1, even with a very favourable poison threshold', () => {
    const r = resolveHitAndWound(4, 8, 1, [{ id: 'poisoned', value: 2 }]); // already wounds on 2+ normally
    expect(r.pWound).toBeLessThanOrEqual(1);
    expect(r.pWound).toBeCloseTo(5 / 6, 9); // 2+ either way
  });

  it('BS10 auto-hit does not by itself force an auto-wound (unlike Rending)', () => {
    // S far below T: normal wound chance is 0. Weak poison (6+) should NOT bail out to pWound=1.
    const r = resolveHitAndWound(10, 1, 20, [{ id: 'poisoned', value: 6 }]);
    expect(r.pHit).toBe(1); // still auto-hit, from BS10 itself
    expect(r.pWound).toBeCloseTo(1 / 6, 9); // only as good as the poison threshold, not forced to 1
  });
});