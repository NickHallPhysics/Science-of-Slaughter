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