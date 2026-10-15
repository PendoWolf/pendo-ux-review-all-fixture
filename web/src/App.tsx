import { useEffect, useState } from "react";
import { api, ApiError, type AppState } from "./api";

type Action = "load" | "increment" | "decrement" | "reset" | "refresh";
type TrackProps = Record<string, string | number | boolean | undefined>;

// Seam for Pendo. Novus installs the Pendo agent, which provides window.pendo
// at runtime; this fires a "demo-<name>" Track Event for each action (and
// "demo-action-failed" when one fails). No-op when the agent isn't present
// (local dev), so the app and Playwright mocks both stay simple.
function trackEvent(name: Action | "action-failed", props: TrackProps) {
  if (typeof window !== "undefined") {
    try {
      window.pendo?.track?.(`demo-${name}`, props);
    } catch (err) {
      // Analytics must never break the app, or be reported as a failed action.
      console.warn("Pendo track failed", err);
    }
  }
}

// Properties sent with each action's success event. `previous` is the state that
// was on screen when the action started; `next` is the state the API returned.
function successProps(name: Action, previous: AppState, next: AppState, hadError: boolean): TrackProps {
  switch (name) {
    case "load":
      return { counter: next.counter, lastAction: next.lastAction };
    case "increment":
    case "decrement":
      return {
        counter: next.counter,
        previousCounter: previous.counter,
        previousLastAction: previous.lastAction,
      };
    case "reset":
      // The counter is always 0 after a reset, so report what was cleared instead.
      return {
        previousCounter: previous.counter,
        previousLastAction: previous.lastAction,
      };
    case "refresh":
      return {
        counter: next.counter,
        previousCounter: previous.counter,
        lastAction: next.lastAction,
        // The counter is shared server state, so a refresh can pull in other sessions' changes.
        stateChanged: next.counter !== previous.counter || next.lastAction !== previous.lastAction,
        recoveredFromError: hadError,
      };
  }
}

export default function App() {
  const [state, setState] = useState<AppState>({ counter: 0, lastAction: "none" });
  const [error, setError] = useState<string | null>(null);

  const run = async (name: Action, fn: () => Promise<AppState>) => {
    // This render's values, i.e. what was on screen when the action started.
    const previous = state;
    const hadError = error !== null;
    try {
      setError(null);
      const next = await fn();
      setState(next);
      trackEvent(name, successProps(name, previous, next, hadError));
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      trackEvent("action-failed", {
        action: name,
        // Bounded so the payload stays well under Pendo's 512-byte properties limit.
        errorMessage: message.slice(0, 200),
        // Empty for network/CORS failures, where fetch rejects without a response.
        httpStatus: e instanceof ApiError ? e.status : undefined,
      });
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
