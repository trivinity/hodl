const { assert } = require("chai");
const { windowStats, allTimeHigh } = require("../web/src/lib/stats.ts");

describe("stats bar", () => {
  const pts = [
    { t: 100, cap: 10, isBuy: true, sol: 1, trader: "a" },
    { t: 200, cap: 20, isBuy: true, sol: 2, trader: "b" },
    { t: 900, cap: 15, isBuy: false, sol: 1.5, trader: "a" },
    { t: 950, cap: 18, isBuy: true, sol: 3, trader: "a" },
  ];
  it("counts only trades inside the window", () => {
    const s = windowStats(pts, 200, 1000, 18);
    assert.equal(s.buys, 1);
    assert.equal(s.sells, 1);
    assert.equal(s.volume, 4.5);
    assert.equal(s.buyers, 1);
    assert.equal(s.sellers, 1);
    // price at the start of the window = last trade before it (cap 20)
    assert.closeTo(s.change, -10, 1e-9);
  });
  it("uses the first trade as the start for a token younger than the window", () => {
    const s = windowStats(pts, 100000, 1000, 18);
    assert.closeTo(s.change, 80, 1e-9);
    assert.equal(s.buys, 3);
    assert.equal(s.buyers, 2);
  });
  it("finds the all time high, including the live value", () => {
    assert.equal(allTimeHigh(pts, 18), 20);
    assert.equal(allTimeHigh(pts, 30), 30);
    assert.isNull(allTimeHigh([], null));
  });
});
