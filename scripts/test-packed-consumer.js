#!/usr/bin/env node
"use strict";
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),crypto=require("node:crypto");
const {run,listRegularFiles,validatePackageContract,validatePackedFiles,parseNpmPackJson,resolveTsc,stableJson}=require("./lib/dist-integrity");
const api=require("./lib/public-api");
const {gitBinary}=require("./lib/git-binary");
const REPO=path.resolve(__dirname,".."),KEEP=process.argv.includes("--keep-temp"),JSON_MODE=process.argv.includes("--json"),npm=process.platform==="win32"?"npm.cmd":"npm";
function die(message,details){const e=new Error(message);e.details=details;throw e;}
function command(cmd,args,cwd,env={}){const r=run(cmd,args,{cwd,env});if(r.status!==0)die(`${cmd} ${args.join(" ")} failed`,r);return r;}
function hash(file){return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");}
const GIT=gitBinary(message=>die(message)),GIT_INSTALL=process.argv.includes("--git-install"),CONSUMER_AUTHORITY="l9-consumer-proof";
// Consumer CLI proof: the installed bin runs against a foreign git repository, not this
// one. The target is generated at runtime so no second meta-authority file is ever
// committed under this repository's own scan root.
function expectStatus(cmd,args,cwd,expected,label){
 const r=run(cmd,args,{cwd});
 if(r.status!==expected){die(`${label}: expected exit ${expected}, got ${r.status}`,{stdout:r.stdout,stderr:r.stderr});}
 return r;
}
function makeTargetRepository(dir){
 fs.mkdirSync(path.join(dir,".l9"),{recursive:true});
 const files={"README.md":"# consumer target\n","app.py":"print('consumer')\n",".l9/meta-authority.yaml":"schema: l9.meta-authority/v1\nwriter:\n  repository: Quantum-L9/l9-meta-injector\n  ref: v4\ndefault_carrier: central_manifest\nlegacy_writers: forbidden\ninline_allow: []\n"};
 for(const [rel,text] of Object.entries(files)){fs.writeFileSync(path.join(dir,rel),text,"utf8");}
 const ident=["-c","user.email=consumer@example.invalid","-c","user.name=consumer-proof"];
 command(GIT,["init","-q"],dir);command(GIT,["add","--",...Object.keys(files)],dir);command(GIT,[...ident,"commit","-q","-m","consumer target"],dir);
 return Object.keys(files).filter(rel=>!rel.startsWith(".l9/")).map(rel=>[rel,hash(path.join(dir,rel))]);
}
// POSIX runs the installed .bin link itself (shebang + executable bit). Windows .cmd shims
// cannot be spawned without a shell (Node >=18.20.2, CVE-2024-27980), so there the proof
// runs the installed bin target with this Node instead.
function binCommand(consumer){
 if(process.platform==="win32"){return {cmd:process.execPath,prefix:[path.join(consumer,"node_modules","l9-meta-injector","scripts","operation-cli.js")]};}
 return {cmd:path.join(consumer,"node_modules",".bin","l9-meta-injector"),prefix:[]};
}
function runConsumerCli(consumer,target){
 const {cmd:binCmd,prefix}=binCommand(consumer),before=makeTargetRepository(target),steps=[];
 const bin=(args,expected,label)=>expectStatus(binCmd,[...prefix,...args],target,expected,label);
 const help=bin(["--help"],0,"l9-meta-injector --help");
 if(!/usage:/.test(help.stdout)){die("--help printed no usage on stdout",{stdout:help.stdout});}
 steps.push("help");
 bin(["inventory","."],0,"inventory .");
 steps.push("inventory");
 const firstCheck=bin(["check",".","--authority",CONSUMER_AUTHORITY],1,"check before apply");
 if(!/metadata-index\.jsonl/.test(firstCheck.stdout+firstCheck.stderr)){die("check before apply did not report the missing metadata index",{stdout:firstCheck.stdout,stderr:firstCheck.stderr});}
 steps.push("check-drift");
 bin(["apply",".","--authority",CONSUMER_AUTHORITY],0,"apply");
 steps.push("apply");
 bin(["check",".","--authority",CONSUMER_AUTHORITY],0,"check after apply");
 steps.push("check-clean");
 for(const [rel,digest] of before){
  if(hash(path.join(target,rel))!==digest){die(`apply rewrote source file ${rel} under the central_manifest carrier`);}
 }
 if(!fs.existsSync(path.join(target,".l9","metadata-index.jsonl"))){die("apply did not write .l9/metadata-index.jsonl");}
 return steps;
}
// Git-dependency proof (opt-in): installs the committed HEAD exactly as a consumer's
// `npm install github:Quantum-L9/l9-meta-injector#<ref>` would, then runs the same CLI
// proof. Only committed state is installable, so this runs on clean CI checkouts.
function gitInstallProof(root){
 const head=command(GIT,["rev-parse","HEAD"],REPO).stdout.trim(),bare=path.join(root,"source.git");
 command(GIT,["clone","-q","--bare","--depth","1","--no-local",`file://${REPO}`,bare],root);
 const consumer=path.join(root,"git-consumer");fs.mkdirSync(consumer);fs.writeFileSync(path.join(consumer,"package.json"),'{"name":"git-consumer","private":true}\n');
 command(npm,["install","--no-audit","--no-fund","--package-lock=false",`git+file://${bare}#${head}`],consumer,{npm_config_loglevel:"silent"});
 return {revision:head,steps:runConsumerCli(consumer,path.join(root,"git-target"))};
}
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"l9-packed-consumer-")),report={schema:"l9.packed-consumer-report/v2",status:"failed",packageName:null,packageVersion:null,tarball:null,tarballSha256:null,packedFileCount:0,runtime:null,deepImports:null,declarations:null,cli:null,gitInstall:null};
// --cli-only --tarball <file>: runtime proof of an already-packed tarball on the Node
// that runs this script (ADR-079 Node-floor matrix). No dev toolchain is used: no pack,
// no contract re-validation, no declaration typecheck — those run once on the dev Node.
const CLI_ONLY=process.argv.includes("--cli-only"),TARBALL_INDEX=process.argv.indexOf("--tarball"),TARBALL_ARG=TARBALL_INDEX>=0?process.argv[TARBALL_INDEX+1]:undefined;
function cliOnly(){
 if(!TARBALL_ARG||TARBALL_ARG.startsWith("--"))die("--cli-only requires --tarball <file>");
 const tarball=path.resolve(TARBALL_ARG);if(!fs.existsSync(tarball))die(`tarball not found: ${tarball}`);
 report.tarball=path.basename(tarball);report.tarballSha256=hash(tarball);
 const consumer=path.join(temp,"consumer");fs.cpSync(path.join(REPO,"fixtures/package-consumer"),consumer,{recursive:true});command(npm,["install","--ignore-scripts","--no-audit","--no-fund","--package-lock=false",tarball],consumer,{npm_config_loglevel:"silent"});
 report.runtime={output:command(process.execPath,["runtime.cjs"],consumer).stdout.trim()};report.deepImports={output:command(process.execPath,["deep-import.cjs"],consumer).stdout.trim()};
 report.cli={steps:runConsumerCli(consumer,path.join(temp,"target"))};
 report.status="passed";if(JSON_MODE)process.stdout.write(stableJson(report));else console.log(`packed-consumer (cli-only): OK (node ${process.version}, ${report.tarball}, cli=${report.cli.steps.join(",")})`);
}
try{
 if(CLI_ONLY){cliOnly();}else{
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
 report.cli={steps:runConsumerCli(consumer,path.join(temp,"target"))};
 if(GIT_INSTALL)report.gitInstall=gitInstallProof(temp);
 report.status="passed";
 const gitInstallNote=report.gitInstall?", git-install="+report.gitInstall.revision.slice(0,12):"";
 if(JSON_MODE){process.stdout.write(stableJson(report));}
 else{console.log(`packed-consumer: OK (${report.tarball}, sha256=${report.tarballSha256}, entrypoints=${apiContract.entrypoints.length}, cli=${report.cli.steps.join(",")}${gitInstallNote})`);}
 }
}catch(error){if(JSON_MODE){report.reason=error?.message?error.message:String(error);report.details=error?.details?error.details:null;process.stdout.write(stableJson(report));}else{console.error(`packed-consumer: FAILED: ${error?.message?error.message:error}`);if(error?.details)console.error(JSON.stringify(error.details,null,2));if(KEEP)console.error(`temporary directory retained: ${temp}`);}process.exitCode=1;}finally{if(!KEEP)fs.rmSync(temp,{recursive:true,force:true});}
