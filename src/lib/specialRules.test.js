import { describe, it, expect } from 'vitest';
import {
  needForBS,
  needForWound,
  pFromNeed,
  resolveAttackProbabilities,
  getInnateCriticalX,
  getEffectiveCriticalThreshold,
  applyEternalWarrior,
  applyDeflagrateWave,
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
    const r = resolveAttackProbabilities(4, 4, 4, false, [], []);
    expect(r.pHit).toBeCloseTo(pFromNeed(needForBS(4)), 9);
    expect(r.pWound).toBeCloseTo((7 - needForWound(4, 4)) / 6, 9);
  });

  it('BS10 + rending: always hits and always wounds', () => {
    const r = resolveAttackProbabilities(10, 1, 10, false, [], [{ id: 'rending', value: 4 }]);
    expect(r.pHit).toBe(1);
    expect(r.pWound).toBe(1);
  });

  it('rendingX <= hitNeed: every hit auto-wounds', () => {
    const r = resolveAttackProbabilities(3, 1, 10, false, [], [{ id: 'rending', value: 3 }]);
    expect(r.pHit).toBeCloseTo(4 / 6, 9);
    expect(r.pWound).toBeCloseTo(1, 9);
  });

  it('unknown rule ids are ignored rather than throwing', () => {
    const r = resolveAttackProbabilities(4, 4, 4, false, [], [{ id: 'notARealRule', value: 99 }]);
    expect(r.pHit).toBeCloseTo(pFromNeed(needForBS(4)), 9);
  });
});

