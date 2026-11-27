// Syntax-aware C++ ban-list checker for LeeTKOB hard rules.
// Constraints starting with "Do not use" or "Do not call" list banned names in backticks.

const HARD_RULE_PREFIX = /^Do not (?:use|call)\b/i;
const IDENT_RE = /[A-Za-z_][A-Za-z0-9_]*/;
const KEYWORDS = new Set(['for', 'while', 'do', 'goto']);
const MEMBER_ONLY = new Set(['rbegin', 'rend', 'crbegin', 'crend']);

/**
 * Returns true if the constraint is a ban-list hard rule.
 * @param {string} text
 * @returns {boolean}
 */
export function isHardRule(text) {
  return HARD_RULE_PREFIX.test(String(text ?? '').trim());
}

/**
 * Extracts backticked banned identifiers/qualified names from a hard-rule constraint.
 * @param {string} text
 * @returns {string[]}
 */
export function extractBannedNames(text) {
  const names = [];
  const re = /`([^`]+)`/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const item = m[1].trim();
    if (item) names.push(item);
  }
  return names;
}

/**
 * @typedef {{ type: 'ident' | 'punct', value: string, line: number }} Token
 */

/**
 * Tokenizes C++ source code while stripping comments, string/char literals, and #include lines.
 * Preserves #define macro bodies so macro aliases (e.g. #define S std::sort) are still visible.
 * @param {string} code
 * @returns {Token[]}
 */
export function tokenizeCpp(code) {
  /** @type {Token[]} */
  const tokens = [];
  const n = code.length;
  let i = 0;
  let line = 1;
  let atLineStart = true;

  const advance = (count = 1) => {
    for (let k = 0; k < count && i < n; k++) {
      if (code[i] === '\n') line++;
      i++;
    }
  };

  while (i < n) {
    const ch = code[i];

    if (ch === '\n') {
      line++;
      i++;
      atLineStart = true;
      continue;
    }

    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\f' || ch === '\v') {
      i++;
      continue;
    }

    // Line comment
    if (ch === '/' && code[i + 1] === '/') {
      while (i < n && code[i] !== '\n') {
        if (code[i] === '\\' && code[i + 1] === '\n') {
          advance(2);
        } else if (code[i] === '\\' && code[i + 1] === '\r' && code[i + 2] === '\n') {
          advance(3);
        } else {
          i++;
        }
      }
      continue;
    }

    // Block comment
    if (ch === '/' && code[i + 1] === '*') {
      advance(2);
      while (i < n && !(code[i] === '*' && code[i + 1] === '/')) {
        advance(1);
      }
      if (i < n) advance(2);
      continue;
    }

    // Preprocessor directives: skip #include, #pragma, #if, etc.; keep #define body
    if (atLineStart && ch === '#') {
      atLineStart = false;
      i++;
      while (i < n && (code[i] === ' ' || code[i] === '\t')) i++;
      let dir = '';
      while (i < n && /[A-Za-z_]/.test(code[i])) {
        dir += code[i];
        i++;
      }
      if (dir === 'define') {
        // Skip macro name and optional parameter list? No, keep body tokens on this line.
        continue;
      }
      while (i < n && code[i] !== '\n') {
        if (code[i] === '\\' && (code[i + 1] === '\n' || code[i + 1] === '\r')) {
          advance(code[i + 1] === '\r' && code[i + 2] === '\n' ? 3 : 2);
        } else {
          i++;
        }
      }
      continue;
    }

    atLineStart = false;

    // Raw string literal: R"delim(...)delim" (with optional encoding prefix)
    if (
      (ch === 'R' && code[i + 1] === '"') ||
      ((ch === 'u' || ch === 'U' || ch === 'L') && code[i + 1] === 'R' && code[i + 2] === '"') ||
      (code.slice(i, i + 3) === 'u8R' && code[i + 3] === '"')
    ) {
      const qIdx = code.indexOf('"', i);
      const parenIdx = code.indexOf('(', qIdx + 1);
      if (parenIdx !== -1 && parenIdx - qIdx - 1 <= 16) {
        const delim = code.slice(qIdx + 1, parenIdx);
        const endMarker = `)${delim}"`;
        const endIdx = code.indexOf(endMarker, parenIdx + 1);
        if (endIdx !== -1) {
          advance(endIdx + endMarker.length - i);
          continue;
        }
      }
    }

    // Regular string or char literal (with optional u/U/L/u8 prefix)
    if (
      ch === '"' ||
      ch === "'" ||
      ((ch === 'u' || ch === 'U' || ch === 'L') && (code[i + 1] === '"' || code[i + 1] === "'")) ||
      (code.slice(i, i + 2) === 'u8' && (code[i + 2] === '"' || code[i + 2] === "'"))
    ) {
      const quote =
        ch === '"' || ch === "'"
          ? ch
          : code[i + 1] === '"' || code[i + 1] === "'"
            ? code[i + 1]
            : code[i + 2];
      const startQuote = code.indexOf(quote, i);
      advance(startQuote - i + 1);
      while (i < n && code[i] !== quote) {
        if (code[i] === '\\') {
          advance(2);
        } else {
          advance(1);
        }
      }
      if (i < n) advance(1);
      continue;
    }

    // Identifier or keyword
    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      while (i < n && /[A-Za-z0-9_]/.test(code[i])) i++;
      tokens.push({ type: 'ident', value: code.slice(start, i), line });
      continue;
    }

    // Two-char punctuators we care about
    const two = code.slice(i, i + 2);
    if (two === '::' || two === '->') {
      tokens.push({ type: 'punct', value: two, line });
      i += 2;
      continue;
    }

    // Numbers: skip digits/dots/suffixes as single opaque unit so 1e5 etc. don't split
    if (/[0-9]/.test(ch)) {
      while (i < n && /[0-9A-Za-z_.']/.test(code[i])) i++;
      continue;
    }

    tokens.push({ type: 'punct', value: ch, line });
    i++;
  }

  return tokens;
}

