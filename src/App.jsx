import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Chart,
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
} from 'chart.js';
import {
  resolveAttackProbabilities,
  resolveFinalOutcomeProbabilities,
  computeModelsRemovedMultiTier,
  getEffectiveCriticalThreshold,
  applyDeflagrateWave,
  resolveDamageMitigation,
  binomialPMF,
  propagate,
  mean,
  cdfAtLeast,
} from './lib/combatMath.js';
import {
  SPECIAL_RULE_DEFINITIONS,
} from './lib/specialRules.js';
import { 
  DAMAGE_MITIGATION_DEFINITIONS 
} from './lib/damageMitigation.js';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

const COLORS = {
  hits: '#a56a1fcc',
  wounds: '#5f6b3fcc',
  unsaved: '#4d6a78cc',
  models: '#9c3628e0',
  deflagrate: '#7a5195cc', // purple, distinct from every other series in the palette
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

function BarChart({ series, stacked = false, hidden = {}, onToggle }) {
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
          legend: { display: false }, // replaced by our own HTML legend/toggle below
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
  }, []); // create once

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
        <div className="chart-legend">
          {series.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`legend-item ${hidden[s.id] ? 'legend-item-hidden' : ''}`}
              style={{ '--legend-color': s.color }}
              onClick={() => onToggle(s.id)}
            >
              <span className="legend-swatch" />
              {s.label}
            </button>
          ))}
        </div>
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
        return (
          <div className="rule-row" key={rule.id}>
            <span className="rule-name">{def.label}</span>
            <select value={rule.value} onChange={(e) => onUpdate(rule.id, Number(e.target.value))}>
              {def.options.map((v) => (
                <option key={v} value={v}>{v}{def.optionSuffix ?? '+'}</option>
              ))}
            </select>
            <button type="button" className="rule-remove" onClick={() => onRemove(rule.id)} aria-label={`Remove ${def.label}`}>×</button>
          </div>
        );
      })}
      {availableRules.length > 0 && (
        <select className="rule-add" value="" onChange={(e) => { if (e.target.value) onAdd(e.target.value); }}>
          <option value="">+ Add special rule…</option>
          {availableRules.map((def) => (
            <option key={def.id} value={def.id}>{def.label}</option>
          ))}
        </select>
      )}
    </>
  );
}

