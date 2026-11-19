// A port of the part of Python 3.14's argparse that the moved method scripts use (#477, S06 of #470),
// so a moved command parses and prints exactly as its Python original did: the same help, the same
// usage and error text, the same exit codes, for every argument form, not only the ones a test names.
// Ported from CPython 3.14.6 Lib/argparse.py (_parse_known_args, _parse_optional, _get_option_tuples,
// _match_argument(s_partial), _get_nargs_pattern, the help formatter) and Lib/textwrap.py
// (_wrap_chunks, _handle_long_word); the names below follow theirs so the two can be read side by side.
//
// Covered: an option taking no value (the help action, nargs=0) or one value (store, nargs=None),
// spelled exactly, as a unique prefix of a long option (allow_abbrev), as `--opt=value`, and a short
// option with its value or more short flags attached (`-hx`); positionals with nargs None or '?';
// `--` ending the options; unrecognized arguments collected and reported after the required check;
// the help and usage text, wrapped to the terminal width as shutil.get_terminal_size() reads it
// (COLUMNS, else the terminal, else 80).
//
// Not covered, and stated so nobody reads this as argparse: other nargs and actions, choices, type
// conversion, mutually exclusive groups, subparsers, fromfile prefixes, intermixed parsing, and colour.
// Python 3.14 colours help and usage when its stream is a terminal and NO_COLOR is unset; this never
// colours, so on a terminal the text is the same with no escape codes. Older Pythons (3.12 and before)
// parse `-hx` and `-h --=x` differently from 3.14; the target is 3.14, the version the reference
// machine runs.
//
// Help strings are fixed text, so each comes with its textwrap chunks precomputed by Python's own
// TextWrapper._split_chunks (whitespace and hyphen splitting), and only the line filling is ported.
// node: modules only (convention 5 of #470).

/**
 * @typedef {{ dest: string, help: string[], nargs: 0 | null, strings: string[] }} OptionSpec
 *   help: the help text's textwrap chunks
 * @typedef {{ dest: string, help: string[], nargs: null | '?' }} PositionalSpec
 * @typedef {{ prog: string, description: string[], options: OptionSpec[], positionals: PositionalSpec[] }} ParserSpec
 *   description: the description's textwrap chunks
 * @typedef {{ kind: 'help' } | { kind: 'error', message: string } | { kind: 'ok', values: Record<string, string | undefined> }} ParseResult
 * @typedef {{ action: Action | null, optionString: string, sep: string | null, explicitArg: string | null }} OptionTuple
 * @typedef {{ dest: string, nargs: 0 | null | '?', strings: string[], help: string[], positional: boolean }} Action
 */

class ArgumentError extends Error {
  /**
   * @param {Action | null} action
   * @param {string} message
   */
  constructor(action, message) {
    super(action && action.strings.length ? 'argument ' + action.strings.join('/') + ': ' + message : message);
  }
}

class HelpRequested extends Error {}

/** argparse's negative-number test: a match at the start, as re.match. */
const NEGATIVE_NUMBER = /^-\.?\d/;

/**
 * Python's repr of a str, for the `%r` in argparse's messages.
 * @param {string} s
 */
export function pyRepr(s) {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = quote;
  for (const ch of s) {
    const c = /** @type {number} */ (ch.codePointAt(0));
    if (ch === '\\' || ch === quote) out += '\\' + ch;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (c < 0x20 || (c >= 0x7f && c < 0xa0) || c === 0xad) out += '\\x' + c.toString(16).padStart(2, '0');
    else if (c === 0x2028 || c === 0x2029) out += '\\u' + c.toString(16);
    else out += ch;
  }
  return out + quote;
}

/**
 * The parser's actions, in argparse's order: help first, then the options, then the positionals.
 * @param {ParserSpec} spec
 * @returns {Action[]}
 */
function actionsOf(spec) {
  return [
    ...spec.options.map((o) => ({ dest: o.dest, nargs: o.nargs, strings: o.strings, help: o.help, positional: false })),
    ...spec.positionals.map((p) => ({ dest: p.dest, nargs: p.nargs, strings: [], help: p.help, positional: true })),
  ];
}

