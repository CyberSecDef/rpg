const path = require("path");
const fs = require("fs");
const http = require("http");
const express = require("express");
const { WebSocketServer } = require("ws");

const {
	PROTOCOL,
	TILE,
	clamp,
	nowMs,
	safeJsonParse,
	makeId,
	buildDefaultSave,
	isSolidTile,
	getTileAtWorld,
	TILE_SIZE,
	PLAYER_RADIUS,
	TICK_HZ,
	SNAPSHOT_HZ
} = require(path.join(__dirname, "..", "public", "js", "shared.js"));

const { ABILITIES_BY_ID } = require("./server/game/abilities");
const { ELEMENTS } = require("./server/game/constants");
// Player/party creation is handled by sessionManager.
const {
	createBattle,
	getBattleById,
	getPartyForBattle,
	getActiveUnit,
	executeCommand,
	advanceTurn,
	deleteBattleById
} = require("./server/game/battleManager");

const {
	getAvailableQuestsForPlayer,
	updateQuestProgress
} = require("./server/game/story");

const {
	playersById,
	createPlayerForConnection,
	cleanupConnection,
	getPlayerByConnectionId
} = require("./server/game/sessionManager");

const app = express();
app.use(express.static(path.join(__dirname, "..", "public")));

function loadWorld() {
	const worldPath = path.join(__dirname, "..", "data", "data.json");
	try {
		const raw = fs.readFileSync(worldPath, "utf8");
		const parsed = safeJsonParse(raw);
		if (parsed && parsed.world && parsed.world.tiles && parsed.world.width && parsed.world.height) {
			return parsed.world;
		}
	} catch {
		// fall through
	}
	throw new Error("World data missing or invalid: data/data.json");
}

const world = loadWorld();

function cloneWorldState(w) {
	return {
		name: w.name,
		width: w.width,
		height: w.height,
		tiles: w.tiles.map((row) => row.slice()),
		objects: Array.isArray(w.objects) ? w.objects.map((o) => ({ ...o })) : [],
		shrines: Array.isArray(w.shrines) ? w.shrines.map((s) => ({ ...s })) : []
	};
}

const worldState = cloneWorldState(world);

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function objAt(tx, ty) {
	return worldState.objects.find((o) => o.x === tx && o.y === ty);
}

function isSolidObject(o) {
	if (!o) return false;
	return o.type === "block";
}

function isSolidAtTile(tx, ty) {
	const tileId = worldState.tiles?.[ty]?.[tx] ?? TILE.WALL;
	if (isSolidTile(tileId)) return true;
	const o = objAt(tx, ty);
	return isSolidObject(o);
}

function isSolidAtWorldXY(x, y) {
	const tx = Math.floor(x / TILE_SIZE);
	const ty = Math.floor(y / TILE_SIZE);
	return isSolidAtTile(tx, ty);
}

function broadcast(msg) {
	const payload = JSON.stringify(msg);
	for (const client of wss.clients) {
		if (client.readyState === 1) client.send(payload);
	}
}

function send(ws, msg) {
	ws.send(JSON.stringify(msg));
}

function ensureQuestStateOnSave(save) {
	if (!save || typeof save !== "object") return;
	if (!save.quests || typeof save.quests !== "object") {
		save.quests = { activeQuestIds: ["act1_investigate_dawnrise"], completedQuestIds: [], progressByQuestId: {} };
		return;
	}
	if (!Array.isArray(save.quests.activeQuestIds)) save.quests.activeQuestIds = ["act1_investigate_dawnrise"];
	if (!Array.isArray(save.quests.completedQuestIds)) save.quests.completedQuestIds = [];
	if (!save.quests.progressByQuestId || typeof save.quests.progressByQuestId !== "object") {
		save.quests.progressByQuestId = {};
	}
	// Ensure at least the first quest is active when starting fresh.
	if (save.quests.activeQuestIds.length === 0 && save.quests.completedQuestIds.length === 0) {
		save.quests.activeQuestIds.push("act1_investigate_dawnrise");
	}
}

