import { useEffect, useMemo, useRef } from 'react';
import { useState } from 'react';
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
  pFromNeed,
  needForWound,
  resolveHitAndWound,
  resolveUnsavedGivenHit,
  resolveSave,
  binomialPMF,
  propagate,
  mean,
  cdfAtLeast,
  computeModelsRemoved,
} from './lib/combatMath.js';
import {
  SPECIAL_RULE_DEFINITIONS,
} from './lib/specialRules.js';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

const COLORS = {
  hits: '#a56a1fcc',
  wounds: '#5f6b3fcc',
  unsaved: '#4d6a78cc',
  models: '#9c3628e0',
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

/** A <canvas> wrapped in a Chart.js bar chart, kept in sync with `dist`. */
function BarChart({ dist, color }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    const ctx = canvasRef.current.getContext('2d');
    chartRef.current = new Chart(ctx, {
      type: 'bar',
      data: { labels: [], datasets: [{ data: [], backgroundColor: color, borderWidth: 0, borderRadius: 1, maxBarThickness: 34 }] },
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
            callbacks: { label: (c) => (c.raw * 100).toFixed(2) + '%' },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: COLORS.text, font: { family: 'JetBrains Mono', size: 10 } } },
          y: {
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
    const labels = dist.map((_, k) => k);
    chart.data.labels = labels;
    chart.data.datasets[0].data = dist;
    chart.data.datasets[0].backgroundColor = color;
    chart.update();
  }, [dist, color]);

  return <canvas ref={canvasRef} />;
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
  
  // target unit
  const [tough, setTough] = useState(4);
  const [woundsPerModel, setWoundsPerModel] = useState(1);
  const [modelsTarget, setModelsTarget] = useState(10);
  const [armour, setArmour] = useState(4);
  const [invuln, setInvuln] = useState(7);
  const [cover, setCover] = useState(7);

  const [modelsView, setModelsView] = useState('distributive'); // 'cumulative' | 'distributive'
  const results = useMemo(() => {
    const { pHit, pWound, pBreachWound, pNoBreachWound, hitNeed, wNeed } =
  resolveHitAndWound(bs, str, tough, activeRules);

    const { pUnsavedGivenHit, saveNormal, saveBreach } =
      resolveUnsavedGivenHit(pBreachWound, pNoBreachWound, ap, armour, invuln, cover);

    const totalDice = fp * modelsFiring;
    const distHits = binomialPMF(totalDice, pHit);
    const distWounds = propagate(distHits, pWound);          // Stage 2 — unaffected by breach
    const distUnsaved = propagate(distHits, pUnsavedGivenHit); // Stage 3 — computed straight from hits
    const { distModels, hitsPerKill } = computeModelsRemoved(distUnsaved, woundsPerModel, dmg, modelsTarget);
    const cdfModels = cdfAtLeast(distModels);

    return { hitNeed, pHit, wNeed, saveNormal, saveBreach, totalDice, distHits, distWounds, distUnsaved, distModels, cdfModels, hitsPerKill };
  }, [bs, fp, modelsFiring, str, ap, dmg, tough, woundsPerModel, modelsTarget, armour, invuln, cover, activeRules]);

  const { saveNormal, saveBreach, hitNeed, totalDice, distHits, distWounds, distUnsaved, distModels, cdfModels, hitsPerKill } = results;

  const modelsChartDist = modelsView === 'cumulative' ? cdfModels : distModels;

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
                  <div className="hint">{bs >= 10 ? 'Automatic hit' : `Needs ${hitNeed}+ to hit`}</div>
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
                {activeRules.map((rule) => {
                  const def = SPECIAL_RULE_DEFINITIONS.find((d) => d.id === rule.id);
                  return (
                    <div className="rule-row" key={rule.id}>
                      <span className="rule-name">{def.label}</span>
                      <select
                        value={rule.value}
                        onChange={(e) => updateRuleValue(rule.id, Number(e.target.value))}
                      >
                        {def.options.map((v) => (
                          <option key={v} value={v}>{v}+</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="rule-remove"
                        onClick={() => removeRule(rule.id)}
                        aria-label={`Remove ${def.label}`}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}

                {availableRules.length > 0 && (
                  <select
                    className="rule-add"
                    value=""
                    onChange={(e) => { if (e.target.value) addRule(e.target.value); }}
                  >
                    <option value="">+ Add special rule…</option>
                    {availableRules.map((def) => (
                      <option key={def.id} value={def.id}>{def.label}</option>
                    ))}
                  </select>
                )}
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
                  <option value="2">2</option><option value="3">3</option><option value="4">4</option>
                  <option value="5">5</option><option value="6">6</option><option value="7">None</option>
                </select>
              </div>
              <div className="field">
                <label>Invulnerable Save</label>
                <select value={invuln} onChange={(e) => setInvuln(Number(e.target.value))}>
                  <option value="7">None</option><option value="2">2</option><option value="3">3</option>
                  <option value="4">4</option><option value="5">5</option><option value="6">6</option>
                </select>
              </div>
              <div className="field">
                <label>Cover Save</label>
                <select value={cover} onChange={(e) => setCover(Number(e.target.value))}>
                  <option value="7">None</option><option value="2">2</option><option value="3">3</option>
                  <option value="4">4</option><option value="5">5</option><option value="6">6</option>
                </select>
              </div>
              <div className="hint">{saveHint}</div>
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
              <div className="chart-wrap"><BarChart dist={distHits} color={COLORS.hits} /></div>
            </div>
          </div>
          <div className="arrow-connector">↓ each hit rolls to wound ↓</div>

          <div className="stage">
            <div className="stage-head">
              <div><div className="num">Stage 02 — Strength vs Toughness</div><h2>Wounds Caused</h2></div>
              <div className="mean"><span className="m-label">Expected</span><span className="m-val">{fmtNum(mean(distWounds))}</span></div>
            </div>
            <div className="stage-body">
              <div className="chart-wrap"><BarChart dist={distWounds} color={COLORS.wounds} /></div>
            </div>
          </div>
          <div className="arrow-connector">↓ each wound rolls a save ↓</div>

          <div className="stage">
            <div className="stage-head">
              <div><div className="num">Stage 03 — Saving Throw</div><h2>Wounds Unsaved</h2></div>
              <div className="mean"><span className="m-label">Expected</span><span className="m-val">{fmtNum(mean(distUnsaved))}</span></div>
            </div>
            <div className="stage-body">
              <div className="chart-wrap"><BarChart dist={distUnsaved} color={COLORS.unsaved} /></div>
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
              <div className="chart-wrap"><BarChart dist={modelsChartDist} color={COLORS.models} /></div>
              <div className="readout-strip">
                <div><div className="rl">Hits/Kill needed</div><div className="rv">{hitsPerKill} unsaved wound{hitsPerKill > 1 ? 's' : ''}</div></div>
                <div><div className="rl">P(&ge;1 model down)</div><div className="rv">{fmtPct(cdfModels[1] ?? 0)}</div></div>
                <div><div className="rl">P(unit wiped out)</div><div className="rv">{fmtPct(cdfModels[modelsTarget] ?? 0)}</div></div>
                <div><div className="rl">Total dice rolled</div><div className="rv">{totalDice}</div></div>
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
