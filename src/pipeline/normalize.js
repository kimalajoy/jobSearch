// Unified Job object shape — all pipeline stages depend on this contract
//
// {
//   id:          string   — "source:originalId"
//   title:       string
//   company:     string
//   location:    string
//   remote:      boolean
//   url:         string
//   postedAt:    string   — ISO date or "unknown"
//   fetchedAt:   string   — ISO timestamp of this run
//   description: string   — HTML-stripped, max 3000 chars
//   tags:        string[]
//   source:      string   — "remotive" | "themuse" | "greenhouse"
//   score:       null     — filled by scorer.js
//   scoreReason: null
// }

function stripHtml(str = '') {
  // Decode HTML entities first (Greenhouse double-encodes its content field),
  // then strip any real or decoded HTML tags, then clean up whitespace.
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(str, max = 3000) {
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function isRemote(location = '', title = '', tags = []) {
  const haystack = [location, title, ...tags].join(' ').toLowerCase();
  return haystack.includes('remote') || haystack.includes('anywhere') || location === '';
}

export function normalizeRemotive(raw) {
  const fetchedAt = new Date().toISOString();
  return {
    id: `remotive:${raw.id}`,
    title: raw.title ?? '',
    company: raw.company_name ?? '',
    location: raw.candidate_required_location ?? 'Remote',
    remote: isRemote(raw.candidate_required_location, raw.title, raw.tags ?? []),
    url: raw.url ?? '',
    postedAt: raw.publication_date ? new Date(raw.publication_date).toISOString().slice(0, 10) : 'unknown',
    fetchedAt,
    description: truncate(stripHtml(raw.description ?? '')),
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    source: 'remotive',
    score: null,
    scoreReason: null,
  };
}

export function normalizeMuse(raw) {
  const fetchedAt = new Date().toISOString();
  const location = raw.locations?.[0]?.name ?? '';
  return {
    id: `themuse:${raw.id}`,
    title: raw.name ?? '',
    company: raw.company?.name ?? '',
    location,
    remote: isRemote(location, raw.name ?? ''),
    url: raw.refs?.landing_page ?? '',
    postedAt: raw.publication_date ? new Date(raw.publication_date).toISOString().slice(0, 10) : 'unknown',
    fetchedAt,
    description: truncate(stripHtml(raw.contents ?? '')),
    tags: [],
    source: 'themuse',
    score: null,
    scoreReason: null,
  };
}

export function normalizeGreenhouse(raw, companyName) {
  const fetchedAt = new Date().toISOString();
  const location = raw.location?.name ?? '';
  return {
    id: `greenhouse:${raw.id}`,
    title: raw.title ?? '',
    company: companyName,
    location,
    remote: isRemote(location, raw.title ?? ''),
    url: raw.absolute_url ?? '',
    postedAt: raw.updated_at ? new Date(raw.updated_at).toISOString().slice(0, 10) : 'unknown',
    fetchedAt,
    description: truncate(stripHtml(raw.content ?? '')),
    tags: raw.departments?.map(d => d.name) ?? [],
    source: 'greenhouse',
    score: null,
    scoreReason: null,
  };
}
