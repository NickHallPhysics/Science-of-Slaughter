import { describe, it, expect } from 'vitest';
import {
  needForBS,
  needForBSSnapShot,
  needForWound,
  pFromNeed,
  resolveAttackProbabilities,
  sumBucket,
  getInnateCriticalX,
  getEffectiveCriticalThreshold,
  applyEternalWarrior,
  applyDeflagrateWave,
  resolveVehicleAttackProbabilities,
  computeVehicleHullPointDistribution, 
  resolveVehicleFinalOutcomeProbabilities, 
  computeStatusInflictedProbability,
  computeModelsRemovedMultiTier,
  mean,
} from './combatMath.js';
import {
  OFFENSIVE_SPECIAL_RULE_DEFINITIONS,
  DEFENSIVE_SPECIAL_RULE_DEFINITIONS,
} from './specialRules.js';

// This file covers the behaviour of each NAMED special rule specifically.
// Generic, rule-agnostic math (binomial mechanics, save resolution, the
// wound/casualty state machine) lives in combatMath.test.js instead.

describe('special rule registries — structural sanity', () => {
  const allDefs = [...OFFENSIVE_SPECIAL_RULE_DEFINITIONS, ...DEFENSIVE_SPECIAL_RULE_DEFINITIONS];

  it('every rule id is unique across both registries', () => {
    const ids = allDefs.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every definition has either options+defaultValue, or fixedValue, but not neither', () => {
    for (const def of allDefs) {
      const hasOptions = Array.isArray(def.options) && def.options.length > 0;
      const hasFixed = def.fixedValue !== undefined;
      expect(hasOptions || hasFixed).toBe(true); // must have one
      if (hasOptions) expect(def.options).toContain(def.defaultValue); // defaultValue must be a real option
    }
  });

  it('every definition has a label and id', () => {
    for (const def of allDefs) {
      expect(typeof def.id).toBe('string');
      expect(typeof def.label).toBe('string');
      expect(def.id.length).toBeGreaterThan(0);
      expect(def.label.length).toBeGreaterThan(0);
    }
  });
});

describe('resolveAttackProbabilities — Rending', () => {
  it('falls back to normal hit/wound math with no active rules', () => {
    const r = resolveAttackProbabilities(needForBS(4), 4, 4, getInnateCriticalX(4), [], []);
    expect(r.pHit).toBeCloseTo(pFromNeed(needForBS(4)), 9);
    expect(r.pWound).toBeCloseTo((7 - needForWound(4, 4)) / 6, 9);
  });

  it('BS10 + rending: always hits and always wounds', () => {
    const r = resolveAttackProbabilities(needForBS(10), 1, 10, getInnateCriticalX(10), [], [{ id: 'rending', value: 4 }]);
    expect(r.pHit).toBe(1);
    expect(r.pWound).toBe(1);
  });

  it('rendingX <= hitNeed: every hit auto-wounds', () => {
    const r = resolveAttackProbabilities(needForBS(3), 1, 10, getInnateCriticalX(3), [], [{ id: 'rending', value: 3 }]);
    expect(r.pHit).toBeCloseTo(4 / 6, 9);
    expect(r.pWound).toBeCloseTo(1, 9);
  });

  it('unknown rule ids are ignored rather than throwing', () => {
    const r = resolveAttackProbabilities(needForBS(4), 4, 4, getInnateCriticalX(4), [], [{ id: 'notARealRule', value: 99 }]);
    expect(r.pHit).toBeCloseTo(pFromNeed(needForBS(4)), 9);
  });
});

describe('resolveAttackProbabilities — Poisoned', () => {
  it('poison threshold worse than the normal wound chance: normal chance wins', () => {
    const r = resolveAttackProbabilities(needForBS(4), 6, 4, getInnateCriticalX(4), [], [{ id: 'poisoned', value: 6 }]);
    const expectedPWound = (7 - needForWound(6, 4)) / 6;
    expect(r.pWound).toBeCloseTo(expectedPWound, 9);
  });

  it('poison threshold better than the normal wound chance: poison wins', () => {
    const r = resolveAttackProbabilities(needForBS(4), 1, 10, getInnateCriticalX(4), [], [{ id: 'poisoned', value: 4 }]);
    expect(r.pWound).toBeCloseTo(0.5, 9);
  });

  it('poison rescues an otherwise-impossible wound roll (wNeed is null)', () => {
    const r = resolveAttackProbabilities(needForBS(4), 1, 20, getInnateCriticalX(4), [], [{ id: 'poisoned', value: 2 }]);
    expect(needForWound(1, 20)).toBeNull();
    expect(r.pWound).toBeCloseTo(5 / 6, 9);
  });

  it('matching thresholds: no change either way', () => {
    const r = resolveAttackProbabilities(needForBS(4), 4, 4, getInnateCriticalX(4), [], [{ id: 'poisoned', value: 4 }]);
    expect(r.pWound).toBeCloseTo(0.5, 9);
  });

  it('poison never affects pHit', () => {
    const withoutPoison = resolveAttackProbabilities(needForBS(4), 4, 4, getInnateCriticalX(4), [], []);
    const withPoison = resolveAttackProbabilities(needForBS(4), 4, 4, getInnateCriticalX(4), [], [{ id: 'poisoned', value: 2 }]);
    expect(withPoison.pHit).toBeCloseTo(withoutPoison.pHit, 9);
  });

  it('pWound never exceeds 1, even with a very favourable poison threshold', () => {
    const r = resolveAttackProbabilities(needForBS(4), 8, 1, getInnateCriticalX(4), [], [{ id: 'poisoned', value: 2 }]);
    expect(r.pWound).toBeLessThanOrEqual(1);
    expect(r.pWound).toBeCloseTo(5 / 6, 9);
  });

  it('BS10\'s auto-wound comes from the innate Critical Hit granted by high BS, not from Poisoned itself', () => {
    // BS10 innately grants Critical Hit(2) (see getInnateCriticalX), which alone
    // is enough to force every hit to auto-wound -- independent of Poisoned's
    // own threshold. Comparing with/without Poisoned shows Poisoned isn't what's
    // driving the result.
    const withoutPoison = resolveAttackProbabilities(needForBS(10), 1, 20, getInnateCriticalX(10), [], []);
    const withWeakPoison = resolveAttackProbabilities(needForBS(10), 1, 20, getInnateCriticalX(10), [], [{ id: 'poisoned', value: 6 }]);
    expect(withoutPoison.pHit).toBe(1);
    expect(withoutPoison.pWound).toBe(1);   // innate Critical Hit alone forces this
    expect(withWeakPoison.pWound).toBe(1);  // unchanged by Poisoned's value either way
  });
});

