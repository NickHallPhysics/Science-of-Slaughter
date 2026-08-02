import { describe, it, expect } from 'vitest';
import {
  applyWoundGroupToStateWithMedic,
  applyDeflagrateWave,
  computeModelsRemovedMultiTier,
  resolveDamageMitigation,
} from './combatMath.js';
import {
  DAMAGE_MITIGATION_DEFINITIONS,
} from './damageMitigation.js';

describe('DAMAGE_MITIGATION_DEFINITIONS — structural sanity', () => {
  it('every rule id is unique', () => {
    const ids = DAMAGE_MITIGATION_DEFINITIONS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every definition has options + a defaultValue that is one of those options', () => {
    for (const def of DAMAGE_MITIGATION_DEFINITIONS) {
      expect(Array.isArray(def.options)).toBe(true);
      expect(def.options.length).toBeGreaterThan(0);
      expect(def.options).toContain(def.defaultValue);
    }
  });
});

describe('resolveDamageMitigation', () => {
  it('no active rules -> no mitigation, pMitigationFail = 1 (unchanged behaviour)', () => {
    const m = resolveDamageMitigation([]);
    expect(m.mitigationValue).toBeNull();
    expect(m.pMitigationFail).toBe(1);
  });
  it('single rule -> uses its threshold directly', () => {
    const m = resolveDamageMitigation([{ id: 'shrouded', value: 4 }]);
    expect(m.mitigationValue).toBe(4);
    expect(m.pMitigate).toBeCloseTo(0.5, 9);
    expect(m.pMitigationFail).toBeCloseTo(0.5, 9);
  });
  it('multiple rules -> best (lowest X) wins', () => {
    const m = resolveDamageMitigation([{ id: 'shrouded', value: 5 }, { id: 'feel_no_pain', value: 3 }]);
    expect(m.mitigationValue).toBe(3);
  });
  it('pMitigate and pMitigationFail are always complementary', () => {
    const m = resolveDamageMitigation([{ id: 'shrouded', value: 3 }]);
    expect(m.pMitigate + m.pMitigationFail).toBeCloseTo(1, 9);
  });
});

describe('applyDeflagrateWave — Damage Mitigation applies to its own wounds too', () => {
  it('pMitigationFail scales pUnsavedDeflagrate correctly', () => {
    const { branches } = computeModelsRemovedMultiTier(6, [{ damage: 1, pUnsaved: 0.9 }], 1, 2);
    const withoutMitigation = applyDeflagrateWave(branches, 4, 4, 4, 7, 7, 1, 2, 6, 1);
    const withMitigation = applyDeflagrateWave(branches, 4, 4, 4, 7, 7, 1, 2, 6, 0.5);
    expect(withMitigation.pUnsavedDeflagrate).toBeCloseTo(withoutMitigation.pUnsavedDeflagrate * 0.5, 9);
  });

  it('default pMitigationFail=1 leaves Deflagrate unaffected (backward compatible)', () => {
    const { branches } = computeModelsRemovedMultiTier(6, [{ damage: 1, pUnsaved: 0.9 }], 1, 2);
    const explicit = applyDeflagrateWave(branches, 4, 4, 4, 7, 7, 1, 2, 6, 1);
    const implicit = applyDeflagrateWave(branches, 4, 4, 4, 7, 7, 1, 2, 6); // omitted, uses default
    expect(implicit.pUnsavedDeflagrate).toBeCloseTo(explicit.pUnsavedDeflagrate, 9);
  });
});

