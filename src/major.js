import { isNonPassingGrade } from './core.js';

function normalizeCode(code) {
  return String(code || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function passingCourse(course) {
  return course.status !== 'in-progress'
    && course.status !== 'exemption'
    && !isNonPassingGrade(course.grade);
}

export function analyzeMajor(major, courses, courseAttempts = []) {
  return major.requirements.map(requirement => {
    const acceptedCodes = new Set((requirement.codes || []).map(normalizeCode));
    const matches = courses.filter(course => acceptedCodes.has(normalizeCode(course.code)));
    const occurrences = requirement.requiredOccurrences
      ? courseAttempts.filter(course => acceptedCodes.has(normalizeCode(course.code))
        && course.period && passingCourse(course))
      : [];
    const completed = matches.find(passingCourse);
    const inProgress = matches.find(course => course.status === 'in-progress');

    let status;
    if (requirement.requiredOccurrences && occurrences.length >= requirement.requiredOccurrences) status = 'complete';
    else if (requirement.requiredOccurrences && occurrences.length) status = 'manual-found';
    else if (completed) status = requirement.manual ? 'manual-found' : 'complete';
    else if (inProgress) status = 'in-progress';
    else status = requirement.manual || requirement.manualWhenMissing || acceptedCodes.size === 0
      ? 'manual' : 'incomplete';

    return {
      ...requirement,
      status,
      occurrenceCount: occurrences.length,
      matchedCode: completed?.code || inProgress?.code || null,
    };
  });
}
