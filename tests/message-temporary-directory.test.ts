import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

test('trailer shared parent tolerates real child changes while physical identity and strict freshness stay enforced', async (t) => {
    const temporaryRoot = await realpath(os.tmpdir());
    const root = await realpath(await mkdtemp(path.join(temporaryRoot, 'trailer-parent-test-')));
    try {
        const wrapper = path.join(root, 'observe.mjs');
        await writeFile(
            wrapper,
            `export * from 'node:fs/promises';
import * as fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import {setTimeout} from 'node:timers/promises';
let injected=false;
export async function lstat(file,...args){
 const info=await fs.lstat(file,...args);
 const target=process.env.OBSERVED_DIRECTORY;
 const privateChild=process.env.DIRECTORY_FAULT==='private-child'&&path.dirname(file)===target&&path.basename(file).startsWith('attribution-trailer-');
 if(!injected&&(file===target||privateChild)&&!(process.env.DIRECTORY_FAULT==='private-child'&&!privateChild)){
  injected=true;
  const fault=process.env.DIRECTORY_FAULT;
  if(fault==='child'||fault==='private-child'){
   await setTimeout(25);
   await fs.mkdir(path.join(file,'unrelated-child'));
   const after=await fs.lstat(file);
   assert.equal(info.dev,after.dev);assert.equal(info.ino,after.ino);assert.equal(info.mode,after.mode);
   assert.ok(info.size!==after.size||info.mtimeMs!==after.mtimeMs||info.ctimeMs!==after.ctimeMs,'real child creation must change observed metadata');
  }else if(fault?.startsWith('replace-')){
   await fs.rename(file,file+'.original');
   if(fault==='replace-directory')await fs.mkdir(file);
   if(fault==='replace-file')await fs.writeFile(file,'peer bytes');
  }
 }
 return info;
}
`,
        );
        const osWrapper = path.join(root, 'os.mjs');
        await writeFile(
            osWrapper,
            "import os from 'node:os';export default {...os,tmpdir:()=>process.env.OBSERVED_DIRECTORY};\n",
        );
        const runner = path.join(root, 'runner.mjs');
        await writeFile(
            runner,
            `import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,n){
 if(s==='node:fs/promises'&&c.parentURL?.endsWith('/src/policy-scope.ts'))return {url:${JSON.stringify(pathToFileURL(wrapper).href)},shortCircuit:true};
 if(s==='node:os'&&c.parentURL?.endsWith('/src/message-trailers.ts'))return {url:${JSON.stringify(pathToFileURL(osWrapper).href)},shortCircuit:true};
 return n(s,c);
}});
const scope=await import(${JSON.stringify(new URL('../src/policy-scope.ts', import.meta.url).href)});
const {runTrailers}=await import(${JSON.stringify(new URL('../src/message-trailers.ts', import.meta.url).href)});
const target=process.env.OBSERVED_DIRECTORY;
const input=Buffer.from('Subject\\n\\nBody stays.\\n\\nCo-authored-by: Human <human@example.invalid>\\nReviewed-by: Reviewer\\n');
const action=process.argv[2];
if(action==='trailers'){
 const output=await runTrailers(input,{excluded:[],additions:['Assisted-by: Codex App:formal.model-1']});
 assert.equal(output.toString(),'Subject\\n\\nBody stays.\\n\\nCo-authored-by: Human <human@example.invalid>\\nReviewed-by: Reviewer\\nAssisted-by: Codex App:formal.model-1\\n');
 const parsed=await runTrailers(output,{excluded:[]});
 assert.equal(parsed.toString(),'Co-authored-by: Human <human@example.invalid>\\nReviewed-by: Reviewer\\nAssisted-by: Codex App:formal.model-1\\n');
}else if(action==='private'){
 await assert.rejects(runTrailers(input,{excluded:[]}),/Observed path identity changed/);
}else{
 const method=scope[action];assert.equal(typeof method,'function');
 if(process.argv[3]==='reject')await assert.rejects(method(target),/Observed|ENOENT/);
 else assert.equal(await method(target),target);
}
console.log('verified');
`,
        );
        for (const [name, action, fault, reject] of [
            [
                'real Git preserves body, human and unrelated trailers during shared-parent activity',
                'trailers',
                'child',
                false,
            ],
            ['default inspectPath still rejects directory child metadata changes', 'inspectPath', 'child', true],
            ['default physical still rejects directory child metadata changes', 'physical', 'child', true],
            ['private trailer directory still rejects child metadata changes', 'private', 'private-child', false],
            ['directory identity allows ordinary child metadata changes', 'physicalDirectory', 'child', false],
            [
                'directory identity rejects real directory rename and replacement',
                'physicalDirectory',
                'replace-directory',
                true,
            ],
            [
                'directory identity rejects real replacement with regular file',
                'physicalDirectory',
                'replace-file',
                true,
            ],
            ['directory identity rejects disappearance after presence', 'physicalDirectory', 'replace-missing', true],
            ['directory identity rejects an existing regular file', 'physicalDirectory', 'file', true],
            ['directory identity rejects an initially missing directory', 'physicalDirectory', 'missing', true],
            ['directory identity rejects a linked directory', 'physicalDirectory', 'link', true],
            ['directory identity rejects a linked ancestor', 'physicalDirectory', 'ancestor-link', true],
        ] as const)
            await t.test(name, async () => {
                const fixture = path.join(root, `case-${fault}-${action}`);
                await mkdir(fixture);
                let target = path.join(fixture, 'parent');
                if (fault === 'file') await writeFile(target, 'regular file');
                else if (fault === 'link' || fault === 'ancestor-link') {
                    const actual = path.join(fixture, 'actual');
                    await mkdir(actual);
                    await symlink(actual, target, process.platform === 'win32' ? 'junction' : 'dir');
                    if (fault === 'ancestor-link') {
                        await mkdir(path.join(actual, 'child'));
                        target = path.join(target, 'child');
                    }
                } else if (fault !== 'missing') await mkdir(target);
                const result = spawnSync(process.execPath, [runner, action, reject ? 'reject' : 'accept'], {
                    cwd: fixture,
                    env: { ...process.env, OBSERVED_DIRECTORY: target, DIRECTORY_FAULT: fault },
                    windowsHide: true,
                    encoding: 'utf8',
                    timeout: 30_000,
                });
                assert.equal(result.status, 0, result.stderr + result.stdout);
                assert.equal(result.stdout.trim(), 'verified');
                if (fault === 'replace-file') assert.equal(await readFile(target, 'utf8'), 'peer bytes');
                if (fault.startsWith('replace-')) assert.ok((await lstat(`${target}.original`)).isDirectory());
            });
    } finally {
        assert.equal(path.dirname(root), temporaryRoot);
        await rm(root, { recursive: true, force: true });
    }
});
