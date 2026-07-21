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
    optionSuffix: '+', // this is a threshold value, — render "X+"
    description: 'Roll ≥ X auto-hits and auto-wounds (treated as a 6 to wound).',
  },
  {
    id: 'poisoned',
    label: 'Poisoned',
    valueLabel: 'X',
    options: [2, 3, 4, 5, 6],
    defaultValue: 6,
    optionSuffix: '+', // this is a threshold value, — render "X+"
    description: 'Roll ≥ X auto-wounds.',
  },
  {
    id: 'breaching',
    label: 'Breaching',
    valueLabel: 'X',
    options: [2, 3, 4, 5, 6],
    defaultValue: 6,
    optionSuffix: '+', // this is a threshold value, — render "X+"
    description: 'A to-wound roll ≥ X sets the wound\'s AP to 2 for its save.',
  },
  {
    id: 'shred',
    label: 'Shred',
    valueLabel: 'X',
    options: [2, 3, 4, 5, 6],
    defaultValue: 6,
    optionSuffix: '+', // this is a threshold value, — render "X+"
    description: 'A to-wound roll ≥ X, before modifiers, increases that wound\'s Damage by 1 if a wound is inflicted.',
  },
  {
    id: 'criticalHit',
    label: 'Critical Hit',
    valueLabel: 'X',
    options: [2, 3, 4, 5, 6],
    defaultValue: 6,
    optionSuffix: '+', // this is a threshold value, — render "X+"
    description: 'A to-hit roll ≥ X (before modifiers) is a Critical Hit: the wound roll is treated as a 6, and that wound\'s Damage is increased by 1. Stacks with Shred.',
  },
  {
    id: 'deflagrate',
    label: 'Deflagrate',
    valueLabel: 'X',
    options: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    defaultValue: 5,
    optionSuffix: '', // this is a Strength value — render "X"
    description: 'At the end of the attack, unsaved wounds from this weapon spawn an equal number of Strength X, AP \u2013, Damage 1 hits with no special rules, resolved against the same target.',
    }
  // future rules go here, e.g.:
  // { id: 'specialrule', label: 'Special Rule', valueLabel: 'X', options: [4,5,6], defaultValue: 5 },
];