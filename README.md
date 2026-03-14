# job-search-cli

A personal CLI tool that fetches job listings, ranks them by relevance using Claude AI, and optionally tailors your resume for each top match — all without applying to anything automatically.

## What it does

1. **Fetches** listings from Remotive, The Muse, and Greenhouse company boards
2. **Filters** by location, seniority, recency (drops jobs older than 14 days), and keyword relevance — no AI cost at this stage
3. **Scores** remaining jobs 1–10 with Claude AI (Haiku model — fast and cheap)
4. **Writes** a ranked Markdown report to `output/jobs-YYYY-MM-DD.md`
5. **Optionally tailors** your resume for the top N matches (Claude Sonnet), saved as separate `.docx` files

You review the report and apply manually. The tool never applies on your behalf.

## Requirements

- Node.js 22+ (run `node --version` to check)
- An [Anthropic API key](https://console.anthropic.com/) (for AI scoring and tailoring)
- A [Muse API key](https://www.themuse.com/developers/api/v2) (free registration — unauthenticated rate limit is strict)

## Setup

```bash
# 1. Clone / download the project
cd job-search-cli

# 2. Install dependencies
npm install

# 3. Create your .env file
cp .env.example .env
# Edit .env and add your API keys

# 4. Create the output directory (required once before first run)
mkdir output
mkdir output/resumes

# 5. Edit config.json with your preferences (see Config section below)
```

## Running

| Command | What it does |
|---|---|
| `npm run dry-run` | Fetch + filter only — no Claude API calls, no cost |
| `npm start` | Full run: fetch + filter + AI score → ranked Markdown report |
| `npm run start:tailor` | Full run + tailor resume for top N jobs |

**Development mode** (no permission sandbox, easier debugging):

| Command | What it does |
|---|---|
| `npm run dev` | Same as `npm start` but without `--permission` flags |
| `npm run dev:dry-run` | Same as `npm run dry-run` but without `--permission` flags |
| `npm run dev:tailor` | Same as `npm run start:tailor` but without `--permission` flags |

Start with `npm run dry-run` to verify everything works before spending API credits.

## Config

Edit `config.json` to customize:

```json
{
  "profile": {
    "targetRoles": ["Frontend Developer", "React Developer"],
    "seniorityLevel": "mid",
    "skills": ["React", "TypeScript", "JavaScript", "CSS"],
    "preferredLocations": ["remote"],
    "excludeCompanies": ["CompanyYouHateWorking For"]
  },
  "sources": {
    "remotive": { "enabled": true, "searchQuery": "frontend developer" },
    "themuse": { "enabled": true, "level": ["Mid Level"] },
    "greenhouse": {
      "enabled": true,
      "companySlugs": ["vercel", "stripe", "figma"]
    }
  },
  "scoring": {
    "minimumScore": 6,
    "topN": 20,
    "maxAgeDays": 14
  },
  "resume": {
    "inputPath": "./input/resume.docx",
    "tailoringEnabled": false,
    "tailorTopN": 5
  }
}
```

### Finding Greenhouse company slugs

Go to a company's Greenhouse job board (e.g. `https://boards.greenhouse.io/stripe`) — the slug is the last part of the URL. Not all companies use Greenhouse; check their careers page.

## Sandboxing

The `npm start` / `npm run start:tailor` / `npm run dry-run` scripts use Node.js `--permission` flags (Node 22+) to restrict what the process can access:

- **Reads**: only `./input/` and `./config.json`
- **Writes**: only `./output/`
- **Network**: allowed (Node 22's `--allow-net` is still all-or-nothing, but the code enforces an internal allowlist — it will refuse requests to any host other than `remotive.com`, `www.themuse.com`, `boards-api.greenhouse.io`, and `api.anthropic.com`)

If you hit a permission error, use the `dev:*` scripts temporarily for debugging.

## Resume tailoring

- Drop your resume as `input/resume.docx`
- Run `npm run start:tailor` (or `npm run dev:tailor` without sandbox)
- Tailored resumes appear in `output/resumes/<company>-<title>-<date>.docx`

**Note**: The tailored `.docx` files have simplified formatting (headings, bullets, normal paragraphs). The content will be well-tailored but you should apply your own visual template before sending.

## API cost estimate (worst case per run)

| Step | Cost |
|---|---|
| Scoring 20 jobs (Haiku) | ~$0.001 |
| Tailoring 5 resumes (Sonnet) | ~$0.05–0.10 |
| **Total** | **< $0.12 per full run** |

## Troubleshooting

**"No jobs passed the pre-filter"** — Try loosening your config: add more `targetRoles`, increase `maxAgeDays`, or add more `preferredLocations`.

**Remotive returns 0 results** — Try a broader `searchQuery` in config (e.g. "javascript" instead of "frontend developer").

**The Muse returns 403** — Your `THEMUSE_API_KEY` in `.env` may be wrong or missing. Register at https://www.themuse.com/developers/api/v2.

**Greenhouse slug not found** — The company may not use Greenhouse, or their slug is different. Check `boards.greenhouse.io/<slug>` in a browser.

**Permission error running sandboxed scripts** — Use `npm run dev` instead, or ensure the `output/` directory exists before running.
