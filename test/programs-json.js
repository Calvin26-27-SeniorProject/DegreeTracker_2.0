// Pure helpers for generating programs/<year>/<department>/<type>/<program>/program.json
// from Calvin's Academic Catalog (see generate-programs-json.js). No network here,
// so these can be unit tested.

// `folder` is the year folder under programs/ (the catoid, as 20<catoid>);
// `label` is the catalog year the catalog calls it.
export const CATALOGS = [
  { catoid: '25', apiId: 8, folder: '2025', label: '2026-27' },
  { catoid: '24', apiId: 17, folder: '2024', label: '2025-26' },
];

export function slugify(text) {
  return String(text || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };

export function htmlToText(html) {
  if (!html) return '';
  return String(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(p|div|li|ul|ol|h\d|tr)>|<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match)
    .replace(/[\s\u00a0]+/g, ' ')
    .trim();
}

// "CS 108 - Introduction to Computing " → { code: 'CS 108', title: 'Introduction to Computing' }
export function parseCourseTitle(raw) {
  const text = htmlToText(raw);
  const split = text.indexOf(' - ');
  if (split === -1) return { code: null, title: text };
  const code = text.slice(0, split).trim();
  return { code: /\d/.test(code) ? code : null, title: text.slice(split + 3).trim() };
}

// "(3)" → "3", "(2, 4)" → "2, 4", "(1-4)" → "1-4"
export function parseCredits(raw) {
  const text = htmlToText(raw).replace(/^\(|\)$/g, '').trim();
  return text || null;
}

export function typeFolder(programTypes) {
  const name = (programTypes || []).map(type => type?.name).find(Boolean);
  return slugify(name) || 'other';
}

export function departmentOf(parents) {
  const list = (Array.isArray(parents) ? parents : [parents]).filter(Boolean);
  return list.find(parent => parent.hierarchy_type === 'Department') || list[0] || null;
}

export function departmentFolder(parents) {
  return slugify(departmentOf(parents)?.name) || 'unassigned';
}

export function totalHoursOf(cores) {
  for (const core of cores || []) {
    const match = /Total Semester Hours:\s*([\d][\d\s\-–,.]*)/i.exec(core.name || '');
    if (match) return match[1].trim();
  }
  return null;
}
