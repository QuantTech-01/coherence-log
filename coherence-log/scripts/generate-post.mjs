// scripts/generate-post.mjs
//
// Pulls recent items from a few free feeds, asks Claude to draft one post
// synthesizing them (with your own framing, not just paraphrasing), and
// writes a new Markdown file into src/content/posts/.
//
// Requires env var ANTHROPIC_API_KEY (set as a GitHub Actions secret).
//
// Run locally with:  ANTHROPIC_API_KEY=sk-... npm run generate

import Parser from 'rss-parser';
import { writeFile, mkdir, readFile, access } from 'node:fs/promises';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const POSTS_DIR = path.join(ROOT, 'src/content/posts');
const STATE_FILE = path.join(ROOT, '.generator-state.json');
const CADENCE_DAYS = 10;

// --- 1. enforce the 10-day cadence regardless of when the workflow runs ---
async function shouldRunToday() {
  try {
    const raw = await readFile(STATE_FILE, 'utf-8');
    const state = JSON.parse(raw);
    const last = new Date(state.lastRun);
    const daysSince = (Date.now() - last.getTime()) / (1000 * 60 * 60 * 24);
    return daysSince >= CADENCE_DAYS;
  } catch {
    return true; // no state file yet -> first run
  }
}

async function recordRun() {
  await writeFile(STATE_FILE, JSON.stringify({ lastRun: new Date().toISOString() }, null, 2));
}

// --- 2. pick a track to alternate quantum / software each run ---
async function pickTrack() {
  try {
    const raw = await readFile(STATE_FILE, 'utf-8');
    const state = JSON.parse(raw);
    return state.lastTrack === 'quantum' ? 'software' : 'quantum';
  } catch {
    return 'quantum';
  }
}

// --- 3. free source feeds ---
const FEEDS = {
  quantum: [
    'https://export.arxiv.org/rss/quant-ph', // arXiv quant-ph new submissions
  ],
  software: [
    'https://hnrss.org/frontpage', // Hacker News front page as RSS
  ],
};

async function fetchItems(track) {
  const parser = new Parser();
  const items = [];
  for (const url of FEEDS[track]) {
    try {
      const feed = await parser.parseURL(url);
      items.push(...feed.items.slice(0, 8).map((i) => ({
        title: i.title,
        link: i.link,
        summary: (i.contentSnippet || i.content || '').slice(0, 400),
      })));
    } catch (err) {
      console.error(`Failed to fetch ${url}:`, err.message);
    }
  }
  return items;
}

// --- 4. draft the post with Claude ---
async function draftPost(track, items) {
  const sourceList = items
    .map((it, idx) => `${idx + 1}. ${it.title} — ${it.summary} (${it.link})`)
    .join('\n');

  const trackContext = track === 'quantum'
    ? 'quantum sensing, spin-defect qubits (e.g. hBN V_B-, NV centers), ODMR, and photonic integration'
    : 'software engineering tools, languages, and infrastructure trends';

  const system = `You write for "Coherence Log", a blog by a PhD researcher in quantum photonics. \
Voice: precise, low-hype, technically credible, a working scientist's/engineer's take rather than a news aggregator. \
You are drafting the ${track} track, which covers ${trackContext}. \
Never copy source text verbatim — synthesize in your own words and add a genuine point of view on why something matters or doesn't. \
Output ONLY the Markdown body of the post (no frontmatter, no title heading — the title goes in frontmatter separately). \
Keep it to 400-600 words.`;

  const user = `Here are recent items to consider (you don't have to use all of them):\n\n${sourceList}\n\nDraft one focused post synthesizing the most interesting 2-4 of these.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5', // check https://docs.claude.com for the current recommended model
      max_tokens: 1500,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  const body = data.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n').trim();

  // ask for a short title + summary separately (simpler + more reliable than parsing it out of the body)
  const titleRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 200,
      system: 'Respond with ONLY valid JSON, no preamble, no markdown fences: {"title": "...", "summary": "..."}. Title under 12 words, summary under 25 words, both describing the post body given to you.',
      messages: [{ role: 'user', content: body }],
    }),
  });
  const titleData = await titleRes.json();
  const titleText = titleData.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
  let title = 'Untitled entry';
  let summary = '';
  try {
    const parsed = JSON.parse(titleText.replace(/```json|```/g, '').trim());
    title = parsed.title;
    summary = parsed.summary;
  } catch {
    console.error('Could not parse title/summary JSON, using fallback.');
  }

  return { title, summary, body };
}

// --- 5. write the file ---
function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Missing ANTHROPIC_API_KEY env var.');
    process.exit(1);
  }

  if (!(await shouldRunToday())) {
    console.log('Less than 10 days since last generated post — skipping.');
    return;
  }

  const track = await pickTrack();
  console.log(`Generating a "${track}" post...`);

  const items = await fetchItems(track);
  const { title, summary, body } = await draftPost(track, items);

  const date = new Date().toISOString().slice(0, 10);
  const slug = `${date}-${slugify(title)}`;
  const sourcesYaml = items.slice(0, 4).map((it) => `  - label: ${JSON.stringify(it.title)}\n    url: ${JSON.stringify(it.link)}`).join('\n');

  const frontmatter = `---
title: ${JSON.stringify(title)}
date: ${date}
track: ${track}
summary: ${JSON.stringify(summary)}
sources:
${sourcesYaml || '  []'}
draft: true
---

${body}
`;

  await mkdir(POSTS_DIR, { recursive: true });
  await writeFile(path.join(POSTS_DIR, `${slug}.md`), frontmatter);
  console.log(`Wrote src/content/posts/${slug}.md (draft: true — review before flipping to false)`);

  await writeFile(STATE_FILE, JSON.stringify({ lastRun: new Date().toISOString(), lastTrack: track }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
