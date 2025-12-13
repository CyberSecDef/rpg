"use strict";

function assertNonEmptyString(name, value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function assertNumber(name, value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new TypeError(`${name} must be a number`);
  }
}

class Stats {
  /**
   * @param {object} params
   * @param {number} params.hp
   * @param {number} params.maxHp
   * @param {number} params.mp
   * @param {number} params.maxMp
   * @param {number} params.strength
   * @param {number} params.defense
   * @param {number} params.magic
   * @param {number} params.speed
   * @param {number} params.spirit
   * @param {number} params.luck
   */
  constructor({ hp, maxHp, mp, maxMp, strength, defense, magic, speed, spirit, luck }) {
    assertNumber("hp", hp);
    assertNumber("maxHp", maxHp);
    assertNumber("mp", mp);
    assertNumber("maxMp", maxMp);
    assertNumber("strength", strength);
    assertNumber("defense", defense);
    assertNumber("magic", magic);
    assertNumber("speed", speed);
    assertNumber("spirit", spirit);
    assertNumber("luck", luck);

    this.hp = hp;
    this.maxHp = maxHp;
    this.mp = mp;
    this.maxMp = maxMp;
    this.strength = strength;
    this.defense = defense;
    this.magic = magic;
    this.speed = speed;
    this.spirit = spirit;
    this.luck = luck;
  }

  clone() {
    return new Stats({
      hp: this.hp,
      maxHp: this.maxHp,
      mp: this.mp,
      maxMp: this.maxMp,
      strength: this.strength,
      defense: this.defense,
      magic: this.magic,
      speed: this.speed,
      spirit: this.spirit,
      luck: this.luck
    });
  }
}

class Character {
  /**
   * @param {object} params
   * @param {string} params.id
   * @param {string} params.name
   * @param {string} params.className
   * @param {number} params.level
   * @param {number} params.experience
   * @param {Stats} params.stats
   * @param {string[]} [params.statusEffects]
   * @param {Record<string, any>} [params.equippedItems]
   * @param {Record<string, number>} [params.crystalResonance]
   */
  constructor({
    id,
    name,
    className,
    level,
    experience,
    stats,
    statusEffects = [],
    equippedItems = {},
    crystalResonance = {}
  }) {
    assertNonEmptyString("id", id);
    assertNonEmptyString("name", name);
    assertNonEmptyString("className", className);
    assertNumber("level", level);
    assertNumber("experience", experience);
    if (!(stats instanceof Stats)) {
      throw new TypeError("stats must be an instance of Stats");
    }
    if (!Array.isArray(statusEffects)) {
      throw new TypeError("statusEffects must be an array");
    }

    this.id = id;
    this.name = name;
    this.className = className;
    this.level = level;
    this.experience = experience;
    this.stats = stats;
    this.statusEffects = statusEffects.slice();
    this.equippedItems = { ...equippedItems };
    this.crystalResonance = { ...crystalResonance };
  }

  clone() {
    return new Character({
      id: this.id,
      name: this.name,
      className: this.className,
      level: this.level,
      experience: this.experience,
      stats: this.stats.clone(),
      statusEffects: this.statusEffects.slice(),
      equippedItems: { ...this.equippedItems },
      crystalResonance: { ...this.crystalResonance }
    });
  }
}

class Party {
  /**
   * @param {object} params
   * @param {string} params.id
   * @param {string} params.playerId
   * @param {Character[]} params.members
   * @param {number} params.activeMemberIndex
   * @param {"overworld"|"battle"} params.currentState
   */
  constructor({ id, playerId, members, activeMemberIndex, currentState }) {
    assertNonEmptyString("id", id);
    assertNonEmptyString("playerId", playerId);
    if (!Array.isArray(members) || members.some((m) => !(m instanceof Character))) {
      throw new TypeError("members must be an array of Character");
    }
    assertNumber("activeMemberIndex", activeMemberIndex);
    if (currentState !== "overworld" && currentState !== "battle") {
      throw new TypeError("currentState must be 'overworld' or 'battle'");
    }

    this.id = id;
    this.playerId = playerId;
    this.members = members.slice();
    this.activeMemberIndex = activeMemberIndex;
    this.currentState = currentState;
  }

  get activeMember() {
    return this.members[this.activeMemberIndex] ?? null;
  }

  clone() {
    return new Party({
      id: this.id,
      playerId: this.playerId,
      members: this.members.map((m) => m.clone()),
      activeMemberIndex: this.activeMemberIndex,
      currentState: this.currentState
    });
  }
}

class Player {
  /**
   * @param {object} params
   * @param {string} params.id
   * @param {string} params.displayName
   * @param {string} params.connectionId
   * @param {string} params.currentLocation
   * @param {string} params.activePartyId
   */
  constructor({ id, displayName, connectionId, currentLocation, activePartyId }) {
    assertNonEmptyString("id", id);
    assertNonEmptyString("displayName", displayName);
    assertNonEmptyString("connectionId", connectionId);
    assertNonEmptyString("currentLocation", currentLocation);
    assertNonEmptyString("activePartyId", activePartyId);

    this.id = id;
    this.displayName = displayName;
    this.connectionId = connectionId;
    this.currentLocation = currentLocation;
    this.activePartyId = activePartyId;
  }

