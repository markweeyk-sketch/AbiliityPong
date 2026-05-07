const UI = (() => {
  const screens = {};
  let currentScreen = null;

  function init() {
    document.querySelectorAll('.screen').forEach(el => { screens[el.id] = el; });
    currentScreen = 'screen-menu';

    // Mute
    document.getElementById('btn-mute').addEventListener('click', () => {
      const m = Audio.toggleMute();
      document.getElementById('btn-mute').textContent = m ? '🔇' : '🔊';
    });

    _buildAbilityGrid();
    _bindDifficulty();
    _bindFPS();
    _bindNav();
    _bindMatchmaking();

    // Auto-select first ability
    selectAbility(Object.keys(ABILITIES)[0]);
  }

  // ── Screens ──
  function goTo(id) {
    if (screens[currentScreen]) screens[currentScreen].classList.remove('active');
    screens[id].classList.add('active');
    currentScreen = id;
  }

  // ── Ability grid ──
  function _buildAbilityGrid() {
    const grid = document.getElementById('ability-grid');
    grid.innerHTML = '';
    Object.values(ABILITIES).forEach(ab => {
      const card = document.createElement('div');
      card.className  = 'ability-card';
      card.dataset.id = ab.id;
      card.innerHTML = `
        <div class="card-icon">${ab.icon}</div>
        <div class="card-name">${ab.name}</div>
        <div class="card-desc">${ab.desc}</div>
        <div class="card-cd">CD: ${ab.cooldown / 1000}s</div>
        <div class="selected-badge">SELECTED</div>
      `;
      card.addEventListener('click', () => selectAbility(ab.id));
      grid.appendChild(card);
    });
  }

  function selectAbility(id) {
    GameState.playerAbilityId = id;
    document.querySelectorAll('.ability-card').forEach(c => c.classList.toggle('selected', c.dataset.id === id));
  }

  // ── Difficulty ──
  function _bindDifficulty() {
    document.querySelectorAll('.setting-btn[data-d]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.setting-btn[data-d]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        GameState.difficulty = btn.dataset.d;
      });
    });
  }

  // ── FPS ──
  function _bindFPS() {
    document.querySelectorAll('.fps-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.fps-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        GameState.targetFPS = parseInt(btn.dataset.fps, 10);
        const ind = document.getElementById('fps-indicator');
        if (ind) ind.textContent = GameState.targetFPS === 0 ? 'UNLIMITED FPS' : `${GameState.targetFPS} FPS`;
      });
    });
  }

  // ── Navigation ──
  function _bindNav() {
    document.getElementById('btn-vs-ai').addEventListener('click', () => {
      GameState.gameMode = 'ai';
      document.getElementById('diff-group').style.display = '';
      document.getElementById('btn-start-match').textContent = 'START MATCH';
      goTo('screen-ability');
    });

    document.getElementById('btn-online').addEventListener('click', () => {
      GameState.gameMode = 'online';
      document.getElementById('diff-group').style.display = 'none';
      document.getElementById('btn-start-match').textContent = 'FIND MATCH';
      goTo('screen-ability');
    });

    document.getElementById('btn-back-menu').addEventListener('click', () => goTo('screen-menu'));

    document.getElementById('btn-start-match').addEventListener('click', () => {
      if (GameState.gameMode === 'online') {
        _resetMatchmaking();
        goTo('screen-matchmaking');
      } else {
        Game.start();
      }
    });

    document.getElementById('btn-back-matchmaking').addEventListener('click', () => goTo('screen-ability'));
    document.getElementById('btn-replay').addEventListener('click', () => goTo('screen-ability'));
    document.getElementById('btn-go-menu').addEventListener('click', () => goTo('screen-menu'));
  }

  // ── Matchmaking ──
  function _resetMatchmaking() {
    document.getElementById('match-choice').classList.remove('hidden');
    document.getElementById('match-created').classList.add('hidden');
    document.getElementById('match-join').classList.add('hidden');
    document.getElementById('room-error').classList.add('hidden');
    document.getElementById('room-code-input').value = '';
    document.getElementById('room-code-display').textContent = '·····';
  }

  function _bindMatchmaking() {
    document.getElementById('btn-create-room').addEventListener('click', () => {
      document.getElementById('match-choice').classList.add('hidden');
      document.getElementById('match-created').classList.remove('hidden');
      Game.createRoom();
    });

    document.getElementById('btn-join-room-open').addEventListener('click', () => {
      document.getElementById('match-choice').classList.add('hidden');
      document.getElementById('match-join').classList.remove('hidden');
    });

    document.getElementById('btn-join-confirm').addEventListener('click', () => {
      const code = document.getElementById('room-code-input').value.trim();
      if (code.length < 1) return;
      document.getElementById('room-error').classList.add('hidden');
      Game.joinRoom(code);
    });

    document.getElementById('room-code-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('btn-join-confirm').click();
    });
  }

  // ── HUD updates ──
  function updateScores(leftScore, rightScore, leftLabel, rightLabel) {
    document.getElementById('score-left').textContent  = leftScore;
    document.getElementById('score-right').textContent = rightScore;
    if (leftLabel  != null) document.getElementById('label-left').textContent  = leftLabel;
    if (rightLabel != null) document.getElementById('label-right').textContent = rightLabel;
  }

  function updateScoreLabels(leftLabel, rightLabel) {
    document.getElementById('label-left').textContent  = leftLabel;
    document.getElementById('label-right').textContent = rightLabel;
  }

  function updateCooldownRing(side, fraction, isReady, isActive) {
    const ringId  = side === 'player' ? 'player-ring'          : 'ai-ring';
    const labelId = side === 'player' ? 'player-cooldown-label' : 'ai-cooldown-label';
    const ring    = document.getElementById(ringId);
    const label   = document.getElementById(labelId);
    if (!ring) return;

    ring.style.strokeDashoffset = 113.1 * (1 - Math.max(0, Math.min(1, fraction)));
    ring.classList.toggle('ready',       isReady);
    ring.classList.toggle('active-glow', isActive && !isReady);

    if (isReady) {
      label.textContent = 'READY';
    } else {
      const abilityId = side === 'player' ? GameState.playerAbilityId : GameState.aiAbilityId;
      const cd        = ABILITIES[abilityId]?.cooldown || 0;
      label.textContent = Math.ceil(cd * (1 - fraction) / 1000) + 's';
    }
  }

  function setAbilityIcons(playerAbilityId, opponentAbilityId) {
    GameState.aiAbilityId = opponentAbilityId;
    document.getElementById('player-ability-icon').textContent = ABILITIES[playerAbilityId]?.icon  || '';
    document.getElementById('ai-ability-icon').textContent     = ABILITIES[opponentAbilityId]?.icon || '';
  }

  function flashAbility(color) {
    const el = document.getElementById('ability-flash');
    el.style.background = color;
    el.style.boxShadow  = `0 0 60px ${color}`;
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 80);
  }

  function showGameOver(playerWon, playerScore, opponentScore) {
    document.getElementById('go-icon').textContent  = playerWon ? '🏆' : '💀';
    document.getElementById('go-title').textContent = playerWon ? 'YOU WIN!' : 'YOU LOSE';
    document.getElementById('go-score').textContent = `${playerScore} — ${opponentScore}`;
    goTo('screen-gameover');
    if (playerWon) Audio.win(); else Audio.lose();
  }

  function showSpaceHint(show) {
    document.getElementById('space-hint').style.opacity = show ? '1' : '0';
  }

  function showRoomCode(code) {
    document.getElementById('room-code-display').textContent = code;
  }

  function showRoomError(message) {
    const el = document.getElementById('room-error');
    el.textContent = message;
    el.classList.remove('hidden');
  }

  return {
    init, goTo,
    updateScores, updateScoreLabels,
    updateCooldownRing, setAbilityIcons,
    flashAbility, showGameOver, showSpaceHint,
    showRoomCode, showRoomError,
  };
})();

const GameState = {
  playerAbilityId: Object.keys(ABILITIES)[0],
  aiAbilityId:     null,
  difficulty:      'medium',
  targetFPS:       60,
  gameMode:        'ai',
};
