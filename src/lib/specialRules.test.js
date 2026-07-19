import { describe, it, expect } from 'vitest';
import {
  needForBS,
  needForWound,
  pFromNeed,
  resolveHitAndWound,
  resolveUnsavedGivenHit,
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

describe('resolveHitAndWound — Breaching', () => {
  it('matches brute-force enumeration over hit-die/wound-die outcomes (no rending)', () => {
    const bs = 4, S = 3, T = 4, X = 5; // hitNeed=3, wNeed=5
    const hitNeed = needForBS(bs), wNeed = needForWound(S, T);
    let totalWound = 0, totalBreach = 0, totalTrials = 0;
    for (let hitDie = 1; hitDie <= 6; hitDie++) {
      if (hitDie < hitNeed) continue;
      for (let woundDie = 1; woundDie <= 6; woundDie++) {
        totalTrials++;
        if (woundDie >= wNeed) {
          totalWound++;
          if (woundDie >= X) totalBreach++;
        }
      }
    }
    const r = resolveHitAndWound(bs, S, T, [{ id: 'breaching', value: X }]);
    expect(r.pHit * r.pWound).toBeCloseTo(totalWound / (6 * 6), 9);
    expect(r.pHit * r.pBreachWound).toBeCloseTo(totalBreach / (6 * 6), 9);
  });

  it('a Rending-forced wound always breaches, regardless of X', () => {
    const r = resolveHitAndWound(4, 1, 20, [
      { id: 'rending', value: 4 },
      { id: 'breaching', value: 6 }, // toughest possible breach threshold
    ]);
    // S far below T so the only wounds at all come from rending
    expect(r.pBreachWound).toBeCloseTo(r.pWound, 9); // every wound is a breach
  });

  it('Poisoned success does not automatically breach (needs the real roll to also clear X)', () => {
    const r = resolveHitAndWound(4, 1, 20, [
      { id: 'poisoned', value: 2 },   // wounds on 2+
      { id: 'breaching', value: 6 },  // but only breaches on a genuine 6
    ]);
    const pWound = 5 / 6;   // roll >= 2
    const pBreach = 1 / 6;  // roll >= 6
    expect(r.pWound).toBeCloseTo(pWound, 9);
    expect(r.pBreachWound).toBeCloseTo(pBreach, 9);
  });

  it('pBreachWound + pNoBreachWound === pWound', () => {
    const r = resolveHitAndWound(4, 4, 4, [
      { id: 'rending', value: 5 },
      { id: 'poisoned', value: 3 },
      { id: 'breaching', value: 6 },
    ]);
    expect(r.pBreachWound + r.pNoBreachWound).toBeCloseTo(r.pWound, 9);
  });

  it('with no Breaching rule, pBreachWound is 0 and behaviour is unchanged', () => {
    const withB = resolveHitAndWound(4, 4, 4, [{ id: 'rending', value: 5 }]);
    expect(withB.pBreachWound).toBeCloseTo(0, 9);
    expect(withB.pNoBreachWound).toBeCloseTo(withB.pWound, 9);
  });
});

describe('resolveUnsavedGivenHit', () => {
  it('AP2 always negates armour, since armour saves only range 2-6', () => {
    const { saveBreach } = resolveUnsavedGivenHit(1, 0, 6, 3, 7, 7); // armour 3+, no invuln/cover
    expect(saveBreach.armourUsable).toBe(false);
    expect(saveBreach.saveValue).toBeNull(); // no save at all if armour was the only option
  });

  it('invulnerable/cover still apply against a breached wound', () => {
    const { saveBreach } = resolveUnsavedGivenHit(1, 0, 6, 3, 4, 7); // invuln 4+ present
    expect(saveBreach.saveValue).toBe(4);
    expect(saveBreach.source).toBe('Invulnerable');
  });

  it('reduces to the plain single-save case when there are no breach wounds', () => {
    const { pUnsavedGivenHit, saveNormal } = resolveUnsavedGivenHit(0, 0.5, 3, 4, 7, 7);
    expect(pUnsavedGivenHit).toBeCloseTo(0.5 * saveNormal.pUnsaved, 9);
  });
});