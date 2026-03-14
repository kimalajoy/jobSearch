import { logger } from '../utils/logger.js';

// Titles too senior for a "senior" level search (staff+ tier)
const TOO_SENIOR_TERMS = ['staff', 'principal', 'director', 'head of', 'vp ', 'vice president', 'cto'];
// Titles too senior for a "mid" level search (includes lead/senior)
const SENIOR_TERMS = ['senior', 'staff', 'principal', 'lead', 'director', 'head of', 'vp ', 'vice president', 'cto'];
const JUNIOR_TERMS = ['junior', 'entry', 'intern', 'graduate'];

function normalize(str) {
  return str.toLowerCase();
}

function containsAny(haystack, terms) {
  const h = normalize(haystack);
  return terms.some(t => h.includes(t));
}

function isJobStale(postedAt, maxAgeDays) {
  if (postedAt === 'unknown') return false; // assume recent if unknown
  const posted = new Date(postedAt);
  if (isNaN(posted)) return false;
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  return posted.getTime() < cutoff;
}

export function deduplicateJobs(jobs) {
  const seen = new Set();
  return jobs.filter(job => {
    const key = `${normalize(job.title)}|${normalize(job.company)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function prefilter(jobs, profile, scoringConfig) {
  const { excludeCompanies, preferredLocations, seniorityLevel, targetRoles, skills } = profile;
  const { maxAgeDays } = scoringConfig;

  const excluded = excludeCompanies.map(normalize);
  const locations = preferredLocations.map(normalize);
  const wantsRemote = locations.some(l => l === 'remote');

  let count = jobs.length;

  function logDrop(label, before, after) {
    if (before !== after) {
      logger.info(`[prefilter] ${label}: ${before} → ${after} (dropped ${before - after})`);
    }
  }

  // 1. Exclude companies
  let filtered = jobs.filter(j => !excluded.some(e => normalize(j.company).includes(e)));
  logDrop('Exclude companies', count, filtered.length); count = filtered.length;

  // 2. Staleness
  filtered = filtered.filter(j => !isJobStale(j.postedAt, maxAgeDays));
  logDrop(`Staleness (>${maxAgeDays} days)`, count, filtered.length); count = filtered.length;

  // 3. Location / remote
  filtered = filtered.filter(j => {
    if (j.remote && wantsRemote) return true;
    return locations.some(loc => normalize(j.location).includes(loc));
  });
  logDrop('Location/remote filter', count, filtered.length); count = filtered.length;

  // 4. Seniority
  if (seniorityLevel === 'senior') {
    filtered = filtered.filter(j => {
      if (containsAny(j.title, TOO_SENIOR_TERMS)) return false;
      if (containsAny(j.title, JUNIOR_TERMS)) return false;
      return true;
    });
    logDrop('Seniority filter', count, filtered.length); count = filtered.length;
  }
  if (seniorityLevel === 'mid') {
    filtered = filtered.filter(j => {
      if (containsAny(j.title, SENIOR_TERMS)) return false;
      if (containsAny(j.title, JUNIOR_TERMS)) return false;
      return true;
    });
    logDrop('Seniority filter', count, filtered.length); count = filtered.length;
  }

  // 5. Keyword gate — a target role OR skill must appear in the job title or tags.
  //    Uses word-boundary matching to avoid substring false positives
  //    (e.g. "git" matching "Digital", "css" matching "accessibility").
  const roleKeywords = targetRoles.map(normalize);
  const skillKeywords = skills.map(normalize);

  function wordMatch(text, keyword) {
    // Escape special regex chars in keyword, then wrap in word boundaries
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`).test(text);
  }

  filtered = filtered.filter(j => {
    const titleNorm = normalize(j.title);
    const tagsNorm = normalize(j.tags.join(' '));
    return (
      roleKeywords.some(kw => wordMatch(titleNorm, kw)) ||
      skillKeywords.some(kw => wordMatch(titleNorm, kw)) ||
      skillKeywords.some(kw => wordMatch(tagsNorm, kw))
    );
  });
  logDrop('Keyword relevance gate', count, filtered.length);

  logger.info(`[prefilter] Final: ${filtered.length} jobs passed`);
  return filtered;
}
