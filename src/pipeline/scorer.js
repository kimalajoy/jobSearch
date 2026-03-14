import Anthropic from '@anthropic-ai/sdk';
import { createRateLimiter } from '../utils/rateLimiter.js';
import { logger } from '../utils/logger.js';

const BATCH_SIZE = 5;
const throttle = createRateLimiter(1100); // slightly over 1s for safety

function buildSystemPrompt(profile) {
  return `You are a job relevance evaluator for a senior frontend JavaScript engineer with 4+ years of professional experience.

Developer profile:
- Target roles: ${profile.targetRoles.join(', ')}
- Core skills: ${profile.skills.join(', ')}
- Preferred locations: ${profile.preferredLocations.join(', ')}
- Seniority: senior-level (4+ years, has led projects, mentored others, owns delivery)

Your job is to score each posting 1–10 based on how well it matches this developer's background.

=== SCORING RUBRIC ===

Score 9–10 (Excellent match):
- Job title is one of the target roles or a close equivalent (e.g. "Frontend Software Engineer", "UI Developer")
- Required tech stack overlaps with 4 or more of the developer's core skills
- Seniority level is appropriate: mid, senior, or unspecified (not explicitly junior/entry-level)
- Location is remote or matches preferred locations
- Example titles that qualify: "Senior Frontend Engineer", "Frontend Developer", "Software Engineer (Frontend)", "React Engineer"

Score 7–8 (Good match):
- Job title is in the frontend/JavaScript space but may not be an exact match
- Required tech stack overlaps with 2–3 of the developer's core skills
- Location is remote or acceptable
- Seniority is mid or senior
- Example: A "Full Stack Engineer" role where frontend is primary focus, or a role using Vue/Gatsby/React

Score 5–6 (Partial match):
- Role is adjacent — e.g. full-stack with significant backend emphasis, or mobile (React Native)
- 1–2 skill overlaps, or skills are transferable but not exact
- Location mismatch or partially on-site
- Could be a stretch but not unreasonable to apply

Score 3–4 (Weak match):
- Primarily backend, DevOps, or infrastructure roles
- Tech stack has minimal overlap (Java, Python, .NET, etc.)
- Title mismatch (e.g. "Data Engineer", "QA Engineer", "ML Engineer")
- Very junior role (internship, entry-level, associate) or very senior/executive (VP, CTO, Director)

Score 1–2 (Irrelevant):
- Completely unrelated domain: design-only, product management, sales, marketing
- Role requires skills the developer does not have (e.g. embedded systems, mobile native iOS/Android, blockchain)
- Extremely senior executive role (e.g. VP of Engineering, CTO)
- Company is in an explicitly excluded list

=== SENIORITY GUIDANCE ===

The developer has 4+ years of experience and has:
- Led project estimations and delivery timelines
- Mentored team members
- Built enterprise-scale component libraries used across 70+ websites
- Worked with cross-functional teams (designers, PMs, stakeholders)

Roles that are appropriate:
- "Senior Frontend Engineer" → excellent
- "Frontend Engineer" (no seniority specified) → excellent
- "Mid-level Frontend Developer" → good
- "Software Engineer II" → good (likely mid-to-senior equivalent)
Roles to penalize (hard caps — do not exceed these scores regardless of tech stack):
- "Staff Engineer" → score max 3
- "Principal Engineer" → score max 3
- "Lead Engineer" → score max 5, only if explicitly frontend-focused
- "Junior Frontend Developer" → score max 3
- "Entry-level Web Developer" → score max 2
- "VP of Engineering" / "Director of Engineering" → score max 2

=== SKILLS MATCHING GUIDANCE ===

Primary skills (strong signal): React, JavaScript, TypeScript, Vue, Gatsby, CSS/SCSS/LESS, HTML
Secondary skills (good signal): REST APIs, Git, AEM (Adobe Experience Manager), CMS, Webpack, Storybook
Transferable skills (acceptable): jQuery, Node.js (if frontend-primary), GraphQL, Next.js

Red flags (penalize if these are the ONLY required skills):
- Java, Python, Go, Rust, C++, C# (backend-only languages)
- iOS, Android, Swift, Kotlin (native mobile)
- SQL/NoSQL as primary skill
- Machine learning, data science, AI/ML engineering

=== LOCATION GUIDANCE ===

The developer prefers remote work exclusively.
- "Remote" or "Fully Remote" → no penalty
- "Remote-friendly" or "Hybrid" → minor penalty (−1 point)
- "On-site only" or specific city with no remote option → significant penalty (−2 to −3 points)
- No location listed → assume remote-friendly, no penalty

=== OUTPUT FORMAT ===

You will receive a batch of job postings. For each job output a JSON array where each element has:
  - "id": the job's id field (string, return exactly as given — do not modify)
  - "score": integer 1–10 based on the rubric above
  - "reason": one sentence explaining the score (max 20 words, be specific about what matched or didn't)

Output ONLY the JSON array. No text outside the JSON. No markdown code fences. No explanation.

Example of valid output:
[
  {"id": "abc123", "score": 9, "reason": "Senior React role, remote, strong TypeScript and CSS overlap."},
  {"id": "def456", "score": 4, "reason": "Full-stack role with heavy Java backend, minimal frontend work."}
]`;
}

