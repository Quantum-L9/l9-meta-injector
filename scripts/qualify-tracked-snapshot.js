#!/usr/bin/env node
"use strict";
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),{performance}=require('node:perf_hooks');
const [rootArg,repositoryId,revision,outArg,producerDir,producerCommit]=process.argv.slice(2);
if(!producerCommit||!/^[a-f0-9]{40}$/.test(producerCommit))throw new Error('exact producer implementation commit required');
const root=fs.realpathSync(rootArg),out=path.resolve(outArg);
if(out===root||out.startsWith(root+path.sep))throw new Error('qualification output must be outside source');
fs.mkdirSync(out,{recursive:true,mode:0o700});fs.chmodSync(out,0o700);
const producer=require(path.join(producerDir,'dist/public/advanced.js')),version=require(path.join(producerDir,'package.json')).version;
function filesystemState(dir){const rows=[];function visit(current){for(const name of fs.readdirSync(current).sort()){const file=path.join(current,name),s=fs.lstatSync(file,{bigint:true});rows.push([path.relative(dir,file),String(s.mode),String(s.size),String(s.mtimeNs),String(s.ino),String(s.nlink)]);if(s.isDirectory()&&!s.isSymbolicLink())visit(file);}}visit(dir);return JSON.stringify(rows);}
const before=filesystemState(root),timings=[];let first;
for(let run=0;run<2;run++){const start=performance.now();const value=producer.runTrackedCoverage({root,repositoryId,revision,contract:'l9.tracked-carrier-policy/v2',producerVersion:version});timings.push(performance.now()-start);if(first){assert.equal(value.bytes,first.bytes);assert.equal(value.coverageBytes,first.coverageBytes);}else first=value;}
assert.equal(filesystemState(root),before,'source filesystem metadata changed during census');
const env={};for(const[k,v]of Object.entries(process.env))if(!k.toUpperCase().startsWith('GIT_'))env[k]=v;
Object.assign(env,{GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_OPTIONAL_LOCKS:'0',GIT_NO_LAZY_FETCH:'1',GIT_NO_REPLACE_OBJECTS:'1',GIT_ALLOW_PROTOCOL:'',GIT_TERMINAL_PROMPT:'0',LC_ALL:'C'});
const git=spawnSync('/usr/bin/git',['--no-optional-locks','--no-replace-objects','-c','extensions.partialClone=','-c','core.fsmonitor=false','ls-tree','-r','-z','--full-tree',first.coverage.snapshot.tree_oid],{cwd:root,env,shell:false,timeout:30000,maxBuffer:64*1024*1024});
if(git.error||git.status!==0)throw new Error('independent tree metadata observation failed');
const raw=git.stdout;if(raw.length&&raw[raw.length-1]!==0)throw new Error('independent tree truncated');
const tree=new Map();let offset=0;while(offset<raw.length){const end=raw.indexOf(0,offset),row=raw.subarray(offset,end),tab=row.indexOf(9);assert(tab>0);const m=/^(\d{6}) (blob|commit) ([a-f0-9]{40}|[a-f0-9]{64})$/.exec(row.subarray(0,tab).toString('ascii'));assert(m);const bytes=row.subarray(tab+1),key=bytes.toString('base64');assert(!tree.has(key));tree.set(key,{mode:m[1],type:m[2],oid:m[3],bytes});offset=end+1;}
const receipts=new Map();for(const e of first.coverage.entries){assert(!receipts.has(e.path_bytes_base64));receipts.set(e.path_bytes_base64,e);const expected=tree.get(e.path_bytes_base64);assert(expected);assert.equal(e.mode,expected.mode);assert.equal(e.object_type,expected.type);assert.equal(e.object_oid,expected.oid);assert.equal(e.content_hash,null);assert.equal(e.content_hash_scope,'not_inspected');const encoded=`l9.path/v2:${Buffer.from(repositoryId).toString('base64url')}.${expected.bytes.toString('base64url')}`;assert.equal(e.id,encoded);}
assert.equal(receipts.size,tree.size);
const indexed=new Map();for(const r of first.records){assert(!indexed.has(r.path_bytes_base64));indexed.set(r.path_bytes_base64,r);const e=receipts.get(r.path_bytes_base64);assert.equal(e.disposition,'indexed');assert.equal(e.id,r.metadata.id);assert.equal(r.git.mode,e.mode);assert.equal(r.git.object_oid,e.object_oid);assert.equal(r.content_hash,null);}
for(const e of receipts.values()){assert.equal(indexed.has(e.path_bytes_base64),e.disposition==='indexed');if(e.disposition!=='indexed')assert(e.reason);if(e.mode==='120000'||e.mode==='160000')assert.equal(e.carrier,'inventory_only');if(e.path==='.l9/metadata-index.jsonl'||e.path==='GIT_TREE_MANIFEST.json')assert.equal(e.disposition,'protected');}
assert.equal(first.coverage.totals.tree_leaves,tree.size);assert.equal(first.coverage.totals.indexed+first.coverage.totals.protected+first.coverage.totals.unsupported,tree.size);assert.equal(first.coverage.closure,'exact_set_verified');
assert.equal(crypto.createHash('sha256').update(first.bytes).digest('hex'),first.coverage.index.sha256);
const counts={blobs:0,gitlinks:0,symlinks:0,hidden:0,archives:0,central_manifest:0,inventory_only:0};
for(const e of first.coverage.entries){if(e.object_type==='blob')counts.blobs++;else counts.gitlinks++;if(e.mode==='120000')counts.symlinks++;if(e.path?.split('/').some(x=>x.startsWith('.')))counts.hidden++;if(e.path&&/\.(tar\.gz|tgz|zip|pdf)$/i.test(e.path))counts.archives++;if(e.carrier==='central_manifest')counts.central_manifest++;if(e.carrier==='inventory_only')counts.inventory_only++;}
assert.equal(filesystemState(root),before,'independent comparator changed source metadata');
function save(name,bytes){fs.writeFileSync(path.join(out,name),bytes,{mode:0o600});}
save('metadata-index.snapshot.jsonl',first.bytes);save('coverage-receipt.json',first.coverageBytes);
const result={status:'passed',repository:repositoryId,requested_revision:revision,resolved_revision:first.coverage.snapshot.revision,tree_oid:first.coverage.snapshot.tree_oid,producer_commit:producerCommit,producer_version:version,totals:first.coverage.totals,counts,index_sha256:first.sha256,receipt_sha256:crypto.createHash('sha256').update(first.coverageBytes).digest('hex'),exact_set_verified:true,repeat_bytes_identical:true,source_filesystem_unchanged:true,subject_payload_inspection:false,authority_inspection:'not_performed',host_materializability:'not_assessed',timings_ms:timings,max_rss_kib:process.resourceUsage().maxRSS,node:process.version,git_version:spawnSync('/usr/bin/git',['--version'],{encoding:'utf8'}).stdout.trim()};
save('result.json',JSON.stringify(result,null,2)+'\n');process.stdout.write(JSON.stringify(result)+'\n');