function sendQuestUpdate(ws, playerSave, delta) {
	ensureQuestStateOnSave(playerSave);
	const availableQuests = getAvailableQuestsForPlayer(playerSave);
	send(ws, {
		t: PROTOCOL.QUEST_UPDATE,
		questState: playerSave.quests,
		completedQuestIds: delta?.completedQuestIds ?? [],
		newlyActivatedQuestIds: delta?.newlyActivatedQuestIds ?? [],
		availableQuestIds: (delta?.availableQuests ?? availableQuests.map((q) => q.id)),
		availableQuests
	});
}

function emitStoryEvent(ws, player, storyEvent) {
	if (!player || !player.save) return;
	ensureQuestStateOnSave(player.save);
	const delta = updateQuestProgress(player.save, storyEvent);
	if (delta && (delta.changed || (delta.completedQuestIds && delta.completedQuestIds.length))) {
		sendQuestUpdate(ws, player.save, delta);
	}
}

function currentRegionForPlayer(p) {
	// Lightweight region detection for the current single-map overworld.
	// (These are gameplay labels, not the server/game/world.js region stubs.)
	const tx = Math.floor(p.x / TILE_SIZE);
	const ty = Math.floor(p.y / TILE_SIZE);

	// Dawnrise (town area near initial objects)
	if (tx >= 3 && tx <= 16 && ty >= 4 && ty <= 9) return "dawnrise";
	// Light Shrine (near the dungeon tile marker)
	if (tx >= 30 && tx <= 35 && ty >= 13 && ty <= 16) return "light_shrine";
	// Default overworld
	return "stormfell";
}

function maybeEmitRegionEnter(ws, p) {
	const regionId = currentRegionForPlayer(p);
	if (!p.story) p.story = {};
	if (p.story.currentRegionId !== regionId) {
		p.story.currentRegionId = regionId;
		emitStoryEvent(ws, p, { type: "visit", targetId: `region:${regionId}` });
	}
}

function interactTargetTile(p) {
	const tx = Math.floor(p.x / TILE_SIZE);
	const ty = Math.floor(p.y / TILE_SIZE);
	const { dx, dy } = dirToDelta(p.dir);
	return { fx: tx + dx, fy: ty + dy };
}

function serializeStats(stats) {
	if (!stats || typeof stats !== "object") return null;
	return {
		hp: stats.hp,
		maxHp: stats.maxHp,
		mp: stats.mp,
		maxMp: stats.maxMp,
		strength: stats.strength,
		defense: stats.defense,
		magic: stats.magic,
		speed: stats.speed,
		spirit: stats.spirit,
		luck: stats.luck
	};
}

function serializeCharacter(c) {
	return {
		id: c.id,
		name: c.name,
		className: c.className,
		level: c.level,
		experience: c.experience,
		stats: serializeStats(c.stats),
		statusEffects: Array.isArray(c.statusEffects) ? c.statusEffects.slice() : []
	};
}

function serializeEnemy(e) {
	return {
		id: e.id,
		name: e.name,
		element: e.element ?? null,
		stats: serializeStats(e.stats),
		statusEffects: Array.isArray(e.statusEffects) ? e.statusEffects.slice() : []
	};
}

function battleSnapshot(battle) {
	const party = getPartyForBattle(battle.id);
	const members = Array.isArray(party?.members) ? party.members : [];
	const turnOrder = Array.isArray(battle.turnOrder) ? battle.turnOrder : [];
	const activeRef = turnOrder.length ? turnOrder[battle.activeTurnIndex % turnOrder.length] : null;

	return {
		id: battle.id,
		state: battle.state,
		party: {
			id: party?.id ?? battle.partyId,
			playerId: party?.playerId ?? null,
			activeMemberIndex: party?.activeMemberIndex ?? 0,
			members: members.map(serializeCharacter)
		},
		enemies: (battle.enemies || []).map(serializeEnemy),
		turnOrder: turnOrder.map((r) => ({ kind: r.kind, id: r.id })),
		active: activeRef ? { kind: activeRef.kind, id: activeRef.id } : null,
		activeTurnIndex: battle.activeTurnIndex,
		log: Array.isArray(battle.log) ? battle.log.slice(-50) : []
	};
}

