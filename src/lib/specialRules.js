/**
 * specialRules.js
 * Definition of all rules used to modify to hit/wound/save probabilities.
 * No DOM, no Chart.js, no React — every export here is a plain function
 * of its arguments, imported directly by both App.jsx and combatMath.test.js.
 * There is exactly one copy of this logic in the whole project.
 */

// ---------- special rule definitions ----------
export const OFFENSIVE_SPECIAL_RULE_DEFINITIONS = [
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
  },
  {
    id: 'murderous',
    label: 'Murderous',
    valueLabel: 'X',
    options: [2, 3, 4, 5, 6],
    defaultValue: 6,
    optionSuffix: '+', // this is a threshold value, — render "X+"
    description: 'A to-wound roll ≥ X (before modifiers) ignores the Eternal Warrior (X) special rule',
  },
  // future rules go here, e.g.:
  // { id: 'specialrule', label: 'Special Rule', valueLabel: 'X', options: [4,5,6], defaultValue: 5 },
];

export const DEFENSIVE_SPECIAL_RULE_DEFINITIONS = [
  {
    id: 'eternalWarrior',
    label: 'Eternal Warrior',
    valueLabel: 'X',
    options: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    defaultValue: 1,
    optionSuffix: '', // a flat Damage reduction amount, not a dice threshold
    description: 'Reduces the Damage of each Unsaved Wound allocated to this model by X, to a minimum of 1.',
  },
  {
    id: 'salamanders',
    label: 'Legiones Astartes: Salamanders',
    valueLabel: 'X',
    fixedValue: 3,
    optionSuffix: '', // a flat Damage reduction amount, not a dice threshold
    description: 'Wound Tests made against Salamanders fail on the unmodified roll of 1 or 2.',
  },
  {
    id: 'ironHands',
    label: 'Legiones Astartes: Iron Hands',
    valueLabel: 'X',
    fixedValue: 1,
    optionSuffix: '', // a flat Damage reduction amount, not a dice threshold
    description: 'Shooting Attacks targeting Iron Hands suffer a -1 Strength penalty.',
  },
  // future rules go here, e.g.:
  // { id: 'specialrule', label: 'Special Rule', valueLabel: 'X', options: [4,5,6], defaultValue: 5 },
];

export const TRAITS_DEFINITIONS = [
  {
    id: 'arc',
    label: 'Arc',
    valueLabel: 'X',
    description: 'Arc Trait.',
  },
  {
    id: 'assault',
    label: 'Assault',
    valueLabel: 'X',
    description: 'Assault Trait.',
  },
  {
    id: 'auto',
    label: 'Auto',
    valueLabel: 'X',
    description: 'Auto Trait.',
  },
  {
    id: 'bolt',
    label: 'Bolt',
    valueLabel: 'X',
    description: 'Bolt Trait.',
  },
  {
    id: 'conversion',
    label: 'Conversion',
    valueLabel: 'X',
    description: 'Conversion Trait.',
  },
  {
    id: 'disintegrator',
    label: 'Disintegrator',
    valueLabel: 'X',
    description: 'Disintegrator Trait.',
  },
  {
    id: 'graviton',
    label: 'Graviton',
    valueLabel: 'X',
    description: 'Graviton Trait.',
  },
  {
    id: 'flame',
    label: 'Flame',
    valueLabel: 'X',
    description: 'Flame Trait.',
  },
  {
    id: 'las',
    label: 'Las',
    valueLabel: 'X',
    description: 'Las Trait.',
  },
  {
    id: 'melta',
    label: 'Melta',
    valueLabel: 'X',
    description: 'Melta Trait.',
  },
  {
    id: 'missile',
    label: 'Missile',
    valueLabel: 'X',
    description: 'Missile Trait.',
  },
  {
    id: 'needle',
    label: 'Needle',
    valueLabel: 'X',
    description: 'Needle Trait.',
  },
  {
    id: 'particle',
    label: 'Particle',
    valueLabel: 'X',
    description: 'Particle Trait.',
  },
  {
    id: 'phosphex',
    label: 'Phosphex',
    valueLabel: 'X',
    description: 'Phosphex Trait.',
  },
  {
    id: 'plasma',
    label: 'Plasma',
    valueLabel: 'X',
    description: 'Plasma Trait.',
  },
  {
    id: 'rad',
    label: 'Rad',
    valueLabel: 'X',
    description: 'Rad Trait.',
  },
  {
    id: 'sonic',
    label: 'Sonic',
    valueLabel: 'X',
    description: 'Sonic Trait.',
  },
  {
    id: 'stasis',
    label: 'Stasis',
    valueLabel: 'X',
    description: 'Stasis Trait.',
  },
  {
    id: 'strategic',
    label: 'Strategic',
    valueLabel: 'X',
    description: 'Strategic Trait.',
  },
  {
    id: 'strike',
    label: 'Strike',
    valueLabel: 'X',
    description: 'Strike Trait.',
  },
  {
    id: 'tactical',
    label: 'Tactical',
    valueLabel: 'X',
    description: 'Tactical Trait.',
  },
  {
    id: 'volkite',
    label: 'Volkite',
    valueLabel: 'X',
    description: 'Volkite Trait.',
  },
  // future rules go here, e.g.:
  // { id: 'specialrule', label: 'Special Rule', valueLabel: 'X',  description: 'Description of the trait'},
];
