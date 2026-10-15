import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { writeNewMessage } from '../src/message-output.ts';

test('cancelled new-file publication creates no artifact', async () => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'message-output-abort-')));
    try {
        const output = path.join(directory, 'output');
        const binding = {
            gitDirectory: path.join(directory, 'admin'),
            commonGitDir: path.join(directory, 'common'),
        };
        const controller = new AbortController();
        controller.abort();
        await assert.rejects(
            Reflect.apply(writeNewMessage, undefined, [
                output,
                Buffer.from('candidate'),
                binding,
                [],
                controller.signal,
            ]),
            /cancel/i,
        );
        assert.equal(existsSync(output), false);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('actual short-write, exclusive-create race and replaced-path failures preserve peer bytes', async (t) => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'message-output-races-')));
    try {
        const wrapper = path.join(directory, 'fs-wrapper.mjs');
        await writeFile(
            wrapper,
            `export * from 'node:fs/promises';
import * as fs from 'node:fs/promises';
export async function open(file,flags,mode){
 if(process.env.OUTPUT_FAULT==='race')await fs.writeFile(file,'peer bytes');
 const h=await fs.open(file,flags,mode);
 return {stat:h.stat.bind(h),sync:h.sync.bind(h),async close(){await h.close();if(process.env.OUTPUT_FAULT==='close')throw new Error('injected close failure');},async writeFile(bytes){
  if(process.env.OUTPUT_FAULT==='short')return h.writeFile(bytes.subarray(0,1));
  await h.writeFile(bytes);
  if(process.env.OUTPUT_FAULT==='cancel')globalThis.OUTPUT_ABORT.abort();
  if(process.env.OUTPUT_FAULT==='peer-edit'){await fs.writeFile(file,'peer bytes');throw new Error('injected same-inode peer edit');}
  if(process.env.OUTPUT_FAULT==='peer-prefix'){await fs.writeFile(file,'c');throw new Error('injected prefix peer edit');}
  if(process.env.OUTPUT_FAULT==='peer-empty'){await fs.writeFile(file,'');throw new Error('injected empty peer edit');}
  if(process.env.OUTPUT_FAULT==='peer-equal'){await fs.writeFile(file,'complete candidate');throw new Error('injected equal peer edit');}
  if(process.env.OUTPUT_FAULT==='replace'){await fs.rename(file,file+'.owned');await fs.writeFile(file,'peer bytes');throw new Error('injected write failure');}
 }};
}
`,
        );
        const loader = path.join(directory, 'runner.mjs');
        await writeFile(
            loader,
            `import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,n){if(s==='node:fs/promises'&&c.parentURL?.endsWith('/src/message-output.ts'))return {url:${JSON.stringify(pathToFileURL(wrapper).href)},shortCircuit:true};return n(s,c);}});
const {writeNewMessage}=await import(${JSON.stringify(new URL('../src/message-output.ts', import.meta.url).href)});
const output=process.argv[2];
const controller=new AbortController();globalThis.OUTPUT_ABORT=controller;
try{await writeNewMessage(output,Buffer.from('complete candidate'),{gitDirectory:output+'.admin',commonGitDir:output+'.common'},[],controller.signal);process.exitCode=9;}
catch{console.log('publication failed safely');}
`,
        );
        for (const mode of [
            'short',
            'race',
            'replace',
            'cancel',
            'peer-edit',
            'close',
            'peer-prefix',
            'peer-empty',
            'peer-equal',
        ])
            await t.test(`review I2 ${mode}`, async () => {
                const output = path.join(directory, mode);
                const result = spawnSync(process.execPath, [loader, output], {
                    env: { ...process.env, OUTPUT_FAULT: mode },
                    cwd: directory,
                    windowsHide: true,
                    encoding: 'utf8',
                });
                assert.equal(result.status, 0, result.stderr);
                assert.equal(result.stdout.trim(), 'publication failed safely');
                if (mode === 'close')
                    assert.equal(
                        existsSync(output),
                        false,
                        'verified owned state with unchanged metadata may be cleaned',
                    );
                else {
                    assert.equal(existsSync(output), true, `${mode} peer file must be retained`);
                    const expected =
                        mode === 'short' || mode === 'peer-prefix'
                            ? 'c'
                            : mode === 'peer-empty'
                              ? ''
                              : mode === 'cancel' || mode === 'peer-equal'
                                ? 'complete candidate'
                                : 'peer bytes';
                    assert.equal(await readFile(output, 'utf8'), expected);
                }
                if (mode === 'replace')
                    assert.equal(
                        await readFile(`${output}.owned`, 'utf8'),
                        'complete candidate',
                        'uncertain replacement keeps the residual owned artifact',
                    );
            });
    } finally {
        assert.equal(path.dirname(directory), await realpath(os.tmpdir()));
        await rm(directory, { recursive: true, force: true });
    }
});
