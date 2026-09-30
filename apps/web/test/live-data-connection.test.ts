/**
 * `connectLiveData` — the coalescing/reconnect-free core of `LiveDataProvider`,
 * extracted so it can be unit-tested without jsdom or a real `EventSource`
 * (this repo has neither as a dependency). Covers: no timer-based refresh
 * exists here at all (only event-triggered coalescing), bursts of events
 * collapse into one refresh, and cleanup closes the source exactly once. Also
 * covers recovery: re-creating a permanently closed `EventSource` with bounded
 * backoff, and exactly one catch-up refresh after a successful reconnect.
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
  /** 0 CONNECTING, 1 OPEN, 2 CLOSED — mirrors the real `EventSource`. */
  readyState = 0;
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

  /** The browser giving up for good (e.g. a 401/5xx response): CLOSED, then `error`. */
  failPermanently(): void {
    this.readyState = 2;
    this.emit("error");
  }

  close(): void {
    this.closed = true;
    this.readyState = 2;
  }
}

const fake = (url: string) => new FakeEventSource(url);

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

  describe("recovery", () => {
    const connect = (extra: Partial<Parameters<typeof connectLiveData>[0]> = {}) => {
      const onRefresh = vi.fn();
      const onStatusChange = vi.fn();
      const onTransportChange = vi.fn();
      const connection = connectLiveData({
        url: "/api/live",
        onRefresh,
        onStatusChange,
        onTransportChange,
        coalesceMs: 500,
        reconnectBaseMs: 1_000,
        reconnectMaxMs: 8_000,
        createEventSource: fake,
        ...extra,
      });
      return { connection, onRefresh, onStatusChange, onTransportChange };
    };

    it("does not refresh on the initial successful open", () => {
      const { onRefresh } = connect();
      FakeEventSource.instances[0]!.emit("open");

      vi.advanceTimersByTime(60_000);
      expect(onRefresh).not.toHaveBeenCalled();
      expect(FakeEventSource.instances).toHaveLength(1);
    });

    it("re-creates a permanently closed EventSource after the backoff, closing the old one", () => {
      const { onStatusChange, onTransportChange } = connect();
      const first = FakeEventSource.instances[0]!;
      first.emit("open");

      first.failPermanently();
      expect(first.closed).toBe(true);
      expect(onTransportChange).toHaveBeenLastCalledWith(false);
      expect(onStatusChange).toHaveBeenLastCalledWith("reconnecting");
      expect(FakeEventSource.instances).toHaveLength(1);

      vi.advanceTimersByTime(999);
      expect(FakeEventSource.instances).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(FakeEventSource.instances).toHaveLength(2);
      expect(FakeEventSource.instances[1]!.url).toBe("/api/live");
    });

    it("does not re-create a source the browser is still retrying natively", () => {
      const { onRefresh } = connect();
      const first = FakeEventSource.instances[0]!;
      first.emit("open");

      first.readyState = 0; // network blip: CONNECTING, native retry in flight
      first.emit("error");
      vi.advanceTimersByTime(60_000);

      expect(FakeEventSource.instances).toHaveLength(1);
      expect(first.closed).toBe(false);

      first.readyState = 1;
      first.emit("open"); // native reconnect succeeded
      vi.advanceTimersByTime(500);
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it("backs off exponentially up to the cap while the server stays down, and resets after a successful open", () => {
      connect();
      const delays: number[] = [];
      for (let i = 0; i < 5; i++) {
        const before = FakeEventSource.instances.length;
        FakeEventSource.instances.at(-1)!.failPermanently();
        let waited = 0;
        while (FakeEventSource.instances.length === before) {
          vi.advanceTimersByTime(1_000);
          waited += 1_000;
        }
        delays.push(waited);
      }
      expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 8_000]);

      FakeEventSource.instances.at(-1)!.emit("open");
      const before = FakeEventSource.instances.length;
      FakeEventSource.instances.at(-1)!.failPermanently();
      vi.advanceTimersByTime(1_000);
      expect(FakeEventSource.instances).toHaveLength(before + 1);
    });

    it("triggers exactly one catch-up refresh on a successful reconnect, through the coalescing window", () => {
      const { onRefresh } = connect();
      FakeEventSource.instances[0]!.emit("open");
      FakeEventSource.instances[0]!.failPermanently();
      vi.advanceTimersByTime(1_000);
      const second = FakeEventSource.instances[1]!;

      second.emit("open");
      expect(onRefresh).not.toHaveBeenCalled();
      vi.advanceTimersByTime(500);
      expect(onRefresh).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(60_000);
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it("costs a single refresh when a data.updated lands together with the recovery", () => {
      const { onRefresh } = connect();
      FakeEventSource.instances[0]!.failPermanently();
      vi.advanceTimersByTime(1_000);
      const second = FakeEventSource.instances[1]!;

      second.emit("open");
      second.emit("data.updated");
      vi.advanceTimersByTime(500);

      expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it("catches up only once per interruption, not on every later open", () => {
      const { onRefresh } = connect();
      const first = FakeEventSource.instances[0]!;
      first.emit("open");
      first.emit("error");
      first.emit("open");
      vi.advanceTimersByTime(500);
      expect(onRefresh).toHaveBeenCalledTimes(1);

      first.emit("open"); // spurious duplicate open, no error in between
      vi.advanceTimersByTime(500);
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it("does not start concurrent reconnect loops when errors repeat", () => {
      connect();
      const first = FakeEventSource.instances[0]!;

      first.failPermanently();
      first.emit("error");
      first.emit("error");
      vi.advanceTimersByTime(1_000);
      expect(FakeEventSource.instances).toHaveLength(2);

      vi.advanceTimersByTime(60_000);
      expect(FakeEventSource.instances).toHaveLength(2);
    });

    it("ignores late events and errors from a replaced EventSource", () => {
      const { onRefresh, onTransportChange, onStatusChange } = connect();
      const first = FakeEventSource.instances[0]!;
      first.failPermanently();
      vi.advanceTimersByTime(1_000);
      const second = FakeEventSource.instances[1]!;
      second.emit("open");
      second.emit("listener.status", JSON.stringify({ state: "connected" }));
      vi.advanceTimersByTime(500);
      onRefresh.mockClear();
      onTransportChange.mockClear();
      onStatusChange.mockClear();

      first.emit("data.updated");
      first.emit("error");
      first.emit("open");
      first.emit("listener.status", JSON.stringify({ state: "offline" }));
      vi.advanceTimersByTime(60_000);

      expect(onRefresh).not.toHaveBeenCalled();
      expect(onTransportChange).not.toHaveBeenCalled();
      expect(onStatusChange).not.toHaveBeenCalled();
      expect(FakeEventSource.instances).toHaveLength(2);
    });

    it("close() cancels a pending reconnect so no further EventSource is ever created", () => {
      const { connection } = connect();
      FakeEventSource.instances[0]!.failPermanently();

      connection.close();
      vi.advanceTimersByTime(120_000);

      expect(FakeEventSource.instances).toHaveLength(1);
    });

    it("close() also cancels a pending catch-up refresh and silences the open source", () => {
      const { connection, onRefresh } = connect();
      const first = FakeEventSource.instances[0]!;
      first.emit("error");
      first.emit("open");

      connection.close();
      vi.advanceTimersByTime(60_000);

      expect(first.closed).toBe(true);
      expect(onRefresh).not.toHaveBeenCalled();
    });
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
