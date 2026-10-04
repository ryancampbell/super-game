/*
 * VOLT RUN — one case, a drop pad, a searchlight. Netplay v1 (@homie-rocks/studio/netplay/NETPLAY.md).
 *
 * Grab the case and stand on the pad to bank it. Bump the carrier and the case pops loose.
 * The searchlight cooks whoever is carrying: heat slows them, and a full cook drops the case
 * and throws them clear. 60 s rounds cycle forever. The round starts the moment the first
 * browser arrives, with two bots, and every human who arrives takes a bot's body. Every
 * browser renders the game itself. One browser is host.
 *
 * The knock, watch camera, skill dial, AI seats and Game Lab are the gem-rush starter's.
 *
 * WATCH ANY PLAYER (contract revision 5): a watcher (/<game>/watch) never
 * takes a seat. `net.viewSeat` says whose view to draw; the camera follows that
 * player's body as their own browser does, the board marks their row, and with
 * nobody followed the whole arena shows. Waves call `net.spotlight(seat)`, so a
 * watcher on Auto cuts to whoever just bumped.
 *
 * SERVERS AND THE SKILL DIAL (contract revision 6): the bots play at the room's
 * dial (`net.skillOf(slot)`: how late they see, how well they aim, whether they
 * fight for the hot zone, how often they bump), which the party votes in the
 * play page; a hybrid server's AI seats are kept as AI bodies (the Roster's
 * reserve, marked " · AI"), an AI with a pass takes one, and a humans-only
 * server's bots are off. The game says so: `caps: ['skill', 'agents']`.
 *
 * THE GAME LAB (`homie-studio lab volt-run`): the knock is tuned in the lab. Its numbers are tunables.json (read with
 * lab.tunables, so the lab's sliders move them and write kept values back), and the game tells the lab what the knock
 * is doing: its phases, the bumped body's speed and distance, poses for the onion skin and the spacing arc, and preset
 * views. Outside the lab every lab call is a no-op. lab.json holds the take the lab plays.
 *
 * Canvas 2D on purpose: the point is the contract, in ~700 readable lines.
 */
import { createNetplay, Roster, q, lerp, capMove, PALETTE, AI_MARK, type RoleChange, type RoundInfo, type RoundResult, type Skill, type Slot, type Snapshot } from '@homie-rocks/studio/netplay';
// The port toolkit: its probe (what `homie-studio port check` reads for the owner tests, and sandbox + audio shims),
// and a flat world on every screen (port/view.ts: the camera, and name labels that never pile up).
import { BUBBLE_FONT, createBubbles, createLabels, exposePort, fitView, paintBubbles, type BubbleIn, type BubbleOut, type LabelIn, type LabelOut } from '@homie-rocks/studio/port';
// The Game Lab: tunables, phases, tracks and overlays (no-ops outside the lab).
import { lab } from '@homie-rocks/studio/lab';
import tuning from '../tunables.json';

/* ------------------------------------------------------------------ rules */
const W = 1600;
const H = 1000;
const R_AV = 22;
const R_CASE = 14;
const SPEED = 340;
const BOT_SPEED = 268;
const ROUND_MS = 60_000;
const BREAK_MS = 7_000;
const MIN_SLOTS = 3; // 1 human + 2 bots from the first frame
const MAX_SLOTS = 8;
/** The knock's numbers (tunables.json): the file's values, or the Game Lab's sliders while it plays a take. */
const T = lab.tunables(tuning);
const PAD_MS = 14_000;
const BANK_EVERY = 0.42; // seconds on the pad, case in hand, per point
const LIGHT_R = 188;
/** The contract's 12 colours (PALETTE, NETPLAY.md section 3): a person wears their seat's, so the watch page's strip matches. */
const colourOf = (slot: number, seat: number | null): string => PALETTE[(seat ?? slot) % PALETTE.length] as string;
const BOT_NAMES = ['Rook', 'Vex', 'Moth', 'Kilo', 'Juno', 'Pike', 'Nyx', 'Ash'];
const botName = (slot: number): string => BOT_NAMES[slot % BOT_NAMES.length] as string;
/** An AI's name already ends in " · AI" (the relay sees to it); a plain bot says bot. */
const label = (name: string, bot: boolean): string => (name.endsWith(AI_MARK) ? name : bot ? `${name} · bot` : name);

/* ------------------------------------------------------------ wire shapes */
/** Snapshot: bodies, plus the case (x, y, holder slot or -1, heat 0–100). */
type P = [slot: number, seat: number, x: number, y: number, score: number, vx: number, vy: number];
type C = [x: number, y: number, holder: number, heat: number];
interface Snap { r: [n: number, phase: number, startedAt: number, endsAt: number]; p: P[]; c: C }
/**
 * Replica input: the avatar (owner movement) AND the stick intent (host movement), so either mode reads the same
 * frame. The helper stamps the reset epoch the replica has adopted.
 */
type Avatar = [x: number, y: number, vx: number, vy: number, mx: number, my: number];
/** A body's bump, while it lasts: its direction (kvx, kvy), where its slide starts (kx, ky) and when (kat, after the hit-stop). */
interface Knock { kvx: number; kvy: number; kx: number; ky: number; kat: number; knockUntil: number }
interface Body extends Knock { slot: number; seat: number | null; name: string; bot: boolean; x: number; y: number; vx: number; vy: number; score: number; tx: number; ty: number }
/** The case: loose at x,y, or held by `holder` (a slot). Heat cooks only the carrier. */
interface Cargo { x: number; y: number; holder: number; heat: number }
/** Slow state: the drop pad (net.state('zone', ...)), so a joiner and a promoted host both have it. */
interface Zone { n: number; x: number; y: number; r: number; until: number }
interface Ckpt { round: RoundInfo; bodies: Body[]; cargo: Cargo; roster: Slot[]; tick: number; bank: number }

/* --------------------------------------------------------------- the net */
/**
 * `?movement=host` plays host movement: the host moves every body from the seats' stick intents (its rules own
 * movement), and each replica PREDICTS its own body by replaying its unacknowledged intents on the host's position.
 * Default `owner`: each browser moves its own body and the host bounds it.
 */
const MOVEMENT: 'owner' | 'host' = (() => { try { return new URLSearchParams(location.search).get('movement') === 'host' ? 'host' : 'owner'; } catch { return 'owner'; } })();
// caps: its bots read the dial ('skill'), and its Roster takes an AI's slot for it ('agents': the join passes p.agent).
const net = createNetplay<Snap, Avatar, Ckpt>({ game: 'volt-run', maxPlayers: MAX_SLOTS, movement: MOVEMENT, snapshotHz: 20, inputHz: 20, checkpointMs: 1000, caps: ['skill', 'agents'], checkpoint: () => checkpoint() });
/** The Roster keeps the server's AI seats (revision 6): the policy is read whenever it fills. */
const policy = () => net.policy;

/* ------------------------------------------------------------ host state */
let roster = new Roster({ min: MIN_SLOTS, max: MAX_SLOTS, botName, policy });
let bodies = new Map<number, Body>();
let cargo: Cargo = { x: W / 2, y: H / 2, holder: -1, heat: 0 };
let bank = 0;
let round: RoundInfo | null = null;
let zone: Zone | null = null;
let tick = 0;
let hosting = false;
let cheatResets = 0;
let controlResets = 0;
let predictionError = 0;
/** Case grabs this round (the dial's `pickups` probe). */
let pickups = new Map<number, number>();

/* ------------------------------------------------ this browser's avatar */
const me = { x: W / 2, y: H / 2, vx: 0, vy: 0, kvx: 0, kvy: 0, kx: 0, ky: 0, kat: 0, knockUntil: 0, has: false };
/** Offline (no shell) plays as a local seat 0, with keys or touch. */
const mySeat = (): number | null => (net.offline ? 0 : net.seat);
/** Whose view to draw: my own seat, or for a watcher the player it follows (null: the whole arena). */
const viewSeat = (): number | null => (net.offline ? 0 : net.viewSeat);

/* ------------------------------------------------------- replica view */
const drawn = new Map<number, { x: number; y: number; seat: number; score: number; slot: number }>();
const waves: { x: number; y: number; at: number; colour: string; knock?: boolean }[] = [];
let wavesSeen = 0;
let knocksSeen = 0;
let firstStateAt = 0;
let firstSnapAt = 0;
let frames = 0;

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
const spawnPoint = (i: number): { x: number; y: number } => {
  const a = (i / MAX_SLOTS) * Math.PI * 2;
  return { x: W / 2 + Math.cos(a) * 330, y: H / 2 + Math.sin(a) * 250 };
};
/** The searchlight is a function of the shared clock, so every browser draws the same one. */
function lightAt(now: number): { x: number; y: number; r: number } {
  const t = now / 1000;
  const a = t * 0.62;
  return { x: W / 2 + Math.cos(a) * 390 + Math.sin(t * 1.15) * 70, y: H / 2 + Math.sin(a * 0.86) * 250, r: LIGHT_R };
}

