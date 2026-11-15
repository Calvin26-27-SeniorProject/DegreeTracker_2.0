/**
 * Writes programs/whatif-programs.json (see whatif-programs.js): every major
 * and minor's requirement blocks, for the What if tab's estimates.
 *
 *   npm run generate-whatif-programs
 *
 * Run it after npm run generate-programs.
 */
import { writeFileSync } from 'node:fs';
import { buildWhatIfPrograms, WHATIF_PATH } from './whatif-programs.js';

const data = buildWhatIfPrograms();
writeFileSync(WHATIF_PATH, JSON.stringify(data).replace(/\},\{"name"/g, '},\n{"name"') + '\n');
const counts = Object.entries(data.catalogs).map(([catoid, c]) => `${c.programs.length} in catalog ${catoid}`).join(', ');
console.log(`Wrote ${WHATIF_PATH}: ${counts}.`);