export default function App() {
  // firing unit
  const [bs, setBs] = useState(4);
  const [fp, setFp] = useState(1);
  const [modelsFiring, setModelsFiring] = useState(10);
  const [str, setStr] = useState(4);
  const [ap, setAp] = useState(5);
  const [dmg, setDmg] = useState(1);

  // special rule handelling
  const [activeRules, setActiveRules] = useState([]); // [{ id, value }]

  const availableRules = SPECIAL_RULE_DEFINITIONS.filter(
    (def) => !activeRules.some((r) => r.id === def.id)
  );

  const [hiddenSeries, setHiddenSeries] = useState({}); // { [chartId]: { [seriesId]: true } }

  function toggleSeries(chartId, seriesId) {
    setHiddenSeries((prev) => {
      const chartHidden = prev[chartId] || {};
      return { ...prev, [chartId]: { ...chartHidden, [seriesId]: !chartHidden[seriesId] } };
    });
  }

  function isSeriesHidden(chartId, seriesId) {
    return !!hiddenSeries[chartId]?.[seriesId];
  }

  function addRule(id) {
    const def = SPECIAL_RULE_DEFINITIONS.find((d) => d.id === id);
    if (!def) return;
    setActiveRules((prev) => [...prev, { id, value: def.defaultValue }]);
  }
  function updateRuleValue(id, value) {
    setActiveRules((prev) => prev.map((r) => (r.id === id ? { ...r, value } : r)));
  }
  function removeRule(id) {
    setActiveRules((prev) => prev.filter((r) => r.id !== id));
  }

  const [activeMitigationRules, setActiveMitigationRules] = useState([]);

  function addMitigationRule(id) {
    const def = DAMAGE_MITIGATION_DEFINITIONS.find((d) => d.id === id);
    if (!def) return;
    setActiveMitigationRules((prev) => [...prev, { id, value: def.defaultValue }]);
  }
  function updateMitigationRuleValue(id, value) {
    setActiveMitigationRules((prev) => prev.map((r) => (r.id === id ? { ...r, value } : r)));
  }
  function removeMitigationRule(id) {
    setActiveMitigationRules((prev) => prev.filter((r) => r.id !== id));
  }
  
  // target unit
  const [tough, setTough] = useState(4);
  const [woundsPerModel, setWoundsPerModel] = useState(1);
  const [modelsTarget, setModelsTarget] = useState(10);
  const [armour, setArmour] = useState(4);
  const [invuln, setInvuln] = useState(7);
  const [cover, setCover] = useState(7);

  const [modelsView, setModelsView] = useState('distributive'); // 'cumulative' | 'distributive'
  const results = useMemo(() => {
    const { pHit, pWound, hitNeed, wNeed, buckets } =
      resolveAttackProbabilities(bs, str, tough, activeRules);

    const critNeed = getEffectiveCriticalThreshold(bs, activeRules);
    const { pUnsavedTierDplus0, pUnsavedTierDplus1, pUnsavedTierDplus2, saveNormal, saveBreach } =
      resolveFinalOutcomeProbabilities(buckets, ap, armour, invuln, cover);

    const totalDice = fp * modelsFiring;
    const distHits = binomialPMF(totalDice, pHit);
    const distWounds = propagate(distHits, pWound); // Stage 1/2 display only

    const pUnsavedTotal = pUnsavedTierDplus0 + pUnsavedTierDplus1 + pUnsavedTierDplus2;
    const distUnsaved = binomialPMF(totalDice, pUnsavedTotal); // Stage 3 display only

    const mitigation = resolveDamageMitigation(activeMitigationRules);

    const tiers = [
      { damage: dmg, pUnsaved: pUnsavedTierDplus0 * mitigation.pMitigationFail },
      { damage: dmg + 1, pUnsaved: pUnsavedTierDplus1 * mitigation.pMitigationFail },
      { damage: dmg + 2, pUnsaved: pUnsavedTierDplus2 * mitigation.pMitigationFail },
    ];
    const deflagrateRule = activeRules.find((r) => r.id === 'deflagrate');

    const { distModels: distModelsPreDeflagrate, branches } =
      computeModelsRemovedMultiTier(totalDice, tiers, woundsPerModel, modelsTarget);

    let distModels = distModelsPreDeflagrate;
    let deflagrateWoundsCaused = null;
    let deflagrateUnsaved = null;

    if (deflagrateRule) {
      const deflagResult = applyDeflagrateWave(
        branches, deflagrateRule.value, tough, armour, invuln, cover,
        woundsPerModel, modelsTarget, totalDice, mitigation.pMitigationFail
      );
      distModels = deflagResult.distModels;
      deflagrateWoundsCaused = deflagResult.distWoundsCaused;
      deflagrateUnsaved = deflagResult.distUnsaved;
    }

    const cdfModels = cdfAtLeast(distModels);
    return { hitNeed, pHit, wNeed, saveNormal, saveBreach, deflagrateRule, deflagrateWoundsCaused, 
      deflagrateUnsaved, totalDice, distHits, distWounds, distUnsaved, distModels, cdfModels, mitigation };
    }, [bs, fp, modelsFiring, str, ap, dmg, tough, woundsPerModel, modelsTarget, armour, invuln, cover, 
      activeRules, activeMitigationRules]);

  const { saveNormal, saveBreach, deflagrateRule, deflagrateWoundsCaused, deflagrateUnsaved, hitNeed, totalDice, 
    distHits, distWounds, distUnsaved, distModels, cdfModels, hitsPerKill, mitigation } = results;

  const modelsChartDist = modelsView === 'cumulative' ? cdfModels : distModels;

  const critNeed = getEffectiveCriticalThreshold(bs, activeRules);

  let saveHint;
  if (saveNormal.saveValue === null) {
    saveHint = 'No save available — every wound gets through.';
  } else {
    saveHint = `Best save used: ${saveNormal.saveValue}+ (${saveNormal.source}).`;
    if (!saveNormal.armourUsable && armour < 7) saveHint += ` Armour negated — AP ${ap} ≤ Armour ${armour}.`;
  }
  if (saveBreach.saveValue !== saveNormal.saveValue) {
    saveHint += ` Breached wounds instead use ${saveBreach.saveValue === null ? 'no save' : saveBreach.saveValue + '+ (' + saveBreach.source + ')'}.`;
  }

  const mitigationHint = mitigation.mitigationValue === null
    ? 'No Damage Mitigation active.'
    : `Mitigation: ${mitigation.mitigationValue}+ (rolled after a failed Save).`;

  return (
    <>
      <div className="masthead">
        <p className="eyebrow">Shooting Phase &middot; Infantry vs Infantry</p>
        <h1>Science of Slaughter</h1>
        <p>Set the firing unit's profile and the target's profile below. Every stage of the attack — hit, wound, save, and casualties removed — is recalculated live as a full probability distribution.</p>
      </div>

      <div className="layout">
        <div className="controls">

          <div className="card">
            <div className="card-head attacker"><span className="dot"></span><span className="tag">Firing Unit</span></div>
            <div className="card-body">
              <div className="subgrid">
                <div className="field">
                  <label>Ballistic Skill (BS)</label>
                  <input type="number" min="1" max="10" value={bs} onChange={(e) => setBs(Number(e.target.value))} />
                  <div className="hint">
                    {bs >= 10
                      ? (critNeed !== null ? 'Automatic hit, automatic Critical Hit' : 'Automatic hit')
                      : critNeed !== null
                        ? `Needs ${hitNeed}+ to hit, needs ${critNeed}+ to Critical Hit`
                        : `Needs ${hitNeed}+ to hit`}
                  </div>
                </div>
              </div>
              <div className="subgrid">
                <div className="field">
                  <label>Firepower (FP)</label>
                  <input type="number" min="1" max="20" value={fp} onChange={(e) => setFp(Math.max(1, Number(e.target.value) || 1))} />
                </div>
                <div className="field">
                  <label>Models Firing</label>
                  <input type="number" min="1" max="100" value={modelsFiring} onChange={(e) => setModelsFiring(Math.max(1, Number(e.target.value) || 1))} />
                </div>
              </div>
              <div className="divider-label">Weapon Profile</div>
              <div className="subgrid">
                <div className="field">
                  <label>Strength (S)</label>
                  <input type="number" min="1" max="20" value={str} onChange={(e) => setStr(Number(e.target.value) || 1)} />
                </div>
                <div className="field">
                  <label>AP</label>
                  <select value={ap} onChange={(e) => setAp(Number(e.target.value) || 0)}>
                    <option value="1">1</option><option value="2">2</option><option value="3">3</option>
                    <option value="4">4</option><option value="5">5</option><option value="6">6</option>
                    <option value="7">-</option>
                  </select>
                </div>
              </div>
              <div className="field">
                <label>Damage (D)</label>
                <input type="number" min="1" max="20" value={dmg} onChange={(e) => setDmg(Number(e.target.value) || 1)} />
              </div>
                <div className="divider-label">Special Rules</div>
                  <SpecialRuleList
                    activeRules={activeRules}
                    definitions={SPECIAL_RULE_DEFINITIONS}
                    onAdd={addRule}
                    onUpdate={updateRuleValue}
                    onRemove={removeRule}
                  />
              </div>
            </div>

          <div className="card">
            <div className="card-head defender"><span className="dot"></span><span className="tag">Target Unit</span></div>
            <div className="card-body">
              <div className="subgrid">
                <div className="field">
                  <label>Toughness (T)</label>
                  <input type="number" min="1" max="20" value={tough} onChange={(e) => setTough(Number(e.target.value) || 1)} />
                </div>
                <div className="field">
                  <label>Wounds/Model (W)</label>
                  <input type="number" min="1" max="20" value={woundsPerModel} onChange={(e) => setWoundsPerModel(Math.max(1, Number(e.target.value) || 1))} />
                </div>
              </div>
              <div className="field">
                <label>Models in Unit</label>
                <input type="number" min="1" max="60" value={modelsTarget} onChange={(e) => setModelsTarget(Math.max(1, Number(e.target.value) || 1))} />
              </div>
              <div className="divider-label">Saves — best applicable is used</div>
              <div className="field">
                <label>Armour Save</label>
                <select value={armour} onChange={(e) => setArmour(Number(e.target.value))}>
                  <option value="2">2+</option><option value="3">3+</option><option value="4">4+</option>
                  <option value="5">5+</option><option value="6">6+</option><option value="7">None</option>
                </select>
              </div>
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
                  definitions={DAMAGE_MITIGATION_DEFINITIONS}
                  onAdd={addMitigationRule}
                  onUpdate={updateMitigationRuleValue}
                  onRemove={removeMitigationRule}
                />
              <div className="hint">{mitigationHint}</div>
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
                  series={[{ id: 'main', data: distHits, color: COLORS.hits, label: 'Hits' }]}
                  hidden={hiddenSeries.hits || {}}
                  onToggle={(id) => toggleSeries('hits', id)}
                />
              </div>
            </div>
          </div>
          <div className="arrow-connector">↓ each hit rolls to wound ↓</div>

          <div className="stage">
            <div className="stage-head">
              <div><div className="num">Stage 02 — Strength vs Toughness</div><h2>Wounds Caused</h2></div>
                <div className="mean-group">
                  <div className={`mean ${isSeriesHidden('wounds', 'main') ? 'mean-dimmed' : ''}`}>
                    <span className="m-label">Expected</span><span className="m-val">{fmtNum(mean(distWounds))}</span>
                  </div>
                  {deflagrateRule && (
                    <div className={`mean mean-deflagrate ${isSeriesHidden('wounds', 'deflagrate') ? 'mean-dimmed' : ''}`}>
                      <span className="m-label">Expected Deflagrate</span><span className="m-val">{fmtNum(mean(deflagrateWoundsCaused))}</span>
                    </div>
                  )}
                </div>
            </div>
            <div className="stage-body">
              <div className="chart-wrap">
                <BarChart
                  series={
                    deflagrateRule
                      ? [
                          { id: 'main', data: distWounds, color: COLORS.wounds, label: 'Wounds' },
                          { id: 'deflagrate', data: deflagrateWoundsCaused, color: COLORS.deflagrate, label: 'Deflagrate Wounds' },
                        ]
                      : [{ id: 'main', data: distWounds, color: COLORS.wounds, label: 'Wounds' }]
                  }
                  stacked={!!deflagrateRule}
                  hidden={hiddenSeries.wounds || {}}
                  onToggle={(id) => toggleSeries('wounds', id)}
                />
              </div>
            </div>
          </div>
          <div className="arrow-connector">↓ each wound rolls a save ↓</div>

          <div className="stage">
            <div className="stage-head">
              <div><div className="num">Stage 03 — Saving Throw</div><h2>Wounds Unsaved</h2></div>
                <div className="mean-group">
                  <div className={`mean ${isSeriesHidden('unsaved', 'main') ? 'mean-dimmed' : ''}`}>
                    <span className="m-label">Expected</span><span className="m-val">{fmtNum(mean(distUnsaved))}</span>
                  </div>
                  {deflagrateRule && (
                    <div className={`mean mean-deflagrate ${isSeriesHidden('unsaved', 'deflagrate') ? 'mean-dimmed' : ''}`}>
                      <span className="m-label">Expected Deflagrate</span><span className="m-val">{fmtNum(mean(deflagrateUnsaved))}</span>
                    </div>
                  )}
                </div>
            </div>
            <div className="stage-body">
              <div className="chart-wrap">
                <BarChart
                  series={
                    deflagrateRule
                      ? [
                          { id: 'main', data: distUnsaved, color: COLORS.unsaved, label: 'Unsaved' },
                          { id: 'deflagrate', data: deflagrateUnsaved, color: COLORS.deflagrate, label: 'Deflagrate Unsaved' },
                        ]
                      : [{ id: 'main', data: distUnsaved, color: COLORS.unsaved, label: 'Unsaved' }]
                  }
                  stacked={!!deflagrateRule}
                  hidden={hiddenSeries.unsaved || {}}
                  onToggle={(id) => toggleSeries('unsaved', id)}
                />
              </div>
            </div>
          </div>
          <div className="arrow-connector">↓ unsaved wounds strip models of health ↓</div>

          <div className="stage final">
            <div className="stage-head">
              <div>
                <div className="num">Stage 04 — Casualties</div>
                <h2>Models Removed — {modelsView === 'cumulative' ? 'Cumulative Probability' : 'Probability'}</h2>
              </div>
              <div className="mean"><span className="m-label">Expected Kills</span><span className="m-val">{fmtNum(mean(distModels))}</span></div>
            </div>
            <div className="stage-body">
              <div className="toggle-group" role="group" aria-label="Casualty chart view">
                <button
                  type="button"
                  className={`toggle-btn ${modelsView === 'distributive' ? 'active' : ''}`}
                  onClick={() => setModelsView('distributive')}
                >
                  Exactly X models removed
                </button>
                <button
                  type="button"
                  className={`toggle-btn ${modelsView === 'cumulative' ? 'active' : ''}`}
                  onClick={() => setModelsView('cumulative')}
                >
                  At least X models removed
                </button>
              </div>
              <div className="chart-wrap">
                <BarChart
                  series={[{ id: 'main', data: modelsChartDist, color: COLORS.models, label: 'Models Removed' }]}
                  hidden={hiddenSeries.models || {}}
                  onToggle={(id) => toggleSeries('models', id)}
                />
              </div>
            </div>
          </div>

        </div>
      </div>

      <footer>
        Cumulative probability shown for casualties is P(models removed &ge; N) — the chance of achieving at least that many kills. Bars for stages 1–3 show the exact probability of each result, marginalised across every possible path through the prior stage.
      </footer>
    </>
  );
}
