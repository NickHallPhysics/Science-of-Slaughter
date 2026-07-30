/**
 * combatMath.js
 * Pure probability functions for the shooting-phase resolver.
 * No DOM, no Chart.js, no React — every export here is a plain function
 * of its arguments, imported directly by both App.jsx and combatMath.test.js.
 * There is exactly one copy of this logic in the whole project.
 */

// ---------- to-hit / to-wound tables ----------

/** D6 result needed to hit, given Ballistic Skill. Returns null for BS10 (auto-hit). */
export function needForBS(bs) {
  if (bs <= 1) return 6;
  if (bs === 2) return 5;
  if (bs === 3) return 4;
  if (bs === 4) return 3;
  if (bs >= 5 && bs <= 9) return 2;
  return null; // BS 10 = automatic hit
}

/**
 * D6 result needed to hit when firing a Snap Shot, given Ballistic Skill.
 * Unlike needForBS, this NEVER returns null — even BS10+ requires an
 * actual roll (2+) rather than being an automatic hit, and BS1 is
 * represented as needing an impossible 7+ (Automatic Fail via the BS
 * mechanism itself). Note this doesn't prevent a weapon's own Rending or
 * Critical Hit thresholds from independently forcing a hit, same as they
 * would for a normal shot — Snap Shot only changes what BS alone confers.
 */