/**
 * _get_nargs_pattern.
 * @param {Action} action
 */
function nargsPattern(action) {
  if (action.nargs === null) return action.positional ? '(-*A-*)' : '([A])';
  if (action.nargs === '?') return action.positional ? '(-*A?-*)' : '(A?)';
  return action.positional ? '((?:-*A){0}-*)' : '([AO]{0})';
}

/**
 * Parse argv as argparse's parse_args would.
 * @param {ParserSpec} spec
 * @param {string[]} argv
 * @returns {ParseResult}
 */
export function parse(spec, argv) {
  try {
    return { kind: 'ok', values: parseKnown(spec, argv) };
  } catch (e) {
    if (e instanceof HelpRequested) return { kind: 'help' };
    if (e instanceof ArgumentError) return { kind: 'error', message: e.message };
    throw e;
  }
}

/**
 * @param {ParserSpec} spec
 * @param {string[]} argStrings
 */
function parseKnown(spec, argStrings) {
  const actions = actionsOf(spec);
  /** @type {Map<string, Action>} */
  const optionMap = new Map();
  for (const a of actions) for (const s of a.strings) optionMap.set(s, a);

  /** _get_option_tuples. @param {string} optionString @returns {OptionTuple[]} */
  const optionTuples = (optionString) => {
    /** @type {OptionTuple[]} */
    const result = [];
    const eq = optionString.indexOf('=');
    const prefix = eq < 0 ? optionString : optionString.slice(0, eq);
    const sep = eq < 0 ? null : '=';
    const explicit = eq < 0 ? null : optionString.slice(eq + 1);
    if (optionString[1] === '-') {
      for (const [s, a] of optionMap) if (s.startsWith(prefix)) result.push({ action: a, optionString: s, sep, explicitArg: explicit });
    } else {
      const shortPrefix = optionString.slice(0, 2);
      const shortExplicit = optionString.slice(2);
      for (const [s, a] of optionMap) {
        if (s === shortPrefix) result.push({ action: a, optionString: s, sep: '', explicitArg: shortExplicit });
        else if (s.startsWith(prefix)) result.push({ action: a, optionString: s, sep, explicitArg: explicit });
      }
    }
    return result;
  };

  /** _parse_optional. @param {string} arg @returns {OptionTuple[] | null} */
  const parseOptional = (arg) => {
    if (!arg || arg[0] !== '-') return null;
    const exact = optionMap.get(arg);
    if (exact) return [{ action: exact, optionString: arg, sep: null, explicitArg: null }];
    if (arg.length === 1) return null;
    const eq = arg.indexOf('=');
    if (eq >= 0) {
      const a = optionMap.get(arg.slice(0, eq));
      if (a) return [{ action: a, optionString: arg.slice(0, eq), sep: '=', explicitArg: arg.slice(eq + 1) }];
    }
    const tuples = optionTuples(arg);
    if (tuples.length) return tuples;
    if (NEGATIVE_NUMBER.test(arg)) return null;
    if (arg.includes(' ')) return null;
    return [{ action: null, optionString: arg, sep: null, explicitArg: null }];
  };

  /** @type {Map<number, OptionTuple[]>} */
  const optionIndices = new Map();
  let pattern = '';
  for (let i = 0; i < argStrings.length; i++) {
    if (argStrings[i] === '--') {
      pattern += '-' + 'A'.repeat(argStrings.length - i - 1);
      break;
    }
    const tuples = parseOptional(argStrings[i]);
    if (tuples === null) {
      pattern += 'A';
    } else {
      optionIndices.set(i, tuples);
      pattern += 'O';
    }
  }

  /** @type {Record<string, string | undefined>} */
  const values = {};
  /** @type {Set<Action>} */
  const seen = new Set();
  /** @type {string[]} */
  const extras = [];

  /** take_action. @param {Action} action @param {string[]} args */
  const takeAction = (action, args) => {
    seen.add(action);
    if (action.nargs === 0) throw new HelpRequested();
    values[action.dest] = args.length ? args[0] : undefined;
  };

  /** _match_argument. @param {Action} action @param {string} selected */
  const matchArgument = (action, selected) => {
    const m = new RegExp('^' + nargsPattern(action)).exec(selected);
    if (m === null) throw new ArgumentError(action, action.nargs === '?' ? 'expected at most one argument' : 'expected one argument');
    return m[1].length;
  };

  /** consume_optional. @param {number} startIndex */
  const consumeOptional = (startIndex) => {
    const tuples = /** @type {OptionTuple[]} */ (optionIndices.get(startIndex));
    if (tuples.length > 1) {
      throw new ArgumentError(null, 'ambiguous option: ' + argStrings[startIndex] + ' could match ' + tuples.map((t) => t.optionString).join(', '));
    }
    let { action, optionString, sep, explicitArg } = tuples[0];
    /** @type {Array<[Action, string[]]>} */
    const actionTuples = [];
    let stop = startIndex + 1;
    for (;;) {
      if (action === null) {
        extras.push(argStrings[startIndex]);
        return startIndex + 1;
      }
      if (explicitArg === null) {
        const start = startIndex + 1;
        const count = matchArgument(action, pattern.slice(start));
        stop = start + count;
        actionTuples.push([action, argStrings.slice(start, stop)]);
        break;
      }
      const count = matchArgument(action, 'A');
      if (count === 0 && optionString[1] !== '-' && explicitArg !== '') {
        if (sep || explicitArg[0] === '-') throw new ArgumentError(action, 'ignored explicit argument ' + pyRepr(explicitArg));
        actionTuples.push([action, []]);
        optionString = optionString[0] + explicitArg[0];
        const next = optionMap.get(optionString);
        if (!next) {
          extras.push(optionString[0] + explicitArg);
          stop = startIndex + 1;
          break;
        }
        action = next;
        explicitArg = explicitArg.slice(1);
        if (!explicitArg) {
          sep = explicitArg = null;
        } else if (explicitArg[0] === '=') {
          sep = '=';
          explicitArg = explicitArg.slice(1);
        } else {
          sep = '';
        }
      } else if (count === 1) {
        stop = startIndex + 1;
        actionTuples.push([action, [explicitArg]]);
        break;
      } else {
        throw new ArgumentError(action, 'ignored explicit argument ' + pyRepr(explicitArg));
      }
    }
    for (const [a, args] of actionTuples) takeAction(a, args);
    return stop;
  };

  let positionals = actions.filter((a) => a.positional);

  /** _match_arguments_partial. @param {Action[]} acts @param {string} selected */
  const matchPartial = (acts, selected) => {
    for (let i = acts.length; i > 0; i--) {
      const m = new RegExp('^' + acts.slice(0, i).map(nargsPattern).join('')).exec(selected);
      if (m !== null) {
        const result = m.slice(1).map((g) => g.length);
        if (m[0].length < selected.length && selected[m[0].length] === 'O') {
          while (result.length && !result.at(-1)) result.pop();
        }
        return result;
      }
    }
    return [];
  };

  /** consume_positionals. @param {number} startIndex */
  const consumePositionals = (startIndex) => {
    const counts = matchPartial(positionals, pattern.slice(startIndex));
    let index = startIndex;
    counts.forEach((count, k) => {
      const args = argStrings.slice(index, index + count);
      if (pattern.slice(index, index + count).includes('-')) args.splice(args.indexOf('--'), 1);
      index += count;
      takeAction(positionals[k], args);
    });
    positionals = positionals.slice(counts.length);
    return index;
  };

  let startIndex = 0;
  const maxOptionIndex = optionIndices.size ? Math.max(...optionIndices.keys()) : -1;
  while (startIndex <= maxOptionIndex) {
    let nextOption = startIndex;
    while (nextOption <= maxOptionIndex && !optionIndices.has(nextOption)) nextOption += 1;
    if (startIndex !== nextOption) {
      const end = consumePositionals(startIndex);
      if (end > startIndex) {
        startIndex = end;
        continue;
      }
      startIndex = end;
    }
    if (!optionIndices.has(startIndex)) {
      extras.push(...argStrings.slice(startIndex, nextOption));
      startIndex = nextOption;
    }
    startIndex = consumeOptional(startIndex);
  }
  extras.push(...argStrings.slice(consumePositionals(startIndex)));

  const required = actions.filter((a) => a.positional && a.nargs === null && !seen.has(a)).map((a) => a.dest);
  if (required.length) throw new ArgumentError(null, 'the following arguments are required: ' + required.join(', '));
  if (extras.length) throw new ArgumentError(null, 'unrecognized arguments: ' + extras.join(' '));
  for (const a of actions) if (a.nargs !== 0 && !(a.dest in values)) values[a.dest] = undefined;
  return values;
}