describe('resolveAttackProbabilities — Breaching', () => {
  // NOTE: the current API exposes breach status via `buckets` (BreachDplus0/1/2
  // vs noBreachDplus0/1/2), not the old pBreachWound/pNoBreachWound scalars.
  it('matches brute-force enumeration over hit-die/wound-die outcomes (no rending)', () => {
    const bs = 4, S = 3, T = 4, X = 5;
    const hitNeed = needForBS(bs), wNeed = needForWound(S, T);
    let totalWound = 0, totalBreach = 0;
    for (let hitDie = 1; hitDie <= 6; hitDie++) {
      if (hitDie < hitNeed) continue;
      for (let woundDie = 1; woundDie <= 6; woundDie++) {
        if (woundDie >= wNeed) {
          totalWound++;
          if (woundDie >= X) totalBreach++;
        }
      }
    }
    const { buckets } = resolveAttackProbabilities(needForBS(bs), S, T, getInnateCriticalX(bs), [], [{ id: 'breaching', value: X }]);
    const totalWoundProb = sumBucket(buckets, 'BreachDplus0') + sumBucket(buckets, 'BreachDplus1') + sumBucket(buckets, 'BreachDplus2')
      + sumBucket(buckets, 'noBreachDplus0') + sumBucket(buckets, 'noBreachDplus1') + sumBucket(buckets, 'noBreachDplus2');
    const totalBreachProb = sumBucket(buckets, 'BreachDplus0') + sumBucket(buckets, 'BreachDplus1') + sumBucket(buckets, 'BreachDplus2');
    expect(totalWoundProb).toBeCloseTo(totalWound / 36, 9);
    expect(totalBreachProb).toBeCloseTo(totalBreach / 36, 9);
  });

  it('a Rending-forced wound always breaches, regardless of X', () => {
    const { buckets } = resolveAttackProbabilities(needForBS(4), 1, 20, getInnateCriticalX(4), [], [
      { id: 'rending', value: 4 },
      { id: 'breaching', value: 6 },
    ]);
    const totalWound = sumBucket(buckets, 'BreachDplus0') + sumBucket(buckets, 'BreachDplus1') + sumBucket(buckets, 'BreachDplus2')
      + sumBucket(buckets, 'noBreachDplus0') + sumBucket(buckets, 'noBreachDplus1') + sumBucket(buckets, 'noBreachDplus2');
    const totalBreach = sumBucket(buckets, 'BreachDplus0') + sumBucket(buckets, 'BreachDplus1') + sumBucket(buckets, 'BreachDplus2');
    expect(totalBreach).toBeCloseTo(totalWound, 9); // every wound is a breach
  });

  it('Poisoned success does not automatically breach (needs the real roll to also clear X)', () => {
    // Note: buckets hold ABSOLUTE probabilities (they already include pHit),
    // so expected values here are computed over all 36 (hit-die, wound-die)
    // combinations, not conditional on a hit -- same basis as the sibling
    // brute-force test above.
    const r = resolveAttackProbabilities(needForBS(4), 1, 20, getInnateCriticalX(4), [], [
      { id: 'poisoned', value: 2 },
      { id: 'breaching', value: 6 },
    ]);
    const { buckets } = r;
    const totalWound = sumBucket(buckets, 'BreachDplus0') + sumBucket(buckets, 'BreachDplus1') + sumBucket(buckets, 'BreachDplus2')
      + sumBucket(buckets, 'noBreachDplus0') + sumBucket(buckets, 'noBreachDplus1') + sumBucket(buckets, 'noBreachDplus2');
    const totalBreach = sumBucket(buckets, 'BreachDplus0') + sumBucket(buckets, 'BreachDplus1') + sumBucket(buckets, 'BreachDplus2');
    expect(totalWound).toBeCloseTo(5 / 9, 9);  // 4 hitting dice x 5 wounding dice (>=2), out of 36
    expect(totalBreach).toBeCloseTo(1 / 9, 9); // 4 hitting dice x 1 breaching die (=6), out of 36
    expect(r.pWound).toBeCloseTo(5 / 6, 9);    // the conditional-on-hit view, for comparison
  });

  it('with no Breaching rule, every wound falls in the non-breach buckets', () => {
    const { buckets } = resolveAttackProbabilities(needForBS(4), 4, 4, getInnateCriticalX(4), [], [{ id: 'rending', value: 5 }]);
    const totalBreach = sumBucket(buckets, 'BreachDplus0') + sumBucket(buckets, 'BreachDplus1') + sumBucket(buckets, 'BreachDplus2');
    expect(totalBreach).toBeCloseTo(0, 9);
  });
});

describe('resolveAttackProbabilities — Shred', () => {
  it('a Rending-forced wound always triggers Shred, regardless of X', () => {
    const { buckets } = resolveAttackProbabilities(needForBS(4), 1, 20, getInnateCriticalX(4), [], [
      { id: 'rending', value: 4 },
      { id: 'shred', value: 6 },
    ]);
    const totalWound = sumBucket(buckets, 'BreachDplus0') + sumBucket(buckets, 'BreachDplus1') + sumBucket(buckets, 'BreachDplus2')
      + sumBucket(buckets, 'noBreachDplus0') + sumBucket(buckets, 'noBreachDplus1') + sumBucket(buckets, 'noBreachDplus2');
    const totalShred = sumBucket(buckets, 'BreachDplus1') + sumBucket(buckets, 'noBreachDplus1')
      + sumBucket(buckets, 'BreachDplus2') + sumBucket(buckets, 'noBreachDplus2');
    expect(totalShred).toBeCloseTo(totalWound, 9);
  });

  it('Poisoned success does not automatically shred (needs the real roll to also clear X)', () => {
    const { buckets } = resolveAttackProbabilities(needForBS(4), 1, 20, getInnateCriticalX(4), [], [
      { id: 'poisoned', value: 2 },
      { id: 'shred', value: 6 },
    ]);
    const totalWound = sumBucket(buckets, 'BreachDplus0') + sumBucket(buckets, 'BreachDplus1') + sumBucket(buckets, 'BreachDplus2')
      + sumBucket(buckets, 'noBreachDplus0') + sumBucket(buckets, 'noBreachDplus1') + sumBucket(buckets, 'noBreachDplus2');
    const totalShred = sumBucket(buckets, 'BreachDplus1') + sumBucket(buckets, 'noBreachDplus1')
      + sumBucket(buckets, 'BreachDplus2') + sumBucket(buckets, 'noBreachDplus2');
    expect(totalWound).toBeGreaterThan(totalShred);
  });

  it('Breach and Shred can occur independently on the same wound', () => {
    const { buckets } = resolveAttackProbabilities(needForBS(4), 6, 4, getInnateCriticalX(4), [], [
      { id: 'breaching', value: 3 },
      { id: 'shred', value: 3 },
    ]);
    expect(sumBucket(buckets, 'BreachDplus1')).toBeGreaterThan(0);
  });
});

