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
// `maxWorkers` is capped at half the machine's parallelism for the same reason:
// under full parallel load the ten-thousand-artifact corpus test starves
// sibling workers long enough for Vitest's internal worker RPC to time out
// ("[vitest-worker]: Timeout calling onTaskUpdate"), an unhandled error that
// also passes in isolation. Half the workers trades wall time for a stable run.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    maxWorkers: Math.max(1, Math.floor(os.availableParallelism() / 2)),
  },
});
