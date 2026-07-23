"use strict";
const assert=require("assert");
for(const specifier of ["l9-meta-injector/dist/schema","l9-meta-injector/src/schema","l9-meta-injector/dist/public/schema"]){
  let error;
  try{ require(specifier); }catch(caught){ error=caught; }
  assert(error,`${specifier} unexpectedly resolved`);
  assert.strictEqual(error.code,"ERR_PACKAGE_PATH_NOT_EXPORTED",`${specifier} failed for the wrong reason`);
}
console.log("deep-imports: OK (unlisted paths rejected)");
