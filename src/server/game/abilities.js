"use strict";

const { CLASS_NAMES, ELEMENTS, STATUS_EFFECTS } = require("./constants");

/**
 * Target type is intentionally a simple string enum for now.
 * @typedef {"enemy_single"|"enemy_all"|"ally_single"|"party"|"self"} TargetType
 */

/**
 * @typedef {object} Ability
 * @property {string} id
 * @property {string} name
 * @property {string} element
 * @property {number} mpCost
 * @property {TargetType} targetType
 * @property {number} power
 * @property {string} description
 * @property {string|null} statusEffect
 * @property {string[]|null} classRestriction
 * @property {number} levelRequirement
 */

/** @type {Ability[]} */
const ABILITIES = [
  {
    id: "basic_attack",
    name: "Attack",
    element: ELEMENTS.NULL,
    mpCost: 0,
    targetType: "enemy_single",
    power: 4,
    description: "A basic physical attack.",
    statusEffect: null,
    classRestriction: null,
    levelRequirement: 1
  },
  {
    id: "defend",
    name: "Defend",
    element: ELEMENTS.NULL,
    mpCost: 0,
    targetType: "self",
    power: 0,
    description: "Brace for impact.",
    statusEffect: null,
    classRestriction: null,
    levelRequirement: 1
  },
  {
    id: "flee",
    name: "Flee",
    element: ELEMENTS.NULL,
    mpCost: 0,
    targetType: "self",
    power: 0,
    description: "Attempt to escape the battle.",
    statusEffect: null,
    classRestriction: null,
    levelRequirement: 1
  },
  // Protagonist / Crystalborne
  {
    id: "crystalborne_strike",
    name: "Strike",
    element: ELEMENTS.NULL,
    mpCost: 0,
    targetType: "enemy_single",
    power: 8,
    description: "A basic physical attack.",
    statusEffect: null,
    classRestriction: [CLASS_NAMES.CRYSTALBORNE],
    levelRequirement: 1
  },
  {
    id: "crystalborne_lumen_arc",
    name: "Lumen Arc",
    element: ELEMENTS.LIGHT,
    mpCost: 4,
    targetType: "enemy_single",
    power: 11,
    description: "A Light crystal art that cuts through darkness.",
    statusEffect: null,
    classRestriction: [CLASS_NAMES.CRYSTALBORNE],
    levelRequirement: 1
  },

  // Lysa / Sage
  {
    id: "sage_mend",
    name: "Mend",
    element: ELEMENTS.LIGHT,
    mpCost: 5,
    targetType: "ally_single",
    power: 12,
    description: "Restore HP to one ally.",
    statusEffect: null,
    classRestriction: [CLASS_NAMES.SAGE],
    levelRequirement: 1
  },
  {
    id: "sage_barrier",
    name: "Barrier",
    element: ELEMENTS.LIGHT,
    mpCost: 6,
    targetType: "ally_single",
    power: 0,
    description: "Erect a protective ward that reduces damage (future logic).",
    statusEffect: null,
    classRestriction: [CLASS_NAMES.SAGE],
    levelRequirement: 2
  },
  {
    id: "sage_scan",
    name: "Scan",
    element: ELEMENTS.NULL,
    mpCost: 2,
    targetType: "enemy_single",
    power: 0,
    description: "Reveal enemy strengths and weaknesses (future logic).",
    statusEffect: null,
    classRestriction: [CLASS_NAMES.SAGE],
    levelRequirement: 1
  },

  // Garron / Knight
  {
    id: "knight_taunt",
    name: "Taunt",
    element: ELEMENTS.NULL,
    mpCost: 3,
    targetType: "enemy_all",
    power: 0,
    description: "Draw enemy attention and protect allies (future logic).",
    statusEffect: null,
    classRestriction: [CLASS_NAMES.KNIGHT],
    levelRequirement: 1
  },
  {
    id: "knight_heavy_strike",
    name: "Heavy Strike",
    element: ELEMENTS.NULL,
    mpCost: 2,
    targetType: "enemy_single",
    power: 14,
    description: "A crushing blow that favors strength over speed.",
    statusEffect: null,
    classRestriction: [CLASS_NAMES.KNIGHT],
    levelRequirement: 1
  },

  // Mira / Aeromancer
  {
    id: "aeromancer_gale_sweep",
    name: "Gale Sweep",
    element: ELEMENTS.WIND,
    mpCost: 6,
    targetType: "enemy_all",
    power: 9,
    description: "A sweeping wind that hits all foes.",
    statusEffect: null,
    classRestriction: [CLASS_NAMES.AEROMANCER],
    levelRequirement: 1
  },
  {
    id: "aeromancer_chain_spark",
    name: "Chain Spark",
    element: ELEMENTS.WIND,
    mpCost: 5,
    targetType: "enemy_single",
    power: 13,
    description: "A focused lightning-tinged strike on one target.",
    statusEffect: null,
    classRestriction: [CLASS_NAMES.AEROMANCER],
    levelRequirement: 2
  },
  {
    id: "aeromancer_haste",
    name: "Haste",
    element: ELEMENTS.WIND,
    mpCost: 4,
    targetType: "ally_single",
    power: 0,
    description: "Boost an ally's speed (future logic).",
    statusEffect: null,
    classRestriction: [CLASS_NAMES.AEROMANCER],
    levelRequirement: 1
  },

  // Thalen / Umbramancer
  {
    id: "umbramancer_venom_hex",
    name: "Venom Hex",
    element: ELEMENTS.SHADOW,
    mpCost: 4,
    targetType: "enemy_single",
    power: 6,
    description: "A shadowy curse that poisons the target.",
    statusEffect: STATUS_EFFECTS.POISON,
    classRestriction: [CLASS_NAMES.UMBRAMANCER],
    levelRequirement: 1
  },
  {
    id: "umbramancer_sunder_ward",
    name: "Sunder Ward",
    element: ELEMENTS.SHADOW,
    mpCost: 5,
    targetType: "enemy_single",
    power: 8,
    description: "Weaken the target's defenses (future logic).",
    statusEffect: STATUS_EFFECTS.WEAKEN,
    classRestriction: [CLASS_NAMES.UMBRAMANCER],
    levelRequirement: 2
  },

  // Lyra / Crystal Knight
  {
    id: "crystal_knight_crystal_blade",
    name: "Crystal Blade",
    element: ELEMENTS.LIGHT,
    mpCost: 3,
    targetType: "enemy_single",
    power: 12,
    description: "A radiant blade technique powered by crystal resonance.",
    statusEffect: null,
    classRestriction: [CLASS_NAMES.CRYSTAL_KNIGHT],
    levelRequirement: 1
  },
  {
    id: "crystal_knight_prismatic_aegis",
    name: "Prismatic Aegis",
    element: ELEMENTS.LIGHT,
    mpCost: 7,
    targetType: "party",
    power: 0,
    description: "Shield the entire party (future logic).",
    statusEffect: null,
    classRestriction: [CLASS_NAMES.CRYSTAL_KNIGHT],
    levelRequirement: 2
  }
];

