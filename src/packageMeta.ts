import fs from 'node:fs';

interface PackageMeta {
  name: string;
  version: string;
}

export function readPackageMeta(): PackageMeta {
  const url = new URL('../package.json', import.meta.url);
  return JSON.parse(fs.readFileSync(url, 'utf8')) as PackageMeta;
}
