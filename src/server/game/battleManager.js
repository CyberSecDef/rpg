"use strict";

const { ABILITIES_BY_ID } = require("./abilities");
const { ELEMENTS, ELEMENTAL_WEAKNESS } = require("./constants");

/**
 * In-memory battle store keyed by battle id.
 * NOTE: This is process-local and resets on server restart.
 */
const battlesById = new Map();

// We keep party references in a side-map to avoid adding extra fields to the Battle object.
const partyByBattleId = new Map();

function makeBattleId() {
  return `battle_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function getUnitSpeed(unit) {
  const s = unit?.stats?.speed;
  return typeof s === "number" && !Number.isNaN(s) ? s : 0;
}

function getUnitName(unit) {
  return typeof unit?.name === "string" && unit.name.trim() ? unit.name : (typeof unit?.id === "string" ? unit.id : "Unknown");
}

function getUnitElement(unit) {
  // Prefer explicit element on the unit (e.g., enemies).
  if (typeof unit?.element === "string" && unit.element.trim()) return unit.element;

  // Try to infer from crystalResonance if it uses ELEMENT names (case-insensitive).
  const cr = unit?.crystalResonance;
  if (cr && typeof cr === "object") {
    let bestElement = null;
    let bestValue = -Infinity;
    for (const [k, v] of Object.entries(cr)) {
      if (typeof v !== "number" || Number.isNaN(v)) continue;
      const normalized = String(k).toUpperCase();
      if (!Object.prototype.hasOwnProperty.call(ELEMENTS, normalized)) continue;
      if (v > bestValue) {
        bestValue = v;
        bestElement = ELEMENTS[normalized];
      }
    }
    if (bestElement) return bestElement;
  }

  return null;
}

function elementalMultiplier(abilityElement, targetElement) {
  if (!abilityElement || abilityElement === ELEMENTS.NULL) return 1.0;
  if (!targetElement || targetElement === ELEMENTS.NULL) return 1.0;

  // Using mapping like FIRE weak to WATER.
  // If target is FIRE and we hit with WATER -> bonus.
  if (ELEMENTAL_WEAKNESS[targetElement] === abilityElement) return 1.25;
  // If we hit with FIRE and target is WATER -> reduced.
  if (ELEMENTAL_WEAKNESS[abilityElement] === targetElement) return 0.75;
  // Same-element slight resistance.
  if (abilityElement === targetElement) return 0.9;
  return 1.0;
}

function clampHp(stats) {
  if (!stats) return;
  if (typeof stats.maxHp === "number" && typeof stats.hp === "number") {
    stats.hp = Math.max(0, Math.min(stats.maxHp, stats.hp));
  }
}

function findUnitInBattle(battle, unitId) {
  const party = getPartyForBattle(battle.id);
  const members = Array.isArray(party?.members) ? party.members : [];
  const partyUnit = members.find((m) => m && m.id === unitId);
  if (partyUnit) return { kind: "party", unit: partyUnit };

  const enemyUnit = (battle.enemies || []).find((e) => e && e.id === unitId);
  if (enemyUnit) return { kind: "enemy", unit: enemyUnit };
  return null;
}

function getUnitHp(unit) {
  const hp = unit?.stats?.hp;
  return typeof hp === "number" && !Number.isNaN(hp) ? hp : 0;
}

function isAlive(unit) {
  return getUnitHp(unit) > 0;
}

/**
 * TurnOrder entry.
 * @typedef {object} TurnRef
 * @property {"party"|"enemy"} kind
 * @property {string} id
 */

/**
 * Battle object structure.
 * @typedef {object} Battle
 * @property {string} id
 * @property {string} partyId
 * @property {any[]} enemies
 * @property {TurnRef[]} turnOrder
 * @property {number} activeTurnIndex
 * @property {string[]} log
 * @property {"pending"|"in_progress"|"victory"|"defeat"} state
 */

/**
 * Calculates initial turn order based on speed stat.
 * @param {any} party - expects { id, members: [{ id, stats: { speed, hp } }] }
 * @param {any[]} enemies - expects [{ id, stats: { speed, hp } }]
 * @returns {TurnRef[]}
 */
function calculateInitialTurnOrder(party, enemies) {
  const members = Array.isArray(party?.members) ? party.members : [];
  const foeList = Array.isArray(enemies) ? enemies : [];

  /** @type {Array<{ref: TurnRef, speed: number, tie: string}>} */
  const entries = [];

  for (const m of members) {
    if (!m || typeof m.id !== "string") continue;
    if (!isAlive(m)) continue;
    entries.push({ ref: { kind: "party", id: m.id }, speed: getUnitSpeed(m), tie: `p_${m.id}` });
  }

  for (const e of foeList) {
    if (!e || typeof e.id !== "string") continue;
    if (!isAlive(e)) continue;
    entries.push({ ref: { kind: "enemy", id: e.id }, speed: getUnitSpeed(e), tie: `e_${e.id}` });
  }

  entries.sort((a, b) => {
    if (b.speed !== a.speed) return b.speed - a.speed;
    return a.tie.localeCompare(b.tie);
  });

  return entries.map((e) => e.ref);
}

function getBattleById(battleId) {
  return battlesById.get(battleId) ?? null;
}

function getPartyForBattle(battleId) {
  return partyByBattleId.get(battleId) ?? null;
}

function deleteBattleById(battleId) {
  battlesById.delete(battleId);
  partyByBattleId.delete(battleId);
}

function setBattle(battle) {
  battlesById.set(battle.id, battle);
  return battle;
}

/**
 * Update a battle by id.
 * @param {string} battleId
 * @param {(battle: Battle) => Battle} updater
 */
function updateBattleById(battleId, updater) {
  const existing = getBattleById(battleId);
  if (!existing) return null;
  const next = updater(existing);
  if (!next || next.id !== existing.id) {
    throw new Error("Battle updater must return the same battle id");
  }
  battlesById.set(battleId, next);
  return next;
}

/**
 * Creates a new battle and stores it.
 * @param {any} party - expects { id, members }
 * @param {any[]} enemies
 * @returns {Battle}
 */
function createBattle(party, enemies) {
  if (!party || typeof party.id !== "string") {
    throw new TypeError("createBattle: party must have an id");
  }
  if (!Array.isArray(enemies)) {
    throw new TypeError("createBattle: enemies must be an array");
  }

  const id = makeBattleId();
  const turnOrder = calculateInitialTurnOrder(party, enemies);

  /** @type {Battle} */
  const battle = {
    id,
    partyId: party.id,
    enemies: enemies.map((e) => ({ ...e })),
    turnOrder,
    activeTurnIndex: 0,
    log: [`Battle ${id} created.`],
    state: "pending"
  };

  partyByBattleId.set(id, party);

  // Start immediately if there is anyone to act.
  battle.state = battle.turnOrder.length > 0 ? "in_progress" : "defeat";
  if (battle.state === "in_progress") battle.log.push("Battle started.");

  setBattle(battle);
  return battle;
}

/**
 * Returns the active unit (party member or enemy) for the current turn.
 * @param {Battle} battle
 */
function getActiveUnit(battle) {
  if (!battle || !Array.isArray(battle.turnOrder) || battle.turnOrder.length === 0) return null;
  const ref = battle.turnOrder[battle.activeTurnIndex % battle.turnOrder.length];
  if (!ref) return null;

  if (ref.kind === "enemy") {
    return battle.enemies.find((e) => e.id === ref.id) ?? null;
  }

  if (ref.kind === "party") {
    const party = getPartyForBattle(battle.id);
    const members = Array.isArray(party?.members) ? party.members : [];
    return members.find((m) => m.id === ref.id) ?? null;
  }

  return null;
}

function recomputeState(battle) {
  const party = getPartyForBattle(battle.id);
  const members = Array.isArray(party?.members) ? party.members : [];

  const partyAlive = members.some(isAlive);
  const enemiesAlive = Array.isArray(battle.enemies) ? battle.enemies.some(isAlive) : false;

  if (!partyAlive) return "defeat";
  if (!enemiesAlive) return "victory";
  return "in_progress";
}

function pruneDeadFromTurnOrder(battle) {
  const party = getPartyForBattle(battle.id);
  const members = Array.isArray(party?.members) ? party.members : [];

  const alivePartyIds = new Set(members.filter(isAlive).map((m) => m.id));
  const aliveEnemyIds = new Set((battle.enemies || []).filter(isAlive).map((e) => e.id));

  battle.turnOrder = battle.turnOrder.filter((ref) => {
    if (ref.kind === "party") return alivePartyIds.has(ref.id);
    if (ref.kind === "enemy") return aliveEnemyIds.has(ref.id);
    return false;
  });

  if (battle.turnOrder.length === 0) battle.activeTurnIndex = 0;
  else battle.activeTurnIndex = battle.activeTurnIndex % battle.turnOrder.length;
}

/**
 * Execute a single command (typically one turn's action).
 * Command shape: { type, sourceId, targetId, abilityId }
 * @param {Battle} battle
 * @param {{type:string, sourceId:string, targetId:string, abilityId:string}} command
 * @returns {Battle}
 */
function executeCommand(battle, command) {
  if (!battle) throw new TypeError("executeCommand: battle is required");
  if (!command || typeof command !== "object") throw new TypeError("executeCommand: command is required");
  if (battle.state !== "in_progress") return battle;

  const abilityId = command.abilityId;
  const ability = typeof abilityId === "string" ? ABILITIES_BY_ID[abilityId] : null;
  if (!ability) {
    battle.log.push("Invalid command: unknown ability.");
    return battle;
  }

  // Minimal escape behavior.
  if (abilityId === "flee") {
    const sourceName = getUnitName(findUnitInBattle(battle, command.sourceId)?.unit);
    battle.log.push(`${sourceName} fled.`);
    battle.state = "defeat";
    return battle;
  }

  const activeRef = battle.turnOrder[battle.activeTurnIndex % battle.turnOrder.length];
  if (!activeRef || activeRef.id !== command.sourceId) {
    battle.log.push("Invalid command: not active unit.");
    return battle;
  }

  const sourceFound = findUnitInBattle(battle, command.sourceId);
  const targetFound = findUnitInBattle(battle, command.targetId);
  if (!sourceFound || !targetFound) {
    battle.log.push("Invalid command: missing source/target.");
    return battle;
  }

  const source = sourceFound.unit;
  const target = targetFound.unit;

  // MP cost
  if (ability.mpCost > 0) {
    if (!source.stats || typeof source.stats.mp !== "number") {
      battle.log.push(`${getUnitName(source)} failed to cast ${ability.name}.`);
      return battle;
    }
    if (source.stats.mp < ability.mpCost) {
      battle.log.push(`${getUnitName(source)} tried ${ability.name} but lacked MP.`);
      return battle;
    }
    source.stats.mp = Math.max(0, source.stats.mp - ability.mpCost);
  }

  const isHealingTarget = ability.targetType === "ally_single" || ability.targetType === "party" || ability.targetType === "self";
  const sourceStr = typeof source.stats?.strength === "number" ? source.stats.strength : 0;
  const sourceMag = typeof source.stats?.magic === "number" ? source.stats.magic : 0;
  const targetDef = typeof target.stats?.defense === "number" ? target.stats.defense : 0;
  const targetSpi = typeof target.stats?.spirit === "number" ? target.stats.spirit : 0;

  const abilityElement = ability.element;
  const targetElement = getUnitElement(target);
  const mult = elementalMultiplier(abilityElement, targetElement);

  let amount = 0;
  let verb = "used";

  if (ability.power > 0 && isHealingTarget) {
    // Healing formula (simple): power + magic*1.1
    amount = Math.max(1, Math.floor((ability.power + sourceMag * 1.1) * mult));
    if (target.stats && typeof target.stats.hp === "number") {
      target.stats.hp = target.stats.hp + amount;
      clampHp(target.stats);
    }
    verb = "cast";
  } else if (ability.power > 0) {
    // Damage formula: (power + STR) for physical (NULL element) else (power + MAG)
    // Mitigation: DEF (physical) or SPIRIT (elemental)
    const offense = (abilityElement === ELEMENTS.NULL ? sourceStr : sourceMag) + ability.power;
    const mitigation = (abilityElement === ELEMENTS.NULL ? targetDef : targetSpi) * 0.6;
    amount = Math.max(1, Math.floor((offense - mitigation) * mult));

    if (target.stats && typeof target.stats.hp === "number") {
      target.stats.hp = Math.max(0, target.stats.hp - amount);
      clampHp(target.stats);
    }
    verb = "used";
  }

  // Apply status effect (simple: add to array if not present)
  if (ability.statusEffect) {
    if (!Array.isArray(target.statusEffects)) target.statusEffects = [];
    if (!target.statusEffects.includes(ability.statusEffect)) {
      target.statusEffects.push(ability.statusEffect);
    }
  }

  const sourceName = getUnitName(source);
  const targetName = getUnitName(target);
  const delta = amount > 0 ? (isHealingTarget ? `+${amount} HP` : `-${amount} HP`) : "";
  const statusPart = ability.statusEffect ? ` (${ability.statusEffect})` : "";
  battle.log.push(`${sourceName} ${verb} ${ability.name} on ${targetName}${delta ? ` ${delta}` : ""}${statusPart}.`);

  // Cleanup and win/loss checks
  pruneDeadFromTurnOrder(battle);
  const nextState = recomputeState(battle);
  if (nextState !== battle.state) {
    battle.state = nextState;
    if (nextState === "victory") battle.log.push("Victory!");
    if (nextState === "defeat") battle.log.push("Defeat.");
  }

  return battle;
}

/**
 * Advances the battle to the next living unit.
 * Also updates battle.state to victory/defeat when appropriate.
 * @param {Battle} battle
 * @returns {Battle}
 */
function advanceTurn(battle) {
  if (!battle) throw new TypeError("advanceTurn: battle is required");
  if (battle.state !== "in_progress") return battle;

  // Remove any dead units first.
  pruneDeadFromTurnOrder(battle);

  const nextState = recomputeState(battle);
  if (nextState !== "in_progress") {
    battle.state = nextState;
    battle.log.push(nextState === "victory" ? "Victory!" : "Defeat.");
    return battle;
  }

  if (battle.turnOrder.length === 0) {
    battle.state = "defeat";
    battle.log.push("Defeat.");
    return battle;
  }

  // Move to next turn.
  battle.activeTurnIndex = (battle.activeTurnIndex + 1) % battle.turnOrder.length;

  // Safety: ensure we land on an alive unit (in case of stale refs).
  for (let i = 0; i < battle.turnOrder.length; i++) {
    const unit = getActiveUnit(battle);
    if (unit && isAlive(unit)) break;
    battle.activeTurnIndex = (battle.activeTurnIndex + 1) % battle.turnOrder.length;
  }

  return battle;
}

module.exports = {
  battlesById,
  createBattle,
  calculateInitialTurnOrder,
  getActiveUnit,
  advanceTurn,
  executeCommand,
  getBattleById,
  updateBattleById,
  getPartyForBattle,
  deleteBattleById
};
