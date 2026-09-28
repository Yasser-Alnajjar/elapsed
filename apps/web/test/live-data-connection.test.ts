/**
 * `connectLiveData` — the coalescing/reconnect-free core of `LiveDataProvider`,
 * extracted so it can be unit-tested without jsdom or a real `EventSource`
 * (this repo has neither as a dependency). Covers: no timer-based refresh
 * exists here at all (only event-triggered coalescing), bursts of events
 * collapse into one refresh, and cleanup closes the source exactly once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectLiveData,
  type EventSourceLike,
} from "../src/lib/live-data-connection";

class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  closed = false;
  private listeners = new Map<string, Set<() => void>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: () => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  emit(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }

  close(): void {
    this.closed = true;
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.instances = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("connectLiveData", () => {
  it("opens exactly one EventSource against the given url", () => {
    connectLiveData({ url: "/api/live", onRefresh: vi.fn(), createEventSource: (url) => new FakeEventSource(url) });

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]!.url).toBe("/api/live");
  });

  it("calls onRefresh after a data.updated event, once the coalescing window elapses", () => {
    const onRefresh = vi.fn();
    connectLiveData({
      url: "/api/live",
      onRefresh,
      coalesceMs: 500,
      createEventSource: (url) => new FakeEventSource(url),
    });
    const source = FakeEventSource.instances[0]!;

    source.emit("data.updated");
    expect(onRefresh).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("coalesces a burst of events within the window into a single refresh", () => {
    const onRefresh = vi.fn();
    connectLiveData({
      url: "/api/live",
      onRefresh,
      coalesceMs: 500,
      createEventSource: (url) => new FakeEventSource(url),
    });
    const source = FakeEventSource.instances[0]!;

    source.emit("data.updated");
    vi.advanceTimersByTime(100);
    source.emit("data.updated");
    vi.advanceTimersByTime(100);
    source.emit("data.updated");
    vi.advanceTimersByTime(500);

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes again for a later, separate burst", () => {
    const onRefresh = vi.fn();
    connectLiveData({
      url: "/api/live",
      onRefresh,
      coalesceMs: 500,
      createEventSource: (url) => new FakeEventSource(url),
    });
    const source = FakeEventSource.instances[0]!;

    source.emit("data.updated");
    vi.advanceTimersByTime(500);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    source.emit("data.updated");
    vi.advanceTimersByTime(500);
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });

  it("never schedules a refresh on its own — only in response to a real event", () => {
    const onRefresh = vi.fn();
    connectLiveData({
      url: "/api/live",
      onRefresh,
      coalesceMs: 500,
      createEventSource: (url) => new FakeEventSource(url),
    });

    vi.advanceTimersByTime(60_000);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("closes the underlying EventSource and cancels a pending coalesce on close()", () => {
    const onRefresh = vi.fn();
    const connection = connectLiveData({
      url: "/api/live",
      onRefresh,
      coalesceMs: 500,
      createEventSource: (url) => new FakeEventSource(url),
    });
    const source = FakeEventSource.instances[0]!;

    source.emit("data.updated");
    connection.close();
    vi.advanceTimersByTime(500);

    expect(source.closed).toBe(true);
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