function bodyFor(slot: Slot): Body {
  const sp = spawnPoint(slot.slot);
  return { slot: slot.slot, seat: slot.seat, name: slot.name, bot: slot.bot, x: sp.x, y: sp.y, vx: 0, vy: 0, score: 0, tx: sp.x, ty: sp.y, kvx: 0, kvy: 0, kx: sp.x, ky: sp.y, kat: 0, knockUntil: 0 };
}

function syncBodiesFromRoster(): void {
  const seen = new Set<number>();
  for (const s of roster.slots) {
    seen.add(s.slot);
    const b = bodies.get(s.slot);
    if (!b) { bodies.set(s.slot, bodyFor(s)); continue; }
    b.seat = s.seat; b.name = s.name; b.bot = s.bot;
  }
  for (const k of [...bodies.keys()]) if (!seen.has(k)) bodies.delete(k);
}

function publishRoster(): void { net.roster(roster.toJSON()); }

/** The host moved body `b` itself: tell its owner (a replica adopts it; the host's own body is `me`). */
function hostMoved(b: Body): void {
  if (b.bot || b.seat === null) return;
  if (b.seat === mySeat()) { me.x = b.x; me.y = b.y; me.vx = 0; me.vy = 0; me.has = true; return; }
  net.reset(b.seat);
}

function newZone(n: number): Zone {
  return { n, x: rnd(240, W - 240), y: rnd(200, H - 200), r: 118, until: net.now() + PAD_MS };
}
function setZone(z: Zone): void { zone = z; net.state('zone', z); }

function startRound(n: number): void {
  const now = net.now();
  roster.trim();
  syncBodiesFromRoster();
  let i = 0;
  for (const b of [...bodies.values()].sort((a, c) => a.slot - c.slot)) {
    const sp = spawnPoint(i++);
    b.x = sp.x; b.y = sp.y; b.vx = 0; b.vy = 0; b.score = 0; b.tx = sp.x; b.ty = sp.y; b.kvx = 0; b.kvy = 0; b.knockUntil = 0;
    hostMoved(b);
  }
  cargo = { x: W / 2, y: H / 2, holder: -1, heat: 0 };
  bank = 0;
  pickups = new Map();
  sight.clear();
  round = { n, phase: 'live', startedAt: now, endsAt: now + ROUND_MS };
  if (lab.stage === 'dummy') stageDummy();
  setZone(newZone((zone?.n ?? 0) + 1));
  net.round(round);
  publishRoster();
  net.snapshot(buildSnap(), tick, true);
}

function endRound(): void {
  if (!round) return;
  const now = net.now();
  const ranked = [...bodies.values()].sort((a, b) => b.score - a.score || Number(a.bot) - Number(b.bot) || a.slot - b.slot);
  const agentSlot = (slot: number): boolean => Boolean(roster.slots.find((x) => x.slot === slot)?.agent);
  const results: RoundResult[] = ranked.map((b, i) => ({ slot: b.slot, seat: b.seat, name: b.name, score: b.score, bot: b.bot, place: i + 1, ...(agentSlot(b.slot) ? { agent: true as const } : {}) }));
  round = { n: round.n, phase: 'over', startedAt: now, endsAt: now + BREAK_MS, results };
  net.round(round);
}

/* ---------------------------------------------------- becoming the host */
function becomeHost(e: RoleChange<Snap, Ckpt>): void {
  hosting = true;
  if (e.promoted) restore(e);
  else {
    roster = new Roster({ min: MIN_SLOTS, max: MAX_SLOTS, botName, policy });
    bodies = new Map();
    const seat = mySeat();
    if (seat !== null) roster.claim(seat, net.offline ? 'You' : net.name);
    syncBodiesFromRoster();
    startRound((e.round?.n ?? 0) + 1);
  }
  // Whoever is connected now is who plays: seats that left during the gap become bots.
  const peers = net.offline ? [{ seat: 0, name: 'You' }] : [...net.peers.values()].filter((p) => p.seat !== null).map((p) => ({ seat: p.seat, name: p.name, agent: p.agent ?? null }));
  const { claimed } = roster.reconcile(peers);
  syncBodiesFromRoster();
  for (const s of claimed) { const b = bodies.get(s.slot); if (b && b.seat !== mySeat()) hostMoved(b); }
  // My own body is wherever my local avatar is: it was client-owned a moment ago and still is.
  const mine = mySeat() !== null ? [...bodies.values()].find((b) => b.seat === mySeat()) : undefined;
  if (mine && me.has) { mine.x = me.x; mine.y = me.y; }
  else if (mine) { me.x = mine.x; me.y = mine.y; me.has = true; }
  // The drop pad is keyed state: the relay handed it over with the role.
  zone = net.stateOf<Zone>('zone') ?? zone;
  if (!zone && round) setZone(newZone(1));
  publishRoster();
}

function restore(e: RoleChange<Snap, Ckpt>): void {
  const ck = e.ckpt?.d ?? null;
  if (ck) {
    roster = Roster.from(ck.roster, { min: MIN_SLOTS, max: MAX_SLOTS, botName, policy });
    bodies = new Map(ck.bodies.map((b) => [b.slot, { ...b }]));
    cargo = { ...ck.cargo };
    bank = ck.bank;
    round = ck.round;
    tick = ck.tick;
  } else {
    roster = Roster.from(e.roster ?? [], { min: MIN_SLOTS, max: MAX_SLOTS, botName, policy });
    bodies = new Map();
    syncBodiesFromRoster();
  }
  // The snapshot is newer than the checkpoint (20 Hz vs 1 Hz): positions, scores and the case from it.
  const s = e.snap;
  if (s && (!e.ckpt || s.st >= e.ckpt.st)) {
    for (const [slot, seat, x, y, score] of s.d.p) {
      let b = bodies.get(slot);
      if (!b) {
        const rs0 = roster.slots.find((r) => r.slot === slot) ?? { slot, seat: seat >= 0 ? seat : null, name: seat >= 0 ? `Player ${seat + 1}` : botName(slot), bot: seat < 0 };
        b = bodyFor(rs0);
        bodies.set(slot, b);
      }
      b.x = x; b.y = y; b.score = score; b.tx = x; b.ty = y;
    }
    const [cx, cy, holder, heat] = s.d.c;
    cargo = { x: cx, y: cy, holder, heat };
    const [n, ph, startedAt, endsAt] = s.d.r;
    round = { n, phase: ph ? 'over' : 'live', startedAt, endsAt, ...(round?.n === n && round.results ? { results: round.results } : {}) };
    tick = Math.max(tick, s.k);
  }
  // A round message the relay kept is at least as authoritative as the checkpoint's copy.
  if (e.round && (!round || e.round.n > round.n || (e.round.n === round.n && e.round.phase === 'over' && round.phase === 'live'))) round = e.round;
  if (!round) { startRound(1); return; }
  net.round(round);
}

function checkpoint(): Ckpt {
  return {
    round: round ?? { n: 0, phase: 'live', startedAt: 0, endsAt: 0 },
    bodies: [...bodies.values()].map((b) => ({ ...b })),
    cargo: { ...cargo },
    roster: roster.toJSON(),
    tick,
    bank,
  };
}

net.on('role', (e) => {
  if (e.role === 'host') becomeHost(e);
  else { hosting = false; }
});
net.on('join', (p) => {
  if (!hosting || p.seat === null) return;
  // An AI takes a seat kept for AI, a person never does (revision 6: the Roster needs p.agent for that).
  const c = roster.claim(p.seat, p.name, p.agent ? { role: p.agent.role, hands: p.agent.hands } : null);
  if (!c) return; // full: they watch
  syncBodiesFromRoster();
  const b = bodies.get(c.slot.slot);
  // The arriving human takes over the bot's body where it stands, score and all (reset = "adopt this position").
  if (b) { b.vx = 0; b.vy = 0; b.kvx = 0; b.kvy = 0; b.knockUntil = 0; hostMoved(b); }
  publishRoster();
  net.snapshot(buildSnap(), tick, true);
});
net.on('leave', (p) => {
  if (!hosting || p.seat === null) return;
  roster.release(p.seat); // their body stays, driven by a bot
  syncBodiesFromRoster();
  publishRoster();
});
// The server's policy changed: its AI seats come (or go between rounds) at once.
net.on('policy', () => { if (!hosting) return; roster.fill(); syncBodiesFromRoster(); publishRoster(); });
net.on('event', (e) => {
  if (e.k === 'wave') addWave(e.d as { slot: number });
  if (e.k === 'knock') addWave(e.d as { slot: number }, true);
});
net.on('round', (r) => { round = hosting ? round : r; });
net.on('state', (e) => { if (e.k === 'zone' && !hosting) zone = (e.d as Zone | null) ?? null; if (!firstStateAt) firstStateAt = performance.now(); });
net.on('snapshot', () => { if (!firstSnapAt) firstSnapAt = performance.now(); });
/** My body's control changed: on a reset, stand where the host put me (a new round, a takeover, a knockback's end). */
net.on('control', (e) => {
  if (!e.reset) return;
  controlResets += 1;
  const p = (e.snap as Snapshot<Snap>).d.p.find((x) => x[1] === net.seat);
  if (p) { me.x = p[2]; me.y = p[3]; me.vx = 0; me.vy = 0; me.has = true; }
});

