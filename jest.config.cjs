/**
 * Jest config for this repo.
 *
 * Assumptions:
 * - Server/game code is CommonJS (`require`) and runs in Node.
 * - These tests are unit tests for deterministic battle math; if balance/formulas change,
 *   expected values should be updated accordingly.
 */

module.exports = {
	testEnvironment: "node",
	clearMocks: true
};
