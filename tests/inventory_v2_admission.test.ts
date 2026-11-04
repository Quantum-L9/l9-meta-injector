import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { inventoryTree } from "../src/inventory";
import { compileTrackedMetadataIndex } from "../src/metadata_index";
const roots: string[] = [];
function fixture(): { root: string; out: string } {
  const base=fs.mkdtempSync(path.join(os.tmpdir(),"l9-inventory-v2-")); roots.push(base);
  const root=path.join(base,"source"), out=path.join(base,"out"); fs.mkdirSync(root); fs.mkdirSync(path.join(root,".l9"));
  fs.writeFileSync(path.join(root,"README.md"),"# Exact source body\n"); return {root,out};
}
afterEach(()=>{for(const root of roots.splice(0)) fs.rmSync(root,{recursive:true,force:true});});
describe("standalone annotation admission for v2",()=>{
  test("active v2 refuses default/header/sidecar annotation before output/source changes",()=>{
    const {root,out}=fixture();
    const index=compileTrackedMetadataIndex({snapshot:{repository_id:"Owner/Repo",revision:"a".repeat(40),tree_oid:"b".repeat(40),object_format:"sha1",entries:[]},producerVersion:"4.3.0"});
    fs.writeFileSync(path.join(root,".l9/metadata-index.jsonl"),index.bytes);
    for(const extra of [{},{injectHeaders:false},{writeSidecars:false}]) expect(()=>inventoryTree({root,outDir:out,...extra})).toThrow(/v2|versioned/);
    expect(fs.readFileSync(path.join(root,"README.md"),"utf8")).toBe("# Exact source body\n"); expect(fs.existsSync(out)).toBe(false); expect(fs.existsSync(path.join(root,".l9meta.yaml"))).toBe(false);
    inventoryTree({root,outDir:out,dryRun:true});
    expect(fs.readFileSync(path.join(root,"README.md"),"utf8")).toBe("# Exact source body\n");
  });
  test("ordinary v1 store does not silently disable standalone annotation",()=>{
    const {root,out}=fixture(); fs.writeFileSync(path.join(root,".l9/metadata-index.jsonl"),"");
    expect(()=>inventoryTree({root,outDir:out})).not.toThrow(); expect(fs.existsSync(out)).toBe(true);
  });
});