function unitById(battle, unitId) {
	const party = getPartyForBattle(battle.id);
	const members = Array.isArray(party?.members) ? party.members : [];
	for (const m of members) if (m && m.id === unitId) return { kind: "party", unit: m };
	for (const e of battle.enemies || []) if (e && e.id === unitId) return { kind: "enemy", unit: e };
	return null;
}

function findFirstAlivePartyMemberId(battle) {
	const party = getPartyForBattle(battle.id);
	const members = Array.isArray(party?.members) ? party.members : [];
	const alive = members.find((m) => (m?.stats?.hp ?? 0) > 0);
	return alive ? alive.id : null;
}

function validateBattleCommand(battle, playerId, command) {
	if (!battle || battle.state !== "in_progress") return { ok: false, reason: "battle not in progress" };

	const turnOrder = Array.isArray(battle.turnOrder) ? battle.turnOrder : [];
	if (!turnOrder.length) return { ok: false, reason: "no turn order" };
	const activeRef = turnOrder[battle.activeTurnIndex % turnOrder.length];
	if (!activeRef || activeRef.kind !== "party") return { ok: false, reason: "not player turn" };

	const party = getPartyForBattle(battle.id);
	if (!party || party.playerId !== playerId) return { ok: false, reason: "battle not owned by player" };

	const sourceId = command.sourceId;
	if (typeof sourceId !== "string" || sourceId !== activeRef.id) {
		return { ok: false, reason: "invalid source for active turn" };
	}

	const abilityId = command.abilityId;
	const ability = typeof abilityId === "string" ? ABILITIES_BY_ID[abilityId] : null;
	if (!ability) return { ok: false, reason: "unknown ability" };

	const sourceFound = unitById(battle, sourceId);
	if (!sourceFound) return { ok: false, reason: "missing source" };
	const source = sourceFound.unit;

	if (ability.mpCost > 0) {
		const mp = source?.stats?.mp;
		if (typeof mp !== "number" || mp < ability.mpCost) return { ok: false, reason: "not enough MP" };
	}

	let targetId = command.targetId;
	if (ability.targetType === "self") {
		targetId = sourceId;
	}
	if (typeof targetId !== "string") return { ok: false, reason: "missing target" };
	const targetFound = unitById(battle, targetId);
	if (!targetFound) return { ok: false, reason: "target not found" };

	// Minimal target validation.
	if (ability.targetType === "enemy_single" && targetFound.kind !== "enemy") {
		return { ok: false, reason: "target must be enemy" };
	}
	if (ability.targetType === "ally_single" && targetFound.kind !== "party") {
		return { ok: false, reason: "target must be ally" };
	}
	if (ability.targetType === "party" || ability.targetType === "enemy_all") {
		return { ok: false, reason: "unsupported target type" };
	}

	return { ok: true, reason: null };
}

function makeEnemyFromWorldObject(o) {
	const hp = typeof o.hp === "number" ? o.hp : 14;
	const maxHp = typeof o.maxHp === "number" ? o.maxHp : hp;
	return {
		id: o.id,
		name: "Enemy",
		element: ELEMENTS.NULL,
		stats: {
			hp,
			maxHp,
			mp: 0,
			maxMp: 0,
			strength: 4,
			defense: 3,
			magic: 2,
			speed: 3,
			spirit: 3,
			luck: 1
		},
		statusEffects: []
	};
}

function syncPartyToPlayerSave(p) {
	const member = p.party?.activeMember;
	if (!member || !member.stats) return;
	if (typeof member.stats.hp === "number") p.save.hp = member.stats.hp;
	if (typeof member.stats.maxHp === "number") p.save.maxHp = member.stats.maxHp;
}

