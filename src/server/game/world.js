"use strict";

const TILE_TYPES = Object.freeze({
  WALKABLE: "walkable",
  BLOCKING: "blocking",
  INTERACTIVE: "interactive",
  WARP: "warp",
  DOOR: "door"
});

class MapGrid {
  /**
   * @param {object} params
   * @param {number} params.width
   * @param {number} params.height
   * @param {string[][]} params.tiles
   */
  constructor({ width, height, tiles }) {
    if (!Number.isInteger(width) || width <= 0) throw new TypeError("width must be a positive integer");
    if (!Number.isInteger(height) || height <= 0) throw new TypeError("height must be a positive integer");
    if (!Array.isArray(tiles) || tiles.length !== height) throw new TypeError("tiles must be a 2D array [height][width]");

    for (let y = 0; y < height; y++) {
      const row = tiles[y];
      if (!Array.isArray(row) || row.length !== width) {
        throw new TypeError("tiles must be a 2D array [height][width]");
      }
    }

    this.width = width;
    this.height = height;
    this.tiles = tiles;
  }

  /**
   * @param {number} x
   * @param {number} y
   */
  tileAt(x, y) {
    if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
    return this.tiles[y][x] ?? null;
  }

  /**
   * Convenience builder for stub maps using ASCII rows.
   * Legend:
   *  . walkable
   *  # blocking
   *  ! interactive
   *  ^ warp
   *  + door
   * @param {string[]} rows
   */
  static fromAscii(rows) {
    if (!Array.isArray(rows) || rows.length === 0) throw new TypeError("rows must be a non-empty array");
    const height = rows.length;
    const width = rows[0].length;
    if (width === 0) throw new TypeError("rows must not be empty strings");

    const tiles = rows.map((r) => {
      if (typeof r !== "string" || r.length !== width) throw new TypeError("all rows must be equal-length strings");
      return Array.from(r).map((ch) => {
        if (ch === ".") return TILE_TYPES.WALKABLE;
        if (ch === "#") return TILE_TYPES.BLOCKING;
        if (ch === "!") return TILE_TYPES.INTERACTIVE;
        if (ch === "^") return TILE_TYPES.WARP;
        if (ch === "+") return TILE_TYPES.DOOR;
        return TILE_TYPES.BLOCKING;
      });
    });

    return new MapGrid({ width, height, tiles });
  }
}

class WorldRegion {
  /**
   * @param {object} params
   * @param {string} params.id
   * @param {string} params.name
   * @param {"town"|"overworld"|"dungeon"} params.type
   * @param {Array<{to:string, via?:string}>} params.connections
   * @param {string|null} params.encounterTableId
   * @param {MapGrid} params.map
   */
  constructor({ id, name, type, connections, encounterTableId, map }) {
    if (typeof id !== "string" || id.trim() === "") throw new TypeError("id must be a non-empty string");
    if (typeof name !== "string" || name.trim() === "") throw new TypeError("name must be a non-empty string");
    if (type !== "town" && type !== "overworld" && type !== "dungeon") {
      throw new TypeError("type must be 'town' | 'overworld' | 'dungeon'");
    }
    if (!Array.isArray(connections)) throw new TypeError("connections must be an array");
    if (!(map instanceof MapGrid)) throw new TypeError("map must be a MapGrid");

    this.id = id;
    this.name = name;
    this.type = type;
    this.connections = connections.map((c) => ({ ...c }));
    this.encounterTableId = encounterTableId ?? null;
    this.map = map;
  }
}

// --- Stubbed regions ---

const REGION_IDS = Object.freeze({
  VILLAGE_DAWNRISE: "village_dawnrise",
  STORMFELL: "stormfell",
  LIGHT_SHRINE: "light_shrine"
});

const villageOfDawnriseMap = MapGrid.fromAscii([
  "####################",
  "#....!.......+.....#",
  "#..................#",
  "#....######........#",
  "#....#....#........#",
  "#....#....#........#",
  "#....######........#",
  "#..................#",
  "#..........^.......#",
  "#..................#",
  "####################"
]);

const stormfellMap = MapGrid.fromAscii([
  "####################",
  "#...........####...#",
  "#..####.....#..#...#",
  "#..#..#.....#..#...#",
  "#..#..#.....####...#",
  "#..#..#............#",
  "#..####............#",
  "#...........!......#",
  "#......^...........#",
  "#..................#",
  "####################"
]);

const lightShrineMap = MapGrid.fromAscii([
  "####################",
  "#..+...............#",
  "#..######..######..#",
  "#..#....#..#....#..#",
  "#..#.!..#..#..!.#..#",
  "#..#....#..#....#..#",
  "#..######..######..#",
  "#..............^...#",
  "#..................#",
  "####################"
]);

/** @type {WorldRegion[]} */
const REGIONS = [
  new WorldRegion({
    id: REGION_IDS.VILLAGE_DAWNRISE,
    name: "Village of Dawnrise",
    type: "town",
    connections: [{ to: REGION_IDS.STORMFELL, via: "north_gate" }],
    encounterTableId: null,
    map: villageOfDawnriseMap
  }),
  new WorldRegion({
    id: REGION_IDS.STORMFELL,
    name: "Stormfell",
    type: "overworld",
    connections: [
      { to: REGION_IDS.VILLAGE_DAWNRISE, via: "south_road" },
      { to: REGION_IDS.LIGHT_SHRINE, via: "shrine_path" }
    ],
    encounterTableId: "encounters_stormfell_v1",
    map: stormfellMap
  }),
  new WorldRegion({
    id: REGION_IDS.LIGHT_SHRINE,
    name: "Light Shrine",
    type: "dungeon",
    connections: [{ to: REGION_IDS.STORMFELL, via: "entrance" }],
    encounterTableId: "encounters_light_shrine_v1",
    map: lightShrineMap
  })
];

function getRegionById(id) {
  return REGIONS.find((r) => r.id === id) ?? null;
}

/**
 * Collision rule: blocking tiles are not passable; everything else is.
 * This intentionally does not apply interaction logic (doors/warps) yet.
 * @param {string} regionId
 * @param {number} x
 * @param {number} y
 */
function canMoveTo(regionId, x, y) {
  const region = getRegionById(regionId);
  if (!region) return false;
  const tile = region.map.tileAt(x, y);
  if (!tile) return false;
  return tile !== TILE_TYPES.BLOCKING;
}

module.exports = {
  TILE_TYPES,
  MapGrid,
  WorldRegion,
  REGION_IDS,
  REGIONS,
  getRegionById,
  canMoveTo
};
