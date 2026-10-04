# Volt Run

## Concept

Eight couriers, one case, sixty seconds. You score only while you are holding the case and standing on the drop pad. Everyone else is trying to bump it out of your hands. A searchlight walks the alley: carry the case through it and you slow down, then it cooks you and the case pops free.

## World

A night grid, 1600 by 1000. The drop pad moves every fourteen seconds. The searchlight is a function of the shared clock, so every screen shows the same beam. The case is either on the ground or glued to one body.

## Characters

Whoever presses Play, plus bots that fill the empty seats (Rook, Vex, Moth and the rest). Bots read the room's skill dial: slow to notice, sloppy aim, whether they chase the carrier or camp the pad, how often they bump. A person who arrives takes a bot's body where it stands.

## Art direction

Flat canvas, dark blue, cyan grid, magenta drop, amber case. Heat turns the case's edge red. No models. The knock (hit-stop, slide, squash) is the gem-rush starter's, tuned in the Game Lab.

## Controls

- Computer: WASD or arrows to move. Space bumps.
- Phone: drag to move. A second finger bumps.
- The centre of the screen stays clear. The clock and the case status sit top left. Scores sit under the room button, top right.

## Rooms and players

Public netplay, 1 to 8, owner movement. Rounds are 60 seconds, then a short break, then the next round on its own. Bots fill from the first frame. Watchers follow `viewSeat`. One host runs pickup, heat, banking and the clock.

## Music and sound

None yet. The alley is silent on purpose until there is a loop that fits.

## Milestones

- Playable round: grab, bank, bump, cook. Done.
- Landing copy in game.json. Done.
- A check with two browsers finishing a round.

## Open questions

- A short chiptune sting on a bank and on a cook, if it stays out of the way of room chat.
- Whether a second case would still read, or just turn it back into Gem Rush.

## Latest

- 2026-10-03: First playable. One case, a moving drop, a searchlight that slows and then drops. Built on the gem-rush netplay skeleton (knock, watch, skill dial, lab) after the studio moved to @homie-rocks/studio 0.30.0.
