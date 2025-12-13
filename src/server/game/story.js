"use strict";

// Story / quest definitions are data-first and intentionally lightweight.
// This module does not assume a full persistence layer.
//
// Player state shape (minimal expectation):
// {
//   quests: {
//     activeQuestIds: string[],
//     completedQuestIds: string[],
//     progressByQuestId: {
//       [questId]: {
//         objectives: Array<{ progress: number }>
//       }
//     }
//   },
//   // optional for rewards:
//   gold?: number,
//   inventory?: Record<string, number>,
//   experience?: number,
// }

/**
 * Objective
 * type: "visit" | "defeat" | "collect" | "talk"
 * targetId: string
 * progress: number (initial 0)
 * requiredCount: number (>=1)
 */

/**
 * Quest
 * id, name, description
 * prerequisites: string[] (quest ids that must be completed)
 * objectives: Objective[]
 * rewards: { gold?: number, experience?: number, items?: Array<{id:string,count:number}> }
 * nextQuestIds: string[]
 */

const QUESTS = [
	{
		id: "act1_investigate_dawnrise",
		name: "Investigate Dawnrise",
		description:
			"Strange light flickers beyond the treeline. Speak with Dawnrise locals and learn what stirred near the shrine road.",
		prerequisites: [],
		objectives: [
			{ type: "visit", targetId: "region:dawnrise", progress: 0, requiredCount: 1 },
			{ type: "talk", targetId: "npc:elder_rowan", progress: 0, requiredCount: 1 }
		],
		rewards: { gold: 10, experience: 10, items: [{ id: "potion", count: 1 }] },
		nextQuestIds: ["act1_reach_light_shrine"]
	},
	{
		id: "act1_reach_light_shrine",
		name: "Reach the Light Shrine",
		description:
			"Travel from Dawnrise to the Light Shrine and find the source of the disturbances along the old stone path.",
		prerequisites: ["act1_investigate_dawnrise"],
		objectives: [
			{ type: "visit", targetId: "region:stormfell", progress: 0, requiredCount: 1 },
			{ type: "visit", targetId: "region:light_shrine", progress: 0, requiredCount: 1 }
		],
		rewards: { gold: 15, experience: 15 },
		nextQuestIds: ["act1_cleanse_light_crystal"]
	},
	{
		id: "act1_cleanse_light_crystal",
		name: "Cleanse the Light Crystal",
		description:
			"Within the shrine, defeat the guardian and cleanse the Light Crystal to restore balance to the region.",
		prerequisites: ["act1_reach_light_shrine"],
		objectives: [
			{ type: "defeat", targetId: "boss:light_shrine_guardian", progress: 0, requiredCount: 1 },
			{ type: "visit", targetId: "object:light_crystal", progress: 0, requiredCount: 1 }
		],
		rewards: { gold: 25, experience: 30, items: [{ id: "light_crystal_shard", count: 1 }] },
		nextQuestIds: []
	}
];

const QUESTS_BY_ID = Object.freeze(
	QUESTS.reduce((acc, q) => {
		acc[q.id] = q;
		return acc;
	}, {})
);

function cloneQuest(quest) {
	return {
		id: quest.id,
		name: quest.name,
		description: quest.description,
		prerequisites: Array.isArray(quest.prerequisites) ? quest.prerequisites.slice() : [],
		objectives: (quest.objectives || []).map((o) => ({
			type: o.type,
			targetId: o.targetId,
			progress: typeof o.progress === "number" ? o.progress : 0,
			requiredCount: typeof o.requiredCount === "number" ? o.requiredCount : 1
		})),
		rewards: quest.rewards ? JSON.parse(JSON.stringify(quest.rewards)) : {},
		nextQuestIds: Array.isArray(quest.nextQuestIds) ? quest.nextQuestIds.slice() : []
	};
}

function ensurePlayerQuestState(playerState) {
	if (!playerState || typeof playerState !== "object") {
		throw new TypeError("playerState must be an object");
	}
	if (!playerState.quests || typeof playerState.quests !== "object") {
		playerState.quests = {};
	}
	if (!Array.isArray(playerState.quests.activeQuestIds)) playerState.quests.activeQuestIds = [];
	if (!Array.isArray(playerState.quests.completedQuestIds)) playerState.quests.completedQuestIds = [];
	if (!playerState.quests.progressByQuestId || typeof playerState.quests.progressByQuestId !== "object") {
		playerState.quests.progressByQuestId = {};
	}
	return playerState.quests;
}

function isQuestCompleted(playerState, questId) {
	const qs = ensurePlayerQuestState(playerState);
	return qs.completedQuestIds.includes(questId);
}

function isQuestActive(playerState, questId) {
	const qs = ensurePlayerQuestState(playerState);
	return qs.activeQuestIds.includes(questId);
}

function prerequisitesMet(playerState, quest) {
	const prereqs = Array.isArray(quest.prerequisites) ? quest.prerequisites : [];
	for (const reqId of prereqs) {
		if (!isQuestCompleted(playerState, reqId)) return false;
	}
	return true;
}

function getQuestById(id) {
	if (typeof id !== "string" || !id.trim()) return null;
	const q = QUESTS_BY_ID[id] || null;
	return q ? cloneQuest(q) : null;
}

