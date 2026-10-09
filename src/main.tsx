import {Component, StrictMode, type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean; message: string }> {
  state = { failed: false, message: '' };
  private readonly content: ReactNode;

  constructor(props: { children: ReactNode }) {
    super(props);
    this.content = props.children;
  }

  static getDerivedStateFromError(error: Error) {
    return { failed: true, message: error.message || 'Error de renderizado no identificado.' };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    console.error('Application render failed:', error);
    void fetch('/api/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        message: error.message || 'Error de renderizado no identificado.',
        stack: `${error.stack || ''}\n${info.componentStack || ''}`,
        path: window.location.pathname,
      }),
    }).catch(() => undefined);
  }

  render() {
    if (this.state.failed) {
      return <div className="min-h-screen bg-slate-50 p-6 text-slate-700"><p className="font-semibold">No se pudo cargar la plataforma.</p><p className="mt-2 text-sm">Diagnóstico: {this.state.message}</p><button type="button" onClick={() => window.location.reload()} className="mt-3 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white">Reintentar</button></div>;
    }
    return this.content;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary><App /></AppErrorBoundary>
  </StrictMode>,
);
