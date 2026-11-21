// Python's reading of text, shared by the ports that read files the way CPython does (#470): its UTF-8
// decoder's error (S10, #481, moved here by S29, #499, so a command can use it without reaching a
// renderer's imports) and str.splitlines(). node: modules only (none at all).

/**
 * The first malformed sequence of buf as CPython's utf-8 decoder reports it, or null when buf is valid.
 * @param {Buffer} buf
 * @returns {{ start: number, end: number, reason: string } | null}
 */
export function utf8Error(buf) {
  let i = 0;
  const n = buf.length;
  while (i < n) {
    const b = buf[i];
    if (b < 0x80) {
      i++;
      continue;
    }
    let need;
    let lo = 0x80;
    let hi = 0xbf;
    if (b >= 0xc2 && b <= 0xdf) need = 1;
    else if (b >= 0xe0 && b <= 0xef) {
      need = 2;
      if (b === 0xe0) lo = 0xa0;
      if (b === 0xed) hi = 0x9f;
    } else if (b >= 0xf0 && b <= 0xf4) {
      need = 3;
      if (b === 0xf0) lo = 0x90;
      if (b === 0xf4) hi = 0x8f;
    } else return { start: i, end: i + 1, reason: 'invalid start byte' };
    for (let k = 1; k <= need; k++) {
      if (i + k >= n) return { start: i, end: n, reason: 'unexpected end of data' };
      const c = buf[i + k];
      const ok = k === 1 ? c >= lo && c <= hi : c >= 0x80 && c <= 0xbf;
      if (!ok) return { start: i, end: i + k, reason: 'invalid continuation byte' };
    }
    i += need + 1;
  }
  return null;
}

/**
 * str() of the UnicodeDecodeError buf.decode("utf-8") raises, or null when buf decodes.
 * @param {Buffer} buf
 */
export function utf8ErrorText(buf) {
  const bad = utf8Error(buf);
  if (!bad) return null;
  const where = bad.end - bad.start === 1
    ? 'byte 0x' + buf[bad.start].toString(16).padStart(2, '0') + ' in position ' + bad.start
    : 'bytes in position ' + bad.start + '-' + (bad.end - 1);
  return "'utf-8' codec can't decode " + where + ': ' + bad.reason;
}

/** The separators str.splitlines() splits on (\r\n is one). */
const LINE_BREAKS = new Set(['\n', '\r', '\v', '\f', '\x1c', '\x1d', '\x1e', '\x85', ' ', ' ']);

/** str.splitlines() with no argument. @param {string} text @returns {string[]} */
export function splitLines(text) {
  const out = [];
  let cur = '';
  let pending = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\r' && text[i + 1] === '\n') continue; // \r\n is one break; the \n closes the line
    if (LINE_BREAKS.has(ch)) {
      out.push(cur);
      cur = '';
      pending = false;
    } else {
      cur += ch;
      pending = true;
    }
  }
  if (pending) out.push(cur);
  return out;
}
