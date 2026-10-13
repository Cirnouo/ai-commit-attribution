import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSkillFiles, verifySkillFiles } from './build-skill.ts';
import { isMainModule } from './cli-entry.ts';
import { errorMessage } from './errors.ts';
import { SKILL_ROOT } from './skill-inventory.ts';

if (isMainModule(import.meta)) {
    try {
        if (process.argv.length !== 2) throw new Error('Usage: check-distribution.ts');
        await verifySkillFiles(
            path.join(fileURLToPath(new URL('../', import.meta.url)), SKILL_ROOT),
            await generateSkillFiles(),
        );
        console.log('Installed metadata, links, licenses, bytes and physical inventory verified.');
    } catch (error) {
        console.error(errorMessage(error));
        process.exitCode = 1;
    }
}
