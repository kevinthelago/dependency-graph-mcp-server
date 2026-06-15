import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LifecycleManager } from "../../src/worktree/lifecycle.js";

describe("LifecycleManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls onTeardown after the idle timeout", () => {
    const onTeardown = vi.fn();
    const mgr = new LifecycleManager(onTeardown, { idleTimeoutMs: 5000 });

    mgr.touch("wt-1");
    vi.advanceTimersByTime(5001);

    expect(onTeardown).toHaveBeenCalledWith("wt-1");
    mgr.dispose();
  });

  it("does not call onTeardown before the timeout", () => {
    const onTeardown = vi.fn();
    const mgr = new LifecycleManager(onTeardown, { idleTimeoutMs: 5000 });

    mgr.touch("wt-1");
    vi.advanceTimersByTime(4999);

    expect(onTeardown).not.toHaveBeenCalled();
    mgr.dispose();
  });

  it("resets the timer on touch", () => {
    const onTeardown = vi.fn();
    const mgr = new LifecycleManager(onTeardown, { idleTimeoutMs: 5000 });

    mgr.touch("wt-1");
    vi.advanceTimersByTime(3000);
    mgr.touch("wt-1"); // reset
    vi.advanceTimersByTime(3000); // 6000ms total but only 3000 since last touch

    expect(onTeardown).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2001);
    expect(onTeardown).toHaveBeenCalledWith("wt-1");
    mgr.dispose();
  });

  it("evict triggers teardown immediately", () => {
    const onTeardown = vi.fn();
    const mgr = new LifecycleManager(onTeardown, { idleTimeoutMs: 30000 });

    mgr.touch("wt-2");
    mgr.evict("wt-2");

    expect(onTeardown).toHaveBeenCalledWith("wt-2");
    mgr.dispose();
  });

  it("cancel prevents teardown", () => {
    const onTeardown = vi.fn();
    const mgr = new LifecycleManager(onTeardown, { idleTimeoutMs: 5000 });

    mgr.touch("wt-3");
    mgr.cancel("wt-3");
    vi.advanceTimersByTime(6000);

    expect(onTeardown).not.toHaveBeenCalled();
    mgr.dispose();
  });

  it("manages multiple worktrees independently", () => {
    const onTeardown = vi.fn();
    const mgr = new LifecycleManager(onTeardown, { idleTimeoutMs: 5000 });

    mgr.touch("wt-a");
    mgr.touch("wt-b");
    vi.advanceTimersByTime(5001);

    expect(onTeardown).toHaveBeenCalledWith("wt-a");
    expect(onTeardown).toHaveBeenCalledWith("wt-b");
    expect(onTeardown).toHaveBeenCalledTimes(2);
    mgr.dispose();
  });

  it("dispose clears all timers without triggering teardown", () => {
    const onTeardown = vi.fn();
    const mgr = new LifecycleManager(onTeardown, { idleTimeoutMs: 5000 });

    mgr.touch("wt-x");
    mgr.dispose();
    vi.advanceTimersByTime(6000);

    expect(onTeardown).not.toHaveBeenCalled();
  });

  it("uses default 30-minute timeout when not configured", () => {
    const onTeardown = vi.fn();
    const mgr = new LifecycleManager(onTeardown);

    mgr.touch("wt-default");
    vi.advanceTimersByTime(30 * 60 * 1000 - 1);
    expect(onTeardown).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2);
    expect(onTeardown).toHaveBeenCalledWith("wt-default");
    mgr.dispose();
  });
});
