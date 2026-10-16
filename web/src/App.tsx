import { useEffect, useState } from "react";
import { api, ApiError, type AppState } from "./api";

type Action = "load" | "increment" | "decrement" | "reset" | "refresh";

// Pendo Track Event names. Each must match its track type in Pendo exactly,
// and web/tests/app.spec.ts asserts on some of them, so don't rename them.
const TRACK_EVENTS = {
  load: "demo-load",
  increment: "demo-increment",
  decrement: "demo-decrement",
  reset: "demo-reset",
  refresh: "demo-refresh",
  actionFailed: "demo-action-failed",
} as const;

type TrackEventName = (typeof TRACK_EVENTS)[keyof typeof TRACK_EVENTS];

// Seam for Pendo. Novus installs the Pendo agent, which provides window.pendo
// at runtime; this fires a Track Event for each action. No-op when the agent
// isn't present (local dev), so the app and Playwright mocks both stay simple.
function trackEvent(name: TrackEventName, props?: Record<string, unknown>) {
  if (typeof window !== "undefined") {
    try {
      window.pendo?.track?.(name, props);
    } catch (err) {
      // Never let analytics break the app or turn a successful action into an error.
      console.warn(`Pendo track failed: ${name}`, err);
    }
  }
}

// Metadata for each action's success event. `previous` is the state the user
// saw when they acted; `next` is the server-confirmed state.
function successProps(action: Action, previous: AppState, next: AppState): Record<string, unknown> {
  switch (action) {
    case "load":
      return { counter: next.counter, lastAction: next.lastAction };
    case "increment":
    case "decrement":
      return { counter: next.counter, previousCounter: previous.counter };
    case "reset":
      // The counter is always 0 afterwards, so record what was wiped.
      return { previousCounter: previous.counter, previousLastAction: previous.lastAction };
    case "refresh":
      return {
        counter: next.counter,
        previousCounter: previous.counter,
        // The counter is shared by all visitors: true means the user was looking at stale data.
        counterChanged: next.counter !== previous.counter,
        lastAction: next.lastAction,
      };
  }
}

// Metadata for demo-action-failed. errorName tells the failure sources apart:
// ApiError (non-2xx response), TypeError (API unreachable or blocked by CORS)
// and SyntaxError (response wasn't JSON).
function failureProps(action: Action, e: unknown): Record<string, unknown> {
  const err = e instanceof Error ? e : new Error(String(e));
  return {
    action,
    errorName: err.name,
    errorMessage: err.message.slice(0, 100),
    // Only non-2xx responses have a status; undefined is dropped from the payload.
    httpStatus: err instanceof ApiError ? err.status : undefined,
  };
}

// React StrictMode runs mount effects twice in development, which would report
// the initial load twice. Module-level (not component state) so the guard
// survives that remount and the load is reported once per page load.
let initialLoadTracked = false;

export default function App() {
  const [state, setState] = useState<AppState>({ counter: 0, lastAction: "none" });
  const [error, setError] = useState<string | null>(null);

  const run = async (action: Action, fn: () => Promise<AppState>) => {
    // The state the user saw when they acted, for the events' "previous" fields.
    const previous = state;
    // Report the initial load once per page load (see initialLoadTracked).
    const shouldTrack = action !== "load" || !initialLoadTracked;
    if (action === "load") initialLoadTracked = true;
    try {
      setError(null);
      const next = await fn();
      setState(next);
      if (shouldTrack) trackEvent(TRACK_EVENTS[action], successProps(action, previous, next));
    } catch (e) {
      setError((e as Error).message);
      if (shouldTrack) trackEvent(TRACK_EVENTS.actionFailed, failureProps(action, e));
    }
  };

  useEffect(() => {
    run("load", api.getState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 480, margin: "4rem auto", textAlign: "center" }}>
      <h1>QAWolf Demo</h1>

      <p data-testid="counter-value" style={{ fontSize: "3rem", margin: "1rem 0" }}>
        {state.counter}
      </p>
      <p data-testid="last-action" style={{ color: "#666" }}>
        Last action: {state.lastAction}
      </p>

      <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
        <button data-testid="btn-increment" onClick={() => run("increment", api.increment)}>
          Increment
        </button>
        <button data-testid="btn-decrement" onClick={() => run("decrement", api.decrement)}>
          Decrement
        </button>
        <button data-testid="btn-reset" onClick={() => run("reset", api.reset)}>
          Reset
        </button>
        <button data-testid="btn-refresh" onClick={() => run("refresh", api.getState)}>
          Refresh
        </button>
      </div>

      {error && (
        <p data-testid="error" style={{ color: "crimson", marginTop: 16 }}>
          {error}
        </p>
      )}
    </main>
  );
}
