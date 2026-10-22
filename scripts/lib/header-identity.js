"use strict";

function resolveCliHeaderIdentity(pkg, root, label, argv) {
  const authorityRaw = (argv.authority ?? "").trim();
  const namespaceRaw = (argv.namespace ?? "").trim();
  const result = pkg.resolveHeaderIdentity(root, {
    authority: authorityRaw || undefined,
    namespace: namespaceRaw || undefined,
    unboundNamespaceDefault: argv.unboundNamespaceDefault,
  });
  if (result.conflicts.length) {
    for (const item of result.conflicts) {
      console.error(`${label}: ${item.code}: ${item.message}`);
    }
    process.exit(2);
  }
  if (result.authority.includes("\u0000") || result.authority.includes("\r") || result.authority.includes("\n")) {
    console.error(`${label}: authority contains a forbidden control character`);
    process.exit(2);
  }
  return result;
}

module.exports = { resolveCliHeaderIdentity };
