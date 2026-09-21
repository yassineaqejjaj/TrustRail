import { describe, expect, it } from "vitest";
import { parseJsonStrict, StrictJsonError } from "../src/http/strictJson.js";

describe("parseJsonStrict", () => {
  it("parses a normal object identically to JSON.parse", () => {
    const text = '{"a":1,"b":[1,2,3],"c":{"d":true,"e":null},"f":"hi\\nthere"}';
    expect(parseJsonStrict(text)).toEqual(JSON.parse(text));
  });

  it("rejects a duplicate top-level key", () => {
    expect(() => parseJsonStrict('{"amount_minor":8000,"amount_minor":1}')).toThrow(StrictJsonError);
  });

  it("rejects a duplicate nested key", () => {
    expect(() => parseJsonStrict('{"arguments":{"amount_minor":1,"amount_minor":2}}')).toThrow(StrictJsonError);
  });

  it("does not falsely flag the same key name at different nesting levels", () => {
    const text = '{"amount_minor":1,"nested":{"amount_minor":2}}';
    expect(parseJsonStrict(text)).toEqual(JSON.parse(text));
  });

  it("allows repeated keys across sibling array elements", () => {
    const text = '{"items":[{"amount_minor":1},{"amount_minor":2}]}';
    expect(parseJsonStrict(text)).toEqual(JSON.parse(text));
  });

  it("rejects trailing garbage", () => {
    expect(() => parseJsonStrict('{"a":1}garbage')).toThrow(StrictJsonError);
  });

  it("rejects malformed JSON", () => {
    expect(() => parseJsonStrict('{"a":}')).toThrow(StrictJsonError);
  });
});
