// Finds the program files we check by hand (<id>-<catoid>.json, e.g.
// bcs-25.json) in programs/<year>/<department>/<type>/<program>/, next to the
// generated program.json that holds the catalog page's full requirement tree.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
export const PROGRAMS_DIR = join(ROOT, 'programs');
const CHECKED_FILE_RE = /^[a-z0-9-]+-\d+\.json$/;

// Every checked program file under dir: [{ file, path }], sorted by path.
export function checkedProgramFiles(dir = PROGRAMS_DIR) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...checkedProgramFiles(path));
    else if (CHECKED_FILE_RE.test(entry.name)) found.push({ file: entry.name, path });
  }
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

export function readCheckedPrograms(dir = PROGRAMS_DIR) {
  return checkedProgramFiles(dir).map(({ file, path }) => ({ file, ...JSON.parse(readFileSync(path, 'utf-8')) }));
}
