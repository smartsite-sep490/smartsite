import React from 'react';
import { translate as tr, uiLanguage } from './i18n/runtime';

export interface PageLoadingFallbackProps {
  label?: string;
  onSignOut?: () => void;
}

/**
 * Accessible status loading indicator for Suspense boundaries.
 */
export function PageLoadingFallback({ label, onSignOut }: PageLoadingFallbackProps) {
  const resolvedLabel = label ?? tr('common.loading');
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex h-96 w-full items-center justify-center p-6 text-center"
    >
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 rounded-full border-2 border-[#0F172A] border-t-transparent animate-spin" />
        <span className="text-xs font-medium text-slate-500">{resolvedLabel}</span>
        {onSignOut && (
          <button
            type="button"
            onClick={onSignOut}
            className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer shadow-xs"
          >
            {tr('shell.signOut')}
          </button>
        )}
      </div>
    </div>
  );
}

function routeErrorCopy(fallbackTitle?: string) {
  if (uiLanguage() === 'vi') {
    return {
      title: fallbackTitle || tr('common.request_failed'),
      description: tr('errors.unexpected'),
      reloadLabel: tr('common.refresh'),
    };
  }
  return {
    title: fallbackTitle || 'Unable to load page',
    description:
      'This screen could not be loaded. Reload this page, or use navigation to choose another view.',
    reloadLabel: 'Reload Page',
  };
}

/**
 * Safe Error Boundary for dynamic chunk and route load failures.
 * Provides a page reload action without dumping raw errors or authentication tokens.
 */
export interface RouteErrorBoundaryProps {
  children: React.ReactNode;
  fallbackTitle?: string;
  onSignOut?: () => void;
}

interface RouteErrorBoundaryState {
  hasError: boolean;
}

export class RouteErrorBoundary extends React.Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  constructor(props: RouteErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): RouteErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch() {
    // Chunk load error caught safely without leaking tokens or sensitive state
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      const copy = routeErrorCopy(this.props.fallbackTitle);
      return (
        <div
          role="alert"
          aria-live="assertive"
          className="mx-auto max-w-lg my-8 rounded-2xl border border-slate-200/80 bg-white p-7 text-center shadow-sm"
        >
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 mx-auto flex items-center justify-center mb-3">
            <span className="text-base font-bold">!</span>
          </div>
          <h2 className="text-lg font-bold text-slate-900">{copy.title}</h2>
          <p className="mt-2 text-xs text-slate-500 leading-relaxed max-w-md mx-auto">
            {copy.description}
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <button
              type="button"
              onClick={this.handleReload}
              className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer shadow-xs"
            >
              {copy.reloadLabel}
            </button>
            {this.props.onSignOut && (
              <button
                type="button"
                onClick={this.props.onSignOut}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer shadow-xs"
              >
                {tr('shell.signOut')}
              </button>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