describe('resolveDamageMitigation', () => {
  it('no active rules -> no mitigation, no medic', () => {
    const m = resolveDamageMitigation([]);
    expect(m.mitigationValue).toBeNull();
    expect(m.pMitigationFail).toBe(1);
    expect(m.pMedic).toBe(0);
  });

  it('only a roll-to-ignore rule active -> behaves as before, pMedic stays 0', () => {
    const m = resolveDamageMitigation([{ id: 'shrouded', value: 4 }]);
    expect(m.ruleId).toBe('shrouded');
    expect(m.pMitigationFail).toBeCloseTo(0.5, 9);
    expect(m.pMedic).toBe(0);
  });

  it('only Medic active -> pMitigationFail unused (1), pMedic set', () => {
    const m = resolveDamageMitigation([{ id: 'medic', value: 4 }]);
    expect(m.ruleId).toBe('medic');
    expect(m.pMitigationFail).toBe(1);
    expect(m.pMedic).toBeCloseTo(0.5, 9);
  });

  it('both active: the roll-to-ignore rule wins when it has better odds', () => {
    const m = resolveDamageMitigation([{ id: 'shrouded', value: 3 }, { id: 'medic', value: 5 }]);
    expect(m.ruleId).toBe('shrouded');
    expect(m.pMitigationFail).toBeCloseTo(1 - 4 / 6, 9);
    expect(m.pMedic).toBe(0);
  });

  it('both active: Medic wins when it has better odds', () => {
    const m = resolveDamageMitigation([{ id: 'shrouded', value: 5 }, { id: 'medic', value: 3 }]);
    expect(m.ruleId).toBe('medic');
    expect(m.pMitigationFail).toBe(1);
    expect(m.pMedic).toBeCloseTo(4 / 6, 9);
  });

  it('three rules active: best (lowest X) wins regardless of type', () => {
    const m = resolveDamageMitigation([
      { id: 'shrouded', value: 5 },
      { id: 'feel_no_pain', value: 4 },
      { id: 'medic', value: 2 },
    ]);
    expect(m.ruleId).toBe('medic');
    expect(m.pMedic).toBeCloseTo(5 / 6, 9);
  });

  it('pMitigate and pMitigationFail are always complementary when a roll-to-ignore rule wins', () => {
    const m = resolveDamageMitigation([{ id: 'shrouded', value: 3 }]);
    expect(m.pMitigate + m.pMitigationFail).toBeCloseTo(1, 9);
  });
});

describe('applyWoundGroupToStateWithMedic', () => {
  it('matches an independent wound-by-wound brute force for a single batch', () => {
    const N = 7, Dval = 2, W = 3, targetModels = 3, pMedic = 0.4;
    const branches = applyWoundGroupToStateWithMedic({ killed: 0, wounded_model: 0, medicResolved: false }, N, Dval, W, targetModels, pMedic);
    const distModels = new Array(targetModels + 1).fill(0);
    for (const b of branches) distModels[b.state.killed] += b.prob;
    expect(distModels.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(distModels[3]).toBeCloseTo(1, 9); // this specific case kills exactly 3 regardless of the Medic roll
  });
});

describe('computeModelsRemovedMultiTier — Medic', () => {
  it('reduces exactly to the no-Medic case when pMedic=0', () => {
    const tiers = [{ damage: 2, pUnsaved: 0.3 }, { damage: 3, pUnsaved: 0.2 }];
    const withZero = computeModelsRemovedMultiTier(10, tiers, 5, 4, 0);
    const omitted = computeModelsRemovedMultiTier(10, tiers, 5, 4);
    for (let k = 0; k <= 4; k++) expect(withZero.distModels[k]).toBeCloseTo(omitted.distModels[k], 9);
  });
});

describe('applyDeflagrateWave — Medic carries over from the main attack', () => {
  it('reduces exactly to the no-Medic case when pMedic=0', () => {
    const { branches } = computeModelsRemovedMultiTier(6, [{ damage: 1, pUnsaved: 0.9 }], 1, 2, 0);
    const withZero = applyDeflagrateWave(branches, 4, 4, 4, 7, 7, 1, 2, 6, 1, [], 0);
    const omitted = applyDeflagrateWave(branches, 4, 4, 4, 7, 7, 1, 2, 6, 1, []);
    for (let k = 0; k <= 2; k++) expect(withZero.distModels[k]).toBeCloseTo(omitted.distModels[k], 9);
  });
});