/**
 * shutil.get_terminal_size().columns: COLUMNS when it is a positive integer, else the terminal's
 * width, else 80.
 * @param {Record<string, string | undefined>} env
 * @param {number} [terminal] the terminal's columns, 0 or undefined when stdout is not a terminal
 */
export function terminalColumns(env, terminal) {
  const raw = env.COLUMNS;
  if (raw !== undefined && /^\s*[+-]?\d+(?:_\d+)*\s*$/.test(raw)) {
    const n = Number(raw.trim().replaceAll('_', ''));
    if (n > 0) return n;
  }
  return terminal && terminal > 0 ? terminal : 80;
}

/**
 * textwrap.TextWrapper._wrap_chunks with its defaults (drop_whitespace, break_long_words,
 * break_on_hyphens), over chunks Python already split.
 * @param {string[]} chunksIn
 * @param {number} width
 * @param {string} [initialIndent]
 * @param {string} [subsequentIndent]
 */
export function wrapChunks(chunksIn, width, initialIndent = '', subsequentIndent = '') {
  const chunks = [...chunksIn].reverse();
  /** @type {string[]} */
  const lines = [];
  while (chunks.length) {
    /** @type {string[]} */
    const cur = [];
    let curLen = 0;
    const indent = lines.length ? subsequentIndent : initialIndent;
    const w = width - indent.length;
    if (chunks.at(-1)?.trim() === '' && lines.length) chunks.pop();
    while (chunks.length) {
      const l = /** @type {string} */ (chunks.at(-1)).length;
      if (curLen + l > w) break;
      cur.push(/** @type {string} */ (chunks.pop()));
      curLen += l;
    }
    if (chunks.length && /** @type {string} */ (chunks.at(-1)).length > w) handleLongWord(chunks, cur, curLen, w);
    if (cur.length && cur.at(-1)?.trim() === '') cur.pop();
    if (cur.length) lines.push(indent + cur.join(''));
  }
  return lines;
}

