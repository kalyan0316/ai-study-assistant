import { Component } from 'react';

/** Last line of defence: if a render bug slips through, show a recovery screen instead of a blank page. */
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Render error', error, info.componentStack);
  }

  reset = () => {
    try {
      localStorage.removeItem('study-assistant:sessions:v1');
    } catch {
      /* ignore */
    }
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="app">
        <div className="panel error" role="alert" style={{ margin: '2rem auto', maxWidth: 520 }}>
          <p className="panel-title">Something broke on this page</p>
          <p>Reloading usually fixes it. If it keeps happening, clearing saved sets will reset the app.</p>
          <div className="button-row">
            <button className="btn primary" onClick={() => window.location.reload()}>Reload</button>
            <button className="btn ghost" onClick={this.reset}>Clear saved sets &amp; reload</button>
          </div>
        </div>
      </div>
    );
  }
}
