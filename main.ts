// Driver: answers every case in /input/cases.json with run() from solve.js and
// writes /output/answers.json, one answer per case in the cases' order.
// The harness runs `node main.ts` (Node 22). Outside a container, set
// MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR to stand in for /input and /output.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// V8's incremental marking off, set before solve.js is imported so all of its
// work runs under it (the house baseline runs with --no-incremental-marking, and
// the rules let an entry tune V8's flags the same way).
setFlagsFromString('--no-incremental-marking');

const solver = await import(new URL('./solve.js', import.meta.url).href);
const run = (solver as { run: (input: unknown) => unknown }).run;

const inDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const loaded = JSON.parse(readFileSync(join(inDir, 'cases.json'), 'utf8')) as {
  id: string;
  input: unknown;
}[];

const answers: unknown[] = [];
for (const c of loaded) answers.push(run(c.input));
writeFileSync(join(outDir, 'answers.json'), JSON.stringify(answers));
