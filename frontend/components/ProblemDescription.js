// Shared renderer for problem descriptions. Used by battles, challenges and practice.

// Render inline **bold** segments as <strong>, leaving the rest as text
function renderInlineBold(text) {
  if (!text) return text;
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i} className="text-surface-100 font-semibold">{part.slice(2, -2)}</strong>
      : part
  );
}

// Minimal markdown: paragraphs, `code` spans and simple pipe tables.
function renderLine(line, key) {
  const segments = line.split(/(`[^`]+`)/g);
  return (
    <span key={key}>
      {segments.map((segment, i) =>
        segment.startsWith('`') && segment.endsWith('`')
          ? <code key={i} className="rounded bg-surface-800 px-1.5 py-0.5 font-mono text-[0.9em] text-primary-300">{segment.slice(1, -1)}</code>
          : renderInlineBold(segment)
      )}
    </span>
  );
}

function isTableRow(line) {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|');
}

function isTableDivider(line) {
  return /^\|[\s:|-]+\|$/.test(line.trim());
}

function parseRow(line) {
  return line.trim().slice(1, -1).split('|').map(cell => cell.trim());
}

export function ProblemDescription({ description, className = '' }) {
  if (!description) return null;

  const lines = description.split('\n');
  const blocks = [];
  let paragraph = [];
  let table = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'p', lines: paragraph });
      paragraph = [];
    }
  };
  const flushTable = () => {
    if (table) {
      blocks.push(table);
      table = null;
    }
  };

  for (const line of lines) {
    if (isTableRow(line)) {
      flushParagraph();
      if (isTableDivider(line)) continue;
      if (!table) {
        table = { type: 'table', header: parseRow(line), rows: [] };
      } else {
        table.rows.push(parseRow(line));
      }
      continue;
    }
    flushTable();
    if (line.trim() === '') {
      flushParagraph();
    } else {
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushTable();

  return (
    <div className={className}>
      {blocks.map((block, index) =>
        block.type === 'table' ? (
          <div key={index} className="mb-4 overflow-x-auto rounded-lg border border-surface-700">
            <table className="w-full text-sm">
              <thead className="bg-surface-800/60">
                <tr>
                  {block.header.map((cell, i) => (
                    <th key={i} className="px-3 py-2 text-left font-semibold text-surface-200">{renderLine(cell, i)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r} className="border-t border-surface-700/70">
                    {row.map((cell, c) => (
                      <td key={c} className="px-3 py-2 font-mono text-surface-300">{renderLine(cell, c)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p key={index} className="mb-4 whitespace-pre-line leading-relaxed text-surface-300">
            {block.lines.map((line, i) => (
              <span key={i}>
                {renderLine(line, i)}
                {i < block.lines.length - 1 ? '\n' : null}
              </span>
            ))}
          </p>
        )
      )}
    </div>
  );
}

export default ProblemDescription;
