// H36 — no network, no credential introspection, no production database.
// Run ONLY against the completed disposable Vercel-preview-mode static export.
// Fail if the deliberately supplied synthetic Firebase URL is found in any
// published text asset, demonstrating compile-time stripping of public config.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

assert.equal(process.env.VERCEL_ENV,'preview','Must compile in preview mode');
assert.equal(process.env.FG_H36_BUNDLE_SCAN,'1','Preview bundle scan not authorized');
const syntheticHost='demo-preview-forbidden-default-rtdb.firebasedatabase.app';
const root=path.resolve('out');
assert.ok(fs.statSync(root).isDirectory(),'Expected completed static export');
let inspected=0,js=0,html=0;
const extensions=new Set(['.js','.html','.json','.txt','.css','.map','.rsc']);
function walk(dir) {
  for (const item of fs.readdirSync(dir,{withFileTypes:true})) {
    const name=path.join(dir,item.name);
    if(item.isSymbolicLink()) throw Error('Preview bundle contains symlink');
    if(item.isDirectory()){walk(name);continue;}
    if(!item.isFile()||!extensions.has(path.extname(item.name)))continue;
    inspected++;
    if(name.endsWith('.js'))js++;
    if(name.endsWith('.html'))html++;
    const data=fs.readFileSync(name,'utf8');
    // Only a fixed synthetic demo hostname is searched; never print any
    // configured URL, file content, or real Vercel environment variable.
    assert.equal(data.includes(syntheticHost),false,
      'Preview bundle still contains synthetic Firebase hostname');
  }
}
walk(root);
assert.ok(js>0&&html>0&&inspected>10,'Preview export not fully generated');
console.log('H36 PASS: static preview text assets contain no synthetic Firebase host;'+
  ' HTML and client JavaScript inspected; no cloud calls performed.');
