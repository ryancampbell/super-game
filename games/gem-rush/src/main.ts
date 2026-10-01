/*
 * GEM RUSH — the netplay v1 reference game (@homie-rocks/studio/netplay/NETPLAY.md).
 *
 * Move, collect gems, score; 60 s rounds that cycle forever; the round starts
 * the moment the first browser arrives, with two bots, and every human who
 * arrives takes a bot's body. Every browser renders the game itself with its
 * own camera. One browser is host: it runs pickups, scoring, bots and the
 * clock, and broadcasts snapshots. Everyone else moves their own avatar
 * locally (instant) and sends it to the host; everything else is drawn from
 * interpolated snapshots. If the host leaves, a survivor continues the SAME
 * round from the relay's checkpoint.
 *
 * It also exercises the rest of the contract: a wave near another body knocks
 * it back (the host TAKES a client-owned body, drives the knockback itself, and
 * GIVES it back), replica movement is speed-capped on the host, and the hot
 * zone (gems inside it score double) is slow state on the keyed state channel,
 * so a joiner has it in its welcome and a promoted host inherits it.
 *
 * Canvas 2D on purpose: the point is the contract, in ~700 readable lines.
 */
import { createNetplay, Roster, q, lerp, capMove, type RoleChange, type RoundInfo, type RoundResult, type Slot, type Snapshot } from '@homie-rocks/studio/netplay';
// The port toolkit's probe: what `homie-studio port check` reads for the owner tests (and sandbox + audio shims).
import { exposePort } from '@homie-rocks/studio/port';

/* ------------------------------------------------------------------ rules */
const W = 1600;
const H = 1000;
const R_AV = 22;
const R_GEM = 13;
const SPEED = 340;
const BOT_SPEED = 250;
const ROUND_MS = 60_000;
const BREAK_MS = 7_000;
const GEM_COUNT = 14;
const MIN_SLOTS = 3; // 1 human + 2 bots from the first frame
const MAX_SLOTS = 8;
const KNOCK_RANGE = 110;
const KNOCK_SPEED = 950;
const KNOCK_MS = 420;
const ZONE_MS = 12_000;
const PALETTE = ['#8fe36a', '#ffd166', '#ef6f6c', '#6cb4ee', '#c792ea', '#f4a261', '#2ec4b6', '#ff8fab', '#a7c957', '#e9c46a', '#90e0ef', '#f28482'];
const BOT_NAMES = ['Rook', 'Vex', 'Moth', 'Kilo', 'Juno', 'Pike', 'Nyx', 'Ash'];
const botName = (slot: number): string => BOT_NAMES[slot % BOT_NAMES.length] as string;
const label = (name: string, bot: boolean): string => (bot ? `${name} · bot` : name);

/* ------------------------------------------------------------ wire shapes */
/** Snapshot: compact arrays, quantized. ~40 B per body, ~16 B per gem. (Reset epochs ride in the helper's `c` table.) */
type P = [slot: number, seat: number, x: number, y: number, score: number, vx: number, vy: number];
type G = [id: number, x: number, y: number];
interface Snap { r: [n: number, phase: number, startedAt: number, endsAt: number]; p: P[]; g: G[] }
/**
 * Replica input: the avatar (owner movement) AND the stick intent (host movement), so either mode reads the same
 * frame. The helper stamps the reset epoch the replica has adopted.
 */
type Avatar = [x: number, y: number, vx: number, vy: number, mx: number, my: number];
interface Body { slot: number; seat: number | null; name: string; bot: boolean; x: number; y: number; vx: number; vy: number; score: number; tx: number; ty: number; kvx: number; kvy: number; knockUntil: number }
interface Gem { id: number; x: number; y: number }
/** Slow state, on the keyed state channel (net.state('zone', ...)), not in the 20 Hz snapshot. */
interface Zone { n: number; x: number; y: number; r: number; until: number }
interface Ckpt { round: RoundInfo; bodies: Body[]; gems: Gem[]; roster: Slot[]; tick: number; gemSeq: number }