/**
 * Analyzes tokens for namespace aliases, `using namespace std;`, `using std::X;`,
 * and user-defined functions/types/macros so user-defined identifiers do not false-positive.
 * @param {Token[]} tokens
 */
function analyzeContext(tokens) {
  let hasUsingNamespaceStd = false;
  let hasUsingNamespaceRanges = false;
  /** @type {Set<string>} */
  const usingStdNames = new Set();
  /** @type {Map<string, string[]>} */
  const namespaceAliases = new Map();
  /** @type {Set<string>} */
  const userDefinedNames = new Set();

  for (let idx = 0; idx < tokens.length; idx++) {
    const t = tokens[idx];

    // `using namespace std;` or `using namespace std::ranges;`
    if (
      t.value === 'using' &&
      tokens[idx + 1]?.value === 'namespace' &&
      tokens[idx + 2]?.value === 'std'
    ) {
      if (tokens[idx + 3]?.value === ';') {
        hasUsingNamespaceStd = true;
      } else if (
        tokens[idx + 3]?.value === '::' &&
        tokens[idx + 4]?.value === 'ranges' &&
        tokens[idx + 5]?.value === ';'
      ) {
        hasUsingNamespaceRanges = true;
      }
      continue;
    }

    // `using std::sort;` or `using std::ranges::sort;`
    if (
      t.value === 'using' &&
      tokens[idx + 1]?.value === 'std' &&
      tokens[idx + 2]?.value === '::'
    ) {
      if (
        tokens[idx + 3]?.value === 'ranges' &&
        tokens[idx + 4]?.value === '::' &&
        tokens[idx + 5]?.type === 'ident'
      ) {
        usingStdNames.add(`std::ranges::${tokens[idx + 5].value}`);
        usingStdNames.add(tokens[idx + 5].value);
      } else if (tokens[idx + 3]?.type === 'ident' && tokens[idx + 4]?.value === ';') {
        usingStdNames.add(`std::${tokens[idx + 3].value}`);
        usingStdNames.add(tokens[idx + 3].value);
      }
      continue;
    }

    // `namespace r = std::ranges;` or `namespace s = std;`
    if (
      t.value === 'namespace' &&
      tokens[idx + 1]?.type === 'ident' &&
      tokens[idx + 2]?.value === '='
    ) {
      const alias = tokens[idx + 1].value;
      const parts = [];
      let j = idx + 3;
      if (tokens[j]?.value === '::') j++;
      while (j < tokens.length && tokens[j].value !== ';') {
        if (tokens[j].type === 'ident') parts.push(tokens[j].value);
        j++;
      }
      if (parts.length > 0) namespaceAliases.set(alias, parts);
      continue;
    }

    // Detect user-defined struct/class/enum/function declarations:
    // e.g. `struct vector {`, `void sort(`, `int find(`
    if (
      (t.value === 'struct' || t.value === 'class' || t.value === 'enum') &&
      tokens[idx + 1]?.type === 'ident'
    ) {
      userDefinedNames.add(tokens[idx + 1].value);
      continue;
    }

    // Function definition heuristic: `<ident> <name> ( ... ) {` or `void <name> (`
    // Only consider top-level or namespace/class declarations where a type/qualifier precedes `<name> (`.
    if (
      t.type === 'ident' &&
      tokens[idx + 1]?.type === 'ident' &&
      tokens[idx + 2]?.value === '(' &&
      tokens[idx - 1]?.value !== '::' &&
      tokens[idx - 1]?.value !== '.' &&
      tokens[idx - 1]?.value !== '->'
    ) {
      const prev = t.value;
      if (
        prev !== 'return' &&
        prev !== 'if' &&
        prev !== 'while' &&
        prev !== 'for' &&
        prev !== 'switch' &&
        prev !== 'else'
      ) {
        // Scan matching ')' and see if '{' follows (a definition, not a call)
        let depth = 0;
        let k = idx + 2;
        while (k < tokens.length) {
          if (tokens[k].value === '(') depth++;
          else if (tokens[k].value === ')') {
            depth--;
            if (depth === 0) break;
          }
          k++;
        }
        const afterParen = tokens[k + 1]?.value;
        if (afterParen === '{' || afterParen === 'const' || afterParen === 'noexcept') {
          userDefinedNames.add(tokens[idx + 1].value);
        }
      }
    }
  }

  return {
    hasUsingNamespaceStd,
    hasUsingNamespaceRanges,
    usingStdNames,
    namespaceAliases,
    userDefinedNames,
  };
}

