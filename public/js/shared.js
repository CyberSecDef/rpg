(function (root, factory) {
	if (typeof module === "object" && typeof module.exports === "object") {
		module.exports = factory();
	} else {
		root.RPG_SHARED = factory();
	}
})(typeof self !== "undefined" ? self : this, function () {
	"use strict";

	const PROTOCOL = {
		PLAYER_CONNECT: "player:connect",
		INIT: "init",
		JOIN: "join",
		LEAVE: "leave",
		INPUT: "input",
		STATE: "state",
		WORLD: "world",
		ACTION: "action",
		SAVE_PUSH: "save_push",
		BATTLE_ENGAGE: "battle:engage",
		BATTLE_START: "battle:start",
		BATTLE_COMMAND: "battle:command",
		BATTLE_UPDATE: "battle:update",
		QUEST_UPDATE: "quest:update"
	};

	// 16-bit-ish scale
	const TILE_SIZE = 16;
	const PLAYER_RADIUS = 5;
	const TICK_HZ = 60;
	const SNAPSHOT_HZ = 20;

	// Tile IDs
	const TILE = {
		GRASS: 0,
		WATER: 1,
		WALL: 2,
		FOREST: 3,
		DUNGEON: 4,
		BRIDGE: 5,
		CRACKED_WALL: 6
	};

	function clamp(v, min, max) {
		return Math.max(min, Math.min(max, v));
	}

	function nowMs() {
		return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
	}

	function safeJsonParse(s) {
		try {
			return JSON.parse(s);
		} catch {
			return null;
		}
	}

	function makeId() {
		// Not crypto-grade; fine for sessions.
		return Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
	}

	function isSolidTile(tileId) {
		return tileId === TILE.WATER || tileId === TILE.WALL || tileId === TILE.CRACKED_WALL;
	}

	function getTileAt(world, tx, ty) {
		if (!world || tx < 0 || ty < 0 || tx >= world.width || ty >= world.height) return TILE.WALL;
		return world.tiles?.[ty]?.[tx] ?? TILE.GRASS;
	}

	function getTileAtWorld(world, x, y) {
		const tx = Math.floor(x / TILE_SIZE);
		const ty = Math.floor(y / TILE_SIZE);
		return getTileAt(world, tx, ty);
	}

	function buildDefaultSave(pos) {
		return {
			version: 1,
			createdAt: new Date().toISOString(),
			x: pos?.x ?? TILE_SIZE * 2,
			y: pos?.y ?? TILE_SIZE * 2,
			hp: 20,
			maxHp: 20,
			gold: 10,
			quests: {
				activeQuestIds: ["act1_investigate_dawnrise"],
				completedQuestIds: [],
				progressByQuestId: {}
			},
			inventory: {
				potion: 1
			}
		};
	}

	return {
		PROTOCOL,
		TILE_SIZE,
		PLAYER_RADIUS,
		TICK_HZ,
		SNAPSHOT_HZ,
		TILE,
		clamp,
		nowMs,
		safeJsonParse,
		makeId,
		buildDefaultSave,
		isSolidTile,
		getTileAt,
		getTileAtWorld
	};
});
