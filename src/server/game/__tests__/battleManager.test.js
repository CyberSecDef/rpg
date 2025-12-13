"use strict";

/**
 * Assumptions:
 * - `executeCommand` mutates the provided battle + referenced party members/enemies.
 * - `executeCommand` does NOT advance turn order; advancing is tested elsewhere.
 * - Damage/healing values are expected to be deterministic given current formulas in
 *   `src/server/game/battleManager.js`.
 */

const { Stats, Character, Party } = require("../models");
const { ELEMENTS, STATUS_EFFECTS } = require("../constants");
const {
	calculateInitialTurnOrder,
	createBattle,
	executeCommand,
	deleteBattleById
} = require("../battleManager");

function makeStats(overrides = {}) {
	return new Stats({
		hp: 10,
		maxHp: 10,
		mp: 10,
		maxMp: 10,
		strength: 10,
		defense: 0,
		magic: 10,
		speed: 10,
		spirit: 0,
		luck: 0,
		...overrides
	});
}

function makeCharacter({ id, name, className = "Wanderer", stats, statusEffects = [] }) {
	return new Character({
		id,
		name,
		className,
		level: 1,
		experience: 0,
		stats,
		statusEffects,
		equippedItems: {},
		crystalResonance: {}
	});
}

function makeEnemy({ id, name, stats, element = null, statusEffects = [] }) {
	const enemy = { id, name, stats, statusEffects: statusEffects.slice() };
	if (element) enemy.element = element;
	return enemy;
}

describe("battleManager", () => {
	test("calculateInitialTurnOrder: higher speed acts first", () => {
		const party = {
			id: "party1",
			members: [
				{ id: "p_slow", stats: { hp: 10, speed: 1 } },
				{ id: "p_fast", stats: { hp: 10, speed: 9 } }
			]
		};
		const enemies = [
			{ id: "e_mid", stats: { hp: 10, speed: 5 } },
			{ id: "e_fast", stats: { hp: 10, speed: 8 } }
		];

		const order = calculateInitialTurnOrder(party, enemies);
		expect(order.map((r) => `${r.kind}:${r.id}`)).toEqual([
			"party:p_fast",
			"enemy:e_fast",
			"enemy:e_mid",
			"party:p_slow"
		]);
	});

	test("executeCommand: physical attack damage (basic_attack)", () => {
		const attacker = makeCharacter({
			id: "c1",
			name: "Hero",
			stats: makeStats({ strength: 10, magic: 1, speed: 10, mp: 0, maxMp: 0 })
		});
		const party = new Party({ id: "party1", playerId: "player1", members: [attacker], activeMemberIndex: 0, currentState: "battle" });

		const enemy = makeEnemy({
			id: "e1",
			name: "Goblin",
			stats: makeStats({ hp: 20, maxHp: 20, defense: 0, spirit: 0, speed: 1 })
		});

		const battle = createBattle(party, [enemy]);
		try {
			// Ensure it's the attacker turn (attacker has higher speed than enemy).
			expect(battle.turnOrder[0]).toEqual({ kind: "party", id: "c1" });

			executeCommand(battle, { type: "ability", sourceId: "c1", targetId: "e1", abilityId: "basic_attack" });

			// Formula: offense=(STR+power)=(10+4)=14, mitigation=DEF*0.6=0 => 14 damage.
			expect(battle.enemies[0].stats.hp).toBe(6);
		} finally {
			deleteBattleById(battle.id);
		}
	});

	test("executeCommand: magic damage with elemental weakness", () => {
		const caster = makeCharacter({
			id: "c1",
			name: "Mira",
			className: "AEROMANCER",
			stats: makeStats({ magic: 10, strength: 1, speed: 10, mp: 50, maxMp: 50 })
		});
		const party = new Party({ id: "party1", playerId: "player1", members: [caster], activeMemberIndex: 0, currentState: "battle" });

		// EARTH is weak to WIND (see ELEMENTAL_WEAKNESS mapping + multiplier logic).
		const enemy = makeEnemy({
			id: "e1",
			name: "Stone Wisp",
			stats: makeStats({ hp: 40, maxHp: 40, spirit: 0, defense: 0, speed: 1 }),
			element: ELEMENTS.EARTH
		});

		const battle = createBattle(party, [enemy]);
		try {
			executeCommand(battle, { type: "ability", sourceId: "c1", targetId: "e1", abilityId: "aeromancer_chain_spark" });

			// For WIND vs EARTH we expect a 1.25 weakness multiplier.
			// offense=(MAG+power)=(10+13)=23, mitigation=SPIRIT*0.6=0 => base 23
			// amount=floor(23*1.25)=28
			expect(battle.enemies[0].stats.hp).toBe(12);
		} finally {
			deleteBattleById(battle.id);
		}
	});

	test("executeCommand: healing spell (sage_mend)", () => {
		const healer = makeCharacter({
			id: "c1",
			name: "Lysa",
			className: "SAGE",
			stats: makeStats({ magic: 10, speed: 10, mp: 10, maxMp: 10 })
		});
		const ally = makeCharacter({
			id: "c2",
			name: "Ally",
			stats: makeStats({ hp: 5, maxHp: 30, speed: 1, mp: 0, maxMp: 0 })
		});

		const party = new Party({ id: "party1", playerId: "player1", members: [healer, ally], activeMemberIndex: 0, currentState: "battle" });
		const enemy = makeEnemy({ id: "e1", name: "Dummy", stats: makeStats({ hp: 1, maxHp: 1, speed: 0 }) });

		const battle = createBattle(party, [enemy]);
		try {
			// Healer should act first due to speed.
			expect(battle.turnOrder[0]).toEqual({ kind: "party", id: "c1" });

			executeCommand(battle, { type: "ability", sourceId: "c1", targetId: "c2", abilityId: "sage_mend" });

			// Heal formula: floor((power + magic*1.1) * mult)
			// floor((12 + 10*1.1) * 1) = floor(23) = 23
			expect(party.members[1].stats.hp).toBe(28);
			// MP cost for Mend is 5.
			expect(party.members[0].stats.mp).toBe(5);
		} finally {
			deleteBattleById(battle.id);
		}
	});

	test("executeCommand: status effect application (poison)", () => {
		const caster = makeCharacter({
			id: "c1",
			name: "Thalen",
			className: "UMBRAMANCER",
			stats: makeStats({ magic: 10, speed: 10, mp: 10, maxMp: 10 })
		});
		const party = new Party({ id: "party1", playerId: "player1", members: [caster], activeMemberIndex: 0, currentState: "battle" });

		const enemy = makeEnemy({
			id: "e1",
			name: "Bandit",
			stats: makeStats({ hp: 30, maxHp: 30, spirit: 0, speed: 1 }),
			statusEffects: []
		});

		const battle = createBattle(party, [enemy]);
		try {
			executeCommand(battle, { type: "ability", sourceId: "c1", targetId: "e1", abilityId: "umbramancer_venom_hex" });

			expect(battle.enemies[0].statusEffects).toContain(STATUS_EFFECTS.POISON);
		} finally {
			deleteBattleById(battle.id);
		}
	});
});
