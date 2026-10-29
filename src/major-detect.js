// Picks which major checklist to show from the programs a Workday export lists
// (its "Program of Study" table, e.g. "Computer Science, BCS"). Pure functions,
// so they can be tested without the bundled JSON.

const normalizeName = name => String(name || '').replace(/\s+/g, ' ').trim().toLowerCase();

// Majors whose `programName` appears in the listed program names, in the order
// the export lists them.
export function detectMajors(programNames, majors) {
  const listed = (programNames || []).map(normalizeName);
  return listed
    .map(name => majors.find(major => major.programName && normalizeName(major.programName) === name))
    .filter((major, index, found) => major && found.indexOf(major) === index);
}

// Program names found in pasted Workday text, for the supported majors only.
export function findProgramNamesInText(text, majors) {
  const haystack = normalizeName(text);
  return majors
    .filter(major => major.programName && haystack.includes(normalizeName(major.programName)))
    .sort((a, b) => haystack.indexOf(normalizeName(a.programName)) - haystack.indexOf(normalizeName(b.programName)))
    .map(major => major.programName);
}