/* --------------------------------------------------------------- the net */
/**
 * `?movement=host` plays host movement: the host moves every body from the seats' stick intents (its rules own
 * movement), and each replica PREDICTS its own body by replaying its unacknowledged intents on the host's position.
 * Default `owner`: each browser moves its own body and the host bounds it.
 */
const MOVEMENT: 'owner' | 'host' = (() => { try { return new URLSearchParams(location.search).get('movement') === 'host' ? 'host' : 'owner'; } catch { return 'owner'; } })();
const net = createNetplay<Snap, Avatar, Ckpt>({ game: 'gem-rush', maxPlayers: MAX_SLOTS, movement: MOVEMENT, snapshotHz: 20, inputHz: 20, checkpointMs: 1000, checkpoint: () => checkpoint() });

/* ------------------------------------------------------------ host state */
let roster = new Roster({ min: MIN_SLOTS, max: MAX_SLOTS, botName });
let bodies = new Map<number, Body>();
let gems: Gem[] = [];
let gemSeq = 0;
let round: RoundInfo | null = null;
let zone: Zone | null = null;
let tick = 0;
let hosting = false;
let cheatResets = 0;
let controlResets = 0;
let predictionError = 0;

/* ------------------------------------------------ this browser's avatar */
const me = { x: W / 2, y: H / 2, vx: 0, vy: 0, kvx: 0, kvy: 0, knockUntil: 0, has: false };
/** Offline (no shell) plays as a local seat 0, with keys or touch. */
const mySeat = (): number | null => (net.offline ? 0 : net.seat);

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
const newGem = (): Gem => ({ id: ++gemSeq, x: rnd(60, W - 60), y: rnd(60, H - 60) });

function bodyFor(slot: Slot): Body {
  const sp = spawnPoint(slot.slot);
  return { slot: slot.slot, seat: slot.seat, name: slot.name, bot: slot.bot, x: sp.x, y: sp.y, vx: 0, vy: 0, score: 0, tx: sp.x, ty: sp.y, kvx: 0, kvy: 0, knockUntil: 0 };
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
  return { n, x: rnd(220, W - 220), y: rnd(200, H - 200), r: 150, until: net.now() + ZONE_MS };
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
  gems = Array.from({ length: GEM_COUNT }, newGem);
  round = { n, phase: 'live', startedAt: now, endsAt: now + ROUND_MS };
  setZone(newZone((zone?.n ?? 0) + 1));
  net.round(round);
  publishRoster();
  net.snapshot(buildSnap(), tick, true);
}

function endRound(): void {
  if (!round) return;
  const now = net.now();
  const ranked = [...bodies.values()].sort((a, b) => b.score - a.score || Number(a.bot) - Number(b.bot) || a.slot - b.slot);
  const results: RoundResult[] = ranked.map((b, i) => ({ slot: b.slot, seat: b.seat, name: b.name, score: b.score, bot: b.bot, place: i + 1 }));
  round = { n: round.n, phase: 'over', startedAt: now, endsAt: now + BREAK_MS, results };
  net.round(round);
}

/* ---------------------------------------------------- becoming the host */
function becomeHost(e: RoleChange<Snap, Ckpt>): void {
  hosting = true;
  if (e.promoted) restore(e);
  else {
    roster = new Roster({ min: MIN_SLOTS, max: MAX_SLOTS, botName });
    bodies = new Map();
    const seat = mySeat();
    if (seat !== null) roster.claim(seat, net.offline ? 'You' : net.name);
    syncBodiesFromRoster();
    startRound((e.round?.n ?? 0) + 1);
  }
  // Whoever is connected now is who plays: seats that left during the gap become bots.
  const peers = net.offline ? [{ seat: 0, name: 'You' }] : [...net.peers.values()].filter((p) => p.seat !== null);
  const { claimed } = roster.reconcile(peers);
  syncBodiesFromRoster();
  for (const s of claimed) { const b = bodies.get(s.slot); if (b && b.seat !== mySeat()) hostMoved(b); }
  // My own body is wherever my local avatar is: it was client-owned a moment ago and still is.
  const mine = mySeat() !== null ? [...bodies.values()].find((b) => b.seat === mySeat()) : undefined;
  if (mine && me.has) { mine.x = me.x; mine.y = me.y; }
  else if (mine) { me.x = mine.x; me.y = mine.y; me.has = true; }
  // The hot zone is keyed state: the relay handed it over with the role.
  zone = net.stateOf<Zone>('zone') ?? zone;
  if (!zone && round) setZone(newZone(1));
  publishRoster();
}