/* ----------------------------------------------------------------- input */
const keys = new Set<string>();
addEventListener('keydown', (e) => {
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (e.code === 'Space' && !keys.has('Space')) wave();
  keys.add(e.code);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const stick = { id: -1, ox: 0, oy: 0, x: 0, y: 0, active: false };
const canvas = document.getElementById('c') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse') return;
  if (stick.active && e.pointerId !== stick.id) { wave(); return; } // a second finger waves
  stick.id = e.pointerId; stick.ox = e.clientX; stick.oy = e.clientY; stick.x = e.clientX; stick.y = e.clientY; stick.active = true;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => { if (e.pointerId === stick.id) { stick.x = e.clientX; stick.y = e.clientY; } });
const endStick = (e: PointerEvent): void => { if (e.pointerId === stick.id) { stick.active = false; stick.id = -1; } };
canvas.addEventListener('pointerup', endStick);
canvas.addEventListener('pointercancel', endStick);

function moveVector(): { x: number; y: number } {
  let x = 0; let y = 0;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
  if (keys.has('KeyW') || keys.has('ArrowUp')) y -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) y += 1;
  if (stick.active) {
    const dx = stick.x - stick.ox; const dy = stick.y - stick.oy;
    const len = Math.hypot(dx, dy);
    if (len > 6) { const m = Math.min(1, len / 56); x += (dx / len) * m; y += (dy / len) * m; }
  }
  const len = Math.hypot(x, y);
  return len > 1 ? { x: x / len, y: y / len } : { x, y };
}

function wave(): void {
  const seat = mySeat();
  if (seat === null) return;
  if (hosting) {
    const b = [...bodies.values()].find((x) => x.seat === seat);
    if (b) hostWave(b);
  } else net.press('wave');
}
/** Host: a wave rings out, and knocks back every body within reach (bots, the host itself, and replicas). */
function hostWave(from: Body): void {
  addWave({ slot: from.slot }); net.send('wave', { slot: from.slot });
  for (const b of bodies.values()) {
    if (b === from || Math.hypot(b.x - from.x, b.y - from.y) > T.knockRange) continue;
    knock(b, from.x, from.y, from.slot);
  }
}
/** The case pops off this body and stays where they were hit. */
function releaseCase(b: Body): void {
  if (cargo.holder !== b.slot) return;
  cargo.x = Math.max(48, Math.min(W - 48, b.x));
  cargo.y = Math.max(48, Math.min(H - 48, b.y));
  cargo.holder = -1;
  cargo.heat = 0;
  bank = 0;
}
/**
 * Host: knock a body back. A carrier drops the case where they stood. The hit LANDS first: for T.hitStopMs the body holds where it was hit (it flashes, squashes
 * and shakes on every screen), then it SLIDES T.knockDistance along the hit, fast at first and easing into the stop
 * (T.knockEase), so it arrives at rest, the same distance at any frame rate, and its owner steers again with no pop.
 * A replica's body is TAKEN for the whole bump (its owner's avatar frames are ignored; the host drives it; the owner
 * draws its body from snapshots), then the helper GIVES it back with a reset, so the owner stands where it ended.
 */
function knock(b: Body, fx: number, fy: number, by: number): void {
  if (cargo.holder === b.slot) releaseCase(b);
  let dx = b.x - fx; let dy = b.y - fy;
  const len = Math.hypot(dx, dy);
  if (len < 1) { const a = Math.random() * Math.PI * 2; dx = Math.cos(a); dy = Math.sin(a); } else { dx /= len; dy /= len; }
  const at = net.now() + T.hitStopMs;
  const o: Knock & { x: number; y: number } = !b.bot && b.seat !== null && b.seat === mySeat() ? me : b;
  o.kvx = dx; o.kvy = dy; o.kx = o.x; o.ky = o.y; o.kat = at; o.knockUntil = at + T.knockMs;
  if (o === b && !b.bot && b.seat !== null) net.take(b.seat, T.hitStopMs + T.knockMs);
  labKnock(b);
  const d = { slot: b.slot, dx: q(dx, 2), dy: q(dy, 2), by };
  addWave(d, true); net.send('knock', d);
}

/** Where a bumped body is now: held through the hit-stop, then eased out along the hit. Sets its velocity too. */
function slide(o: Knock & { x: number; y: number; vx: number; vy: number }, now: number, dt: number): void {
  const u = Number.isFinite(o.kat) ? Math.max(0, Math.min(1, (now - o.kat) / Math.max(1, T.knockMs))) : 1;
  const e = 1 - (1 - u) ** Math.max(1, T.knockEase);
  const x = Math.max(R_AV, Math.min(W - R_AV, o.kx + o.kvx * T.knockDistance * e));
  const y = Math.max(R_AV, Math.min(H - R_AV, o.ky + o.kvy * T.knockDistance * e));
  if (u >= 1) { o.vx = 0; o.vy = 0; } else if (dt > 0) { o.vx = (x - o.x) / dt; o.vy = (y - o.y) / dt; }
  o.x = x; o.y = y;
}
/** The frame a bump is over: the body lands exactly where its slide ends, at rest (at 12 fps the last step is long). */
function landed(o: Knock & { x: number; y: number; vx: number; vy: number }): void {
  if (!o.kat) return;
  slide(o, o.kat + T.knockMs, 0);
  o.kat = 0;
}
function addWave(d: { slot: number; dx?: number; dy?: number; by?: number }, isKnock = false): void {
  const pos = hosting ? bodies.get(d.slot) : [...drawn.values()].find((x) => x.slot === d.slot);
  // The action, for a watcher on Auto: whoever waved (a person, never a bot).
  const waver = pos && 'bot' in pos ? (pos.bot ? null : pos.seat) : pos && pos.seat >= 0 ? pos.seat : null;
  if (!isKnock) net.spotlight(waver);
  const mineSlot = hosting ? [...bodies.values()].find((x) => x.seat !== null && x.seat === mySeat())?.slot : [...drawn.values()].find((x) => x.seat === net.seat)?.slot;
  const at = mineSlot === d.slot && me.has ? me : pos;
  if (!at) return;
  waves.push({ x: at.x, y: at.y, at: performance.now(), colour: isKnock ? '#ffffff' : PALETTE[d.slot % PALETTE.length] as string, knock: isKnock });
  if (isKnock) knocksSeen += 1; else wavesSeen += 1;
  if (isKnock) bumped(d, at); else pushes.set(d.slot, performance.now());
}

/* ---------------------------------------------------------------- simulate */
/** The one movement rule, shared by the owner, the host (host movement) and a replica's prediction. */
function integrate(o: { x: number; y: number; vx: number; vy: number }, mx: number, my: number, dt: number, speed = SPEED): void {
  mx = Number(mx) || 0; my = Number(my) || 0;
  const len = Math.hypot(mx, my);
  if (len > 1) { mx /= len; my /= len; } // an intent is at most full stick: no speed hack through intents
  const k = Math.min(1, dt * 14);
  o.vx += (mx * speed - o.vx) * k;
  o.vy += (my * speed - o.vy) * k;
  o.x = Math.max(R_AV, Math.min(W - R_AV, o.x + o.vx * dt));
  o.y = Math.max(R_AV, Math.min(H - R_AV, o.y + o.vy * dt));
}
/** Heat on the case slows whoever is carrying it. Host reads the live case; a replica reads the last snapshot. */
function carrySpeed(slot: number | null): number {
  if (slot === null) return SPEED;
  const heat = hosting ? (cargo.holder === slot ? cargo.heat : 0) : (() => {
    const c = net.latest()?.d.c;
    return c && c[2] === slot ? c[3] : 0;
  })();
  return SPEED * (1 - 0.55 * Math.max(0, Math.min(100, heat)) / 100);
}
function myBodySlot(): number | null {
  const seat = mySeat();
  if (seat === null) return null;
  if (hosting) return [...bodies.values()].find((b) => b.seat === seat)?.slot ?? null;
  return [...drawn.values()].find((d) => d.seat === seat)?.slot ?? null;
}

function stepMe(dt: number): void {
  const seat = mySeat();
  if (seat === null) { me.has = false; return; }
  // Host-driven (host movement, or knocked back on a replica): stepReplica predicts me instead.
  if (!net.owned) return;
  if (me.knockUntil > net.now()) { slide(me, net.now(), dt); return; }
  landed(me);
  const v = moveVector();
  integrate(me, v.x, v.y, dt, carrySpeed(myBodySlot()));
}