describe('getInnateCriticalX / getEffectiveCriticalThreshold — Critical Hit', () => {
  it('BS <= 5 grants no innate critical', () => {
    for (let bs = 1; bs <= 5; bs++) expect(getInnateCriticalX(bs)).toBeNull();
  });
  it('BS 6-10 grants innate critical at X = 12 - BS', () => {
    expect(getInnateCriticalX(6)).toBe(6);
    expect(getInnateCriticalX(7)).toBe(5);
    expect(getInnateCriticalX(8)).toBe(4);
    expect(getInnateCriticalX(9)).toBe(3);
    expect(getInnateCriticalX(10)).toBe(2);
  });

  it('no innate, no explicit -> null', () => {
    expect(getEffectiveCriticalThreshold(4, [])).toBeNull();
  });
  it('innate only (BS9) -> innate value used', () => {
    expect(getEffectiveCriticalThreshold(9, [])).toBe(3);
  });
  it('explicit only (BS4) -> explicit value used', () => {
    expect(getEffectiveCriticalThreshold(4, [{ id: 'criticalHit', value: 5 }])).toBe(5);
  });
  it('both present, explicit is better -> explicit wins', () => {
    expect(getEffectiveCriticalThreshold(9, [{ id: 'criticalHit', value: 2 }])).toBe(2);
  });
  it('both present, innate is better -> innate wins', () => {
    expect(getEffectiveCriticalThreshold(10, [{ id: 'criticalHit', value: 6 }])).toBe(2);
  });
});

describe('resolveAttackProbabilities — Critical Hit', () => {
  it('BS9 with no explicit rule still gets a Critical Hit tier (innate bonus)', () => {
    const { buckets, pHit } = resolveAttackProbabilities(needForBS(9), 1, 20, getInnateCriticalX(9), [], []); // S/T isolates forced wounds only
    expect(pHit).toBeCloseTo(5 / 6, 9);
    const tier1 = sumBucket(buckets, 'BreachDplus1') + sumBucket(buckets, 'noBreachDplus1');
    expect(tier1).toBeCloseTo(4 / 6, 9); // innate X=3: d=3,4,5,6 all critical
  });

  it('BS10 auto-hit is also automatically a Critical Hit via the innate rule', () => {
    const { buckets, pHit } = resolveAttackProbabilities(needForBS(10), 1, 20, getInnateCriticalX(10), [], []);
    expect(pHit).toBe(1);
    const tier1 = sumBucket(buckets, 'BreachDplus1') + sumBucket(buckets, 'noBreachDplus1');
    expect(tier1).toBeCloseTo(1, 9);
  });

  it('a better explicit Critical Hit rule is used instead of a worse innate one', () => {
    const { buckets } = resolveAttackProbabilities(needForBS(9), 1, 20, getInnateCriticalX(9), [], [{ id: 'criticalHit', value: 2 }]);
    const tier1 = sumBucket(buckets, 'BreachDplus1') + sumBucket(buckets, 'noBreachDplus1');
    expect(tier1).toBeCloseTo(5 / 6, 9);
  });

  it('a worse explicit rule does not override a better innate one', () => {
    const { buckets } = resolveAttackProbabilities(needForBS(10), 1, 20, getInnateCriticalX(10), [], [{ id: 'criticalHit', value: 6 }]);
    const tier1 = sumBucket(buckets, 'BreachDplus1') + sumBucket(buckets, 'noBreachDplus1');
    expect(tier1).toBeCloseTo(1, 9);
  });

  it('BS <= 5 is unaffected by the innate bonus', () => {
    const { pHit } = resolveAttackProbabilities(needForBS(4), 1, 20, getInnateCriticalX(4), [], [{ id: 'criticalHit', value: 4 }]);
    expect(pHit).toBeCloseTo(4 / 6, 9);
  });

  it('X < Y: Rending and Critical Hit produce three distinct hit populations', () => {
    const { buckets, pHit } = resolveAttackProbabilities(needForBS(3), 1, 20, getInnateCriticalX(3), [], [
      { id: 'rending', value: 5 },
      { id: 'criticalHit', value: 6 },
    ]);
    expect(pHit).toBeCloseTo(3 / 6, 9);
    const tier1 = sumBucket(buckets, 'BreachDplus1') + sumBucket(buckets, 'noBreachDplus1');
    expect(tier1).toBeCloseTo(1 / 6, 9); // only d=6 is both rending and critical
  });

  it('Y < X: Rending is fully subsumed by Critical Hit, no separate rending-only population', () => {
    const { buckets, pHit } = resolveAttackProbabilities(needForBS(3), 1, 20, getInnateCriticalX(3), [], [
      { id: 'criticalHit', value: 5 },
      { id: 'rending', value: 6 },
    ]);
    expect(pHit).toBeCloseTo(3 / 6, 9);
    const tier1 = sumBucket(buckets, 'BreachDplus1') + sumBucket(buckets, 'noBreachDplus1');
    const tier0 = sumBucket(buckets, 'BreachDplus0') + sumBucket(buckets, 'noBreachDplus0');
    expect(tier1).toBeCloseTo(2 / 6, 9); // d=5 and d=6 both land in tier 1
    expect(tier0).toBeCloseTo(0, 9);     // no rending-only wounds exist separately
  });
});

