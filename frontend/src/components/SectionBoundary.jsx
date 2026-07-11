import { Component } from "react";

/**
 * Per-section error boundary. The global ErrorBoundary (main.jsx) is the
 * last resort that replaces the whole widget; this one fences individual
 * sections — a crash inside the bracket or the head-to-head panel
 * renders a one-line notice while scores, standings, and everything else
 * keep working.
 */
export default class SectionBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error(
      `[wpr-prep-sports] section "${this.props.label ?? "unnamed"}" crashed:`,
      error,
      info,
    );
  }

  render() {
    if (this.state.error) {
      return (
        <div className="section-boundary" role="note">
          This section couldn&apos;t load. The rest of the scoreboard is unaffected.
        </div>
      );
    }
    return this.props.children;
  }
}