/**
 * Replica, host-driven body. My stick moves me locally every frame (instant response), with the same rule the host
 * runs. When a new snapshot lands: start from where the host has me, replay every intent it had not acknowledged,
 * and pull toward that by 30% (or jump, if it is far). The host stays the truth; I never wait for it.
 */
let predictedK = -1;
function predictMe(dt: number): void {
  const v = moveVector();
  integrate(me, v.x, v.y, dt, carrySpeed(myBodySlot()));
  const snap = net.latest();
  if (!snap || snap.k === predictedK) return;
  predictedK = snap.k;
  const p = snap.d.p.find((x) => x[1] === net.seat);
  if (!p) return;
  const pred = { x: p[2], y: p[3], vx: p[5] ?? 0, vy: p[6] ?? 0 };
  for (const f of net.pending()) {
    let left = Math.min(0.25, f.dt / 1000);
    while (left > 0) { const h = Math.min(left, 1 / 60); integrate(pred, f.a[4], f.a[5], h); left -= h; }
  }
  const err = Math.hypot(pred.x - me.x, pred.y - me.y);
  predictionError = err;
  if (!me.has || err > 150) { me.x = pred.x; me.y = pred.y; me.vx = pred.vx; me.vy = pred.vy; }
  else { me.x += (pred.x - me.x) * 0.3; me.y += (pred.y - me.y) * 0.3; }
  me.has = true;
}

function stepKnocked(b: Body, dt: number): void { slide(b, net.now(), dt); }

/**
 * THE BOTS, AT THE ROOM'S DIAL (NETPLAY.md section 17). A bot re-reads the world only every `reactionMs`,
 * aims up to 200 px off at aimNoise 1, and bumps about `aggression` times a second once it is in reach.
 * Carrying: it runs for the pad (positioning 1 sticks the pad, 0 wanders). Someone else has it: aggression
 * chases them to knock the case loose; a calm bot camps the pad. Loose and sitting in the light: low
 * positioning waits at the edge. A carrier in the light slows, same as a person.
 */
const sight = new Map<number, { at: number; tx: number; ty: number; arrived?: boolean }>();

function stepBots(dt: number): void {
  const now = net.now();
  for (const b of bodies.values()) {
    if (!b.bot) continue;
    if (b.knockUntil > now) { stepKnocked(b, dt); continue; }
    landed(b);
    if (lab.stage === 'dummy') { standStill(b, dt); continue; }
    const s: Skill = net.skillOf(b.slot); // Fair when nobody set a dial
    let eye = sight.get(b.slot);
    if (!eye || now - eye.at >= s.reactionMs) {
      const g = pickTarget(b, s);
      eye = { at: now, tx: g.x, ty: g.y };
      sight.set(b.slot, eye);
    }
    b.tx = eye.tx; b.ty = eye.ty;
    const rival = bumpChoice(b);
    const urge = rival && cargo.holder === rival.slot ? 1.5 : 0.55;
    if (rival && round?.phase === 'live' && Math.random() < s.aggression * urge * dt) hostWave(b);
    const dx = b.tx - b.x; const dy = b.ty - b.y; const dist = Math.hypot(dx, dy);
    const len = dist || 1;
    if (dist < 6 && !eye.arrived) { eye.arrived = true; eye.at = now; }
    const hot = cargo.holder === b.slot ? (1 - 0.55 * cargo.heat / 100) : 1;
    const speed = dist < 6 ? 0 : BOT_SPEED * hot;
    const k = Math.min(1, dt * 5);
    b.vx += ((dx / len) * speed - b.vx) * k;
    b.vy += ((dy / len) * speed - b.vy) * k;
    b.x = Math.max(R_AV, Math.min(W - R_AV, b.x + b.vx * dt));
    b.y = Math.max(R_AV, Math.min(H - R_AV, b.y + b.vy * dt));
  }
}

function aimJitter(s: Skill): number { return (Math.random() - 0.5) * 200 * s.aimNoise; }

/** Where this bot heads: the pad, the carrier, or the loose case. */
function pickTarget(b: Body, s: Skill): { x: number; y: number } {
  const jx = aimJitter(s); const jy = aimJitter(s);
  if (cargo.holder === b.slot && zone) {
    const wander = (1 - s.positioning) * 180;
    return { x: zone.x + jx * 0.35 + (Math.random() - 0.5) * wander, y: zone.y + jy * 0.35 + (Math.random() - 0.5) * wander };
  }
  if (cargo.holder >= 0) {
    const h = bodies.get(cargo.holder);
    if (h && h !== b) {
      if (s.aggression >= 0.34 || !zone) return { x: h.x + jx, y: h.y + jy };
      return { x: zone.x + jx, y: zone.y + jy };
    }
  }
  const L = lightAt(net.now());
  const lit = Math.hypot(cargo.x - L.x, cargo.y - L.y) < L.r;
  if (lit && s.positioning < 0.4) {
    const dx = cargo.x - L.x; const dy = cargo.y - L.y; const len = Math.hypot(dx, dy) || 1;
    return { x: L.x + (dx / len) * (L.r + 46) + jx, y: L.y + (dy / len) * (L.r + 46) + jy };
  }
  return { x: cargo.x + jx, y: cargo.y + jy };
}

/** Who this bot shoves: the carrier if it can reach them, or anyone crowding it while it banks. */
function bumpChoice(b: Body): Body | null {
  if (cargo.holder >= 0 && cargo.holder !== b.slot) {
    const h = bodies.get(cargo.holder);
    if (h && Math.hypot(h.x - b.x, h.y - b.y) <= T.knockRange) return h;
    return null;
  }
  if (cargo.holder === b.slot) return nearestBody(b, T.knockRange);
  return null;
}

