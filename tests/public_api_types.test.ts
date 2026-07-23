import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
describe("public declaration API",()=>{
 test("consumer fixture typechecks with Node16 package exports",()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),"l9-api-types-"));
  try{
   const cfg={compilerOptions:{target:"ES2020",module:"Node16",moduleResolution:"Node16",strict:true,noEmit:true,skipLibCheck:false,baseUrl:process.cwd(),typeRoots:[path.join(process.cwd(),"node_modules/@types")],paths:{"l9-meta-injector":["src/index.ts"],"l9-meta-injector/inventory":["src/public/inventory.ts"],"l9-meta-injector/schema":["src/public/schema.ts"],"l9-meta-injector/advanced":["src/public/advanced.ts"],"l9-meta-injector/advanced/llm":["src/public/llm.ts"]}},files:[path.join(process.cwd(),"fixtures/package-consumer/types.ts")]};
   const file=path.join(temp,"tsconfig.json"); fs.writeFileSync(file,JSON.stringify(cfg));
   execFileSync(process.execPath,[path.join(process.cwd(),"node_modules/typescript/bin/tsc"),"-p",file],{stdio:"pipe"});
  } finally { fs.rmSync(temp,{recursive:true,force:true}); }
 });
});
