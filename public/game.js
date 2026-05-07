// ── Online mode flag — flip to true to route input/state through Socket.io ──
const ONLINE_MODE = false;

const Game = (() => {
  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  const WIN_SCORE = 7;
  const PAD_W = 14;
  const PAD_H = 90;
  const BALL_R = 7;
  const PAD_MARGIN = 28;

  // ── AI difficulty config ──
  const DIFF_CFG = {
    easy:   { spd: 0.04, err: 60, delay: 20, abilityChance: 0.003 },
    medium: { spd: 0.065, err: 28, delay: 10, abilityChance: 0.006 },
    hard:   { spd: 0.12, err: 8,  delay: 4,  abilityChance: 0.012 },
  };

  // ── Mutable game state (the part that could move server-side) ──
  let state = null;

  // ── Local input & presentation state ──
  let paddleY = H / 2 - PAD_H / 2; // absolute paddle position, driven by pointer lock
  let pointerLocked = false;
  let lockJustAcquired = false;     // skip the first spurious event on lock grant
  const MAX_MOVE_PER_EVENT = 40;    // px cap — prevents snap-to-corner on fast sweeps
  let particles = [];
  let flashTimer = 0;
  let shieldParticles = [];
  let running = false;
  let animId = null;
  let lastTime = 0;
  let aiTargetY = H / 2;
  let aiDelayCounter = 0;

  // Socket.io (scaffold)
  let socket = null;
  let roomId = null;

  function _initSocket() {
    if (!ONLINE_MODE) return;
    socket = io();
    socket.on('game_state', (s) => { state = s; });
    socket.on('ability_used', ({ ability, side }) => {
      _applyAbilityEffect(side, ability);
    });
    socket.on('opponent_disconnected', () => {
      _endGame(true);
    });
  }

  function _makeState() {
    const aiAbilityId = _pickAiAbility();
    GameState.aiAbilityId = aiAbilityId;
    return {
      ball: { x: W / 2, y: H / 2, vx: 0, vy: 0 },
      playerY: H / 2 - PAD_H / 2,
      aiY: H / 2 - PAD_H / 2,
      playerScore: 0,
      aiScore: 0,
      playerAbility: new AbilityState(GameState.playerAbilityId),
      aiAbility: new AbilityState(aiAbilityId),
      // Effect flags
      playerFrozen: false,
      aiFrozen: false,
      ghostActive: false,
      playerShield: false,
      aiShield: false,
      curveForce: 0,
      curveSide: 0, // 1 = player used (force toward ai side), -1 = ai used
    };
  }

  function _pickAiAbility() {
    const ids = Object.keys(ABILITIES);
    // AI picks a different ability than the player for variety
    const opts = ids.filter(id => id !== GameState.playerAbilityId);
    return opts[Math.floor(Math.random() * opts.length)];
  }

  function _resetBall(dir) {
    const angle = (Math.random() * 0.5 - 0.25);
    const spd = 5;
    state.ball.x = W / 2;
    state.ball.y = H / 2;
    state.ball.vx = dir * spd * Math.cos(angle);
    state.ball.vy = spd * Math.sin(angle);
    state.ghostActive = false;
    state.curveForce = 0;
  }

  // ── POINTER LOCK INPUT ──
  canvas.addEventListener('click', () => {
    if (running && !pointerLocked) canvas.requestPointerLock();
  });

  document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === canvas;
    if (pointerLocked) lockJustAcquired = true;
    _updateLockHint();
  });

  document.addEventListener('mousemove', e => {
    if (!pointerLocked || !running) return;
    // Skip the first event — browsers fire it with accumulated pre-lock movement
    if (lockJustAcquired) { lockJustAcquired = false; return; }
    const delta = Math.max(-MAX_MOVE_PER_EVENT, Math.min(MAX_MOVE_PER_EVENT, e.movementY));
    paddleY = Math.max(0, Math.min(H - PAD_H, paddleY + delta));
  });

  document.addEventListener('keydown', e => {
    if (e.code === 'Space' && running) {
      e.preventDefault();
      _activateAbility('player');
    }
    // Escape releases pointer lock (browser handles this natively, but
    // we also listen so we can update our hint)
    if (e.code === 'Escape') _updateLockHint();
  });

  function _updateLockHint() {
    const hint = document.getElementById('space-hint');
    if (!hint) return;
    if (!pointerLocked && running) {
      hint.textContent = 'Click to grab mouse control';
      hint.style.opacity = '1';
    } else if (pointerLocked) {
      hint.textContent = 'SPACE to activate ability';
      hint.style.opacity = state?.playerAbility?.ready ? '1' : '0';
    }
  }

  // ── UPDATE (server-authoritative logic, can migrate to server.js) ──
  function _updateState(dt) {
    const s = state;
    const cfg = DIFF_CFG[GameState.difficulty];

    // Player paddle — paddleY is maintained directly by pointer lock movementY
    if (!s.playerFrozen) {
      s.playerY = paddleY;
    }

    // AI paddle
    if (!s.aiFrozen) {
      aiDelayCounter++;
      if (aiDelayCounter >= cfg.delay) {
        aiDelayCounter = 0;
        aiTargetY = s.ball.y - PAD_H / 2 + (Math.random() * cfg.err * 2 - cfg.err);
      }
      const aiCenter = s.aiY + PAD_H / 2;
      const dist = aiTargetY + PAD_H / 2 - aiCenter;
      const factor = s.ball.vx < 0 ? 1.3 : 0.6;
      s.aiY += dist * cfg.spd * factor;
      s.aiY = Math.max(0, Math.min(H - PAD_H, s.aiY));
    }

    // AI ability activation
    if (s.aiAbility.ready && Math.random() < cfg.abilityChance) {
      _activateAbility('ai');
    }

    // Curve force
    if (s.curveForce !== 0) {
      s.ball.vy += s.curveForce * dt * 0.001;
    }

    // Ball movement
    s.ball.x += s.ball.vx;
    s.ball.y += s.ball.vy;

    // Wall bounce
    if (s.ball.y - BALL_R <= 0) {
      s.ball.y = BALL_R;
      s.ball.vy = Math.abs(s.ball.vy);
      Audio.wallBounce();
    }
    if (s.ball.y + BALL_R >= H) {
      s.ball.y = H - BALL_R;
      s.ball.vy = -Math.abs(s.ball.vy);
      Audio.wallBounce();
    }

    // Player paddle (right)
    const px = W - PAD_MARGIN - PAD_W;
    if (s.ball.vx > 0
      && s.ball.x + BALL_R >= px
      && s.ball.x - BALL_R < px + PAD_W
      && s.ball.y + BALL_R >= s.playerY
      && s.ball.y - BALL_R <= s.playerY + PAD_H) {
      s.ball.x = px - BALL_R;
      _reflectBall('player');
      _spawnParticles(px, s.ball.y, '#a78bfa');
      Audio.paddleHit();
    }

    // AI paddle (left)
    const ax = PAD_MARGIN;
    if (s.ball.vx < 0
      && s.ball.x - BALL_R <= ax + PAD_W
      && s.ball.x + BALL_R > ax
      && s.ball.y + BALL_R >= s.aiY
      && s.ball.y - BALL_R <= s.aiY + PAD_H) {
      s.ball.x = ax + PAD_W + BALL_R;
      _reflectBall('ai');
      _spawnParticles(ax + PAD_W, s.ball.y, '#a78bfa');
      Audio.paddleHit();
    }

    // Player shield (right side wall)
    if (s.playerShield) {
      const shieldX = W - 6;
      if (s.ball.x + BALL_R >= shieldX) {
        s.ball.x = shieldX - BALL_R;
        s.ball.vx = -Math.abs(s.ball.vx);
        Audio.wallBounce();
      }
    }

    // AI shield (left side wall)
    if (s.aiShield) {
      const shieldX = 6;
      if (s.ball.x - BALL_R <= shieldX) {
        s.ball.x = shieldX + BALL_R;
        s.ball.vx = Math.abs(s.ball.vx);
        Audio.wallBounce();
      }
    }

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

    // Freeze expiry
    if (s.playerFrozen && !s.aiAbility.isActive) s.playerFrozen = false;
    if (s.aiFrozen && !s.playerAbility.isActive) s.aiFrozen = false;

    // Ghost expiry
    if (s.ghostActive && !s.playerAbility.isActive && !s.aiAbility.isActive) s.ghostActive = false;

    // Shield expiry
    if (s.playerShield && !s.playerAbility.isActive) s.playerShield = false;
    if (s.aiShield && !s.aiAbility.isActive) s.aiShield = false;

    // Curve expiry
    if (s.curveForce !== 0 && !s.playerAbility.isActive && !s.aiAbility.isActive) s.curveForce = 0;

    if (flashTimer > 0) flashTimer--;
    _updateParticles();
  }

  function _reflectBall(hitter) {
    const s = state;
    const padY = hitter === 'player' ? s.playerY : s.aiY;
    const rel = (s.ball.y - (padY + PAD_H / 2)) / (PAD_H / 2);
    const angle = rel * 1.15;
    let spd = Math.min(Math.sqrt(s.ball.vx ** 2 + s.ball.vy ** 2) * 1.045, 18);

    // Surge doubles speed
    if (hitter === 'player' && s.playerAbility.surgePending) {
      spd *= 2;
      s.playerAbility.surgePending = false;
      UI.flashAbility(ABILITIES.surge.color);
    }
    if (hitter === 'ai' && s.aiAbility.surgePending) {
      spd *= 2;
      s.aiAbility.surgePending = false;
    }

    const dir = hitter === 'player' ? -1 : 1;
    s.ball.vx = dir * spd * Math.cos(angle);
    s.ball.vy = spd * Math.sin(angle);
    flashTimer = 4;
  }

  function _activateAbility(side) {
    const s = state;
    const abilityState = side === 'player' ? s.playerAbility : s.aiAbility;
    if (!abilityState.activate()) return;

    const ab = abilityState.ability;
    Audio.abilityActivate();
    if (side === 'player') UI.flashAbility(ab.color);

    if (ONLINE_MODE && socket && roomId) {
      socket.emit('ability_used', { roomId, ability: ab.id, side });
    }

    _applyAbilityEffect(side, ab.id);
  }

  function _applyAbilityEffect(side, abilityId) {
    const s = state;
    switch (abilityId) {
      case 'freeze':
        if (side === 'player') s.aiFrozen = true;
        else s.playerFrozen = true;
        break;
      case 'surge':
        // surge is handled in _reflectBall via surgePending
        break;
      case 'curve': {
        // curve vy toward opponent's corner
        const targetY = side === 'player' ? (s.ball.vx < 0 ? 0 : H) : (s.ball.vx > 0 ? 0 : H);
        s.curveForce = targetY < H / 2 ? -90 : 90;
        s.curveSide = side === 'player' ? 1 : -1;
        break;
      }
      case 'shield':
        if (side === 'player') s.playerShield = true;
        else s.aiShield = true;
        break;
      case 'ghost':
        s.ghostActive = true;
        break;
      case 'dash':
        if (side === 'player') {
          paddleY = Math.max(0, Math.min(H - PAD_H, s.ball.y - PAD_H / 2));
          s.playerY = paddleY;
        } else {
          s.aiY = Math.max(0, Math.min(H - PAD_H, s.ball.y - PAD_H / 2));
        }
        _spawnParticles(
          side === 'player' ? W - PAD_MARGIN - PAD_W : PAD_MARGIN + PAD_W,
          s.ball.y, ABILITIES.dash.color, 20
        );
        break;
    }
  }

  // ── DRAW ──
  function _draw() {
    const s = state;

    // Background
    ctx.fillStyle = flashTimer > 0 ? '#16102a' : '#0d0d1a';
    ctx.fillRect(0, 0, W, H);

    // Center line
    ctx.save();
    ctx.setLineDash([10, 16]);
    ctx.strokeStyle = 'rgba(124,58,237,0.15)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(W / 2, 0);
    ctx.lineTo(W / 2, H);
    ctx.stroke();
    ctx.restore();

    // Shields
    if (s.playerShield) {
      ctx.save();
      ctx.fillStyle = 'rgba(134,239,172,0.35)';
      ctx.shadowColor = '#86efac';
      ctx.shadowBlur = 16;
      ctx.fillRect(W - 6, 0, 4, H);
      ctx.restore();
    }
    if (s.aiShield) {
      ctx.save();
      ctx.fillStyle = 'rgba(134,239,172,0.35)';
      ctx.shadowColor = '#86efac';
      ctx.shadowBlur = 16;
      ctx.fillRect(2, 0, 4, H);
      ctx.restore();
    }

    // Paddles
    _drawPaddle(W - PAD_MARGIN - PAD_W, s.playerY, s.playerFrozen, '#a78bfa');
    _drawPaddle(PAD_MARGIN, s.aiY, s.aiFrozen, '#818cf8');

    // Ball
    if (!s.ghostActive) {
      _drawBall(s.ball.x, s.ball.y);
    } else {
      // Ghost: barely visible
      ctx.save();
      ctx.globalAlpha = 0.12;
      _drawBall(s.ball.x, s.ball.y);
      ctx.restore();
    }

    _drawParticles();
  }

  function _drawPaddle(x, y, frozen, color) {
    ctx.save();
    if (frozen) {
      ctx.shadowColor = '#67e8f9';
      ctx.shadowBlur = 20;
      ctx.fillStyle = '#67e8f9';
    } else {
      ctx.shadowColor = color;
      ctx.shadowBlur = 14;
      ctx.fillStyle = color;
    }
    _roundRect(x, y, PAD_W, PAD_H, 5);
    ctx.restore();
  }

  function _drawBall(x, y) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, BALL_R, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.shadowColor = '#fff';
    ctx.shadowBlur = 18;
    ctx.fill();
    ctx.restore();
  }

  function _roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();
  }

  // ── PARTICLES ──
  function _spawnParticles(x, y, color = '#fff', count = 12) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = Math.random() * 5 + 1;
      particles.push({ x, y, vx: Math.cos(angle) * spd, vy: Math.sin(angle) * spd, life: 1, color });
    }
  }

  function _updateParticles() {
    particles = particles.filter(p => p.life > 0);
    particles.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      p.life -= 0.045;
      p.vx *= 0.93; p.vy *= 0.93;
    });
  }

  function _drawParticles() {
    particles.forEach(p => {
      ctx.save();
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 6;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
      ctx.restore();
    });
  }

  // ── HUD ──
  function _updateHUD() {
    const s = state;
    UI.updateScores(s.aiScore, s.playerScore);
    UI.updateCooldownRing('player',
      s.playerAbility.cooldownFraction,
      s.playerAbility.ready,
      s.playerAbility.isActive
    );
    UI.updateCooldownRing('ai',
      s.aiAbility.cooldownFraction,
      s.aiAbility.ready,
      s.aiAbility.isActive
    );
    UI.showSpaceHint(s.playerAbility.ready);
  }

  // ── LOOP ──
  function _loop(ts) {
    if (!running) return;
    const dt = Math.min(ts - lastTime, 50); // cap at 50ms to avoid spiral
    lastTime = ts;

    if (!ONLINE_MODE) {
      _updateState(dt);
    }
    _draw();
    _updateHUD();

    animId = requestAnimationFrame(_loop);
  }

  function _endGame(playerWon) {
    running = false;
    cancelAnimationFrame(animId);
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    UI.showGameOver(playerWon, state.playerScore, state.aiScore);
  }

  // ── PUBLIC ──
  function start() {
    if (animId) cancelAnimationFrame(animId);
    particles      = [];
    flashTimer     = 0;
    aiDelayCounter = 0;
    aiTargetY      = H / 2;
    paddleY        = H / 2 - PAD_H / 2;
    pointerLocked  = false;
    state = _makeState();
    _resetBall(Math.random() < 0.5 ? 1 : -1);

    UI.goTo('screen-game');
    UI.setAbilityIcons(GameState.playerAbilityId, GameState.aiAbilityId);

    running  = true;
    lastTime = performance.now();
    animId   = requestAnimationFrame(_loop);

    // Request pointer lock immediately — browser requires a user gesture,
    // and start() is always called from a button click, so this is valid.
    canvas.requestPointerLock();

    if (ONLINE_MODE) _initSocket();
  }

  return { start };
})();

// Boot UI after DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  UI.init();
});

// PWA service worker registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