function getAvailableQuestsForPlayer(playerState) {
	ensurePlayerQuestState(playerState);
	return QUESTS.filter((q) => {
		if (isQuestCompleted(playerState, q.id)) return false;
		if (isQuestActive(playerState, q.id)) return false;
		return prerequisitesMet(playerState, q);
	}).map(cloneQuest);
}

function ensureProgressForQuest(playerState, questId) {
	const qs = ensurePlayerQuestState(playerState);
	if (!qs.progressByQuestId[questId]) {
		const base = QUESTS_BY_ID[questId];
		if (!base) return null;
		qs.progressByQuestId[questId] = {
			objectives: (base.objectives || []).map(() => ({ progress: 0 }))
		};
	}
	return qs.progressByQuestId[questId];
}

function applyRewards(playerState, rewards) {
	if (!rewards || typeof rewards !== "object") return;
	if (typeof rewards.gold === "number") {
		playerState.gold = (typeof playerState.gold === "number" ? playerState.gold : 0) + rewards.gold;
	}
	if (typeof rewards.experience === "number") {
		playerState.experience =
			(typeof playerState.experience === "number" ? playerState.experience : 0) + rewards.experience;
	}
	if (Array.isArray(rewards.items)) {
		playerState.inventory = playerState.inventory && typeof playerState.inventory === "object" ? playerState.inventory : {};
		for (const it of rewards.items) {
			if (!it || typeof it.id !== "string") continue;
			const count = typeof it.count === "number" ? it.count : 1;
			playerState.inventory[it.id] = (playerState.inventory[it.id] || 0) + count;
		}
	}
}

function questIsComplete(quest, progressState) {
	const objectives = Array.isArray(quest.objectives) ? quest.objectives : [];
	for (let i = 0; i < objectives.length; i++) {
		const required = typeof objectives[i].requiredCount === "number" ? objectives[i].requiredCount : 1;
		const p = progressState?.objectives?.[i]?.progress ?? 0;
		if (p < required) return false;
	}
	return true;
}

/**
 * Update quest progress for a player based on a single game event.
 * Event shape (suggested):
 * { type: "visit"|"defeat"|"collect"|"talk", targetId: string, count?: number }
 *
 * Returns a small delta summary (and mutates playerState in-place).
 */
function updateQuestProgress(playerState, event) {
	ensurePlayerQuestState(playerState);
	if (!event || typeof event !== "object") return { changed: false, completedQuestIds: [] };
	if (typeof event.type !== "string" || typeof event.targetId !== "string") {
		return { changed: false, completedQuestIds: [] };
	}
	const count = typeof event.count === "number" && event.count > 0 ? event.count : 1;

	const qs = playerState.quests;
	const completedQuestIds = [];
	const newlyActivatedQuestIds = [];
	let changed = false;

	for (const questId of qs.activeQuestIds.slice()) {
		const quest = QUESTS_BY_ID[questId];
		if (!quest) continue;
		const progressState = ensureProgressForQuest(playerState, questId);
		if (!progressState) continue;

		for (let i = 0; i < (quest.objectives || []).length; i++) {
			const obj = quest.objectives[i];
			if (!obj) continue;
			if (obj.type !== event.type) continue;
			if (obj.targetId !== event.targetId) continue;

			const required = typeof obj.requiredCount === "number" ? obj.requiredCount : 1;
			const cur = progressState.objectives?.[i]?.progress ?? 0;
			const next = Math.min(required, cur + count);
			if (!progressState.objectives[i]) progressState.objectives[i] = { progress: 0 };
			if (next !== cur) {
				progressState.objectives[i].progress = next;
				changed = true;
			}
		}

		if (questIsComplete(quest, progressState)) {
			// Mark completed
			if (!qs.completedQuestIds.includes(questId)) qs.completedQuestIds.push(questId);
			qs.activeQuestIds = qs.activeQuestIds.filter((id) => id !== questId);
			applyRewards(playerState, quest.rewards);
			completedQuestIds.push(questId);
			changed = true;

			// Auto-activate next quests (since there may not be a UI to accept them yet).
			const nextIds = Array.isArray(quest.nextQuestIds) ? quest.nextQuestIds : [];
			for (const nextId of nextIds) {
				if (typeof nextId !== "string" || !nextId.trim()) continue;
				const nextQuest = QUESTS_BY_ID[nextId];
				if (!nextQuest) continue;
				if (qs.completedQuestIds.includes(nextId)) continue;
				if (qs.activeQuestIds.includes(nextId)) continue;
				if (!prerequisitesMet(playerState, nextQuest)) continue;
				qs.activeQuestIds.push(nextId);
				ensureProgressForQuest(playerState, nextId);
				newlyActivatedQuestIds.push(nextId);
				changed = true;
			}
		}
	}

	return {
		changed,
		completedQuestIds,
		newlyActivatedQuestIds,
		availableQuests: getAvailableQuestsForPlayer(playerState).map((q) => q.id)
	};
}

module.exports = {
	QUESTS,
	getQuestById,
	getAvailableQuestsForPlayer,
	updateQuestProgress
};
