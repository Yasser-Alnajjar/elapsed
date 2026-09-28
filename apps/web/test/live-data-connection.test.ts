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
  deriveLiveStatus,
  type EventSourceLike,
} from "../src/lib/live-data-connection";

class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  closed = false;
  private listeners = new Map<string, Set<(event: { data?: string }) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: { data?: string }) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  emit(type: string, data?: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
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

  describe("status", () => {
    it("reports \"reconnecting\" before the SSE transport ever opens — never a fabricated \"connected\"", () => {
      const onStatusChange = vi.fn();
      connectLiveData({
        url: "/api/live",
        onRefresh: vi.fn(),
        onStatusChange,
        createEventSource: (url) => new FakeEventSource(url),
      });

      expect(onStatusChange).toHaveBeenCalledWith("reconnecting");
    });

    it("reports \"connected\" once the transport opens and the server confirms a connected listener", () => {
      const onStatusChange = vi.fn();
      connectLiveData({
        url: "/api/live",
        onRefresh: vi.fn(),
        onStatusChange,
        createEventSource: (url) => new FakeEventSource(url),
      });
      const source = FakeEventSource.instances[0]!;

      source.emit("open");
      source.emit("listener.status", JSON.stringify({ state: "connected" }));

      expect(onStatusChange).toHaveBeenLastCalledWith("connected");
    });

    it("falls back to \"reconnecting\" if the transport opens before any server status has arrived", () => {
      const onStatusChange = vi.fn();
      connectLiveData({
        url: "/api/live",
        onRefresh: vi.fn(),
        onStatusChange,
        createEventSource: (url) => new FakeEventSource(url),
      });
      const source = FakeEventSource.instances[0]!;

      source.emit("open");

      expect(onStatusChange).toHaveBeenLastCalledWith("reconnecting");
    });

    it("reports \"reconnecting\" when the SSE transport drops, even if the server last said \"connected\"", () => {
      const onStatusChange = vi.fn();
      connectLiveData({
        url: "/api/live",
        onRefresh: vi.fn(),
        onStatusChange,
        createEventSource: (url) => new FakeEventSource(url),
      });
      const source = FakeEventSource.instances[0]!;

      source.emit("open");
      source.emit("listener.status", JSON.stringify({ state: "connected" }));
      source.emit("error");

      expect(onStatusChange).toHaveBeenLastCalledWith("reconnecting");
    });

    it("relays a server-reported \"offline\" once the transport is (re)open", () => {
      const onStatusChange = vi.fn();
      connectLiveData({
        url: "/api/live",
        onRefresh: vi.fn(),
        onStatusChange,
        createEventSource: (url) => new FakeEventSource(url),
      });
      const source = FakeEventSource.instances[0]!;

      source.emit("open");
      source.emit("listener.status", JSON.stringify({ state: "offline" }));

      expect(onStatusChange).toHaveBeenLastCalledWith("offline");
    });

    it("recovers to \"connected\" after the transport reopens and the server confirms it", () => {
      const onStatusChange = vi.fn();
      connectLiveData({
        url: "/api/live",
        onRefresh: vi.fn(),
        onStatusChange,
        createEventSource: (url) => new FakeEventSource(url),
      });
      const source = FakeEventSource.instances[0]!;

      source.emit("open");
      source.emit("listener.status", JSON.stringify({ state: "offline" }));
      source.emit("error");
      expect(onStatusChange).toHaveBeenLastCalledWith("reconnecting");

      source.emit("open");
      source.emit("listener.status", JSON.stringify({ state: "connected" }));

      expect(onStatusChange).toHaveBeenLastCalledWith("connected");
    });

    it("ignores a malformed listener.status payload instead of throwing", () => {
      const onStatusChange = vi.fn();
      connectLiveData({
        url: "/api/live",
        onRefresh: vi.fn(),
        onStatusChange,
        createEventSource: (url) => new FakeEventSource(url),
      });
      const source = FakeEventSource.instances[0]!;

      source.emit("open");
      expect(() => source.emit("listener.status", "not-json")).not.toThrow();
      expect(onStatusChange).toHaveBeenLastCalledWith("reconnecting");
    });
  });
});

describe("deriveLiveStatus", () => {
  it("is \"reconnecting\" whenever the SSE transport isn't open, regardless of the last server state", () => {
    expect(deriveLiveStatus(false, "connected")).toBe("reconnecting");
    expect(deriveLiveStatus(false, "offline")).toBe("reconnecting");
    expect(deriveLiveStatus(false, null)).toBe("reconnecting");
  });

  it("is \"reconnecting\" when the transport is open but no server state has arrived yet", () => {
    expect(deriveLiveStatus(true, null)).toBe("reconnecting");
  });

  it("mirrors the server's state once the transport is open", () => {
    expect(deriveLiveStatus(true, "connected")).toBe("connected");
    expect(deriveLiveStatus(true, "offline")).toBe("offline");
    expect(deriveLiveStatus(true, "reconnecting")).toBe("reconnecting");
  });
});
