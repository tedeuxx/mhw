// The cleaning core for a Python suite that still needs it (#488): global/method/method_commands_test.py
// imported clipboard_guard.py until S17 deleted it, and uses src/lib/clean.js through this until its own
// slice (S18) moves it to Node. Reads {"text": ...} on stdin and prints {"spans", "categories",
// "sanitised"} as JSON: spans are [start, end, category] in code points, as clipboard_guard.find_spans()
// returned them. No term list and no salt: the generic categories only, as the suite used them.
import fs from 'node:fs';
import * as core from '../../src/lib/clean.js';

const { text } = JSON.parse(fs.readFileSync(0, 'utf8'));
const spans = core.findSpans(text);
process.stdout.write(JSON.stringify({ spans, categories: core.categories(spans), sanitised: core.sanitise(text, spans) }) + '\n');
