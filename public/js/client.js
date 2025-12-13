(() => {
	"use strict";

	const {
		PROTOCOL,
		TILE,
		TILE_SIZE,
		PLAYER_RADIUS,
		nowMs,
		safeJsonParse,
		buildDefaultSave,
		getTileAtWorld
	} = window.RPG_SHARED;

	/** DOM */
	const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("game"));
	const ctx = canvas.getContext("2d");
	const statusEl = document.getElementById("status");
	const menuEl = document.getElementById("menu");
	const menuTitleEl = document.getElementById("menu-title");
	const menuBodyEl = document.getElementById("menu-body");
	const menuActionsEl = document.getElementById("menu-actions");
	const savefileInput = /** @type {HTMLInputElement} */ (document.getElementById("savefile"));

	/** Network + state */
	let ws = null;
	let myId = null;
	let world = null;
	let players = {};
	let objects = [];
	let battle = null;

	/**
	 * High-level client state container.
	 * Keep this minimal and derive where possible.
	 */
	const clientState = {
		player: null,
		party: null,
		currentRegion: null,
		battleState: null,
		quests: null
	};

	/** Client save (authoritative for persistence; server accepts for session) */
	const LS_KEY = "rpg.save.v1";
	let save = null;

	/** Input */
	const input = { up: false, down: false, left: false, right: false };
	let dir = "down";
	let menuMode = "none"; // none | main | battle | shop
	let engagedEnemyId = null;

	function setStatus(text) {
		statusEl.textContent = text;
	}

	function computeRegionFromPlayer(p) {
		if (!p || typeof p.x !== "number" || typeof p.y !== "number") return null;
		const tx = Math.floor(p.x / TILE_SIZE);
		const ty = Math.floor(p.y / TILE_SIZE);
		if (tx >= 3 && tx <= 16 && ty >= 4 && ty <= 9) return "dawnrise";
		if (tx >= 30 && tx <= 35 && ty >= 13 && ty <= 16) return "light_shrine";
		return "stormfell";
	}

	let lastWorldRenderKey = "";
	function renderWorld() {
		const fn = window.RPG_WORLD_RENDERER?.renderWorld;
		if (typeof fn !== "function") return;
		fn(clientState);
	}

	function maybeRenderWorld() {
		const p = clientState.player;
		const tx = p && typeof p.x === "number" ? Math.floor(p.x / TILE_SIZE) : "_";
		const ty = p && typeof p.y === "number" ? Math.floor(p.y / TILE_SIZE) : "_";
		const key = `${clientState.currentRegion || "_"}:${tx},${ty}`;
		if (key === lastWorldRenderKey) return;
		lastWorldRenderKey = key;
		renderWorld();
	}

	function isMenuOpen() {
		return menuMode !== "none";
	}

	function openMenu(mode) {
		menuMode = mode;
		menuEl.classList.remove("hidden");
		renderMenu();
		// Stop movement while in menus.
		input.up = input.down = input.left = input.right = false;
		sendInput();
	}

	function closeMenu() {
		menuMode = "none";
		menuEl.classList.add("hidden");
		renderMenu();
	}

	// Allow UI modules to close menus without reaching into internal state.
	window.RPG_CLOSE_MENU = closeMenu;

	function button(label, onClick) {
		const b = document.createElement("button");
		b.type = "button";
		b.textContent = label;
		b.addEventListener("click", onClick);
		return b;
	}

	function renderMenu() {
		menuTitleEl.textContent = "";
		menuBodyEl.textContent = "";
		menuActionsEl.textContent = "";

		if (menuMode === "none") return;

		if (menuMode === "main") {
			menuTitleEl.textContent = "Menu";
			menuBodyEl.textContent = "Save/Load and overworld tools.";

			menuActionsEl.append(
				button("Save (local)", () => {
					persistLocalSave();
					setStatus("Saved to local storage.");
				}),
				button("Export Savefile (JSON)", () => exportSavefile()),
				button("Import Savefile (JSON)", () => savefileInput.click()),
				button("Use Bomb Flower", () => {
					useTool("bombFlower");
					closeMenu();
				}),
				button("Use Grappling Hook", () => {
					useTool("grapplingHook");
					closeMenu();
				}),
				button("Use Fire Rod", () => {
					useTool("fireRod");
					closeMenu();
				}),
				button("Close", () => closeMenu())
			);
			return;
		}

		if (menuMode === "battle") {
			if (!battle) {
				menuTitleEl.textContent = "Battle";
				menuBodyEl.textContent = "Engaging…";
				menuActionsEl.append(button("Close", () => closeMenu()));
				return;
			}

			const renderBattle = window.RPG_BATTLE_UI?.renderBattle;
			if (typeof renderBattle === "function") {
				renderBattle(battle, clientState);
			} else {
				menuTitleEl.textContent = "Battle";
				menuBodyEl.textContent = "Battle UI not loaded.";
				menuActionsEl.append(button("Close", () => closeMenu()));
			}

			if (battle.state === "victory") setStatus("Victory!");
			if (battle.state === "defeat") setStatus("Defeat.");
			return;
		}

		if (menuMode === "shop") {
			menuTitleEl.textContent = "Shop";
			menuBodyEl.textContent = `Gold: ${save.gold} · Potions: ${save.inventory?.potion ?? 0}`;
			const cost = 8;
			menuActionsEl.append(
				button(`Buy Potion (${cost}g)`, () => {
					if (save.gold < cost) {
						setStatus("Not enough gold.");
						return;
					}
					save.gold -= cost;
					save.inventory = save.inventory || {};
					save.inventory.potion = (save.inventory.potion ?? 0) + 1;
					persistLocalSave();
					renderMenu();
				}),
				button("Leave", () => closeMenu())
			);
		}
	}

	function persistLocalSave() {
		localStorage.setItem(LS_KEY, JSON.stringify(save, null, 2));
	}

	function loadLocalSaveOrDefault() {
		const raw = localStorage.getItem(LS_KEY);
		if (raw) {
			const parsed = safeJsonParse(raw);
			if (parsed && typeof parsed === "object") return parsed;
		}
		return buildDefaultSave({ x: TILE_SIZE * 2, y: TILE_SIZE * 2 });
	}

	function exportSavefile() {
		const blob = new Blob([JSON.stringify(save, null, 2)], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = "rpg-save.json";
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
	}

	savefileInput.addEventListener("change", async () => {
		const f = savefileInput.files?.[0];
		if (!f) return;
		const text = await f.text();
		const parsed = safeJsonParse(text);
		if (!parsed || typeof parsed !== "object") {
			setStatus("Invalid savefile.");
			return;
		}
		save = { ...buildDefaultSave(), ...parsed };
		persistLocalSave();
		pushSaveToServer();
		setStatus("Savefile imported.");
		savefileInput.value = "";
		renderMenu();
	});

	function pushSaveToServer() {
		if (!ws || ws.readyState !== WebSocket.OPEN) return;
		ws.send(JSON.stringify({ t: PROTOCOL.SAVE_PUSH, save }));
	}

	function connect() {
		const proto = location.protocol === "https:" ? "wss" : "ws";
		ws = new WebSocket(`${proto}://${location.host}`);

		ws.addEventListener("open", () => {
			// Expose the active websocket so UI modules can send commands.
			window.RPG_WS = ws;
			setStatus("Connected.");
			// Identify this connection so the server can create a player session.
			ws.send(
				JSON.stringify({
					t: PROTOCOL.PLAYER_CONNECT,
					displayName: (save && typeof save.displayName === "string" && save.displayName.trim()) ? save.displayName : "Hero"
				})
			);
			// Push local save once connected so your last position/inventory carries.
			pushSaveToServer();
		});

		ws.addEventListener("message", (ev) => {
			const msg = safeJsonParse(ev.data);
			if (!msg || typeof msg.t !== "string") return;

			if (msg.t === PROTOCOL.INIT) {
				myId = msg.id;
				world = msg.world;
				window.RPG_WORLD_STATE = world;
				if (Array.isArray(msg.objects)) objects = msg.objects;
				if (save && msg.questState && typeof msg.questState === "object") {
					save.quests = msg.questState;
					persistLocalSave();
				}
				clientState.quests = msg.questState || save?.quests || null;
				// We may not have a player snapshot yet; render at least the grid.
				renderWorld();
				setStatus(`Connected as ${myId.slice(0, 6)}.`);
			}

			if (msg.t === PROTOCOL.STATE) {
				players = msg.players || {};
				if (Array.isArray(msg.objects)) objects = msg.objects;
				clientState.player = myId ? players?.[myId] ?? null : null;
				clientState.currentRegion = computeRegionFromPlayer(clientState.player);
				maybeRenderWorld();
			}

			if (msg.t === PROTOCOL.WORLD) {
				world = msg.world;
				window.RPG_WORLD_STATE = world;
				renderWorld();
			}

			if (msg.t === PROTOCOL.BATTLE_START) {
				battle = msg.battle || null;
				clientState.battleState = battle;
				clientState.party = battle?.party ?? clientState.party;
				openMenu("battle");
			}

			if (msg.t === PROTOCOL.BATTLE_UPDATE) {
				battle = msg.battle || null;
				clientState.battleState = battle;
				clientState.party = battle?.party ?? clientState.party;
				if (menuMode === "battle") renderMenu();
			}

			if (msg.t === PROTOCOL.QUEST_UPDATE) {
				if (save && msg.questState && typeof msg.questState === "object") {
					save.quests = msg.questState;
					persistLocalSave();
				}
				clientState.quests = msg.questState || save?.quests || clientState.quests;
				const completed = Array.isArray(msg.completedQuestIds) ? msg.completedQuestIds : [];
				const activated = Array.isArray(msg.newlyActivatedQuestIds) ? msg.newlyActivatedQuestIds : [];
				const available = Array.isArray(msg.availableQuestIds) ? msg.availableQuestIds : [];
				if (completed.length) {
					setStatus(`Quest complete: ${completed[completed.length - 1]}`);
				} else if (activated.length) {
					setStatus(`Quest started: ${activated[activated.length - 1]}`);
				} else if (available.length) {
					setStatus(`New quest available: ${available[0]}`);
				}
				if (menuMode === "main") renderMenu();
			}

			if (msg.t === "world:updatePosition") {
				const x = typeof msg.x === "number" ? msg.x : null;
				const y = typeof msg.y === "number" ? msg.y : null;
				if (x !== null && y !== null) {
					// Keep a minimal party position alongside any party snapshot.
					if (!clientState.party || typeof clientState.party !== "object") clientState.party = {};
					clientState.party.position = { x, y };
					clientState.currentRegion = typeof msg.regionId === "string" ? msg.regionId : clientState.currentRegion;
					// Optionally keep local save position in sync.
					if (save) {
						save.x = x;
						save.y = y;
						persistLocalSave();
					}
					renderWorld();
				}
			}
		});

		ws.addEventListener("close", () => {
			if (window.RPG_WS === ws) window.RPG_WS = null;
			setStatus("Disconnected. Retrying…");
			setTimeout(connect, 800);
		});
	}

	function setKey(e, pressed) {
		const k = e.key.toLowerCase();

		if (k === "escape" && pressed) {
			if (menuMode === "none") openMenu("main");
			else if (menuMode === "main") closeMenu();
			return;
		}

		if (k === "enter" && pressed) {
			if (menuMode === "none") {
				// Engage/interact is explicit (no random encounters).
				if (tryEngageOrShopOrInteract()) return;
				openMenu("main");
			}
			return;
		}

		if (isMenuOpen()) return;

		// WASD + Arrows
		if (k === "w" || e.key === "ArrowUp") input.up = pressed;
		if (k === "s" || e.key === "ArrowDown") input.down = pressed;
		if (k === "a" || e.key === "ArrowLeft") input.left = pressed;
		if (k === "d" || e.key === "ArrowRight") input.right = pressed;

		// Direction for animation/facing
		if (pressed) {
			if (input.up) dir = "up";
			else if (input.down) dir = "down";
			else if (input.left) dir = "left";
			else if (input.right) dir = "right";
		}

		sendInput();
	}

	function sendInput() {
		if (!ws || ws.readyState !== WebSocket.OPEN) return;
		ws.send(JSON.stringify({ t: PROTOCOL.INPUT, input, dir }));
	}

	function startBattle() {
		encounter = { hp: 14, maxHp: 14 };
		openMenu("battle");
	}

	function tileOfWorldXY(x, y) {
		return { tx: Math.floor(x / TILE_SIZE), ty: Math.floor(y / TILE_SIZE) };
	}

	function facingDelta(d) {
		if (d === "up") return { dx: 0, dy: -1 };
		if (d === "down") return { dx: 0, dy: 1 };
		if (d === "left") return { dx: -1, dy: 0 };
		if (d === "right") return { dx: 1, dy: 0 };
		return { dx: 0, dy: 0 };
	}

	function objectAt(tx, ty) {
		return objects.find((o) => o.x === tx && o.y === ty);
	}

	function sendAction(payload) {
		if (!ws || ws.readyState !== WebSocket.OPEN) return;
		ws.send(JSON.stringify({ t: PROTOCOL.ACTION, ...payload }));
	}

	function battleEngage(enemyId) {
		if (!ws || ws.readyState !== WebSocket.OPEN) return;
		ws.send(JSON.stringify({ t: PROTOCOL.BATTLE_ENGAGE, enemyId }));
	}

	function useTool(tool) {
		sendAction({ a: "use_tool", tool });
	}

	function enemyDamage(enemyId, amount) {
		sendAction({ a: "enemy_damage", enemyId, amount });
	}

	function tryEngageOrShopOrInteract() {
		const me = players?.[myId];
		if (!me || !world) return false;
		const { tx, ty } = tileOfWorldXY(me.x, me.y);
		const { dx, dy } = facingDelta(me.dir || dir);
		const fx = tx + dx;
		const fy = ty + dy;
		const o = objectAt(fx, fy);

		if (o?.type === "enemy") {
			// Explicit engage (server-authoritative)
			engagedEnemyId = o.id;
			battle = null;
			setStatus("Engaging…");
			battleEngage(o.id);
			openMenu("battle");
			return true;
		}

		if (o?.type === "shop") {
			openMenu("shop");
			return true;
		}

		// Default: server-side interaction (push block, toggle torch/switch, etc.)
		sendAction({ a: "interact" });
		return true;
	}

	window.addEventListener("keydown", (e) => {
		if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault();
		setKey(e, true);
	});
	window.addEventListener("keyup", (e) => setKey(e, false));

	// Rendering (simple 2.5D-ish: draw tiles, then y-sorted sprites + "height")
	function drawTile(tx, ty, tileId, camX, camY, t) {
		const x = tx * TILE_SIZE - camX;
		const y = ty * TILE_SIZE - camY;
		if (x < -TILE_SIZE || y < -TILE_SIZE || x > canvas.width || y > canvas.height) return;

		// Base
		if (tileId === TILE.GRASS) ctx.fillStyle = "#2f7d32";
		else if (tileId === TILE.WATER) ctx.fillStyle = "#1f5fbf";
		else if (tileId === TILE.WALL) ctx.fillStyle = "#6b5b4b";
		else if (tileId === TILE.FOREST) ctx.fillStyle = "#2f7d32";
		else if (tileId === TILE.DUNGEON) ctx.fillStyle = "#2a2a2a";
		else if (tileId === TILE.BRIDGE) ctx.fillStyle = "#7a5a2a";
		else if (tileId === TILE.CRACKED_WALL) ctx.fillStyle = "#6b5b4b";
		else ctx.fillStyle = "#2f7d32";
		ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);

		// Forest parallax shadows (layered)
		if (tileId === TILE.FOREST) {
			const wobble1 = Math.sin(t / 600 + tx * 0.7 + ty * 0.35) * 1.4;
			const wobble2 = Math.sin(t / 420 + tx * 0.35 - ty * 0.5) * 0.9;
			ctx.fillStyle = "rgba(0,0,0,0.16)";
			ctx.fillRect(x + 2 + wobble1, y + 2, TILE_SIZE - 4, TILE_SIZE - 4);
			ctx.fillStyle = "rgba(0,0,0,0.10)";
			ctx.fillRect(x + 1, y + 1 + wobble2, TILE_SIZE - 2, TILE_SIZE - 2);
			// canopy hint
			ctx.fillStyle = "rgba(10,40,10,0.35)";
			ctx.fillRect(x, y, TILE_SIZE, 4);
		}

		if (tileId === TILE.DUNGEON) {
			ctx.fillStyle = "rgba(255,255,255,0.12)";
			ctx.fillRect(x + 2, y + 2, TILE_SIZE - 4, TILE_SIZE - 4);
		}

		if (tileId === TILE.CRACKED_WALL) {
			ctx.fillStyle = "rgba(0,0,0,0.22)";
			ctx.fillRect(x + 3, y + 7, TILE_SIZE - 6, 2);
			ctx.fillRect(x + 6, y + 4, 2, TILE_SIZE - 8);
		}
	}

	function drawWall(tx, ty, camX, camY) {
		const baseX = tx * TILE_SIZE - camX;
		const baseY = ty * TILE_SIZE - camY;
		const h = 10;
		ctx.fillStyle = "#6b5b4b";
		ctx.fillRect(baseX, baseY - h, TILE_SIZE, TILE_SIZE + h);
		ctx.fillStyle = "rgba(0,0,0,0.15)";
		ctx.fillRect(baseX, baseY + TILE_SIZE - 4, TILE_SIZE, 4);
	}

	function drawObject(o, camX, camY, t) {
		const x = o.x * TILE_SIZE + TILE_SIZE / 2 - camX;
		const y = o.y * TILE_SIZE + TILE_SIZE / 2 - camY;
		if (x < -TILE_SIZE || y < -TILE_SIZE || x > canvas.width + TILE_SIZE || y > canvas.height + TILE_SIZE) return;

		if (o.type === "block") {
			ctx.fillStyle = "#7a5a2a";
			ctx.fillRect(x - 7, y - 7, 14, 14);
			ctx.fillStyle = "rgba(255,255,255,0.18)";
			ctx.fillRect(x - 7, y - 7, 14, 3);
			return;
		}
		if (o.type === "torch") {
			ctx.fillStyle = "#3a2a1a";
			ctx.fillRect(x - 2, y - 6, 4, 10);
			if (o.lit) {
				const flicker = 1 + Math.sin(t / 80 + o.x) * 0.8;
				ctx.fillStyle = "rgba(255,200,80,0.9)";
				ctx.beginPath();
				ctx.arc(x, y - 8, 3 + flicker * 0.6, 0, Math.PI * 2);
				ctx.fill();
				ctx.fillStyle = "rgba(255,200,80,0.25)";
				ctx.beginPath();
				ctx.arc(x, y - 8, 9 + flicker, 0, Math.PI * 2);
				ctx.fill();
			}
			return;
		}
		if (o.type === "switch") {
			ctx.fillStyle = o.state ? "#8ad06b" : "#c9c9c9";
			ctx.fillRect(x - 6, y - 3, 12, 6);
			ctx.fillStyle = "rgba(0,0,0,0.25)";
			ctx.fillRect(x - 6, y + 2, 12, 1);
			return;
		}
		if (o.type === "shop") {
			ctx.fillStyle = "#2b2b2b";
			ctx.fillRect(x - 8, y - 8, 16, 16);
			ctx.fillStyle = "#d1b45a";
			ctx.fillRect(x - 6, y - 3, 12, 6);
			return;
		}
		if (o.type === "enemy") {
			ctx.fillStyle = "rgba(0,0,0,0.25)";
			ctx.beginPath();
			ctx.ellipse(x, y + 6, 7, 3, 0, 0, Math.PI * 2);
			ctx.fill();
			ctx.fillStyle = "#b0122a";
			ctx.beginPath();
			ctx.arc(x, y - 2, 6, 0, Math.PI * 2);
			ctx.fill();
			return;
		}
	}

	function drawShrines(camX, camY) {
		const shrines = world?.shrines;
		if (!Array.isArray(shrines)) return;
		for (const s of shrines) {
			const x = s.x * TILE_SIZE + TILE_SIZE / 2 - camX;
			const y = s.y * TILE_SIZE + TILE_SIZE / 2 - camY;
			if (x < -TILE_SIZE || y < -TILE_SIZE || x > canvas.width + TILE_SIZE || y > canvas.height + TILE_SIZE) continue;
			let c = "#7fd1ff";
			if (s.element === "fire") c = "#ff905a";
			if (s.element === "water") c = "#6aa7ff";
			if (s.element === "earth") c = "#c2a36b";
			if (s.element === "wind") c = "#9bf5c8";
			if (s.element === "forest") c = "#8ad06b";
			if (s.element === "shadow") c = "#c58bff";
			ctx.fillStyle = c;
			ctx.beginPath();
			ctx.moveTo(x, y - 8);
			ctx.lineTo(x + 6, y);
			ctx.lineTo(x, y + 8);
			ctx.lineTo(x - 6, y);
			ctx.closePath();
			ctx.fill();
			ctx.fillStyle = "rgba(255,255,255,0.25)";
			ctx.fillRect(x - 1, y - 5, 2, 10);
		}
	}

	function drawPlayer(p, camX, camY, isMe) {
		const x = p.x - camX;
		const y = p.y - camY;
		// shadow
		ctx.fillStyle = "rgba(0,0,0,0.25)";
		ctx.beginPath();
		ctx.ellipse(x, y + 10, 12, 6, 0, 0, Math.PI * 2);
		ctx.fill();

		// body (slight "height")
		const lift = 6;
		ctx.fillStyle = isMe ? "#f2f2f2" : "#cfcfcf";
		ctx.beginPath();
		ctx.arc(x, y - lift, PLAYER_RADIUS, 0, Math.PI * 2);
		ctx.fill();

		// facing marker
		ctx.strokeStyle = "#111";
		ctx.lineWidth = 2;
		ctx.beginPath();
		if (p.dir === "up") ctx.moveTo(x, y - lift - 2), ctx.lineTo(x, y - lift - 10);
		else if (p.dir === "down") ctx.moveTo(x, y - lift + 2), ctx.lineTo(x, y - lift + 10);
		else if (p.dir === "left") ctx.moveTo(x - 2, y - lift), ctx.lineTo(x - 10, y - lift);
		else if (p.dir === "right") ctx.moveTo(x + 2, y - lift), ctx.lineTo(x + 10, y - lift);
		ctx.stroke();
	}

	function draw() {
		const t = nowMs();
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		if (!world || !myId) {
			ctx.fillStyle = "#111";
			ctx.fillRect(0, 0, canvas.width, canvas.height);
			ctx.fillStyle = "#fff";
			ctx.font = "16px system-ui, sans-serif";
			ctx.fillText("Connecting…", 20, 30);
			requestAnimationFrame(draw);
			return;
		}

		const me = players?.[myId];
		const camX = (me?.x ?? 0) - canvas.width / 2;
		const camY = (me?.y ?? 0) - canvas.height / 2;

		// Background tiles
		const minTx = Math.max(0, Math.floor(camX / TILE_SIZE) - 1);
		const minTy = Math.max(0, Math.floor(camY / TILE_SIZE) - 1);
		const maxTx = Math.min(world.width - 1, Math.floor((camX + canvas.width) / TILE_SIZE) + 1);
		const maxTy = Math.min(world.height - 1, Math.floor((camY + canvas.height) / TILE_SIZE) + 1);

		for (let ty = minTy; ty <= maxTy; ty++) {
			for (let tx = minTx; tx <= maxTx; tx++) {
				const tileId = world.tiles[ty][tx];
				drawTile(tx, ty, tileId, camX, camY, t);
			}
		}

		// Walls as "tall" objects (pseudo 2.5D)
		for (let ty = minTy; ty <= maxTy; ty++) {
			for (let tx = minTx; tx <= maxTx; tx++) {
				const tileId = world.tiles[ty][tx];
				if (tileId === TILE.WALL || tileId === TILE.CRACKED_WALL) drawWall(tx, ty, camX, camY);
			}
		}

		// Objects and shrines (y-sort with players)
		drawShrines(camX, camY);
		const objectsSorted = (objects || []).slice().sort((a, b) => (a.y ?? 0) - (b.y ?? 0));
		for (const o of objectsSorted) drawObject(o, camX, camY, t);

		// Players (y-sort for depth)
		const sprites = Object.values(players).slice().sort((a, b) => (a.y ?? 0) - (b.y ?? 0));
		for (const p of sprites) drawPlayer(p, camX, camY, p.id === myId);

		// HUD overlay (small)
		if (save) {
			ctx.fillStyle = "rgba(0,0,0,0.45)";
			ctx.fillRect(10, 10, 220, 54);
			ctx.fillStyle = "#fff";
			ctx.font = "14px system-ui, sans-serif";
			ctx.fillText(`HP: ${save.hp}/${save.maxHp}`, 18, 32);
			ctx.fillText(`Gold: ${save.gold}  Potions: ${save.inventory?.potion ?? 0}`, 18, 52);
		}

		requestAnimationFrame(draw);
	}

	// Boot
	save = loadLocalSaveOrDefault();
	connect();
	draw();
})();
