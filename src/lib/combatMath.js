/**
 * combatMath.js
 * Pure probability functions for the shooting-phase resolver.
 * No DOM, no Chart.js, no React — every export here is a plain function
 * of its arguments, imported directly by both App.jsx and combatMath.test.js.
 * There is exactly one copy of this logic in the whole project.
 */

// ---------- to-hit / to-wound tables ----------

import {
  SPECIAL_RULE_DEFINITIONS,
} from './specialRules.js';

/** D6 result needed to hit, given Ballistic Skill. Returns null for BS10 (auto-hit). */
export function needForBS(bs) {
  if (bs <= 1) return 6;
  if (bs === 2) return 5;
  if (bs === 3) return 4;
  if (bs === 4) return 3;
  if (bs >= 5 && bs <= 9) return 2;
  return null; // BS 10 = automatic hit
}

/** Convert a "needs N+" value into a probability. null means "always succeeds". */
export function pFromNeed(need) {
  return need === null ? 1 : (7 - need) / 6;
}

/** D6 result needed to wound, given Strength vs Toughness. Returns null if wounding is impossible. */
export function needForWound(S, T) {
  const diff = S - T;
  if (diff >= 2) return 2;
  if (diff === 1) return 3;
  if (diff === 0) return 4;
  if (diff === -1) return 5;
  if (diff === -2) return 6;
  return null; // S <= T-3: cannot wound
}

/**
 * Resolve the combined hit/wound probabilities for an attack, accounting
 * for special rules (i.e. Rending (X)) if present. Returns the two numbers 
 * you feed straight into binomialPMF(totalDice, pHit) and propagate(distHits, pWound) —
 * the rest of the pipeline is unchanged.
 *
 * @param {number} bs
 * @param {number} S
 * @param {number} T
 * @param {Array<{id: string, value: number}>} activeRules
 */
/**
 * @returns {{ pHit, pWound, pBreachWound, pNoBreachWound, hitNeed, wNeed }}
 * pWound = P(wound | hit) — unchanged meaning from before.
 * pBreachWound = P(wound AND breach | hit)
 * pNoBreachWound = P(wound AND NOT breach | hit)
 * pBreachWound + pNoBreachWound === pWound, always.
 */
export function resolveHitAndWound(bs, S, T, activeRules = []) {
  const hitNeed = needForBS(bs);
  const wNeed = needForWound(S, T);

  const rendingRule = activeRules.find((r) => r.id === 'rending');
  const poisonedRule = activeRules.find((r) => r.id === 'poisoned');
  const breachingRule = activeRules.find((r) => r.id === 'breaching');

  const poisonThreshold = poisonedRule ? poisonedRule.value : 7; // 7 = "never"
  const wThreshold = wNeed === null ? 7 : wNeed;
  const m = Math.min(wThreshold, poisonThreshold); // effective wound-success threshold (real die)
  const X = breachingRule ? breachingRule.value : null; // breach threshold, or null if absent

  // helper: P(a real d6 roll >= threshold), threshold possibly > 6 meaning "never"
  const pAtLeast = (threshold) => (threshold <= 6 ? (7 - threshold) / 6 : 0);

  // BS10: hit die is assumed to be a natural 6.
  if (hitNeed === null) {
    if (rendingRule) {
      // Natural 6 hit die always satisfies Rending's X (X is always <= 6),
      // so the wound is forced regardless of Toughness/Poisoned/anything else.
      return {
        pHit: 1,
        pWound: 1,
        pBreachWound: X !== null ? 1 : 0,
        pNoBreachWound: X !== null ? 0 : 1,
        hitNeed, wNeed,
      };
    }
    const pWound = pAtLeast(m);
    const pBreachWound = X !== null ? pAtLeast(Math.max(m, X)) : 0;
    return {
      pHit: 1,
      pWound,
      pBreachWound,
      pNoBreachWound: pWound - pBreachWound,
      hitNeed, wNeed,
    };
  }

  if (!rendingRule) {
    const pHit = pFromNeed(hitNeed);
    const pWound = pAtLeast(m);
    const pBreachWound = X !== null ? pAtLeast(Math.max(m, X)) : 0;
    return { pHit, pWound, pBreachWound, pNoBreachWound: pWound - pBreachWound, hitNeed, wNeed };
  }

  // Rending present: split hits into rending-portion (auto-wound, auto-breach) and
  // normal-portion (real roll, subject to m and X as usual).
  const Xr = rendingRule.value;
  const effHitNeed = Math.min(hitNeed, Xr);
  const pHit = pFromNeed(effHitNeed);

  const pRendPortion = pAtLeast(Xr);          // unconditional-per-die
  const pNormalPortion = pHit - pRendPortion; // unconditional-per-die

  const pNormalWound = pAtLeast(m);
  const pNormalBreachWound = X !== null ? pAtLeast(Math.max(m, X)) : 0;

  const pWoundTotal = pRendPortion * 1 + pNormalPortion * pNormalWound;
  const pBreachWoundTotal = pRendPortion * (X !== null ? 1 : 0) + pNormalPortion * pNormalBreachWound;

  return {
    pHit,
    pWound: pHit > 0 ? pWoundTotal / pHit : 0,
    pBreachWound: pHit > 0 ? pBreachWoundTotal / pHit : 0,
    pNoBreachWound: pHit > 0 ? (pWoundTotal - pBreachWoundTotal) / pHit : 0,
    hitNeed, wNeed,
  };
}

