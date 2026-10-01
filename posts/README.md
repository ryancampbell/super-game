# Posts

The studio's news and drops. One markdown file each; the site shows them at `/posts/` (newest first), on the home
page, and in two feeds: `/posts/feed.xml` (Atom) and `/posts/feed.json` (JSON Feed).

The file's name is its address: `posts/2026-09-30-we-are-live.md` is `/posts/we-are-live/`, dated by its prefix.

```markdown
---
title: We are live
date: 2026-09-30
summary: One line for the cards and the feeds.
game: crown-thief
image: /games/crown-thief/cover.jpg
---

The body, in markdown: **bold**, *italic*, [links](https://homie.rocks/), images, lists, quotes.
```

`game:`, `song:` and `video:` link one of this studio's games, songs or videos (by id or slug); the post shows
it with a Play, Listen or Watch button. `draft: true` keeps a post off the site. Raw HTML is shown as text.
Files README.md, and names starting with `_` or `.`, are not posts.
