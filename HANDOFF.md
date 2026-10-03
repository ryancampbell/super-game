# Continuing a build from the Claude app

The Claude app (claude.ai on a phone or the web) hands a build to a Claude Code session in this repository with
one short line:

    Continue building <Studio>: build hb_<32 hex digits>

That line is all the session is given. The brief (what the person asked for, in their words) stays with the build:

1. `npm install` (once per session).
2. `npx --no-install homie-studio handoff hb_…` prints the brief and the steps for this kind of build (a new
   studio's first session, a new game, a port, a remix or a change). It takes the build once, so the chat's card
   follows the work, and for a studio still being set up it checks in from this repository.
3. If it says this session's network does not reach homie.rocks and the Homie connector's tools are in this session,
   call `build_progress` with `{ "build": "hb_…" }`: its answer carries the same brief. Otherwise tell the person
   in one line and ask what to build; the card in their chat shows the brief.
4. Do the work the brief asks for, as AGENTS.md says: `npm run build`, `npm run dev` in the background, and
   `npx --no-install homie-studio check <id> --url http://127.0.0.1:8787` (on Linux without Chrome, first
   `npx --no-install homie-studio chrome install`).
5. `npx --no-install homie-studio progress change "<what it does, one line>"`; commit on a new branch, push,
   `gh pr create`; then `npx --no-install homie-studio progress pr --url <the pull request>`.

Never merge the pull request: the person publishes it from the chat's card, in GitHub. A new studio has no game
yet: copy a starter only when the brief or the person asks for one.

On a computer, the Claude desktop app with the Homie extension builds in the same chat, with no hand-off at all.
