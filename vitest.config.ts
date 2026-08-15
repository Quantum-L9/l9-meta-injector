import { defineConfig } from "vitest/config";

// Vitest replaces the previous ts-jest runner. `globals: true` keeps the bare
// describe/it/test/expect/before*/after* calls used across tests/*.test.ts
// working without per-file imports; the two files that need mocking import `vi`
// explicitly. Node environment matches the toolkit's runtime.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
