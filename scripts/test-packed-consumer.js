#!/usr/bin/env node
"use strict";
const fs=require("fs"),os=require("os"),path=require("path"),crypto=require("crypto");
const {run,listRegularFiles,validatePackageContract,validatePackedFiles,parseNpmPackJson,resolveTsc,stableJson}=require("./lib/dist-integrity");
const api=require("./lib/public-api");
const REPO=path.resolve(__dirname,".."),KEEP=process.argv.includes("--keep-temp"),JSON_MODE=process.argv.includes("--json"),npm=process.platform==="win32"?"npm.cmd":"npm";
function die(message,details){const e=new Error(message);e.details=details;throw e;}
function command(cmd,args,cwd,env={}){const r=run(cmd,args,{cwd,env});if(r.status!==0)die(`${cmd} ${args.join(" ")} failed`,r);return r;}
function hash(file){return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");}
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"l9-packed-consumer-")),report={schema:"l9.packed-consumer-report/v2",status:"failed",packageName:null,packageVersion:null,tarball:null,tarballSha256:null,packedFileCount:0,runtime:null,deepImports:null,declarations:null};
try{
 const contract=JSON.parse(fs.readFileSync(path.join(REPO,"docs/package-contract.json"),"utf8")),apiContract=JSON.parse(fs.readFileSync(path.join(REPO,"docs/public-api-contract.json"),"utf8")),pkg=JSON.parse(fs.readFileSync(path.join(REPO,"package.json"),"utf8"));
 const errors=[...validatePackageContract(contract),...api.validateContract(apiContract,REPO),...api.validatePackageAgainstContract(pkg,apiContract)];if(errors.length)die("package or API contract is invalid",errors);
 report.packageName=pkg.name;report.packageVersion=pkg.version;
 const pack=command(npm,["pack","--json","--pack-destination",temp],REPO,{npm_config_loglevel:"silent"}),metadata=parseNpmPackJson(pack.stdout)[0],tarball=path.join(temp,metadata.filename);if(!fs.existsSync(tarball))die(`npm reported a missing tarball: ${metadata.filename}`);
 const packedPaths=(metadata.files||[]).map(x=>x.path),distPaths=listRegularFiles(path.join(REPO,"dist")).map(x=>`dist/${x}`),packageErrors=validatePackedFiles(packedPaths,contract,distPaths);if(packageErrors.length)die("packed file contract failed",packageErrors);
 report.tarball=metadata.filename;report.tarballSha256=hash(tarball);report.packedFileCount=packedPaths.length;
 const consumer=path.join(temp,"consumer");fs.cpSync(path.join(REPO,"fixtures/package-consumer"),consumer,{recursive:true});command(npm,["install","--ignore-scripts","--no-audit","--no-fund","--package-lock=false",tarball],consumer,{npm_config_loglevel:"silent"});
 report.runtime={output:command(process.execPath,["runtime.cjs"],consumer).stdout.trim()};report.deepImports={output:command(process.execPath,["deep-import.cjs"],consumer).stdout.trim()};
 const tsc=resolveTsc(REPO),typeRoots=path.join(REPO,"node_modules","@types"),typecheck=command(tsc,["-p","tsconfig.json","--typeRoots",typeRoots],consumer);report.declarations={command:`${tsc} -p tsconfig.json`,exitCode:typecheck.status};
 const installed=JSON.parse(fs.readFileSync(path.join(consumer,"node_modules",pkg.name,"package.json"),"utf8"));if(installed.version!==pkg.version)die("installed package version differs");if(JSON.stringify(installed.exports)!==JSON.stringify(pkg.exports))die("installed export map differs");
 report.status="passed";if(JSON_MODE)process.stdout.write(stableJson(report));else console.log(`packed-consumer: OK (${report.tarball}, sha256=${report.tarballSha256}, entrypoints=${apiContract.entrypoints.length})`);
}catch(error){if(JSON_MODE){report.reason=error&&error.message?error.message:String(error);report.details=error&&error.details?error.details:null;process.stdout.write(stableJson(report));}else{console.error(`packed-consumer: FAILED: ${error&&error.message?error.message:error}`);if(error&&error.details)console.error(JSON.stringify(error.details,null,2));if(KEEP)console.error(`temporary directory retained: ${temp}`);}process.exitCode=1;}finally{if(!KEEP)fs.rmSync(temp,{recursive:true,force:true});}