describe('resolveAttackProbabilities — Poisoned', () => {
  it('poison threshold worse than the normal wound chance: normal chance wins', () => {
    const r = resolveAttackProbabilities(4, 6, 4, false, [], [{ id: 'poisoned', value: 6 }]);
    const expectedPWound = (7 - needForWound(6, 4)) / 6;
    expect(r.pWound).toBeCloseTo(expectedPWound, 9);
  });

  it('poison threshold better than the normal wound chance: poison wins', () => {
    const r = resolveAttackProbabilities(4, 1, 10, false, [], [{ id: 'poisoned', value: 4 }]);
    expect(r.pWound).toBeCloseTo(0.5, 9);
  });

  it('poison rescues an otherwise-impossible wound roll (wNeed is null)', () => {
    const r = resolveAttackProbabilities(4, 1, 20, false, [], [{ id: 'poisoned', value: 2 }]);
    expect(needForWound(1, 20)).toBeNull();
    expect(r.pWound).toBeCloseTo(5 / 6, 9);
  });

  it('matching thresholds: no change either way', () => {
    const r = resolveAttackProbabilities(4, 4, 4, false, [], [{ id: 'poisoned', value: 4 }]);
    expect(r.pWound).toBeCloseTo(0.5, 9);
  });

  it('poison never affects pHit', () => {
    const withoutPoison = resolveAttackProbabilities(4, 4, 4, false, [], []);
    const withPoison = resolveAttackProbabilities(4, 4, 4, false, [], [{ id: 'poisoned', value: 2 }]);
    expect(withPoison.pHit).toBeCloseTo(withoutPoison.pHit, 9);
  });

  it('pWound never exceeds 1, even with a very favourable poison threshold', () => {
    const r = resolveAttackProbabilities(4, 8, 1, false, [], [{ id: 'poisoned', value: 2 }]);
    expect(r.pWound).toBeLessThanOrEqual(1);
    expect(r.pWound).toBeCloseTo(5 / 6, 9);
  });

  it('BS10\'s auto-wound comes from the innate Critical Hit granted by high BS, not from Poisoned itself', () => {
    // BS10 innately grants Critical Hit(2) (see getInnateCriticalX), which alone
    // is enough to force every hit to auto-wound -- independent of Poisoned's
    // own threshold. Comparing with/without Poisoned shows Poisoned isn't what's
    // driving the result.
    const withoutPoison = resolveAttackProbabilities(10, 1, 20, false, [], []);
    const withWeakPoison = resolveAttackProbabilities(10, 1, 20, false, [], [{ id: 'poisoned', value: 6 }]);
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
    const { buckets } = resolveAttackProbabilities(bs, S, T, false, [], [{ id: 'breaching', value: X }]);
    const totalWoundProb = buckets.BreachDplus0 + buckets.BreachDplus1 + buckets.BreachDplus2
      + buckets.noBreachDplus0 + buckets.noBreachDplus1 + buckets.noBreachDplus2;
    const totalBreachProb = buckets.BreachDplus0 + buckets.BreachDplus1 + buckets.BreachDplus2;
    expect(totalWoundProb).toBeCloseTo(totalWound / 36, 9);
    expect(totalBreachProb).toBeCloseTo(totalBreach / 36, 9);
  });

  it('a Rending-forced wound always breaches, regardless of X', () => {
    const { buckets } = resolveAttackProbabilities(4, 1, 20, false, [], [
      { id: 'rending', value: 4 },
      { id: 'breaching', value: 6 },
    ]);
    const totalWound = buckets.BreachDplus0 + buckets.BreachDplus1 + buckets.BreachDplus2
      + buckets.noBreachDplus0 + buckets.noBreachDplus1 + buckets.noBreachDplus2;
    const totalBreach = buckets.BreachDplus0 + buckets.BreachDplus1 + buckets.BreachDplus2;
    expect(totalBreach).toBeCloseTo(totalWound, 9); // every wound is a breach
  });

  it('Poisoned success does not automatically breach (needs the real roll to also clear X)', () => {
    // Note: buckets hold ABSOLUTE probabilities (they already include pHit),
    // so expected values here are computed over all 36 (hit-die, wound-die)
    // combinations, not conditional on a hit -- same basis as the sibling
    // brute-force test above.
    const r = resolveAttackProbabilities(4, 1, 20, false, [], [
      { id: 'poisoned', value: 2 },
      { id: 'breaching', value: 6 },
    ]);
    const { buckets } = r;
    const totalWound = buckets.BreachDplus0 + buckets.BreachDplus1 + buckets.BreachDplus2
      + buckets.noBreachDplus0 + buckets.noBreachDplus1 + buckets.noBreachDplus2;
    const totalBreach = buckets.BreachDplus0 + buckets.BreachDplus1 + buckets.BreachDplus2;
    expect(totalWound).toBeCloseTo(5 / 9, 9);  // 4 hitting dice x 5 wounding dice (>=2), out of 36
    expect(totalBreach).toBeCloseTo(1 / 9, 9); // 4 hitting dice x 1 breaching die (=6), out of 36
    expect(r.pWound).toBeCloseTo(5 / 6, 9);    // the conditional-on-hit view, for comparison
  });

  it('with no Breaching rule, every wound falls in the non-breach buckets', () => {
    const { buckets } = resolveAttackProbabilities(4, 4, 4, false, [], [{ id: 'rending', value: 5 }]);
    const totalBreach = buckets.BreachDplus0 + buckets.BreachDplus1 + buckets.BreachDplus2;
    expect(totalBreach).toBeCloseTo(0, 9);
  });
});

