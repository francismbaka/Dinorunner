"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface CaughtError {
  message: string;
  stack?: string;
  source: "render" | "window" | "promise";
}

interface State {
  error: CaughtError | null;
}

function ErrorScreen({ error, onDismiss }: { error: CaughtError; onDismiss: () => void }) {
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 999999,
        background: "#1a0000",
        color: "#fff",
        fontFamily: "monospace",
        padding: 16,
        overflow: "auto",
        boxSizing: "border-box",
      }}
    >
      <div style={{ fontSize: 18, fontWeight: 800, color: "#FF6B6B", marginBottom: 8 }}>
        ⚠️ Game crashed
      </div>
      <div style={{ fontSize: 13, color: "#FFD700", marginBottom: 12 }}>
        Source: {error.source}
      </div>
      <div style={{ fontSize: 13, whiteSpace: "pre-wrap", wordBreak: "break-word", marginBottom: 16 }}>
        {error.message}
      </div>
      {error.stack && (
        <pre style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {error.stack}
        </pre>
      )}
      <button
        onClick={onDismiss}
        style={{
          marginTop: 16,
          background: "#1E88E5",
          border: "none",
          borderRadius: 8,
          color: "#fff",
          padding: "10px 20px",
          fontSize: 14,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        🔄 Reload
      </button>
    </div>
  );
}

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(err: unknown): State {
    return {
      error: {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        source: "render",
      },
    };
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught render error:", err, info);
  }

  componentDidMount() {
    window.addEventListener("error", this.handleWindowError);
    window.addEventListener("unhandledrejection", this.handleRejection);
  }

  componentWillUnmount() {
    window.removeEventListener("error", this.handleWindowError);
    window.removeEventListener("unhandledrejection", this.handleRejection);
  }

  handleWindowError = (event: ErrorEvent) => {
    const err = event.error;
    this.setState({
      error: {
        message: err instanceof Error ? err.message : event.message || "Unknown error",
        stack: err instanceof Error ? err.stack : undefined,
        source: "window",
      },
    });
  };

  handleRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    this.setState({
      error: {
        message: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
        source: "promise",
      },
    });
  };

  handleDismiss = () => {
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return <ErrorScreen error={this.state.error} onDismiss={this.handleDismiss} />;
    }
    return this.props.children;
  }
}
