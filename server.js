const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

// ── Physics constants (mirrored from game.js) ──
const W = 900, H = 550;
const PAD_W = 14, PAD_H = 90, BALL_R = 7, PAD_MARGIN = 28;
const WIN_SCORE = 7;
const PHYSICS_STEP = 1000 / 60;

// ── Ability data ──
const ABILITY_COOLDOWNS = { freeze: 8000, surge: 6000, curve: 10000, shield: 12000, ghost: 9000, dash: 5000 };
const ABILITY_DURATIONS  = { freeze: 1500, surge: 0,    curve: 800,   shield: 2000,  ghost: 1500, dash: 0    };

function makeAbility(id) {
  return { id, cooldown: 0, active: 0, ready: true, surgePending: false };
}

function tickAbility(ab, dt) {
  if (ab.cooldown > 0) {
    ab.cooldown = Math.max(0, ab.cooldown - dt);
    if (ab.cooldown === 0) ab.ready = true;
  }
  if (ab.active > 0) ab.active = Math.max(0, ab.active - dt);
}

function activateAbility(ab) {
  if (!ab.ready) return false;
  ab.ready = false;
  ab.cooldown = ABILITY_COOLDOWNS[ab.id];
  const dur = ABILITY_DURATIONS[ab.id];
  if (dur > 0) ab.active = dur;
  if (ab.id === 'surge') ab.surgePending = true;
  return true;
}

function applyAbility(s, side, id) {
  switch (id) {
    case 'freeze':
      if (side === 'p1') s.p2Frozen = true; else s.p1Frozen = true;
      break;
    case 'curve': {
      const toTop = side === 'p1' ? s.ball.vx < 0 : s.ball.vx > 0;
      s.curveForce = toTop ? -90 : 90;
      break;
    }
    case 'shield':
      if (side === 'p1') s.p1Shield = true; else s.p2Shield = true;
      break;
    case 'ghost':
      s.ghostActive = true;
      break;
    case 'dash':
      if (side === 'p1') s.p1Y = Math.max(0, Math.min(H - PAD_H, s.ball.y - PAD_H / 2));
      else               s.p2Y = Math.max(0, Math.min(H - PAD_H, s.ball.y - PAD_H / 2));
      break;
  }
}

function resetBall(s, dir) {
  const angle = Math.random() * 0.5 - 0.25;
  const spd = 5;
  s.ball = { x: W / 2, y: H / 2, vx: dir * spd * Math.cos(angle), vy: spd * Math.sin(angle) };
  s.ghostActive = false;
  s.curveForce = 0;
}

function reflectBall(s, hitter) {
  const padY = hitter === 'p1' ? s.p1Y : s.p2Y;
  const rel = (s.ball.y - (padY + PAD_H / 2)) / (PAD_H / 2);
  let spd = Math.min(Math.hypot(s.ball.vx, s.ball.vy) * 1.045, 18);
  if (hitter === 'p1' && s.p1Ability.surgePending) { spd *= 2; s.p1Ability.surgePending = false; }
  if (hitter === 'p2' && s.p2Ability.surgePending) { spd *= 2; s.p2Ability.surgePending = false; }
  const dir = hitter === 'p1' ? 1 : -1;
  const angle = rel * 1.15;
  s.ball.vx = dir * spd * Math.cos(angle);
  s.ball.vy = spd * Math.sin(angle);
}

function makeGameState(p1Ab, p2Ab) {
  const s = {
    ball: { x: W / 2, y: H / 2, vx: 0, vy: 0 },
    p1Y: H / 2 - PAD_H / 2,
    p2Y: H / 2 - PAD_H / 2,
    p1Score: 0, p2Score: 0,
    p1Ability: makeAbility(p1Ab),
    p2Ability: makeAbility(p2Ab),
    p1Frozen: false, p2Frozen: false,
    ghostActive: false,
    p1Shield: false, p2Shield: false,
    curveForce: 0,
    phase: 'playing', winner: null,
  };
  resetBall(s, Math.random() < 0.5 ? 1 : -1);
  return s;
}