const NON_NAMESPACE_KEYWORDS = new Set([
  'return',
  'else',
  'case',
  'throw',
  'new',
  'delete',
  'sizeof',
  'decltype',
  'alignof',
  'co_return',
  'co_await',
  'co_yield',
]);

/**
 * Checks whether a qualified chain ending at `idx` matches a target parts array (e.g. ['std', 'sort']).
 * Supports namespace aliases (e.g. `namespace r = std::ranges; r::sort`).
 * @param {Token[]} tokens
 * @param {number} idx
 * @param {Map<string, string[]>} namespaceAliases
 * @returns {string[] | null}
 */
function readQualifiedChainAt(tokens, idx, namespaceAliases) {
  if (tokens[idx]?.type !== 'ident') return null;
  // Walk backwards over `::` (stopping before statement keywords like `return ::pow(...)`)
  const parts = [tokens[idx].value];
  let cur = idx;
  while (
    cur >= 2 &&
    tokens[cur - 1]?.value === '::' &&
    tokens[cur - 2]?.type === 'ident' &&
    !NON_NAMESPACE_KEYWORDS.has(tokens[cur - 2].value)
  ) {
    parts.unshift(tokens[cur - 2].value);
    cur -= 2;
  }
  if (parts.length === 1) return parts;
  const expandedFirst = namespaceAliases.get(parts[0]);
  if (expandedFirst) {
    return [...expandedFirst, ...parts.slice(1)];
  }
  return parts;
}

/**
 * Checks if a single banned name is violated in the tokenized code.
 * Returns the 1-based line number of the first violation, or null.
 * @param {Token[]} tokens
 * @param {ReturnType<typeof analyzeContext>} ctx
 * @param {string} banned
 * @returns {number | null}
 */
