import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, Trophy } from 'lucide-react';

// Syntax-highlighted code renderer with muted, sophisticated colors
const SyntaxCode = ({ code, lang }) => {
  if (!code) return null;

  // Simple syntax highlighting with muted colors
  const highlightLine = (line, idx) => {
    if (lang === 'JavaScript') {
      return highlightJS(line, idx);
    }
    return highlightPython(line, idx);
  };

  const highlightJS = (line, idx) => {
    // Comments
    if (line.trim().startsWith('//')) {
      return <span className="text-surface-500 italic">{line}</span>;
    }

    const parts = [];
    let remaining = line;
    let key = 0;

    // Keywords
    const keywords = /\b(function|const|let|var|for|if|return|new)\b/g;
    // Strings
    const strings = /(['"`])(?:(?!\1).)*\1/g;
    // Numbers
    const numbers = /\b(\d+)\b/g;
    // Methods/properties
    const methods = /\.(\w+)/g;

    // Simple approach: replace tokens inline
    let result = line;
    const tokens = [];

    // Collect keyword positions
    let match;
    while ((match = keywords.exec(line)) !== null) {
      tokens.push({ start: match.index, end: match.index + match[0].length, type: 'keyword', text: match[0] });
    }
    while ((match = strings.exec(line)) !== null) {
      tokens.push({ start: match.index, end: match.index + match[0].length, type: 'string', text: match[0] });
    }
    while ((match = numbers.exec(line)) !== null) {
      tokens.push({ start: match.index, end: match.index + match[0].length, type: 'number', text: match[0] });
    }

    // Sort by position
    tokens.sort((a, b) => a.start - b.start);

    if (tokens.length === 0) {
      return <span className="text-surface-300">{line}</span>;
    }

    const elements = [];
    let lastEnd = 0;
    tokens.forEach((token, i) => {
      if (token.start > lastEnd) {
        elements.push(<span key={`t${i}a`} className="text-surface-300">{line.slice(lastEnd, token.start)}</span>);
      }
      if (token.start >= lastEnd) {
        const colorClass = token.type === 'keyword' ? 'text-primary-400' :
                          token.type === 'string' ? 'text-secondary-300' :
                          token.type === 'number' ? 'text-accent-300' : 'text-surface-300';
        elements.push(<span key={`t${i}b`} className={colorClass}>{token.text}</span>);
        lastEnd = token.end;
      }
    });
    if (lastEnd < line.length) {
      elements.push(<span key="end" className="text-surface-300">{line.slice(lastEnd)}</span>);
    }
    return <>{elements}</>;
  };

  const highlightPython = (line, idx) => {
    // Comments
    if (line.trim().startsWith('#')) {
      return <span className="text-surface-500 italic">{line}</span>;
    }

    const tokens = [];
    let match;

    const keywords = /\b(def|for|in|if|return|import|from|class|while|else|elif|and|or|not)\b/g;
    const strings = /(['"`])(?:(?!\1).)*\1/g;
    const numbers = /\b(\d+)\b/g;

    while ((match = keywords.exec(line)) !== null) {
      tokens.push({ start: match.index, end: match.index + match[0].length, type: 'keyword', text: match[0] });
    }
    while ((match = strings.exec(line)) !== null) {
      tokens.push({ start: match.index, end: match.index + match[0].length, type: 'string', text: match[0] });
    }
    while ((match = numbers.exec(line)) !== null) {
      tokens.push({ start: match.index, end: match.index + match[0].length, type: 'number', text: match[0] });
    }

    tokens.sort((a, b) => a.start - b.start);

    if (tokens.length === 0) {
      return <span className="text-surface-300">{line}</span>;
    }

    const elements = [];
    let lastEnd = 0;
    tokens.forEach((token, i) => {
      if (token.start > lastEnd) {
        elements.push(<span key={`t${i}a`} className="text-surface-300">{line.slice(lastEnd, token.start)}</span>);
      }
      if (token.start >= lastEnd) {
        const colorClass = token.type === 'keyword' ? 'text-primary-400' :
                          token.type === 'string' ? 'text-secondary-300' :
                          token.type === 'number' ? 'text-accent-300' : 'text-surface-300';
        elements.push(<span key={`t${i}b`} className={colorClass}>{token.text}</span>);
        lastEnd = token.end;
      }
    });
    if (lastEnd < line.length) {
      elements.push(<span key="end" className="text-surface-300">{line.slice(lastEnd)}</span>);
    }
    return <>{elements}</>;
  };

  const lines = code.split('\n');
  return (
    <>
      {lines.map((line, idx) => (
        <div key={idx} className="flex">
          <span className="text-surface-600 select-none w-6 text-right mr-4 flex-shrink-0">{idx + 1}</span>
          <span>{highlightLine(line, idx)}</span>
        </div>
      ))}
    </>
  );
};

// Code block for battle visualization
const BattleCodeBlock = ({ code, progress, player, isWinner, lang, username, rating }) => {
  const displayLength = Math.floor((progress / 100) * code.length);
  const displayedCode = code.slice(0, displayLength);
  const fileName = lang === 'JavaScript' ? 'solution.js' : 'solution.py';

  return (
    <motion.div
      className="relative h-full flex flex-col"
      animate={{}}
      transition={{}}
    >
      {/* macOS Window Chrome */}
      <div className="flex items-center gap-1.5 px-4 py-3 border-b border-surface-800">
        <div className="w-3 h-3 rounded-full bg-red-500/70" />
        <div className="w-3 h-3 rounded-full bg-yellow-500/70" />
        <div className="w-3 h-3 rounded-full bg-green-500/70" />
        <span className="ml-3 text-xs text-surface-500 font-mono">{fileName}</span>
      </div>

      {/* Player Info Bar */}
      <div className="bg-surface-800/50 px-4 py-2 flex items-center justify-between border-b border-surface-800/50">
        <div className="flex items-center space-x-2">
          <div className={`w-2 h-2 rounded-full ${player === 1 ? 'bg-primary-400' : 'bg-secondary-400'} ${!isWinner && progress < 100 ? 'animate-pulse' : ''}`} />
          <span className="text-xs font-medium text-surface-200">
            {username}
          </span>
          <span className="text-xs text-surface-500 font-mono">{rating}</span>
        </div>
        <div className="flex items-center space-x-2">
          {isWinner && (
            <motion.span
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 15 }}
              className="text-xs font-bold text-success bg-success/10 px-2 py-0.5 rounded-md flex items-center gap-1 border border-success/20"
            >
              <CheckCircle className="w-3 h-3" /> SOLVED
            </motion.span>
          )}
          {/* Progress bar */}
          <div className="flex items-center gap-2">
            <div className="w-16 h-1.5 bg-surface-800 rounded-full overflow-hidden">
              <motion.div
                className={`h-full rounded-full ${isWinner ? 'bg-success' : player === 1 ? 'bg-primary-500' : 'bg-secondary-500'}`}
                style={{ width: `${Math.round(progress)}%` }}
                transition={{ duration: 0.1 }}
              />
            </div>
            <span className="text-xs text-surface-500 font-mono w-8 text-right">{Math.round(progress)}%</span>
          </div>
        </div>
      </div>

      {/* Code Area */}
      <div className="bg-surface-950 p-4 h-32 md:h-44 overflow-hidden flex-1">
        <pre className="font-mono text-xs leading-relaxed">
          <SyntaxCode code={displayedCode} lang={lang} />
          {progress < 100 && (
            <motion.span
              className="inline-block w-1.5 h-3.5 ml-0.5 bg-primary-400/70 rounded-sm"
              animate={{ opacity: [1, 0] }}
              transition={{ duration: 0.8, repeat: Infinity, ease: 'easeInOut' }}
            />
          )}
        </pre>
      </div>
    </motion.div>
  );
};

// Animated Battle Visualization Component
const BattleVisualization = () => {
  const [player1Progress, setPlayer1Progress] = useState(0);
  const [player2Progress, setPlayer2Progress] = useState(0);
  const [winner, setWinner] = useState(null);
  const [phase, setPhase] = useState('coding'); // 'coding', 'winner', 'reset'
  const timeoutsRef = useRef([]);

  const player1Code = `function twoSum(nums, target) {
  const map = new Map();
  for (let i = 0; i < nums.length; i++) {
    const complement = target - nums[i];
    if (map.has(complement)) {
      return [map.get(complement), i];
    }
    map.set(nums[i], i);
  }
}`;

  const player2Code = `def two_sum(nums, target):
    seen = {}
    for i, num in enumerate(nums):
        comp = target - num
        if comp in seen:
            return [seen[comp], i]
        seen[num] = i
    return []`;

  useEffect(() => {
    const runBattle = () => {
      setPhase('coding');
      setWinner(null);
      setPlayer1Progress(0);
      setPlayer2Progress(0);

      // Randomize who wins
      const p1Speed = 100 + Math.random() * 50;
      const p2Speed = 100 + Math.random() * 50;
      const p1WillWin = p1Speed < p2Speed;

      let p1 = 0, p2 = 0;
      const interval = setInterval(() => {
        p1 = Math.min(p1 + (100 / (p1Speed * 0.6)), 100);
        p2 = Math.min(p2 + (100 / (p2Speed * 0.6)), 100);
        setPlayer1Progress(p1);
        setPlayer2Progress(p2);

        if (p1 >= 100 || p2 >= 100) {
          clearInterval(interval);
          setPhase('winner');
          setWinner(p1 >= 100 && p1WillWin ? 1 : 2);

          // Reset after showing winner
          const winnerTimeout = setTimeout(() => {
            setPhase('reset');
            const resetTimeout = setTimeout(runBattle, 1500);
            timeoutsRef.current.push(resetTimeout);
          }, 3000);
          timeoutsRef.current.push(winnerTimeout);
        }
      }, 60);

      return () => clearInterval(interval);
    };

    const cleanup = runBattle();
    return () => {
      cleanup();
      timeoutsRef.current.forEach(t => clearTimeout(t));
      timeoutsRef.current = [];
    };
  }, []);

  return (
    <div className="relative" style={{ contain: 'layout' }}>
      {/* Outer window container */}
      <div className="rounded-xl border border-surface-800 bg-surface-900 overflow-hidden shadow-2xl shadow-black/20">

        {/* Battle header bar */}
        <div className="bg-surface-800/80 px-4 py-2.5 flex items-center justify-between border-b border-surface-800">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-primary-400 animate-pulse" />
            <span className="text-xs font-medium text-surface-300 tracking-wide uppercase">Live Battle</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-surface-500 font-mono">Two Sum</span>
            <span className="text-xs text-surface-600">|</span>
            <span className="text-xs text-surface-500 font-mono">Medium</span>
          </div>
        </div>

        {/* Two-panel split */}
        <div className="flex flex-col md:flex-row relative">
          {/* Player 1 Editor */}
          <div className="w-full md:w-1/2 border-b md:border-b-0 md:border-r border-surface-800">
            <BattleCodeBlock
              code={player1Code}
              progress={player1Progress}
              player={1}
              isWinner={winner === 1}
              lang="JavaScript"
              username="Alex_Dev"
              rating="1847"
            />
          </div>

          {/* VS Divider - Overlaid on the split */}
          <div className="hidden md:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20">
            <div className="bg-surface-800 border border-surface-700 rounded-full w-10 h-10 flex items-center justify-center shadow-lg">
              <span className="text-xs font-bold text-surface-400 tracking-wider">VS</span>
            </div>
          </div>

          {/* Mobile VS divider */}
          <div className="flex md:hidden items-center justify-center py-1 bg-surface-800/50 border-b border-surface-800">
            <span className="text-xs font-bold text-surface-500 tracking-wider">VS</span>
          </div>

          {/* Player 2 Editor */}
          <div className="w-full md:w-1/2">
            <BattleCodeBlock
              code={player2Code}
              progress={player2Progress}
              player={2}
              isWinner={winner === 2}
              lang="Python"
              username="PyMaster"
              rating="1792"
            />
          </div>
        </div>

        {/* Winner Celebration Bar */}
        <div className="h-9 flex items-center justify-center bg-surface-900 border-t border-surface-800">
          <AnimatePresence>
            {winner && phase === 'winner' ? (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2"
              >
                <Trophy className="w-3.5 h-3.5 text-yellow-500/80" />
                <span className="text-xs font-semibold text-surface-300">
                  {winner === 1 ? 'Alex_Dev' : 'PyMaster'} wins!
                </span>
                <span className="text-xs text-success font-mono">+24 ELO</span>
              </motion.div>
            ) : (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center gap-1.5"
              >
                <div className="w-1 h-1 rounded-full bg-primary-500/50 animate-pulse" />
                <span className="text-xs text-surface-600">Battle in progress...</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

export { BattleCodeBlock, BattleVisualization };
export default BattleVisualization;
