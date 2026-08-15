import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatCardLabel, parseLastFour } from "./card-last-four";

describe("parseLastFour", () => {
  it("accepts exactly four digits", () => {
    assert.equal(parseLastFour("4242"), "4242");
  });

  it("trims whitespace and ignores separators when the result is four digits", () => {
    assert.equal(parseLastFour(" 42-42 "), "4242");
  });

  it("rejects fewer or more than four digits", () => {
    assert.throws(() => parseLastFour("424"), /exactly 4 digits/i);
    assert.throws(() => parseLastFour("42424"), /exactly 4 digits/i);
    assert.throws(() => parseLastFour("4111111111111111"), /exactly 4 digits/i);
  });

  it("rejects letters", () => {
    assert.throws(() => parseLastFour("abcd"), /exactly 4 digits/i);
  });
});

describe("formatCardLabel", () => {
  it("appends a masked last four when present", () => {
    assert.equal(formatCardLabel("Metrobank", "4242"), "Metrobank •••• 4242");
  });

  it("returns the name alone when last four is missing", () => {
    assert.equal(formatCardLabel("Metrobank", null), "Metrobank");
    assert.equal(formatCardLabel("Metrobank", ""), "Metrobank");
    assert.equal(formatCardLabel("Metrobank"), "Metrobank");
  });
});
