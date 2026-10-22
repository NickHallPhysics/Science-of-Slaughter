import { useEffect, useMemo, useRef, useState } from 'react';
import ToggleButton from 'react-bootstrap/ToggleButton';
import ToggleButtonGroup from 'react-bootstrap/ToggleButtonGroup';
import { Link } from 'react-router-dom';
import {
  Chart,
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
} from 'chart.js';
import {
  needForBS,
  needForBSSnapShot,
  getInnateCriticalX,
  getEffectiveCriticalThreshold,
  resolveVehicleAttackProbabilities,
  resolveVehicleFinalOutcomeProbabilities,
  computeVehicleHullPointDistribution,
  computeStatusInflictedProbability,
  resolveDamageMitigation,
  binomialPMF,
  mean,
  cdfAtLeast,
} from '../lib/combatMath.js';
import {
  OFFENSIVE_SPECIAL_RULE_DEFINITIONS,
  DEFENSIVE_SPECIAL_RULE_DEFINITIONS,
} from '../lib/specialRules.js';
import {
  DAMAGE_MITIGATION_DEFINITIONS,
} from '../lib/damageMitigation.js';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

const PHASE = 'shooting_vehicle';

const COLORS = {
  hits: '#a56a1fcc',
  glance: '#6b7f3fcc',
  penetrate: '#9c3628e0',
  unsaved: '#4d6a78cc',
  hullPoints: '#9c3628e0',
  grid: '#c9a06e55',
  text: '#6d5a41',
  tooltipBg: '#f4eed8',
  tooltipBorder: '#c9a06e',
  tooltipText: '#3c2f21',
};

function fmtPct(x) {
  return (x * 100).toFixed(1) + '%';
}
function fmtNum(x) {
  return x.toFixed(2);
}

/**
 * A number input backed by its own raw string state, rather than binding
 * directly to the numeric value — this is what allows the box to go
 * genuinely blank while editing. While blank (or not-yet-a-valid-number),
 * the returned `value` holds steady at the last valid number rather than
 * snapping to `min`; clamping/defaulting only happens on blur.
 */
function useNumericField(initialValue, { min = 1, max = Infinity } = {}) {
  const clamp = (n) => Math.min(max, Math.max(min, n));
  const [raw, setRaw] = useState(String(initialValue));
  const [lastValid, setLastValid] = useState(clamp(initialValue));

  const value = (() => {
    if (raw === '') return lastValid;
    const n = Number(raw);
    return Number.isNaN(n) ? lastValid : clamp(n);
  })();

  const inputProps = {
    type: 'number',
    min,
    max: max === Infinity ? undefined : max,
    value: raw,
    onChange: (e) => {
      const v = e.target.value;
      setRaw(v);
      if (v !== '') {
        const n = Number(v);
        if (!Number.isNaN(n)) setLastValid(clamp(n));
      }
    },
    onBlur: () => {
      if (raw === '') { setRaw(String(lastValid)); return; }
      const n = Number(raw);
      if (Number.isNaN(n)) { setRaw(String(lastValid)); return; }
      const clamped = clamp(n);
      if (clamped !== n) setRaw(String(clamped));
    },
  };

  return [value, inputProps];
}

