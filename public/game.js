// ── Online mode — flip to true to route through Socket.io ──
const ONLINE_MODE = true;

const Game = (() => {
  const canvas = document.getElementById('game-canvas');
  const ctx    = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const WIN_SCORE  = 7;
  const PAD_W      = 14;
  const PAD_H      = 90;
  const BALL_R     = 7;
  const PAD_MARGIN = 28;

  // Fixed physics timestep — game speed is always 60Hz regardless of render rate
  const PHYSICS_STEP = 1000 / 60;

  const DIFF_CFG = {
    easy:   { spd: 0.04,  err: 60, delay: 20, abilityChance: 0.003 },
    medium: { spd: 0.065, err: 28, delay: 10, abilityChance: 0.006 },
    hard:   { spd: 0.12,  err: 8,  delay: 4,  abilityChance: 0.012 },
  };

  // ── State ──
  let state = null;        // local AI mode state
  let onlineState = null;  // last state received from server (online mode)
  let onlineSide = null;   // 'p1' | 'p2'

  let running = false;
  let animId  = null;

  // Timing
  let accumulator     = 0;
  let lastPhysicsTime = 0;
  let lastRenderTime  = 0;
  let targetFrameMs   = 1000 / 60; // updated by UI when user picks FPS

  // Local presentation
  let mouseY          = H / 2;
  let particles       = [];
  let flashTimer      = 0;
  let aiTargetY       = H / 2;
  let aiDelayCounter  = 0;

  // Socket (online)
  let socket = null;

  // ── Socket.io initialisation (only when ONLINE_MODE = true) ──
  function _connectSocket() {
    if (socket) return;
    socket = io();

    socket.on('game_state', (s) => {
      onlineState = s;
    });

    socket.on('ability_used', ({ side, abilityId }) => {
      // Flash visual for local player's ability activations coming back from server
      if (side === onlineSide) UI.flashAbility(ABILITIES[abilityId]?.color || '#fff');
    });

    socket.on('game_over', ({ winner }) => {
      running = false;
      const iWon = winner === onlineSide;
      const s = onlineState;
      UI.showGameOver(iWon,
        onlineSide === 'p2' ? s?.p2Score : s?.p1Score,
        onlineSide === 'p2' ? s?.p1Score : s?.p2Score
      );
    });

    socket.on('opponent_disconnected', () => {
      running = false;
      UI.showGameOver(true, WIN_SCORE, 0);
    });

    socket.on('room_error', ({ message }) => {
      UI.showRoomError(message);
    });

    socket.on('room_created', ({ code }) => {
      UI.showRoomCode(code);
    });

    socket.on('game_start', ({ p1Id, p2Id, p1Ability, p2Ability }) => {
      onlineSide = socket.id === p1Id ? 'p1' : 'p2';
      _startOnlineGame(p1Ability, p2Ability);
    });
  }

  // ── Input ──
  document.getElementById('canvas-wrap').addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    mouseY = e.clientY - rect.top;
    if (ONLINE_MODE && socket) socket.emit('player_input', { mouseY });
  });

  document.addEventListener('keydown', e => {
    if (e.code !== 'Space' || !running) return;
    e.preventDefault();
    if (ONLINE_MODE && socket) {
      socket.emit('ability_activate');
    } else {
      _activateAbility('player');
    }
  });

  // ── Fixed-timestep game loop ──
  function _loop(ts) {
    animId = requestAnimationFrame(_loop);
    if (!running) return;

    if (lastPhysicsTime === 0) { lastPhysicsTime = ts; lastRenderTime = ts; }

    const elapsed = Math.min(ts - lastPhysicsTime, 50);
    lastPhysicsTime = ts;

    // Physics — always 60Hz, independent of render rate
    if (!ONLINE_MODE && state) {
      accumulator += elapsed;
      while (accumulator >= PHYSICS_STEP) {
        _updateState(PHYSICS_STEP);
        accumulator -= PHYSICS_STEP;
        if (!running) return;
      }
    }

    // Render — capped at user's chosen FPS (0 = unlimited)
    const sinceRender = ts - lastRenderTime;
    if (targetFrameMs > 0 && sinceRender < targetFrameMs) return;
    lastRenderTime = ts;

    _draw();
    _updateHUD();
  }

  // ── Local AI update (runs at fixed PHYSICS_STEP dt) ──
  function _updateState(dt) {
    const s   = state;
    const cfg = DIFF_CFG[GameState.difficulty];

    // Player paddle
    if (!s.playerFrozen)
      s.playerY = Math.max(0, Math.min(H - PAD_H, mouseY - PAD_H / 2));

    // AI paddle
    if (!s.aiFrozen) {
      aiDelayCounter++;
      if (aiDelayCounter >= cfg.delay) {
        aiDelayCounter = 0;
        aiTargetY = s.ball.y - PAD_H / 2 + (Math.random() * cfg.err * 2 - cfg.err);
      }
      const aiCenter = s.aiY + PAD_H / 2;
      const dist     = aiTargetY + PAD_H / 2 - aiCenter;
      s.aiY += dist * cfg.spd * (s.ball.vx < 0 ? 1.3 : 0.6);
      s.aiY = Math.max(0, Math.min(H - PAD_H, s.aiY));
    }

    // AI ability activation
    if (s.aiAbility.ready && Math.random() < cfg.abilityChance)
      _activateAbility('ai');

    // Curve force
    if (s.curveForce !== 0) s.ball.vy += s.curveForce * dt * 0.001;

    s.ball.x += s.ball.vx;
    s.ball.y += s.ball.vy;

    // Wall bounce
    if (s.ball.y - BALL_R <= 0)  { s.ball.y = BALL_R;      s.ball.vy =  Math.abs(s.ball.vy); Audio.wallBounce(); }
    if (s.ball.y + BALL_R >= H)  { s.ball.y = H - BALL_R;  s.ball.vy = -Math.abs(s.ball.vy); Audio.wallBounce(); }

    // Player paddle (right)
    const px = W - PAD_MARGIN - PAD_W;
    if (s.ball.vx > 0
      && s.ball.x + BALL_R >= px && s.ball.x - BALL_R < px + PAD_W
      && s.ball.y + BALL_R >= s.playerY && s.ball.y - BALL_R <= s.playerY + PAD_H) {
      s.ball.x = px - BALL_R;
      _reflectBall('player');
      _spawnParticles(px, s.ball.y, '#a78bfa');
      Audio.paddleHit();
    }

    // AI paddle (left)
    const ax = PAD_MARGIN;
    if (s.ball.vx < 0
      && s.ball.x - BALL_R <= ax + PAD_W && s.ball.x + BALL_R > ax
      && s.ball.y + BALL_R >= s.aiY && s.ball.y - BALL_R <= s.aiY + PAD_H) {
      s.ball.x = ax + PAD_W + BALL_R;
      _reflectBall('ai');
      _spawnParticles(ax + PAD_W, s.ball.y, '#a78bfa');
      Audio.paddleHit();
    }

    // Shields
    if (s.playerShield && s.ball.x + BALL_R >= W - 6)
      { s.ball.x = W - 6 - BALL_R; s.ball.vx = -Math.abs(s.ball.vx); Audio.wallBounce(); }
    if (s.aiShield && s.ball.x - BALL_R <= 6)
      { s.ball.x = 6 + BALL_R; s.ball.vx = Math.abs(s.ball.vx); Audio.wallBounce(); }

    // Scoring
    if (s.ball.x < 0) {
      s.playerScore++;
      Audio.score();
      _spawnParticles(PAD_MARGIN, s.ball.y, '#fbbf24', 18);
      if (s.playerScore >= WIN_SCORE) { _endGame(true); return; }
      _resetBall(1);
    }
    if (s.ball.x > W) {
      s.aiScore++;
      Audio.score();
      _spawnParticles(W - PAD_MARGIN, s.ball.y, '#fbbf24', 18);
      if (s.aiScore >= WIN_SCORE) { _endGame(false); return; }
      _resetBall(-1);
    }

    // Ability timers
    s.playerAbility.update(dt);
    s.aiAbility.update(dt);

    // Effect expiry
    if (s.playerFrozen  && !s.aiAbility.isActive)                              s.playerFrozen  = false;
    if (s.aiFrozen      && !s.playerAbility.isActive)                          s.aiFrozen      = false;
    if (s.ghostActive   && !s.playerAbility.isActive && !s.aiAbility.isActive) s.ghostActive   = false;
    if (s.playerShield  && !s.playerAbility.isActive)                          s.playerShield  = false;
    if (s.aiShield      && !s.aiAbility.isActive)                              s.aiShield      = false;
    if (s.curveForce !== 0 && !s.playerAbility.isActive && !s.aiAbility.isActive) s.curveForce = 0;

    if (flashTimer > 0) flashTimer--;
    _updateParticles();
  }

  function _reflectBall(hitter) {
    const s    = state;
    const padY = hitter === 'player' ? s.playerY : s.aiY;
    const rel  = (s.ball.y - (padY + PAD_H / 2)) / (PAD_H / 2);
    let spd    = Math.min(Math.hypot(s.ball.vx, s.ball.vy) * 1.045, 18);

    if (hitter === 'player' && s.playerAbility.surgePending) {
      spd *= 2; s.playerAbility.surgePending = false; UI.flashAbility(ABILITIES.surge.color);
    }
    if (hitter === 'ai' && s.aiAbility.surgePending) {
      spd *= 2; s.aiAbility.surgePending = false;
    }
    const dir   = hitter === 'player' ? -1 : 1;
    const angle = rel * 1.15;
    s.ball.vx = dir * spd * Math.cos(angle);
    s.ball.vy = spd * Math.sin(angle);
    flashTimer = 4;
  }

  function _activateAbility(side) {
    const s  = state;
    const ab = side === 'player' ? s.playerAbility : s.aiAbility;
    if (!ab.activate()) return;
    Audio.abilityActivate();
    if (side === 'player') UI.flashAbility(ab.ability.color);
    _applyAbilityEffect(side, ab.ability.id);
  }

  function _applyAbilityEffect(side, id) {
    const s = state;
    switch (id) {
      case 'freeze':
        if (side === 'player') s.aiFrozen = true; else s.playerFrozen = true;
        break;
      case 'curve': {
        const toTop = side === 'player' ? s.ball.vx < 0 : s.ball.vx > 0;
        s.curveForce = toTop ? -90 : 90;
        break;
      }
      case 'shield':
        if (side === 'player') s.playerShield = true; else s.aiShield = true;
        break;
      case 'ghost':
        s.ghostActive = true;
        break;
      case 'dash': {
        const clampedY = Math.max(0, Math.min(H - PAD_H, s.ball.y - PAD_H / 2));
        if (side === 'player') s.playerY = clampedY; else s.aiY = clampedY;
        _spawnParticles(
          side === 'player' ? W - PAD_MARGIN - PAD_W : PAD_MARGIN + PAD_W,
          s.ball.y, ABILITIES.dash.color, 20
        );
        break;
      }
    }
  }

  function _resetBall(dir) {
    const angle = Math.random() * 0.5 - 0.25;
    const spd   = 5;
    Object.assign(state.ball, { x: W / 2, y: H / 2, vx: dir * spd * Math.cos(angle), vy: spd * Math.sin(angle) });
    state.ghostActive = false;
    state.curveForce  = 0;
  }

  // ── Draw ──
  function _draw() {
    const online = ONLINE_MODE && onlineState;

    // Resolve draw values from whichever state source is active
    const ball      = online ? onlineState.ball    : state.ball;
    const ghostOn   = online ? onlineState.ghostActive : state.ghostActive;

    // Left paddle = AI (local) or P1 (online)
    const leftY       = online ? onlineState.p1Y      : state.aiY;
    const leftFrozen  = online ? onlineState.p1Frozen : state.aiFrozen;
    const leftShield  = online ? onlineState.p1Shield : state.aiShield;

    // Right paddle = Player (local) or P2 (online)
    const rightY      = online ? onlineState.p2Y      : state.playerY;
    const rightFrozen = online ? onlineState.p2Frozen : state.playerFrozen;
    const rightShield = online ? onlineState.p2Shield : state.playerShield;

    // Which side is "mine" for highlight colour
    const myOnLeft  = online && onlineSide === 'p1';
    const myOnRight = !online || onlineSide === 'p2';

    ctx.fillStyle = flashTimer > 0 ? '#16102a' : '#0d0d1a';
    ctx.fillRect(0, 0, W, H);

    // Centre line
    ctx.save();
    ctx.setLineDash([10, 16]);
    ctx.strokeStyle = 'rgba(124,58,237,0.15)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
    ctx.restore();

    // Shields
    if (leftShield)  _drawShield(2);
    if (rightShield) _drawShield(W - 6);

    // Paddles
    _drawPaddle(PAD_MARGIN,          leftY,  leftFrozen,  myOnLeft  ? '#a78bfa' : '#818cf8');
    _drawPaddle(W - PAD_MARGIN - PAD_W, rightY, rightFrozen, myOnRight ? '#a78bfa' : '#818cf8');

    // Ball
    if (!ghostOn) {
      _drawBall(ball.x, ball.y);
    } else {
      ctx.save(); ctx.globalAlpha = 0.12; _drawBall(ball.x, ball.y); ctx.restore();
    }

    _drawParticles();
  }

  function _drawShield(x) {
    ctx.save();
    ctx.fillStyle = 'rgba(134,239,172,0.35)';
    ctx.shadowColor = '#86efac'; ctx.shadowBlur = 16;
    ctx.fillRect(x, 0, 4, H);
    ctx.restore();
  }

  function _drawPaddle(x, y, frozen, color) {
    ctx.save();
    ctx.shadowColor = frozen ? '#67e8f9' : color;
    ctx.shadowBlur  = 14;
    ctx.fillStyle   = frozen ? '#67e8f9' : color;
    _roundRect(x, y, PAD_W, PAD_H, 5);
    ctx.restore();
  }

  function _drawBall(x, y) {
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, BALL_R, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.shadowColor = '#fff'; ctx.shadowBlur = 18;
    ctx.fill(); ctx.restore();
  }

  function _roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath(); ctx.fill();
  }

  // ── Particles ──
  function _spawnParticles(x, y, color = '#fff', count = 12) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, spd = Math.random() * 5 + 1;
      particles.push({ x, y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, life: 1, color });
    }
  }
  function _updateParticles() {
    particles = particles.filter(p => p.life > 0);
    particles.forEach(p => { p.x += p.vx; p.y += p.vy; p.life -= 0.045; p.vx *= 0.93; p.vy *= 0.93; });
  }
  function _drawParticles() {
    particles.forEach(p => {
      ctx.save();
      ctx.globalAlpha = p.life; ctx.fillStyle = p.color; ctx.shadowColor = p.color; ctx.shadowBlur = 6;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
      ctx.restore();
    });
  }

  // ── HUD ──
  function _updateHUD() {
    if (ONLINE_MODE && onlineState) {
      const s = onlineState;
      const myScore  = onlineSide === 'p1' ? s.p1Score : s.p2Score;
      const oppScore = onlineSide === 'p1' ? s.p2Score : s.p1Score;
      const myAb     = onlineSide === 'p1' ? s.p1Ability : s.p2Ability;
      const oppAb    = onlineSide === 'p1' ? s.p2Ability : s.p1Ability;

      // Left label = P1 (could be "YOU" or "OPP"), right = P2
      const leftLabel  = onlineSide === 'p1' ? 'YOU' : 'OPP';
      const rightLabel = onlineSide === 'p2' ? 'YOU' : 'OPP';
      UI.updateScores(
        onlineSide === 'p1' ? s.p2Score : s.p1Score,
        onlineSide === 'p1' ? s.p1Score : s.p2Score,
        leftLabel, rightLabel
      );
      UI.updateCooldownRing('player', myAb.cooldown / (ABILITIES[myAb.id]?.cooldown || 1), myAb.ready, myAb.active > 0);
      UI.updateCooldownRing('ai',    oppAb.cooldown / (ABILITIES[oppAb.id]?.cooldown || 1), oppAb.ready, oppAb.active > 0);
    } else if (state) {
      UI.updateScores(state.aiScore, state.playerScore, 'CPU', 'YOU');
      UI.updateCooldownRing('player', state.playerAbility.cooldownFraction, state.playerAbility.ready, state.playerAbility.isActive);
      UI.updateCooldownRing('ai',     state.aiAbility.cooldownFraction,     state.aiAbility.ready,     state.aiAbility.isActive);
      UI.showSpaceHint(state.playerAbility.ready);
    }
  }

  function _endGame(playerWon) {
    running = false;
    cancelAnimationFrame(animId);
    UI.showGameOver(playerWon, state.playerScore, state.aiScore);
  }

  // ── Local AI start ──
  function _makeLocalState() {
    const aiAbilityId   = _pickAiAbility();
    GameState.aiAbilityId = aiAbilityId;
    return {
      ball: { x: W / 2, y: H / 2, vx: 0, vy: 0 },
      playerY: H / 2 - PAD_H / 2,
      aiY:     H / 2 - PAD_H / 2,
      playerScore: 0, aiScore: 0,
      playerAbility: new AbilityState(GameState.playerAbilityId),
      aiAbility:     new AbilityState(aiAbilityId),
      playerFrozen: false, aiFrozen: false,
      ghostActive: false,
      playerShield: false, aiShield: false,
      curveForce: 0,
    };
  }

  function _pickAiAbility() {
    const ids  = Object.keys(ABILITIES);
    const opts = ids.filter(id => id !== GameState.playerAbilityId);
    return opts[Math.floor(Math.random() * opts.length)];
  }

  // ── Online game start (called after game_start event) ──
  function _startOnlineGame(p1Ability, p2Ability) {
    onlineState = null;
    particles   = [];
    flashTimer  = 0;

    const myAbility  = onlineSide === 'p1' ? p1Ability : p2Ability;
    const oppAbility = onlineSide === 'p1' ? p2Ability : p1Ability;

    UI.goTo('screen-game');
    UI.setAbilityIcons(myAbility, oppAbility);
    UI.updateScoreLabels(onlineSide === 'p1' ? 'YOU' : 'OPP', onlineSide === 'p2' ? 'YOU' : 'OPP');

    targetFrameMs  = GameState.targetFPS === 0 ? 0 : 1000 / GameState.targetFPS;
    running        = true;
    lastPhysicsTime = 0;
    lastRenderTime  = 0;
    accumulator     = 0;
    animId = requestAnimationFrame(_loop);
  }

  // ── Public API ──
  function start() {
    // Local AI mode
    if (animId) cancelAnimationFrame(animId);
    particles      = [];
    flashTimer     = 0;
    aiDelayCounter = 0;
    aiTargetY      = H / 2;
    accumulator    = 0;
    lastPhysicsTime = 0;
    lastRenderTime  = 0;
    onlineState    = null;
    onlineSide     = null;
    state = _makeLocalState();
    _resetBall(Math.random() < 0.5 ? 1 : -1);

    targetFrameMs = GameState.targetFPS === 0 ? 0 : 1000 / GameState.targetFPS;

    UI.goTo('screen-game');
    UI.setAbilityIcons(GameState.playerAbilityId, GameState.aiAbilityId);
    UI.updateScoreLabels('CPU', 'YOU');

    running = true;
    animId  = requestAnimationFrame(_loop);
  }

  function createRoom() {
    _connectSocket();
    socket.emit('create_room', { abilityId: GameState.playerAbilityId });
  }

  function joinRoom(code) {
    _connectSocket();
    socket.emit('join_room', { code: code.toUpperCase(), abilityId: GameState.playerAbilityId });
  }

  return { start, createRoom, joinRoom };
})();

document.addEventListener('DOMContentLoaded', () => UI.init());

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
