import { Component } from "react";
import { SITE } from "../config/site.js";

/**
 * Catches React render errors so a single broken component doesn't blank
 * the entire embed inside the host page's iframe. Renders a humble fallback
 * with a refresh affordance.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Surface to the console for ops-style debugging via host devtools.
    console.error(`[${SITE.messageNamespace}] render error:`, error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="app">
          <header className="masthead">
            <div className="masthead__title">
              {SITE.titleLead} <em>{SITE.titleEm}</em>
            </div>
          </header>
          <main className="app-main">
            <div className="boundary">
              <h2>Something went sideways.</h2>
              <p>
                The scores widget hit an unexpected error. Try reloading; if
                it keeps happening, let the {SITE.orgName} team know.
              </p>
              <button
                type="button"
                className="boundary__reload"
                onClick={() => window.location.reload()}
              >
                Reload
              </button>
            </div>
          </main>
        </div>
      );
    }
    return this.props.children;
  }
}