function restore(e: RoleChange<Snap, Ckpt>): void {
  const ck = e.ckpt?.d ?? null;
  if (ck) {
    roster = Roster.from(ck.roster, { min: MIN_SLOTS, max: MAX_SLOTS, botName });
    bodies = new Map(ck.bodies.map((b) => [b.slot, { ...b }]));
    gems = ck.gems.map((g) => ({ ...g }));
    gemSeq = ck.gemSeq;
    round = ck.round;
    tick = ck.tick;
  } else {
    roster = Roster.from(e.roster ?? [], { min: MIN_SLOTS, max: MAX_SLOTS, botName });
    bodies = new Map();
    syncBodiesFromRoster();
  }
  // The snapshot is newer than the checkpoint (20 Hz vs 1 Hz): positions, scores and gems from it.
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
    gems = s.d.g.map(([id, x, y]) => ({ id, x, y }));
    gemSeq = Math.max(gemSeq, ...gems.map((g) => g.id));
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
    gems: gems.map((g) => ({ ...g })),
    roster: roster.toJSON(),
    tick,
    gemSeq,
  };
}

net.on('role', (e) => {
  if (e.role === 'host') becomeHost(e);
  else { hosting = false; }
});
net.on('join', (p) => {
  if (!hosting || p.seat === null) return;
  const c = roster.claim(p.seat, p.name);
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
    if (b === from || Math.hypot(b.x - from.x, b.y - from.y) > KNOCK_RANGE) continue;
    knock(b, from.x, from.y);
  }
}
/**
 * Host: knock a body back. A replica's body is TAKEN for KNOCK_MS (its owner's avatar frames are ignored; the host
 * drives the knockback; the owner draws its body from snapshots), then the helper GIVES it back with a reset, so
 * the owner stands where the knockback ended. The owner cannot ignore it: the host holds the pen.
 */
function knock(b: Body, fx: number, fy: number): void {
  let dx = b.x - fx; let dy = b.y - fy;
  const len = Math.hypot(dx, dy);
  if (len < 1) { const a = Math.random() * Math.PI * 2; dx = Math.cos(a); dy = Math.sin(a); } else { dx /= len; dy /= len; }
  const until = net.now() + KNOCK_MS;
  if (!b.bot && b.seat !== null && b.seat === mySeat()) { me.kvx = dx * KNOCK_SPEED; me.kvy = dy * KNOCK_SPEED; me.knockUntil = until; }
  else { b.kvx = dx * KNOCK_SPEED; b.kvy = dy * KNOCK_SPEED; b.knockUntil = until; if (!b.bot && b.seat !== null) net.take(b.seat, KNOCK_MS); }
  addWave({ slot: b.slot }, true); net.send('knock', { slot: b.slot });
}
function addWave(d: { slot: number }, isKnock = false): void {
  const pos = hosting ? bodies.get(d.slot) : [...drawn.values()].find((x) => x.slot === d.slot);
  const mineSlot = hosting ? [...bodies.values()].find((x) => x.seat !== null && x.seat === mySeat())?.slot : [...drawn.values()].find((x) => x.seat === net.seat)?.slot;
  const at = mineSlot === d.slot && me.has ? me : pos;
  if (!at) return;
  waves.push({ x: at.x, y: at.y, at: performance.now(), colour: isKnock ? '#ffffff' : PALETTE[d.slot % PALETTE.length] as string, knock: isKnock });
  if (isKnock) knocksSeen += 1; else wavesSeen += 1;
}

