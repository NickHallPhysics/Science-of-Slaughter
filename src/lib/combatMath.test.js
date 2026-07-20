import { describe, it, expect } from 'vitest';
import {
  needForBS,
  pFromNeed,
  needForWound,
  resolveHitAndWound,
  resolveSave,
  resolveAttackProbabilities,
  resolveFinalOutcomeProbabilities,
  computeModelsRemovedWithFireGroups,
  applyWoundGroupToState,
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
    const { categories } = resolveAttackProbabilities(4, 1, 20, [
      { id: 'rending', value: 4 },
      { id: 'shred', value: 6 },
    ]);
    const totalWound = categories.Breach_Shred + categories.Breach_noShred + categories.noBreach_Shred + categories.noBreach_noShred;
    const totalShred = categories.noBreach_Shred + categories.Breach_Shred;
    expect(totalShred).toBeCloseTo(totalWound, 9);
  });

  it('Poisoned success does not automatically shred (needs the real roll to also clear X)', () => {
    const { categories } = resolveAttackProbabilities(4, 1, 20, [
      { id: 'poisoned', value: 2 },
      { id: 'shred', value: 6 },
    ]);
    const totalWound = categories.Breach_Shred + categories.Breach_noShred + categories.noBreach_Shred + categories.noBreach_noShred;
    const totalShred = categories.noBreach_Shred + categories.Breach_Shred;
    expect(totalWound).toBeGreaterThan(totalShred);
  });

  it('Breach and Shred can occur independently on the same wound', () => {
    const { categories } = resolveAttackProbabilities(4, 6, 4, [
      { id: 'breaching', value: 3 },
      { id: 'shred', value: 3 },
    ]);
    expect(categories.Breach_Shred).toBeGreaterThan(0);
  });
});