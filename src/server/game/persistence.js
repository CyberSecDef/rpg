"use strict";

const path = require("path");
const fs = require("fs/promises");

const { Stats, Character, Party } = require("./models");

const DATA_DIR = path.join(__dirname, "..", "..", "..", "data");
const PLAYERS_DIR = path.join(DATA_DIR, "players");
const PARTIES_DIR = path.join(DATA_DIR, "parties");

async function ensureDirs() {
	await fs.mkdir(PLAYERS_DIR, { recursive: true });
	await fs.mkdir(PARTIES_DIR, { recursive: true });
}

function safePlayerForSave(player) {
	if (!player || typeof player !== "object") return null;
	if (typeof player.id !== "string" || !player.id.trim()) return null;

	return {
		id: player.id,
		displayName: player.displayName ?? player.name ?? "Hero",
		x: typeof player.x === "number" ? player.x : undefined,
		y: typeof player.y === "number" ? player.y : undefined,
		dir: typeof player.dir === "string" ? player.dir : undefined,
		save: player.save && typeof player.save === "object" ? player.save : undefined,
		partyId: typeof player.partyId === "string" ? player.partyId : undefined,
		story: player.story && typeof player.story === "object" ? player.story : undefined
	};
}

function safePartyForSave(party) {
	if (!party || typeof party !== "object") return null;
	if (typeof party.id !== "string" || !party.id.trim()) return null;

	// Party in memory is expected to be a Party instance, but we accept plain objects.
	const members = Array.isArray(party.members) ? party.members : [];
	return {
		id: party.id,
		playerId: party.playerId,
		activeMemberIndex: party.activeMemberIndex,
		currentState: party.currentState,
		members: members.map((m) => ({
			id: m.id,
			name: m.name,
			className: m.className,
			level: m.level,
			experience: m.experience,
			stats: m.stats ? { ...m.stats } : null,
			statusEffects: Array.isArray(m.statusEffects) ? m.statusEffects.slice() : [],
			equippedItems: m.equippedItems && typeof m.equippedItems === "object" ? { ...m.equippedItems } : {},
			crystalResonance: m.crystalResonance && typeof m.crystalResonance === "object" ? { ...m.crystalResonance } : {}
		}))
	};
}

function reviveParty(partyData) {
	if (!partyData || typeof partyData !== "object") return null;
	if (typeof partyData.id !== "string" || !partyData.id.trim()) return null;
	if (typeof partyData.playerId !== "string" || !partyData.playerId.trim()) return null;

	const members = Array.isArray(partyData.members) ? partyData.members : [];
	const revivedMembers = [];
	for (const m of members) {
		if (!m || typeof m !== "object") continue;
		if (!m.stats || typeof m.stats !== "object") continue;
		try {
			revivedMembers.push(
				new Character({
					id: m.id,
					name: m.name,
					className: m.className,
					level: m.level,
					experience: m.experience,
					stats: new Stats({
						hp: m.stats.hp,
						maxHp: m.stats.maxHp,
						mp: m.stats.mp,
						maxMp: m.stats.maxMp,
						strength: m.stats.strength,
						defense: m.stats.defense,
						magic: m.stats.magic,
						speed: m.stats.speed,
						spirit: m.stats.spirit,
						luck: m.stats.luck
					}),
					statusEffects: Array.isArray(m.statusEffects) ? m.statusEffects : [],
					equippedItems: m.equippedItems && typeof m.equippedItems === "object" ? m.equippedItems : {},
					crystalResonance: m.crystalResonance && typeof m.crystalResonance === "object" ? m.crystalResonance : {}
				})
			);
		} catch {
			// Ignore invalid member entries.
		}
	}

	try {
		return new Party({
			id: partyData.id,
			playerId: partyData.playerId,
			members: revivedMembers,
			activeMemberIndex: typeof partyData.activeMemberIndex === "number" ? partyData.activeMemberIndex : 0,
			currentState: partyData.currentState === "battle" ? "battle" : "overworld"
		});
	} catch {
		return null;
	}
}

async function writeJsonAtomic(filePath, data) {
	await ensureDirs();
	const tmpPath = `${filePath}.tmp`;
	const json = JSON.stringify(data, null, 2);
	await fs.writeFile(tmpPath, json, "utf8");
	await fs.rename(tmpPath, filePath);
}

async function readJsonIfExists(filePath) {
	try {
		const raw = await fs.readFile(filePath, "utf8");
		try {
			return JSON.parse(raw);
		} catch {
			return null;
		}
	} catch (err) {
		if (err && typeof err === "object" && err.code === "ENOENT") return null;
		return null;
	}
}

async function savePlayer(player) {
	const safe = safePlayerForSave(player);
	if (!safe) throw new TypeError("savePlayer: invalid player");
	const filePath = path.join(PLAYERS_DIR, `${safe.id}.json`);
	await writeJsonAtomic(filePath, safe);
	return safe;
}

async function loadPlayer(playerId) {
	if (typeof playerId !== "string" || !playerId.trim()) return null;
	const filePath = path.join(PLAYERS_DIR, `${playerId}.json`);
	return await readJsonIfExists(filePath);
}

async function saveParty(party) {
	const safe = safePartyForSave(party);
	if (!safe) throw new TypeError("saveParty: invalid party");
	const filePath = path.join(PARTIES_DIR, `${safe.id}.json`);
	await writeJsonAtomic(filePath, safe);
	return safe;
}

async function loadParty(partyId, { revive = true } = {}) {
	if (typeof partyId !== "string" || !partyId.trim()) return null;
	const filePath = path.join(PARTIES_DIR, `${partyId}.json`);
	const data = await readJsonIfExists(filePath);
	if (!data) return null;
	return revive ? reviveParty(data) : data;
}

module.exports = {
	savePlayer,
	loadPlayer,
	saveParty,
	loadParty,
	// exposed for future refactors/tests
	_safePlayerForSave: safePlayerForSave,
	_safePartyForSave: safePartyForSave
};