describe('resolveAttackProbabilities — Murderous', () => {
  it('a Rending-forced wound is always Murderous, regardless of X', () => {
    const { buckets } = resolveAttackProbabilities(needForBS(4), 1, 20, getInnateCriticalX(4), [], [
      { id: 'rending', value: 4 },
      { id: 'murderous', value: 6 },
    ]);
    const total = sumBucket(buckets, 'BreachDplus0') + sumBucket(buckets, 'noBreachDplus0');
    const totalMurderous = sumBucket(buckets, 'BreachDplus0Murderous') + sumBucket(buckets, 'noBreachDplus0Murderous');
    expect(totalMurderous).toBeCloseTo(total, 9);
  });

  it('with no Murderous rule active, all Murderous buckets are 0', () => {
    const { buckets } = resolveAttackProbabilities(needForBS(4), 4, 4, getInnateCriticalX(4), [], [{ id: 'breaching', value: 3 }]);
    expect(sumBucket(buckets, 'BreachDplus0Murderous')).toBe(0);
    expect(sumBucket(buckets, 'noBreachDplus0Murderous')).toBe(0);
  });

  it('Murderous bucket is always a subset of its parent bucket', () => {
    const { buckets } = resolveAttackProbabilities(needForBS(4), 4, 4, getInnateCriticalX(4), [], [
      { id: 'breaching', value: 3 },
      { id: 'murderous', value: 5 },
    ]);
    expect(sumBucket(buckets, 'BreachDplus0Murderous')).toBeLessThanOrEqual(sumBucket(buckets, 'BreachDplus0') + 1e-9);
    expect(sumBucket(buckets, 'noBreachDplus0Murderous')).toBeLessThanOrEqual(sumBucket(buckets, 'noBreachDplus0') + 1e-9);
  });

  it('matches an independent hand-derived breach/murderous cross-tabulation', () => {
    const bs = 4, S = 4, T = 4;
    const { buckets } = resolveAttackProbabilities(needForBS(bs), S, T, getInnateCriticalX(bs), [], [
      { id: 'breaching', value: 3 },
      { id: 'murderous', value: 5 },
    ]);
    const hitNeed = needForBS(bs), wNeed = needForWound(S, T);
    let handNonMurd = 0, handMurd = 0;
    for (let hd = 1; hd <= 6; hd++) {
      if (hd < hitNeed) continue;
      for (let wd = 1; wd <= 6; wd++) {
        if (wd < wNeed) continue;
        const breach = wd >= 3, murderous = wd >= 5;
        const p = (1 / 36);
        if (murderous) handMurd += p; else handNonMurd += p;
      }
    }
    const totalTier0 = sumBucket(buckets, 'BreachDplus0') + sumBucket(buckets, 'noBreachDplus0');
    const totalTier0Murd = sumBucket(buckets, 'BreachDplus0Murderous') + sumBucket(buckets, 'noBreachDplus0Murderous');
    expect(totalTier0Murd).toBeCloseTo(handMurd, 9);
    expect(totalTier0 - totalTier0Murd).toBeCloseTo(handNonMurd, 9);
  });
});

describe('applyEternalWarrior', () => {
  it('no rule active -> damage unchanged', () => {
    expect(applyEternalWarrior(3, [])).toBe(3);
  });
  it('reduces damage by X', () => {
    expect(applyEternalWarrior(5, [{ id: 'eternalWarrior', value: 2 }])).toBe(3);
  });
  it('never reduces below 1', () => {
    expect(applyEternalWarrior(2, [{ id: 'eternalWarrior', value: 10 }])).toBe(1);
    expect(applyEternalWarrior(1, [{ id: 'eternalWarrior', value: 1 }])).toBe(1);
  });
});

describe('computeModelsRemovedMultiTier — with Eternal Warrior applied to tier damage', () => {
  it('reduces expected kills compared to no reduction', () => {
    const W = 4, targetModels = 3, totalDice = 8;
    const tiers = [{ damage: 2, pUnsaved: 0.2 }, { damage: 3, pUnsaved: 0.15 }];
    const tiersWithEW = [
      { damage: applyEternalWarrior(2, [{ id: 'eternalWarrior', value: 2 }]), pUnsaved: 0.2 },
      { damage: applyEternalWarrior(3, [{ id: 'eternalWarrior', value: 2 }]), pUnsaved: 0.15 },
    ];
    const { distModels: baseline } = computeModelsRemovedMultiTier(totalDice, tiers, W, targetModels);
    const { distModels: reduced } = computeModelsRemovedMultiTier(totalDice, tiersWithEW, W, targetModels);
    expect(mean(reduced)).toBeLessThanOrEqual(mean(baseline));
  });

  it('two tiers collapsing to the same effective damage still sums correctly (order-invariance holds)', () => {
    const W = 4, targetModels = 3, totalDice = 8;
    const strongEW = [{ id: 'eternalWarrior', value: 10 }];
    const tiers = [
      { damage: applyEternalWarrior(2, strongEW), pUnsaved: 0.2 },
      { damage: applyEternalWarrior(3, strongEW), pUnsaved: 0.15 },
    ];
    const { distModels } = computeModelsRemovedMultiTier(totalDice, tiers, W, targetModels);
    const { distModels: singleTierRef } = computeModelsRemovedMultiTier(totalDice, [{ damage: 1, pUnsaved: 0.35 }], W, targetModels);
    for (let k = 0; k <= targetModels; k++) expect(distModels[k]).toBeCloseTo(singleTierRef[k], 9);
  });
});

describe('applyDeflagrateWave — Eternal Warrior never affects its flat Damage-1 wounds', () => {
  it('Deflagrate damage stays 1 regardless of Eternal Warrior value', () => {
    const { branches } = computeModelsRemovedMultiTier(6, [{ damage: 1, pUnsaved: 0.9 }], 1, 2);
    const withoutEW = applyDeflagrateWave(branches, 4, 4, 4, 7, 7, 1, 2, 6, 1, []);
    const withEW = applyDeflagrateWave(branches, 4, 4, 4, 7, 7, 1, 2, 6, 1, [{ id: 'eternalWarrior', value: 5 }]);
    for (let k = 0; k <= 2; k++) expect(withEW.distModels[k]).toBeCloseTo(withoutEW.distModels[k], 9);
  });
});

describe('resolveAttackProbabilities — Legiones Astartes: Iron Hands (-1 Strength to attackers)', () => {
  it('reduces effective Strength by X before computing the wound threshold', () => {
    const withoutIH = resolveAttackProbabilities(needForBS(4), 5, 4, getInnateCriticalX(4), [], [], []);
    const withIH = resolveAttackProbabilities(needForBS(4), 5, 4, getInnateCriticalX(4), [], [], [{ id: 'ironHands', value: 1 }]);
    expect(withoutIH.pWound).toBeCloseTo(4 / 6, 9);  // S5 vs T4: needs 3+
    expect(withIH.pWound).toBeCloseTo(3 / 6, 9);     // effective S4 vs T4: needs 4+
  });

  it('effective Strength is floored at 1, never goes to 0 or negative', () => {
    const r = resolveAttackProbabilities(needForBS(4), 1, 4, getInnateCriticalX(4), [], [], [{ id: 'ironHands', value: 1 }]);
    // effective S = max(1, 1-1) = 1, vs T4: S <= T-3, cannot wound at all
    expect(needForWound(1, 4)).toBeNull();
    expect(r.pWound).toBeCloseTo(0, 9);
  });

  it('does not affect pHit at all (only the wound roll)', () => {
    const withoutIH = resolveAttackProbabilities(needForBS(4), 5, 4, getInnateCriticalX(4), [], [], []);
    const withIH = resolveAttackProbabilities(needForBS(4), 5, 4, getInnateCriticalX(4), [], [], [{ id: 'ironHands', value: 1 }]);
    expect(withIH.pHit).toBeCloseTo(withoutIH.pHit, 9);
  });

  it('with no Iron Hands rule active, Strength is used unmodified', () => {
    const r = resolveAttackProbabilities(needForBS(4), 5, 4, getInnateCriticalX(4), [], [], []);
    expect(r.pWound).toBeCloseTo((7 - needForWound(5, 4)) / 6, 9);
  });
});

