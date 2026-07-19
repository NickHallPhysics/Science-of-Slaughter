/**
 * specialRules.js
 * Definition of all rules used to modify to hit/wound/save probabilities.
 * No DOM, no Chart.js, no React — every export here is a plain function
 * of its arguments, imported directly by both App.jsx and combatMath.test.js.
 * There is exactly one copy of this logic in the whole project.
 */

// ---------- special rule definitions ----------
export const SPECIAL_RULE_DEFINITIONS = [
  {
    id: 'rending',
    label: 'Rending',
    valueLabel: 'X',
    options: [2, 3, 4, 5, 6],
    defaultValue: 6,
    description: 'Roll ≥ X auto-hits and auto-wounds (treated as a 6 to wound).',
  },
  {
    id: 'poisoned',
    label: 'Poisoned',
    valueLabel: 'X',
    options: [2, 3, 4, 5, 6],
    defaultValue: 6,
    description: 'Roll ≥ X auto-wounds.',
  },
  {
  id: 'breaching',
  label: 'Breaching',
  valueLabel: 'X',
  options: [2, 3, 4, 5, 6],
  defaultValue: 6,
  description: 'A to-wound roll ≥ X sets the wound\'s AP to 2 for its save. A Rending-forced wound (treated as a 6) always breaches.',
  },
  // future rules go here, e.g.:
  // { id: 'specialrule', label: 'Special Rule', valueLabel: 'X', options: [4,5,6], defaultValue: 5 },
];