function runEnemyTurns(battle) {
	// Auto-resolve enemy turns so clients only act on their own turns.
	while (battle.state === "in_progress") {
		const activeRef = battle.turnOrder[battle.activeTurnIndex % battle.turnOrder.length];
		if (!activeRef || activeRef.kind !== "enemy") break;
		const enemy = battle.enemies.find((e) => e.id === activeRef.id);
		if (!enemy) {
			advanceTurn(battle);
			continue;
		}
		const targetId = findFirstAlivePartyMemberId(battle);
		if (!targetId) break;
		executeCommand(battle, {
			type: "ability",
			sourceId: enemy.id,
			targetId,
			abilityId: "basic_attack"
		});
		advanceTurn(battle);
	}
}

function spawnPoint() {
	// Find first non-solid tile near top-left
	for (let y = 0; y < worldState.height; y++) {
		for (let x = 0; x < worldState.width; x++) {
			const tile = worldState.tiles[y]?.[x] ?? 0;
			if (!isSolidTile(tile) && !objAt(x, y)) {
				return { x: x * TILE_SIZE + TILE_SIZE / 2, y: y * TILE_SIZE + TILE_SIZE / 2 };
			}
		}
	}
	return { x: TILE_SIZE * 2, y: TILE_SIZE * 2 };
}

function snapshot() {
	const out = {};
	for (const [id, p] of playersById.entries()) {
		out[id] = {
			id,
			name: p.displayName ?? p.name,
			x: p.x,
			y: p.y,
			dir: p.dir,
			gold: p.save.gold,
			hp: p.save.hp,
			maxHp: p.save.maxHp
		};
	}
	return out;
}

function objectsSnapshot() {
	return worldState.objects.map((o) => {
		const base = { id: o.id, type: o.type, x: o.x, y: o.y };
		if (o.type === "torch") base.lit = !!o.lit;
		if (o.type === "switch") base.state = !!o.state;
		if (o.type === "enemy") {
			base.hp = typeof o.hp === "number" ? o.hp : 14;
			base.maxHp = typeof o.maxHp === "number" ? o.maxHp : base.hp;
			base.roam = !!o.roam;
		}
		return base;
	});
}

function tryMoveWithCollision(px, py, nx, ny) {
	// Circle-vs-tile collision by testing the four cardinal offsets.
	const tryAxis = (ax, ay) => {
		if (isSolidAtWorldXY(ax, ay)) return false;
		const tile = getTileAtWorld(worldState, ax, ay);
		return !isSolidTile(tile);
	};

	let x = nx;
	let y = ny;

	// X axis
	if (
		!(
			tryAxis(x + PLAYER_RADIUS, py) &&
			tryAxis(x - PLAYER_RADIUS, py) &&
			tryAxis(x, py + PLAYER_RADIUS) &&
			tryAxis(x, py - PLAYER_RADIUS)
		)
	) {
		x = px;
	}

	// Y axis
	if (
		!(
			tryAxis(x + PLAYER_RADIUS, y) &&
			tryAxis(x - PLAYER_RADIUS, y) &&
			tryAxis(x, y + PLAYER_RADIUS) &&
			tryAxis(x, y - PLAYER_RADIUS)
		)
	) {
		y = py;
	}

	// Clamp to world bounds
	x = clamp(x, PLAYER_RADIUS, worldState.width * TILE_SIZE - PLAYER_RADIUS);
	y = clamp(y, PLAYER_RADIUS, worldState.height * TILE_SIZE - PLAYER_RADIUS);
	return { x, y };
}

function dirToDelta(dir) {
	if (dir === "up") return { dx: 0, dy: -1 };
	if (dir === "down") return { dx: 0, dy: 1 };
	if (dir === "left") return { dx: -1, dy: 0 };
	if (dir === "right") return { dx: 1, dy: 0 };
	return { dx: 0, dy: 0 };
}