describe('resolveAttackProbabilities — Legiones Astartes: Salamanders (wound fails on unmodified 1 or 2)', () => {
  it('raises the effective wound threshold to at least 3+, even if normal stats would allow better', () => {
    const withoutSal = resolveAttackProbabilities(needForBS(4), 6, 4, getInnateCriticalX(4), [], [], []); // S=T+2: needs 2+ normally
    const withSal = resolveAttackProbabilities(needForBS(4), 6, 4, getInnateCriticalX(4), [], [], [{ id: 'salamanders', value: 3 }]);
    expect(withoutSal.pWound).toBeCloseTo(5 / 6, 9); // needs 2+
    expect(withSal.pWound).toBeCloseTo(4 / 6, 9);    // floored at needing 3+
  });

  it('overrides a favourable Poisoned threshold too, since it floors the real wound-die requirement', () => {
    const r = resolveAttackProbabilities(needForBS(4), 1, 20, getInnateCriticalX(4), [], [{ id: 'poisoned', value: 2 }], [{ id: 'salamanders', value: 3 }]);
    // Poisoned(2) alone would give pWound = 5/6, but Salamanders floors the real roll at 3+
    expect(r.pWound).toBeCloseTo(4 / 6, 9);
  });

  it('does not block Rending/Critical-forced wounds (a forced natural 6 always clears the floor)', () => {
    const r = resolveAttackProbabilities(needForBS(4), 1, 20, getInnateCriticalX(4), [], [{ id: 'rending', value: 4 }], [{ id: 'salamanders', value: 3 }]);
    // hitNeed=3 (BS4), Rending(4): d=3 is a normal hit (blocked by Salamanders' floor, S/T makes normal wounds impossible anyway),
    // d=4,5,6 are Rending-forced (always wound, unaffected by the floor)
    expect(r.pWound).toBeCloseTo(0.75, 9);
  });

  it('with no Salamanders rule active, the wound threshold is unaffected', () => {
    const r = resolveAttackProbabilities(needForBS(4), 6, 4, getInnateCriticalX(4), [], [], []);
    expect(r.pWound).toBeCloseTo((7 - needForWound(6, 4)) / 6, 9);
  });

  it('does not affect pHit at all (only the wound roll)', () => {
    const withoutSal = resolveAttackProbabilities(needForBS(4), 6, 4, getInnateCriticalX(4), [], [], []);
    const withSal = resolveAttackProbabilities(needForBS(4), 6, 4, getInnateCriticalX(4), [], [], [{ id: 'salamanders', value: 3 }]);
    expect(withSal.pHit).toBeCloseTo(withoutSal.pHit, 9);
  });
});

describe('resolveAttackProbabilities — Legiones Astartes: Imperial Fists', () => {
  const IF_RULE = { id: 'imperialFists', value: 1, traits: ['auto', 'bolt'] };
  const BOLT_TRAIT = [{ id: 'bolt' }];
  const AUTO_TRAIT = [{ id: 'auto' }];
  const MELEE_TRAIT = [{ id: 'melee' }];

  it('grants +1 (lowers hitNeed by 1) with a qualifying trait and 5+ shots', () => {
    const r = resolveAttackProbabilities(needForBS(4), 4, 4, getInnateCriticalX(4), BOLT_TRAIT, [IF_RULE], [], 5);
    expect(r.pHit).toBeCloseTo(5 / 6, 9); // BS4 needs 3+ normally; IF drops it to 2+
  });

  it('does not apply with fewer than 5 shots in the Fire Group', () => {
    const r = resolveAttackProbabilities(needForBS(4), 4, 4, getInnateCriticalX(4), BOLT_TRAIT, [IF_RULE], [], 4);
    expect(r.pHit).toBeCloseTo(4 / 6, 9);
  });

  it('does not apply if the weapon does not have a qualifying trait', () => {
    const r = resolveAttackProbabilities(needForBS(4), 4, 4, getInnateCriticalX(4), MELEE_TRAIT, [IF_RULE], [], 5);
    expect(r.pHit).toBeCloseTo(4 / 6, 9);
  });

  it('either qualifying trait (Bolt or Auto) works', () => {
    const withAuto = resolveAttackProbabilities(needForBS(4), 4, 4, getInnateCriticalX(4), AUTO_TRAIT, [IF_RULE], [], 5);
    expect(withAuto.pHit).toBeCloseTo(5 / 6, 9);
  });

  it('does not push the hit threshold below 2+ (already-best-possible BS is unaffected)', () => {
    const r = resolveAttackProbabilities(needForBS(9), 4, 4, getInnateCriticalX(9), BOLT_TRAIT, [IF_RULE], [], 5);
    expect(r.pHit).toBeCloseTo(5 / 6, 9); // BS9 already needs only 2+; IF has nothing left to improve
  });

  it('has no effect at all if the Imperial Fists rule is not active', () => {
    const r = resolveAttackProbabilities(needForBS(4), 4, 4, getInnateCriticalX(4), BOLT_TRAIT, [], [], 5);
    expect(r.pHit).toBeCloseTo(4 / 6, 9);
  });

  it('has no effect if activeTraits is empty, even with the rule present and 5+ shots', () => {
    const r = resolveAttackProbabilities(needForBS(4), 4, 4, getInnateCriticalX(4), [], [IF_RULE], [], 5);
    expect(r.pHit).toBeCloseTo(4 / 6, 9);
  });

  it('compounds correctly with Snap Shot\'s harsher hit table', () => {
    const withoutIF = resolveAttackProbabilities(needForBSSnapShot(4), 4, 4, null, BOLT_TRAIT, [], [], 5);
    const withIF = resolveAttackProbabilities(needForBSSnapShot(4), 4, 4, null, BOLT_TRAIT, [IF_RULE], [], 5);
    expect(withoutIF.pHit).toBeCloseTo(2 / 6, 9); // Snap Shot BS4 needs 5+
    expect(withIF.pHit).toBeCloseTo(3 / 6, 9);    // IF drops it to 4+
  });
});

// ============================================================================
// Vehicle shooting phase, special rules
//
// Add these to the existing import list from './combatMath.js'
// (needForBS, needForBSSnapShot and getInnateCriticalX are already imported there):
//   resolveVehicleAttackProbabilities,
//   resolveVehicleFinalOutcomeProbabilities,
//   computeStatusInflictedProbability,
//   computeVehicleHullPointDistribution,
// ============================================================================