function BarChart({ chartId, series, stacked = false, hidden = {}, onToggle }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    const ctx = canvasRef.current.getContext('2d');
    chartRef.current = new Chart(ctx, {
      type: 'bar',
      data: { labels: [], datasets: [] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 250 },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: COLORS.tooltipBg,
            borderColor: COLORS.tooltipBorder,
            borderWidth: 1,
            titleColor: COLORS.tooltipText,
            bodyColor: COLORS.tooltipText,
            titleFont: { family: 'JetBrains Mono', size: 11 },
            bodyFont: { family: 'JetBrains Mono', size: 11 },
            callbacks: { label: (c) => `${c.dataset.label ? c.dataset.label + ': ' : ''}${(c.raw * 100).toFixed(2)}%` },
          },
        },
        scales: {
          x: { stacked: false, grid: { display: false }, ticks: { color: COLORS.text, font: { family: 'JetBrains Mono', size: 10 } } },
          y: {
            stacked: false,
            beginAtZero: true,
            grid: { color: COLORS.grid },
            ticks: { color: COLORS.text, font: { family: 'JetBrains Mono', size: 10 }, callback: (v) => (v * 100).toFixed(0) + '%' },
          },
        },
      },
    });
    return () => chartRef.current?.destroy();
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const visibleSeries = series.filter((s) => !hidden[s.id]);
    const maxLen = visibleSeries.length ? Math.max(...visibleSeries.map((s) => s.data.length)) : 1;
    chart.data.labels = Array.from({ length: maxLen }, (_, k) => k);
    chart.data.datasets = visibleSeries.map((s) => ({
      data: s.data,
      backgroundColor: s.color,
      borderWidth: 0,
      borderRadius: 1,
      maxBarThickness: 34,
      label: s.label || '',
    }));
    chart.options.scales.x.stacked = stacked;
    chart.options.scales.y.stacked = stacked;
    chart.update();
  }, [series, stacked, hidden]);

  return (
    <>
      {series.length > 1 && (
        <ToggleButtonGroup
          type="checkbox"
          defaultValue={series.map((s) => s.value)}
          className="chart-legend"
        >
          {series.map((s) => (
            <ToggleButton
              key={s.id}
              id={`${chartId}-${s.id}`}
              value={s.value}
              onChange={() => onToggle(s.id)}
            >
              {s.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      )}
      <canvas ref={canvasRef} />
    </>
  );
}

function SpecialRuleList({ activeRules, definitions, onAdd, onUpdate, onRemove }) {
  const availableRules = definitions.filter((def) => !activeRules.some((r) => r.id === def.id));
  return (
    <>
      {activeRules.map((rule) => {
        const def = definitions.find((d) => d.id === rule.id);
        if (!def) return null;
        const hasOptions = Array.isArray(def.options) && def.options.length > 0;
        return (
          <div className="rule-row" key={rule.id}>
            <span className="rule-name">{def.label}</span>
            {hasOptions ? (
              <select value={rule.value} onChange={(e) => onUpdate(rule.id, typeof def.options[0] === 'number' ? Number(e.target.value) : e.target.value, definitions)}>
                {def.options.map((v) => (
                  <option key={v} value={v}>{v}{def.optionSuffix ?? '+'}</option>
                ))}
              </select>
            ) : null}
            <button type="button" className="rule-remove" onClick={() => onRemove(rule.id, definitions)} aria-label={`Remove ${def.label}`}>×</button>
          </div>
        );
      })}
      {availableRules.length > 0 ? (
        <select className="rule-add" value="" onChange={(e) => { if (e.target.value) onAdd(e.target.value, definitions); }}>
          <option value="">+ Add special rule…</option>
          {availableRules.map((def) => (
            <option key={def.id} value={def.id}>{def.label}</option>
          ))}
        </select>
      ) : (
        <p className="hint">No special rules are available for this phase yet.</p>
      )}
    </>
  );
}

export default function Page() {
  // --- Firing Unit ---
  const [bs, bsInput] = useNumericField(4, { min: 1, max: 10 });
  const [isSnapShot, setIsSnapShot] = useState(false);
  const [fp, fpInput] = useNumericField(1, { min: 1, max: 20 });
  const [modelsFiring, modelsFiringInput] = useNumericField(10, { min: 1, max: 100 });
  const [str, strInput] = useNumericField(4, { min: 1, max: 20 });
  const [dmg, dmgInput] = useNumericField(1, { min: 1, max: 20 });
  const [activeOffensiveRules, setActiveOffensiveRules] = useState([]);
  const [activeTraits] = useState([]); // no weapon-trait selector on this page yet (only needed by Imperial Fists)

  // --- Target Vehicle ---
  const [armourValue, setArmourValue] = useState(12);
  const [maxHullPoints, maxHullPointsInput] = useNumericField(3, { min: 1, max: 10 });
  const [invuln, setInvuln] = useState(7);
  const [cover, setCover] = useState(7);
  const [activeMitigationRules, setActiveMitigationRules] = useState([]);
  const [activeDefensiveRules, setActiveDefensiveRules] = useState([]);

  // --- UI state ---
  const [vehicleView, setVehicleView] = useState('distributive'); // 'distributive' | 'cumulative' | 'status'
  const [hiddenSeries, setHiddenSeries] = useState({});

  function toggleSeries(chartId, seriesId) {
    setHiddenSeries((prev) => {
      const chartHidden = prev[chartId] || {};
      return { ...prev, [chartId]: { ...chartHidden, [seriesId]: !chartHidden[seriesId] } };
    });
  }
  function isSeriesHidden(chartId, seriesId) {
    return !!hiddenSeries[chartId]?.[seriesId];
  }

  function addRule(id, definitions) {
    const def = definitions.find((d) => d.id === id);
    if (!def) return;
    const hasOptions = Array.isArray(def.options) && def.options.length > 0;
    const hasTraits = Array.isArray(def.traitsValid) && def.traitsValid.length > 0;
    const value = hasOptions ? def.defaultValue : def.fixedValue;
    const traits = hasTraits ? def.traitsValid : [];

    if (definitions === OFFENSIVE_SPECIAL_RULE_DEFINITIONS) {
      setActiveOffensiveRules((prev) => [...prev, { id, value, traits }]);
    } else if (definitions === DEFENSIVE_SPECIAL_RULE_DEFINITIONS) {
      setActiveDefensiveRules((prev) => [...prev, { id, value, traits }]);
    } else if (definitions === DAMAGE_MITIGATION_DEFINITIONS) {
      setActiveMitigationRules((prev) => [...prev, { id, value, traits }]);
    }
  }
  function updateRuleValue(id, value, definitions) {
    const setter = definitions === OFFENSIVE_SPECIAL_RULE_DEFINITIONS ? setActiveOffensiveRules
      : definitions === DEFENSIVE_SPECIAL_RULE_DEFINITIONS ? setActiveDefensiveRules
      : definitions === DAMAGE_MITIGATION_DEFINITIONS ? setActiveMitigationRules
      : null;
    if (!setter) return;
    setter((prev) => prev.map((r) => (r.id === id ? { ...r, value } : r)));
  }
  function removeRule(id, definitions) {
    const setter = definitions === OFFENSIVE_SPECIAL_RULE_DEFINITIONS ? setActiveOffensiveRules
      : definitions === DEFENSIVE_SPECIAL_RULE_DEFINITIONS ? setActiveDefensiveRules
      : definitions === DAMAGE_MITIGATION_DEFINITIONS ? setActiveMitigationRules
      : null;
    if (!setter) return;
    setter((prev) => prev.filter((r) => r.id !== id));
  }

  // Phase-filtered rule lists: for now, no existing rule is tagged for
  // shooting_vehicle, so these are empty — new vehicle-specific rules
  // will appear here automatically once tagged.
  const offensiveDefsForPhase = OFFENSIVE_SPECIAL_RULE_DEFINITIONS.filter(
    (def) => Array.isArray(def.phaseApplicable) && def.phaseApplicable.includes(PHASE)
  );
  const defensiveDefsForPhase = DEFENSIVE_SPECIAL_RULE_DEFINITIONS.filter(
    (def) => Array.isArray(def.phaseApplicable) && def.phaseApplicable.includes(PHASE)
  );
  const mitigationDefsForPhase = DAMAGE_MITIGATION_DEFINITIONS.filter(
    (def) => Array.isArray(def.phaseApplicable) && def.phaseApplicable.includes(PHASE)
  );

  const results = useMemo(() => {
    const hitNeed = isSnapShot ? needForBSSnapShot(bs) : needForBS(bs);
    const innateCritX = isSnapShot ? null : getInnateCriticalX(bs);
    const totalDice = fp * modelsFiring;

    const atk = resolveVehicleAttackProbabilities(hitNeed, str, armourValue, innateCritX, activeTraits, activeOffensiveRules, totalDice);
    const mitigation = resolveDamageMitigation(activeMitigationRules);
    const outcome = resolveVehicleFinalOutcomeProbabilities(
      atk.pGlance, atk.pPenetrateNormal, atk.pPenetrateCritical, invuln, cover, mitigation.pMitigationFail
    );

    const distHits = binomialPMF(totalDice, atk.pHit);

    const pPenetrateTotal = atk.pPenetrateNormal + atk.pPenetrateCritical;
    const distGlance = binomialPMF(totalDice, atk.pGlance);
    const distPenetrate = binomialPMF(totalDice, pPenetrateTotal);

    const pPenetrateTotalUnsaved = outcome.pPenetrateNormalUnsaved + outcome.pPenetrateCriticalUnsaved;
    const distGlanceUnsaved = binomialPMF(totalDice, outcome.pGlanceUnsaved);
    const distPenetrateUnsaved = binomialPMF(totalDice, pPenetrateTotalUnsaved);

    const distHullPoints = computeVehicleHullPointDistribution(
      totalDice, outcome.pGlanceUnsaved, outcome.pPenetrateNormalUnsaved, outcome.pPenetrateCriticalUnsaved, dmg, maxHullPoints
    );
    const cdfHullPoints = cdfAtLeast(distHullPoints);
    const statusProbs = computeStatusInflictedProbability(totalDice, outcome.pGlanceUnsaved, atk.shock);

    return {
      hitNeed, totalDice,
      pHit: atk.pHit,
      pGlance: atk.pGlance, pPenetrateTotal,
      pGlanceUnsaved: outcome.pGlanceUnsaved, pPenetrateTotalUnsaved,
      save: outcome.save,
      distHits, distGlance, distPenetrate, distGlanceUnsaved, distPenetrateUnsaved,
      distHullPoints, cdfHullPoints, statusProbs, shock: atk.shock,
    };
  }, [bs, isSnapShot, fp, modelsFiring, str, dmg, armourValue, maxHullPoints, invuln, cover,
      activeOffensiveRules, activeTraits, activeDefensiveRules, activeMitigationRules]);

  const {
    hitNeed, save,
    distHits, distGlance, distPenetrate, distGlanceUnsaved, distPenetrateUnsaved,
    distHullPoints, cdfHullPoints, statusProbs, shock,
  } = results;

  const critNeed = getEffectiveCriticalThreshold(bs, activeOffensiveRules, isSnapShot);

  const bsHint = isSnapShot
    ? (hitNeed > 6
        ? 'Automatic Fail (Snap Shot)'
        : critNeed !== null
          ? `Snap Shot: needs ${hitNeed}+ to hit, needs ${critNeed}+ to Critical Hit`
          : `Snap Shot: needs ${hitNeed}+ to hit`)
    : bs >= 10
      ? (critNeed !== null ? 'Automatic hit, automatic Critical Hit' : 'Automatic hit')
      : critNeed !== null
        ? `Needs ${hitNeed}+ to hit, needs ${critNeed}+ to Critical Hit`
        : `Needs ${hitNeed}+ to hit`;

  const apThreshold = armourValue - str;
  const hasArmourbane = activeOffensiveRules.some((r) => r.id === 'armourbane');
  const apHint = apThreshold > 6
    ? `Strength ${str} cannot hurt Armour Value ${armourValue} at all (max possible ${str}+6)`
    : apThreshold < 2
      ? `Any Armour Penetration roll of 2+ Penetrates Armour Value ${armourValue} (a natural 1 always fails)`
      : hasArmourbane
        ? `Armourbane: an Armour Penetration roll of ${apThreshold}+ Penetrates — no Glancing Hits (a natural 1 always fails)`
        : `Armour Penetration: a roll of ${apThreshold} Glances${apThreshold < 6 ? `, ${apThreshold + 1}+ Penetrates` : ''} (a natural 1 always fails)`;

  const mitigation = resolveDamageMitigation(activeMitigationRules);
  const mitigationHint = mitigation.mitigationValue === null
    ? 'No Damage Mitigation active.'
    : mitigation.ruleId === 'medic'
      ? `Recovery Test: ${mitigation.mitigationValue}+ (Medic has no effect on Vehicles).`
      : `Mitigation: ${mitigation.mitigationValue}+ (rolled after a failed Save).`;

  const saveHint = save.saveValue === null
    ? 'No save available — vehicles cannot take Armour Saves, so every Glancing or Penetrating Hit gets through.'
    : `Best save used: ${save.saveValue}+ (${save.source}). Vehicles cannot take Armour Saves.`;

  const shockLabel = shock ? shock.status.charAt(0).toUpperCase() + shock.status.slice(1) : null;
  const hullPointsChartDist = vehicleView === 'cumulative' ? cdfHullPoints : distHullPoints;

  return (
    <>
      <Link to="/" className="landing-button landing-button-small back-home-button">
        <span className="landing-button-label">&larr; Home</span>
      </Link>

      <div className="masthead">
        <p className="eyebrow">Shooting Phase &middot; Vehicles</p>
        <h1>Science of Slaughter</h1>
        <p>Set the firing unit's profile and the target vehicle's profile below. Every stage of the attack — hits, the Armour Penetration test, and the resulting Hull Point loss or Status — is recalculated live as a full probability distribution.</p>
      </div>

      <div className="layout">
        <div className="controls">

          <div className="card">
            <div className="card-head attacker"><span className="dot"></span><span className="tag">Firing Unit</span></div>
            <div className="card-body">
              <div className="subgrid">
                <div className="field">
                  <label>Ballistic Skill (BS)</label>
                  <div className="bs-input-row">
                    <input {...bsInput} />
                    <button
                      type="button"
                      className={`toggle-btn ${isSnapShot ? 'active' : ''}`}
                      onClick={() => setIsSnapShot((v) => !v)}
                    >
                      Snap Shots
                    </button>
                  </div>
                  <div className="hint">{bsHint}</div>
                </div>
              </div>
              <div className="subgrid">
                <div className="field">
                  <label>Firepower (FP)</label>
                  <input {...fpInput} />
                </div>
                <div className="field">
                  <label>Models Firing</label>
                  <input {...modelsFiringInput} />
                </div>
              </div>
              <div className="divider-label">Weapon Profile</div>
              <div className="subgrid">
                <div className="field">
                  <label>Strength (S)</label>
                  <input {...strInput} />
                </div>
                <div className="field">
                  <label>Damage (D)</label>
                  <input {...dmgInput} />
                </div>
              </div>
              <div className="divider-label">Special Rules</div>
              <SpecialRuleList
                activeRules={activeOffensiveRules}
                definitions={offensiveDefsForPhase}
                onAdd={(id) => addRule(id, OFFENSIVE_SPECIAL_RULE_DEFINITIONS)}
                onUpdate={(id, value) => updateRuleValue(id, value, OFFENSIVE_SPECIAL_RULE_DEFINITIONS)}
                onRemove={(id) => removeRule(id, OFFENSIVE_SPECIAL_RULE_DEFINITIONS)}
              />
            </div>
          </div>

          <div className="card">
            <div className="card-head defender"><span className="dot"></span><span className="tag">Target Vehicle</span></div>
            <div className="card-body">
              <div className="subgrid">
                <div className="field">
                  <label>Armour Value (AV)</label>
                  <select value={armourValue} onChange={(e) => setArmourValue(Number(e.target.value))}>
                    <option value="10">10</option><option value="11">11</option><option value="12">12</option>
                    <option value="13">13</option><option value="14">14</option><option value="15">15</option>
                  </select>
                </div>
                <div className="field">
                  <label>Hull Points (HP)</label>
                  <input {...maxHullPointsInput} />
                </div>
              </div>
              <div className="hint">{apHint}</div>
              <div className="divider-label">Saves — best applicable is used</div>
              <div className="field">
                <label>Invulnerable Save</label>
                <select value={invuln} onChange={(e) => setInvuln(Number(e.target.value))}>
                  <option value="2">2+</option><option value="3">3+</option><option value="4">4+</option>
                  <option value="5">5+</option><option value="6">6+</option><option value="7">None</option>
                </select>
              </div>
              <div className="field">
                <label>Cover Save</label>
                <select value={cover} onChange={(e) => setCover(Number(e.target.value))}>
                  <option value="2">2+</option><option value="3">3+</option><option value="4">4+</option>
                  <option value="5">5+</option><option value="6">6+</option><option value="7">None</option>
                </select>
              </div>
              <div className="hint">{saveHint}</div>
              <div className="divider-label">Damage Mitigation — best applicable is used</div>
              <SpecialRuleList
                activeRules={activeMitigationRules}
                definitions={mitigationDefsForPhase}
                onAdd={(id) => addRule(id, DAMAGE_MITIGATION_DEFINITIONS)}
                onUpdate={(id, value) => updateRuleValue(id, value, DAMAGE_MITIGATION_DEFINITIONS)}
                onRemove={(id) => removeRule(id, DAMAGE_MITIGATION_DEFINITIONS)}
              />
              <div className="hint">{mitigationHint}</div>
              <div className="divider-label">Special Rules</div>
              <SpecialRuleList
                activeRules={activeDefensiveRules}
                definitions={defensiveDefsForPhase}
                onAdd={(id) => addRule(id, DEFENSIVE_SPECIAL_RULE_DEFINITIONS)}
                onUpdate={(id, value) => updateRuleValue(id, value, DEFENSIVE_SPECIAL_RULE_DEFINITIONS)}
                onRemove={(id) => removeRule(id, DEFENSIVE_SPECIAL_RULE_DEFINITIONS)}
              />
            </div>
          </div>

        </div>

        <div className="output">

          <div className="stage">
            <div className="stage-head">
              <div><div className="num">Stage 01 — Ballistic</div><h2>Hits Scored</h2></div>
              <div className="mean"><span className="m-label">Expected</span><span className="m-val">{fmtNum(mean(distHits))}</span></div>
            </div>
            <div className="stage-body">
              <div className="chart-wrap">
                <BarChart
                  chartId="hits"
                  series={[{ id: 'main', data: distHits, color: COLORS.hits, label: 'Hits' }]}
                  hidden={hiddenSeries.hits || {}}
                  onToggle={(id) => toggleSeries('hits', id)}
                />
              </div>
            </div>
          </div>
          <div className="arrow-connector">↓ each hit makes an Armour Penetration test ↓</div>

          <div className="stage">
            <div className="stage-head">
              <div><div className="num">Stage 02 — Strength + D6 vs Armour Value</div><h2>Glancing &amp; Penetrating Hits</h2></div>
              <div className="mean-group">
                <div className={`mean ${isSeriesHidden('penetration', 'glance') ? 'mean-dimmed' : ''}`}>
                  <span className="m-label">Expected Glances</span><span className="m-val">{fmtNum(mean(distGlance))}</span>
                </div>
                <div className={`mean ${isSeriesHidden('penetration', 'penetrate') ? 'mean-dimmed' : ''}`}>
                  <span className="m-label">Expected Penetrates</span><span className="m-val">{fmtNum(mean(distPenetrate))}</span>
                </div>
              </div>
            </div>
            <div className="stage-body">
              <div className="chart-wrap">
                <BarChart
                  chartId="penetration"
                  series={[
                    { id: 'glance', value: 1, data: distGlance, color: COLORS.glance, label: 'Glancing Hits' },
                    { id: 'penetrate', value: 2, data: distPenetrate, color: COLORS.penetrate, label: 'Penetrating Hits' },
                  ]}
                  stacked
                  hidden={hiddenSeries.penetration || {}}
                  onToggle={(id) => toggleSeries('penetration', id)}
                />
              </div>
            </div>
          </div>
          <div className="arrow-connector">↓ each Glancing or Penetrating Hit rolls a save ↓</div>

          <div className="stage">
            <div className="stage-head">
              <div><div className="num">Stage 03 — Saving Throw</div><h2>Hits Unsaved</h2></div>
              <div className="mean-group">
                <div className={`mean ${isSeriesHidden('unsaved', 'glance') ? 'mean-dimmed' : ''}`}>
                  <span className="m-label">Expected Glances</span><span className="m-val">{fmtNum(mean(distGlanceUnsaved))}</span>
                </div>
                <div className={`mean ${isSeriesHidden('unsaved', 'penetrate') ? 'mean-dimmed' : ''}`}>
                  <span className="m-label">Expected Penetrates</span><span className="m-val">{fmtNum(mean(distPenetrateUnsaved))}</span>
                </div>
              </div>
            </div>
            <div className="stage-body">
              <div className="chart-wrap">
                <BarChart
                  chartId="unsaved"
                  series={[
                    { id: 'glance', value: 1, data: distGlanceUnsaved, color: COLORS.glance, label: 'Unsaved Glancing Hits' },
                    { id: 'penetrate', value: 2, data: distPenetrateUnsaved, color: COLORS.penetrate, label: 'Unsaved Penetrating Hits' },
                  ]}
                  stacked
                  hidden={hiddenSeries.unsaved || {}}
                  onToggle={(id) => toggleSeries('unsaved', id)}
                />
              </div>
            </div>
          </div>
          <div className="arrow-connector">↓ unsaved hits damage the vehicle ↓</div>

          <div className="stage final">
            <div className="stage-head">
              <div>
                <div className="num">Stage 04 — Vehicle Damage</div>
                <h2>
                  {vehicleView === 'status'
                    ? 'Status Inflicted'
                    : `Hull Points Removed — ${vehicleView === 'cumulative' ? 'Cumulative Probability' : 'Probability'}`}
                </h2>
              </div>
              <div className="mean"><span className="m-label">Expected Hull Points</span><span className="m-val">{fmtNum(mean(distHullPoints))}</span></div>
            </div>
            <div className="stage-body">
              <div className="toggle-group" role="group" aria-label="Vehicle damage view">
                <button
                  type="button"
                  className={`toggle-btn ${vehicleView === 'distributive' ? 'active' : ''}`}
                  onClick={() => setVehicleView('distributive')}
                >
                  Exactly X hull points removed
                </button>
                <button
                  type="button"
                  className={`toggle-btn ${vehicleView === 'cumulative' ? 'active' : ''}`}
                  onClick={() => setVehicleView('cumulative')}
                >
                  At least X hull points removed
                </button>
                <button
                  type="button"
                  className={`toggle-btn ${vehicleView === 'status' ? 'active' : ''}`}
                  onClick={() => setVehicleView('status')}
                >
                  Status inflicted
                </button>
              </div>
              {vehicleView === 'status' ? (
                <div className="status-readout">
                  <div className="hint">
                    {shock
                      ? `Shock (${shockLabel}) inflicts ${shockLabel} whenever any hit's unmodified roll is a 5 or 6 — saves and the Armour Penetration test can't stop it, and it never costs a Hull Point. The other two statuses come only from Glancing Hits, an even 1-in-3 share each.`
                      : 'Stunned, Pinned, and Suppressed are always equally likely — each Glancing Hit splits 1-2 / 3-4 / 5-6 across the three, an even 1-in-3 share.'}
                  </div>
                  <div className="status-stat"><span className="status-label">Stunned</span><span className="status-val">{fmtPct(statusProbs.stunned)}</span></div>
                  <div className="status-stat"><span className="status-label">Pinned</span><span className="status-val">{fmtPct(statusProbs.pinned)}</span></div>
                  <div className="status-stat"><span className="status-label">Suppressed</span><span className="status-val">{fmtPct(statusProbs.suppressed)}</span></div>
                </div>
              ) : (
                <div className="chart-wrap">
                  <BarChart
                    chartId="hullPoints"
                    series={[{ id: 'main', data: hullPointsChartDist, color: COLORS.hullPoints, label: 'Hull Points Removed' }]}
                    hidden={hiddenSeries.hullPoints || {}}
                    onToggle={(id) => toggleSeries('hullPoints', id)}
                  />
                </div>
              )}
            </div>
          </div>

        </div>
      </div>

      <footer>
        Cumulative probability shown for Hull Points is P(Hull Points removed &ge; N) — the chance of removing at least that many, capped at the vehicle's total. Bars for stages 1–3 show the exact probability of each result, marginalised across every possible path through the prior stage. A natural 1 on the Armour Penetration test always fails.
      </footer>
    </>
  );
}