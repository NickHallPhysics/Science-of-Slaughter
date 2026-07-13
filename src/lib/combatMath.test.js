import { describe, it, expect } from 'vitest';
import {
  needForBS,
  pFromNeed,
  needForWound,
  resolveSave,
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