describe('resolveAttackProbabilities — Shred', () => {
  it('a Rending-forced wound always triggers Shred, regardless of X', () => {
    const { buckets } = resolveAttackProbabilities(4, 1, 20, false, [], [
      { id: 'rending', value: 4 },
      { id: 'shred', value: 6 },
    ]);
    const totalWound = buckets.BreachDplus0 + buckets.BreachDplus1 + buckets.BreachDplus2
      + buckets.noBreachDplus0 + buckets.noBreachDplus1 + buckets.noBreachDplus2;
    const totalShred = buckets.BreachDplus1 + buckets.noBreachDplus1
      + buckets.BreachDplus2 + buckets.noBreachDplus2;
    expect(totalShred).toBeCloseTo(totalWound, 9);
  });

  it('Poisoned success does not automatically shred (needs the real roll to also clear X)', () => {
    const { buckets } = resolveAttackProbabilities(4, 1, 20, false, [], [
      { id: 'poisoned', value: 2 },
      { id: 'shred', value: 6 },
    ]);
    const totalWound = buckets.BreachDplus0 + buckets.BreachDplus1 + buckets.BreachDplus2
      + buckets.noBreachDplus0 + buckets.noBreachDplus1 + buckets.noBreachDplus2;
    const totalShred = buckets.BreachDplus1 + buckets.noBreachDplus1
      + buckets.BreachDplus2 + buckets.noBreachDplus2;
    expect(totalWound).toBeGreaterThan(totalShred);
  });

  it('Breach and Shred can occur independently on the same wound', () => {
    const { buckets } = resolveAttackProbabilities(4, 6, 4, false, [], [
      { id: 'breaching', value: 3 },
      { id: 'shred', value: 3 },
    ]);
    expect(buckets.BreachDplus1).toBeGreaterThan(0);
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
    const { buckets, pHit } = resolveAttackProbabilities(9, 1, 20, false, [], []); // S/T isolates forced wounds only
    expect(pHit).toBeCloseTo(5 / 6, 9);
    const tier1 = buckets.BreachDplus1 + buckets.noBreachDplus1;
    expect(tier1).toBeCloseTo(4 / 6, 9); // innate X=3: d=3,4,5,6 all critical
  });

  it('BS10 auto-hit is also automatically a Critical Hit via the innate rule', () => {
    const { buckets, pHit } = resolveAttackProbabilities(10, 1, 20, false, [], []);
    expect(pHit).toBe(1);
    const tier1 = buckets.BreachDplus1 + buckets.noBreachDplus1;
    expect(tier1).toBeCloseTo(1, 9);
  });

  it('a better explicit Critical Hit rule is used instead of a worse innate one', () => {
    const { buckets } = resolveAttackProbabilities(9, 1, 20, false, [], [{ id: 'criticalHit', value: 2 }]);
    const tier1 = buckets.BreachDplus1 + buckets.noBreachDplus1;
    expect(tier1).toBeCloseTo(5 / 6, 9);
  });

  it('a worse explicit rule does not override a better innate one', () => {
    const { buckets } = resolveAttackProbabilities(10, 1, 20, false, [], [{ id: 'criticalHit', value: 6 }]);
    const tier1 = buckets.BreachDplus1 + buckets.noBreachDplus1;
    expect(tier1).toBeCloseTo(1, 9);
  });

  it('BS <= 5 is unaffected by the innate bonus', () => {
    const { pHit } = resolveAttackProbabilities(4, 1, 20, false, [], [{ id: 'criticalHit', value: 4 }]);
    expect(pHit).toBeCloseTo(4 / 6, 9);
  });

  it('X < Y: Rending and Critical Hit produce three distinct hit populations', () => {
    const { buckets, pHit } = resolveAttackProbabilities(3, 1, 20, false, [], [
      { id: 'rending', value: 5 },
      { id: 'criticalHit', value: 6 },
    ]);
    expect(pHit).toBeCloseTo(3 / 6, 9);
    const tier1 = buckets.BreachDplus1 + buckets.noBreachDplus1;
    expect(tier1).toBeCloseTo(1 / 6, 9); // only d=6 is both rending and critical
  });

  it('Y < X: Rending is fully subsumed by Critical Hit, no separate rending-only population', () => {
    const { buckets, pHit } = resolveAttackProbabilities(3, 1, 20, false, [], [
      { id: 'criticalHit', value: 5 },
      { id: 'rending', value: 6 },
    ]);
    expect(pHit).toBeCloseTo(3 / 6, 9);
    const tier1 = buckets.BreachDplus1 + buckets.noBreachDplus1;
    const tier0 = buckets.BreachDplus0 + buckets.noBreachDplus0;
    expect(tier1).toBeCloseTo(2 / 6, 9); // d=5 and d=6 both land in tier 1
    expect(tier0).toBeCloseTo(0, 9);     // no rending-only wounds exist separately
  });
});