function playerTile(p) {
	return {
		tx: Math.floor(p.x / TILE_SIZE),
		ty: Math.floor(p.y / TILE_SIZE)
	};
}

function broadcastWorld() {
	broadcast({
		t: PROTOCOL.WORLD,
		world: {
			name: worldState.name,
			width: worldState.width,
			height: worldState.height,
			tiles: worldState.tiles,
			shrines: worldState.shrines
		}
	});
}

function applyEffect(effect, on) {
	if (!effect || typeof effect !== "object") return;
	const x1 = clamp(effect.x1 ?? 0, 0, worldState.width - 1);
	const y1 = clamp(effect.y1 ?? 0, 0, worldState.height - 1);
	const x2 = clamp(effect.x2 ?? x1, 0, worldState.width - 1);
	const y2 = clamp(effect.y2 ?? y1, 0, worldState.height - 1);
	const minX = Math.min(x1, x2);
	const maxX = Math.max(x1, x2);
	const minY = Math.min(y1, y2);
	const maxY = Math.max(y1, y2);

	if (effect.type === "drain") {
		for (let y = minY; y <= maxY; y++) {
			for (let x = minX; x <= maxX; x++) {
				if (worldState.tiles[y][x] === TILE.WATER) worldState.tiles[y][x] = TILE.GRASS;
			}
		}
	}

	if (effect.type === "bridge") {
		for (let y = minY; y <= maxY; y++) {
			for (let x = minX; x <= maxX; x++) {
				worldState.tiles[y][x] = on ? TILE.BRIDGE : TILE.WATER;
			}
		}
	}
}

function handleInteract(p) {
	const { tx, ty } = playerTile(p);
	const { dx, dy } = dirToDelta(p.dir);
	const fx = tx + dx;
	const fy = ty + dy;
	if (fx < 0 || fy < 0 || fx >= worldState.width || fy >= worldState.height) return false;

	const o = objAt(fx, fy);
	if (o) {
		if (o.type === "torch") {
			o.lit = !o.lit;
			return true;
		}
		if (o.type === "switch") {
			o.state = !o.state;
			applyEffect(o.effect, o.state);
			return true;
		}
		if (o.type === "block") {
			const nx = fx + dx;
			const ny = fy + dy;
			if (nx < 0 || ny < 0 || nx >= worldState.width || ny >= worldState.height) return false;
			if (isSolidAtTile(nx, ny)) return false;
			if (objAt(nx, ny)) return false;
			o.x = nx;
			o.y = ny;
			return true;
		}
		return false;
	}

	// Interact with terrain (placeholder for doors, etc.)
	return false;
}

function tryUseTool(p, tool) {
	const { tx, ty } = playerTile(p);
	const { dx, dy } = dirToDelta(p.dir);

	if (tool === "bombFlower") {
		const fx = tx + dx;
		const fy = ty + dy;
		if (fx < 0 || fy < 0 || fx >= worldState.width || fy >= worldState.height) return false;
		if (worldState.tiles[fy][fx] === TILE.CRACKED_WALL) {
			worldState.tiles[fy][fx] = TILE.GRASS;
			return true;
		}
		return false;
	}

	if (tool === "grapplingHook") {
		// Pull to the tile just before the first solid tile in-range, if crossing water.
		const range = 8;
		let sawWater = false;
		for (let i = 1; i <= range; i++) {
			const cx = tx + dx * i;
			const cy = ty + dy * i;
			if (cx < 0 || cy < 0 || cx >= worldState.width || cy >= worldState.height) break;
			const tile = worldState.tiles[cy][cx];
			if (tile === TILE.WATER) sawWater = true;
			if (isSolidAtTile(cx, cy)) {
				if (!sawWater) return false;
				const destX = cx - dx;
				const destY = cy - dy;
				if (destX === tx && destY === ty) return false;
				if (isSolidAtTile(destX, destY) || objAt(destX, destY)) return false;
				p.x = destX * TILE_SIZE + TILE_SIZE / 2;
				p.y = destY * TILE_SIZE + TILE_SIZE / 2;
				p.save.x = p.x;
				p.save.y = p.y;
				return true;
			}
		}
		return false;
	}

	if (tool === "fireRod") {
		// Light the first torch in front within 4 tiles.
		const range = 4;
		for (let i = 1; i <= range; i++) {
			const cx = tx + dx * i;
			const cy = ty + dy * i;
			if (cx < 0 || cy < 0 || cx >= worldState.width || cy >= worldState.height) break;
			const o = objAt(cx, cy);
			if (o && o.type === "torch") {
				o.lit = true;
				return true;
			}
			if (isSolidAtTile(cx, cy)) break;
		}
		return false;
	}

	return false;
}

