(function (root, factory) {
	if (typeof module === "object" && typeof module.exports === "object") {
		module.exports = factory();
	} else {
		root.RPG_WORLD_RENDERER = factory();
	}
})(typeof self !== "undefined" ? self : this, function () {
	"use strict";

	function getCanvas() {
		const existing = /** @type {HTMLCanvasElement|null} */ (document.getElementById("overworld"));
		if (existing) return existing;
		const c = document.createElement("canvas");
		c.id = "overworld";
		c.width = 200;
		c.height = 120;
		(document.getElementById("hud") || document.body).appendChild(c);
		return c;
	}

	function tileColor(tileId) {
		// Use simple flat colors; no fancy art.
		const shared = root.RPG_SHARED;
		const TILE = shared?.TILE;
		if (!TILE) return "#2f7d32";
		if (tileId === TILE.GRASS) return "#2f7d32";
		if (tileId === TILE.WATER) return "#1f5fbf";
		if (tileId === TILE.WALL) return "#6b5b4b";
		if (tileId === TILE.FOREST) return "#2f7d32";
		if (tileId === TILE.DUNGEON) return "#2a2a2a";
		if (tileId === TILE.BRIDGE) return "#7a5a2a";
		if (tileId === TILE.CRACKED_WALL) return "#6b5b4b";
		return "#2f7d32";
	}

	function renderWorld(clientState) {
		const canvas = getCanvas();
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		ctx.clearRect(0, 0, canvas.width, canvas.height);

		// Prefer real world grid if available; fallback to a generic grid.
		const world = root.RPG_WORLD_STATE;
		const width = world?.width ?? 20;
		const height = world?.height ?? 12;
		const tiles = world?.tiles;

		const cellW = Math.max(1, Math.floor(canvas.width / width));
		const cellH = Math.max(1, Math.floor(canvas.height / height));

		for (let ty = 0; ty < height; ty++) {
			for (let tx = 0; tx < width; tx++) {
				const tileId = tiles?.[ty]?.[tx] ?? ((tx + ty) % 2 === 0 ? 0 : 3);
				ctx.fillStyle = tileColor(tileId);
				ctx.fillRect(tx * cellW, ty * cellH, cellW, cellH);
			}
		}

		// Draw party marker.
		const player = clientState?.player;
		if (player && typeof player.x === "number" && typeof player.y === "number") {
			const TILE_SIZE = root.RPG_SHARED?.TILE_SIZE ?? 16;
			const tx = Math.floor(player.x / TILE_SIZE);
			const ty = Math.floor(player.y / TILE_SIZE);

			const cx = tx * cellW + Math.floor(cellW / 2);
			const cy = ty * cellH + Math.floor(cellH / 2);

			ctx.fillStyle = "#f2f2f2";
			ctx.beginPath();
			ctx.arc(cx, cy, Math.max(2, Math.floor(Math.min(cellW, cellH) / 3)), 0, Math.PI * 2);
			ctx.fill();
			ctx.strokeStyle = "#111";
			ctx.lineWidth = 1;
			ctx.stroke();
		}

		// Current region label (optional, minimal).
		if (typeof clientState?.currentRegion === "string") {
			ctx.fillStyle = "rgba(0,0,0,0.45)";
			ctx.fillRect(4, 4, Math.min(canvas.width - 8, 120), 18);
			ctx.fillStyle = "#fff";
			ctx.font = "12px system-ui, sans-serif";
			ctx.fillText(clientState.currentRegion, 10, 17);
		}
	}

	return {
		renderWorld
	};
});
