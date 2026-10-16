import { useEffect, useState } from "react";
import { api, ApiError, type AppState } from "./api";

type CounterAction = "load" | "increment" | "decrement" | "reset" | "refresh";
type TrackProps = Record<string, string | number | boolean | null>;

// Pendo limits a Track Event's properties to 512 bytes of JSON, so cap the one
// unbounded value we send.
const MAX_ERROR_MESSAGE_LENGTH = 200;

// Tracks the initial load once per page load (see the mount effect below).
let initialLoadTracked = false;

// Seam for Pendo. Novus installs the Pendo agent, which provides window.pendo
// at runtime; this fires a Track Event for each action. No-op when the agent
// isn't present (local dev), so the app and Playwright mocks both stay simple.
function trackEvent(name: string, props?: TrackProps) {
  if (typeof window !== "undefined") {
    try {
      window.pendo?.track?.(`demo-${name}`, props);
    } catch {
      // Analytics must never break the counter.
    }
  }
}

// Properties for demo-<action> once the request succeeds. previousCounter is the
// value on screen when the action started. The server counter is shared by all
// visitors, so it can differ from counter by more than one step.
function successProps(action: CounterAction, next: AppState, previousCounter: number): TrackProps {
  switch (action) {
    case "load":
      return { counter: next.counter, lastAction: next.lastAction };
    case "increment":
    case "decrement":
      return { counter: next.counter, previousCounter };
    case "reset":
      return { previousCounter };
    case "refresh":
      return { counter: next.counter, previousCounter, counterChanged: next.counter !== previousCounter };
  }
}

// Properties for demo-action-failed. httpStatus is null when no response came
// back (network or CORS failure).
function failureProps(action: CounterAction, e: unknown): TrackProps {
  const message = e instanceof Error ? e.message : String(e);
  return {
    action,
    errorMessage: message.slice(0, MAX_ERROR_MESSAGE_LENGTH),
    httpStatus: e instanceof ApiError ? e.status : null,
  };
}

export default function App() {
  const [state, setState] = useState<AppState>({ counter: 0, lastAction: "none" });
  const [error, setError] = useState<string | null>(null);

  const run = async (action: CounterAction, fn: () => Promise<AppState>, track = true) => {
    const previousCounter = state.counter;
    try {
      setError(null);
      const next = await fn();
      setState(next);
      if (track) trackEvent(action, successProps(action, next, previousCounter));
    } catch (e) {
      setError((e as Error).message);
      if (track) trackEvent("action-failed", failureProps(action, e));
    }
  };

  useEffect(() => {
    // StrictMode runs this effect twice in development; track only the first
    // run so demo-load counts page loads, not fetches.
    run("load", api.getState, !initialLoadTracked);
    initialLoadTracked = true;
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
