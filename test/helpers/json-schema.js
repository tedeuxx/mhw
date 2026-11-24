// A JSON Schema (draft 2020-12) validator for the keywords method/scripts/worklog-contract/event.schema.json
// uses, and no others (#594). The worklog left the CLI with `mhw worklog`, and its hand validator with it;
// the contract stays the JSON Schema, so the test that holds the worklog skill reads the schema itself.
// A keyword the schema uses that this file does not know stops the validation (an unknown keyword is an
// error, never ignored), so a schema change cannot pass by being skipped. `format` is an annotation in
// 2020-12 and is not asserted. Lengths count code points, as the specification says. node: modules only.

const KNOWN = new Set(['$schema', '$id', 'title', 'description', '$comment', '$defs', '$ref', 'type', 'enum', 'const',
  'pattern', 'minLength', 'maxLength', 'minimum', 'minItems', 'items', 'required', 'properties',
  'additionalProperties', 'anyOf', 'allOf', 'not', 'if', 'then', 'else', 'format']);

/** @param {unknown} v */
function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

/** @param {unknown} a @param {unknown} b @returns {boolean} */
function equal(a, b) {
  if (typeOf(a) !== typeOf(b) && !(typeof a === 'number' && typeof b === 'number')) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => equal(x, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    return equal(ka, kb) && ka.every((k) => equal(/** @type {any} */ (a)[k], /** @type {any} */ (b)[k]));
  }
  return a === b;
}

/**
 * Validate `value` against `root`. Returns the list of errors, empty when valid.
 * @param {any} root
 * @param {unknown} value
 * @returns {string[]}
 */
export function validate(root, value) {
  /** @param {string} ref */
  const resolve = (ref) => {
    if (ref === '#') return root;
    const m = /^#\/\$defs\/([^/]+)$/.exec(ref);
    if (!m || !root.$defs || !(m[1] in root.$defs)) throw new Error('unsupported $ref ' + ref);
    return root.$defs[m[1]];
  };
  /** @param {any} s @param {any} v @param {string} at @returns {string[]} */
  const check = (s, v, at) => {
    if (s === true) return [];
    if (s === false) return [at + ': false schema'];
    for (const k of Object.keys(s)) if (!KNOWN.has(k)) throw new Error('unsupported keyword ' + k + ' at ' + at);
    /** @type {string[]} */
    const errs = [];
    const t = typeOf(v);
    if (s.$ref) errs.push(...check(resolve(s.$ref), v, at));
    if (s.type !== undefined) {
      const types = Array.isArray(s.type) ? s.type : [s.type];
      if (!types.some((/** @type {string} */ x) => x === t || (x === 'number' && t === 'integer'))) errs.push(at + ': type ' + t + ', expected ' + types.join('|'));
    }
    if (s.enum && !s.enum.some((/** @type {unknown} */ e) => equal(e, v))) errs.push(at + ': not in enum');
    if ('const' in s && !equal(s.const, v)) errs.push(at + ': not the const');
    if (t === 'string') {
      const n = Array.from(/** @type {string} */ (v)).length;
      if (s.pattern !== undefined && !new RegExp(s.pattern, 'u').test(/** @type {string} */ (v))) errs.push(at + ': does not match ' + s.pattern);
      if (s.minLength !== undefined && n < s.minLength) errs.push(at + ': shorter than ' + s.minLength);
      if (s.maxLength !== undefined && n > s.maxLength) errs.push(at + ': longer than ' + s.maxLength);
    }
    if ((t === 'integer' || t === 'number') && s.minimum !== undefined && /** @type {number} */ (v) < s.minimum) errs.push(at + ': below ' + s.minimum);
    if (t === 'array') {
      const a = /** @type {unknown[]} */ (v);
      if (s.minItems !== undefined && a.length < s.minItems) errs.push(at + ': fewer than ' + s.minItems + ' items');
      if (s.items !== undefined) a.forEach((x, i) => errs.push(...check(s.items, x, at + '[' + i + ']')));
    }
    if (t === 'object') {
      const o = /** @type {Record<string, unknown>} */ (v);
      for (const r of s.required || []) if (!Object.hasOwn(o, r)) errs.push(at + ': missing ' + r);
      const props = s.properties || {};
      for (const [k, x] of Object.entries(o)) {
        if (Object.hasOwn(props, k)) errs.push(...check(props[k], x, at + '.' + k));
        else if (s.additionalProperties === false) errs.push(at + ': unexpected property ' + k);
      }
    }
    if (s.allOf) for (const x of s.allOf) errs.push(...check(x, v, at));
    if (s.anyOf && !s.anyOf.some((/** @type {any} */ x) => check(x, v, at).length === 0)) errs.push(at + ': matches no anyOf branch');
    if (s.not && check(s.not, v, at).length === 0) errs.push(at + ': matches a not');
    if (s.if !== undefined) {
      const branch = check(s.if, v, at).length === 0 ? s.then : s.else;
      if (branch !== undefined) errs.push(...check(branch, v, at));
    }
    return errs;
  };
  return check(root, value, '$');
}
