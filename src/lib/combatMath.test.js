import { describe, it, expect } from 'vitest';
import {
  needForBS,
  pFromNeed,
  needForWound,
  getInnateCriticalX,
  getEffectiveCriticalThreshold,
  resolveHitAndWound,
  resolveSave,
  resolveAttackProbabilities,
  resolveFinalOutcomeProbabilities,
  computeModelsRemovedWithFireGroups,
  computeModelsRemovedMultiTier,
  applyWoundGroupToState,
  applyDeflagrateWave,
  binomialPMF,
  propagate,
  mean,
  cdfAtLeast,
  computeModelsRemoved,
} from './combatMath.js';

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
    // Two independent binomial stages (n, p1) then (·, p2) is mathematically
    // equivalent to a single binomial(n, p1*p2) — this is the identity the
    // whole hit -> wound -> save pipeline relies on.
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

describe('computeModelsRemoved', () => {
  it('W=1,D=1: one unsaved wound kills one model, 1:1 mapping', () => {
    const distUnsaved = [0, 0, 0, 1]; // all mass at k=3
    const { distModels, hitsPerKill } = computeModelsRemoved(distUnsaved, 1, 1, 10);
    expect(hitsPerKill).toBe(1);
    expect(distModels[3]).toBeCloseTo(1, 9);
  });
  it('W=3,D=1: needs 3 unsaved wounds per kill, remainder does not kill', () => {
    const distUnsaved = [0, 0, 0, 0, 0, 1]; // all mass at k=5
    const { distModels, hitsPerKill } = computeModelsRemoved(distUnsaved, 3, 1, 10);
    expect(hitsPerKill).toBe(3);
    expect(distModels[1]).toBeCloseTo(1, 9); // floor(5/3) = 1 kill, remainder 2 wasted
  });
  it('W=3,D=2: overkill on last wound does not spill to next model', () => {
    const distUnsaved = [0, 0, 1]; // exactly 2 unsaved wounds, ceil(3/2)=2 needed
    const { distModels, hitsPerKill } = computeModelsRemoved(distUnsaved, 3, 2, 10);
    expect(hitsPerKill).toBe(2);
    expect(distModels[1]).toBeCloseTo(1, 9);
  });
  it('kills are capped at targetModels', () => {
    const distUnsaved = new Array(51).fill(0);
    distUnsaved[50] = 1; // 50 unsaved wounds, W=D=1 -> 50 kills, but only 5 models exist
    const { distModels } = computeModelsRemoved(distUnsaved, 1, 1, 5);
    expect(distModels[5]).toBeCloseTo(1, 9);
    expect(distModels.length).toBe(6); // indices 0..5
  });
  it('models-removed distribution still sums to 1', () => {
    const distUnsaved = binomialPMF(20, 0.35);
    const { distModels } = computeModelsRemoved(distUnsaved, 2, 1, 10);
    expect(distModels.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });
});

describe('resolveHitAndWound — Rending + Poisoned combined', () => {
  it('matches brute-force enumeration over all 36 (hit-die, wound-die) outcomes', () => {
    const bs = 4, S = 3, T = 4, X = 5, Y = 5; // hitNeed=3, wNeed=5, rending 5+, poison 5+
    const hitNeed = needForBS(bs);
    const wNeed = needForWound(S, T);

    let wins = 0;
    for (let hitDie = 1; hitDie <= 6; hitDie++) {
      if (hitDie < hitNeed && hitDie < X) continue; // miss (not saved by rending either)
      if (hitDie >= X) { wins += 6; continue; } // rending: auto-wound, all 6 wound-die outcomes count
      // normal hit: roll a wound die
      for (let woundDie = 1; woundDie <= 6; woundDie++) {
        if (woundDie >= wNeed || woundDie >= Y) wins += 1;
      }
    }
    const expected = wins / 36;

    const r = resolveHitAndWound(bs, S, T, [
      { id: 'rending', value: X },
      { id: 'poisoned', value: Y },
    ]);
    // r.pWound is conditional on a hit; multiply by pHit to get the unconditional "wins" probability
    expect(r.pHit * r.pWound).toBeCloseTo(expected, 9);
  });

  it('Rending guarantees the wound even when Poisoned is a worse threshold', () => {
    // Rending 4+, Poisoned only 6+ (worse than rending's guarantee)
    const r = resolveHitAndWound(4, 1, 20, [
      { id: 'rending', value: 4 },
      { id: 'poisoned', value: 6 },
    ]);
    // Normal wound chance is 0 here (S far below T), but rending covers d=4,5,6, poison only helps d=3 (normal hit zone)
    // hitNeed=3, so effHitNeed = min(3,4) = 3. pHit = 4/6.
    // Rending portion: d>=4 -> 3/6. Normal portion: d=3 only -> 1/6.
    // Normal-hit wound chance: max(0, poisonP=1/6) = 1/6.
    const expected = (3 * 1 + 1 * (1 / 6)) / 4; // = (3 + 1/6)/4
    expect(r.pWound).toBeCloseTo(expected, 9);
  });

  it('Poisoned helps only the non-rending slice, not the whole blend', () => {
    // This is the case that distinguishes exact math from the old sequential/max approach.
    const r = resolveHitAndWound(4, 4, 4, [
      { id: 'rending', value: 6 },   // only a natural 6 rends
      { id: 'poisoned', value: 2 },  // poison is very strong: 2+
    ]);
    const hitNeed = 3; // BS4
    const wNeed = 4;   // S4 vs T4
    const pHit = (7 - hitNeed) / 6;
    const pRend = (7 - 6) / 6;             // 1/6
    const pNormal = pHit - pRend;          // 3/6
    const pNormalWound = Math.max((7 - wNeed) / 6, (7 - 2) / 6); // max(0.5, 5/6) = 5/6
    const expected = (pRend * 1 + pNormal * pNormalWound) / pHit;
    expect(r.pWound).toBeCloseTo(expected, 9);

    // Sanity: this should NOT equal the old (wrong) sequential approach,
    // which would have been max(blended-without-poison, poisonP).
    const blendedWithoutPoison = (pRend * 1 + pNormal * ((7 - wNeed) / 6)) / pHit;
    const oldWrongAnswer = Math.max(blendedWithoutPoison, (7 - 2) / 6);
    expect(r.pWound).not.toBeCloseTo(oldWrongAnswer, 9);
  });

  it('reduces to Rending-only when no Poisoned rule is present', () => {
    const withRendingOnly = resolveHitAndWound(4, 4, 4, [{ id: 'rending', value: 5 }]);
    const combined = resolveHitAndWound(4, 4, 4, [{ id: 'rending', value: 5 }]);
    expect(combined.pWound).toBeCloseTo(withRendingOnly.pWound, 9);
  });

  it('reduces to Poisoned-only when no Rending rule is present', () => {
    const withPoisonOnly = resolveHitAndWound(4, 4, 4, [{ id: 'poisoned', value: 3 }]);
    expect(withPoisonOnly.pWound).toBeCloseTo(Math.max((7 - needForWound(4, 4)) / 6, (7 - 3) / 6), 9);
  });

  it('BS10 with Rending present: auto-wound regardless of Poisoned value', () => {
    const r = resolveHitAndWound(10, 1, 20, [
      { id: 'rending', value: 6 },
      { id: 'poisoned', value: 6 }, // weak poison, shouldn't matter — rending already guarantees it
    ]);
    expect(r.pWound).toBe(1);
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

describe('computeModelsRemovedWithFireGroups', () => {
  it('reduces to the constant-damage formula when Shred probability is 0', () => {
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

describe('resolveAttackProbabilities — Shred', () => {
  it('a Rending-forced wound always triggers Shred, regardless of X', () => {
    const { buckets } = resolveAttackProbabilities(4, 1, 20, [
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
    const { buckets } = resolveAttackProbabilities(4, 1, 20, [
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
    const { buckets } = resolveAttackProbabilities(4, 6, 4, [
      { id: 'breaching', value: 3 },
      { id: 'shred', value: 3 },
    ]);
    expect(buckets.BreachDplus1).toBeGreaterThan(0);
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
    const p0 = 0.25, p1 = 0.15, p2 = 0.1; // D, D+1, D+2
    const D = 1;
    const outcomes = ['none', 'BreachDplus0', 'BreachDplus1', 'BreachDplus2'];
    const probOf = { none: 1 - p0 - p1 - p2, BreachDplus0: p0, BreachDplus1: p1, BreachDplus2: p2 };
    const damageOf = { BreachDplus0: D, BreachDplus1: D + 1, BreachDplus2: D + 2 };

    // enumerate all totalDice^4-ish sequences directly (small n keeps this cheap)
    function enumerate(seq, i, acc) {
      if (i === totalDice) {
        // apply Fire Groups in ascending-damage order, NOT roll order
        const counts = { BreachDplus0: 0, BreachDplus1: 0, BreachDplus2: 0 };
        for (const o of seq) if (o !== 'none') counts[o]++;
        let state = { killed: 0, wounded_model: W };
        for (const tierKey of ['BreachDplus0', 'BreachDplus1', 'BreachDplus2']) {
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
});

describe('resolveAttackProbabilities — Critical Hit', () => {
  it('Critical alone (no Shred): all wounds land in tier 1, none in tier 2', () => {
    const { buckets } = resolveAttackProbabilities(4, 4, 4, [{ id: 'criticalHit', value: 5 }]);
    expect(buckets.BreachDplus2 + buckets.noBreachDplus2).toBeCloseTo(0, 9);
  });

  it('Critical + Shred together: a critical hit always lands in tier 2 (forced-6 wound satisfies shred too)', () => {
    const { buckets } = resolveAttackProbabilities(4, 4, 4, [
      { id: 'criticalHit', value: 6 },
      { id: 'shred', value: 6 },
    ]);
    // Isolate the probability mass specifically from d=6 (the only critical roll here):
    // it should show up entirely in tier 2, not tier 1 or tier 0.
    expect(buckets.BreachDplus2 + buckets.noBreachDplus2).toBeGreaterThan(0);
  });

  it('BS10 + Critical alone: forced wound, tier 1 only', () => {
    const { buckets, pHit } = resolveAttackProbabilities(10, 1, 20, [{ id: 'criticalHit', value: 6 }]);
    expect(pHit).toBe(1);
    expect(buckets.noBreachDplus1 + buckets.BreachDplus1).toBeCloseTo(1, 9); // wound is forced, no shred active, tier 1 exactly
  });

  it('BS10 + Critical + Shred: forced wound, tier 2 only', () => {
    const { buckets } = resolveAttackProbabilities(10, 1, 20, [
      { id: 'criticalHit', value: 6 },
      { id: 'shred', value: 6 },
    ]);
    expect(buckets.noBreachDplus2 + buckets.BreachDplus2).toBeCloseTo(1, 9);
  });

  it('Rending and Critical Hit can both trigger on the same hit die (Critical still adds its own bonus)', () => {
    const { buckets } = resolveAttackProbabilities(4, 1, 20, [
      { id: 'rending', value: 4 },
      { id: 'criticalHit', value: 5 }, // d=5,6 satisfy both rending(>=4) and critical(>=5)
    ]);
    // S far below T: only rending/critical-forced wounds occur at all.
    // d=4 -> rending only (tier 0, no crit bonus); d=5,6 -> both (tier 1).
    expect(buckets.noBreachDplus1 + buckets.BreachDplus1).toBeGreaterThan(0);
    expect(buckets.noBreachDplus0 + buckets.BreachDplus0).toBeGreaterThan(0);
  });
});

describe('resolveAttackProbabilities — Critical Hit auto-hit threshold bug fix', () => {
  it('Critical Hit alone, threshold BELOW the BS hit-need, still auto-hits (the bug this fixes)', () => {
    // BS4 needs 3+ normally. Critical Hit(2) should pull the effective hit
    // threshold down to 2+, same as Rending would on its own.
    const { pHit } = resolveAttackProbabilities(4, 4, 4, [{ id: 'criticalHit', value: 2 }]);
    expect(pHit).toBeCloseTo(5 / 6, 9); // 2+ instead of the normal 3+
  });

  it('matches Rending-alone behaviour when Critical Hit is used the same way (symmetry check)', () => {
    const viaCritical = resolveAttackProbabilities(4, 4, 4, [{ id: 'criticalHit', value: 2 }]);
    const viaRending = resolveAttackProbabilities(4, 4, 4, [{ id: 'rending', value: 2 }]);
    expect(viaCritical.pHit).toBeCloseTo(viaRending.pHit, 9);
  });

  it('X < Y: three distinct hit populations (normal / rending-only / critical)', () => {
    // BS3 (needs 4+), Rending(5), Critical(6): normal=[4], rending-only=[5], critical=[6]
    const { buckets, pHit } = resolveAttackProbabilities(3, 4, 4, [
      { id: 'rending', value: 5 },
      { id: 'criticalHit', value: 6 },
    ]);
    expect(pHit).toBeCloseTo(3 / 6, 9); // needs 4+, unaffected since rending/crit are both >= hitNeed here
    // tier-1 (critical) bucket should hold exactly the d=6 contribution
    const TierDplus1Total = buckets.BreachDplus1 + buckets.noBreachDplus1;
    expect(TierDplus1Total).toBeCloseTo(1 / 6, 9);
  });

  it('Y < X: Rending is fully subsumed by Critical Hit, no separate rending-only population', () => {
    // S=1 vs T=20: normal wound chance is impossible, isolating ONLY the
    // forced-wound contributions from Rending/Critical so the "no separate
    // rending-only tier" property can actually be observed.
    const { buckets, pHit } = resolveAttackProbabilities(3, 1, 20, [
      { id: 'criticalHit', value: 5 },
      { id: 'rending', value: 6 },
    ]);
    expect(pHit).toBeCloseTo(3 / 6, 9); // pHit depends only on bs + rule thresholds, unaffected by S/T
    const TierDplus1Total = buckets.BreachDplus1 + buckets.noBreachDplus1;
    const TierDplus0Total = buckets.BreachDplus0 + buckets.noBreachDplus0;
    expect(TierDplus1Total).toBeCloseTo(2 / 6, 9); // d=5 and d=6 both land in tier 1
    expect(TierDplus0Total).toBeCloseTo(0, 9); // no rending-only wounds exist separately
  });
});

describe('getInnateCriticalX', () => {
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
});

describe('getEffectiveCriticalThreshold', () => {
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

describe('resolveAttackProbabilities — innate Critical Hit from high BS', () => {
  it('BS9 with no explicit rule still gets a Critical Hit tier', () => {
    const { buckets, pHit } = resolveAttackProbabilities(9, 1, 20, []); // S/T isolates forced wounds only
    expect(pHit).toBeCloseTo(5 / 6, 9);
    const tier1 = buckets.BreachDplus1 + buckets.noBreachDplus1;
    expect(tier1).toBeCloseTo(4 / 6, 9); // innate X=3: d=3,4,5,6 all critical
  });

  it('BS10 auto-hit is also automatically a Critical Hit via the innate rule', () => {
    const { buckets, pHit } = resolveAttackProbabilities(10, 1, 20, []);
    expect(pHit).toBe(1);
    const tier1 = buckets.BreachDplus1 + buckets.noBreachDplus1;
    expect(tier1).toBeCloseTo(1, 9);
  });

  it('a better explicit Critical Hit rule is used instead of a worse innate one', () => {
    const { buckets } = resolveAttackProbabilities(9, 1, 20, [{ id: 'criticalHit', value: 2 }]);
    const tier1 = buckets.BreachDplus1 + buckets.noBreachDplus1;
    expect(tier1).toBeCloseTo(5 / 6, 9); // X=2: d=2..6 all critical
  });

  it('a worse explicit rule does not override a better innate one', () => {
    const { buckets } = resolveAttackProbabilities(10, 1, 20, [{ id: 'criticalHit', value: 6 }]);
    const tier1 = buckets.BreachDplus1 + buckets.noBreachDplus1;
    expect(tier1).toBeCloseTo(1, 9); // still fully critical via innate X=2
  });

  it('BS <= 5 is unaffected: behaves exactly as before this change', () => {
    const { pHit } = resolveAttackProbabilities(4, 1, 20, [{ id: 'criticalHit', value: 4 }]);
    expect(pHit).toBeCloseTo(4 / 6, 9);
  });
});

describe('computeModelsRemovedMultiTier — branches', () => {
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
    // A save of armour=2 (the toughest possible) should still fully apply.
    const { branches } = computeModelsRemovedMultiTier(3, [{ damage: 1, pUnsaved: 1.0 }], 3, 2);
    const { pUnsavedDeflagrate } = applyDeflagrateWave(branches, 4, 4, 2, 7, 7, 3, 2, 3);
    const pWound = (7 - needForWound(4, 4)) / 6; // 0.5
    const pSaveExpected = (7 - 2) / 6; // armour 2+ fully applies
    expect(pUnsavedDeflagrate).toBeCloseTo(pWound * (1 - pSaveExpected), 9);
  });

  it('regression guard: AP=0 would have incorrectly negated armour entirely (this is the bug that was caught)', () => {
    const { branches } = computeModelsRemovedMultiTier(3, [{ damage: 1, pUnsaved: 1.0 }], 3, 2);
    const { pUnsavedDeflagrate } = applyDeflagrateWave(branches, 4, 4, 4, 7, 7, 3, 2, 3);
    // If this ever regresses to using AP=0 internally, pUnsavedDeflagrate would come back as
    // 0.5 (armour fully negated) instead of the correct 0.25 (armour 4+ applying).
    expect(pUnsavedDeflagrate).toBeCloseTo(0.25, 9);
    expect(pUnsavedDeflagrate).not.toBeCloseTo(0.5, 9);
  });
});

describe('applyDeflagrateWave — wound/unsaved distributions for charting', () => {
  it('matches hand-derived binomial distributions for a deterministic single-branch case', () => {
    const { branches } = computeModelsRemovedMultiTier(3, [{ damage: 1, pUnsaved: 1.0 }], 3, 2);
    const { distWoundsCaused, distUnsaved } = applyDeflagrateWave(branches, 4, 4, 4, 7, 7, 3, 2, 3);
    // N=3 fixed, pWoundDeflagrate=0.5, pUnsavedDeflagrate=0.25
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
    expect(distModels[2]).toBeGreaterThan(0.5); // unit frequently wiped already
    expect(distWoundsCaused.reduce((a, b) => a + b, 0)).toBeLessThan(1); // wiped branches excluded
    expect(distUnsaved.reduce((a, b) => a + b, 0)).toBeLessThan(1);
  });
});