/**
 * Resolve which save (if any) applies, and the probability a wound gets through.
 * armour/invuln/cover are the D6 values needed (2-6), or 7 to mean "none".
 * Per the house rule: Armour can only be used if AP > armour save value.
 */
export function resolveSave(AP, armour, invuln, cover) {
  const armourUsable = AP > armour;
  const candidates = [];
  if (armourUsable) candidates.push({ value: armour, source: 'Armour' });
  if (invuln < 7) candidates.push({ value: invuln, source: 'Invulnerable' });
  if (cover < 7) candidates.push({ value: cover, source: 'Cover' });

  if (candidates.length === 0) {
    return { saveValue: null, source: null, pSave: 0, pUnsaved: 1, armourUsable };
  }
  const best = candidates.reduce((a, b) => (b.value < a.value ? b : a));
  const pSave = best.value <= 6 ? (7 - best.value) / 6 : 0;
  return { saveValue: best.value, source: best.source, pSave, pUnsaved: 1 - pSave, armourUsable };
}

/**
 * Combine breach/no-breach wound probabilities with their respective saves.
 * Breaching forces AP to 2 for the save roll only — nothing else changes.
 */
export function resolveUnsavedGivenHit(pBreachWound, pNoBreachWound, ap, armour, invuln, cover) {
  const saveNormal = resolveSave(ap, armour, invuln, cover);
  const saveBreach = resolveSave(2, armour, invuln, cover); // AP2 override
  const pUnsavedGivenHit = pBreachWound * saveBreach.pUnsaved + pNoBreachWound * saveNormal.pUnsaved;
  return { pUnsavedGivenHit, saveNormal, saveBreach };
}

// ---------- probability distributions ----------

/**
 * Binomial PMF: probability of exactly k successes in n independent trials
 * at success probability p, for k = 0..n. Built iteratively (not via
 * factorials/combinations) so it stays numerically stable for large n.
 */
export function binomialPMF(n, p) {
  const out = new Array(n + 1).fill(0);
  if (p <= 0) { out[0] = 1; return out; }
  if (p >= 1) { out[n] = 1; return out; }
  out[0] = Math.pow(1 - p, n);
  for (let k = 1; k <= n; k++) {
    out[k] = out[k - 1] * (n - k + 1) / k * (p / (1 - p));
  }
  // guard against floating-point drift so the distribution still sums to 1
  let sum = 0;
  for (let k = 0; k <= n; k++) sum += out[k];
  if (sum > 0) for (let k = 0; k <= n; k++) out[k] /= sum;
  return out;
}

/**
 * Propagate a distribution over "n trials available" through a per-trial
 * success probability p. distIn[n] = probability of exactly n trials at
 * this stage; returns the marginal distribution of successes, same length.
 * (Mathematically equivalent to summing weighted binomials over n.)
 */
export function propagate(distIn, p) {
  const N = distIn.length - 1;
  const out = new Array(N + 1).fill(0);
  for (let n = 0; n <= N; n++) {
    const pn = distIn[n];
    if (pn <= 1e-14) continue;
    const pmf = binomialPMF(n, p);
    for (let k = 0; k <= n; k++) {
      out[k] += pn * pmf[k];
    }
  }
  return out;
}

/** Expected value of a distribution indexed by outcome count. */
export function mean(dist) {
  let m = 0;
  for (let k = 0; k < dist.length; k++) m += k * dist[k];
  return m;
}

/** cdf[k] = P(X >= k), i.e. "at least k" cumulative probability. */
export function cdfAtLeast(dist) {
  const N = dist.length - 1;
  const out = new Array(N + 1).fill(0);
  let running = 0;
  for (let k = N; k >= 0; k--) {
    running += dist[k];
    out[k] = running;
  }
  return out;
}

// ---------- casualty mapping ----------

/**
 * Map a distribution of unsaved-wound counts to a distribution of models
 * removed. A model dies after ceil(W/D) unsaved wounds; damage does not
 * spill over to the next model; kills are capped at targetModels.
 */
export function computeModelsRemoved(distUnsaved, W, D, targetModels) {
  const hitsPerKill = Math.ceil(W / D);
  const N = distUnsaved.length - 1;
  const distModels = new Array(targetModels + 1).fill(0);
  for (let k = 0; k <= N; k++) {
    const killed = Math.min(Math.floor(k / hitsPerKill), targetModels);
    distModels[killed] += distUnsaved[k];
  }
  return { distModels, hitsPerKill };
}
