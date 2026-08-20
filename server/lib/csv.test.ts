import { describe, it, expect } from "vitest";
import { parseCsv } from "./csv.js";

describe("parseCsv", () => {
  it("parses a simple CSV", () => {
    const result = parseCsv("a,b,c\n1,2,3");
    expect(result).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
  });

  it("handles quoted fields with commas", () => {
    const result = parseCsv('name,value\n"hello, world",42');
    expect(result).toEqual([["name", "value"], ["hello, world", "42"]]);
  });

  it("handles empty input", () => {
    const result = parseCsv("");
    expect(result).toEqual([]);
  });

  it("handles single row", () => {
    const result = parseCsv("a,b,c");
    expect(result).toEqual([["a", "b", "c"]]);
  });

  it("handles quoted fields with newlines", () => {
    const result = parseCsv('name,body\n"test","line1\nline2"');
    expect(result).toEqual([["name", "body"], ["test", "line1\nline2"]]);
  });

  it("handles multiple rows", () => {
    const result = parseCsv("h1,h2\na,b\nc,d");
    expect(result).toHaveLength(3);
  });
});
