import { describe, it, expect } from 'vitest';
import {
  needForBS,
  needForBSSnapShot,
  getEffectiveCriticalThreshold,
  getInnateCriticalX,
  needForWS,
  pFromNeed,
  needForWound,
  resolveSave,
  resolveAttackProbabilities,
  resolveFinalOutcomeProbabilities,
  sumBucket,
  computeModelsRemoved,
  computeModelsRemovedWithFireGroups,
  computeModelsRemovedMultiTier,
  applyWoundGroupToState,
  applyDeflagrateWave,
  resolveVehicleAttackProbabilities, 
  resolveVehicleFinalOutcomeProbabilities, 
  resolveEscalationHPDistribution, 
  computeVehicleHullPointDistribution,
  computeStatusInflictedProbability,
  binomialPMF,
  propagate,
  mean,
  cdfAtLeast,
} from './combatMath.js';

// This file covers the generic, rule-agnostic math: the to-hit/to-wound
// tables, saves, probability-distribution mechanics, the wound/casualty
// state machine, and the multi-tier engine's own structural correctness.
// Behaviour specific to a *named* special rule (Rending, Shred, Critical
// Hit, Murderous, Eternal Warrior, Salamanders, Iron Hands, Deflagrate,
// Damage Mitigation, ...) lives in specialRules.test.js / damageMitigation.test.js
// instead, so each kind of behaviour is tested in exactly one place.

describe('needForBS / pFromNeed', () => {
  it('BS1 needs 6+', () => expect(needForBS(1)).toBe(6));
  it('BS2 needs 5+', () => expect(needForBS(2)).toBe(5));
  it('BS3 needs 4+', () => expect(needForBS(3)).toBe(4));
  it('BS4 needs 3+', () => expect(needForBS(4)).toBe(3));
  it('BS5..BS9 need 2+', () => {
    for (let bs = 5; bs <= 9; bs++) expect(needForBS(bs)).toBe(2);
  });
  it('BS10 is auto-hit (null need)', () => expect(needForBS(10)).toBeNull());
  it('pFromNeed(null) = 1 (auto-hit)', () => expect(pFromNeed(null)).toBe(1));
  it('pFromNeed(4) = 3/6', () => expect(pFromNeed(4)).toBeCloseTo(3 / 6, 9));
  it('pFromNeed(2) = 5/6', () => expect(pFromNeed(2)).toBeCloseTo(5 / 6, 9));
});

describe('needForWound', () => {
  it('S >= T+2 needs 2+', () => expect(needForWound(6, 4)).toBe(2));
  it('S = T+1 needs 3+', () => expect(needForWound(5, 4)).toBe(3));
  it('S = T needs 4+', () => expect(needForWound(4, 4)).toBe(4));
  it('S = T-1 needs 5+', () => expect(needForWound(3, 4)).toBe(5));
  it('S = T-2 needs 6+', () => expect(needForWound(2, 4)).toBe(6));
  it('S <= T-3 cannot wound (null)', () => expect(needForWound(1, 4)).toBeNull());
});

describe('resolveSave', () => {
  it('no saves at all -> pUnsaved = 1', () => {
    const r = resolveSave(1, 7, 7, 7);
    expect(r.saveValue).toBeNull();
    expect(r.pUnsaved).toBeCloseTo(1, 9);
  });
  it('AP <= Armour negates armour (per house rule)', () => {
    const r = resolveSave(2, 2, 7, 7); // AP 2, Armour 2+: 2 <= 2, so unusable
    expect(r.armourUsable).toBe(false);
    expect(r.saveValue).toBeNull();
  });
  it('AP > Armour lets armour apply', () => {
    const r = resolveSave(3, 2, 7, 7); // AP 3 > Armour 2, usable
    expect(r.armourUsable).toBe(true);
    expect(r.saveValue).toBe(2);
    expect(r.source).toBe('Armour');
  });
  it('best (lowest) save wins among available options', () => {
    const r = resolveSave(3, 4, 3, 5); // armour usable(4), invuln 3, cover 5 -> invuln wins
    expect(r.saveValue).toBe(3);
    expect(r.source).toBe('Invulnerable');
  });
  it('cover can win over armour and invuln', () => {
    const r = resolveSave(3, 4, 6, 2);
    expect(r.saveValue).toBe(2);
    expect(r.source).toBe('Cover');
  });
  it('pSave / pUnsaved are complementary', () => {
    const r = resolveSave(3, 2, 7, 7);
    expect(r.pSave + r.pUnsaved).toBeCloseTo(1, 9);
  });
});

describe('needForWS', () => {
  it('attacker WS >= 2x target WS -> 2+', () => {
    expect(needForWS(8, 4)).toBe(2);
    expect(needForWS(10, 5)).toBe(2); // exact boundary, >=
  });
  it('attacker WS > target WS, but < 2x -> 3+', () => {
    expect(needForWS(5, 4)).toBe(3);
    expect(needForWS(9, 5)).toBe(3); // just under the 2x boundary
  });
  it('equal WS -> 4+', () => {
    expect(needForWS(5, 5)).toBe(4);
  });
  it('target WS > attacker WS, but < 2x attacker -> 5+', () => {
    expect(needForWS(4, 5)).toBe(5);
    expect(needForWS(5, 9)).toBe(5);
  });
  it('target WS >= 2x attacker WS -> 6+', () => {
    expect(needForWS(4, 8)).toBe(6);
    expect(needForWS(5, 10)).toBe(6); // exact boundary
  });
  it('is exhaustive and non-overlapping across a wide range', () => {
    for (let A = 1; A <= 20; A++) {
      for (let T = 1; T <= 20; T++) {
        const result = needForWS(A, T);
        expect([2, 3, 4, 5, 6]).toContain(result);
      }
    }
  });
});

describe('resolveAttackProbabilities — decoupled hitNeed/innateCritX (regression for shooting)', () => {
  it('matches prior BS-driven behaviour when hitNeed/innateCritX are derived the old way', () => {
    const bs = 9;
    const hitNeed = needForBS(bs);
    const innateCritX = getInnateCriticalX(bs);
    const r = resolveAttackProbabilities(hitNeed, 1, 20, innateCritX, [], [], [], 1);
    expect(r.pHit).toBeCloseTo(5 / 6, 9);
    const tier1 = sumBucket(r.buckets, 'BreachDplus1') + sumBucket(r.buckets, 'noBreachDplus1');
    expect(tier1).toBeCloseTo(4 / 6, 9); // innate crit still applies via the passed-in value
  });

  it('assault: no innate crit, only an explicit rule grants Critical Hit', () => {
    const hitNeed = needForWS(8, 4); // 2+
    const withoutExplicit = resolveAttackProbabilities(hitNeed, 1, 20, null, [], [], [], 1);
    const tier1 = sumBucket(withoutExplicit.buckets, 'BreachDplus1') + sumBucket(withoutExplicit.buckets, 'noBreachDplus1');
    expect(tier1).toBeCloseTo(0, 9);

    const withExplicit = resolveAttackProbabilities(hitNeed, 1, 20, null, [], [{ id: 'criticalHit', value: 5 }], [], 1);
    const tier1b = sumBucket(withExplicit.buckets, 'BreachDplus1') + sumBucket(withExplicit.buckets, 'noBreachDplus1');
    expect(tier1b).toBeGreaterThan(0);
  });

  it('hitNeed=null (auto-hit) still works when passed directly, independent of bs/isSnapShot', () => {
    const r = resolveAttackProbabilities(null, 4, 4, null, [], [], [], 1);
    expect(r.pHit).toBe(1);
  });
});