describe('resolveVehicleAttackProbabilities — rules that have no effect on Vehicles', () => {
  it('Rending, Poisoned, Breaching, Shred, Murderous and Bypass change nothing', () => {
    const infantryOnly = [
      { id: 'rending', value: 4 },
      { id: 'poisoned', value: 2 },
      { id: 'breaching', value: 3 },
      { id: 'shred', value: 3 },
      { id: 'murderous', value: 3 },
      { id: 'bypass', value: 3 },
    ];
    const without = resolveVehicleAttackProbabilities(3, 7, 12, null, [], [], 0);
    const withThem = resolveVehicleAttackProbabilities(3, 7, 12, null, [], infantryOnly, 0);
    expect(withThem).toEqual(without);
  });
});

describe('resolveVehicleAttackProbabilities — Critical Hit', () => {
  it('still lowers the hit threshold as normal', () => {
    const without = resolveVehicleAttackProbabilities(4, 12, 10, null, [], [], 0);
    const withCrit = resolveVehicleAttackProbabilities(4, 12, 10, null, [], [{ id: 'criticalHit', value: 3 }], 0);
    expect(without.pHit).toBeCloseTo(3 / 6, 9);
    expect(withCrit.pHit).toBeCloseTo(4 / 6, 9);
  });

  it('never auto-wounds: a Critical Hit still has to pass the Armour Penetration test', () => {
    const r = resolveVehicleAttackProbabilities(3, 4, 14, null, [], [{ id: 'criticalHit', value: 2 }], 0); // S + 6 < AV
    expect(r.pHit).toBeCloseTo(5 / 6, 9);
    expect(r.pGlance).toBe(0);
    expect(r.pPenetrateNormal).toBe(0);
    expect(r.pPenetrateCritical).toBe(0);
  });

  it('only Penetrating Hits carry the critical share; Glancing is unaffected', () => {
    const without = resolveVehicleAttackProbabilities(3, 7, 12, null, [], [], 0);
    const withCrit = resolveVehicleAttackProbabilities(3, 7, 12, null, [], [{ id: 'criticalHit', value: 5 }], 0);
    expect(withCrit.pGlance).toBeCloseTo(without.pGlance, 9);
    expect(withCrit.pPenetrateNormal + withCrit.pPenetrateCritical).toBeCloseTo(without.pPenetrateNormal, 9);
    expect(withCrit.pPenetrateCritical).toBeCloseTo((2 / 6) * (1 / 6), 9); // hit dice 5 and 6 are critical
  });

  it('uses the better of the innate (BS-derived) and explicit thresholds', () => {
    // BS9: hits on 2+, innate Critical Hit on 3+. The explicit 5+ is worse, so 3+ applies.
    const r = resolveVehicleAttackProbabilities(
      needForBS(9), 12, 10, getInnateCriticalX(9), [], [{ id: 'criticalHit', value: 5 }], 0
    );
    expect(r.pHit).toBeCloseTo(5 / 6, 9);
    expect(r.pPenetrateCritical).toBeCloseTo((4 / 6) * (5 / 6), 9); // hit dice 3,4,5,6
    expect(r.pPenetrateNormal).toBeCloseTo((1 / 6) * (5 / 6), 9);   // hit die 2
  });

  it('an automatic hit with an innate Critical Hit makes every hit critical', () => {
    const r = resolveVehicleAttackProbabilities(null, 12, 10, 2, [], [], 0);
    expect(r.pPenetrateNormal).toBe(0);
    expect(r.pPenetrateCritical).toBeCloseTo(5 / 6, 9);
  });
});

describe('resolveVehicleAttackProbabilities — Legiones Astartes: Imperial Fists', () => {
  const IF_RULE = { id: 'imperialFists', value: 1, traits: ['bolt'] };
  const BOLT = [{ id: 'bolt' }];
  const hit = (hitNeed, traits, shots) =>
    resolveVehicleAttackProbabilities(hitNeed, 12, 10, null, traits, [IF_RULE], shots).pHit;

  it('grants +1 to hit with a qualifying trait and 5+ shots', () => {
    expect(hit(3, BOLT, 5)).toBeCloseTo(5 / 6, 9);
  });
  it('does nothing below 5 shots', () => {
    expect(hit(3, BOLT, 4)).toBeCloseTo(4 / 6, 9);
  });
  it('needs a qualifying trait', () => {
    expect(hit(3, [{ id: 'melee' }], 5)).toBeCloseTo(4 / 6, 9);
    expect(hit(3, [], 5)).toBeCloseTo(4 / 6, 9);
  });
  it('cannot improve a threshold that is already 2+, or rescue an Automatic Fail', () => {
    expect(hit(2, BOLT, 5)).toBeCloseTo(5 / 6, 9);
    expect(hit(7, BOLT, 5)).toBe(0);
  });
  it('compounds with Snap Shots (5+ becomes 4+)', () => {
    expect(hit(needForBSSnapShot(4), BOLT, 5)).toBeCloseTo(3 / 6, 9);
  });
});

