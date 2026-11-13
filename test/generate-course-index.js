/**
 * Writes programs/course-index.json (see course-index.js): every course the
 * generated program pages list, with its title, catalog hours, and link.
 *
 *   npm run generate-course-index
 *
 * Run it after npm run generate-programs.
 */
import { writeFileSync } from 'node:fs';
import { buildCourseIndex, COURSE_INDEX_PATH } from './course-index.js';

const index = buildCourseIndex();
writeFileSync(COURSE_INDEX_PATH, JSON.stringify(index, null, 0).replace(/\],"/g, '],\n"') + '\n');
console.log(`Wrote ${COURSE_INDEX_PATH}: ${Object.keys(index.courses).length} courses from ${index._meta.years.join(', ')}.`);
