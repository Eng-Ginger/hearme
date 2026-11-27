// Usage: npx tsx packages/receiver-core/scripts/run_trace.ts tests/traces/<name>.json
// Prints the emitted events as a JSON array (consumed by tests/cross_language/run_all.py).
import { readFileSync } from "node:fs";
import { runTrace, type Trace } from "../src/receiver";

const trace = JSON.parse(readFileSync(process.argv[2], "utf8")) as Trace;
process.stdout.write(JSON.stringify(runTrace(trace)));
