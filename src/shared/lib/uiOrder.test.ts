import { describe, expect, it } from "vitest";
import { DEFAULT_HEADER_BUTTON_ORDER, applyStoredOrder, moveAfter, moveBefore, parseStoredOrder, sameOrder } from "./uiOrder";

describe("uiOrder", () => {
  it("keeps settings as the rightmost header button by default", () => {
    expect(DEFAULT_HEADER_BUTTON_ORDER[DEFAULT_HEADER_BUTTON_ORDER.length - 1]).toBe("settings");
    expect(DEFAULT_HEADER_BUTTON_ORDER.indexOf("chat")).toBe(DEFAULT_HEADER_BUTTON_ORDER.length - 2);
  });

  it("parses stored orders defensively", () => {
    expect(parseStoredOrder(undefined)).toEqual([]);
    expect(parseStoredOrder("")).toEqual([]);
    expect(parseStoredOrder("not json")).toEqual([]);
    expect(parseStoredOrder('{"a":1}')).toEqual([]);
    expect(parseStoredOrder('["b","a","b",3]')).toEqual(["b", "a"]);
  });

  it("drops unknown ids and appends new ones in natural order", () => {
    expect(applyStoredOrder(["a", "b", "c", "d"], ["c", "x", "a"])).toEqual(["c", "a", "b", "d"]);
    expect(applyStoredOrder(["a", "b"], [])).toEqual(["a", "b"]);
  });

  it("moves before / after, keeping hidden ids in place", () => {
    const order = ["pin", "search", "clear", "chat"];
    expect(moveBefore(order, "chat", "pin")).toEqual(["chat", "pin", "search", "clear"]);
    expect(moveBefore(order, "pin", null)).toEqual(["search", "clear", "chat", "pin"]);
    expect(moveAfter(order, "pin", "clear")).toEqual(["search", "clear", "pin", "chat"]);
    expect(moveBefore(order, "pin", "pin")).toEqual(order);
    expect(sameOrder(order, [...order])).toBe(true);
    expect(sameOrder(order, ["pin"])).toBe(false);
  });
});
