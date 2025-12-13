"use strict";

const CLASS_NAMES = Object.freeze({
  CRYSTALBORNE: "CRYSTALBORNE",
  SAGE: "SAGE",
  KNIGHT: "KNIGHT",
  AEROMANCER: "AEROMANCER",
  UMBRAMANCER: "UMBRAMANCER",
  CRYSTAL_KNIGHT: "CRYSTAL_KNIGHT"
});

// Note: NULL is intentionally a string here for easy serialization.
const ELEMENTS = Object.freeze({
  LIGHT: "LIGHT",
  SHADOW: "SHADOW",
  FIRE: "FIRE",
  WATER: "WATER",
  EARTH: "EARTH",
  WIND: "WIND",
  NULL: "NULL"
});

const STATUS_EFFECTS = Object.freeze({
  POISON: "POISON",
  STUN: "STUN",
  SLOW: "SLOW",
  SILENCE: "SILENCE",
  WEAKEN: "WEAKEN",
  BURN: "BURN"
});

// Simple, extendable mapping for future combat logic.
// Convention: ELEMENTAL_WEAKNESS[attackerElement] = defenderElementThatResistsIt
// Example: FIRE is weak to WATER.
const ELEMENTAL_WEAKNESS = Object.freeze({
  [ELEMENTS.FIRE]: ELEMENTS.WATER,
  [ELEMENTS.WATER]: ELEMENTS.EARTH,
  [ELEMENTS.EARTH]: ELEMENTS.WIND,
  [ELEMENTS.WIND]: ELEMENTS.FIRE,
  [ELEMENTS.LIGHT]: ELEMENTS.SHADOW,
  [ELEMENTS.SHADOW]: ELEMENTS.LIGHT,
  [ELEMENTS.NULL]: ELEMENTS.NULL
});

module.exports = {
  CLASS_NAMES,
  ELEMENTS,
  STATUS_EFFECTS,
  ELEMENTAL_WEAKNESS,
  CLASS_NAME_LIST: Object.freeze(Object.values(CLASS_NAMES)),
  ELEMENT_LIST: Object.freeze(Object.values(ELEMENTS)),
  STATUS_EFFECT_LIST: Object.freeze(Object.values(STATUS_EFFECTS))
};