/** @type {Record<string, Ability>} */
const ABILITIES_BY_ID = Object.freeze(
  ABILITIES.reduce((acc, ability) => {
    acc[ability.id] = ability;
    return acc;
  }, {})
);

/** @type {Record<string, Ability[]>} */
const ABILITIES_BY_CLASS = Object.freeze({
  [CLASS_NAMES.CRYSTALBORNE]: Object.freeze(ABILITIES.filter((a) => a.classRestriction?.includes(CLASS_NAMES.CRYSTALBORNE))),
  [CLASS_NAMES.SAGE]: Object.freeze(ABILITIES.filter((a) => a.classRestriction?.includes(CLASS_NAMES.SAGE))),
  [CLASS_NAMES.KNIGHT]: Object.freeze(ABILITIES.filter((a) => a.classRestriction?.includes(CLASS_NAMES.KNIGHT))),
  [CLASS_NAMES.AEROMANCER]: Object.freeze(ABILITIES.filter((a) => a.classRestriction?.includes(CLASS_NAMES.AEROMANCER))),
  [CLASS_NAMES.UMBRAMANCER]: Object.freeze(ABILITIES.filter((a) => a.classRestriction?.includes(CLASS_NAMES.UMBRAMANCER))),
  [CLASS_NAMES.CRYSTAL_KNIGHT]: Object.freeze(ABILITIES.filter((a) => a.classRestriction?.includes(CLASS_NAMES.CRYSTAL_KNIGHT)))
});

module.exports = {
  ABILITIES,
  ABILITIES_BY_ID,
  ABILITIES_BY_CLASS
};
