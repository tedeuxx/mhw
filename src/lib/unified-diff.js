// The hunks of `diff -u a b`, without its two header lines (the `| sed '1,2d'` of install.sh's dry runs),
// for small inputs: a longest common subsequence by dynamic programming, deletions before insertions in a
// change, three lines of context, and hunks closer than twice the context merged. Measured equal to Apple
// diff (FreeBSD-based) and GNU diff on the dry-run documents the allow-list step prints
// (test/lib/unified-diff.test.js compares it with the diff on PATH). Both inputs end with a newline in
// every use here, so the "\ No newline at end of file" form is not produced. node: modules only.

/**
 * @param {string} before
 * @param {string} after
 * @param {number} [context]
 * @returns {string} the hunks, each line ending with a newline; '' when the two are equal
 */
export function unifiedHunks(before, after, context = 3) {
  const a = lines(before);
  const b = lines(after);
  const n = a.length;
  const m = b.length;
  // L[i][j]: the length of a longest common subsequence of a[i..] and b[j..].
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
  }
  /** @type {Array<{ op: ' ' | '-' | '+', text: string, ai: number, bi: number }>} */
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      ops.push({ op: ' ', text: a[i], ai: i, bi: j });
      i++;
      j++;
    } else if (j >= m || (i < n && L[i + 1][j] >= L[i][j + 1])) {
      ops.push({ op: '-', text: a[i], ai: i, bi: j });
      i++;
    } else {
      ops.push({ op: '+', text: b[j], ai: i, bi: j });
      j++;
    }
  }
  const changed = ops.map((o, k) => (o.op === ' ' ? -1 : k)).filter((k) => k >= 0);
  if (!changed.length) return '';
  /** @type {Array<[number, number]>} */
  const groups = [];
  for (const k of changed) {
    const last = groups.at(-1);
    if (last && k - last[1] - 1 <= 2 * context) last[1] = k;
    else groups.push([k, k]);
  }
  let out = '';
  for (const [first, lastChange] of groups) {
    const from = Math.max(0, first - context);
    const to = Math.min(ops.length - 1, lastChange + context);
    const slice = ops.slice(from, to + 1);
    const aCount = slice.filter((o) => o.op !== '+').length;
    const bCount = slice.filter((o) => o.op !== '-').length;
    const aStart = slice[0].ai;
    const bStart = slice[0].bi;
    out += '@@ -' + range(aStart, aCount) + ' +' + range(bStart, bCount) + ' @@\n';
    for (const o of slice) out += o.op + o.text + '\n';
  }
  return out;
}

/** @param {number} start0 @param {number} count */
function range(start0, count) {
  if (count === 1) return String(start0 + 1);
  if (count === 0) return start0 + ',0';
  return start0 + 1 + ',' + count;
}

/** @param {string} text */
function lines(text) {
  if (!text) return [];
  const l = text.split('\n');
  if (l.at(-1) === '') l.pop();
  return l;
}