/**
 * textwrap.TextWrapper._handle_long_word, break_long_words and break_on_hyphens on.
 * @param {string[]} reversed
 * @param {string[]} cur
 * @param {number} curLen
 * @param {number} width
 */
function handleLongWord(reversed, cur, curLen, width) {
  const spaceLeft = width < 1 ? 1 : width - curLen;
  const chunk = /** @type {string} */ (reversed.at(-1));
  let end = spaceLeft;
  if (chunk.length > spaceLeft) {
    const hyphen = chunk.lastIndexOf('-', spaceLeft - 1);
    if (hyphen > 0 && [...chunk.slice(0, hyphen)].some((c) => c !== '-')) end = hyphen + 1;
  }
  cur.push(chunk.slice(0, end));
  reversed[reversed.length - 1] = chunk.slice(end);
}

/**
 * HelpFormatter._format_usage for these actions, before format_help's strip: "usage: ...\n\n".
 * @param {ParserSpec} spec
 * @param {number} width the formatter's width (columns - 2)
 */
function formatUsage(spec, width) {
  const prefix = 'usage: ';
  const prog = spec.prog;
  const optParts = spec.options.map((o) => (o.nargs === 0 ? '[' + o.strings[0] + ']' : '[' + o.strings[0] + ' ' + o.dest.toUpperCase() + ']'));
  const posParts = spec.positionals.map((p) => (p.nargs === '?' ? '[' + p.dest + ']' : p.dest));
  let usage = [prog, ...optParts, ...posParts].join(' ');
  const textWidth = width;
  if (prefix.length + usage.length > textWidth) {
    /** @param {string[]} parts @param {string} indent @param {string} [pre] */
    const getLines = (parts, indent, pre) => {
      /** @type {string[]} */
      const lines = [];
      /** @type {string[]} */
      let line = [];
      let lineLen = pre === undefined ? indent.length - 1 : pre.length - 1;
      for (const part of parts) {
        if (lineLen + 1 + part.length > textWidth && line.length) {
          lines.push(indent + line.join(' '));
          line = [];
          lineLen = indent.length - 1;
        }
        line.push(part);
        lineLen += part.length + 1;
      }
      if (line.length) lines.push(indent + line.join(' '));
      if (pre !== undefined) lines[0] = lines[0].slice(indent.length);
      return lines;
    };
    /** @type {string[]} */
    let lines;
    if (prefix.length + prog.length <= 0.75 * textWidth) {
      const indent = ' '.repeat(prefix.length + prog.length + 1);
      lines = getLines([prog, ...optParts], indent, prefix);
      lines.push(...getLines(posParts, indent));
    } else {
      const indent = ' '.repeat(prefix.length);
      lines = getLines([...optParts, ...posParts], indent);
      if (lines.length > 1) lines = [...getLines(optParts, indent), ...getLines(posParts, indent)];
      lines = [prog, ...lines];
    }
    usage = lines.join('\n');
  }
  return prefix + usage + '\n\n';
}