function findViolationLine(tokens, ctx, banned) {
  // 1. Keywords: for, while, do, goto
  if (KEYWORDS.has(banned)) {
    for (const t of tokens) {
      if (t.type === 'ident' && t.value === banned) {
        return t.line;
      }
    }
    return null;
  }

  // 2. Member / reverse-iterator methods: rbegin, rend, crbegin, crend
  if (MEMBER_ONLY.has(banned)) {
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.type === 'ident' && t.value === banned) {
        const prev = tokens[i - 1]?.value;
        const next = tokens[i + 1]?.value;
        if (prev === '.' || prev === '->' || prev === '::' || next === '(') {
          return t.line;
        }
      }
    }
    return null;
  }

  const bannedParts = banned.split('::').filter(Boolean);

  // 3. Qualified name like std::sort, std::ranges::sort, boost::integer::gcd
  if (bannedParts.length >= 2) {
    const leaf = bannedParts[bannedParts.length - 1];
    const isStd = bannedParts[0] === 'std' && bannedParts.length === 2;
    const isStdRanges =
      bannedParts[0] === 'std' && bannedParts[1] === 'ranges' && bannedParts.length === 3;

    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'ident' || tokens[i].value !== leaf) continue;

      const chain = readQualifiedChainAt(tokens, i, ctx.namespaceAliases);
      if (!chain) continue;

      // Exact qualified match (including via namespace alias)
      if (chain.length === bannedParts.length && chain.every((p, idx) => p === bannedParts[idx])) {
        return tokens[i].line;
      }

      // Unqualified usage (chain.length === 1) when `using namespace std;` or `using std::X;`
      if (chain.length === 1) {
        const prev = tokens[i - 1]?.value;
        // Skip member access like obj.sort() or obj->find()
        if (prev === '.' || prev === '->') continue;
        // Skip if student defined their own function/struct with this name and didn't `using std::X;`
        if (ctx.userDefinedNames.has(leaf) && !ctx.usingStdNames.has(banned)) continue;

        if (
          ctx.usingStdNames.has(banned) ||
          (isStd && ctx.hasUsingNamespaceStd) ||
          (isStdRanges && (ctx.hasUsingNamespaceRanges || ctx.hasUsingNamespaceStd))
        ) {
          // For `std::find` / `std::sort` / `std::vector`, avoid flagging mere variable names unless called or used as template/type
          const next = tokens[i + 1]?.value;
          if (next === '(' || next === '<' || ctx.usingStdNames.has(banned)) {
            return tokens[i].line;
          }
        }
      }
    }
    return null;
  }

  // 4. Unqualified C / GNU function like qsort, bsearch, __gcd, pow
  if (IDENT_RE.test(banned)) {
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'ident' || tokens[i].value !== banned) continue;
      const prev = tokens[i - 1]?.value;
      if (prev === '.' || prev === '->') continue;

      const chain = readQualifiedChainAt(tokens, i, ctx.namespaceAliases);
      if (chain && chain.length >= 2) {
        // Only flag std::<fn> (or alias to std); ignore student namespaces like math_util::pow()
        if (chain.length === 2 && chain[0] === 'std') {
          return tokens[i].line;
        }
        continue;
      }

      const isGlobalScope = prev === '::';
      if (ctx.userDefinedNames.has(banned) && !isGlobalScope) continue;
      if (tokens[i + 1]?.value === '(' || isGlobalScope) {
        return tokens[i].line;
      }
    }
  }

  return null;
}

/**
 * Evaluates a single constraint against C++ source code.
 * @param {string} code
 * @param {string} constraintText
 * @returns {{ decided: boolean, verdict?: 'pass' | 'violation', evidence?: Array<{ line: number, text: string }>, reason?: string }}
 */
export function checkHardRule(code, constraintText) {
  if (!isHardRule(constraintText)) {
    return { decided: false };
  }

  const bannedNames = extractBannedNames(constraintText);
  if (bannedNames.length === 0) {
    return { decided: false };
  }

  const tokens = tokenizeCpp(code);
  const ctx = analyzeContext(tokens);
  const lines = code.split(/\r?\n/);

  for (const banned of bannedNames) {
    const lineNum = findViolationLine(tokens, ctx, banned);
    if (lineNum !== null) {
      const lineText = (lines[lineNum - 1] ?? '').trim();
      return {
        decided: true,
        verdict: 'violation',
        evidence: [{ line: lineNum, text: lineText }],
        reason: 'hard-rule',
      };
    }
  }

  return {
    decided: true,
    verdict: 'pass',
    evidence: [],
    reason: 'hard-rule',
  };
}

/**
 * Evaluates all hard rules first and separates semantic constraints that still need the model.
 * @template {{ id: string | number, text: string }} T
 * @param {string} code
 * @param {T[]} constraints
 */
export function evaluateHardRules(code, constraints) {
  /** @type {Array<{ constraint: T, verdict: 'pass' | 'violation', evidence: Array<{ line: number, text: string }>, reason: string }>} */
  const hardVerdicts = [];
  /** @type {T[]} */
  const remainingConstraints = [];

  for (const c of constraints) {
    const res = checkHardRule(code, c.text);
    if (res.decided && res.verdict) {
      hardVerdicts.push({
        constraint: c,
        verdict: res.verdict,
        evidence: res.evidence ?? [],
        reason: res.reason ?? 'hard-rule',
      });
    } else {
      remainingConstraints.push(c);
    }
  }

  return { hardVerdicts, remainingConstraints };
}