/* ---------------------------------------------------------------- simulate */
/** The one movement rule, shared by the owner, the host (host movement) and a replica's prediction. */
function integrate(o: { x: number; y: number; vx: number; vy: number }, mx: number, my: number, dt: number): void {
  mx = Number(mx) || 0; my = Number(my) || 0;
  const len = Math.hypot(mx, my);
  if (len > 1) { mx /= len; my /= len; } // an intent is at most full stick: no speed hack through intents
  const k = Math.min(1, dt * 14);
  o.vx += (mx * SPEED - o.vx) * k;
  o.vy += (my * SPEED - o.vy) * k;
  o.x = Math.max(R_AV, Math.min(W - R_AV, o.x + o.vx * dt));
  o.y = Math.max(R_AV, Math.min(H - R_AV, o.y + o.vy * dt));
}

function stepMe(dt: number): void {
  const seat = mySeat();
  if (seat === null) { me.has = false; return; }
  // Host-driven (host movement, or knocked back on a replica): stepReplica predicts me instead.
  if (!net.owned) return;
  if (me.knockUntil > net.now()) {
    me.x = Math.max(R_AV, Math.min(W - R_AV, me.x + me.kvx * dt)); me.y = Math.max(R_AV, Math.min(H - R_AV, me.y + me.kvy * dt));
    me.kvx *= Math.max(0, 1 - dt * 5); me.kvy *= Math.max(0, 1 - dt * 5);
    return;
  }
  const v = moveVector();
  integrate(me, v.x, v.y, dt);
}

/**
 * Replica, host-driven body. My stick moves me locally every frame (instant response), with the same rule the host
 * runs. When a new snapshot lands: start from where the host has me, replay every intent it had not acknowledged,
 * and pull toward that by 30% (or jump, if it is far). The host stays the truth; I never wait for it.
 */
let predictedK = -1;
function predictMe(dt: number): void {
  const v = moveVector();
  integrate(me, v.x, v.y, dt);
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

function stepKnocked(b: Body, dt: number): void {
  b.x = Math.max(R_AV, Math.min(W - R_AV, b.x + b.kvx * dt)); b.y = Math.max(R_AV, Math.min(H - R_AV, b.y + b.kvy * dt));
  b.kvx *= Math.max(0, 1 - dt * 5); b.kvy *= Math.max(0, 1 - dt * 5);
  b.vx = b.kvx; b.vy = b.kvy;
}

function stepBots(dt: number): void {
  const taken = new Set<number>();
  const now = net.now();
  for (const b of bodies.values()) {
    if (!b.bot) continue;
    if (b.knockUntil > now) { stepKnocked(b, dt); continue; }
    let best: Gem | null = null; let bd = Infinity;
    for (const g of gems) {
      if (taken.has(g.id)) continue;
      const d = Math.hypot(g.x - b.x, g.y - b.y);
      if (d < bd) { bd = d; best = g; }
    }
    if (best) { taken.add(best.id); b.tx = best.x; b.ty = best.y; }
    const dx = b.tx - b.x; const dy = b.ty - b.y; const len = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, dt * 5);
    b.vx += ((dx / len) * BOT_SPEED - b.vx) * k;
    b.vy += ((dy / len) * BOT_SPEED - b.vy) * k;
    b.x = Math.max(R_AV, Math.min(W - R_AV, b.x + b.vx * dt));
    b.y = Math.max(R_AV, Math.min(H - R_AV, b.y + b.vy * dt));
  }
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
      integrate(b, f ? Number(f.a?.[4]) : 0, f ? Number(f.a?.[5]) : 0, dt);
      if (net.takePresses(b.seat)['wave']) hostWave(b);
      continue;
    }
    const a = net.avatar(b.seat); // null while taken, or until the owner has adopted the last reset
    if (a && Array.isArray(a)) {
      // Client-owned movement, bounded: to the arena, and to 1.3x top speed per frame. A legitimate avatar catches
      // up within a frame; a teleport crawls, and a claim more than half a second of running away is reset.
      const claim = { x: Math.max(R_AV, Math.min(W - R_AV, Number(a[0]))), y: Math.max(R_AV, Math.min(H - R_AV, Number(a[1]))) };
      const m = capMove(b, claim, SPEED * 1.3 * dt + 6);
      if (m.over > SPEED * 0.5) { net.reset(b.seat); cheatResets += 1; }
      else { b.x = m.x; b.y = m.y; b.vx = Number(a[2]) || 0; b.vy = Number(a[3]) || 0; }
    }
    if (net.takePresses(b.seat)['wave']) hostWave(b);
  }
  stepBots(dt);
  const now = net.now();
  if (round && round.phase === 'live') {
    if (!zone || now >= zone.until) setZone(newZone((zone?.n ?? 0) + 1));
    for (const b of bodies.values()) {
      for (let i = 0; i < gems.length; i += 1) {
        const g = gems[i] as Gem;
        if (Math.hypot(g.x - b.x, g.y - b.y) < R_AV + R_GEM) {
          b.score += zone && Math.hypot(g.x - zone.x, g.y - zone.y) < zone.r ? 2 : 1;
          gems[i] = newGem();
        }
      }
    }
    if (now >= round.endsAt) endRound();
  } else if (round && round.phase === 'over' && now >= round.endsAt) startRound(round.n + 1);
  if (net.snapshotDue()) net.snapshot(buildSnap(), tick);
}