function damageEnemy(enemyId, amount) {
	const e = worldState.objects.find((o) => o.type === "enemy" && o.id === enemyId);
	if (!e) return false;
	const hp = typeof e.hp === "number" ? e.hp : 14;
	e.hp = Math.max(0, hp - amount);
	if (e.hp === 0) {
		worldState.objects = worldState.objects.filter((o) => o.id !== enemyId);
	}
	return true;
}

wss.on("connection", (ws) => {
	const connectionId = makeId();
	ws._connectionId = connectionId;

	ws.on("message", (buf) => {
		const msg = safeJsonParse(buf.toString("utf8"));
		if (!msg || typeof msg.t !== "string") return;

		if (msg.t === PROTOCOL.PLAYER_CONNECT) {
			const displayName = typeof msg.displayName === "string" ? msg.displayName : "Hero";
			const sp = spawnPoint();
			const p = createPlayerForConnection({ connectionId, ws, displayName, spawn: sp });
			ensureQuestStateOnSave(p.save);

			send(ws, {
				t: PROTOCOL.INIT,
				id: p.id,
				world: {
					name: worldState.name,
					width: worldState.width,
					height: worldState.height,
					tiles: worldState.tiles,
					shrines: worldState.shrines
				},
				objects: objectsSnapshot(),
				questState: p.save.quests,
				availableQuests: getAvailableQuestsForPlayer(p.save)
			});
			broadcast({ t: PROTOCOL.JOIN, id: p.id, name: p.displayName });
			return;
		}

		const p = getPlayerByConnectionId(connectionId);
		if (!p) return;

		if (msg.t === PROTOCOL.INPUT) {
			if (msg.input && typeof msg.input === "object") {
				p.input.up = !!msg.input.up;
				p.input.down = !!msg.input.down;
				p.input.left = !!msg.input.left;
				p.input.right = !!msg.input.right;
			}
			if (typeof msg.dir === "string") p.dir = msg.dir;
		}

		if (msg.t === PROTOCOL.ACTION) {
			if (msg.a === "interact") {
				const { fx, fy } = interactTargetTile(p);
				const o = objAt(fx, fy);
				if (o && o.type === "npc") {
					const npcId = typeof o.npcId === "string" ? o.npcId : (typeof o.id === "string" ? o.id : "unknown");
					emitStoryEvent(ws, p, { type: "talk", targetId: `npc:${npcId}` });
					return;
				}
				if (o && o.type === "crystal") {
					const tid = typeof o.storyTargetId === "string" ? o.storyTargetId : "object:light_crystal";
					emitStoryEvent(ws, p, { type: "visit", targetId: tid });
					return;
				}

				const changed = handleInteract(p);
				if (changed) broadcastWorld();
			}
			if (msg.a === "use_tool") {
				const tool = typeof msg.tool === "string" ? msg.tool : "";
				const changed = tryUseTool(p, tool);
				if (changed) broadcastWorld();
			}
			if (msg.a === "enemy_damage") {
				if (typeof msg.enemyId === "string" && typeof msg.amount === "number") {
					const changed = damageEnemy(msg.enemyId, msg.amount);
					if (changed) broadcastWorld();
				}
			}
		}

		if (msg.t === PROTOCOL.BATTLE_ENGAGE) {
			if (p.activeBattleId) return;
			const enemyId = typeof msg.enemyId === "string" ? msg.enemyId : "";
			const obj = worldState.objects.find((o) => o.type === "enemy" && o.id === enemyId);
			if (!obj) return;

			// Lock the enemy so it doesn't roam while engaged.
			obj.engagedBy = p.id;
			obj.roam = false;

			p.party.currentState = "battle";
			// Ensure party HP mirrors overworld save at battle start.
			const member = p.party.activeMember;
			if (member?.stats) {
				member.stats.hp = p.save.hp;
				member.stats.maxHp = p.save.maxHp;
			}

			const enemies = [makeEnemyFromWorldObject(obj)];
			const battle = createBattle(p.party, enemies);
			p.activeBattleId = battle.id;
			p.activeBattleEnemyId = enemyId;
			p.activeBattleStoryTargetId = typeof obj.storyTargetId === "string" ? obj.storyTargetId : null;
			send(ws, { t: PROTOCOL.BATTLE_START, battle: battleSnapshot(battle) });
		}

		if (msg.t === PROTOCOL.BATTLE_COMMAND) {
			const battleId = typeof msg.battleId === "string" ? msg.battleId : p.activeBattleId;
			if (!battleId || battleId !== p.activeBattleId) return;
			const battle = getBattleById(battleId);
			if (!battle) return;

			const cmd = msg.command && typeof msg.command === "object" ? msg.command : null;
			if (!cmd) return;

			// Normalize sourceId to active party unit if omitted.
			const activeRef = battle.turnOrder[battle.activeTurnIndex % battle.turnOrder.length];
			const normalized = {
				type: typeof cmd.type === "string" ? cmd.type : "ability",
				sourceId: typeof cmd.sourceId === "string" ? cmd.sourceId : activeRef?.id,
				targetId: typeof cmd.targetId === "string" ? cmd.targetId : null,
				abilityId: typeof cmd.abilityId === "string" ? cmd.abilityId : null
			};

			const verdict = validateBattleCommand(battle, p.id, normalized);
			if (!verdict.ok) {
				battle.log.push(`Invalid command: ${verdict.reason}.`);
				send(ws, { t: PROTOCOL.BATTLE_UPDATE, battle: battleSnapshot(battle) });
				return;
			}

			executeCommand(battle, normalized);
			advanceTurn(battle);
			runEnemyTurns(battle);
			syncPartyToPlayerSave(p);
			send(ws, { t: PROTOCOL.BATTLE_UPDATE, battle: battleSnapshot(battle) });

			// If battle ended, unlock/cleanup after sending final snapshot.
			if (battle.state === "victory" || battle.state === "defeat") {
				const engagedEnemyId = p.activeBattleEnemyId;
				const storyTarget = p.activeBattleStoryTargetId;
				p.party.currentState = "overworld";
				p.activeBattleId = null;
				p.activeBattleEnemyId = null;
				p.activeBattleStoryTargetId = null;

				if (battle.state === "victory" && typeof storyTarget === "string" && storyTarget.startsWith("boss:")) {
					emitStoryEvent(ws, p, { type: "defeat", targetId: storyTarget });
				}

				if (engagedEnemyId) {
					const obj = worldState.objects.find((o) => o.id === engagedEnemyId);
					if (obj) {
						obj.engagedBy = null;
						// On victory, remove the enemy from the overworld.
						if (battle.state === "victory") {
							worldState.objects = worldState.objects.filter((o) => o.id !== engagedEnemyId);
							broadcast({ t: PROTOCOL.STATE, ts: nowMs(), players: snapshot(), objects: objectsSnapshot() });
						}
					}
				}

				deleteBattleById(battle.id);
			}
		}

		if (msg.t === PROTOCOL.SAVE_PUSH) {
			// Client can push save (localStorage) to server for this session.
			if (msg.save && typeof msg.save === "object") {
				const next = { ...p.save, ...msg.save };
				// Prevent client from teleporting outside map.
				if (typeof next.x === "number" && typeof next.y === "number") {
					next.x = clamp(next.x, PLAYER_RADIUS, worldState.width * TILE_SIZE - PLAYER_RADIUS);
					next.y = clamp(next.y, PLAYER_RADIUS, worldState.height * TILE_SIZE - PLAYER_RADIUS);
				}
				p.save = next;
				ensureQuestStateOnSave(p.save);
				if (typeof next.x === "number") p.x = next.x;
				if (typeof next.y === "number") p.y = next.y;

				// Keep battle party HP in sync with save (for HUD / continuity).
				if (p.party?.activeMember?.stats) {
					p.party.activeMember.stats.hp = p.save.hp;
					p.party.activeMember.stats.maxHp = p.save.maxHp;
				}

				// Push quest state down to client if save imported without quests.
				sendQuestUpdate(ws, p.save, { changed: false, completedQuestIds: [], availableQuests: null });
			}
		}
	});

	ws.on("close", () => {
		const { player } = cleanupConnection(connectionId);
		if (!player) return;
		// Best-effort cleanup of active battle.
		if (player.activeBattleId) deleteBattleById(player.activeBattleId);
		broadcast({ t: PROTOCOL.LEAVE, id: player.id });
	});
});