/** The nearest other body within `range` (a bot's rival), or null. */
function nearestBody(b: Body, range: number): Body | null {
  let best: Body | null = null; let bd = range;
  for (const o of bodies.values()) {
    if (o === b) continue;
    const d = Math.hypot(o.x - b.x, o.y - b.y);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

function stepHost(dt: number): void {
  tick += 1;
  const seat = mySeat();
  const now0 = net.now();
  for (const b of bodies.values()) {
    if (b.bot) continue;
    if (b.seat === seat) {
      me.has = true;
      b.x = me.x; b.y = me.y; b.vx = me.vx; b.vy = me.vy;
      continue;
    }
    if (b.seat === null) continue;
    const ctl = net.control(b.seat);
    if (ctl.taken || b.knockUntil > now0) { stepKnocked(b, dt); if (net.takePresses(b.seat)['wave']) hostWave(b); continue; } // the host drives the knockback
    if (MOVEMENT === 'host') {
      // Host movement: the seat sends intents; the rules move the body.
      const f = net.inputOf(b.seat);
      integrate(b, f ? Number(f.a?.[4]) : 0, f ? Number(f.a?.[5]) : 0, dt, carrySpeed(b.slot));
      if (net.takePresses(b.seat)['wave']) hostWave(b);
      continue;
    }
    const a = net.avatar(b.seat); // null while taken, or until the owner has adopted the last reset
    if (a && Array.isArray(a)) {
      // Client-owned movement, bounded: to the arena, and to 1.3x top speed per frame. A legitimate avatar catches
      // up within a frame; a teleport crawls, and a claim more than half a second of running away is reset.
      const top = carrySpeed(b.slot);
      const claim = { x: Math.max(R_AV, Math.min(W - R_AV, Number(a[0]))), y: Math.max(R_AV, Math.min(H - R_AV, Number(a[1]))) };
      const m = capMove(b, claim, top * 1.3 * dt + 6);
      if (m.over > top * 0.5) { net.reset(b.seat); cheatResets += 1; }
      else { b.x = m.x; b.y = m.y; b.vx = Number(a[2]) || 0; b.vy = Number(a[3]) || 0; }
    }
    if (net.takePresses(b.seat)['wave']) hostWave(b);
  }
  stepBots(dt);
  const now = net.now();
  if (round && round.phase === 'live') {
    stepCase(now, dt);
    if (now >= round.endsAt) endRound();
  } else if (round && round.phase === 'over' && now >= round.endsAt) startRound(round.n + 1);
  if (net.snapshotDue()) net.snapshot(buildSnap(), tick);
}

/** Host rules: pickup, the searchlight, and banking on the pad. */
function stepCase(now: number, dt: number): void {
  if (!zone || now >= zone.until) setZone(newZone((zone?.n ?? 0) + 1));
  if (cargo.holder < 0) {
    let best: Body | null = null; let bd = R_AV + R_CASE;
    for (const b of bodies.values()) {
      if (b.knockUntil > now) continue;
      const d = Math.hypot(cargo.x - b.x, cargo.y - b.y);
      if (d < bd) { bd = d; best = b; }
    }
    if (best) {
      cargo.holder = best.slot;
      cargo.heat = 0;
      bank = 0;
      pickups.set(best.slot, (pickups.get(best.slot) ?? 0) + 1);
    }
    return;
  }
  const b = bodies.get(cargo.holder);
  if (!b) { cargo.holder = -1; cargo.heat = 0; return; }
  cargo.x = b.x;
  cargo.y = b.y;
  if (b.knockUntil > now) return;
  const L = lightAt(now);
  const lit = Math.hypot(b.x - L.x, b.y - L.y) < L.r;
  cargo.heat = Math.max(0, Math.min(100, cargo.heat + (lit ? 52 : -40) * dt));
  if (cargo.heat >= 100) { knock(b, L.x, L.y, -1); return; }
  if (zone && Math.hypot(b.x - zone.x, b.y - zone.y) < zone.r) {
    bank += dt;
    while (bank >= BANK_EVERY) { bank -= BANK_EVERY; b.score += 1; }
  }
}

function buildSnap(): Snap {
  const r = round ?? { n: 0, phase: 'live', startedAt: 0, endsAt: 0 };
  return {
    r: [r.n, r.phase === 'over' ? 1 : 0, r.startedAt, r.endsAt],
    p: [...bodies.values()].map((b) => [b.slot, b.seat ?? -1, q(b.x, 1), q(b.y, 1), b.score, q(b.vx, 0), q(b.vy, 0)] as P),
    c: [q(cargo.x, 0), q(cargo.y, 0), cargo.holder, q(cargo.heat, 0)],
  };
}

function stepReplica(dt: number): void {
  const seat = net.seat;
  if (seat !== null) {
    // Host-driven (host movement, or taken for a knockback): predict from the host's position and my intents.
    if (!net.owned) predictMe(dt);
    // Only once I have a body (the first control event adopts it): before that my position is nobody's.
    if (me.has) {
      const v = moveVector();
      // Stick direction as held "buttons": a new direction is a press edge, so it is sent within 16 ms.
      const held = [v.x > 0.2 ? 'R' : v.x < -0.2 ? 'L' : '', v.y > 0.2 ? 'D' : v.y < -0.2 ? 'U' : ''].filter(Boolean);
      net.input([q(me.x, 1), q(me.y, 1), q(me.vx, 0), q(me.vy, 0), q(v.x, 2), q(v.y, 2)], held);
    }
  }
  const smp = net.sample();
  drawn.clear();
  if (!smp) return;
  const bySlot = new Map<number, P>(smp.a.d.p.map((p) => [p[0], p]));
  for (const pb of smp.b.d.p) {
    const pa = bySlot.get(pb[0]) ?? pb;
    drawn.set(pb[0], { slot: pb[0], seat: pb[1], x: lerp(pa[2], pb[2], smp.alpha), y: lerp(pa[3], pb[3], smp.alpha), score: pb[4] });
  }
  const [n, ph, startedAt, endsAt] = smp.b.d.r;
  if (!round || round.n !== n || (round.phase === 'over') !== (ph === 1)) {
    const kept = net.roundInfo && net.roundInfo.n === n ? net.roundInfo : null;
    round = kept ?? { n, phase: ph ? 'over' : 'live', startedAt, endsAt };
  }
}

/* -------------------------------------------------------------- how a bump looks */
/*
 * Every screen draws a bump from the knock event (the host's own, or the one it sends): the hit lands (the body flashes
 * white and holds, squashed against the hit, shaking), flies (stretched along the hit, less as it slows), stops
 * (squashed, then a wobble that dies away: overlap), throws sparks, and kicks the camera of whoever was in it. The
 * waver's own body pushes out a little when it waves. Sparks and the camera's kick roll lab.random(): their own dice, so
 * the world's (Math.random) stay the same as a build without them, which the Game Lab needs to compare the two.
 */
const bumps = new Map<number, { at: number; dx: number; dy: number }>();
const pushes = new Map<number, number>();
const sparks: { x: number; y: number; vx: number; vy: number; at: number; life: number }[] = [];
let kickAt = -1e9;
function bumped(d: { slot: number; dx?: number; dy?: number; by?: number }, at: { x: number; y: number }): void {
  const now = performance.now();
  const dx = Number(d.dx) || 0; const dy = Number(d.dy) || 0;
  bumps.set(d.slot, { at: now, dx, dy });
  const base = Math.atan2(dy, dx);
  for (let i = 0; i < T.sparks; i += 1) {
    const a = base + (lab.random() - 0.5) * 1.6;
    const v = 420 + lab.random() * 520;
    sparks.push({ x: at.x - dx * R_AV * 0.6, y: at.y - dy * R_AV * 0.6, vx: Math.cos(a) * v, vy: Math.sin(a) * v, at: now, life: 170 + lab.random() * 170 });
  }
  if (sparks.length > 160) sparks.splice(0, sparks.length - 160);
  // The camera kicks for whoever was in it: the body bumped, or the one who waved.
  const mine = hosting ? [...bodies.values()].find((x) => x.seat !== null && x.seat === mySeat())?.slot : [...drawn.values()].find((x) => x.seat === net.seat)?.slot;
  if (mine !== undefined && (d.slot === mine || d.by === mine)) kickAt = now;
}
/** A body's look this frame: offset, stretch along an angle, and how white it flashes. */
function bodyFx(slot: number, t: number): { ox: number; oy: number; sx: number; sy: number; ang: number; flash: number } {
  const out = { ox: 0, oy: 0, sx: 1, sy: 1, ang: 0, flash: 0 };
  const p = pushes.get(slot);
  if (p !== undefined) { const u = (t - p) / 170; if (u >= 0 && u < 1) { const k = 0.14 * Math.sin(Math.PI * u); out.sx = 1 + k; out.sy = 1 + k; } }
  const b = bumps.get(slot);
  if (!b) return out;
  const age = t - b.at;
  const hs = T.hitStopMs; const end = hs + T.knockMs;
  if (age > end + T.settleMs + 200) { bumps.delete(slot); return out; }
  out.ang = Math.atan2(b.dy, b.dx);
  out.flash = T.flashMs > 0 ? Math.max(0, 1 - age / T.flashMs) : 0;
  let k = 0;
  if (age < hs) { k = -T.squash * 0.45; out.ox = Math.sin(age * 0.9) * 3; out.oy = Math.cos(age * 1.3) * 3; }
  else if (age < end) k = T.squash * (1 - (age - hs) / T.knockMs) ** Math.max(0, T.knockEase - 1);
  else if (T.settleMs > 0 && age < end + T.settleMs) { const w = (age - end) / T.settleMs; k = -T.squash * 0.8 * Math.exp(-3 * w) * Math.sin(2.5 * Math.PI * w); }
  out.sx *= 1 + k; out.sy *= 1 / (1 + k);
  return out;
}
function drawSparks(t: number, scale: number): void {
  ctx.lineCap = 'round';
  for (let i = sparks.length - 1; i >= 0; i -= 1) {
    const sp = sparks[i] as (typeof sparks)[number];
    const age = t - sp.at;
    if (age > sp.life) { sparks.splice(i, 1); continue; }
    if (age < T.hitStopMs * 0.5) continue;
    const u = age / sp.life; const s = age / 1000 * (1 - u * 0.5);
    const x = sp.x + sp.vx * s; const y = sp.y + sp.vy * s;
    ctx.strokeStyle = u < 0.4 ? '#ffffff' : '#ffd166'; ctx.globalAlpha = 1 - u; ctx.lineWidth = (2.5 + 4 * (1 - u)) / Math.max(0.5, scale);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - sp.vx * 0.022 * (1 - u), y - sp.vy * 0.022 * (1 - u)); ctx.stroke();
  }
  ctx.globalAlpha = 1; ctx.lineCap = 'butt';
}

/* -------------------------------------------------------------- the Game Lab */
/*
 * What the lab shows of a knock (lab.json's take "knock"): the body bumped last is the subject. Every frame its phase,
 * its speed and its distance from where it was hit go to the lab, and its pose feeds the onion skin and the spacing
 * arc (dots far apart: fast; close together: slow). Only in the lab: outside it, labKnock and labReport never run.
 */
type Pose = { x: number; y: number; sx?: number; sy?: number; a?: number };
/**
 * The take's stage "dummy" (lab.stage, only ever set by the lab): you stand left of the middle with a bot a short step
 * to your right, and every bot stands still unless it is bumped, like a training dummy. The knock alone, every time.
 */
function stageDummy(): void {
  const seat = mySeat();
  const list = [...bodies.values()].sort((a, c) => a.slot - c.slot);
  const mine = list.find((b) => !b.bot && b.seat === seat);
  const bots = list.filter((b) => b.bot);
  if (mine) { mine.x = W / 2 - 160; mine.y = H / 2; hostMoved(mine); }
  bots.forEach((b, i) => { b.x = i === 0 ? W / 2 - 160 + 92 : W - 180; b.y = i === 0 ? H / 2 : 150 + (i - 1) * 700; b.tx = b.x; b.ty = b.y; });
}
/** A dummy at rest: it eases to a stop wherever the last bump left it. */
function standStill(b: Body, dt: number): void {
  const k = Math.min(1, dt * 5);
  b.vx -= b.vx * k; b.vy -= b.vy * k;
  b.x = Math.max(R_AV, Math.min(W - R_AV, b.x + b.vx * dt)); b.y = Math.max(R_AV, Math.min(H - R_AV, b.y + b.vy * dt));
}
const subject = { slot: -1, at: 0, x0: 0, y0: 0, px: 0, py: 0, has: false };
function labKnock(b: Body): void {
  if (!lab.on) return;
  subject.slot = b.slot; subject.at = net.now(); subject.x0 = b.x; subject.y0 = b.y; subject.px = b.x; subject.py = b.y; subject.has = true;
}
/** Where the subject is now (the host's own body is `me`), or null. */
function subjectAt(): Pose | null {
  if (!subject.has) return null;
  const b = bodies.get(subject.slot);
  if (!b) return null;
  return !b.bot && b.seat !== null && b.seat === mySeat() ? me : b;
}
function labReport(dt: number): void {
  const at = subjectAt();
  if (!at || dt <= 0) { lab.phase(null); return; }
  const age = net.now() - subject.at;
  lab.track('speed', Math.hypot(at.x - subject.px, at.y - subject.py) / dt, 'px/s');
  lab.track('distance', Math.hypot(at.x - subject.x0, at.y - subject.y0), 'px');
  subject.px = at.x; subject.py = at.y;
  const fx = bodyFx(subject.slot, performance.now());
  lab.track('stretch', (fx.sx - 1) * 100, '%');
  if (age < T.hitStopMs) lab.phase('HIT-STOP', 'The hit lands: hold, flash, squash');
  else if (age < T.hitStopMs + T.knockMs * 0.3) lab.phase('LAUNCH', 'Leaves fast, stretched along the hit');
  else if (age < T.hitStopMs + T.knockMs) lab.phase('SLIDE', 'Eases into the stop: no creep, no pop');
  else if (age < T.hitStopMs + T.knockMs + T.settleMs) lab.phase('SETTLE', 'Squash on the stop, overlap on the way out');
  else lab.phase(null);
  lab.pose('subject', { x: at.x, y: at.y, sx: fx.sx, sy: fx.sy, a: fx.ang });
}
/** The lab's views: the game's own camera, close on the knock, the whole arena. */
const labView = lab.camera<{ zoom?: number; whole?: boolean } | null>({ game: null, close: { zoom: 2.4 }, arena: { whole: true } });
lab.overlay('onion', (c, k) => {
  const g = c as CanvasRenderingContext2D; const s = Number(k) || 1;
  const ghosts = lab.past<Pose>('subject', 8, 3);
  ghosts.forEach((p, i) => { g.globalAlpha = 0.5 * (1 - i / ghosts.length); g.strokeStyle = '#ffad3b'; g.lineWidth = 2 / s; g.beginPath(); g.ellipse(p.x, p.y, R_AV * (p.sx ?? 1), R_AV * (p.sy ?? 1), p.a ?? 0, 0, Math.PI * 2); g.stroke(); });
  g.globalAlpha = 1;
});
lab.overlay('arcs', (c, k) => {
  const g = c as CanvasRenderingContext2D; const s = Number(k) || 1;
  const pts = lab.past<Pose>('subject', 90, 1);
  if (pts.length < 2) return;
  g.strokeStyle = 'rgba(124,196,255,.55)'; g.lineWidth = 1.5 / s;
  g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.stroke();
  g.fillStyle = '#7cc4ff';
  for (const p of pts) { g.beginPath(); g.arc(p.x, p.y, 2.5 / s, 0, Math.PI * 2); g.fill(); }
});
lab.overlay('reach', (c, k) => {
  if (!me.has) return;
  const g = c as CanvasRenderingContext2D; const s = Number(k) || 1;
  g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1.5 / s; g.setLineDash([8 / s, 6 / s]);
  g.beginPath(); g.arc(me.x, me.y, T.knockRange, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
});

/* ------------------------------------------------------------------ draw */
let dpr = 1;
function resize(): void {
  dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
}
addEventListener('resize', resize);
resize();

const cam = { x: W / 2, y: H / 2, scale: 0 };
const labels = createLabels({ screen: () => ({ w: innerWidth, h: innerHeight }) });
// Room chat (NETPLAY.md section 19): what a player says in the room's chat (the play page's Chat, or a quick line) shows
// over their body for a few seconds, when they want it there. The studio taking a message down takes its bubble too.
const bubbles = createBubbles({ measure: (t) => { ctx.font = BUBBLE_FONT; return ctx.measureText(t).width; }, screen: () => ({ w: innerWidth, h: innerHeight }) });
net.on('say', (s) => bubbles.say(s.seat, s.text, { id: s.id, kind: s.kind }));
net.on('unchat', (e) => { for (const id of e.ids) bubbles.remove(id); });
let shownBubbles: BubbleOut[] = [];
let shownLabels: LabelOut[] = [];
let lastDraw = 0;
/** Where a seat's body is drawn now (host: the real body; replica: interpolated), or null. */
function seatPos(seat: number): { x: number; y: number } | null {
  if (seat === mySeat() && me.has && !net.watching) return me;
  if (hosting) { const b = [...bodies.values()].find((x) => !x.bot && x.seat === seat); return b ? { x: b.x, y: b.y } : null; }
  const d = [...drawn.values()].find((x) => x.seat === seat);
  return d ? { x: d.x, y: d.y } : null;
}
function caseNow(): Cargo {
  if (hosting) return cargo;
  const c = net.latest()?.d.c;
  return c ? { x: c[0], y: c[1], holder: c[2], heat: c[3] } : { x: W / 2, y: H / 2, holder: -1, heat: 0 };
}
/** Where to draw the case: on its carrier's body, or on the ground. */
function caseDrawAt(list: { slot: number; x: number; y: number }[]): { x: number; y: number; held: boolean; heat: number } {
  const c = caseNow();
  if (c.holder < 0) return { x: c.x, y: c.y, held: false, heat: 0 };
  const who = list.find((a) => a.slot === c.holder);
  return { x: who?.x ?? c.x, y: who?.y ?? c.y, held: true, heat: c.heat };
}
function draw(t: number): void {
  const cw = innerWidth; const ch = innerHeight;
  const phone = Math.min(cw, ch) <= 540;
  // The view: my own body, or (a watcher) the followed player's, drawn exactly as their own browser frames it.
  const view = viewSeat();
  const followed = net.watching && view !== null ? seatPos(view) : null;
  const overview = net.watching ? !followed : mySeat() === null;
  // The camera: close on the body whose view this is, never past the arena's edge (except as far as it takes to keep
  // that body clear of the HUD), and never so far out that an empty band shows beside the arena (held upright, a
  // phone showed the arena as a band with a third of the screen dark below or above it; now the arena fills the
  // screen). Following nobody: the whole arena.
  const focus = net.watching ? followed : overview || !me.has ? null : me;
  // The Game Lab's views (outside the lab: the game's own camera, always).
  const lv = labView();
  const want = overview || lv?.whole ? { scale: Math.min(cw / (W + 80), ch / (H + 80)), x: W / 2, y: H / 2 }
    : fitView({ world: { w: W, h: H }, screen: { w: cw, h: ch }, readable: 0, zoom: (Math.min(cw, ch) / (phone ? 560 : 820)) * (lv?.zoom ?? 1), focus: lv?.zoom ? subjectAt() ?? focus : focus, inset: { top: 52, bottom: 36 } });
  // A watcher's switch glides: the zoom and the pan ease over a few frames, never a cut.
  cam.scale = cam.scale ? cam.scale + (want.scale - cam.scale) * 0.12 : want.scale;
  const scale = cam.scale;
  cam.x += (want.x - cam.x) * 0.2; cam.y += (want.y - cam.y) * 0.2;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const bg = ctx.createRadialGradient(cw / 2, ch / 2, 0, cw / 2, ch / 2, Math.max(cw, ch) * 0.8);
  bg.addColorStop(0, '#0d1426'); bg.addColorStop(1, '#04060c');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, cw, ch);

  // The camera's kick (a bump you were in): a few px, gone in a fifth of a second.
  const kick = t - kickAt < 200 ? T.shake * (1 - (t - kickAt) / 200) ** 2 : 0;
  ctx.save();
  ctx.translate(cw / 2 + (kick ? (lab.random() - 0.5) * 2 * kick : 0), ch / 2 + (kick ? (lab.random() - 0.5) * 2 * kick : 0)); ctx.scale(scale, scale); ctx.translate(-cam.x, -cam.y);
  // arena
  ctx.strokeStyle = 'rgba(125,240,255,0.07)'; ctx.lineWidth = 1 / scale;
  ctx.beginPath();
  for (let x = 0; x <= W; x += 100) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (let y = 0; y <= H; y += 100) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(125,240,255,0.55)'; ctx.lineWidth = 4; ctx.strokeRect(0, 0, W, H);
  // searchlight: standing in it while carrying cooks the case
  const beam = lightAt(net.now());
  const beamG = ctx.createRadialGradient(beam.x, beam.y, 8, beam.x, beam.y, beam.r);
  beamG.addColorStop(0, 'rgba(255,246,214,0.22)'); beamG.addColorStop(0.55, 'rgba(255,220,140,0.08)'); beamG.addColorStop(1, 'rgba(255,220,140,0)');
  ctx.fillStyle = beamG; ctx.beginPath(); ctx.arc(beam.x, beam.y, beam.r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,236,190,0.35)'; ctx.lineWidth = 2; ctx.setLineDash([6, 8]); ctx.stroke(); ctx.setLineDash([]);
  // drop pad (keyed state): bank the case by standing here
  if (zone) {
    const pulse = 0.5 + 0.5 * Math.sin(t / 280);
    ctx.fillStyle = `rgba(255,59,212,${0.08 + 0.06 * pulse})`; ctx.beginPath(); ctx.arc(zone.x, zone.y, zone.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,59,212,0.85)'; ctx.lineWidth = 3; ctx.setLineDash([12, 8]); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,210,245,0.9)'; ctx.font = '800 15px ui-sans-serif, system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('DROP', zone.x, zone.y + 5);
  }

  // waves
  for (let i = waves.length - 1; i >= 0; i -= 1) {
    const w = waves[i] as (typeof waves)[number];
    const age = (t - w.at) / T.ringMs;
    if (age > 1) { waves.splice(i, 1); continue; }
    ctx.strokeStyle = w.colour; ctx.globalAlpha = 1 - age; ctx.lineWidth = w.knock ? 3 : 5;
    ctx.beginPath(); ctx.arc(w.x, w.y, w.knock ? R_AV + 6 + age * 40 : R_AV + age * (T.knockRange + 10), 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
  }

  // avatars
  const names = new Map<number, Slot>((net.slots ?? roster.slots).map((s) => [s.slot, s]));
  // `mine`: the body whose view this is: my own, or the player a watcher follows (named, never "You").
  const list: { slot: number; seat: number | null; x: number; y: number; bot: boolean; name: string; mine: boolean }[] = [];
  const isView = (seat: number | null, bot: boolean): boolean => !bot && seat !== null && seat === view;
  if (hosting) {
    for (const b of bodies.values()) list.push({ slot: b.slot, seat: b.seat, x: b.x, y: b.y, bot: b.bot, name: b.name, mine: isView(b.seat, b.bot) });
  } else {
    for (const d of drawn.values()) {
      const own = !net.watching && d.seat >= 0 && d.seat === net.seat;
      const s = names.get(d.slot);
      list.push({ slot: d.slot, seat: d.seat >= 0 ? d.seat : null, x: own && me.has ? me.x : d.x, y: own && me.has ? me.y : d.y, bot: d.seat < 0, name: s?.name ?? (d.seat >= 0 ? `Player ${d.seat + 1}` : botName(d.slot)), mine: isView(d.seat >= 0 ? d.seat : null, d.seat < 0) });
    }
  }
  // Names go on after the arena, on the screen, so they read at one size on any screen and never pile up.
  const fs = Math.round(Math.max(15, Math.min(22, (15 * Math.min(cw, ch)) / 720)));
  ctx.font = `600 ${fs}px ui-sans-serif, system-ui, sans-serif`;
  const tags: LabelIn[] = [];
  const heads = new Map<number, { x: number; y: number; seat: number; mine: boolean }>();
  const viewAt = list.find((a) => a.mine) ?? null;
  for (const a of list) {
    const colour = colourOf(a.slot, a.bot ? null : a.seat);
    const fx = bodyFx(a.slot, t);
    ctx.save();
    ctx.translate(a.x + fx.ox, a.y + fx.oy); ctx.rotate(fx.ang); ctx.scale(fx.sx, fx.sy); ctx.rotate(-fx.ang);
    ctx.globalAlpha = a.bot ? 0.62 : 1;
    ctx.fillStyle = colour; ctx.beginPath(); ctx.arc(0, 0, R_AV, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.arc(0, 0, R_AV * 0.45, 0, Math.PI * 2); ctx.fill();
    if (fx.flash > 0) { ctx.globalAlpha = fx.flash; ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(0, 0, R_AV, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
    if (a.mine) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(a.x, a.y, R_AV + 7, 0, Math.PI * 2); ctx.stroke(); }
    ctx.globalAlpha = 1;
    const text = a.mine && !net.watching ? 'You' : label(a.name, a.bot);
    const sx = cw / 2 + (a.x - cam.x) * scale; const sy = ch / 2 + (a.y - cam.y) * scale; const r = (R_AV + (a.mine ? 7 : 0)) * scale;
    if (sx + r < 0 || sx - r > cw || sy + r < 0 || sy - r > ch) continue; // off screen: no name at the edge
    if (a.seat !== null && !a.bot) heads.set(a.slot, { x: sx, y: sy - r - 5, seat: a.seat, mine: a.mine });
    // People before bots, nearer the view's body first; each keeps off the others' bodies when it can.
    tags.push({ key: a.slot, text, x: sx, y: sy - r - 5, w: ctx.measureText(text).width, h: fs * 1.2, below: sy + r + 4 + fs * 1.2, body: { left: sx - r, top: sy - r, right: sx + r, bottom: sy + r }, self: a.mine, rank: (a.bot ? 10_000 : 0) + (viewAt ? Math.hypot(a.x - viewAt.x, a.y - viewAt.y) : 0) });
  }
  const box = caseDrawAt(list);
  ctx.save();
  ctx.translate(box.x, box.held ? box.y - R_AV - 8 : box.y);
  const bob = box.held ? 0 : Math.sin(t / 180) * 3;
  ctx.translate(0, bob);
  ctx.fillStyle = 'rgba(255,209,102,0.35)'; ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#140e04'; ctx.fillRect(-12, -8, 24, 16);
  ctx.strokeStyle = box.heat > 66 ? '#ff5b3a' : '#ffd166'; ctx.lineWidth = 2.5; ctx.strokeRect(-12, -8, 24, 16);
  ctx.fillStyle = '#fff1c2'; ctx.fillRect(-4, -3, 8, 6);
  ctx.restore();
  drawSparks(t, scale);
  lab.draw(ctx, scale);
  ctx.restore();
  shownLabels = labels.place(tags, Math.min(0.1, (t - (lastDraw || t)) / 1000));
  lastDraw = t;
  ctx.font = `600 ${fs}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  for (const l of [...shownLabels].sort((x, y) => Number(Boolean(x.self)) - Number(Boolean(y.self)))) {
    if (l.alpha <= 0) continue;
    ctx.globalAlpha = l.alpha;
    if (l.moved) {
      // Off its own spot: a thin line to its body says whose it is.
      const under = l.top > l.y;
      ctx.strokeStyle = 'rgba(232,236,245,0.4)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(l.cx, under ? l.top : l.bottom); ctx.lineTo(l.x, under ? (l.body?.bottom ?? l.top - 6) : l.y + 2); ctx.stroke();
    }
    if (l.self) { ctx.fillStyle = 'rgba(6,10,20,0.7)'; ctx.beginPath(); ctx.roundRect(l.left - 5, l.top - 1, l.right - l.left + 10, l.bottom - l.top + 2, 6); ctx.fill(); }
    else { ctx.strokeStyle = 'rgba(4,6,12,0.85)'; ctx.lineWidth = 3; ctx.strokeText(l.text, l.cx, l.cy); }
    ctx.fillStyle = l.self ? '#ffffff' : 'rgba(232,236,245,0.85)';
    ctx.fillText(l.text, l.cx, l.cy);
  }
  ctx.globalAlpha = 1; ctx.textBaseline = 'alphabetic';
  // Speech bubbles (room chat): over each speaker's name, the view's own player first.
  if (bubbles.size) {
    const anchors: BubbleIn[] = [];
    for (const [slot, h] of heads) {
      const l = shownLabels.find((x) => x.key === slot && x.alpha > 0 && !x.moved);
      anchors.push({ key: h.seat, x: l ? l.cx : h.x, y: l ? l.top - 1 : h.y, self: h.mine });
    }
    shownBubbles = bubbles.place(anchors);
    paintBubbles(ctx, shownBubbles);
  } else shownBubbles = [];

  hud(cw, ch, phone, list);
  if (stick.active) {
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(stick.ox, stick.oy, 56, 0, Math.PI * 2); ctx.stroke();
    const dx = stick.x - stick.ox; const dy = stick.y - stick.oy; const len = Math.hypot(dx, dy); const m = len > 56 ? 56 / len : 1;
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.arc(stick.ox + dx * m, stick.oy + dy * m, 24, 0, Math.PI * 2); ctx.fill();
  }
}

function hud(cw: number, ch: number, phone: boolean, list: { slot: number; name: string; bot: boolean; mine: boolean }[]): void {
  const pad = phone ? 14 : 20;
  const debugStrip = new URLSearchParams(location.search).get('debug') === '1' || (window as unknown as { HOMIE_NET?: { debug?: boolean } }).HOMIE_NET?.debug;
  const top = pad + (debugStrip ? (phone ? 50 : 26) : 0);
  const now = net.now();
  const r = round;
  ctx.textAlign = 'left'; ctx.fillStyle = '#e8ecf5';
  ctx.font = `700 ${phone ? 20 : 24}px ui-sans-serif, system-ui, sans-serif`;
  const left = r ? Math.max(0, Math.ceil((r.endsAt - now) / 1000)) : 0;
  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  ctx.fillText(r ? (r.phase === 'live' ? `Round ${r.n} · ${clock}` : `Next round in ${left}`) : 'Joining…', pad, top + 18);
  const box = caseNow();
  const mineSlot = list.find((a) => a.mine)?.slot;
  const status = box.holder < 0 ? 'Case is loose' : mineSlot !== undefined && box.holder === mineSlot ? 'You have the case' : 'Someone has the case';
  ctx.font = `600 ${phone ? 13 : 15}px ui-sans-serif, system-ui, sans-serif`;
  ctx.fillStyle = box.holder < 0 ? '#ffd166' : mineSlot !== undefined && box.holder === mineSlot ? '#ffffff' : 'rgba(232,236,245,0.8)';
    ctx.fillText(status, pad, top + 40);
    if (mineSlot !== undefined && box.holder === mineSlot) {
      const bw = phone ? 120 : 160;
      ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(pad, top + 50, bw, 6);
      ctx.fillStyle = box.heat > 66 ? '#ff5b3a' : '#ffd166'; ctx.fillRect(pad, top + 50, bw * (box.heat / 100), 6);
    }
  // scores
  const scores = new Map<number, number>();
  if (hosting) for (const b of bodies.values()) scores.set(b.slot, b.score);
  else for (const d of drawn.values()) scores.set(d.slot, d.score);
  const rows = [...list].sort((a, b) => (scores.get(b.slot) ?? 0) - (scores.get(a.slot) ?? 0)).slice(0, phone ? 4 : 6);
  ctx.font = `600 ${phone ? 14 : 16}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'right';
  // The play page's room button (and a server's pill beside it) sit at the top right (game.json screen.share's
  // default): the scores start under that band, so the buttons never cover a score.
  const board = top + 18 + 44;
  rows.forEach((a, i) => {
    ctx.fillStyle = a.mine ? '#ffffff' : a.bot ? 'rgba(232,236,245,0.55)' : 'rgba(232,236,245,0.85)';
    ctx.fillText(`${a.mine && !net.watching ? 'You' : label(a.name, a.bot)}  ${scores.get(a.slot) ?? 0}`, cw - pad, board + i * (phone ? 20 : 22));
  });
  // role badge
  ctx.textAlign = 'left'; ctx.font = '600 11px ui-monospace, Menlo, monospace'; ctx.fillStyle = 'rgba(125,240,255,0.7)';
  ctx.fillText(net.offline ? 'OFFLINE HOST' : net.watching ? 'WATCHING' : net.role.toUpperCase(), pad, ch - pad);
  if (r && r.phase === 'over' && r.results) {
    const w = Math.min(360, cw - 40); const h = 44 + Math.min(6, r.results.length) * 26;
    const x = (cw - w) / 2; const y = (ch - h) / 2;
    ctx.fillStyle = 'rgba(6,10,20,0.86)'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(125,240,255,0.5)'; ctx.strokeRect(x, y, w, h);
    ctx.textAlign = 'center'; ctx.fillStyle = '#7df0ff'; ctx.font = '700 18px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(`Round ${r.n} results`, cw / 2, y + 28);
    ctx.font = '600 16px ui-sans-serif, system-ui, sans-serif';
    const view = viewSeat();
    r.results.slice(0, 6).forEach((row, i) => {
      const mine = !row.bot && row.seat !== null && row.seat === view;
      ctx.fillStyle = mine ? '#ffffff' : row.bot ? 'rgba(232,236,245,0.6)' : '#e8ecf5';
      ctx.fillText(`${row.place}. ${mine && !net.watching ? 'You' : label(row.name, row.bot)}${mine && net.watching ? ' ◂' : ''} — ${row.score}`, cw / 2, y + 56 + i * 26);
    });
  }
  if (!net.offline && !net.connected && net.role !== 'host') {
    ctx.textAlign = 'center'; ctx.fillStyle = '#ffd166'; ctx.font = '600 14px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('Reconnecting…', cw / 2, ch - pad);
  }
  if (frames < 240 && mySeat() !== null) {
    ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(232,236,245,0.7)'; ctx.font = '500 14px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(phone ? 'Drag to move · bank the case on DROP · a second finger bumps' : 'WASD to move · bank the case on DROP · Space bumps', cw / 2, ch - pad - 18);
  }
}

/* ------------------------------------------------------------------ loop */
function frame(t: number): void {
  const dt = lab.time.dt(t, 0.05);
  stepMe(dt);
  if (hosting) stepHost(dt);
  else stepReplica(dt);
  if (lab.on) labReport(dt);
  draw(t);
  frames += 1;
  requestAnimationFrame(frame);
}

net.expose({
  // Room chat's bubbles on this screen now: whose, what, and where (an end-to-end test reads them).
  bubbles: () => shownBubbles.map((b) => ({ seat: b.key, text: b.lines.join(' '), alpha: b.alpha, left: Math.round(b.left), top: Math.round(b.top), right: Math.round(b.right), bottom: Math.round(b.bottom) })),
  self: () => (me.has ? { x: me.x, y: me.y } : null),
  peer: (seat: number) => {
    if (hosting) { const b = [...bodies.values()].find((x) => x.seat === seat); return b ? { x: b.x, y: b.y } : null; }
    const d = [...drawn.values()].find((x) => x.seat === seat);
    return d ? { x: d.x, y: d.y } : null;
  },
  frames: () => frames,
  scores: () => (hosting ? [...bodies.values()].map((b) => ({ slot: b.slot, seat: b.seat, bot: b.bot, score: b.score })) : [...drawn.values()].map((d) => ({ slot: d.slot, seat: d.seat >= 0 ? d.seat : null, bot: d.seat < 0, score: d.score }))),
  /** Host: case grabs this round, the round's age, and the dial each bot plays at. */
  pickups: () => (hosting ? { round: round ? { n: round.n, phase: round.phase, ageMs: net.now() - round.startedAt } : null, slots: [...bodies.values()].map((b) => ({ slot: b.slot, bot: b.bot, gems: pickups.get(b.slot) ?? 0, level: b.bot ? net.skillOf(b.slot).level : null })) } : null),
  /** Host: when each bot last looked (its reaction clock). */
  sight: () => (hosting ? [...sight.entries()].map(([slot, e]) => ({ slot, at: e.at })) : null),
  waves: () => wavesSeen,
  knocks: () => knocksSeen,
  zone: () => zone,
  owned: () => net.owned,
  cheatResets: () => cheatResets,
  movement: () => MOVEMENT,
  controlResets: () => controlResets,
  predictionError: () => predictionError,
  /** Where the camera looks and whose view it is (a watcher following a player: their body, under the camera). */
  camera: () => ({ x: cam.x, y: cam.y, scale: cam.scale, view: viewSeat() }),
  /** The names as drawn (boxes, never the text): the e2e probe counts overlaps and checks your own. */
  labels: () => shownLabels.map((l) => ({ self: Boolean(l.self), alpha: l.alpha, moved: l.moved, left: Math.round(l.left), top: Math.round(l.top), right: Math.round(l.right), bottom: Math.round(l.bottom) })),
  /** performance.now() of the first keyed-state value and the first live snapshot this browser received. */
  arrivals: () => ({ firstStateAt, firstSnapAt }),
  /** Harness hook (host only): knock the body of `seat` back, toward the middle of the arena. */
  debugKnock: (seat: number) => {
    if (!hosting) return false;
    const b = [...bodies.values()].find((x) => x.seat === seat);
    if (!b) return false;
    knock(b, b.x < W / 2 ? b.x - 1 : b.x + 1, b.y); // push toward the middle, away from the nearer wall
    return true;
  },
});

exposePort(net, {
  view: 'top',
  self: () => (me.has && mySeat() !== null ? { x: me.x, y: me.y } : null),
  size: R_AV,
  score: () => { const seat = mySeat(); const b = hosting ? [...bodies.values()].find((x) => x.seat === seat) : [...drawn.values()].find((x) => x.seat === seat); return b ? b.score : null; },
});

void net.ready.then(() => {
  const seat = mySeat();
  if (seat !== null && hosting) {
    const b = [...bodies.values()].find((x) => x.seat === seat);
    if (b) { me.x = b.x; me.y = b.y; me.has = true; }
  }
});
requestAnimationFrame(frame);
