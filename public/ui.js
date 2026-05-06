// Screen transitions and HUD updates
const UI = (() => {
  const screens = {};
  let currentScreen = null;

  function init() {
    document.querySelectorAll('.screen').forEach(el => {
      screens[el.id] = el;
    });
    currentScreen = 'screen-menu';

    // Mute button (shown in menu, also accessible in game via fixed positioning)
    const muteBtn = document.getElementById('btn-mute');
    muteBtn.addEventListener('click', () => {
      const m = Audio.toggleMute();
      muteBtn.textContent = m ? '🔇' : '🔊';
    });

    // Ability grid
    _buildAbilityGrid();

    // Difficulty buttons
    document.querySelectorAll('.diff-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        GameState.difficulty = btn.dataset.d;
      });
    });

    // Nav buttons
    document.getElementById('btn-vs-ai').addEventListener('click', () => goTo('screen-ability'));
    document.getElementById('btn-online').addEventListener('click', () => goTo('screen-online'));
    document.getElementById('btn-back-menu').addEventListener('click', () => goTo('screen-menu'));
    document.getElementById('btn-back-online').addEventListener('click', () => goTo('screen-menu'));
    document.getElementById('btn-start-match').addEventListener('click', () => {
      if (!GameState.playerAbilityId) {
        // auto-select first
        const first = Object.keys(ABILITIES)[0];
        selectAbility(first);
      }
      Game.start();
    });
    document.getElementById('btn-replay').addEventListener('click', () => {
      goTo('screen-ability');
    });
    document.getElementById('btn-go-menu').addEventListener('click', () => goTo('screen-menu'));
  }

  function goTo(id) {
    if (screens[currentScreen]) screens[currentScreen].classList.remove('active');
    screens[id].classList.add('active');
    currentScreen = id;
  }

  function _buildAbilityGrid() {
    const grid = document.getElementById('ability-grid');
    grid.innerHTML = '';
    Object.values(ABILITIES).forEach(ab => {
      const card = document.createElement('div');
      card.className = 'ability-card';
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
    // auto-select first
    selectAbility(Object.keys(ABILITIES)[0]);
  }

  function selectAbility(id) {
    GameState.playerAbilityId = id;
    document.querySelectorAll('.ability-card').forEach(c => {
      c.classList.toggle('selected', c.dataset.id === id);
    });
  }

  // ── HUD ──
  function updateScores(ai, player) {
    document.getElementById('score-ai').textContent = ai;
    document.getElementById('score-player').textContent = player;
  }

  function updateCooldownRing(side, fraction, isReady, isActive) {
    const ringId = side === 'player' ? 'player-ring' : 'ai-ring';
    const labelId = side === 'player' ? 'player-cooldown-label' : 'ai-cooldown-label';
    const ring = document.getElementById(ringId);
    const label = document.getElementById(labelId);
    if (!ring) return;

    const circ = 113.1;
    const offset = circ * (1 - fraction);
    ring.style.strokeDashoffset = offset;
    ring.classList.toggle('ready', isReady);
    ring.classList.toggle('active-glow', isActive);

    if (isReady) {
      label.textContent = 'READY';
    } else {
      const abilityId = side === 'player' ? GameState.playerAbilityId : GameState.aiAbilityId;
      const cd = ABILITIES[abilityId]?.cooldown || 0;
      const remaining = Math.ceil(cd * (1 - fraction) / 1000);
      label.textContent = remaining + 's';
    }
  }

  function setAbilityIcons(playerId, aiId) {
    const p = ABILITIES[playerId];
    const a = ABILITIES[aiId];
    document.getElementById('player-ability-icon').textContent = p ? p.icon : '';
    document.getElementById('ai-ability-icon').textContent = a ? a.icon : '';
  }

  function flashAbility(color) {
    const el = document.getElementById('ability-flash');
    el.style.background = color;
    el.style.boxShadow = `0 0 60px ${color}`;
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 80);
  }

  function showGameOver(playerWon, playerScore, aiScore) {
    document.getElementById('go-icon').textContent = playerWon ? '🏆' : '💀';
    document.getElementById('go-title').textContent = playerWon ? 'YOU WIN!' : 'CPU WINS';
    document.getElementById('go-score').textContent = `${playerScore} — ${aiScore}`;
    goTo('screen-gameover');
    if (playerWon) Audio.win(); else Audio.lose();
  }

  function showSpaceHint(show) {
    const h = document.getElementById('space-hint');
    h.style.opacity = show ? '1' : '0';
  }

  return { init, goTo, updateScores, updateCooldownRing, setAbilityIcons, flashAbility, showGameOver, showSpaceHint };
})();

// Shared game state (read by UI and Game)
const GameState = {
  playerAbilityId: Object.keys(ABILITIES)[0],
  aiAbilityId: null,
  difficulty: 'medium',
};
