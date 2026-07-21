import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createDebouncer } from "./debounce.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createDebouncer", () => {
  it("collapses a burst of triggers into a single call", async () => {
    let calls = 0;
    const trigger = createDebouncer(async () => {
      calls++;
    }, 100);

    trigger();
    trigger();
    trigger();
    expect(calls).toBe(0); // nothing yet — still within the window

    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toBe(1); // three triggers, one run
  });

  it("runs again for a change that arrives after the window", async () => {
    let calls = 0;
    const trigger = createDebouncer(async () => {
      calls++;
    }, 100);

    trigger();
    await vi.advanceTimersByTimeAsync(100);
    trigger();
    await vi.advanceTimersByTimeAsync(100);

    expect(calls).toBe(2);
  });

  it("does not overlap runs: a trigger during a run is served after it", async () => {
    const order: string[] = [];
    let resolveRun: () => void = () => {};
    const trigger = createDebouncer(async () => {
      order.push("start");
      await new Promise<void>((r) => (resolveRun = r));
      order.push("end");
    }, 50);

    trigger();
    await vi.advanceTimersByTimeAsync(50); // first run starts, awaits
    trigger(); // arrives mid-run
    await vi.advanceTimersByTimeAsync(50);
    resolveRun(); // finish first run
    await vi.advanceTimersByTimeAsync(50); // second run scheduled after
    resolveRun();
    await vi.advanceTimersByTimeAsync(0);

    // First run completed before the second started (no interleaving).
    expect(order.slice(0, 2)).toEqual(["start", "end"]);
  });
});

describe("createDebouncer error safety", () => {
  it("does not wedge or reject unhandled when fn throws", async () => {
    const rejections: unknown[] = [];
    const onRej = (e: unknown) => rejections.push(e);
    process.on("unhandledRejection", onRej);

    let calls = 0;
    const trigger = createDebouncer(async () => {
      calls++;
      if (calls === 1) throw new Error("boom");
    }, 50);

    trigger();
    await vi.advanceTimersByTimeAsync(50);
    trigger();
    await vi.advanceTimersByTimeAsync(50);
    await vi.advanceTimersByTimeAsync(0);

    process.off("unhandledRejection", onRej);
    expect(calls).toBe(2); // not wedged after the throw
    expect(rejections).toHaveLength(0); // no unhandled rejection
  });
});