describe('resolveVehicleAttackProbabilities — Armourbane', () => {
  const ARMOURBANE = [{ id: 'armourbane', value: 1 }];
  // hitNeed = null makes every attack an automatic hit, isolating the Armour Penetration test itself.
  const ap = (S, AV, rules = []) => resolveVehicleAttackProbabilities(null, S, AV, null, [], rules, 0);


  it('never inflicts a Glancing Hit, whatever the Strength and Armour Value', () => {
    for (let S = 1; S <= 20; S++) {
      for (let AV = 10; AV <= 15; AV++) expect(ap(S, AV, ARMOURBANE).pGlance).toBe(0);
    }
  });

  it('turns the one roll that would have Glanced (S + D6 = AV) into a Penetrating Hit', () => {
    const without = ap(7, 12, []);
    const withAB = ap(7, 12, ARMOURBANE);
    expect(without.pGlance).toBeCloseTo(1 / 6, 9);
    expect(without.pPenetrateNormal).toBeCloseTo(1 / 6, 9);
    expect(withAB.pGlance).toBe(0);
    expect(withAB.pPenetrateNormal).toBeCloseTo(2 / 6, 9);
  });

  it('matches a die-by-die enumeration (natural 1 always fails; reaching AV or more penetrates)', () => {
    for (let S = 1; S <= 20; S++) {
      for (let AV = 1; AV <= 20; AV++) {
        let expected = 0;
        for (let d = 2; d <= 6; d++) if (S + d >= AV) expected += 1 / 6;
        expect(ap(S, AV, ARMOURBANE).pPenetrateNormal).toBeCloseTo(expected, 9);
      }
    }
  });

  it('can penetrate when S + 6 exactly equals AV, which without Armourbane could only Glance', () => {
    expect(ap(6, 12, []).pPenetrateNormal).toBe(0);
    expect(ap(6, 12, ARMOURBANE).pPenetrateNormal).toBeCloseTo(1 / 6, 9);
  });

  it('does not let a weapon that cannot reach AV hurt it', () => {
    const r = ap(4, 14, ARMOURBANE); // S + 6 = 10 < 14
    expect(r.pGlance).toBe(0);
    expect(r.pPenetrateNormal).toBe(0);
  });

  it('a natural 1 still always fails, even when S + 1 would reach AV', () => {
    expect(ap(11, 12, ARMOURBANE).pPenetrateNormal).toBeCloseTo(5 / 6, 9); // S + 1 = AV
    expect(ap(12, 10, ARMOURBANE).pPenetrateNormal).toBeCloseTo(5 / 6, 9); // S + 1 > AV
  });

  it('creates and loses nothing: damaging hits equal the old Glances plus Penetrates', () => {
    for (let S = 1; S <= 20; S++) {
      for (let AV = 10; AV <= 15; AV++) {
        const before = ap(S, AV, []);
        const after = ap(S, AV, ARMOURBANE);
        expect(after.pPenetrateNormal).toBeCloseTo(before.pGlance + before.pPenetrateNormal, 9);
      }
    }
  });

  it("applies Critical Hit's +1 Damage to an upgraded hit, since it is a Penetrating Hit", () => {
    const crit = [{ id: 'criticalHit', value: 5 }];
    const before = resolveVehicleAttackProbabilities(3, 7, 12, null, [], crit, 0);
    const after = resolveVehicleAttackProbabilities(3, 7, 12, null, [], [...crit, ...ARMOURBANE], 0);
    const beforeTotal = before.pPenetrateNormal + before.pPenetrateCritical;
    const afterTotal = after.pPenetrateNormal + after.pPenetrateCritical;
    expect(afterTotal).toBeCloseTo(beforeTotal + before.pGlance, 9);
    // the critical share of hits is unchanged, so the same share of upgraded hits is critical
    expect(after.pPenetrateCritical / afterTotal).toBeCloseTo(before.pPenetrateCritical / beforeTotal, 9);
  });

  it('with no Armourbane rule active, behaviour is unchanged (regression)', () => {
    const r = ap(7, 12, []);
    expect(r.pGlance).toBeCloseTo(1 / 6, 9);
    expect(r.pPenetrateNormal).toBeCloseTo(1 / 6, 9);
  });

  it('leaves no Glancing Hits to roll on the Damage Table, so no Status can be inflicted', () => {
    const r = resolveVehicleAttackProbabilities(3, 7, 12, null, [], ARMOURBANE, 0);
    const out = resolveVehicleFinalOutcomeProbabilities(r.pGlance, r.pPenetrateNormal, r.pPenetrateCritical, 7, 7, 1);
    const status = computeStatusInflictedProbability(10, out.pGlanceUnsaved);
    expect(status.stunned).toBe(0);
    expect(status.pinned).toBe(0);
    expect(status.suppressed).toBe(0);
  });
});

describe('resolveVehicleAttackProbabilities — Shock (X)', () => {
  const shock = (status) => [{ id: 'shock', value: status }];
  // chance per die that Shock fires, against S7 vs AV12 (the Armour Penetration test is irrelevant to the trigger)
  const trigger = (hitNeed, rules = shock('Stunned'), traits = [], shots = 0) =>
    resolveVehicleAttackProbabilities(hitNeed, 7, 12, null, traits, rules, shots).shock.pTrigger;

  it('is inactive without the rule: no status and no trigger', () => {
    expect(resolveVehicleAttackProbabilities(3, 7, 12, null, [], [], 0).shock).toBe(null);
  });

  it('triggers on a HIT whose unmodified roll was a 5 or 6: two faces in six whenever the Hit Test needs 5+ or better', () => {
    for (const need of [2, 3, 4, 5]) expect(trigger(need)).toBeCloseTo(2 / 6, 9);
  });

  it('only a 6 triggers it when the Hit Test needs 6+', () => {
    expect(trigger(6)).toBeCloseTo(1 / 6, 9);
  });

  it('a natural 5 on a FAILED Hit Test does not trigger it — the trigger needs a Hit', () => {
    // BS1 needs 6+, so a 5 misses. This documents the reading adopted: Shock fires on hits.
    expect(trigger(needForBS(1))).toBeCloseTo(1 / 6, 9);
  });

  it('Snap Shots: BS2-3 need 6+ so only a 6 triggers; BS1 is an Automatic Fail and never does', () => {
    expect(trigger(needForBSSnapShot(2))).toBeCloseTo(1 / 6, 9);
    expect(trigger(needForBSSnapShot(3))).toBeCloseTo(1 / 6, 9);
    expect(trigger(needForBSSnapShot(1))).toBe(0);
  });

  it('an automatic hit (BS10) always triggers it', () => {
    expect(trigger(null)).toBe(1);
  });

  it('Imperial Fists can turn a natural 5 into a Hit, which then triggers it', () => {
    const IF_RULE = { id: 'imperialFists', value: 1, traits: ['bolt'] };
    expect(trigger(6, [IF_RULE, ...shock('Stunned')], [{ id: 'bolt' }], 5)).toBeCloseTo(2 / 6, 9); // 6+ becomes 5+
    expect(trigger(6, [IF_RULE, ...shock('Stunned')], [{ id: 'bolt' }], 4)).toBeCloseTo(1 / 6, 9); // under 5 shots: no bonus
  });

  it('Critical Hit lowering the hit threshold can do the same', () => {
    expect(trigger(6, [...shock('Stunned'), { id: 'criticalHit', value: 5 }])).toBeCloseTo(2 / 6, 9);
  });

  it('a modifier can never turn a 4 into a trigger: it is the UNMODIFIED roll that counts', () => {
    // Critical Hit at 4+ makes a natural 4 a hit, but a hit on a 4 is still not a 5 or 6
    expect(trigger(6, [...shock('Stunned'), { id: 'criticalHit', value: 4 }])).toBeCloseTo(2 / 6, 9);
  });

  it('accepts the status in any letter case and reports it in lower case', () => {
    for (const [given, reported] of [['Pinned', 'pinned'], ['SUPPRESSED', 'suppressed'], ['stunned', 'stunned']]) {
      expect(resolveVehicleAttackProbabilities(3, 7, 12, null, [], shock(given), 0).shock.status).toBe(reported);
    }
  });

  it('ignores a value that is not a Vehicle status', () => {
    expect(resolveVehicleAttackProbabilities(3, 7, 12, null, [], [{ id: 'shock', value: 4 }], 0).shock).toBe(null);
    expect(resolveVehicleAttackProbabilities(3, 7, 12, null, [], shock('Burning'), 0).shock).toBe(null);
  });

  it('never changes whether hits land or how the Armour Penetration test goes — hits are not discarded', () => {
    const without = resolveVehicleAttackProbabilities(3, 7, 12, null, [], [], 0);
    const withShock = resolveVehicleAttackProbabilities(3, 7, 12, null, [], shock('Stunned'), 0);
    expect(withShock.pHit).toBe(without.pHit);
    expect(withShock.pGlance).toBe(without.pGlance);
    expect(withShock.pPenetrateNormal).toBe(without.pPenetrateNormal);
    expect(withShock.pPenetrateCritical).toBe(without.pPenetrateCritical);
  });

  it('can never fire more often than the chance to hit', () => {
    for (const need of [2, 3, 4, 5, 6, 7]) {
      const r = resolveVehicleAttackProbabilities(need, 7, 12, null, [], shock('Stunned'), 0);
      expect(r.shock.pTrigger).toBeLessThanOrEqual(r.pHit + 1e-12);
    }
  });
});

