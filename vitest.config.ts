import * as os from "node:os";
import { defineConfig } from "vitest/config";

// Vitest replaces the previous ts-jest runner. `globals: true` keeps the bare
// describe/it/test/expect/before*/after* calls used across tests/*.test.ts
// working without per-file imports; the two files that need mocking import `vi`
// explicitly. Node environment matches the toolkit's runtime.
//
// `testTimeout` is raised from Vitest's 5-second default: several corpus and
// self-conformance tests legitimately exceed 5s when the whole suite runs in
// parallel on a loaded machine, producing "Test timed out in 5000ms" failures
// that pass in isolation. The tests are heavy, not slow by accident — the
// budget is raised suite-wide rather than annotated per test.
//
// `availableParallelism` was added after the earliest Node 18 releases while
// package.json supports all Node >=18. Fall back to `cpus().length` so the
// stability cap does not narrow the declared runtime contract.
const parallelism = typeof os.availableParallelism === "function"
  ? os.availableParallelism()
  : Math.max(1, os.cpus().length);

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    maxWorkers: Math.max(1, Math.floor(parallelism / 2)),
  },
});