describe('resolveAttackProbabilities — Murderous', () => {
  it('a Rending-forced wound is always Murderous, regardless of X', () => {
    const { buckets } = resolveAttackProbabilities(4, 1, 20, false, [], [
      { id: 'rending', value: 4 },
      { id: 'murderous', value: 6 },
    ]);
    const total = buckets.BreachDplus0 + buckets.noBreachDplus0;
    const totalMurderous = buckets.BreachDplus0Murderous + buckets.noBreachDplus0Murderous;
    expect(totalMurderous).toBeCloseTo(total, 9);
  });

  it('with no Murderous rule active, all Murderous buckets are 0', () => {
    const { buckets } = resolveAttackProbabilities(4, 4, 4, false, [], [{ id: 'breaching', value: 3 }]);
    expect(buckets.BreachDplus0Murderous).toBe(0);
    expect(buckets.noBreachDplus0Murderous).toBe(0);
  });

  it('Murderous bucket is always a subset of its parent bucket', () => {
    const { buckets } = resolveAttackProbabilities(4, 4, 4, false, [], [
      { id: 'breaching', value: 3 },
      { id: 'murderous', value: 5 },
    ]);
    expect(buckets.BreachDplus0Murderous).toBeLessThanOrEqual(buckets.BreachDplus0 + 1e-9);
    expect(buckets.noBreachDplus0Murderous).toBeLessThanOrEqual(buckets.noBreachDplus0 + 1e-9);
  });

  it('matches an independent hand-derived breach/murderous cross-tabulation', () => {
    const bs = 4, S = 4, T = 4;
    const { buckets } = resolveAttackProbabilities(bs, S, T, false, [], [
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
    const totalTier0 = buckets.BreachDplus0 + buckets.noBreachDplus0;
    const totalTier0Murd = buckets.BreachDplus0Murderous + buckets.noBreachDplus0Murderous;
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
    const withoutIH = resolveAttackProbabilities(4, 5, 4, false, [], [], []);
    const withIH = resolveAttackProbabilities(4, 5, 4, false, [], [], [{ id: 'ironHands', value: 1 }]);
    expect(withoutIH.pWound).toBeCloseTo(4 / 6, 9);  // S5 vs T4: needs 3+
    expect(withIH.pWound).toBeCloseTo(3 / 6, 9);     // effective S4 vs T4: needs 4+
  });

  it('effective Strength is floored at 1, never goes to 0 or negative', () => {
    const r = resolveAttackProbabilities(4, 1, 4, false, [], [], [{ id: 'ironHands', value: 1 }]);
    // effective S = max(1, 1-1) = 1, vs T4: S <= T-3, cannot wound at all
    expect(needForWound(1, 4)).toBeNull();
    expect(r.pWound).toBeCloseTo(0, 9);
  });

  it('does not affect pHit at all (only the wound roll)', () => {
    const withoutIH = resolveAttackProbabilities(4, 5, 4, false, [], [], []);
    const withIH = resolveAttackProbabilities(4, 5, 4, false, [], [], [{ id: 'ironHands', value: 1 }]);
    expect(withIH.pHit).toBeCloseTo(withoutIH.pHit, 9);
  });

  it('with no Iron Hands rule active, Strength is used unmodified', () => {
    const r = resolveAttackProbabilities(4, 5, 4, false, [], [], []);
    expect(r.pWound).toBeCloseTo((7 - needForWound(5, 4)) / 6, 9);
  });
});

describe('resolveAttackProbabilities — Legiones Astartes: Salamanders (wound fails on unmodified 1 or 2)', () => {
  it('raises the effective wound threshold to at least 3+, even if normal stats would allow better', () => {
    const withoutSal = resolveAttackProbabilities(4, 6, 4, false, [], [], []); // S=T+2: needs 2+ normally
    const withSal = resolveAttackProbabilities(4, 6, 4, false, [], [], [{ id: 'salamanders', value: 3 }]);
    expect(withoutSal.pWound).toBeCloseTo(5 / 6, 9); // needs 2+
    expect(withSal.pWound).toBeCloseTo(4 / 6, 9);    // floored at needing 3+
  });

  it('overrides a favourable Poisoned threshold too, since it floors the real wound-die requirement', () => {
    const r = resolveAttackProbabilities(4, 1, 20, false, [], [{ id: 'poisoned', value: 2 }], [{ id: 'salamanders', value: 3 }]);
    // Poisoned(2) alone would give pWound = 5/6, but Salamanders floors the real roll at 3+
    expect(r.pWound).toBeCloseTo(4 / 6, 9);
  });

  it('does not block Rending/Critical-forced wounds (a forced natural 6 always clears the floor)', () => {
    const r = resolveAttackProbabilities(4, 1, 20, false, [], [{ id: 'rending', value: 4 }], [{ id: 'salamanders', value: 3 }]);
    // hitNeed=3 (BS4), Rending(4): d=3 is a normal hit (blocked by Salamanders' floor, S/T makes normal wounds impossible anyway),
    // d=4,5,6 are Rending-forced (always wound, unaffected by the floor)
    expect(r.pWound).toBeCloseTo(0.75, 9);
  });

  it('with no Salamanders rule active, the wound threshold is unaffected', () => {
    const r = resolveAttackProbabilities(4, 6, 4, false, [], [], []);
    expect(r.pWound).toBeCloseTo((7 - needForWound(6, 4)) / 6, 9);
  });

  it('does not affect pHit at all (only the wound roll)', () => {
    const withoutSal = resolveAttackProbabilities(4, 6, 4, false, [], [], []);
    const withSal = resolveAttackProbabilities(4, 6, 4, false, [], [], [{ id: 'salamanders', value: 3 }]);
    expect(withSal.pHit).toBeCloseTo(withoutSal.pHit, 9);
  });
});

describe('resolveAttackProbabilities — Legiones Astartes: Imperial Fists', () => {
  const IF_RULE = { id: 'imperialFists', value: 1, traits: ['auto', 'bolt'] };
  const BOLT_TRAIT = [{ id: 'bolt' }];
  const AUTO_TRAIT = [{ id: 'auto' }];
  const MELEE_TRAIT = [{ id: 'melee' }];

  it('grants +1 (lowers hitNeed by 1) with a qualifying trait and 5+ shots', () => {
    const r = resolveAttackProbabilities(4, 4, 4, false, BOLT_TRAIT, [IF_RULE], [], 5);
    expect(r.pHit).toBeCloseTo(5 / 6, 9); // BS4 needs 3+ normally; IF drops it to 2+
  });

  it('does not apply with fewer than 5 shots in the Fire Group', () => {
    const r = resolveAttackProbabilities(4, 4, 4, false, BOLT_TRAIT, [IF_RULE], [], 4);
    expect(r.pHit).toBeCloseTo(4 / 6, 9);
  });

  it('does not apply if the weapon does not have a qualifying trait', () => {
    const r = resolveAttackProbabilities(4, 4, 4, false, MELEE_TRAIT, [IF_RULE], [], 5);
    expect(r.pHit).toBeCloseTo(4 / 6, 9);
  });

  it('either qualifying trait (Bolt or Auto) works', () => {
    const withAuto = resolveAttackProbabilities(4, 4, 4, false, AUTO_TRAIT, [IF_RULE], [], 5);
    expect(withAuto.pHit).toBeCloseTo(5 / 6, 9);
  });

  it('does not push the hit threshold below 2+ (already-best-possible BS is unaffected)', () => {
    const r = resolveAttackProbabilities(9, 4, 4, false, BOLT_TRAIT, [IF_RULE], [], 5);
    expect(r.pHit).toBeCloseTo(5 / 6, 9); // BS9 already needs only 2+; IF has nothing left to improve
  });

  it('has no effect at all if the Imperial Fists rule is not active', () => {
    const r = resolveAttackProbabilities(4, 4, 4, false, BOLT_TRAIT, [], [], 5);
    expect(r.pHit).toBeCloseTo(4 / 6, 9);
  });

  it('has no effect if activeTraits is empty, even with the rule present and 5+ shots', () => {
    const r = resolveAttackProbabilities(4, 4, 4, false, [], [IF_RULE], [], 5);
    expect(r.pHit).toBeCloseTo(4 / 6, 9);
  });

  it('compounds correctly with Snap Shot\'s harsher hit table', () => {
    const withoutIF = resolveAttackProbabilities(4, 4, 4, true, BOLT_TRAIT, [], [], 5);
    const withIF = resolveAttackProbabilities(4, 4, 4, true, BOLT_TRAIT, [IF_RULE], [], 5);
    expect(withoutIF.pHit).toBeCloseTo(2 / 6, 9); // Snap Shot BS4 needs 5+
    expect(withIF.pHit).toBeCloseTo(3 / 6, 9);    // IF drops it to 4+
  });
});