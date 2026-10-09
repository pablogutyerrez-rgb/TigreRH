import {Component, StrictMode, type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  private readonly content: ReactNode;

  constructor(props: { children: ReactNode }) {
    super(props);
    this.content = props.children;
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    console.error('Application render failed:', error);
  }

  render() {
    if (this.state.failed) {
      return <div className="min-h-screen bg-slate-50 p-6 text-slate-700"><p className="font-semibold">No se pudo cargar la plataforma.</p><button type="button" onClick={() => window.location.reload()} className="mt-3 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white">Reintentar</button></div>;
    }
    return this.content;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary><App /></AppErrorBoundary>
  </StrictMode>,
);
