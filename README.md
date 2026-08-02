# Coherence Log

A quantum-sensing + software-trends blog that drafts a new post every 10
days from recent papers/articles, using the Anthropic API, then deploys
automatically to GitHub Pages.

## What's here

- `src/pages/`, `src/layouts/`, `src/content/posts/` — the Astro site
- `scripts/generate-post.mjs` — pulls recent items from a couple of free
  RSS feeds (arXiv quant-ph, Hacker News) and asks Claude to draft a post
- `.github/workflows/generate-post.yml` — runs daily; the script itself
  only actually writes a post once 10 days have passed since the last one
- `.github/workflows/deploy.yml` — builds and deploys to GitHub Pages on
  every push to `main`

## First-time setup (about 15 minutes)

1. **Create the repo.** Push this folder to a new GitHub repo, e.g.
   `github.com/YOUR_USERNAME/coherence-log`.

2. **Fix the site config.** In `astro.config.mjs`, set `site` and `base`
   to match your GitHub username and repo name.

3. **Enable GitHub Pages.** In the repo: Settings → Pages → Source →
   "GitHub Actions". That's it — the `deploy.yml` workflow handles the rest.

4. **Add your Anthropic API key as a secret.** Settings → Secrets and
   variables → Actions → New repository secret → name it
   `ANTHROPIC_API_KEY`, paste a key from console.anthropic.com.

5. **Push to `main`.** This triggers the first deploy. Your site will be
   live at `https://YOUR_USERNAME.github.io/coherence-log/` within a
   couple of minutes.

6. **Test the generator locally (optional but recommended):**
   ```bash
   npm install
   ANTHROPIC_API_KEY=sk-... npm run generate
   ```
   This writes a new file into `src/content/posts/` with `draft: true`
   in its frontmatter. Read it, edit it if needed, flip `draft` to
   `false`, commit, and push to publish it.

7. **Let the automation run.** From here, `generate-post.yml` runs daily
   but only actually drafts a post every 10 days (tracked in
   `.generator-state.json`, which the workflow commits back to the repo).
   New posts land with `draft: true` — review them before flipping to
   `false` and letting them go live. Once you trust the output quality,
   you can remove the draft gate and publish automatically.

## Local development

```bash
npm install
npm run dev       # http://localhost:4321
npm run build     # outputs to dist/
```

## Extending the source feeds

Edit the `FEEDS` object in `scripts/generate-post.mjs` — any RSS/Atom
feed URL works. Good free candidates: Quanta Magazine, Nature quantum
physics feed, your favorite engineering blogs' RSS, GitHub Trending
(via an RSS bridge), etc.

## On monetization

Don't add anything yet — get a run of real, reviewed posts live first.
Once you have ~20-30 posts and some organic traffic:
- **Google AdSense** — works best once you're clearly past "thin AI
  content" (the draft-review step above helps with this)
- **Newsletter** (Substack/Buttondown, free tiers) — often converts
  better than ads at small audience sizes
- **Affiliate links** — quantum computing books/courses, relevant tools

## Notes

- The `claude-sonnet-5` model string in the generator script is current
  as of writing — check https://docs.claude.com for the latest
  recommended model before you rely on this long-term.
- GitHub's free tier for public repos includes unlimited Pages hosting
  and enough Actions minutes for this workflow's needs.
