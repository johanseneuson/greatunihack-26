# GreatUniHack Track Resource Finder

Paste a hackathon track → get APIs, starter repos, awesome lists, models, datasets, papers, packages and Q&A for it, then pin the good ones to a shared team shortlist.

Zero dependencies — just Node 22+.

```bash
cp .env.example .env     # optional: add a GITHUB_TOKEN (no scopes needed)
npm start                # http://localhost:3000
```

Teammates on the same network can open `http://<your-ip>:3000`. Everyone shares the same tracks, pins and notes (stored in `data/store.json`).

## On the day

1. When tracks are announced, click **Bulk paste tracks** and paste them all at once — one block per track, blank line between, first line is the name.
2. Keywords are pulled from each description automatically; edit the query and hit **Fetch resources** to refine.
3. Pin useful results 📌 → **Copy as Markdown** to drop the shortlist into Discord/Notion.
4. Use **Team notes** per track for the idea / stack / who-does-what.

## Sources (all free, no key)

| Source | What for |
| --- | --- |
| GitHub repos / Awesome lists | starter code, prior art, curated link lists |
| public-apis catalogue | free APIs, flagged by auth / CORS |
| Hugging Face models & datasets | pretrained models, data |
| arXiv | papers |
| npm | JS packages |
| Stack Overflow / Hacker News | Q&A, discussions |

The "Common track library" (AI, FinTech, Health, Climate, Security, EdTech, Games, Civic, Hardware) comes with hand-picked links — edit `lib/presets.js` to add more (delete `data/` to reseed). Add a new source by adding an entry to `lib/sources.js`.

Without `GITHUB_TOKEN`, GitHub search allows only 10 requests/min, so bulk fetching many tracks will hit the limit. Results are cached for 1 hour.
