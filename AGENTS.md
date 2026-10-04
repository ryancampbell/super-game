# My Studio

This folder is a studio: **My Studio** (`my-studio`). It is one repository.
Its games, music, videos and posts live here; its website and public game rooms
run on the studio's **own Cloudflare account** (one Worker, one D1 database and
the Table/Lobby Durable Objects, all on Cloudflare's free Workers plan), built
from `@homie-rocks/studio`, pinned in `package.json`. The homie.rocks
directory lists its games; homie.rocks does not host them.

## Layout

| Path | What it is |
| --- | --- |
| `games/<id>/` | One game: `game.json` (id, name, blurb, players, round length), `index.html`, `src/main.ts`; and, when it has them, `tunables.json` (the numbers that shape how it feels: the Game Lab's sliders, kept values written back) and `lab.json` (the Game Lab's takes). |
| `music/`, `videos/` | Songs, scores, loops; trailers, music videos, cutscenes. `manifest.json` lists each one (`node_modules/@homie-rocks/studio/media/MEDIA.md`); a published entry gets a page at `/music/<slug>/` or `/videos/<slug>/`. Without storage the site serves each file itself (up to 25 MiB). Once the studio has storage (see below), its big media (over 1 MiB, or left out of git) lives in its own R2: every deploy uploads it, checks it by SHA-256 and serves it from R2 at the same address. Large files never go into git. The Homie plugin's `music` and `video` skills make them. |
| `games/<id>/assets/` | Every model and texture a game ships, with where it came from and its licence (`manifest.json`), and `RIGHTS.md` in plain words; `games/<id>/codex/decisions.json` (private, like the codex) is its look as decisions, and `style.json` the palette, fonts, light and camera the game draws with. `art/<slug>/` holds art jobs (concepts, receipts; `raw/` is git-ignored). |
| `posts/` | The studio's news and drops: one markdown file each (`posts/2026-09-30-we-are-live.md`: `title:`, `date:`, `summary:`, and `game:` / `song:` / `video:` to link one). They are the site's Posts, with Atom and JSON feeds. |
| `site/` | The studio's site: its look (`theme.json`), and anything of its own that wins over the generated pages (`site/README.md`); the Worker (`src/worker.mjs`) and its D1 migrations. |
| `wrangler.jsonc` | The Worker's Cloudflare config (the Worker, D1, the Table and Lobby Durable Objects, and `previews` for branch Previews), at the root, where Cloudflare's Workers Builds reads it. A studio made before 0.10.0 keeps it in `site/` and deploys from a computer; every command finds either. |
| `changes/` | One small file per change that went out through a pull request (`homie-studio progress pr` writes it): the site lists the newest, so the Claude app can tell when a merged change is live. |
| `perf/` | Performance reports, one folder per game (the Homie plugin's `perf` skill): `README.md` (the goal, before and after with the noise, every change tried and why it was kept or reverted), `numbers.json` and `before-after/`. The raw runs, screenshots and CPU profiles stay in `.perf/`, which git ignores. |
| `studio.json` | The studio's name, slug, Cloudflare resource names, custom domain and stats sharing. `.studio/` (git-ignored) is this computer's own state. |
| `.claude/skills/` | Skills only this studio uses. Homie's own skills come from the Homie plugin. |

## Commands (all through the pinned CLI in node_modules)

Use `npm run <script>` or `npx --no-install homie-studio <command>`: `--no-install` makes sure it is this
studio's pinned copy, never a registry lookup of the bare name.

- `npx --no-install homie-studio demo` — a live multiplayer game to try right now (on Homie Arcade, with
  whoever is playing and bots in the empty seats). Nothing is copied into this studio.
- `npx --no-install homie-studio game new <id> --from gem-rush --name "<Name>"` — a new game from a
  multiplayer starter (one live public room from its first build, bots fill seats). A new studio starts with no
  game: copy a starter only when the person asks for one, or once their game is planned.
- `npx --no-install homie-studio port plan <folder>` — read an existing single-player web game and grade
  how hard making it multiplayer will be; `port import` brings it into `games/`, `port check` runs the
  owner tests (real touch, a late joiner, a killed host, two browsers finishing a round). The Homie
  plugin's `port` skill does the whole job.
- `npm run build` — bundle every game into `site/dist`.
- `npm run dev` — the whole site locally (pages, the netplay relay in a local
  Durable Object, D1): open the printed address in two browsers and they share a room.
  Stop it with `npx --no-install homie-studio dev --stop` (this studio's dev server only;
  never `pkill` by name, which stops other projects' dev servers too).
- `npx --no-install homie-studio check <id> --url <site>` — two headless browsers press Play and must
  land in the same room and finish a round. Run it before you say a game works.
- `npx --no-install homie-studio perf <id> --url <site>` — how fast a game runs, on a computer and an emulated
  phone, with two browsers in a room (the host and a replica): frame times, the game's JavaScript and the main thread
  per frame, time to playable, what it downloads, the heap, netplay messages a second (files under `.perf/`). The
  Homie plugin's `perf` skill runs the whole loop: one change at a time, kept only when it is better beyond the noise
  and `check` still passes, and a report in `perf/<id>/`.
- `npx --no-install homie-studio lab <id>` — the Game Lab, on this computer (run it in the background; stop it with
  `lab --stop`): one take of a move (`games/<id>/lab.json`) played in the working tree beside the last commit, on
  one clock, slowed down or a frame at a time, with the phases, graphs and tunables the game reports
  (`@homie-rocks/studio/lab`). `lab check <id>` plays it headless and writes the numbers and a contact sheet. The
  Homie plugin's `lab` skill runs the whole loop: instrument and commit first, change how it feels, keep what the
  person likes.
- `npx --no-install homie-studio deploy --plan` — says what deploy will create on Cloudflare and what it
  costs, and changes nothing. Tell the person before the first deploy.
- `npm run deploy` — the site on this studio's Cloudflare: one Worker, one D1 database, two
  SQLite-backed Durable Objects, all on the free Workers plan (no payment method needed).
  If Wrangler is not signed in, run `npx wrangler login`: the person approves once in
  their browser. It never overwrites a Worker or database this studio did not create.
- **Workers Builds** (Cloudflare's own CI, set up by the "Deploy to Cloudflare" button or in the dashboard): on
  every push to `main` it runs `npm run build` and `npm run deploy`, which in Workers Builds only applies
  the D1 migrations and deploys (it never creates or refuses anything); on every other branch it runs
  `npm run build` and `npx wrangler preview`, a Preview URL with its own rooms. The live site claims itself
  in the homie.rocks directory the first time it is read, so nothing is stored by hand.
- `npx --no-install homie-studio storage add` — only when the studio has songs or videos: an R2
  bucket on the studio's own Cloudflare account. Cloudflare asks for a payment method on the account
  before R2 works, so this is a separate step the person agrees to; nothing else needs it. R2 has no
  egress fees; storage is free up to 10 GB-month, then US$0.015 per GB-month.
- `npx --no-install homie-studio media move` (`--dry-run` first) — with storage, the big files of
  published songs and videos (over 1 MiB, or left out of git; studio.json `media.r2Over` changes the
  size) go to R2: each is uploaded, read back and checked by SHA-256, and only then does the site stop
  carrying it; it keeps its address, and the file stays in this folder. Every `npm run deploy` does
  it too; once a file is in R2 (the committed manifest says so), a deploy from another computer or
  Workers Builds still serves it. `media list` says where each file is served from.
- `npx --no-install homie-studio publish` — list this studio's games in the homie.rocks directory
  (or call the Homie MCP tool `studio_publish`).
- `npx --no-install homie-studio stats` — the studio's own numbers, for its owner: visits, Play presses,
  rooms, the most people playing at once, rounds, songs played, videos watched, and where visitors came
  from (homie.rocks, other studios, search, the web). `stats link` gives the owner a one-time link to the
  private page `/_studio/stats` in their own browser; `stats key` a short read key for the Homie MCP tool
  `studio_stats` (never paste a key anywhere else). `stats share on` tells the directory two numbers
  (played this week). The site counts and never tracks: no cookie on a visitor, no person identified,
  nothing sent anywhere; house QA and `check` runs are not counted.
- `npx --no-install homie-studio players` — how many players have accounts here (and guests, and who played
  this week): counts and names for the owner, never a passkey or an email. `players owner` gives the owner a
  one-time link that marks their own player account (a passkey on this site) as the owner's, so their games and
  the studio's back office recognise them.
- `npx --no-install homie-studio upgrade` — after pinning a newer `@homie-rocks/studio` (or through
  `npx -y --package=<its tarball> homie-studio upgrade`): what the newer template adds to this studio (AGENTS.md
  sections, READMEs, .gitignore lines) and what it keeps. It changes nothing until `--apply`, and never
  touches a file or section this studio changed; `--diff` shows how those differ from the template's.

## The site

`npm run build` makes the studio's site from what is in this folder
(`node_modules/@homie-rocks/studio/site/SITE.md` says all of it):

- **Sections, like homie.rocks:** Home (the featured game, live rooms, latest posts), Games, Music, Videos,
  Rooms (every public room playing now, joinable and watchable) and Posts. A section with nothing in it has no tab, and its
  page is not found.
- **A new studio goes live with its Home only:** its name and "First game coming soon", with what is on the way
  (games, posts, music and videos), until its first game, song or video is published. A post shows there at once.
- **Every game gets a landing** at `/<id>/`: a full-bleed hero from the game's own footage
  (`games/<id>/hero/wide.mp4` and `tall.mp4`, or a trailer in `videos/` with `for.game`), else its cover
  with slow motion; the pitch, a big Play button into a public room, phone / computer / TV with the join code,
  live rooms, how to play, credits, and "Make a game like this". Give it words in game.json's `landing` block
  (`pitch`, `about`, `controls`, `howToPlay`, `credits`) and art with the plugin's `art` and `video` skills.
- **The look** is `site/theme.json` (colours, fonts, corner radius, a logo). Anything in `site/` wins: a whole
  page in `site/pages/`, a piece of every page in `site/partials/`, files in `site/public/`, extra CSS in
  `site/theme.css` (`site/README.md`). A game whose picture is white or cream gets a light landing with
  game.json `"landing": { "scheme": "light" }` (a dark tint would turn it grey).
- **Cards and the directory** show each game's landing still (`hero/wide.jpg`), else its cover. A song without
  a cover of its own shows the music manifest's `cover`, else its game's still.
- **Live rooms** are listed on homie.rocks too; studio.json `"rooms": { "share": false }` keeps them off it.
- **Search engines and AI agents** read every page's schema.org data (a full VideoGame on each landing) and
  `/robots.txt`, `/sitemap.xml`, `/llms.txt`, made from what is public. Give a game game.json `"genre"`, put
  pictures of play in `games/<id>/screenshots/`, give each video a `"date"`, and never invent ratings.
- Every page ends with "Made with Homie", linking to homie.rocks/studio/. Restyle it in `site/theme.css`; keep it.

## Making games

- Every game is multiplayer on the web through the netplay contract
  (`node_modules/@homie-rocks/studio/netplay/NETPLAY.md`): every browser renders the game
  itself, one browser hosts the rules, strangers meet in public rooms, bots fill empty
  seats, anyone arriving takes a bot's place, rounds end and restart on their own.
- Import it as `import { createNetplay } from '@homie-rocks/studio/netplay'`.
- Phones and computers: touch controls on phones only, keys on computers; keep the
  centre of the screen clear during play.
- The play page's small room button (Invite, Big screen, the room code) sits top right, with the Chat pill
  beside it (a round icon on a phone, as the room button is). If the game's scoreboard or a bar is there, move
  both in game.json `"screen": { "share": … }`: a corner or `top-center`, per device (`desk`, `phone`,
  `sideways`), with an `x` / `y` offset in pixels, and `"label": false` to keep them small icons
  (`node_modules/@homie-rocks/studio/site/SITE.md`). Room chat's strip of new lines shows for a moment at the
  bottom left: if the game's HUD or controls are there, `"screen": { "chat": … }` puts it where the game has
  room (`at`: a corner, `top-center` or `bottom-center`; `x` / `y`; per device, and `tv` for the big
  screen), or `"lines": "sheet-only"` keeps new lines in the Chat sheet, the pill counting them, so a game with
  a busy HUD keeps typed chat (`node_modules/@homie-rocks/studio/chat/CHAT.md`). Look at both on a phone and a
  computer while a round is on and somebody says something.
- **Watch any player.** Every live room can be watched at `/<id>/watch?room=<room>` (each room on the Rooms page
  and the landing has a Watch button): the game itself, drawn by the watcher's own browser, which never takes a
  seat, with a strip of the players to switch between (a tap, keys 1-9, A for Auto, O for the whole room). Point the
  camera and the HUD at `net.viewSeat` (your own seat when playing; the followed player when watching; null: the
  overview camera; `room.viewBody()` in a port), and call `net.spotlight(seat)` on a hit, a kill or a goal so
  Auto cuts to it (`NETPLAY.md` section 16). A game that never reads `viewSeat` is watched as its overview. A
  game with hidden hands or roles says game.json `"watch": "overview"` (the whole room only) or `false` (no
  watch door); a private or invite-only game is watched only by those it lets in.
- Change a game in small steps, build, and look at it (`dev`, then `check`).
- A game's id is its URL (`/<id>/`); keep it once published.
- **Remixing.** A public game shares its source at `/games/<id>/source.json`, with who made it (the studio, the
  game, its page) and the licence its owner picks in game.json `"license"`: `"remix-with-credit"` (the
  default), `"remix-freely"` or `"no-remix"`, and `{ "kind": "…", "spdx": "MIT" }` to name a licence too.
  `npx --no-install homie-studio game remix <source.json> --id <new id>` brings another studio's game in as a new
  game here: its game.json `remixOf` says "Remix of <game> by <studio>" with a link back, and its landing and
  credits show it; keep that credit. A game whose licence says no remix is refused.
- **Progress that lasts** (a character, unlocks, a collection, days of play) goes in **saves**, never in the room:
  a room forgets everything 60 s after its last player leaves. game.json `"saves": true` and
  `createSaves` from `@homie-rocks/studio/saves` (`node_modules/@homie-rocks/studio/saves/SAVES.md`): per
  player and game, versioned, offline-tolerant, in this studio's own D1. Pressing Play needs no account; a guest's
  progress stays on that device until they make a passkey account (at `/account/`, or the game's own button), and
  then it follows them to every device. Lifetime stats and a hardcore "hall of the fallen" are in it too. The
  `ember-vale` starter shows the whole pattern.

## The Game Codex and progress

- **Every game has a Game Codex:** `games/<id>/CODEX.md`, its plan in plain words for everyone who makes it, coder
  or not: concept, world, characters, art direction, controls per device, rooms and players, music and sound,
  milestones, open questions, and under Latest the decisions as they are made, newest first, each with its date.
  It is the source of truth: when a decision changes, change the codex in the same change.
  `npx --no-install homie-studio codex new <id>` starts one with every section.
- `npx --no-install homie-studio codex <id>` draws it as a page in the game's own look
  (`.studio/codex/<id>.html`, `--open` opens it; `--artifact` makes a copy to publish as a Claude artifact).
  The site has it too, for the owner only and never listed: `codex link <id>` gives the one-time sign-in link.
- **Progress:** `npx --no-install homie-studio progress start <id> --title "<what this build does>"` opens a
  build's progress feed; build, check and deploy report into it. The codex page's Build status tab redraws itself
  as it moves (stages, checks going green, how to try it, spend), and `homie-studio statusline --install` puts
  one line of it under the prompt in Claude Code.
- `npx --no-install homie-studio setup status` says what this computer and the person's accounts have (Node,
  Cloudflare, Chrome, ffmpeg, GitHub, ElevenLabs, fal), what each unlocks, and the exact fix. Optional ones never
  block anything.

## Art direction and models

- **A game's look is a set of decisions** (`games/<id>/codex/decisions.json`, drawn in the codex's Art direction
  tab): render style, palette, shape, proportions, materials, light, camera, fonts, effects; the cast, its library
  family, scale and phone budgets. `npx --no-install homie-studio style init <id> --prompt "<the person's words>"`
  picks every one automatically with a why. The person can steer one ("warmer"), lock one, or explore three
  directions drawn by the game engine itself (`style board <id>`, free). The first asset built on a decision pins
  it; a locked one changes only with the person's yes after `style blast` shows what goes stale and what remaking
  it would cost. Nothing is ever remade by itself. The Homie plugin's `style` skill has the rest.
- **Models come free first**: the engine, then Homie's CC0 starter library (`assets find "<words>"`, then
  `assets add <id> <item>`, copied in, never hot-linked), then the person's own files (`assets add <id> --file …
  --license …`), then generated props on the person's own fal account under a budget with receipts (the plugin's
  `models` skill). Every model is checked (no external URIs, no oversized files), made phone-sized and recorded
  with its licence; `RIGHTS.md` and the credits page follow. `assets check <id>` holds a game to the phone
  budgets; `assets lineup <id>` shows everything at true scale. A three.js game loads models through
  `@homie-rocks/studio/assets` (`createModels`); `game new <id> --from gem-rush-3d` starts one.
- **Characters and clips**: an animated library character (`assets find "knight" --kind character`) comes in
  phone-sized, one draw call, its bones named by the skeleton standard, its clips in one shared clip library per
  skeleton (`public/anims/<skeleton>.glb`); `anim plan <id>` lists each one's clips against the verbs the game
  needs, `anim add <id> <asset> --verbs jump,attack` retargets more onto it (free), `anim preview <id>` draws
  them looping. A game plays them through `@homie-rocks/studio/animate` (`loadCharacter`: blends, hits, jumps,
  lean, look-at, crowds; every number a Game Lab tunable); `game new <id> --from hero-rush-3d` starts one. The
  plugin's `animate` skill has the rest.
- **Licences**: a public game ships only assets whose licence allows it (CC0, CC BY with credit, the studio's own,
  generated); `publish` refuses an asset with no licence record. A remix gets each redistributable model,
  checked by SHA-256, and a grey placeholder for the rest.

## Running live games (the back office)

- The owner runs the studio's live games from `/_studio/office` (`npx --no-install homie-studio office link` gives
  the owner a one-time sign-in link): every live room of every game, who is in it (handles; accounts once players
  sign in), bots, the round and uptime, refreshing by itself; Kick (that player cannot come back to that room for
  the minutes chosen), Mute (their chat and emotes reach nobody), Announce (one line every player sees), Close a
  room; and per game: launch state, Remixable, players per room and invites.
- **Launch states:** `private` (only the owner, signed in; `office link --to /<id>/play` signs the owner's phone
  in), `invite` (an invite-only beta: `office invite <id>` makes invite links and codes, each for one browser or
  as many as `--uses` says), `public` (the default; listed). A game that is not public is in no list and not in
  the directory manifest, so the directory drops it the next time it reads the studio. A new game stays private
  from its first deploy with `"launch": "private"` in its game.json. **Remixable** publishes or withdraws its source.
- The owner is recognised in their own games: signed in, their play page has a small Owner button (tap a player:
  Mute, Kick; Announce). Nobody else's page has it.
- **From the AI:** `npx --no-install homie-studio office` lists who is playing now; `office announce "<text>"` and
  `office invite <id>` happen at once; `office kick`, `office mute`, `office close` and `office launch` only ASK, and print a
  one-time link that opens the ask in the owner's own browser, where one tap does it. An ask is not done until the
  owner tapped. `office key` gives a key for the Homie MCP's owner tools (`studio_office`, `room_announce`,
  `room_kick`, `room_close`, `game_launch_state`), which ask the same way; never paste a key anywhere else.
- A game can listen (`NETPLAY.md` section 15): `net.on('announce', …)`, `net.isMuted(seat)` to hide a muted
  player's chat, and `net.pickPlayer(seat)` when a player is clicked (the owner's page opens their card).

## Servers and AI seats

- **A server** is a named, lasting pool of rooms for one game, with its own policy and door. Strangers are matched
  only inside one server. Every game's `pub-N` rooms are its `public` server (Quick play), so old links keep
  working. A server's page is `/<id>/s/<server>/`; its rooms are `s-<server>-<n>`; `/<id>/servers/` lists them.
- **Policies:** `open` (anyone; an AI with an agent pass may sit, always marked AI), `humans-only` (no AI of any
  kind; the game's bots are off unless `--bots fill`), `hybrid` (N seats in every room are AI companions),
  `beginner` (accounts under 30 days, AI guides, quick lines only, optionally `--kids`: handles only, the AI's
  level at most 3). **Doors:** `open`, `accounts` (a passkey account) or `invite` (`office invite` with
  `--server`). AI is ALWAYS marked AI: every agent's name ends in " · AI", and the relay, not the game, enforces it.
- `npx --no-install homie-studio servers` lists them; `servers new <id> "<Name>" --policy hybrid --ai 2` (or
  `--policy beginner --guides 2 [--kids]`, `--policy humans-only`) makes one at once; `servers set <id> <server>
  --level-max 3 …` changes one; `servers close <id> <server>`. A change that narrows who may come in (humans-only,
  a stricter door) and closing one only ASK, with the owner's one-tap link, like `office kick`.
- **The skill dial:** every room has a level, 1 Rookie, 2 Steady, 3 Fair, 4 Strong, 5 Maxed, each `{ reactionMs,
  aimNoise, aggression, positioning }`. The party sets it by voting on a card in the play page (the middle vote
  wins, capped by the server's ceiling). Make a game's bots honour it: `net.skillOf(slot)` in their step (the
  snippet is in `NETPLAY.md` section 17; `BotBrain` from the port kit reads it with a rebuild), and declare
  `caps: ['skill', 'agents']` in `createNetplay` (a game on `createRoom` has `agents` already). A build
  from before 0.16.0 still plays on every server; the office says it predates servers until it is rebuilt.
- **Agent passes:** `npx --no-install homie-studio agents pass <id> --label Claude [--server <server>]` gives an
  AI its way into a seat (shown once; `agents revoke <pass>` ends it). It sits with `POST /<id>/api/agent`
  (Bearer pass), only in a room with people in it, and never on a humans-only server.
- **AI guides that talk (0.17.0):** a beginner server's guides get a brain. A game's own words for them are
  `games/<id>/agents.json` (its vocabulary: goals, lines, the asks a player taps; the build checks it), and
  `useAgents` from `@homie-rocks/studio/agents` is the host's side: a view per guide, the scripted floor, goals
  for the hands, lines drawn from the vocabulary (`NETPLAY.md` section 18; Ember Vale is the reference). The
  brain is the server's: `agents brain <id> <server> workers-ai` (the studio's own Workers AI; `npm run deploy`
  binds it; at most `--budget` neurons a day, 8,000 by default) or `owner-key` (the owner's own key, set with
  `agents brain key` on this computer, never in a chat; a dollar cap a day). The first time AI talk is turned on
  it only ASKS. The AI never types: it picks a goal and a line id; the relay drops anything else. With no AI, over
  budget, or between decisions, the game's `decide` plays. `agent_sit` (the local MCP) puts the owner's own
  Claude in a guide's seat.
- **Clef (0.24.4):** Workers AI's guides think with Cloudflare's decision model `@cf/cloudflare/clef-flash` (it
  picks among the vocabulary's goals, values and lines; it never writes text; about 9 neurons a decision).
  `agents try <id> --view <file> [--ask …] [--model …]` shows what the brain would decide in one moment. Under
  `npm run dev`, Clef on this computer (Ollama with `clef-flash`) runs the guides, chat review and game
  decisions for free when it is here; **never download it without the person's yes** (`ollama pull clef-flash` is
  about 11 GB). A game whose game.json says `"decide": true` may ask `net.decide(state, questions, { floor })`
  on the host (`NETPLAY.md` section 20): per beat or per turn, never per frame.

## Selling things (the shop)

- **The studio sells with its OWN Stripe account.** The studio is the seller: its prices, its refunds, its tax, its
  disputes. Money goes from players to the studio's Stripe; homie.rocks never sees it and Homie takes no cut.
  `SELLING.md` says what that means for the owner in plain words (not legal advice).
- **`shop.json`** (at the studio's root, reviewed in git): `till` (`stripe`, the studio is the seller with Stripe
  Tax on; `stripe-managed`, Stripe Managed Payments is the seller of record and files the tax for 3.5% more; or
  `off`), `currency`, `refundDays` (at least 14), `capPerPlayerMonth` (cents, at most 5000) and `items`:
  `{ "id", "kind": "cosmetic"|"supporter"|"pass"|"unlock"|"tip", "name", "price": <cents>, "gives": ["skin:ember"],
  "days"?, "game"?, "advantage"? }`. Real money only: no gems, coins or points. `npx --no-install homie-studio shop
  init --supporter` writes a US$5 Supporter pack; `shop check` and every build refuse what the kit refuses.
- **The kids rules are the kit's, not the studio's to switch off:** nothing random for money (an item that names
  chance, odds, a crate, a box or a mystery is refused), no countdown offers, no shop on a kids server or in a studio
  with `"audience": "kids"` in studio.json, spending off on every account until a neutral age question says adult,
  nothing ever for under-13s, 13-17 only through a parent's own checkout (a one-time link), nothing with
  `"advantage": true` on a beginner server, one hosted Stripe checkout per purchase, a monthly cap. The television
  never sells: its store sheet is a code to buy on a phone.
- **In a game:** `import { createShop } from '@homie-rocks/studio/shop'`; `shop.has('skin:ember')`,
  `shop.entitlements()`, `shop.on('change', …)`, `shop.open(item)` from a button the player pressed (never the
  play button, never on a timer), `shop.used(key)` when it is equipped. A supporter's badge rides on their seat
  (`peer.badge`, set by the Worker, never by a hello). The guide is `node_modules/@homie-rocks/studio/shop/SHOP.md`.
- **Stripe's own tools** (set up when the studio starts selling): `npm install -g @stripe/cli@latest && stripe agent
  setup` installs Stripe's agent plugin (its MCP server and skills); the owner signs in once on Stripe's page and
  gives access to a sandbox first. With it you make the catalog (`npx --no-install homie-studio shop catalog` says
  the read, then the exact `stripe_api_write` calls), check tax settings, and answer "how are sales?" read-only.
  Never make a webhook or an API key through the MCP (a secret would land in the chat), and never retry a write
  Stripe sent to the owner for confirmation until they approved it.
- **The key** goes in only from a page on the owner's own computer: `npx --no-install homie-studio shop connect`
  prints a 127.0.0.1 link; the owner pastes one restricted key there, the page makes the webhook with it, and the
  key and the webhook's secret go straight to the Worker secrets. Test keys only unless `--live`. Never ask for a
  key in the chat; never write one anywhere.
- **Refunds:** the owner's one tap in the office (`/_studio/office/shop`). You may only ASK:
  `homie-studio shop refund <order>` gives the owner a one-tap link. A card dispute never touches the player's
  account. `shop` says what is missing; `shop orders` lists orders (never a card or an email).
- **Referrals:** a `?via=<host>` link from another site (homie.rocks is one more referrer) is remembered on a new
  player's first visit; a kept sale owes that referrer the rate in `shop.json` `referrals`. `shop statements`
  signs them; the referrer invoices the studio. Nothing moves through Homie.

## Continuing a build from the Claude app

A Claude Code session started from the Claude app's card gets one short line, like
`Continue building Night Owls: build hb_…`. `HANDOFF.md` says what to do with it:
`npx --no-install homie-studio handoff hb_…` fetches the brief the person gave in the chat, takes the build (the
chat's card follows the work from then on) and, for a studio still being set up, checks in from this repository.

## Rules

- Keys stay in the providers' own logins (Wrangler, ElevenLabs, fal) or the OS
  keychain. Never write a key, token or password into this repository.
- Never touch a Cloudflare resource this studio did not create (`studio.json` says which).
- The site's workers.dev address names the Cloudflare account (often after its owner): `deploy` keeps it in
  `.studio/local.json`, which git ignores. Never copy it into a committed file. A custom domain goes in
  studio.json as `cloudflare.domain`.
- A game's room size is its netplay manifest's `maxPlayers` (game.json `netplay`, or netplay.json), up to 32.
- Nothing in this studio needs `~/.homie` or a Homie box.
- Optional in studio.json: `"protect"` (globs of files the owner wants to look at before any change, such as
  `"games/*/game.json"`) and `"budget"` (`{ "usd": <n>, "credits": <n> }`: the most the studio's media jobs spend
  in all). In Claude Code, the Homie plugin's mod holds an edit to a protected file, a deploy, and a paid call past
  the budget until the person says Proceed, and takes keys out of command output. When it refuses a call, say what
  you meant to do and why; do not retry it unless the person asks.

## Telling Homie

The people who make Homie read every note, and someone who is stuck rarely writes to a forum. So when the person is
stuck, confused or frustrated, after an error you could not fix, or at the end of their first studio setup or first
publish, you may OFFER, once in a session, to send them a short note about it: the Homie MCP's `homie_feedback`
(in Claude Code also `/feedback`, and Tell Homie in the Studio pane). Draft it in plain words from what happened
(what they tried, what they expected, what they saw); a draft sends nothing. Show it exactly as it would go, and send
it only after they say yes (in Claude Code, Claude Code itself asks them with the exact note). Never nag: a no is
final for the session, and help never depends on it. Never put a key, a log, a file, code or anyone's name in a
note; a reply address only if they typed it. When they ask to tell Homie something, draft it with
`offered: false`.

## Beta

Homie for studios is in beta. When something breaks, or a game you want to port does
not fit, open an issue at https://github.com/homie-rocks/homie/issues/new/choose (a bug,
a port request or a question). Leave keys, tokens and private addresses out of it.