/**
 * format_help's ending: runs of three or more newlines become two, the ends are stripped of newlines,
 * and one newline closes it.
 * @param {string} text
 */
function finish(text) {
  return text.replace(/\n\n\n+/g, '\n\n').replace(/^\n+|\n+$/g, '') + '\n';
}

/**
 * The usage, as print_usage prints it before an error.
 * @param {ParserSpec} spec
 * @param {number} columns
 */
export function usageText(spec, columns) {
  return finish(formatUsage(spec, columns - 2));
}

/**
 * The help, as print_help prints it.
 * @param {ParserSpec} spec
 * @param {number} columns
 */
export function helpText(spec, columns) {
  const width = columns - 2;
  const actions = actionsOf(spec);
  const maxHelpPosition = Math.min(24, Math.max(width - 20, 4));
  /** @param {Action} a */
  const invocation = (a) => {
    if (a.positional) return a.dest;
    return a.nargs === 0 ? a.strings.join(', ') : a.strings.join(', ') + ' ' + a.dest.toUpperCase();
  };
  const actionMaxLength = Math.max(...actions.map((a) => invocation(a).length + 2));
  const helpPosition = Math.min(actionMaxLength + 2, maxHelpPosition);
  const helpWidth = Math.max(width - helpPosition, 11);
  const actionWidth = helpPosition - 2 - 2;
  /** @param {Action} a */
  const formatAction = (a) => {
    const header = invocation(a);
    let out;
    let indentFirst;
    if (header.length <= actionWidth) {
      out = '  ' + header.padEnd(actionWidth) + '  ';
      indentFirst = 0;
    } else {
      out = '  ' + header + '\n';
      indentFirst = helpPosition;
    }
    const lines = wrapChunks(a.help, helpWidth);
    out += ' '.repeat(indentFirst) + lines[0] + '\n';
    for (const line of lines.slice(1)) out += ' '.repeat(helpPosition) + line + '\n';
    return out;
  };
  /** @param {string} heading @param {Action[]} acts */
  const section = (heading, acts) => (acts.length ? '\n' + heading + ':\n' + acts.map(formatAction).join('') + '\n' : '');
  const description = wrapChunks(spec.description, Math.max(width, 11)).join('\n') + '\n\n';
  return finish(formatUsage(spec, width) + description
    + section('positional arguments', actions.filter((a) => a.positional))
    + section('options', actions.filter((a) => !a.positional)));
}
