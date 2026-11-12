// Course titles and catalog links for a program, read from its generated
// program.json (programs/<year>/<department>/<type>/<program>/), so the Major
// and Minor pages can show every option's title and link it to the catalog.

// code → { title, url }, first listing wins.
export function courseIndex(catalogProgram) {
  const index = new Map();
  const walk = core => {
    for (const course of core.courses || []) {
      if (course.code && !index.has(course.code)) index.set(course.code, { title: course.title || null, url: course.url || null });
    }
    (core.children || []).forEach(walk);
  };
  (catalogProgram?.requirements || []).forEach(walk);
  return index;
}
