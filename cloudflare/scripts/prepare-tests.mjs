import {mkdirSync,writeFileSync} from 'node:fs';
mkdirSync(new URL('../.test-build/',import.meta.url),{recursive:true});
writeFileSync(new URL('../.test-build/package.json',import.meta.url),'{"type":"commonjs"}\n');