  clone() {
    return new Player({
      id: this.id,
      displayName: this.displayName,
      connectionId: this.connectionId,
      currentLocation: this.currentLocation,
      activePartyId: this.activePartyId
    });
  }
}

function makeCharacterId(name) {
  return `char_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${Math.random().toString(16).slice(2, 8)}`;
}

function defaultCrystalResonance() {
  return {
    forest: 0,
    water: 0,
    fire: 0,
    earth: 0,
    wind: 0,
    shadow: 0
  };
}

function createDefaultProtagonist() {
  return new Character({
    id: makeCharacterId("Protagonist"),
    name: "Protagonist",
    className: "Wanderer",
    level: 1,
    experience: 0,
    stats: new Stats({
      hp: 24,
      maxHp: 24,
      mp: 8,
      maxMp: 8,
      strength: 6,
      defense: 5,
      magic: 4,
      speed: 6,
      spirit: 5,
      luck: 5
    }),
    statusEffects: [],
    equippedItems: {
      weapon: "Traveler's Blade",
      armor: "Worn Tunic",
      accessory: null
    },
    crystalResonance: defaultCrystalResonance()
  });
}

function createLysa() {
  return new Character({
    id: makeCharacterId("Lysa"),
    name: "Lysa",
    className: "Runesinger",
    level: 1,
    experience: 0,
    stats: new Stats({
      hp: 18,
      maxHp: 18,
      mp: 18,
      maxMp: 18,
      strength: 3,
      defense: 4,
      magic: 8,
      speed: 6,
      spirit: 7,
      luck: 5
    }),
    statusEffects: [],
    equippedItems: { weapon: "Glyph Wand", armor: "Apprentice Robe", accessory: "Focus Charm" },
    crystalResonance: { ...defaultCrystalResonance(), wind: 1 }
  });
}

function createGarron() {
  return new Character({
    id: makeCharacterId("Garron"),
    name: "Garron",
    className: "Bulwark",
    level: 1,
    experience: 0,
    stats: new Stats({
      hp: 30,
      maxHp: 30,
      mp: 6,
      maxMp: 6,
      strength: 7,
      defense: 8,
      magic: 2,
      speed: 3,
      spirit: 4,
      luck: 4
    }),
    statusEffects: [],
    equippedItems: { weapon: "Iron Hammer", armor: "Stoneplate", accessory: null },
    crystalResonance: { ...defaultCrystalResonance(), earth: 1 }
  });
}

function createMira() {
  return new Character({
    id: makeCharacterId("Mira"),
    name: "Mira",
    className: "Duskblade",
    level: 1,
    experience: 0,
    stats: new Stats({
      hp: 22,
      maxHp: 22,
      mp: 10,
      maxMp: 10,
      strength: 6,
      defense: 4,
      magic: 5,
      speed: 8,
      spirit: 4,
      luck: 6
    }),
    statusEffects: [],
    equippedItems: { weapon: "Twin Daggers", armor: "Shadowwrap", accessory: "Smoke Ring" },
    crystalResonance: { ...defaultCrystalResonance(), shadow: 1 }
  });
}

function createThalen() {
  return new Character({
    id: makeCharacterId("Thalen"),
    name: "Thalen",
    className: "Tidecaller",
    level: 1,
    experience: 0,
    stats: new Stats({
      hp: 20,
      maxHp: 20,
      mp: 16,
      maxMp: 16,
      strength: 4,
      defense: 5,
      magic: 7,
      speed: 5,
      spirit: 7,
      luck: 4
    }),
    statusEffects: [],
    equippedItems: { weapon: "Coral Staff", armor: "Seafarer's Mantle", accessory: null },
    crystalResonance: { ...defaultCrystalResonance(), water: 1 }
  });
}

function createLyra() {
  return new Character({
    id: makeCharacterId("Lyra"),
    name: "Lyra",
    className: "Emberwright",
    level: 1,
    experience: 0,
    stats: new Stats({
      hp: 21,
      maxHp: 21,
      mp: 14,
      maxMp: 14,
      strength: 5,
      defense: 4,
      magic: 7,
      speed: 6,
      spirit: 5,
      luck: 5
    }),
    statusEffects: [],
    equippedItems: { weapon: "Cinder Rod", armor: "Ashweave", accessory: "Spark Locket" },
    crystalResonance: { ...defaultCrystalResonance(), fire: 1 }
  });
}

module.exports = {
  Player,
  Party,
  Character,
  Stats,
  createDefaultProtagonist,
  createLysa,
  createGarron,
  createMira,
  createThalen,
  createLyra
};