export function needForBSSnapShot(bs) {
  if (bs <= 1) return 7; // Automatic Fail
  if (bs <= 3) return 6;
  if (bs <= 5) return 5;
  if (bs <= 7) return 4;
  if (bs <= 9) return 3;
  return 2; // BS10+
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
 * BS values above 5 grant an innate Critical Hit(X) with X = 12 - BS.
 * Values of X above 6 are ignored (not achievable on a d6). Returns null
 * for BS <= 5, where no innate bonus applies.
 */
export function getInnateCriticalX(bs) {
  if (bs <= 5) return null;
  const critThreshold = 12 - bs;
  if (critThreshold > 6) return null;
  if (critThreshold < 2) return 2; // defensive floor; only reachable if bs is pushed past the normal 1-10 range
  return critThreshold;
}

/**
 * The effective Critical Hit(X) threshold for a weapon/unit: the better
 * (lower) of any explicit Critical Hit special rule and the innate
 * Critical Hit granted by high Ballistic Skill. Returns null if neither
 * applies. Snap Shots never confer the innate BS-based Critical Hit —
 * only an explicit Critical Hit(X) rule on the weapon still applies.
 */
export function getEffectiveCriticalThreshold(bs, activeOffensiveRules = [], isSnapShot = false) {
  const criticalRule = activeOffensiveRules.find((r) => r.id === 'criticalHit');
  const innateX = isSnapShot ? null : getInnateCriticalX(bs);
  const explicitX = criticalRule ? criticalRule.value : null;
  const candidates = [innateX, explicitX].filter((x) => x !== null);
  return candidates.length > 0 ? Math.min(...candidates) : null;
}

/**
 * Resolves hit/wound probabilities plus a joint breakdown by (breach T/F)
 * x (damage-bonus tier 0/1/2). Damage-bonus tier: 0 = no bonus, 1 = exactly
 * one of {Critical, Shred} triggered, 2 = both triggered on the same wound.
 * All bucket values are ABSOLUTE probabilities (already include pHit), not
 * conditional on a hit.
 */
export function resolveAttackProbabilities(bs, S, T, activeOffensiveRules = [], activeDefensiveRules = [], isSnapShot = false) {
  const hitNeed = isSnapShot ? needForBSSnapShot(bs) : needForBS(bs);

  const ironHandsRule = activeDefensiveRules.find((r) => r.id === 'ironHands');
  const effS = ironHandsRule ? Math.max(1, S-ironHandsRule.value) : S;
  const wNeed = needForWound(effS, T);

  const rendingRule = activeOffensiveRules.find((r) => r.id === 'rending');
  const poisonedRule = activeOffensiveRules.find((r) => r.id === 'poisoned');
  const breachingRule = activeOffensiveRules.find((r) => r.id === 'breaching');
  const shredRule = activeOffensiveRules.find((r) => r.id === 'shred');
  const murderousRule = activeOffensiveRules.find((r) => r.id === 'murderous');

  const salamandersRule = activeDefensiveRules.find((r) => r.id === 'salamanders');

  const poisonThreshold = poisonedRule ? poisonedRule.value : 7;
  const salamandersThreshold = salamandersRule ? salamandersRule.value : 2;
  const wThreshold = wNeed === null ? 7 : wNeed;
  const effWThreshold = Math.max(salamandersThreshold, Math.min(wThreshold, poisonThreshold)); // effective wound-success threshold (real die)
  const Xbreach = breachingRule ? breachingRule.value : null;
  const Xshred = shredRule ? shredRule.value : null;
  const Xrend = rendingRule ? rendingRule.value : null;
  const Xcrit = getEffectiveCriticalThreshold(bs, activeOffensiveRules, isSnapShot);
  const Xmurderous = murderousRule ? murderousRule.value : null;

  const TIER_SUFFIX = { 0: 'Dplus0', 1: 'Dplus1', 2: 'Dplus2' };
  const buckets = {};
  for (const suf of Object.values(TIER_SUFFIX)) {
    buckets['Breach' + suf] = 0;
    buckets['noBreach' + suf] = 0;
    buckets['Breach' + suf + 'Murderous'] = 0;   // subset of BreachDplusN that's also Murderous
    buckets['noBreach' + suf + 'Murderous'] = 0;
  }

  const addWound = (breach, dmgBonus, murderous, prob) => {
    const suf = TIER_SUFFIX[dmgBonus];
    const key = (breach ? 'Breach' : 'noBreach') + suf;
    buckets[key] += prob;
    if (murderous) buckets[key + 'Murderous'] += prob;
  };

  const classifyWoundDie = (d2) => {
    if (d2 < effWThreshold) return null;
    const breach = Xbreach !== null && d2 >= Xbreach;
    const shred = Xshred !== null && d2 >= Xshred;
    const murderous = Xmurderous !== null && d2 >= Xmurderous;
    return { breach, shred, murderous };
  };

  let pHit;

  if (hitNeed === null) {
    pHit = 1;
    const isRending = !!rendingRule;
    const isCritical = Xcrit !== null;
    const forcedSix = isRending || isCritical;
    if (forcedSix) {
      const breach = !!breachingRule;
      const shred = !!shredRule;
      const murderous = Xmurderous !== null; // forced six always satisfies any X <= 6
      addWound(breach, (isCritical ? 1 : 0) + (shred ? 1 : 0), murderous, 1);
    } else {
      for (let d2 = 1; d2 <= 6; d2++) {
        const res = classifyWoundDie(d2);
        if (!res) continue;
        addWound(res.breach, res.shred ? 1 : 0, res.murderous, 1 / 6);
      }
    }
  } else {
    const candidateThresholds = [hitNeed];
    if (Xrend !== null) candidateThresholds.push(Xrend);
    if (Xcrit !== null) candidateThresholds.push(Xcrit);
    const effHitNeed = Math.min(...candidateThresholds);
    pHit = pFromNeed(effHitNeed);

    for (let d = effHitNeed; d <= 6; d++) {
      const isRending = Xrend !== null && d >= Xrend;
      const isCritical = Xcrit !== null && d >= Xcrit;
      const forcedSix = isRending || isCritical;
      if (forcedSix) {
        const breach = !!breachingRule;
        const shred = !!shredRule;
        const murderous = Xmurderous !== null;
        addWound(breach, (isCritical ? 1 : 0) + (shred ? 1 : 0), murderous, 1 / 6);
      } else {
        for (let d2 = 1; d2 <= 6; d2++) {
          const res = classifyWoundDie(d2);
          if (!res) continue;
          addWound(res.breach, res.shred ? 1 : 0, res.murderous, (1 / 6) * (1 / 6));
        }
      }
    }
  }

  // sum only the 6 BASE keys — the *Murderous keys are subsets, summing them too would double-count
  const baseKeys = ['BreachDplus0', 'BreachDplus1', 'BreachDplus2', 'noBreachDplus0', 'noBreachDplus1', 'noBreachDplus2'];
  const pWoundAbsolute = baseKeys.reduce((sum, k) => sum + buckets[k], 0);
  const pWound = pHit > 0 ? pWoundAbsolute / pHit : 0;

  return { pHit, pWound, hitNeed, wNeed, buckets };
}

/**
 * Applies the Eternal Warrior(X) special rule to a weapon's Damage value:
 * reduces Damage by X, but never below 1. Deterministic — no dice roll
 * involved, unlike Damage Mitigation. Returns damage unchanged if the
 * rule isn't active.
 */
export function applyEternalWarrior(damage, activeTargetRules = []) {
  const ewRule = activeTargetRules.find((r) => r.id === 'eternalWarrior');
  if (!ewRule) return damage;
  return Math.max(1, damage - ewRule.value);
}

/**
 * Combines the (breach, damage-tier) buckets with save resolution, folding
 * the breach axis (only relevant during the save roll) down to three
 * absolute per-die probabilities: one per damage-bonus tier.
 */
export function resolveFinalOutcomeProbabilities(buckets, ap, armour, invuln, cover) {
  const saveNormal = resolveSave(ap, armour, invuln, cover);
  const saveBreach = resolveSave(2, armour, invuln, cover);

  const pUnsavedTierDplus0 = buckets.BreachDplus0 * saveBreach.pUnsaved + buckets.noBreachDplus0 * saveNormal.pUnsaved;
  const pUnsavedTierDplus1 = buckets.BreachDplus1 * saveBreach.pUnsaved + buckets.noBreachDplus1 * saveNormal.pUnsaved;
  const pUnsavedTierDplus2 = buckets.BreachDplus2 * saveBreach.pUnsaved + buckets.noBreachDplus2 * saveNormal.pUnsaved;

  // Murderous-specific subset of each tier above — these wounds are immune to Eternal Warrior.
  const pUnsavedTierDplus0Murderous = buckets.BreachDplus0Murderous * saveBreach.pUnsaved + buckets.noBreachDplus0Murderous * saveNormal.pUnsaved;
  const pUnsavedTierDplus1Murderous = buckets.BreachDplus1Murderous * saveBreach.pUnsaved + buckets.noBreachDplus1Murderous * saveNormal.pUnsaved;
  const pUnsavedTierDplus2Murderous = buckets.BreachDplus2Murderous * saveBreach.pUnsaved + buckets.noBreachDplus2Murderous * saveNormal.pUnsaved;

  return {
    pUnsavedTierDplus0, pUnsavedTierDplus1, pUnsavedTierDplus2,
    pUnsavedTierDplus0Murderous, pUnsavedTierDplus1Murderous, pUnsavedTierDplus2Murderous,
    saveNormal, saveBreach,
  };
}

/**
 * Applies N wounds of a single Damage value to a unit, starting from a
 * given (models-already-dead, current-model-health-remaining) state.
 * Order within the group doesn't matter (every wound here does the same
 * damage), so this is a closed-form calculation, not a simulation.
 * Damage never spills from one model to the next
 */
export function applyWoundGroupToState(state, N, Dval, W, targetModels) {
  let { killed, wounded_model } = state;
  if (killed >= targetModels || N <= 0) return { killed, wounded_model };
  let remaining = N;

  // finish off the current (possibly already-damaged) model
  const killCurrent = Math.ceil(wounded_model / Dval);
  if (remaining < killCurrent) {
    return { killed, wounded_model: wounded_model - remaining * Dval };
  }
  remaining -= killCurrent;
  killed += 1;
  if (killed >= targetModels) return { killed: targetModels, wounded_model: 0 };

  // fully kill as many fresh models as the remaining wounds allow
  const killFull = Math.ceil(W / Dval);
  const fullKills = Math.min(Math.floor(remaining / killFull), targetModels - killed);
  killed += fullKills;
  remaining -= fullKills * killFull;
  if (killed >= targetModels) return { killed: targetModels, wounded_model: 0 };

  // leftover wounds (guaranteed < killFull here) damage one more fresh model
  return remaining > 0 ? { killed, wounded_model: W - remaining * Dval } : { killed, wounded_model: W };
}

/**
 * Map a distribution of unsaved-wound counts to a distribution of models
 * removed. A model dies after ceil(W/D) unsaved wounds; damage does not
 * spill over to the next model; kills are capped at targetModels. No 
 * longer used except in reference tests
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

/**
 * Exact distribution of models killed when unsaved wounds split into two
 * Fire Groups by Damage (D and D+1, from Shred), resolved as complete
 * groups lowest-Damage-first (per house convention). Uses the multinomial
 * marginal+conditional identity to get the exact joint (N_normal, N_shred)
 * distribution without building the full 2D grid. No longer used except in
 * reference tests
 */
export function computeModelsRemovedWithFireGroups(totalDice, pUnsavedNormal, pUnsavedShred, D, W, targetModels) {
  if (targetModels <= 0) return { distModels: [1] };

  const distModels = new Array(targetModels + 1).fill(0);
  const distNormalCount = binomialPMF(totalDice, pUnsavedNormal); // N_normal is a valid marginal

  for (let fireGroup1 = 0; fireGroup1 <= totalDice; fireGroup1++) {
    const pFireGroup1 = distNormalCount[fireGroup1];
    if (pFireGroup1 <= 1e-14) continue;

    const stateAfterNormal = applyWoundGroupToState({ killed: 0, wounded_model: W }, fireGroup1, D, W, targetModels);
    if (stateAfterNormal.killed >= targetModels) {
      distModels[targetModels] += pFireGroup1;
      continue;
    }

    // Given N_normal = a, the remaining (totalDice - a) dice split between
    // Shred and "other" in proportion — this is the conditional step.
    const remainingDice = totalDice - fireGroup1;
    const denom = 1 - pUnsavedNormal;
    const pShredGivenNotNormal = denom > 0 ? pUnsavedShred / denom : 0;
    const distShredCount = binomialPMF(remainingDice, pShredGivenNotNormal);

    for (let fireGroup2 = 0; fireGroup2 <= remainingDice; fireGroup2++) {
      const pFireGroup2 = distShredCount[fireGroup2];
      if (pFireGroup2 <= 1e-14) continue;
      const finalState = applyWoundGroupToState(stateAfterNormal, fireGroup2, D + 1, W, targetModels);
      distModels[finalState.killed] += pFireGroup1 * pFireGroup2;
    }
  }

  return { distModels };
}

/**
 * Exact distribution of models killed when unsaved wounds split into any
 * number of Fire Groups by Damage value, resolved as complete groups from
 * lowest Damage to highest (house convention). tiers: array of
 * { damage, pUnsaved } — pUnsaved is each tier's ABSOLUTE per-attacking-die
 * probability. Any implicit "no effect" residual is handled automatically.
 *
 * Complexity note: exact, but combinatorial in the number of active tiers —
 * each additional tier requires one more layer of conditional binomial
 * draws. Branches are merged by (dice remaining, state) after each tier to
 * keep growth in check. Fine for realistic wargame unit sizes (tens to a
 * few hundred total dice); very large totalDice (many hundreds+) combined
 * with 3 simultaneous non-trivial tiers can become slow — see note below
 * the code.
 */
export function computeModelsRemovedMultiTier(totalDice, tiers, W, targetModels) {
  if (targetModels <= 0) return { distModels: [1], branches: [] };

  const sorted = [...tiers]
    .filter((t) => t.pUnsaved > 1e-14)
    .sort((a, b) => a.damage - b.damage);

  let branches = [{ diceRemaining: totalDice, pMassRemaining: 1, state: { killed: 0, wounded_model: W }, prob: 1 }];

  for (const tier of sorted) {
    const nextBranches = [];
    for (const br of branches) {
      if (br.state.killed >= targetModels || br.prob <= 1e-14) {
        nextBranches.push(br);
        continue;
      }
      const pThisGivenRemaining = br.pMassRemaining > 0 ? tier.pUnsaved / br.pMassRemaining : 0;
      const countDist = binomialPMF(br.diceRemaining, pThisGivenRemaining);
      for (let k = 0; k <= br.diceRemaining; k++) {
        const pk = countDist[k];
        if (pk <= 1e-14) continue;
        const newState = applyWoundGroupToState(br.state, k, tier.damage, W, targetModels);
        nextBranches.push({
          diceRemaining: br.diceRemaining - k,
          pMassRemaining: br.pMassRemaining - tier.pUnsaved,
          state: newState,
          prob: br.prob * pk,
        });
      }
    }
    const merged = new Map();
    for (const b of nextBranches) {
      const key = `${b.diceRemaining},${b.state.killed},${b.state.wounded_model}`;
      const existing = merged.get(key);
      if (existing) existing.prob += b.prob;
      else merged.set(key, b);
    }
    branches = [...merged.values()];
  }

  const distModels = new Array(targetModels + 1).fill(0);
  for (const br of branches) distModels[br.state.killed] += br.prob;

  // Expose the joint (unsaved-wound-count, resulting state) distribution too —
  // needed by rules like Deflagrate that spawn a follow-up attack sized by
  // this attack's own unsaved wound count. N = totalDice - diceRemaining,
  // since diceRemaining is exactly the dice that landed in no tier at all.
  const branchesOut = branches.map((br) => ({
    N: totalDice - br.diceRemaining,
    killed: br.state.killed,
    wounded_model: br.state.wounded_model,
    prob: br.prob,
  }));

  return { distModels, branches: branchesOut };
}

/**
 * Resolves the Deflagrate(X) follow-up Fire Group, and also produces the
 * standalone "wounds caused" / "wounds unsaved" distributions from that
 * follow-up wave alone, for charting purposes.
 *
 * For each (N, state, prob) branch of the preceding attack, spawns N
 * already-resolved Hits at Strength X (no hit roll needed), rolls to wound
 * against the same Toughness, saves with AP '-' — represented here as
 * AP=7, since this ruleset's convention is armourUsable = AP > armour, so
 * a high AP value guarantees armour is NEVER negated, matching '-' meaning
 * "no penetration at all" — and applies Damage 1 per unsaved wound,
 * continuing from that branch's exact (killed, wounded_model) state. No
 * special rules carry over to these hits, and the result does not itself
 * trigger another Deflagrate wave.
 *
 * If the target unit is already fully wiped by the time a branch's
 * Deflagrate wave would resolve, that branch contributes nothing to the
 * wounds/unsaved distributions (there's no unit left to wound).
 */
export function applyDeflagrateWave(branches, X, T, armour, invuln, cover, W, targetModels, totalDice, pMitigationFail = 1, activeTargetRules = []) {
  const wNeedDeflagrate = needForWound(X, T);
  const pWoundDeflagrate = wNeedDeflagrate === null ? 0 : (7 - wNeedDeflagrate) / 6;
  const saveDeflagrate = resolveSave(7, armour, invuln, cover);
  const pUnsavedDeflagrate = pWoundDeflagrate * saveDeflagrate.pUnsaved * pMitigationFail;
  const deflagrateDamage = applyEternalWarrior(1, activeTargetRules);

  const distModels = new Array(targetModels + 1).fill(0);
  const distWoundsCaused = new Array(totalDice + 1).fill(0);
  const distUnsaved = new Array(totalDice + 1).fill(0);

  for (const br of branches) {
    if (br.N === 0 || br.killed >= targetModels) {
      distModels[br.killed] += br.prob;
      continue;
    }
    const woundPMF = binomialPMF(br.N, pWoundDeflagrate);
    const unsavedPMF = binomialPMF(br.N, pUnsavedDeflagrate);

    for (let k = 0; k <= br.N; k++) {
      distWoundsCaused[k] += br.prob * woundPMF[k];
      distUnsaved[k] += br.prob * unsavedPMF[k];
    }
    for (let c = 0; c <= br.N; c++) {
      const pc = unsavedPMF[c];
      if (pc <= 1e-14) continue;
      const finalState = applyWoundGroupToState({ killed: br.killed, wounded_model: br.wounded_model }, c, deflagrateDamage, W, targetModels);
      distModels[finalState.killed] += br.prob * pc;
    }
  }

  return { distModels, distWoundsCaused, distUnsaved, pWoundDeflagrate, pUnsavedDeflagrate };
}

/**
 * Resolves the Damage Mitigation roll for a target unit. Unlike
 * Armour/Invulnerable/Cover (where a model picks the single best save to
 * use), Damage Mitigation is an ADDITIONAL, independent test rolled only
 * after a wound has already failed its Saving Throw. If multiple Damage
 * Mitigation rules are active, the best (lowest X) is used — same
 * "best available" convention as the normal saves. Unlike Armour, it is
 * not affected by AP/Breaching.
 */
export function resolveDamageMitigation(activeMitigationRules = []) {
  if (activeMitigationRules.length === 0) {
    return { mitigationValue: null, ruleId: null, pMitigate: 0, pMitigationFail: 1 };
  }
  const best = activeMitigationRules.reduce((a, b) => (b.value < a.value ? b : a));
  const pMitigate = best.value <= 6 ? (7 - best.value) / 6 : 0;
  return { mitigationValue: best.value, ruleId: best.id, pMitigate, pMitigationFail: 1 - pMitigate };
}