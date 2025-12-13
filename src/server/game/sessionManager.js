"use strict";

const path = require("path");

const { Party, createDefaultProtagonist } = require("./models");

// Shared buildDefaultSave is already used server-side for session saves.
const { buildDefaultSave } = require(path.join(__dirname, "..", "..", "..", "public", "js", "shared.js"));

/**
 * Core session maps
 */
const playersById = new Map();
const playersByConnectionId = new Map();
const partiesById = new Map();

function makePlayerId() {
	return `player_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function makePartyId(playerId) {
	return `party_${playerId}`;
}

function normalizeDisplayName(displayName) {
	if (typeof displayName !== "string") return "Hero";
	const s = displayName.trim();
	if (!s) return "Hero";
	return s.slice(0, 24);
}

function createPlayerForConnection({ connectionId, ws, displayName, spawn }) {
	if (typeof connectionId !== "string" || !connectionId.trim()) {
		throw new TypeError("createPlayerForConnection: connectionId must be a non-empty string");
	}
	if (!ws) throw new TypeError("createPlayerForConnection: ws is required");

	if (playersByConnectionId.has(connectionId)) {
		return playersByConnectionId.get(connectionId);
	}

	const sp = spawn || { x: 32, y: 32 };
	const playerId = makePlayerId();
	const partyId = makePartyId(playerId);

	const save = buildDefaultSave({ x: sp.x, y: sp.y });

	const protagonist = createDefaultProtagonist();
	// Keep party member HP aligned with overworld save, since HUD is save-driven.
	protagonist.stats.hp = save.hp;
	protagonist.stats.maxHp = save.maxHp;

	const party = new Party({
		id: partyId,
		playerId: playerId,
		members: [protagonist],
		activeMemberIndex: 0,
		currentState: "overworld"
	});

	const player = {
		id: playerId,
		displayName: normalizeDisplayName(displayName),
		connectionId,
		ws,
		x: sp.x,
		y: sp.y,
		dir: "down",
		input: { up: false, down: false, left: false, right: false },
		save,
		partyId,
		party,
		activeBattleId: null,
		activeBattleEnemyId: null,
		activeBattleStoryTargetId: null,
		story: { currentRegionId: null }
	};

	playersById.set(playerId, player);
	playersByConnectionId.set(connectionId, player);
	partiesById.set(partyId, party);

	return player;
}

function cleanupConnection(connectionId) {
	const player = playersByConnectionId.get(connectionId) || null;
	if (!player) return { player: null, party: null };

	playersByConnectionId.delete(connectionId);
	playersById.delete(player.id);

	const partyId = player.partyId;
	const party = partiesById.get(partyId) || null;
	if (partyId) partiesById.delete(partyId);

	return { player, party };
}

function getPlayerByConnectionId(connectionId) {
	return playersByConnectionId.get(connectionId) || null;
}

function getPartyByConnectionId(connectionId) {
	const p = getPlayerByConnectionId(connectionId);
	if (!p) return null;
	return partiesById.get(p.partyId) || p.party || null;
}

module.exports = {
	playersById,
	playersByConnectionId,
	partiesById,
	createPlayerForConnection,
	cleanupConnection,
	getPlayerByConnectionId,
	getPartyByConnectionId
};
