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

/**
 * D6 result needed to hit in the Assault phase, comparing the attacking
 * unit's Weapon Skill against the target's. Unlike needForBS (which only
 * looks at the attacker), this is symmetric around WS parity and depends
 * on both units' stats.
 */
export function needForWS(attackWS, targetWS) {
  if (attackWS >= 2 * targetWS) return 2;
  if (attackWS > targetWS) return 3;
  if (attackWS === targetWS) return 4;
  if (2 * attackWS > targetWS) return 5;
  return 6;
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
export function resolveAttackProbabilities(hitNeed, S, T, innateCritX = null, activeTraits = [], activeOffensiveRules = [], activeDefensiveRules = [], numberShots = 0) {
  const rendingRule = activeOffensiveRules.find((r) => r.id === 'rending');
  const poisonedRule = activeOffensiveRules.find((r) => r.id === 'poisoned');
  const breachingRule = activeOffensiveRules.find((r) => r.id === 'breaching');
  const shredRule = activeOffensiveRules.find((r) => r.id === 'shred');
  const murderousRule = activeOffensiveRules.find((r) => r.id === 'murderous');
  const bypassRule = activeOffensiveRules.find((r) => r.id === 'bypass');

  const ironHandsRule = activeDefensiveRules.find((r) => r.id === 'ironHands');
  const effS = ironHandsRule ? Math.max(1, S - ironHandsRule.value) : S;
  const wNeed = needForWound(effS, T);

  const salamandersRule = activeDefensiveRules.find((r) => r.id === 'salamanders');
  const salamandersThreshold = salamandersRule ? salamandersRule.value : 2;

  const poisonThreshold = poisonedRule ? poisonedRule.value : 7;
  const wThreshold = wNeed === null ? 7 : wNeed;
  const m = Math.max(salamandersThreshold, Math.min(wThreshold, poisonThreshold));

  const Xbreach = breachingRule ? breachingRule.value : null;
  const Xshred = shredRule ? shredRule.value : null;
  const Xrend = rendingRule ? rendingRule.value : null;
  const Xmurderous = murderousRule ? murderousRule.value : null;
  const Xbypass = bypassRule ? bypassRule.value : null;

  const explicitCritRule = activeOffensiveRules.find((r) => r.id === 'criticalHit');
  const explicitCritX = explicitCritRule ? explicitCritRule.value : null;
  const critCandidates = [innateCritX, explicitCritX].filter((x) => x !== null);
  const Xcrit = critCandidates.length > 0 ? Math.min(...critCandidates) : null;

  // Records replace the old flat 24-key bucket object. Each record is a
  // fully-classified, non-overlapping slice of wound probability: which
  // damage tier it belongs to, whether it breached, and which special
  // conditions apply to it ('murderous' and/or 'bypass' currently — a
  // future rule just means pushing another string into `flags`, no change
  // to this accumulation logic or the bucket structure itself).
  const recordMap = new Map();
  function accumulate(breach, dmgTier, flags, prob) {
    const key = breach + '|' + dmgTier + '|' + [...flags].sort().join(',');
    const existing = recordMap.get(key);
    if (existing) existing.prob += prob;
    else recordMap.set(key, { breach, dmgTier, flags: [...flags], prob });
  }

  const classifyWoundDie = (d2) => {
    if (d2 < m) return null;
    const breach = Xbreach !== null && d2 >= Xbreach;
    const shred = Xshred !== null && d2 >= Xshred;
    const murderous = Xmurderous !== null && d2 >= Xmurderous;
    const bypass = Xbypass !== null && d2 >= Xbypass;
    return { breach, shred, murderous, bypass };
  };

  let pHit;

  if (hitNeed === null) {
    // BS10-style automatic hit: hit die assumed to be a natural 6.
    pHit = 1;
    const isRending = !!rendingRule;
    const isCritical = Xcrit !== null;
    const forcedSix = isRending || isCritical;
    if (forcedSix) {
      const breach = !!breachingRule;
      const shred = !!shredRule;
      const flags = [];
      if (Xmurderous !== null) flags.push('murderous');
      if (Xbypass !== null) flags.push('bypass');
      accumulate(breach, (isCritical ? 1 : 0) + (shred ? 1 : 0), flags, 1);
    } else {
      for (let d2 = 1; d2 <= 6; d2++) {
        const res = classifyWoundDie(d2);
        if (!res) continue;
        const flags = [];
        if (res.murderous) flags.push('murderous');
        if (res.bypass) flags.push('bypass');
        accumulate(res.breach, res.shred ? 1 : 0, flags, 1 / 6);
      }
    }
  } else {
    const candidateThresholds = [hitNeed];
    if (Xrend !== null) candidateThresholds.push(Xrend);
    if (Xcrit !== null) candidateThresholds.push(Xcrit);

    const imperialFistsRule = activeOffensiveRules.find((r) => r.id === 'imperialFists');
    if (imperialFistsRule) {
      if (activeTraits.find((r) => imperialFistsRule.traits.includes(r.id)) && numberShots >= 5) {
        if (hitNeed < 7 && hitNeed > 2 && hitNeed != null) {
          const modHitNeed = hitNeed - imperialFistsRule.value;
          candidateThresholds.push(modHitNeed);
        }
      }
    }

    const effHitNeed = Math.min(...candidateThresholds);
    pHit = pFromNeed(effHitNeed);

    for (let d = effHitNeed; d <= 6; d++) {
      const isRending = Xrend !== null && d >= Xrend;
      const isCritical = Xcrit !== null && d >= Xcrit;
      const forcedSix = isRending || isCritical;
      if (forcedSix) {
        const breach = !!breachingRule;
        const shred = !!shredRule;
        const flags = [];
        if (Xmurderous !== null) flags.push('murderous');
        if (Xbypass !== null) flags.push('bypass');
        accumulate(breach, (isCritical ? 1 : 0) + (shred ? 1 : 0), flags, 1 / 6);
      } else {
        for (let d2 = 1; d2 <= 6; d2++) {
          const res = classifyWoundDie(d2);
          if (!res) continue;
          const flags = [];
          if (res.murderous) flags.push('murderous');
          if (res.bypass) flags.push('bypass');
          accumulate(res.breach, res.shred ? 1 : 0, flags, (1 / 6) * (1 / 6));
        }
      }
    }
  }

  const buckets = [...recordMap.values()];
  const pWoundAbsolute = buckets.reduce((sum, rec) => sum + rec.prob, 0);
  const pWound = pHit > 0 ? pWoundAbsolute / pHit : 0;

  return { pHit, pWound, hitNeed, wNeed, buckets };
}

/**
 * Applies the Eternal Warrior(X) special rule to a weapon's Damage value:
 * reduces Damage by X, but never below 1. Deterministic — no dice roll
 * involved, unlike Damage Mitigation. Returns damage unchanged if the
 * rule isn't active.
 */
export function applyEternalWarrior(damage, activeDefensiveRules = []) {
  const ewRule = activeDefensiveRules.find((r) => r.id === 'eternalWarrior');
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

  // Sums the unsaved probability of every record matching `predicate`.
  // Bypass records skip the save roll entirely; everything else uses
  // whichever save its breach status calls for.
  function sumUnsaved(predicate, { includeBypass = true, includeNormal = true } = {}) {
    let total = 0;
    for (const rec of buckets) {
      if (!predicate(rec)) continue;
      const isBypass = rec.flags.includes('bypass');
      if (isBypass && !includeBypass) continue;
      if (!isBypass && !includeNormal) continue;
      if (isBypass) total += rec.prob;
      else {
        const save = rec.breach ? saveBreach : saveNormal;
        total += rec.prob * save.pUnsaved;
      }
    }
    return total;
  }

  const result = { saveNormal, saveBreach };
  for (let tier = 0; tier <= 2; tier++) {
    const isMurd = (r) => r.flags.includes('murderous');
    // pUnsavedTierDplusN is INCLUSIVE of the murderous subset — matches the
    // original contract from when Murderous was first added; callers derive
    // the exclusive non-murderous portion themselves via subtraction.
    result[`pUnsavedTierDplus${tier}`] = sumUnsaved((r) => r.dmgTier === tier, { includeBypass: false });
    result[`pUnsavedTierDplus${tier}Murderous`] = sumUnsaved((r) => r.dmgTier === tier && isMurd(r), { includeBypass: false });
    result[`pBypassTierDplus${tier}`] = sumUnsaved((r) => r.dmgTier === tier && !isMurd(r), { includeNormal: false });
    result[`pBypassTierDplus${tier}Murderous`] = sumUnsaved((r) => r.dmgTier === tier && isMurd(r), { includeNormal: false });
  }
  return result;
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
 * Like applyWoundGroupToState, but each FRESH model independently makes a
 * Recovery Test (Medic) the moment it's first allocated a wound: with
 * probability pMedic, that model effectively has W+1 Wounds for the rest
 * of the attack (mathematically identical to "one wound's Damage reduced
 * by 1", since Damage is always >=1 and totals are purely additive).
 * Once resolved for a given model, its outcome is fixed — it is NOT
 * re-rolled by later Fire Groups/tiers, or by Deflagrate's follow-up
 * wave, within the same attack.
 *
 * state: { killed, wounded_model, medicResolved } — medicResolved is false
 * only for a fresh model that hasn't yet taken any wound.
 */
export function applyWoundGroupToStateWithMedic(state, N, Dval, W, targetModels, pMedic) {
  let work = [{ state: { ...state }, remaining: N, prob: 1 }];
  const finished = [];

  while (work.length > 0) {
    const item = work.pop();
    if (item.state.killed >= targetModels || item.remaining <= 0) {
      finished.push(item);
      continue;
    }
    const candidates = item.state.medicResolved
      ? [{ wounded_model: item.state.wounded_model, prob: 1 }]
      : [
          { wounded_model: W + 1, prob: pMedic },
          { wounded_model: W, prob: 1 - pMedic },
        ].filter((c) => c.prob > 1e-15);

    for (const c of candidates) {
      const killCurrent = Math.ceil(c.wounded_model / Dval);
      const newProb = item.prob * c.prob;
      if (item.remaining < killCurrent) {
        finished.push({
          state: { killed: item.state.killed, wounded_model: c.wounded_model - item.remaining * Dval, medicResolved: true },
          remaining: 0,
          prob: newProb,
        });
      } else {
        const newKilled = item.state.killed + 1;
        const newRemaining = item.remaining - killCurrent;
        if (newKilled >= targetModels) {
          finished.push({ state: { killed: targetModels, wounded_model: 0, medicResolved: false }, remaining: 0, prob: newProb });
        } else {
          work.push({ state: { killed: newKilled, wounded_model: 0, medicResolved: false }, remaining: newRemaining, prob: newProb });
        }
      }
    }
  }

  const merged = new Map();
  for (const f of finished) {
    const key = `${f.state.killed},${f.state.wounded_model},${f.state.medicResolved}`;
    const existing = merged.get(key);
    if (existing) existing.prob += f.prob;
    else merged.set(key, { state: f.state, prob: f.prob });
  }
  return [...merged.values()];
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
export function computeModelsRemovedMultiTier(totalDice, tiers, W, targetModels, pMedic = 0) {
  if (targetModels <= 0) return { distModels: [1], branches: [] };

  const sorted = [...tiers]
    .filter((t) => t.pUnsaved > 1e-14)
    .sort((a, b) => a.damage - b.damage);

  const initialState = pMedic > 0
    ? { killed: 0, wounded_model: W, medicResolved: false }
    : { killed: 0, wounded_model: W };

  let branches = [{ diceRemaining: totalDice, pMassRemaining: 1, state: initialState, prob: 1 }];

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

        if (pMedic > 0) {
          const subBranches = applyWoundGroupToStateWithMedic(br.state, k, tier.damage, W, targetModels, pMedic);
          for (const sb of subBranches) {
            nextBranches.push({
              diceRemaining: br.diceRemaining - k,
              pMassRemaining: br.pMassRemaining - tier.pUnsaved,
              state: sb.state,
              prob: br.prob * pk * sb.prob,
            });
          }
        } else {
          const newState = applyWoundGroupToState(br.state, k, tier.damage, W, targetModels);
          nextBranches.push({
            diceRemaining: br.diceRemaining - k,
            pMassRemaining: br.pMassRemaining - tier.pUnsaved,
            state: newState,
            prob: br.prob * pk,
          });
        }
      }
    }
    const merged = new Map();
    for (const b of nextBranches) {
      const key = pMedic > 0
        ? `${b.diceRemaining},${b.state.killed},${b.state.wounded_model},${b.state.medicResolved}`
        : `${b.diceRemaining},${b.state.killed},${b.state.wounded_model}`;
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
    medicResolved: pMedic > 0 ? br.state.medicResolved : false,
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
export function applyDeflagrateWave(branches, X, T, armour, invuln, cover, W, targetModels, totalDice, pMitigationFail = 1, activeDefensiveRules = [], pMedic = 0) {
  const wNeedDeflagrate = needForWound(X, T);
  const pWoundDeflagrate = wNeedDeflagrate === null ? 0 : (7 - wNeedDeflagrate) / 6;
  const saveDeflagrate = resolveSave(7, armour, invuln, cover);
  const pUnsavedDeflagrate = pWoundDeflagrate * saveDeflagrate.pUnsaved * pMitigationFail;
  const deflagrateDamage = applyEternalWarrior(1, activeDefensiveRules);

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

      if (pMedic > 0) {
        const subBranches = applyWoundGroupToStateWithMedic(
          { killed: br.killed, wounded_model: br.wounded_model, medicResolved: br.medicResolved },
          c, deflagrateDamage, W, targetModels, pMedic
        );
        for (const sb of subBranches) {
          distModels[sb.state.killed] += br.prob * pc * sb.prob;
        }
      } else {
        const finalState = applyWoundGroupToState({ killed: br.killed, wounded_model: br.wounded_model }, c, deflagrateDamage, W, targetModels);
        distModels[finalState.killed] += br.prob * pc;
      }
    }
  }

  return { distModels, distWoundsCaused, distUnsaved, pWoundDeflagrate, pUnsavedDeflagrate };
}

/**
 * Resolves which SINGLE Damage Mitigation rule a model actually uses: out
 * of every active Damage Mitigation rule (Shrouded, Feel No Pain, Medic,
 * ...), only the one with the highest probability of success applies —
 * since they all share the same "roll >= X" mechanic, this is simply
 * whichever active rule has the lowest X. A model can only ever benefit
 * from one, even if several are active simultaneously.
 *
 * Medic works fundamentally differently from the others once selected: it
 * doesn't reduce a per-wound probability (pMitigationFail stays at 1, i.e.
 * unused) — instead it hands back pMedic, the Recovery Test pass chance,
 * for the per-model +1 Wound mechanism (see applyWoundGroupToStateWithMedic).
 * If a roll-to-ignore rule wins instead, pMedic is 0 and pMitigationFail
 * behaves exactly as it always has.
 */
export function resolveDamageMitigation(activeMitigationRules = []) {
  if (activeMitigationRules.length === 0) {
    return { mitigationValue: null, ruleId: null, pMitigate: 0, pMitigationFail: 1, pMedic: 0 };
  }
  const best = activeMitigationRules.reduce((a, b) => (b.value < a.value ? b : a));
  const pSuccess = best.value <= 6 ? (7 - best.value) / 6 : 0;

  if (best.id === 'medic') {
    return { mitigationValue: best.value, ruleId: 'medic', pMitigate: 0, pMitigationFail: 1, pMedic: pSuccess };
  }
  return { mitigationValue: best.value, ruleId: best.id, pMitigate: pSuccess, pMitigationFail: 1 - pSuccess, pMedic: 0 };
}

/**
 * Testing/debugging helper: translates an OLD-style flat bucket key name
 * (e.g. "BreachDplus1Murderous") into a query against the new array-of-
 * records bucket structure, and sums the matching probability. Lets tests
 * written against the old bucket shape be converted mechanically.
 */
export function sumBucket(buckets, keyName) {
  const match = keyName.match(/^(Breach|noBreach)Dplus(\d)(Murderous)?$/);
  if (!match) throw new Error(`sumBucket: cannot parse key "${keyName}"`);
  const breach = match[1] === 'Breach';
  const dmgTier = parseInt(match[2], 10);
  const requireMurderous = !!match[3];
  return buckets
    .filter((r) => r.breach === breach && r.dmgTier === dmgTier && (!requireMurderous || r.flags.includes('murderous')))
    .reduce((sum, r) => sum + r.prob, 0);
}

// ============================================================
// Vehicle shooting support
//
// Rule 4: vehicles are hit as per normal shooting attacks, but the wound
// step is replaced entirely by an Armour Penetration test (d6 + Strength
// vs Armour Value). Per rule 8, Rending, Breaching, Poisoned, Medic,
// Shred, Murderous, Bypass, Salamanders, Iron Hands, and Eternal Warrior
// all have no effect on Vehicles — this is reflected by simply never
// referencing those rule ids below, rather than special-casing an
// exclusion. Critical Hit still lowers the hit threshold as normal, but
// no longer forces an automatic wound: it still requires a genuine
// Armour Penetration test, only adding +1 Damage if that test penetrates.
// ============================================================

// The three Vehicle Damage Table statuses. Shock (X) carries one of these as its value.
export const VEHICLE_STATUSES = ['stunned', 'pinned', 'suppressed'];

/**
 * Resolves hit and Armour Penetration probabilities for a shooting attack
 * against a Vehicle. Returns ABSOLUTE (pre-save) probabilities: pGlance
 * (Glancing Hit), pPenetrateNormal / pPenetrateCritical (Penetrating Hit,
 * split by whether +1 Damage applies).
 */
export function resolveVehicleAttackProbabilities(hitNeed, S, AV, innateCritX = null, activeTraits = [], activeOffensiveRules = [], numberShots = 0) {
  const explicitCritRule = activeOffensiveRules.find((r) => r.id === 'criticalHit');
  const explicitCritX = explicitCritRule ? explicitCritRule.value : null;
  const critCandidates = [innateCritX, explicitCritX].filter((x) => x !== null);
  const Xcrit = critCandidates.length > 0 ? Math.min(...critCandidates) : null;

  // Shock (X): X is a Vehicle status NAME rather than a number. Matched
  // case-insensitively; anything unrecognised is ignored rather than guessed at.
  const shockRule = activeOffensiveRules.find((r) => r.id === 'shock');
  const shockValue = shockRule ? String(shockRule.value).toLowerCase() : null;
  const shockStatus = VEHICLE_STATUSES.includes(shockValue) ? shockValue : null;

  let pHit, pCriticalHit, pNormalHit;
  let pShockTrigger = 0; // chance per die that Shock is triggered

  if (hitNeed === null) {
    // automatic hit (e.g. BS10): natural roll assumed to be a 6
    pHit = 1;
    pShockTrigger = shockStatus ? 1 : 0; // natural roll assumed to be a 6, so it always triggers
    const isCritical = Xcrit !== null; // a natural 6 always satisfies any Xcrit <= 6
    pCriticalHit = isCritical ? 1 : 0;
    pNormalHit = isCritical ? 0 : 1;
  } else {
    const candidateThresholds = [hitNeed];
    if (Xcrit !== null) candidateThresholds.push(Xcrit);

    const imperialFistsRule = activeOffensiveRules.find((r) => r.id === 'imperialFists');
    if (imperialFistsRule) {
      if (activeTraits.find((r) => imperialFistsRule.traits.includes(r.id)) && numberShots >= 5) {
        if (hitNeed < 7 && hitNeed > 2 && hitNeed != null) {
          candidateThresholds.push(hitNeed - imperialFistsRule.value);
        }
      }
    }

    const effHitNeed = Math.min(...candidateThresholds);
    pHit = pFromNeed(effHitNeed);

    pCriticalHit = 0;
    pNormalHit = 0;
    for (let d = effHitNeed; d <= 6; d++) {
      const isCritical = Xcrit !== null && d >= Xcrit;
      if (isCritical) pCriticalHit += 1 / 6;
      else pNormalHit += 1 / 6;
      // Shock: this die was a HIT (d >= effHitNeed) and its UNMODIFIED roll was a 5 or 6.
      // Judged on the natural die, so +1-to-hit rules and Critical Hit lowering the
      // threshold can let a natural 5 count, but never turn a 4 into a trigger.
      if (shockStatus && d >= 5) pShockTrigger += 1 / 6;
    }
  }

  // Armour Penetration test: d6 + S vs AV. Identical for critical and
  // normal hits — criticality only changes the Damage applied on a
  // Penetrating Hit, not the test itself. A natural roll of 1 ALWAYS
  // fails (neither Glances nor Penetrates), even if S+1 would reach AV.
  const threshold = AV - S; // the die roll that exactly Glances
  let pGlanceGivenHit, pPenetrateGivenHit;
  if (threshold > 6) {
    pGlanceGivenHit = 0; pPenetrateGivenHit = 0; // S+6 < AV: weapon cannot hurt this vehicle at all
  } else if (threshold < 2) {
    // AV < S+2: every roll of 2-6 already exceeds AV. A Glance would need a
    // roll of 1 (threshold === 1), which always fails, so Glancing is
    // impossible and only the roll of 1 is lost: 5/6, not 6/6.
    pGlanceGivenHit = 0; pPenetrateGivenHit = 5 / 6;
  } else {
    pGlanceGivenHit = 1 / 6;
    pPenetrateGivenHit = (6 - threshold) / 6;
  }

  // Armourbane: this weapon can never inflict a Glancing Hit — a roll that
  // would Glance (S + D6 = AV) is a Penetrating Hit instead. Applied AFTER
  // the normal test, so: a natural 1 still always fails (it never glanced,
  // so there is nothing to upgrade), a weapon that cannot reach AV still
  // cannot hurt it, and Critical Hit's +1 Damage applies to an upgraded hit
  // because it genuinely is a Penetrating Hit.
  if (activeOffensiveRules.some((r) => r.id === 'armourbane')) {
    pPenetrateGivenHit += pGlanceGivenHit;
    pGlanceGivenHit = 0;
  }

  return {
    pHit, hitNeed,
    pGlance: pHit * pGlanceGivenHit,
    pPenetrateNormal: pNormalHit * pPenetrateGivenHit,
    pPenetrateCritical: pCriticalHit * pPenetrateGivenHit,
    shock: shockStatus ? { status: shockStatus, pTrigger: pShockTrigger, pHit } : null,
  };
}

/**
 * Applies Invulnerable/Cover Saves and Damage Mitigation to a vehicle's
 * raw Glance/Penetrate probabilities. Vehicles cannot take Armour Saves
 * (rule 7) — represented by always passing armour=7 ("None") to the
 * shared resolveSave helper, so an Armour Save can never be chosen
 * regardless of the weapon's AP (which has no meaning for vehicles).
 */
export function resolveVehicleFinalOutcomeProbabilities(pGlance, pPenetrateNormal, pPenetrateCritical, invuln, cover, pMitigationFail) {
  const save = resolveSave(0, 7, invuln, cover);
  const factor = save.pUnsaved * pMitigationFail;
  return {
    save,
    pGlanceUnsaved: pGlance * factor,
    pPenetrateNormalUnsaved: pPenetrateNormal * factor,
    pPenetrateCriticalUnsaved: pPenetrateCritical * factor,
  };
}

function _trinomialStatusDistribution(g) {
  const results = [];
  function fact(n) { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; }
  for (let c1 = 0; c1 <= g; c1++) {
    for (let c2 = 0; c2 <= g - c1; c2++) {
      const c3 = g - c1 - c2;
      const coeff = fact(g) / (fact(c1) * fact(c2) * fact(c3));
      results.push({ c1, c2, c3, p: coeff * Math.pow(1 / 3, g) });
    }
  }
  return results;
}

const _escalationCache = new Map();

/**
 * Distribution of Hull Points lost to Vehicle Damage Table escalation
 * (rule 5: a repeated Status result instead removes 1 Hull Point, no
 * save or mitigation applies) given exactly `g` Glancing Hits. The order
 * the Glancing Hits occur in doesn't matter — only whether each status
 * was rolled at least once — so this reduces to a trinomial distribution
 * over (Stunned-count, Pinned-count, Suppressed-count), each an exact
 * 1/3 share per Glancing Hit. Memoized since many callers share the same g.
 */
export function resolveEscalationHPDistribution(g) {
  if (_escalationCache.has(g)) return _escalationCache.get(g);
  const dist = new Map();
  for (const { c1, c2, c3, p } of _trinomialStatusDistribution(g)) {
    const hp = Math.max(0, c1 - 1) + Math.max(0, c2 - 1) + Math.max(0, c3 - 1);
    dist.set(hp, (dist.get(hp) || 0) + p);
  }
  _escalationCache.set(g, dist);
  return dist;
}

function _buildVehicleOutcomeJoint(totalDice, pGlance, pPenetrateNormal, pPenetrateCritical) {
  const distGlance = binomialPMF(totalDice, pGlance);
  const joint = [];
  for (let g = 0; g <= totalDice; g++) {
    const pg = distGlance[g];
    if (pg <= 1e-14) continue;
    const remaining = totalDice - g;
    const massRemaining = 1 - pGlance;
    const pNormalGivenRemaining = massRemaining > 0 ? pPenetrateNormal / massRemaining : 0;
    const distNormal = binomialPMF(remaining, pNormalGivenRemaining);
    for (let pn = 0; pn <= remaining; pn++) {
      const ppn = distNormal[pn];
      if (ppn <= 1e-14) continue;
      const remaining2 = remaining - pn;
      const massRemaining2 = massRemaining - pPenetrateNormal;
      const pCritGivenRemaining2 = massRemaining2 > 0 ? pPenetrateCritical / massRemaining2 : 0;
      const distCrit = binomialPMF(remaining2, pCritGivenRemaining2);
      for (let pc = 0; pc <= remaining2; pc++) {
        const ppc = distCrit[pc];
        if (ppc <= 1e-14) continue;
        joint.push({ g, pn, pc, prob: pg * ppn * ppc });
      }
    }
  }
  return joint;
}

/**
 * Exact distribution of total Hull Points lost for a shooting attack
 * against a Vehicle, combining Penetrating Hit damage (dmg, or dmg+1 for
 * a Critical Hit's Penetrating result) with Vehicle Damage Table
 * escalation Hull Point loss, capped at the Vehicle's total Hull Points
 * (once destroyed, further damage is wasted — same convention as
 * infantry casualties never exceeding the unit's model count).
 */
export function computeVehicleHullPointDistribution(totalDice, pGlanceUnsaved, pPenetrateNormalUnsaved, pPenetrateCriticalUnsaved, dmg, maxHullPoints) {
  const joint = _buildVehicleOutcomeJoint(totalDice, pGlanceUnsaved, pPenetrateNormalUnsaved, pPenetrateCriticalUnsaved);
  const distHullPointsLost = new Array(maxHullPoints + 1).fill(0);
  for (const { g, pn, pc, prob } of joint) {
    const penetrateHP = pn * dmg + pc * (dmg + 1);
    const escDist = resolveEscalationHPDistribution(g);
    for (const [escHP, escP] of escDist.entries()) {
      const totalHP = Math.min(maxHullPoints, penetrateHP + escHP);
      distHullPointsLost[totalHP] += prob * escP;
    }
  }
  return distHullPointsLost;
}

/**
 * Probability that each Vehicle Damage Table status (Stunned, Pinned,
 * Suppressed) is inflicted at least once during the attack.
 *
 * Without a `shock` argument the statuses come only from unsaved Glancing
 * Hits, each splitting an even 1/3 across the three — so all three
 * probabilities are equal (a consequence of the table's 1-2 / 3-4 / 5-6
 * split, not a bug).
 *
 * Shock (X): pass `shock` (the object returned by
 * resolveVehicleAttackProbabilities) to add Status X whenever ANY hit's
 * unmodified roll was a 5 or 6. That is decided at the Hit Test, so saves,
 * Damage Mitigation and the Armour Penetration test cannot stop it, and it
 * never costs a Hull Point (the status is gained at the END of the attack,
 * so it does not interact with Damage Table results within the same
 * attack). Only the shocked status changes; the other two still come from
 * Glancing Hits alone.
 *
 * Per attacking die, the shocked status is inflicted if the die triggers
 * Shock, OR it does not but is an unsaved Glancing Hit that rolls X on the
 * Damage Table. One hit can be both, so the overlap is counted once.
 */
export function computeStatusInflictedProbability(totalDice, pGlanceUnsaved, shock = null) {
  const distGlance = binomialPMF(totalDice, pGlanceUnsaved);
  let pInflicted = 0;
  for (let g = 0; g <= totalDice; g++) {
    pInflicted += distGlance[g] * (1 - Math.pow(2 / 3, g));
  }
  const result = { stunned: pInflicted, pinned: pInflicted, suppressed: pInflicted };

  if (shock && VEHICLE_STATUSES.includes(shock.status) && shock.pTrigger > 0 && shock.pHit > 0) {
    const pHitNotTriggering = Math.max(0, shock.pHit - shock.pTrigger);
    const pUnsavedGlanceGivenHit = pGlanceUnsaved / shock.pHit;
    const q = shock.pTrigger + pHitNotTriggering * (pUnsavedGlanceGivenHit / 3);
    result[shock.status] = 1 - Math.pow(1 - q, totalDice);
  }
  return result;
}