describe('resolveFinalOutcomeProbabilities — core breach/save combination', () => {
  // Breaching is used here purely as a vehicle to populate the Breach*
  // buckets; the thing under test is resolveFinalOutcomeProbabilities'
  // own save-combination logic, not Breaching's rule-specific behaviour
  // (that's covered separately in specialRules.test.js).
  it('matches an independent brute-force enumeration over hit-die/wound-die outcomes', () => {
    const bs = 4, S = 3, T = 4, X = 5, ap = 1, armour = 4, invuln = 7, cover = 7;
    const hitNeed = needForBS(bs), wNeed = needForWound(S, T);
    let expectedUnsaved = 0;
    for (let hitDie = 1; hitDie <= 6; hitDie++) {
      if (hitDie < hitNeed) continue;
      for (let woundDie = 1; woundDie <= 6; woundDie++) {
        if (woundDie < wNeed) continue;
        const breach = woundDie >= X;
        const save = breach ? resolveSave(2, armour, invuln, cover) : resolveSave(ap, armour, invuln, cover);
        expectedUnsaved += (1 / 36) * save.pUnsaved;
      }
    }
    const { buckets } = resolveAttackProbabilities(hitNeed, S, T, null, [], [{ id: 'breaching', value: X }]);
    const outcome = resolveFinalOutcomeProbabilities(buckets, ap, armour, invuln, cover);
    const totalUnsaved = outcome.pUnsavedTierDplus0 + outcome.pUnsavedTierDplus1 + outcome.pUnsavedTierDplus2;
    expect(totalUnsaved).toBeCloseTo(expectedUnsaved, 9);
  });

  it('a breach wound always uses AP2 for its save, distinct from the weapon\'s real AP', () => {
    // armour=3, real AP=6: under this ruleset's armourUsable = AP > armour convention,
    // AP6 is "weak" enough that armour would normally still apply (saveNormal).
    // The breach override forces AP2 regardless, which is NOT enough to exceed armour=3,
    // so armour gets negated under breach even though the weapon's real AP wouldn't have.
    const { buckets } = resolveAttackProbabilities(needForBS(4), 6, 4, getInnateCriticalX(4), [], [{ id: 'breaching', value: 2 }]); // every wound breaches
    const outcome = resolveFinalOutcomeProbabilities(buckets, 6, 3, 7, 7);
    expect(outcome.saveNormal.armourUsable).toBe(true);  // real AP6 > armour3: armour normally applies
    expect(outcome.saveBreach.armourUsable).toBe(false); // breach's fixed AP2 does not exceed armour3
  });

  it('with no Breaching active, every wound uses the normal save only', () => {
    const { buckets } = resolveAttackProbabilities(needForBS(4), 4, 4, getInnateCriticalX(4), [], []);
    const outcome = resolveFinalOutcomeProbabilities(buckets, 1, 4, 7, 7);
    const totalBreachBucketMass = sumBucket(buckets, 'BreachDplus0') + sumBucket(buckets, 'BreachDplus1') + sumBucket(buckets, 'BreachDplus2');
    expect(totalBreachBucketMass).toBeCloseTo(0, 9);
  });
});

