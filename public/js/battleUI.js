(function (root, factory) {
	if (typeof module === "object" && typeof module.exports === "object") {
		module.exports = factory();
	} else {
		root.RPG_BATTLE_UI = factory();
	}
})(typeof self !== "undefined" ? self : this, function () {
	"use strict";

	let uiMode = "root"; // root | magic | abilities | items
	let lastBattleId = null;

	function $(id) {
		return document.getElementById(id);
	}

	function ensureBattleRoot() {
		const body = $("menu-body");
		const actions = $("menu-actions");
		const title = $("menu-title");
		if (!body || !actions || !title) return null;

		let rootEl = $("battle-ui");
		if (!rootEl) {
			rootEl = document.createElement("div");
			rootEl.id = "battle-ui";
			body.textContent = "";
			body.appendChild(rootEl);
		}

		return { body, actions, title, rootEl };
	}

	function formatHpMp(stats) {
		const hp = stats?.hp ?? 0;
		const maxHp = stats?.maxHp ?? 0;
		const mp = stats?.mp ?? 0;
		const maxMp = stats?.maxMp ?? 0;
		return `HP ${hp}/${maxHp}  MP ${mp}/${maxMp}`;
	}

	function makePanel(titleText) {
		const panel = document.createElement("div");
		panel.className = "battle-panel";
		const h = document.createElement("h3");
		h.textContent = titleText;
		panel.appendChild(h);
		return panel;
	}

	function makeButton(label, onClick, { disabled = false } = {}) {
		const b = document.createElement("button");
		b.type = "button";
		b.textContent = label;
		b.disabled = !!disabled;
		b.addEventListener("click", onClick);
		return b;
	}

	function pickFirstAliveEnemyId(battleState) {
		const enemies = Array.isArray(battleState?.enemies) ? battleState.enemies : [];
		const alive = enemies.find((e) => (e?.stats?.hp ?? 0) > 0);
		return (alive || enemies[0])?.id ?? null;
	}

	function sendBattleCommand(battleState, command) {
		const ws = root.RPG_WS;
		if (!ws || ws.readyState !== WebSocket.OPEN) return;
		if (!battleState?.id) return;
		ws.send(JSON.stringify({ t: root.RPG_SHARED?.PROTOCOL?.BATTLE_COMMAND || "battle:command", battleId: battleState.id, command }));
	}

	function renderBattle(battleState, clientState) {
		const battleId = battleState?.id ?? null;
		if (battleId && battleId !== lastBattleId) {
			uiMode = "root";
			lastBattleId = battleId;
		}

		const rootBits = ensureBattleRoot();
		if (!rootBits) return;
		const { title, rootEl, actions } = rootBits;

		title.textContent = "Battle";
		actions.textContent = "";
		rootEl.textContent = "";

		if (!battleState) {
			rootEl.textContent = "No battle.";
			return;
		}

		const partyMembers = Array.isArray(battleState.party?.members) ? battleState.party.members : [];
		const enemies = Array.isArray(battleState.enemies) ? battleState.enemies : [];
		const active = battleState.active;
		const isMyTurn = battleState.state === "in_progress" && active?.kind === "party";

		// Panels: Party, Enemies, Commands, Log
		const partyPanel = makePanel("Party");
		if (!partyMembers.length) {
			partyPanel.appendChild(document.createTextNode("(none)"));
		} else {
			for (const m of partyMembers) {
				const line = document.createElement("div");
				const isActive = active?.kind === "party" && active.id === m.id;
				line.textContent = `${isActive ? ">" : " "} ${m.name}  ${formatHpMp(m.stats)}`;
				partyPanel.appendChild(line);
			}
		}

		const enemyPanel = makePanel("Enemies");
		if (!enemies.length) {
			enemyPanel.appendChild(document.createTextNode("(none)"));
		} else {
			for (const e of enemies) {
				const line = document.createElement("div");
				const hp = typeof e?.stats?.hp === "number" ? e.stats.hp : null;
				const maxHp = typeof e?.stats?.maxHp === "number" ? e.stats.maxHp : null;
				const hpText = hp === null || maxHp === null ? "HP ?" : `HP ${hp}/${maxHp}`;
				const isActive = active?.kind === "enemy" && active.id === e.id;
				line.textContent = `${isActive ? ">" : " "} ${e.name || "Enemy"}  ${hpText}`;
				enemyPanel.appendChild(line);
			}
		}

		const commandsPanel = makePanel("Commands");
		const commandsGrid = document.createElement("div");
		commandsGrid.className = "battle-commands";

		const enemyId = pickFirstAliveEnemyId(battleState);
		const sourceId = active?.id;

		const disabled = !isMyTurn || !enemyId || !sourceId;

		const setMode = (mode) => {
			uiMode = mode;
			renderBattle(battleState, clientState);
		};

		if (uiMode === "root") {
			commandsGrid.append(
				makeButton("Attack", () => {
					sendBattleCommand(battleState, { type: "ability", sourceId, targetId: enemyId, abilityId: "basic_attack" });
				}, { disabled }),
				makeButton("Magic", () => setMode("magic"), { disabled: !isMyTurn }),
				makeButton("Abilities", () => setMode("abilities"), { disabled: !isMyTurn }),
				makeButton("Items", () => setMode("items"), { disabled: !isMyTurn }),
				makeButton("Defend", () => {
					sendBattleCommand(battleState, { type: "ability", sourceId, targetId: sourceId, abilityId: "defend" });
				}, { disabled: !isMyTurn || !sourceId }),
				makeButton("Flee", () => {
					sendBattleCommand(battleState, { type: "ability", sourceId, targetId: sourceId, abilityId: "flee" });
				}, { disabled: !isMyTurn || !sourceId })
			);
		} else {
			const sub = document.createElement("div");
			sub.style.whiteSpace = "pre-line";
			if (uiMode === "magic") sub.textContent = "Magic\n\n(Not implemented yet.)";
			if (uiMode === "abilities") sub.textContent = "Abilities\n\n(Not implemented yet.)";
			if (uiMode === "items") sub.textContent = "Items\n\n(Not implemented yet.)";
			commandsPanel.appendChild(sub);
			commandsGrid.appendChild(makeButton("Back", () => setMode("root"), { disabled: false }));
		}

		commandsPanel.appendChild(commandsGrid);

		const logPanel = makePanel("Log");
		const logEl = document.createElement("div");
		logEl.id = "battle-log";
		const log = Array.isArray(battleState.log) ? battleState.log : [];
		logEl.textContent = log.slice(-8).join("\n");
		logPanel.appendChild(logEl);

		rootEl.appendChild(partyPanel);
		rootEl.appendChild(enemyPanel);
		rootEl.appendChild(commandsPanel);
		rootEl.appendChild(logPanel);

		// Footer hint (reuse menu-actions area)
		if (battleState.state !== "in_progress") {
			actions.appendChild(makeButton("Close", () => {
				if (typeof root.RPG_CLOSE_MENU === "function") return root.RPG_CLOSE_MENU();
				const menu = $("menu");
				if (menu) menu.classList.add("hidden");
			}, { disabled: false }));
		} else {
			actions.appendChild(
				makeButton(isMyTurn ? "Your turn" : "Waiting…", () => {}, { disabled: true })
			);
		}
	}

	return { renderBattle };
});
