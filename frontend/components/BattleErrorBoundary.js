import { Component } from 'react';
import logger from '../utils/logger';

/**
 * Error Boundary to catch rendering errors and prevent full page crash
 * in the battle interface
 */
class BattleErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    logger.error('Battle error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-surface-950 flex items-center justify-center p-4">
          <div className="bg-surface-900 border border-surface-700 rounded-2xl p-8 max-w-md text-center">
            <div className="text-danger text-5xl mb-4">!</div>
            <h1 className="text-2xl font-bold text-white mb-2">Something went wrong</h1>
            <p className="text-surface-400 mb-6">
              The battle encountered an unexpected error. Your progress may have been lost.
            </p>
            <div className="space-y-3">
              <button
                onClick={() => window.location.reload()}
                className="w-full px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-lg transition-colors"
              >
                Reload Page
              </button>
              <button
                onClick={() => window.location.href = '/modes'}
                className="w-full px-4 py-2 bg-surface-700 hover:bg-surface-600 text-white rounded-lg transition-colors"
              >
                Return to Modes
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default BattleErrorBoundary;