function buildSnap(): Snap {
  const r = round ?? { n: 0, phase: 'live', startedAt: 0, endsAt: 0 };
  return {
    r: [r.n, r.phase === 'over' ? 1 : 0, r.startedAt, r.endsAt],
    p: [...bodies.values()].map((b) => [b.slot, b.seat ?? -1, q(b.x, 1), q(b.y, 1), b.score, q(b.vx, 0), q(b.vy, 0)] as P),
    g: gems.map((g) => [g.id, q(g.x, 0), q(g.y, 0)] as G),
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

/* ------------------------------------------------------------------ draw */
let dpr = 1;
function resize(): void {
  dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
}
addEventListener('resize', resize);
resize();

const cam = { x: W / 2, y: H / 2 };
const gemGlow = (() => {
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R_GEM * 2.8);
  g.addColorStop(0, 'rgba(255,209,102,0.55)'); g.addColorStop(0.4, 'rgba(255,170,60,0.18)'); g.addColorStop(1, 'rgba(255,150,40,0)');
  return g;
})();
function draw(t: number): void {
  const cw = innerWidth; const ch = innerHeight;
  const phone = Math.min(cw, ch) <= 540;
  const spectating = mySeat() === null;
  const scale = spectating ? Math.min(cw / (W + 80), ch / (H + 80)) : Math.min(cw, ch) / (phone ? 560 : 820);
  const target = spectating || !me.has ? { x: W / 2, y: H / 2 } : me;
  cam.x += (target.x - cam.x) * 0.2; cam.y += (target.y - cam.y) * 0.2;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const bg = ctx.createRadialGradient(cw / 2, ch / 2, 0, cw / 2, ch / 2, Math.max(cw, ch) * 0.8);
  bg.addColorStop(0, '#0d1426'); bg.addColorStop(1, '#04060c');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, cw, ch);

  ctx.save();
  ctx.translate(cw / 2, ch / 2); ctx.scale(scale, scale); ctx.translate(-cam.x, -cam.y);
  // arena
  ctx.strokeStyle = 'rgba(125,240,255,0.07)'; ctx.lineWidth = 1 / scale;
  ctx.beginPath();
  for (let x = 0; x <= W; x += 100) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (let y = 0; y <= H; y += 100) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(125,240,255,0.55)'; ctx.lineWidth = 4; ctx.strokeRect(0, 0, W, H);
  // hot zone (keyed state): gems inside score double
  if (zone) {
    const pulse = 0.5 + 0.5 * Math.sin(t / 300);
    ctx.fillStyle = `rgba(255,120,190,${0.06 + 0.05 * pulse})`; ctx.beginPath(); ctx.arc(zone.x, zone.y, zone.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,140,200,0.6)'; ctx.lineWidth = 3; ctx.setLineDash([14, 10]); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,170,215,0.85)'; ctx.font = '700 16px ui-sans-serif, system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('×2', zone.x, zone.y + 6);
  }

  // gems
  const gemList: { x: number; y: number; id: number }[] = hosting ? gems : (net.latest()?.d.g ?? []).map(([id, x, y]) => ({ id, x, y }));
  for (const g of gemList) {
    const spin = t / 500 + g.id;
    const r = R_GEM * (1 + 0.12 * Math.sin(t / 200 + g.id));
    ctx.save(); ctx.translate(g.x, g.y);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = gemGlow; ctx.beginPath(); ctx.arc(0, 0, r * 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.rotate(spin);
    ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * 0.8, 0); ctx.lineTo(0, r); ctx.lineTo(-r * 0.8, 0); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // waves
  for (let i = waves.length - 1; i >= 0; i -= 1) {
    const w = waves[i] as (typeof waves)[number];
    const age = (t - w.at) / 900;
    if (age > 1) { waves.splice(i, 1); continue; }
    ctx.strokeStyle = w.colour; ctx.globalAlpha = 1 - age; ctx.lineWidth = w.knock ? 3 : 5;
    ctx.beginPath(); ctx.arc(w.x, w.y, w.knock ? R_AV + 6 + age * 40 : R_AV + age * (KNOCK_RANGE + 10), 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
  }

  // avatars
  const names = new Map<number, Slot>((net.slots ?? roster.slots).map((s) => [s.slot, s]));
  const list: { slot: number; seat: number | null; x: number; y: number; bot: boolean; name: string; mine: boolean }[] = [];
  if (hosting) {
    for (const b of bodies.values()) list.push({ slot: b.slot, seat: b.seat, x: b.x, y: b.y, bot: b.bot, name: b.name, mine: b.seat !== null && b.seat === mySeat() });
  } else {
    for (const d of drawn.values()) {
      const mine = d.seat >= 0 && d.seat === net.seat;
      const s = names.get(d.slot);
      list.push({ slot: d.slot, seat: d.seat >= 0 ? d.seat : null, x: mine && me.has ? me.x : d.x, y: mine && me.has ? me.y : d.y, bot: d.seat < 0, name: s?.name ?? (d.seat >= 0 ? `Player ${d.seat + 1}` : botName(d.slot)), mine });
    }
  }
  for (const a of list) {
    const colour = PALETTE[a.slot % PALETTE.length] as string;
    ctx.globalAlpha = a.bot ? 0.62 : 1;
    ctx.fillStyle = colour; ctx.beginPath(); ctx.arc(a.x, a.y, R_AV, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.arc(a.x, a.y, R_AV * 0.45, 0, Math.PI * 2); ctx.fill();
    if (a.mine) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(a.x, a.y, R_AV + 7, 0, Math.PI * 2); ctx.stroke(); }
    ctx.globalAlpha = 1;
    ctx.font = `600 ${Math.round(15 / Math.max(0.6, scale))}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.fillStyle = a.mine ? '#ffffff' : 'rgba(232,236,245,0.8)';
    ctx.fillText(a.mine ? 'You' : label(a.name, a.bot), a.x, a.y - R_AV - 12);
  }
  ctx.restore();

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
  // scores
  const scores = new Map<number, number>();
  if (hosting) for (const b of bodies.values()) scores.set(b.slot, b.score);
  else for (const d of drawn.values()) scores.set(d.slot, d.score);
  const rows = [...list].sort((a, b) => (scores.get(b.slot) ?? 0) - (scores.get(a.slot) ?? 0)).slice(0, phone ? 4 : 6);
  ctx.font = `600 ${phone ? 14 : 16}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'right';
  rows.forEach((a, i) => {
    ctx.fillStyle = a.mine ? '#ffffff' : a.bot ? 'rgba(232,236,245,0.55)' : 'rgba(232,236,245,0.85)';
    ctx.fillText(`${a.mine ? 'You' : label(a.name, a.bot)}  ${scores.get(a.slot) ?? 0}`, cw - pad, top + 18 + i * (phone ? 20 : 22));
  });
  // role badge
  ctx.textAlign = 'left'; ctx.font = '600 11px ui-monospace, Menlo, monospace'; ctx.fillStyle = 'rgba(125,240,255,0.7)';
  ctx.fillText(net.offline ? 'OFFLINE HOST' : net.role.toUpperCase(), pad, ch - pad);
  if (r && r.phase === 'over' && r.results) {
    const w = Math.min(360, cw - 40); const h = 44 + Math.min(6, r.results.length) * 26;
    const x = (cw - w) / 2; const y = (ch - h) / 2;
    ctx.fillStyle = 'rgba(6,10,20,0.86)'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(125,240,255,0.5)'; ctx.strokeRect(x, y, w, h);
    ctx.textAlign = 'center'; ctx.fillStyle = '#7df0ff'; ctx.font = '700 18px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(`Round ${r.n} results`, cw / 2, y + 28);
    ctx.font = '600 16px ui-sans-serif, system-ui, sans-serif';
    r.results.slice(0, 6).forEach((row, i) => {
      const mine = row.seat !== null && row.seat === mySeat();
      ctx.fillStyle = mine ? '#ffffff' : row.bot ? 'rgba(232,236,245,0.6)' : '#e8ecf5';
      ctx.fillText(`${row.place}. ${mine ? 'You' : label(row.name, row.bot)} — ${row.score}`, cw / 2, y + 56 + i * 26);
    });
  }
  if (!net.offline && !net.connected && net.role !== 'host') {
    ctx.textAlign = 'center'; ctx.fillStyle = '#ffd166'; ctx.font = '600 14px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('Reconnecting…', cw / 2, ch - pad);
  }
  if (frames < 240 && mySeat() !== null) {
    ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(232,236,245,0.7)'; ctx.font = '500 14px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(phone ? 'Drag to move · second finger bumps' : 'WASD / arrows to move · Space bumps', cw / 2, ch - pad - 18);
  }
}

/* ------------------------------------------------------------------ loop */
let last = performance.now();
function frame(t: number): void {
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  stepMe(dt);
  if (hosting) stepHost(dt);
  else stepReplica(dt);
  draw(t);
  frames += 1;
  requestAnimationFrame(frame);
}

net.expose({
  self: () => (me.has ? { x: me.x, y: me.y } : null),
  peer: (seat: number) => {
    if (hosting) { const b = [...bodies.values()].find((x) => x.seat === seat); return b ? { x: b.x, y: b.y } : null; }
    const d = [...drawn.values()].find((x) => x.seat === seat);
    return d ? { x: d.x, y: d.y } : null;
  },
  frames: () => frames,
  scores: () => (hosting ? [...bodies.values()].map((b) => ({ slot: b.slot, seat: b.seat, bot: b.bot, score: b.score })) : [...drawn.values()].map((d) => ({ slot: d.slot, seat: d.seat >= 0 ? d.seat : null, bot: d.seat < 0, score: d.score }))),
  waves: () => wavesSeen,
  knocks: () => knocksSeen,
  zone: () => zone,
  owned: () => net.owned,
  cheatResets: () => cheatResets,
  movement: () => MOVEMENT,
  controlResets: () => controlResets,
  predictionError: () => predictionError,
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
