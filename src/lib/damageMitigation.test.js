import { describe, it, expect } from 'vitest';
import {
  applyDeflagrateWave,
  computeModelsRemovedMultiTier,
  resolveDamageMitigation,
} from './combatMath.js';
import {
  DAMAGE_MITIGATION_DEFINITIONS,
} from './damageMitigation.js';

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
    const m = resolveDamageMitigation([{ id: 'shrouded', value: 5 }, { id: 'otherRule', value: 3 }]);
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