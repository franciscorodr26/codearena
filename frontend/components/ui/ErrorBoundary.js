import React from 'react';
import * as Sentry from '@sentry/nextjs';
import { AlertTriangle, RefreshCw, Home, ChevronDown, ChevronUp } from 'lucide-react';

/**
 * ErrorBoundary - Catches JavaScript errors in child components
 *
 * Displays a user-friendly error UI instead of crashing the entire app.
 * Must be a class component as React doesn't support error boundaries with hooks.
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });

    // Log error to console in development
    if (process.env.NODE_ENV === 'development') {
      console.error('ErrorBoundary caught an error:', error, errorInfo);
    }

    // Report to Sentry in production
    Sentry.captureException(error, {
      extra: {
        componentStack: errorInfo?.componentStack
      }
    });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, showDetails: false });
  };

  handleGoHome = () => {
    window.location.href = '/';
  };

  toggleDetails = () => {
    this.setState(prev => ({ showDetails: !prev.showDetails }));
  };

  render() {
    if (this.state.hasError) {
      const { error, errorInfo, showDetails } = this.state;
      const isDev = process.env.NODE_ENV === 'development';

      return (
        <div className="min-h-screen bg-surface-950 text-white flex items-center justify-center p-6">
          <div className="max-w-lg w-full text-center">
            {/* Error Icon */}
            <div className="w-20 h-20 bg-error/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <AlertTriangle className="w-10 h-10 text-error" />
            </div>

            {/* Error Message */}
            <h1 className="text-2xl font-bold mb-3">Something went wrong</h1>
            <p className="text-surface-400 mb-8">
              We encountered an unexpected error. Don't worry, your progress is safe.
              Try refreshing the page or return to the home page.
            </p>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
              <button
                onClick={this.handleRetry}
                className="inline-flex items-center justify-center px-6 py-3 font-semibold rounded-xl bg-gradient-to-r from-primary-500 to-primary-600 text-white hover:from-primary-400 hover:to-primary-500 transition-all duration-200"
              >
                <RefreshCw className="w-5 h-5 mr-2" />
                Try Again
              </button>
              <button
                onClick={this.handleGoHome}
                className="inline-flex items-center justify-center px-6 py-3 font-semibold rounded-xl bg-transparent border border-surface-600 text-surface-300 hover:bg-surface-800 hover:text-white hover:border-surface-500 transition-all duration-200"
              >
                <Home className="w-5 h-5 mr-2" />
                Go Home
              </button>
            </div>

            {/* Error Details (Dev Mode) */}
            {isDev && error && (
              <div className="text-left">
                <button
                  onClick={this.toggleDetails}
                  className="flex items-center justify-center w-full text-surface-400 hover:text-surface-300 text-sm mb-3"
                >
                  {showDetails ? (
                    <>
                      <ChevronUp className="w-4 h-4 mr-1" />
                      Hide Error Details
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-4 h-4 mr-1" />
                      Show Error Details
                    </>
                  )}
                </button>

                {showDetails && (
                  <div className="bg-surface-900 border border-surface-700 rounded-lg p-4 text-sm overflow-auto max-h-64">
                    <p className="text-error font-mono mb-2">
                      {error.toString()}
                    </p>
                    {errorInfo?.componentStack && (
                      <pre className="text-surface-400 font-mono text-xs whitespace-pre-wrap">
                        {errorInfo.componentStack}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Support Link */}
            <p className="text-surface-500 text-sm mt-6">
              If this keeps happening, contact{' '}
              <a
                href="mailto:support@codearena.co"
                className="text-primary-400 hover:text-primary-300"
              >
                support@codearena.co
              </a>
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
