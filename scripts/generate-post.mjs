// scripts/generate-post.mjs
//
// Pulls recent items from a few free feeds, asks Gemini to draft one post
// synthesizing them (with your own framing, not just paraphrasing), generates
// an accompanying illustration, and writes a new Markdown file into
// src/content/posts/.
//
// Uses Google's Gemini API — it has a genuinely free tier (no credit card
// needed) that's more than enough for one post every 10 days. Get a key at
// https://aistudio.google.com/apikey
//
// Requires env var GEMINI_API_KEY (set as a GitHub Actions secret).
//
// Run locally with:  GEMINI_API_KEY=... npm run generate

import Parser from 'rss-parser';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const POSTS_DIR = path.join(ROOT, 'src/content/posts');
const IMAGES_DIR = path.join(ROOT, 'public/images');
const STATE_FILE = path.join(ROOT, '.generator-state.json');
const CADENCE_DAYS = 10;

// must match `base` in astro.config.mjs — update both together if you rename the repo
const BASE_PATH = '/coherence-log';

// --- 1. enforce the 10-day cadence regardless of when the workflow runs ---
async function shouldRunToday() {
  if (process.env.FORCE_GENERATE === 'true') return true;
  try {
    const raw = await readFile(STATE_FILE, 'utf-8');
    const state = JSON.parse(raw);
    if (!state.lastRun) return true; // no valid last-run date recorded -> treat as first run
    const last = new Date(state.lastRun);
    if (Number.isNaN(last.getTime())) return true; // malformed date -> treat as first run
    const daysSince = (Date.now() - last.getTime()) / (1000 * 60 * 60 * 24);
    return daysSince >= CADENCE_DAYS;
  } catch {
    return true; // no state file yet -> first run
  }
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
    'https://rss.arxiv.org/rss/quant-ph', // arXiv quant-ph new submissions
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

// --- 4. draft the post text with Gemini ---
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

  // Google deprecates/renames Gemini models fairly often. If both of these
  // ever 404, check https://ai.google.dev/gemini-api/docs/models for the
  // current free-tier model names and update this list.
  const MODEL_CANDIDATES = ['gemini-3.5-flash-lite', 'gemini-3.6-flash'];
  const apiKey = process.env.GEMINI_API_KEY;

  async function callGemini(systemInstruction, userText, maxTokens) {
    let lastError;
    for (const model of MODEL_CANDIDATES) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemInstruction }] },
            contents: [{ role: 'user', parts: [{ text: userText }] }],
            generationConfig: { maxOutputTokens: maxTokens },
          }),
        }
      );
      if (res.ok) {
        const data = await res.json();
        return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
      }
      lastError = new Error(`Gemini API error ${res.status} (model ${model}): ${await res.text()}`);
      console.error(lastError.message, '— trying next candidate model if any.');
    }
    throw lastError;
  }

  const body = await callGemini(system, user, 4096);

  // ask for a short title + summary separately (simpler + more reliable than parsing it out of the body)
  const titleText = await callGemini(
    'Respond with ONLY valid JSON, no preamble, no markdown fences: {"title": "...", "summary": "..."}. Title under 12 words, summary under 25 words, both describing the post body given to you.',
    body,
    600
  );
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

// --- 5. generate an accompanying illustration with Gemini's free image model ---
async function generateImage(title, summary, track) {
  // "Nano Banana" — Google's free-tier image model as of writing. If this
  // ever 404s/errors, check https://ai.google.dev/gemini-api/docs/models
  // for the current free-tier image model name and update this.
  const IMAGE_MODEL = 'gemini-2.5-flash-image';
  const apiKey = process.env.GEMINI_API_KEY;

  const style = track === 'quantum'
    ? 'a clean, minimal scientific illustration in the style of a physics textbook diagram — muted teal and dark ink tones, precise linework, no text or labels'
    : 'a clean, minimal technical illustration evoking software/systems architecture — muted amber and dark ink tones, precise linework, no text or labels';

  const prompt = `Create ${style}, illustrating the theme of this article: "${title}" — ${summary}. Abstract or conceptual is fine; avoid literal photorealism, avoid any text or logos.`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
        }),
      }
    );
    if (!res.ok) {
      console.error(`Image generation failed (${res.status}): ${await res.text()}`);
      return null;
    }
    const data = await res.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((p) => p.inlineData || p.inline_data);
    const inline = imagePart?.inlineData || imagePart?.inline_data;
    if (!inline?.data) {
      console.error('No image data in response — skipping illustration.');
      return null;
    }
    return Buffer.from(inline.data, 'base64');
  } catch (err) {
    console.error('Image generation error, skipping illustration:', err.message);
    return null;
  }
}

// --- 6. write the files ---
function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.error('Missing GEMINI_API_KEY env var.');
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

  console.log('Generating illustration...');
  const imageBuffer = await generateImage(title, summary, track);

  let bodyWithImage = body;
  if (imageBuffer) {
    await mkdir(IMAGES_DIR, { recursive: true });
    await writeFile(path.join(IMAGES_DIR, `${slug}.png`), imageBuffer);
    console.log(`Wrote public/images/${slug}.png`);
    bodyWithImage = `![Illustration for "${title}"](${BASE_PATH}/images/${slug}.png)\n\n${body}`;
  } else {
    console.log('No illustration generated — post will publish without one.');
  }

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

${bodyWithImage}
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