// Fixed-timestep game loop
const dt = 1 / TICK_HZ;
let lastTickMs = nowMs();
let accumulator = 0;

function step() {
	const t = nowMs();
	const frame = Math.min(250, t - lastTickMs);
	lastTickMs = t;
	accumulator += frame / 1000;

	while (accumulator >= dt) {
		for (const p of playersById.values()) {
			const speed = 90; // px/s
			let vx = 0;
			let vy = 0;
			if (p.input.left) vx -= 1;
			if (p.input.right) vx += 1;
			if (p.input.up) vy -= 1;
			if (p.input.down) vy += 1;

			const len = Math.hypot(vx, vy);
			if (len > 0) {
				vx /= len;
				vy /= len;
			}

			const nx = p.x + vx * speed * dt;
			const ny = p.y + vy * speed * dt;
			const moved = tryMoveWithCollision(p.x, p.y, nx, ny);
			p.x = moved.x;
			p.y = moved.y;

			// Server-side "checkpoint" save fields
			p.save.x = p.x;
			p.save.y = p.y;

			// Quest hook: region enter
			if (p.ws && p.ws.readyState === 1) maybeEmitRegionEnter(p.ws, p);
		}

		// Simple roaming enemies
		for (const o of worldState.objects) {
			if (o.type !== "enemy" || !o.roam) continue;
			if (o.engagedBy) continue;
			// Low-frequency wandering
			if (Math.random() > 0.02) continue;
			const dirs = ["up", "down", "left", "right"];
			const d = dirs[Math.floor(Math.random() * dirs.length)];
			const { dx, dy } = dirToDelta(d);
			const nx = o.x + dx;
			const ny = o.y + dy;
			if (nx < 1 || ny < 1 || nx >= worldState.width - 1 || ny >= worldState.height - 1) continue;
			if (isSolidAtTile(nx, ny)) continue;
			// Don't walk into blocks
			const blockThere = worldState.objects.some((oo) => oo.type === "block" && oo.x === nx && oo.y === ny);
			if (blockThere) continue;
			o.x = nx;
			o.y = ny;
		}

		accumulator -= dt;
	}
}

setInterval(step, 1000 / TICK_HZ);

setInterval(() => {
	broadcast({ t: PROTOCOL.STATE, ts: nowMs(), players: snapshot(), objects: objectsSnapshot() });
}, 1000 / SNAPSHOT_HZ);

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
server.listen(PORT, () => {
	// eslint-disable-next-line no-console
	console.log(`RPG server listening on http://localhost:${PORT}`);
});
