import assert from "node:assert/strict";
import test from "node:test";
import { base64ToThumbHash, rgbaToThumbHash, thumbHashToAverageRGBA, thumbHashToBase64 } from "../../app/thumbhash.js";

// Expected hashes were produced by the reference `thumbhash` 0.1.1 package
// (github.com/evanw/thumbhash) from the same deterministic pixels.
function pixels(w, h, alpha) {
    let seed = 7;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < rgba.length; i += 4) {
        rgba[i] = (i / 4 % w) * 2;
        rgba[i + 1] = random() * 255;
        rgba[i + 2] = 200 - (i / 4 / w);
        rgba[i + 3] = alpha ? random() * 255 : 255;
    }
    return rgba;
}

test("ThumbHash encoder matches the reference implementation byte for byte", () => {
    for (const [w, h, alpha, expected] of [
        [100, 75, false, "YMYJLZRwh4d6eHd4d4h3h3ByCIh4"],
        [60, 100, false, "HHYFLAyA53iIh3h4h3eDgAiHdw=="],
        [100, 100, true, "38aFFQoHcId7h4iHeHBwCHh4kwgUR5Wlcw=="],
        [1, 1, false, "HdQ4/0wI9wiIh4hwj3CI+AiIcH/494cP"],
        [37, 9, true, "nkSBCYQHYIiJd3VghwRpt9yImmCW45M="],
    ]) {
        const hash = thumbHashToBase64(rgbaToThumbHash(w, h, pixels(w, h, alpha)));
        assert.equal(hash, expected, `${w}x${h}`);
        // The server accepts standard padded base64 of 4-64 characters.
        assert.match(hash, /^[A-Za-z0-9+/]{4,64}={0,2}$/);
        assert.deepEqual([...base64ToThumbHash(hash)], [...rgbaToThumbHash(w, h, pixels(w, h, alpha))]);
    }
});

test("a solid colour hashes to that average colour and larger inputs are refused", () => {
    const rgba = new Uint8Array(20 * 20 * 4);
    for (let i = 0; i < rgba.length; i += 4) rgba.set([255, 128, 0, 255], i);
    const average = thumbHashToAverageRGBA(rgbaToThumbHash(20, 20, rgba));
    assert.ok(Math.abs(average.r - 1) < 0.03 && Math.abs(average.g - 0.5) < 0.03 && average.b < 0.03 && average.a === 1);
    assert.throws(() => rgbaToThumbHash(101, 10, new Uint8Array(101 * 10 * 4)));
});
