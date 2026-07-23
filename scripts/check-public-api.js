#!/usr/bin/env node
"use strict";
const path = require("path");
const api = require("./lib/public-api");
function main() {
  const errors=api.validateRepository(api.REPO);
  if (errors.length) {
    console.error("public-api: FAILED");
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  const contract=api.readJson(path.join(api.REPO,api.CONTRACT_PATH));
  console.log(`public-api: OK (${contract.entrypoints.length} explicit entrypoints; runtime and declaration inventories separated)`);
}
main();