describe('vehicle shooting — Shock (X) end to end', () => {
  const SHOCK = (status) => [{ id: 'shock', value: status }];
  const STATUSES = ['stunned', 'pinned', 'suppressed'];

  const run = ({ hitNeed, S, AV, invuln = 7, cover = 7, mitFail = 1, dice, dmg = 2, hp = 4, rules }) => {
    const atk = resolveVehicleAttackProbabilities(hitNeed, S, AV, null, [], rules, dice);
    const out = resolveVehicleFinalOutcomeProbabilities(atk.pGlance, atk.pPenetrateNormal, atk.pPenetrateCritical, invuln, cover, mitFail);
    return {
      hull: computeVehicleHullPointDistribution(dice, out.pGlanceUnsaved, out.pPenetrateNormalUnsaved, out.pPenetrateCriticalUnsaved, dmg, hp),
      status: computeStatusInflictedProbability(dice, out.pGlanceUnsaved, atk.shock),
    };
  };

  // Independent oracle built from the dice themselves: the chance, for ONE attacking die, that
  // `status` ends up inflicted — by Shock, or by an unsaved Glancing Hit that rolls it.
  function perDieChance({ hitNeed, S, AV, unsavedFactor, shockStatus, status }) {
    const statusOf = (roll) => (roll <= 2 ? 'stunned' : roll <= 4 ? 'pinned' : 'suppressed');
    let q = 0;
    for (let hitDie = 1; hitDie <= 6; hitDie++) {
      if (hitDie === 1 || hitDie < hitNeed) continue;                    // a natural 1 always misses
      if (shockStatus === status && hitDie >= 5) { q += 1 / 6; continue; } // Shock: unmodified 5 or 6 on a hit
      for (let penDie = 2; penDie <= 6; penDie++) {                      // a natural 1 always fails
        if (S + penDie !== AV) continue;                                 // only an exact match Glances
        for (let tableRoll = 1; tableRoll <= 6; tableRoll++) {
          if (statusOf(tableRoll) === status) q += (1 / 6) * (1 / 6) * (1 / 6) * unsavedFactor;
        }
      }
    }
    return q;
  }

  it('never changes Hull Point loss — Shock never costs a Hull Point', () => {
    const without = run({ hitNeed: 3, S: 7, AV: 12, dice: 6, rules: [] });
    for (const status of ['Stunned', 'Pinned', 'Suppressed']) {
      const withShock = run({ hitNeed: 3, S: 7, AV: 12, dice: 6, rules: SHOCK(status) });
      for (let k = 0; k < without.hull.length; k++) expect(withShock.hull[k]).toBeCloseTo(without.hull[k], 9);
    }
  });

  it('matches an independent die-by-die enumeration, for every Shock status and every status reported', () => {
    const cases = [
      { hitNeed: 3, S: 7, AV: 12, dice: 5 },
      { hitNeed: 5, S: 7, AV: 10, dice: 4, invuln: 4 },
      { hitNeed: 6, S: 6, AV: 12, dice: 3, cover: 5 },
      { hitNeed: 2, S: 9, AV: 11, dice: 6 },
    ];
    for (const c of cases) {
      const best = Math.min(c.invuln ?? 7, c.cover ?? 7);
      const unsavedFactor = best >= 7 ? 1 : 1 - (7 - best) / 6;
      for (const shocked of STATUSES) {
        const r = run({ ...c, rules: SHOCK(shocked) });
        for (const status of STATUSES) {
          const q = perDieChance({ ...c, unsavedFactor, shockStatus: shocked, status });
          expect(r.status[status]).toBeCloseTo(1 - Math.pow(1 - q, c.dice), 9);
        }
      }
    }
  });

  it('hand-derived: a weapon that cannot hurt the vehicle still inflicts the Shock status', () => {
    const one = run({ hitNeed: needForBS(4), S: 4, AV: 15, dice: 1, rules: SHOCK('Pinned') });
    expect(one.status.pinned).toBeCloseTo(1 / 3, 9);
    expect(one.status.stunned).toBe(0);
    expect(one.status.suppressed).toBe(0);
    const two = run({ hitNeed: needForBS(4), S: 4, AV: 15, dice: 2, rules: SHOCK('Pinned') });
    expect(two.status.pinned).toBeCloseTo(5 / 9, 9);
  });

  it('hand-derived with Glancing Hits: BS4, S7 vs AV12, Shock (Stunned), one die', () => {
    const r = run({ hitNeed: needForBS(4), S: 7, AV: 12, dice: 1, rules: SHOCK('Stunned') });
    expect(r.status.stunned).toBeCloseTo(19 / 54, 9); // 1/3 + (1/3)(1/6)(1/3): a hit can be both, counted once
    expect(r.status.pinned).toBeCloseTo(1 / 27, 9);   // Glancing Hits alone
  });

  it('saves and Damage Mitigation cannot stop a Shock status', () => {
    const r = run({ hitNeed: needForBS(4), S: 4, AV: 15, dice: 1, invuln: 2, cover: 2, mitFail: 0, rules: SHOCK('Stunned') });
    expect(r.status.stunned).toBeCloseTo(1 / 3, 9);
  });

  it('Armourbane removes the Glancing route to a status but not the Shock route', () => {
    const r = run({ hitNeed: needForBS(4), S: 7, AV: 12, dice: 1, rules: [...SHOCK('Pinned'), { id: 'armourbane', value: 1 }] });
    expect(r.status.pinned).toBeCloseTo(1 / 3, 9);
    expect(r.status.stunned).toBe(0);
  });
});