function buildUserMessage(batch) {
  const items = batch.map(j => `
ID: ${j.id}
Title: ${j.title}
Company: ${j.company}
Location: ${j.location}
Tags: ${j.tags.join(', ') || 'none'}
Description excerpt: ${j.description.slice(0, 800)}
---`).join('\n');

  return `Score these ${batch.length} jobs:\n${items}`;
}

async function scoreBatch(client, batch, systemPrompt) {
  await throttle();

  let raw;
  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: buildUserMessage(batch) }],
    });
    raw = msg.content[0]?.text ?? '';

    const cacheCreate = msg.usage?.cache_creation_input_tokens ?? 0;
    const cacheRead = msg.usage?.cache_read_input_tokens ?? 0;
    if (cacheCreate > 0) logger.debug(`[scorer] Cache written: ${cacheCreate} tokens`);
    if (cacheRead > 0) logger.debug(`[scorer] Cache hit: ${cacheRead} tokens`);
  } catch (err) {
    logger.warn(`[scorer] Claude API error: ${err.message} — skipping batch`);
    return batch.map(j => ({ id: j.id, score: 0, reason: 'API error' }));
  }

  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    logger.warn(`[scorer] Could not parse JSON from response — skipping batch`);
    logger.debug(`[scorer] Raw response: ${raw}`);
    return batch.map(j => ({ id: j.id, score: 0, reason: 'Parse error' }));
  }

  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    logger.warn(`[scorer] JSON parse failed — skipping batch`);
    return batch.map(j => ({ id: j.id, score: 0, reason: 'Parse error' }));
  }
}

async function scoreJobsSync(jobs, config) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const systemPrompt = buildSystemPrompt(config.profile);
  const scoreMap = new Map();

  const toScore = [...jobs]
    .sort((a, b) => {
      if (a.postedAt === 'unknown') return 1;
      if (b.postedAt === 'unknown') return -1;
      return b.postedAt.localeCompare(a.postedAt);
    })
    .slice(0, config.scoring.topN);

  const batches = [];
  for (let i = 0; i < toScore.length; i += BATCH_SIZE) {
    batches.push(toScore.slice(i, i + BATCH_SIZE));
  }

  logger.info(`[scorer] Scoring ${toScore.length} jobs in ${batches.length} batches (model: claude-haiku-4-5, caching: enabled)`);

  for (let i = 0; i < batches.length; i++) {
    logger.info(`[scorer] Batch ${i + 1}/${batches.length}…`);
    const results = await scoreBatch(client, batches[i], systemPrompt);
    for (const r of results) {
      scoreMap.set(r.id, { score: r.score ?? 0, reason: r.reason ?? '' });
    }
  }

  return scoreMap;
}

async function scoreJobsBatch(jobs, config) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const systemPrompt = buildSystemPrompt(config.profile);

  const toScore = [...jobs]
    .sort((a, b) => {
      if (a.postedAt === 'unknown') return 1;
      if (b.postedAt === 'unknown') return -1;
      return b.postedAt.localeCompare(a.postedAt);
    })
    .slice(0, config.scoring.topN);

  const requests = toScore.map(job => ({
    custom_id: `job-${job.id}`,
    params: {
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: buildUserMessage([job]) }],
    },
  }));

  logger.info(`[scorer] Submitting ${requests.length} jobs to Batch API (50% discount, async)…`);
  const batch = await client.messages.batches.create({ requests });
  logger.info(`[scorer] Batch created: ${batch.id} — polling every 30s until complete…`);

  // Poll until done
  let completed = batch;
  while (completed.processing_status !== 'ended') {
    await new Promise(resolve => setTimeout(resolve, 30000));
    completed = await client.messages.batches.retrieve(batch.id);
    const { processing, succeeded, errored } = completed.request_counts;
    logger.info(`[scorer] Batch ${batch.id}: ${processing} processing, ${succeeded} done, ${errored} errors`);
  }

  logger.info(`[scorer] Batch complete — fetching results…`);

  // Fetch JSONL results
  const scoreMap = new Map();
  const response = await fetch(completed.results_url, {
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
  });

  const text = await response.text();
  const lines = text.split('\n').filter(l => l.trim());

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      logger.warn(`[scorer] Could not parse batch result line`);
      continue;
    }

    if (entry.result?.type !== 'succeeded') {
      logger.warn(`[scorer] Batch entry ${entry.custom_id} failed: ${entry.result?.error?.message ?? 'unknown'}`);
      continue;
    }

    const jobId = entry.custom_id.replace('job-', '');
    const raw = entry.result.message.content[0]?.text ?? '';
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      logger.warn(`[scorer] Could not parse JSON for ${entry.custom_id}`);
      continue;
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const r = parsed[0];
      if (r) scoreMap.set(jobId, { score: r.score ?? 0, reason: r.reason ?? '' });
    } catch {
      logger.warn(`[scorer] JSON parse failed for ${entry.custom_id}`);
    }
  }

  return scoreMap;
}

export async function scoreJobs(jobs, config, { useBatch = false } = {}) {
  if (!jobs.length) return jobs;

  const scoreMap = useBatch
    ? await scoreJobsBatch(jobs, config)
    : await scoreJobsSync(jobs, config);

  return jobs.map(job => {
    const s = scoreMap.get(job.id);
    if (!s) return { ...job, score: 0, scoreReason: 'Not scored (outside topN)' };
    return { ...job, score: s.score, scoreReason: s.reason };
  });
}