describe('binomialPMF', () => {
  it('sums to 1', () => {
    const dist = binomialPMF(20, 0.37);
    expect(dist.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });
  it('n=2, p=0.5 matches known values', () => {
    const dist = binomialPMF(2, 0.5);
    expect(dist[0]).toBeCloseTo(0.25, 9);
    expect(dist[1]).toBeCloseTo(0.5, 9);
    expect(dist[2]).toBeCloseTo(0.25, 9);
  });
  it('p=0 -> all mass at k=0', () => {
    const dist = binomialPMF(5, 0);
    expect(dist[0]).toBe(1);
    expect(dist.slice(1).every((x) => x === 0)).toBe(true);
  });
  it('p=1 -> all mass at k=n', () => {
    const dist = binomialPMF(5, 1);
    expect(dist[5]).toBe(1);
    expect(dist.slice(0, 5).every((x) => x === 0)).toBe(true);
  });
  it('length is n+1', () => {
    expect(binomialPMF(9, 0.4).length).toBe(10);
  });
});

describe('propagate', () => {
  it('propagating a binomial through a second probability equals a combined binomial', () => {
    const n = 12, p1 = 4 / 6, p2 = 3 / 6;
    const stage1 = binomialPMF(n, p1);
    const combined = propagate(stage1, p2);
    const direct = binomialPMF(n, p1 * p2);
    for (let k = 0; k <= n; k++) expect(combined[k]).toBeCloseTo(direct[k], 9);
  });
  it('propagate preserves total probability mass', () => {
    const dist = propagate(binomialPMF(15, 0.5), 0.3);
    expect(dist.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });
  it('propagate with p=0 collapses everything to 0', () => {
    const dist = propagate(binomialPMF(8, 0.6), 0);
    expect(dist[0]).toBeCloseTo(1, 9);
  });
});

describe('mean', () => {
  it('mean of binomial(n,p) is n*p', () => {
    const n = 30, p = 0.42;
    expect(mean(binomialPMF(n, p))).toBeCloseTo(n * p, 9);
  });
  it('mean of a distribution concentrated at k=3 is 3', () => {
    expect(mean([0, 0, 0, 1, 0])).toBeCloseTo(3, 9);
  });
});

describe('cdfAtLeast', () => {
  it('cdf[0] = 1 (always at least 0)', () => {
    const dist = binomialPMF(10, 0.3);
    expect(cdfAtLeast(dist)[0]).toBeCloseTo(1, 9);
  });
  it('cdf[N] equals dist[N] (top bucket)', () => {
    const dist = binomialPMF(10, 0.3);
    expect(cdfAtLeast(dist)[10]).toBeCloseTo(dist[10], 9);
  });
  it('cdf is non-increasing', () => {
    const cdf = cdfAtLeast(binomialPMF(10, 0.45));
    for (let k = 1; k < cdf.length; k++) {
      expect(cdf[k]).toBeLessThanOrEqual(cdf[k - 1] + 1e-12);
    }
  });
});

describe('applyWoundGroupToState', () => {
  it('partial damage, not enough to kill', () => {
    expect(applyWoundGroupToState({ killed: 0, wounded_model: 5 }, 2, 1, 5, 10)).toEqual({ killed: 0, wounded_model: 3 });
  });
  it('exactly enough to kill the current model, next model starts fresh', () => {
    expect(applyWoundGroupToState({ killed: 0, wounded_model: 5 }, 5, 1, 5, 10)).toEqual({ killed: 1, wounded_model: 5 });
  });
  it('kills multiple full models plus a partial one', () => {
    expect(applyWoundGroupToState({ killed: 0, wounded_model: 5 }, 12, 1, 5, 10)).toEqual({ killed: 2, wounded_model: 3 });
  });
  it('caps at targetModels, wasting excess wounds', () => {
    expect(applyWoundGroupToState({ killed: 0, wounded_model: 5 }, 100, 1, 5, 3)).toEqual({ killed: 3, wounded_model: 0 });
  });
  it('continues correctly from an already-partially-wounded state', () => {
    expect(applyWoundGroupToState({ killed: 1, wounded_model: 2 }, 2, 1, 5, 10)).toEqual({ killed: 2, wounded_model: 5 });
  });
  it('N=0 or already-wiped unit is a no-op', () => {
    expect(applyWoundGroupToState({ killed: 2, wounded_model: 5 }, 0, 1, 5, 10)).toEqual({ killed: 2, wounded_model: 5 });
    expect(applyWoundGroupToState({ killed: 10, wounded_model: 0 }, 5, 1, 5, 10)).toEqual({ killed: 10, wounded_model: 0 });
  });
});

describe('computeModelsRemoved', () => {
  it('W=1,D=1: one unsaved wound kills one model, 1:1 mapping', () => {
    const distUnsaved = [0, 0, 0, 1];
    const { distModels, hitsPerKill } = computeModelsRemoved(distUnsaved, 1, 1, 10);
    expect(hitsPerKill).toBe(1);
    expect(distModels[3]).toBeCloseTo(1, 9);
  });
  it('W=3,D=1: needs 3 unsaved wounds per kill, remainder does not kill', () => {
    const distUnsaved = [0, 0, 0, 0, 0, 1];
    const { distModels, hitsPerKill } = computeModelsRemoved(distUnsaved, 3, 1, 10);
    expect(hitsPerKill).toBe(3);
    expect(distModels[1]).toBeCloseTo(1, 9);
  });
  it('W=3,D=2: overkill on last wound does not spill to next model', () => {
    const distUnsaved = [0, 0, 1];
    const { distModels, hitsPerKill } = computeModelsRemoved(distUnsaved, 3, 2, 10);
    expect(hitsPerKill).toBe(2);
    expect(distModels[1]).toBeCloseTo(1, 9);
  });
  it('kills are capped at targetModels', () => {
    const distUnsaved = new Array(51).fill(0);
    distUnsaved[50] = 1;
    const { distModels } = computeModelsRemoved(distUnsaved, 1, 1, 5);
    expect(distModels[5]).toBeCloseTo(1, 9);
    expect(distModels.length).toBe(6);
  });
  it('models-removed distribution still sums to 1', () => {
    const distUnsaved = binomialPMF(20, 0.35);
    const { distModels } = computeModelsRemoved(distUnsaved, 2, 1, 10);
    expect(distModels.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });
});

function bruteForceJointTrinomial(n, p1, p2) {
  let dist = [[1]];
  const p3 = 1 - p1 - p2;
  for (let t = 0; t < n; t++) {
    const next = Array.from({ length: t + 2 }, () => new Array(t + 2).fill(0));
    for (let a = 0; a <= t; a++) for (let b = 0; b <= t - a; b++) {
      const p = dist[a][b];
      if (!p) continue;
      next[a + 1][b] += p * p1;
      next[a][b + 1] += p * p2;
      next[a][b] += p * p3;
    }
    dist = next;
  }
  return dist;
}

describe('computeModelsRemovedWithFireGroups (retained as a cross-check oracle for computeModelsRemovedMultiTier)', () => {
  it('reduces to the constant-damage formula when the second Fire Group probability is 0', () => {
    const totalDice = 12, pUnsaved = 0.4, D = 2, W = 5, targetModels = 6;
    const { distModels } = computeModelsRemovedWithFireGroups(totalDice, pUnsaved, 0, D, W, targetModels);
    const { distModels: oldDist } = computeModelsRemoved(binomialPMF(totalDice, pUnsaved), W, D, targetModels);
    for (let k = 0; k <= targetModels; k++) expect(distModels[k]).toBeCloseTo(oldDist[k], 9);
  });

  it('matches an independently-built joint distribution (brute-force cross-check)', () => {
    const totalDice = 6, pNormal = 0.3, pShred = 0.2, D = 2, W = 3, targetModels = 3;
    const joint = bruteForceJointTrinomial(totalDice, pNormal, pShred);
    const expected = new Array(targetModels + 1).fill(0);
    for (let a = 0; a <= totalDice; a++) {
      for (let b = 0; b <= totalDice - a; b++) {
        const p = joint[a]?.[b] ?? 0;
        if (p <= 0) continue;
        const afterNormal = applyWoundGroupToState({ killed: 0, wounded_model: W }, a, D, W, targetModels);
        const final = afterNormal.killed >= targetModels
          ? afterNormal
          : applyWoundGroupToState(afterNormal, b, D + 1, W, targetModels);
        expected[final.killed] += p;
      }
    }
    const { distModels } = computeModelsRemovedWithFireGroups(totalDice, pNormal, pShred, D, W, targetModels);
    for (let k = 0; k <= targetModels; k++) expect(distModels[k]).toBeCloseTo(expected[k], 9);
  });

  it('distribution sums to 1', () => {
    const { distModels } = computeModelsRemovedWithFireGroups(20, 0.2, 0.15, 2, 6, 8);
    expect(distModels.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });
});

describe('computeModelsRemovedMultiTier', () => {
  it('matches computeModelsRemovedWithFireGroups when only 2 tiers are active', () => {
    const totalDice = 15, W = 4, targetModels = 5;
    const tiers = [{ damage: 2, pUnsaved: 0.3 }, { damage: 3, pUnsaved: 0.2 }];
    const { distModels: multi } = computeModelsRemovedMultiTier(totalDice, tiers, W, targetModels);
    const { distModels: pair } = computeModelsRemovedWithFireGroups(totalDice, 0.3, 0.2, 2, W, targetModels);
    for (let k = 0; k <= targetModels; k++) expect(multi[k]).toBeCloseTo(pair[k], 9);
  });

  it('matches the constant-damage formula when only 1 tier is active', () => {
    const totalDice = 15, pUnsaved = 0.4, D = 2, W = 5, targetModels = 6;
    const { distModels: multi } = computeModelsRemovedMultiTier(totalDice, [{ damage: D, pUnsaved }], W, targetModels);
    const { distModels: single } = computeModelsRemoved(binomialPMF(totalDice, pUnsaved), W, D, targetModels);
    for (let k = 0; k <= targetModels; k++) expect(multi[k]).toBeCloseTo(single[k], 9);
  });

  it('matches brute-force enumeration for a genuine 3-tier case', () => {
    const totalDice = 5, W = 3, targetModels = 2;
    const p0 = 0.25, p1 = 0.15, p2 = 0.1;
    const D = 1;
    const outcomes = ['none', 'tier0', 'tier1', 'tier2'];
    const probOf = { none: 1 - p0 - p1 - p2, tier0: p0, tier1: p1, tier2: p2 };
    const damageOf = { tier0: D, tier1: D + 1, tier2: D + 2 };

    function enumerate(seq, i, acc) {
      if (i === totalDice) {
        const counts = { tier0: 0, tier1: 0, tier2: 0 };
        for (const o of seq) if (o !== 'none') counts[o]++;
        let state = { killed: 0, wounded_model: W };
        for (const tierKey of ['tier0', 'tier1', 'tier2']) {
          if (state.killed >= targetModels) break;
          state = applyWoundGroupToState(state, counts[tierKey], damageOf[tierKey], W, targetModels);
        }
        acc[state.killed] = (acc[state.killed] || 0) + seq.reduce((p, o) => p * probOf[o], 1);
        return;
      }
      for (const o of outcomes) enumerate([...seq, o], i + 1, acc);
    }
    const expected = {};
    enumerate([], 0, expected);

    const { distModels } = computeModelsRemovedMultiTier(totalDice, [
      { damage: D, pUnsaved: p0 },
      { damage: D + 1, pUnsaved: p1 },
      { damage: D + 2, pUnsaved: p2 },
    ], W, targetModels);

    for (let k = 0; k <= targetModels; k++) expect(distModels[k]).toBeCloseTo(expected[k] || 0, 9);
  });

  it('distribution sums to 1 with 3 active tiers', () => {
    const { distModels } = computeModelsRemovedMultiTier(20, [
      { damage: 1, pUnsaved: 0.15 },
      { damage: 2, pUnsaved: 0.1 },
      { damage: 3, pUnsaved: 0.05 },
    ], 6, 8);
    expect(distModels.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });

  it('branches sum to the same distModels as before', () => {
    const { distModels, branches } = computeModelsRemovedMultiTier(10, [{ damage: 2, pUnsaved: 0.3 }], 5, 4);
    const fromBranches = new Array(5).fill(0);
    for (const br of branches) fromBranches[br.killed] += br.prob;
    for (let k = 0; k < 5; k++) expect(fromBranches[k]).toBeCloseTo(distModels[k], 9);
  });

  it('E[N] across branches matches totalDice * total unsaved probability', () => {
    const totalDice = 8, tiers = [{ damage: 1, pUnsaved: 0.2 }, { damage: 2, pUnsaved: 0.15 }];
    const { branches } = computeModelsRemovedMultiTier(totalDice, tiers, 4, 5);
    const EN = branches.reduce((acc, br) => acc + br.N * br.prob, 0);
    expect(EN).toBeCloseTo(totalDice * 0.35, 9);
  });
});

describe('applyDeflagrateWave', () => {
  it('matches an independent brute-force enumeration for a small case', () => {
    const totalDice = 3, pUnsavedD = 0.3, W = 3, targetModels = 2;
    const X = 4, T = 4, armour = 4, invuln = 7, cover = 7;

    const wNeedD = needForWound(X, T);
    const pWoundD = (7 - wNeedD) / 6;
    const pUnsavedDeflag = pWoundD * resolveSave(7, armour, invuln, cover).pUnsaved; // AP '-' = 7, not 0

    const expected = {};
    const add = (k, p) => { expected[k] = (expected[k] || 0) + p; };
    for (const a of ['none', 'hit']) for (const b of ['none', 'hit']) for (const c of ['none', 'hit']) {
      const seq = [a, b, c];
      const n = seq.filter((x) => x === 'hit').length;
      const pSeq = seq.reduce((acc, x) => acc * (x === 'hit' ? pUnsavedD : 1 - pUnsavedD), 1);
      let state = applyWoundGroupToState({ killed: 0, wounded_model: W }, n, 1, W, targetModels);
      if (n === 0 || state.killed >= targetModels) { add(state.killed, pSeq); continue; }
      const enumerateDeflagrate = (i, successes, p) => {
        if (i === n) {
          const finalState = applyWoundGroupToState(state, successes, 1, W, targetModels);
          add(finalState.killed, pSeq * p);
          return;
        }
        enumerateDeflagrate(i + 1, successes + 1, p * pUnsavedDeflag);
        enumerateDeflagrate(i + 1, successes, p * (1 - pUnsavedDeflag));
      };
      enumerateDeflagrate(0, 0, 1);
    }

    const { branches } = computeModelsRemovedMultiTier(totalDice, [{ damage: 1, pUnsaved: pUnsavedD }], W, targetModels);
    const { distModels } = applyDeflagrateWave(branches, X, T, armour, invuln, cover, W, targetModels, totalDice);
    for (let k = 0; k <= targetModels; k++) expect(distModels[k]).toBeCloseTo(expected[k] || 0, 9);
  });

  it('an X too weak to ever wound is a correct no-op, identical to no Deflagrate at all', () => {
    const totalDice = 6, W = 4, targetModels = 3;
    const tiers = [{ damage: 1, pUnsaved: 0.2 }, { damage: 2, pUnsaved: 0.15 }];
    const { distModels: baseline, branches } = computeModelsRemovedMultiTier(totalDice, tiers, W, targetModels);
    const { distModels: withDeflagrate } = applyDeflagrateWave(branches, 1, 20, 4, 7, 7, W, targetModels, totalDice);
    for (let k = 0; k <= targetModels; k++) expect(withDeflagrate[k]).toBeCloseTo(baseline[k], 9);
  });

  it('does not act on an already-wiped unit', () => {
    const { branches } = computeModelsRemovedMultiTier(20, [{ damage: 1, pUnsaved: 0.9 }], 1, 2);
    const { distModels } = applyDeflagrateWave(branches, 6, 1, 7, 7, 7, 1, 2, 20);
    expect(distModels[2]).toBeGreaterThan(0.9);
  });

  it('resulting distribution always sums to 1', () => {
    const { branches } = computeModelsRemovedMultiTier(10, [{ damage: 2, pUnsaved: 0.25 }], 5, 4);
    const { distModels } = applyDeflagrateWave(branches, 5, 4, 4, 7, 7, 5, 4, 10);
    expect(distModels.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });
});

describe('applyDeflagrateWave — AP sentinel correctness', () => {
  it('AP "-" (represented as 7) never negates armour, regardless of armour value', () => {
    const { branches } = computeModelsRemovedMultiTier(3, [{ damage: 1, pUnsaved: 1.0 }], 3, 2);
    const { pUnsavedDeflagrate } = applyDeflagrateWave(branches, 4, 4, 2, 7, 7, 3, 2, 3);
    const pWound = (7 - needForWound(4, 4)) / 6;
    const pSaveExpected = (7 - 2) / 6;
    expect(pUnsavedDeflagrate).toBeCloseTo(pWound * (1 - pSaveExpected), 9);
  });

  it('regression guard: AP=0 would have incorrectly negated armour entirely (this is the bug that was caught)', () => {
    const { branches } = computeModelsRemovedMultiTier(3, [{ damage: 1, pUnsaved: 1.0 }], 3, 2);
    const { pUnsavedDeflagrate } = applyDeflagrateWave(branches, 4, 4, 4, 7, 7, 3, 2, 3);
    expect(pUnsavedDeflagrate).toBeCloseTo(0.25, 9);
    expect(pUnsavedDeflagrate).not.toBeCloseTo(0.5, 9);
  });
});

describe('applyDeflagrateWave — wound/unsaved distributions for charting', () => {
  it('matches hand-derived binomial distributions for a deterministic single-branch case', () => {
    const { branches } = computeModelsRemovedMultiTier(3, [{ damage: 1, pUnsaved: 1.0 }], 3, 2);
    const { distWoundsCaused, distUnsaved } = applyDeflagrateWave(branches, 4, 4, 4, 7, 7, 3, 2, 3);
    const expectedWounds = [1, 3, 3, 1].map((x) => x / 8);
    const expectedUnsaved = [0, 1, 2, 3].map((k) => [1, 3, 3, 1][k] * Math.pow(0.25, k) * Math.pow(0.75, 3 - k));
    for (let k = 0; k <= 3; k++) {
      expect(distWoundsCaused[k]).toBeCloseTo(expectedWounds[k], 9);
      expect(distUnsaved[k]).toBeCloseTo(expectedUnsaved[k], 9);
    }
  });

  it('a branch where the unit is already wiped contributes nothing to the wound distributions', () => {
    const { branches } = computeModelsRemovedMultiTier(20, [{ damage: 1, pUnsaved: 0.95 }], 1, 2);
    const { distWoundsCaused, distUnsaved, distModels } = applyDeflagrateWave(branches, 6, 1, 7, 7, 7, 1, 2, 20);
    expect(distModels[2]).toBeGreaterThan(0.5);
    expect(distWoundsCaused.reduce((a, b) => a + b, 0)).toBeLessThan(1);
    expect(distUnsaved.reduce((a, b) => a + b, 0)).toBeLessThan(1);
  });
});

describe('needForBSSnapShot', () => {
  it('matches the full BS-to-threshold table', () => {
    expect(needForBSSnapShot(1)).toBe(7);  // Automatic Fail
    expect(needForBSSnapShot(2)).toBe(6);
    expect(needForBSSnapShot(3)).toBe(6);
    expect(needForBSSnapShot(4)).toBe(5);
    expect(needForBSSnapShot(5)).toBe(5);
    expect(needForBSSnapShot(6)).toBe(4);
    expect(needForBSSnapShot(7)).toBe(4);
    expect(needForBSSnapShot(8)).toBe(3);
    expect(needForBSSnapShot(9)).toBe(3);
    expect(needForBSSnapShot(10)).toBe(2);
    expect(needForBSSnapShot(11)).toBe(2); // BS10+ all treated the same
  });
});

describe('getEffectiveCriticalThreshold — Snap Shot suppression', () => {
  it('isSnapShot=true suppresses the innate BS-based Critical Hit', () => {
    expect(getEffectiveCriticalThreshold(9, [], true)).toBeNull();
  });
  it('isSnapShot=true still allows an explicit Critical Hit rule', () => {
    expect(getEffectiveCriticalThreshold(9, [{ id: 'criticalHit', value: 5 }], true)).toBe(5);
  });
  it('isSnapShot=false (or omitted) is unaffected — regression', () => {
    expect(getEffectiveCriticalThreshold(9, [], false)).toBe(3);
    expect(getEffectiveCriticalThreshold(9, [])).toBe(3);
  });
});

describe('resolveAttackProbabilities — Snap Shot', () => {
  it('BS1 is Automatic Fail: pHit = 0 with no other rules active', () => {
    const r = resolveAttackProbabilities(needForBSSnapShot(1), 4, 4, null, [], [], [], 1);
    expect(r.pHit).toBe(0);
  });

  it('BS10 no longer auto-hits under Snap Shot — needs an actual 2+', () => {
    const normal = resolveAttackProbabilities(needForBS(10), 4, 4, getInnateCriticalX(10), [], [], [], 1);
    const snap = resolveAttackProbabilities(needForBSSnapShot(10), 4, 4, null, [], [], [], 1);
    expect(normal.pHit).toBe(1); // unaffected, real auto-hit
    expect(snap.pHit).toBeCloseTo(5 / 6, 9);
  });

  it('matches the full needForBSSnapShot table when no other rules are active', () => {
    for (let bs = 1; bs <= 10; bs++) {
      const r = resolveAttackProbabilities(needForBSSnapShot(bs), 4, 4, null, [], [], [], 1);
      const expected = pFromNeed(needForBSSnapShot(bs));
      expect(r.pHit).toBeCloseTo(expected, 9);
    }
  });

  it('suppresses the innate Critical Hit from high BS, but an explicit rule still works', () => {
    const withoutExplicit = resolveAttackProbabilities(needForBSSnapShot(9), 1, 20, null, [], [], [], 1);
    const tier1_a = sumBucket(withoutExplicit.buckets, 'BreachDplus1') + sumBucket(withoutExplicit.buckets, 'noBreachDplus1');
    expect(tier1_a).toBeCloseTo(0, 9);

    const withExplicit = resolveAttackProbabilities(needForBSSnapShot(9), 1, 20, null, [], [{ id: 'criticalHit', value: 5 }], [], 1);
    const tier1_b = sumBucket(withExplicit.buckets, 'BreachDplus1') + sumBucket(withExplicit.buckets, 'noBreachDplus1');
    expect(tier1_b).toBeGreaterThan(0);
  });

  it('a weapon\'s own Rending still functions even during an Automatic Fail (BS1)', () => {
    const withRending = resolveAttackProbabilities(needForBSSnapShot(1), 4, 4, null, [], [{ id: 'rending', value: 4 }], [], 1);
    expect(withRending.pHit).toBeCloseTo(0.5, 9); // Rending overrides the impossible BS threshold
    const withoutRending = resolveAttackProbabilities(needForBSSnapShot(1), 4, 4, null, [], [], [], 1);
    expect(withoutRending.pHit).toBe(0); // true Automatic Fail, no weapon-level rescue
  });

  it('isSnapShot=false exactly matches non-Snap-Shot behaviour (regression)', () => {
    const snapFalse = resolveAttackProbabilities(needForBS(4), 6, 4, getInnateCriticalX(4), [], [{ id: 'rending', value: 5 }], [], 1);
    expect(snapFalse.pHit).toBeCloseTo(4 / 6, 9);
  });
});

// ============================================================================
// Vehicle shooting phase
//
// Add these to the existing import list from './combatMath.js'
// (needForBS and needForBSSnapShot are already imported there):
//   resolveVehicleAttackProbabilities,
//   resolveVehicleFinalOutcomeProbabilities,
//   resolveEscalationHPDistribution,
//   computeVehicleHullPointDistribution,
//   computeStatusInflictedProbability,
//
// The helpers and tests sit inside one wrapper describe so the helper names
// (sum, ap, bruteEscalation, bruteHullPoints) cannot clash with anything else
// in the file.
// ============================================================================

describe('Vehicle shooting phase', () => {
  // Test helpers — independent oracles, deliberately NOT built from the formulas
  // the functions under test use.
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);

  // hitNeed = null makes every attack an automatic hit, isolating the Armour Penetration test itself.
  const ap = (S, AV, rules = []) => resolveVehicleAttackProbabilities(null, S, AV, null, [], rules, 0);

  // Every possible sequence of g Vehicle Damage Table rolls (each Stunned / Pinned / Suppressed).
  // A status already held costs one Hull Point instead: sum of (count - 1) over statuses rolled.
  function bruteEscalation(g) {
    const out = new Map();
    const total = Math.pow(3, g);
    for (let seq = 0; seq < total; seq++) {
      const counts = [0, 0, 0];
      let x = seq;
      for (let i = 0; i < g; i++) { counts[x % 3]++; x = Math.floor(x / 3); }
      const hp = counts.reduce((acc, c) => acc + Math.max(0, c - 1), 0);
      out.set(hp, (out.get(hp) || 0) + 1 / total);
    }
    return out;
  }

  // Every die lands as miss / glance / penetrate / critical penetrate; every glance then
  // independently rolls a status. Total Hull Points lost is capped at the vehicle's total.
  function bruteHullPoints(totalDice, pGlance, pPenNormal, pPenCrit, dmg, maxHP) {
    const pMiss = 1 - pGlance - pPenNormal - pPenCrit;
    const dist = new Array(maxHP + 1).fill(0);
    function walk(i, glances, penHP, prob) {
      if (i === totalDice) {
        const combos = Math.pow(3, glances);
        for (let s = 0; s < combos; s++) {
          const counts = [0, 0, 0];
          let x = s;
          for (let j = 0; j < glances; j++) { counts[x % 3]++; x = Math.floor(x / 3); }
          const esc = counts.reduce((a, c) => a + Math.max(0, c - 1), 0);
          dist[Math.min(maxHP, penHP + esc)] += prob / combos;
        }
        return;
      }
      walk(i + 1, glances, penHP, prob * pMiss);
      walk(i + 1, glances + 1, penHP, prob * pGlance);
      walk(i + 1, glances, penHP + dmg, prob * pPenNormal);
      walk(i + 1, glances, penHP + dmg + 1, prob * pPenCrit);
    }
    walk(0, 0, 0, 1);
    return dist;
  }

  describe('resolveVehicleAttackProbabilities — Armour Penetration test', () => {
    it('matches a die-by-die enumeration where a natural 1 always fails', () => {
      for (let S = 1; S <= 20; S++) {
        for (let AV = 1; AV <= 20; AV++) {
          let glance = 0, pen = 0;
          for (let d = 2; d <= 6; d++) {
            if (S + d === AV) glance += 1 / 6;
            else if (S + d > AV) pen += 1 / 6;
          }
          const r = ap(S, AV);
          expect(r.pGlance).toBeCloseTo(glance, 9);
          expect(r.pPenetrateNormal).toBeCloseTo(pen, 9);
        }
      }
    });

    it('a weapon that cannot reach AV (S + 6 < AV) can neither Glance nor Penetrate', () => {
      for (const [S, AV] of [[4, 11], [4, 14], [3, 15], [1, 10]]) {
        const r = ap(S, AV);
        expect(r.pGlance).toBe(0);
        expect(r.pPenetrateNormal).toBe(0);
      }
    });

    it('S + 6 = AV can only Glance, and only on a roll of 6', () => {
      const r = ap(6, 12);
      expect(r.pGlance).toBeCloseTo(1 / 6, 9);
      expect(r.pPenetrateNormal).toBe(0);
    });

    it('AV = S + 1 cannot Glance (that would need a natural 1) and Penetrates on 2-6', () => {
      const r = ap(11, 12);
      expect(r.pGlance).toBe(0);
      expect(r.pPenetrateNormal).toBeCloseTo(5 / 6, 9);
    });

    it('AV at or below S Penetrates on any roll of 2-6 (a natural 1 still fails)', () => {
      for (const [S, AV] of [[12, 10], [10, 10], [20, 15]]) {
        const r = ap(S, AV);
        expect(r.pGlance).toBe(0);
        expect(r.pPenetrateNormal).toBeCloseTo(5 / 6, 9);
      }
    });

    it('hand-derived table for S 7: a Glance is one face in six, and Penetrate shrinks as AV rises', () => {
      const expectedPen = { 9: 4 / 6, 10: 3 / 6, 11: 2 / 6, 12: 1 / 6, 13: 0 };
      for (const [AV, pen] of Object.entries(expectedPen)) {
        const r = ap(7, Number(AV));
        expect(r.pGlance).toBeCloseTo(1 / 6, 9);
        expect(r.pPenetrateNormal).toBeCloseTo(pen, 9);
      }
    });

    it('Glancing and Penetrating together never exceed certainty', () => {
      for (let S = 1; S <= 20; S++) {
        for (let AV = 10; AV <= 15; AV++) {
          const r = ap(S, AV);
          expect(r.pGlance + r.pPenetrateNormal + r.pPenetrateCritical).toBeLessThanOrEqual(1 + 1e-12);
        }
      }
    });
  });

  describe('resolveVehicleAttackProbabilities — hit roll', () => {
    it('scales the Armour Penetration outcome by the chance to hit', () => {
      const r = resolveVehicleAttackProbabilities(needForBS(4), 7, 12, null, [], [], 0); // BS4: 3+, S7 vs AV12
      expect(r.pHit).toBeCloseTo(4 / 6, 9);
      expect(r.pGlance).toBeCloseTo((4 / 6) * (1 / 6), 9);
      expect(r.pPenetrateNormal).toBeCloseTo((4 / 6) * (1 / 6), 9);
    });

    it('BS 1-10 follow the normal Ballistic Skill table', () => {
      for (let bs = 1; bs <= 10; bs++) {
        const need = needForBS(bs);
        const expected = need === null ? 1 : (7 - need) / 6;
        const r = resolveVehicleAttackProbabilities(need, 12, 10, null, [], [], 0);
        expect(r.pHit).toBeCloseTo(expected, 9);
        expect(r.pPenetrateNormal).toBeCloseTo(expected * (5 / 6), 9);
      }
    });

    it('an automatic hit (BS10) always hits', () => {
      expect(ap(12, 10).pHit).toBe(1);
    });

    it('Snap Shots at BS1 is an Automatic Fail: nothing hits, so nothing is hurt', () => {
      const r = resolveVehicleAttackProbabilities(needForBSSnapShot(1), 12, 10, null, [], [], 0);
      expect(r.pHit).toBe(0);
      expect(r.pGlance).toBe(0);
      expect(r.pPenetrateNormal).toBe(0);
    });

    it('Snap Shots at BS4 needs 5+ instead of 3+, halving the chance to hit', () => {
      const r = resolveVehicleAttackProbabilities(needForBSSnapShot(4), 7, 12, null, [], [], 0);
      expect(r.pHit).toBeCloseTo(2 / 6, 9);
    });

    it('normal and critical Penetrating Hits always add up to the Penetrating share of hits', () => {
      const r = resolveVehicleAttackProbabilities(3, 8, 11, null, [], [{ id: 'criticalHit', value: 5 }], 0);
      expect(r.pPenetrateNormal + r.pPenetrateCritical).toBeCloseTo(r.pHit * (3 / 6), 9); // S8 vs AV11: roll 4+ penetrates
    });
  });

  describe('resolveVehicleFinalOutcomeProbabilities — saves and Damage Mitigation', () => {
    const run = (invuln, cover, mitFail = 1) => resolveVehicleFinalOutcomeProbabilities(0.2, 0.1, 0.05, invuln, cover, mitFail);

    it('with no save and no mitigation, nothing is removed', () => {
      const r = run(7, 7);
      expect(r.pGlanceUnsaved).toBeCloseTo(0.2, 9);
      expect(r.pPenetrateNormalUnsaved).toBeCloseTo(0.1, 9);
      expect(r.pPenetrateCriticalUnsaved).toBeCloseTo(0.05, 9);
    });

    it('an Invulnerable Save applies to Glancing and Penetrating Hits alike', () => {
      const r = run(4, 7); // 4+ saves half
      expect(r.pGlanceUnsaved).toBeCloseTo(0.1, 9);
      expect(r.pPenetrateNormalUnsaved).toBeCloseTo(0.05, 9);
      expect(r.pPenetrateCriticalUnsaved).toBeCloseTo(0.025, 9);
    });

    it('uses the better of an Invulnerable and a Cover Save', () => {
      const r = run(5, 3); // Cover 3+ beats Invulnerable 5+
      expect(r.save.source).toBe('Cover');
      expect(r.pGlanceUnsaved).toBeCloseTo(0.2 * (2 / 6), 9);
    });

    it('a vehicle can never take an Armour Save, whatever other saves it has', () => {
      for (let invuln = 2; invuln <= 7; invuln++) {
        for (let cover = 2; cover <= 7; cover++) {
          const r = run(invuln, cover);
          expect(r.save.source === 'Armour').toBe(false);
          expect(r.save.armourUsable).toBe(false);
        }
      }
    });

    it('Damage Mitigation multiplies in after the save', () => {
      const r = run(4, 7, 0.5); // save halves, mitigation halves again
      expect(r.pGlanceUnsaved).toBeCloseTo(0.2 * 0.25, 9);
      expect(r.pPenetrateNormalUnsaved).toBeCloseTo(0.1 * 0.25, 9);
    });

    it('cannot create a hit that was not there', () => {
      const r = resolveVehicleFinalOutcomeProbabilities(0, 0, 0, 2, 2, 0);
      expect(r.pGlanceUnsaved).toBe(0);
      expect(r.pPenetrateNormalUnsaved).toBe(0);
      expect(r.pPenetrateCriticalUnsaved).toBe(0);
    });
  });

  describe('resolveEscalationHPDistribution — Vehicle Damage Table', () => {
    it('matches a brute-force enumeration of every possible sequence of rolls', () => {
      for (let g = 0; g <= 7; g++) {
        const actual = resolveEscalationHPDistribution(g);
        const expected = bruteEscalation(g);
        expect(actual.size).toBe(expected.size);
        for (const [hp, p] of expected) expect(actual.get(hp)).toBeCloseTo(p, 9);
      }
    });

    it('one Glancing Hit can never remove a Hull Point', () => {
      expect(resolveEscalationHPDistribution(1).get(0)).toBeCloseTo(1, 9);
    });

    it('two Glancing Hits remove a Hull Point only by rolling the same status (1 in 3)', () => {
      const d = resolveEscalationHPDistribution(2);
      expect(d.get(0)).toBeCloseTo(2 / 3, 9);
      expect(d.get(1)).toBeCloseTo(1 / 3, 9);
    });

    it('hand-derived distribution for three Glancing Hits', () => {
      const d = resolveEscalationHPDistribution(3);
      expect(d.get(0)).toBeCloseTo(2 / 9, 9); // all different
      expect(d.get(1)).toBeCloseTo(6 / 9, 9); // exactly two the same
      expect(d.get(2)).toBeCloseTo(1 / 9, 9); // all the same
    });

    it('probabilities sum to 1 for any number of Glancing Hits', () => {
      for (let g = 0; g <= 30; g++) {
        expect(sum([...resolveEscalationHPDistribution(g).values()])).toBeCloseTo(1, 9);
      }
    });

    it('the worst case (every roll the same status) removes g-1 Hull Points, with probability 3 x (1/3)^g', () => {
      for (let g = 1; g <= 10; g++) {
        const d = resolveEscalationHPDistribution(g);
        expect(d.get(g - 1)).toBeCloseTo(3 * Math.pow(1 / 3, g), 9);
        expect(Math.max(...d.keys())).toBe(g - 1);
      }
    });
  });

  describe('computeVehicleHullPointDistribution', () => {
    it('matches a brute-force enumeration of every die and every Damage Table roll', () => {
      const cases = [
        [4, 0.2, 0.15, 0.1, 1, 4],
        [3, 0.3, 0.2, 0.05, 2, 3],
        [5, 0.15, 0.1, 0.1, 1, 5],
        [4, 0.25, 0.25, 0.25, 3, 6],
      ];
      for (const [dice, g, pn, pc, dmg, hp] of cases) {
        const actual = computeVehicleHullPointDistribution(dice, g, pn, pc, dmg, hp);
        const expected = bruteHullPoints(dice, g, pn, pc, dmg, hp);
        for (let k = 0; k <= hp; k++) expect(actual[k]).toBeCloseTo(expected[k], 9);
      }
    });

    it('has maxHullPoints + 1 entries and sums to 1', () => {
      const d = computeVehicleHullPointDistribution(12, 0.1, 0.1, 0.05, 2, 5);
      expect(d.length).toBe(6);
      expect(sum(d)).toBeCloseTo(1, 9);
    });

    it('still sums to 1 at a large dice count', () => {
      expect(sum(computeVehicleHullPointDistribution(100, 0.15, 0.1, 0.05, 2, 8))).toBeCloseTo(1, 9);
    });

    it('when nothing can hurt the vehicle, all probability sits at 0 Hull Points lost', () => {
      const d = computeVehicleHullPointDistribution(20, 0, 0, 0, 2, 4);
      expect(d[0]).toBeCloseTo(1, 9);
    });

    it('Penetrating Hits remove exactly Damage each', () => {
      const d = computeVehicleHullPointDistribution(3, 0, 1, 0, 2, 10); // 3 certain penetrates x 2
      expect(d[6]).toBeCloseTo(1, 9);
    });

    it('Hull Point loss is capped at the vehicle total — further damage is wasted', () => {
      const d = computeVehicleHullPointDistribution(3, 0, 1, 0, 2, 4); // would be 6, capped at 4
      expect(d[4]).toBeCloseTo(1, 9);
    });

    it('a penetrating Critical Hit removes Damage + 1', () => {
      const d = computeVehicleHullPointDistribution(2, 0, 0, 1, 2, 10); // 2 certain criticals x 3
      expect(d[6]).toBeCloseTo(1, 9);
    });

    it('Glancing Hits remove a Hull Point only by repeating a Status', () => {
      const d = computeVehicleHullPointDistribution(2, 1, 0, 0, 1, 3); // two certain Glances
      expect(d[0]).toBeCloseTo(2 / 3, 9);
      expect(d[1]).toBeCloseTo(1 / 3, 9);
      expect(d[2]).toBe(0);
    });

    it('a single die can never trigger escalation, so a lone Glance does nothing', () => {
      const d = computeVehicleHullPointDistribution(1, 0.25, 0.25, 0, 2, 3);
      expect(d[0]).toBeCloseTo(0.75, 9); // miss or Glance
      expect(d[2]).toBeCloseTo(0.25, 9); // Penetrate
    });

    it('higher Damage never lowers the chance of destroying the vehicle', () => {
      let previous = -1;
      for (let dmg = 1; dmg <= 5; dmg++) {
        const d = computeVehicleHullPointDistribution(6, 0.1, 0.1, 0.05, dmg, 4);
        expect(d[4]).toBeGreaterThanOrEqual(previous - 1e-12);
        previous = d[4];
      }
    });

    it('more dice never lower the chance of destroying the vehicle', () => {
      let previous = -1;
      for (let dice = 1; dice <= 12; dice++) {
        const d = computeVehicleHullPointDistribution(dice, 0.1, 0.1, 0.05, 2, 4);
        expect(d[4]).toBeGreaterThanOrEqual(previous - 1e-12);
        previous = d[4];
      }
    });
  });

  describe('computeStatusInflictedProbability', () => {
    it('is 0 when no Glancing Hit can occur', () => {
      expect(computeStatusInflictedProbability(20, 0).stunned).toBe(0);
    });

    it('with one die it is simply a third of the Glance chance', () => {
      expect(computeStatusInflictedProbability(1, 0.3).stunned).toBeCloseTo(0.1, 9);
    });

    it('matches an enumeration of every die being no-status / Stunned / Pinned / Suppressed', () => {
      for (const [dice, p] of [[1, 0.2], [3, 0.2], [4, 0.45], [5, 0.1]]) {
        let atLeastOneStunned = 0;
        const walk = (i, sawStunned, prob) => {
          if (i === dice) { if (sawStunned) atLeastOneStunned += prob; return; }
          walk(i + 1, sawStunned, prob * (1 - p));
          walk(i + 1, true, prob * (p / 3));      // Stunned
          walk(i + 1, sawStunned, prob * (p / 3)); // Pinned
          walk(i + 1, sawStunned, prob * (p / 3)); // Suppressed
        };
        walk(0, false, 1);
        expect(computeStatusInflictedProbability(dice, p).stunned).toBeCloseTo(atLeastOneStunned, 9);
      }
    });

    it('Stunned, Pinned and Suppressed are always equally likely', () => {
      const s = computeStatusInflictedProbability(7, 0.37);
      expect(s.pinned).toBe(s.stunned);
      expect(s.suppressed).toBe(s.stunned);
    });

    it('certain Glances give 1 - (2/3)^N', () => {
      for (const n of [1, 2, 5, 12]) {
        expect(computeStatusInflictedProbability(n, 1).stunned).toBeCloseTo(1 - Math.pow(2 / 3, n), 9);
      }
    });

    it('grows with the number of dice but never exceeds 1', () => {
      let previous = -1;
      for (let n = 1; n <= 30; n++) {
        const p = computeStatusInflictedProbability(n, 0.2).stunned;
        expect(p).toBeGreaterThanOrEqual(previous);
        expect(p).toBeLessThanOrEqual(1);
        previous = p;
      }
    });
  });

  describe('vehicle shooting — full pipeline', () => {
    const pipeline = ({ hitNeed, S, AV, invuln = 7, cover = 7, mitFail = 1, dice, dmg, hp, rules = [] }) => {
      const atk = resolveVehicleAttackProbabilities(hitNeed, S, AV, null, [], rules, dice);
      const out = resolveVehicleFinalOutcomeProbabilities(atk.pGlance, atk.pPenetrateNormal, atk.pPenetrateCritical, invuln, cover, mitFail);
      return {
        atk, out,
        hull: computeVehicleHullPointDistribution(dice, out.pGlanceUnsaved, out.pPenetrateNormalUnsaved, out.pPenetrateCriticalUnsaved, dmg, hp),
        status: computeStatusInflictedProbability(dice, out.pGlanceUnsaved),
      };
    };

    it('hand-derived single die: BS4, S7 vs AV12, Damage 2, 3 Hull Points', () => {
      // hit 4/6; Glance 1/6 and Penetrate 1/6 of hits => 1/9 each. One Glance cannot escalate.
      const r = pipeline({ hitNeed: needForBS(4), S: 7, AV: 12, dice: 1, dmg: 2, hp: 3 });
      expect(r.hull[0]).toBeCloseTo(8 / 9, 9);
      expect(r.hull[1]).toBeCloseTo(0, 9);
      expect(r.hull[2]).toBeCloseTo(1 / 9, 9);
      expect(r.hull[3]).toBeCloseTo(0, 9);
      expect(r.status.stunned).toBeCloseTo(1 / 27, 9);
    });

    it('Snap Shots and a 4+ Invulnerable Save are two routes to the same per-die chance, and give identical results', () => {
      const viaSnapShots = pipeline({ hitNeed: needForBSSnapShot(4), S: 7, AV: 12, dice: 6, dmg: 2, hp: 3 });
      const viaSave = pipeline({ hitNeed: needForBS(4), S: 7, AV: 12, invuln: 4, dice: 6, dmg: 2, hp: 3 });
      for (let k = 0; k <= 3; k++) expect(viaSnapShots.hull[k]).toBeCloseTo(viaSave.hull[k], 9);
      expect(viaSnapShots.status.stunned).toBeCloseTo(viaSave.status.stunned, 9);
    });

    it('a weapon that cannot reach AV does nothing at all', () => {
      const r = pipeline({ hitNeed: needForBS(4), S: 4, AV: 12, dice: 30, dmg: 3, hp: 4 });
      expect(r.hull[0]).toBeCloseTo(1, 9);
      expect(r.status.stunned).toBe(0);
    });
  });

  describe('computeStatusInflictedProbability — with a Shock trigger', () => {
    // shock = { status, pTrigger, pHit }: pTrigger is the chance per die that Shock fires
    // (a hit whose unmodified roll is a 5 or 6), pHit the chance per die of a hit at all.
    const SHOCK = (status, pTrigger, pHit) => ({ status, pTrigger, pHit });
    const STATUSES = ['stunned', 'pinned', 'suppressed'];

    it('without a shock argument behaves exactly as before', () => {
      expect(computeStatusInflictedProbability(6, 0.2, null)).toEqual(computeStatusInflictedProbability(6, 0.2));
    });

    it('raises only the shocked status; the other two still come from Glancing Hits alone', () => {
      const base = computeStatusInflictedProbability(5, 0.2);
      for (const status of STATUSES) {
        const r = computeStatusInflictedProbability(5, 0.2, SHOCK(status, 1 / 3, 2 / 3));
        expect(r[status]).toBeGreaterThan(base[status]);
        for (const other of STATUSES.filter((s) => s !== status)) expect(r[other]).toBe(base[other]);
      }
    });

    it('hand-derived: a hit that both triggers Shock and Glances is counted once', () => {
      // trigger 1/3 per die; otherwise the die hits 1/3 of the time, and an unsaved Glance is
      // 0.15 of hits, rolling the shocked status a third of those: q = 1/3 + (1/3)(0.15)(1/3) = 0.35
      const shock = SHOCK('pinned', 1 / 3, 2 / 3);
      expect(computeStatusInflictedProbability(1, 0.1, shock).pinned).toBeCloseTo(0.35, 9);
      expect(computeStatusInflictedProbability(2, 0.1, shock).pinned).toBeCloseTo(1 - 0.65 * 0.65, 9);
    });

    it('a certain trigger makes the status certain', () => {
      expect(computeStatusInflictedProbability(3, 0, SHOCK('suppressed', 1, 1)).suppressed).toBeCloseTo(1, 9);
    });

    it('a zero trigger chance changes nothing', () => {
      expect(computeStatusInflictedProbability(4, 0.2, SHOCK('stunned', 0, 0.5))).toEqual(computeStatusInflictedProbability(4, 0.2));
    });

    it('ignores a status that is not a Vehicle status', () => {
      expect(computeStatusInflictedProbability(4, 0.2, SHOCK('burning', 0.5, 0.5))).toEqual(computeStatusInflictedProbability(4, 0.2));
    });

    it('is safe when no hit is possible (no NaN)', () => {
      const r = computeStatusInflictedProbability(5, 0, SHOCK('pinned', 0, 0));
      expect(r.pinned).toBe(0);
    });

    it('grows with the number of dice but never exceeds 1', () => {
      let previous = -1;
      for (let n = 1; n <= 30; n++) {
        const p = computeStatusInflictedProbability(n, 0.1, SHOCK('stunned', 1 / 6, 1 / 2)).stunned;
        expect(p).toBeGreaterThanOrEqual(previous);
        expect(p).toBeLessThanOrEqual(1);
        previous = p;
      }
    });
  });
});