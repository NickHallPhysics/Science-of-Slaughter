export const DAMAGE_MITIGATION_DEFINITIONS = [
  {
    id: 'shrouded',
    label: 'Shrouded',
    valueLabel: 'X',
    options: [2, 3, 4, 5, 6],
    defaultValue: 5,
    description: 'After a wound fails its Saving Throw, roll an additional D6: a result ≥ X ignores the wound entirely.',
  },
  {
    id: 'feel_no_pain',
    label: 'Feel No Pain',
    valueLabel: 'X',
    options: [2, 3, 4, 5, 6],
    defaultValue: 5,
    description: 'After a wound fails its Saving Throw, roll an additional D6: a result ≥ X ignores the wound entirely.',
  },
  {
  id: 'medic',
  label: 'Medic',
  valueLabel: 'X',
  options: [2, 3, 4, 5, 6],
  defaultValue: 4,
  description: 'The first time a Model is allocated one or more Unsaved Wounds, it makes a Recovery Test (roll ≥ X to pass). On a pass, one of the Unsaved wounds allocated to the model is reduced by 1 Damage (to a minimum of 0).',
  }
  // future rules go here, e.g.:
  // { id: 'specialrule', label: 'Special Rule', valueLabel: 'X', options: [4,5,6], defaultValue: 5 },
];