const { assert } = require("chai");
const { toCandles, autoInterval } = require("../web/src/lib/candles.ts");

describe("candles", () => {
  it("groups trades into candles that open where the last one closed", () => {
    const c = toCandles(
      [
        { t: 0, cap: 10 },
        { t: 20, cap: 14 },
        { t: 40, cap: 9 },
        { t: 70, cap: 11 },
        { t: 200, cap: 12 },
      ],
      60
    );
    assert.deepEqual(c, [
      { t: 0, o: 10, h: 14, l: 9, c: 9 },
      { t: 60, o: 9, h: 11, l: 9, c: 11 },
      { t: 180, o: 11, h: 12, l: 11, c: 12 },
    ]);
  });
  it("sorts its input and handles no trades", () => {
    assert.deepEqual(toCandles([], 60), []);
    const c = toCandles([{ t: 100, cap: 2 }, { t: 10, cap: 1 }], 60);
    assert.equal(c[0].t, 0);
    assert.equal(c[0].o, 1);
  });
  it("picks the smallest candle size that fits the history", () => {
    assert.equal(autoInterval(30 * 60), 60);
    assert.equal(autoInterval(2 * 3600), 300);
    assert.equal(autoInterval(30 * 86400), 86400);
  });
});
