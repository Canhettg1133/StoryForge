import React from 'react';
import { useLocation } from 'react-router-dom';
import './RouteBoundary.css';

class RouteErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidUpdate(previousProps) {
    if (
      this.state.error
      && previousProps.resetKey !== this.props.resetKey
    ) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <section className="route-state route-state--error" role="alert">
        <div className="route-state__panel">
          <h1>Không thể mở màn hình này</h1>
          <p>
            Phiên đang chạy trong nền vẫn được giữ nguyên. Anh có thể thử mở lại riêng màn hình
            này mà không tải lại toàn bộ ứng dụng.
          </p>
          <button type="button" className="btn btn-primary" onClick={() => this.setState({ error: null })}>
            Thử lại màn hình
          </button>
        </div>
      </section>
    );
  }
}

function RouteLoadingState() {
  return (
    <section className="route-state route-state--loading" role="status" aria-live="polite">
      <div className="route-state__skeleton" aria-hidden="true">
        <div className="skeleton route-state__skeleton-title" />
        <div className="skeleton route-state__skeleton-row" />
        <div className="skeleton route-state__skeleton-row" />
        <div className="skeleton route-state__skeleton-row route-state__skeleton-row--short" />
      </div>
      <span className="sr-only">Đang mở màn hình…</span>
    </section>
  );
}

export default function RouteBoundary({ children }) {
  const location = useLocation();
  return (
    <RouteErrorBoundary resetKey={location.key || location.pathname}>
      <React.Suspense fallback={<RouteLoadingState />}>
        {children}
      </React.Suspense>
    </RouteErrorBoundary>
  );
}
