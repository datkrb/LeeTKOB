// C++ comment and student-identity stripper for LeeTKOB model prompts.
// Preserves exact 1-based line numbers so model evidence maps 1-to-1 to the original source.

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * Escapes special regex characters in a literal string.
 * @param {string} s
 * @returns {string}
 */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Redacts emails and known student identity markers inside a single-line or multi-line literal
 * without changing newline count.
 * @param {string} segment
 * @param {{ studentName?: string, studentId?: string }} [identity]
 * @returns {string}
 */
function redactIdentityInLiteral(segment, identity) {
  let out = segment.replace(EMAIL_RE, '[REDACTED]');
  const markers = [identity?.studentName, identity?.studentId]
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter((v) => v.length >= 2 && !v.includes('\n') && !v.includes('\r'));

  for (const marker of markers) {
    const re = new RegExp(escapeRegExp(marker), 'gi');
    out = out.replace(re, '[REDACTED]');
  }
  return out;
}

/**
 * Strips C++ line/block comments and scrubs student identity while keeping exact line numbers.
 * @param {string} code
 * @param {{ studentName?: string, studentId?: string }} [identity]
 * @returns {{ strippedCode: string, originalLines: string[], strippedLines: string[] }}
 */
export function stripCppForModel(code, identity) {
  const normalized = String(code ?? '').replace(/\r\n?/g, '\n');
  const originalLines = normalized.split('\n');
  const n = normalized.length;
  let out = '';
  let i = 0;

  while (i < n) {
    const ch = normalized[i];

    // Line comment: drop text until unescaped newline, keep every newline
    if (ch === '/' && normalized[i + 1] === '/') {
      i += 2;
      while (i < n && normalized[i] !== '\n') {
        if (normalized[i] === '\\' && normalized[i + 1] === '\n') {
          out += '\n';
          i += 2;
        } else {
          i++;
        }
      }
      continue;
    }

    // Block comment: replace with a single space (to avoid token pasting) plus any newlines inside
    if (ch === '/' && normalized[i + 1] === '*') {
      const prevChar = out.length > 0 ? out[out.length - 1] : '';
      i += 2;
      let newlines = 0;
      while (i < n && !(normalized[i] === '*' && normalized[i + 1] === '/')) {
        if (normalized[i] === '\n') newlines++;
        i++;
      }
      if (i < n) i += 2;
      if (newlines > 0) {
        out += '\n'.repeat(newlines);
      } else if (/[A-Za-z0-9_]/.test(prevChar) && /[A-Za-z0-9_]/.test(normalized[i] ?? '')) {
        out += ' ';
      }
      continue;
    }

    // Raw string literal: R"delim(...)delim" (with optional encoding prefix)
    if (
      (ch === 'R' && normalized[i + 1] === '"') ||
      ((ch === 'u' || ch === 'U' || ch === 'L') &&
        normalized[i + 1] === 'R' &&
        normalized[i + 2] === '"') ||
      (normalized.slice(i, i + 3) === 'u8R' && normalized[i + 3] === '"')
    ) {
      const qIdx = normalized.indexOf('"', i);
      const parenIdx = normalized.indexOf('(', qIdx + 1);
      if (parenIdx !== -1 && parenIdx - qIdx - 1 <= 16) {
        const delim = normalized.slice(qIdx + 1, parenIdx);
        const endMarker = `)${delim}"`;
        const endIdx = normalized.indexOf(endMarker, parenIdx + 1);
        if (endIdx !== -1) {
          const rawPrefix = normalized.slice(i, parenIdx + 1);
          const rawBody = normalized.slice(parenIdx + 1, endIdx);
          out += rawPrefix + redactIdentityInLiteral(rawBody, identity) + endMarker;
          i = endIdx + endMarker.length;
          continue;
        }
      }
    }

    // Regular string or character literal
    if (
      ch === '"' ||
      ch === "'" ||
      ((ch === 'u' || ch === 'U' || ch === 'L') &&
        (normalized[i + 1] === '"' || normalized[i + 1] === "'")) ||
      (normalized.slice(i, i + 2) === 'u8' &&
        (normalized[i + 2] === '"' || normalized[i + 2] === "'"))
    ) {
      const quote =
        ch === '"' || ch === "'"
          ? ch
          : normalized[i + 1] === '"' || normalized[i + 1] === "'"
            ? normalized[i + 1]
            : normalized[i + 2];
      const startQuote = normalized.indexOf(quote, i);
      const prefix = normalized.slice(i, startQuote + 1);
      i = startQuote + 1;
      let body = '';
      while (i < n && normalized[i] !== quote && normalized[i] !== '\n') {
        if (normalized[i] === '\\' && i + 1 < n) {
          body += normalized[i] + normalized[i + 1];
          i += 2;
        } else {
          body += normalized[i];
          i++;
        }
      }
      const closing = i < n && normalized[i] === quote ? normalized[i++] : '';
      out += prefix + redactIdentityInLiteral(body, identity) + closing;
      continue;
    }

    out += ch;
    i++;
  }

  const strippedLines = out.split('\n').map((line) => line.replace(/[ \t]+$/g, ''));
  return {
    strippedCode: strippedLines.join('\n'),
    originalLines,
    strippedLines,
  };
}

/**
 * Formats stripped C++ lines with 1-based line numbers for the model prompt.
 * @param {string} strippedCode
 * @returns {string}
 */
export function formatNumberedCode(strippedCode) {
  const lines = String(strippedCode ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const width = String(lines.length).length;
  return lines.map((text, idx) => `${String(idx + 1).padStart(width, ' ')}: ${text}`).join('\n');
}

/**
 * Maps 1-based evidence entries back to the trimmed original source lines.
 * @param {Array<{ line: number, text: string }>} evidence
 * @param {string[]} originalLines
 * @returns {Array<{ line: number, text: string }>}
 */
export function mapEvidenceToOriginal(evidence, originalLines) {
  return evidence.map((entry) => ({
    line: entry.line,
    text: (originalLines[entry.line - 1] ?? '').trim(),
  }));
}