function tickGameState(s, inputs) {
  const dt = PHYSICS_STEP;

  // Apply inputs
  if (!s.p1Frozen && inputs.p1MouseY != null)
    s.p1Y = Math.max(0, Math.min(H - PAD_H, inputs.p1MouseY - PAD_H / 2));
  if (!s.p2Frozen && inputs.p2MouseY != null)
    s.p2Y = Math.max(0, Math.min(H - PAD_H, inputs.p2MouseY - PAD_H / 2));

  // Curve
  if (s.curveForce !== 0) s.ball.vy += s.curveForce * dt * 0.001;

  s.ball.x += s.ball.vx;
  s.ball.y += s.ball.vy;

  // Wall bounce
  if (s.ball.y - BALL_R <= 0)  { s.ball.y = BALL_R;      s.ball.vy =  Math.abs(s.ball.vy); }
  if (s.ball.y + BALL_R >= H)  { s.ball.y = H - BALL_R;  s.ball.vy = -Math.abs(s.ball.vy); }

  // P1 paddle (left)
  const ax = PAD_MARGIN;
  if (s.ball.vx < 0
    && s.ball.x - BALL_R <= ax + PAD_W && s.ball.x + BALL_R > ax
    && s.ball.y + BALL_R >= s.p1Y && s.ball.y - BALL_R <= s.p1Y + PAD_H) {
    s.ball.x = ax + PAD_W + BALL_R;
    reflectBall(s, 'p1');
  }

  // P2 paddle (right)
  const px = W - PAD_MARGIN - PAD_W;
  if (s.ball.vx > 0
    && s.ball.x + BALL_R >= px && s.ball.x - BALL_R < px + PAD_W
    && s.ball.y + BALL_R >= s.p2Y && s.ball.y - BALL_R <= s.p2Y + PAD_H) {
    s.ball.x = px - BALL_R;
    reflectBall(s, 'p2');
  }

  // Shields
  if (s.p1Shield && s.ball.x - BALL_R <= 6) { s.ball.x = 6 + BALL_R; s.ball.vx = Math.abs(s.ball.vx); }
  if (s.p2Shield && s.ball.x + BALL_R >= W - 6) { s.ball.x = W - 6 - BALL_R; s.ball.vx = -Math.abs(s.ball.vx); }

  // Scoring
  if (s.ball.x < 0) {
    s.p2Score++;
    if (s.p2Score >= WIN_SCORE) { s.phase = 'gameover'; s.winner = 'p2'; return; }
    resetBall(s, 1);
  }
  if (s.ball.x > W) {
    s.p1Score++;
    if (s.p1Score >= WIN_SCORE) { s.phase = 'gameover'; s.winner = 'p1'; return; }
    resetBall(s, -1);
  }

  // Ability timers
  tickAbility(s.p1Ability, dt);
  tickAbility(s.p2Ability, dt);

  // Effect expiry
  if (s.p1Frozen   && s.p2Ability.active === 0) s.p1Frozen   = false;
  if (s.p2Frozen   && s.p1Ability.active === 0) s.p2Frozen   = false;
  if (s.ghostActive && s.p1Ability.active === 0 && s.p2Ability.active === 0) s.ghostActive = false;
  if (s.p1Shield   && s.p1Ability.active === 0) s.p1Shield   = false;
  if (s.p2Shield   && s.p2Ability.active === 0) s.p2Shield   = false;
  if (s.curveForce !== 0 && s.p1Ability.active === 0 && s.p2Ability.active === 0) s.curveForce = 0;
}

// ── Room management ──
const rooms = new Map();

function genCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

io.on('connection', (socket) => {
  console.log('connect:', socket.id);

  socket.on('create_room', ({ abilityId }) => {
    const code = genCode();
    rooms.set(code, {
      code,
      players: [{ id: socket.id, ability: abilityId, side: 'p1' }],
      state: null,
      inputs: { p1MouseY: H / 2, p2MouseY: H / 2 },
      interval: null,
    });
    socket.join(code);
    socket.data.room = code;
    socket.data.side = 'p1';
    socket.emit('room_created', { code });
  });

  socket.on('join_room', ({ code, abilityId }) => {
    const room = rooms.get(code);
    if (!room)                     { socket.emit('room_error', { message: 'Room not found' }); return; }
    if (room.players.length >= 2)  { socket.emit('room_error', { message: 'Room is full'  }); return; }

    room.players.push({ id: socket.id, ability: abilityId, side: 'p2' });
    socket.join(code);
    socket.data.room = code;
    socket.data.side = 'p2';

    const [p1, p2] = room.players;
    room.state = makeGameState(p1.ability, p2.ability);

    io.to(code).emit('game_start', { p1Id: p1.id, p2Id: p2.id, p1Ability: p1.ability, p2Ability: p2.ability });

    room.interval = setInterval(() => {
      if (!room.state || room.state.phase === 'gameover') {
        clearInterval(room.interval);
        io.to(code).emit('game_over', { winner: room.state?.winner });
        rooms.delete(code);
        return;
      }
      tickGameState(room.state, room.inputs);
      io.to(code).emit('game_state', room.state);
    }, PHYSICS_STEP);
  });

  socket.on('player_input', ({ mouseY }) => {
    const room = rooms.get(socket.data.room);
    if (!room) return;
    if (socket.data.side === 'p1') room.inputs.p1MouseY = mouseY;
    else                           room.inputs.p2MouseY = mouseY;
  });

  socket.on('ability_activate', () => {
    const room = rooms.get(socket.data.room);
    if (!room?.state) return;
    const side = socket.data.side;
    const ab = side === 'p1' ? room.state.p1Ability : room.state.p2Ability;
    if (activateAbility(ab)) {
      applyAbility(room.state, side, ab.id);
      io.to(socket.data.room).emit('ability_used', { side, abilityId: ab.id });
    }
  });

  socket.on('disconnect', () => {
    console.log('disconnect:', socket.id);
    const code = socket.data.room;
    if (code && rooms.has(code)) {
      clearInterval(rooms.get(code).interval);
      io.to(code).emit('opponent_disconnected');
      rooms.delete(code);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Pong Abilities → http://localhost:${PORT}`));
