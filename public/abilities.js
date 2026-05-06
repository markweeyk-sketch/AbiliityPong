// Ability definitions — shared between player and AI
const ABILITIES = {
  freeze: {
    id: 'freeze',
    name: 'FREEZE',
    icon: '❄️',
    desc: 'Freezes opponent paddle for 1.5s',
    cooldown: 8000,
    duration: 1500,
    color: '#67e8f9',
  },
  surge: {
    id: 'surge',
    name: 'SURGE',
    icon: '⚡',
    desc: 'Next hit doubles ball speed',
    cooldown: 6000,
    duration: 0,
    color: '#fde68a',
  },
  curve: {
    id: 'curve',
    name: 'CURVE',
    icon: '🔮',
    desc: 'Ball curves toward opponent\'s corner',
    cooldown: 10000,
    duration: 800,
    color: '#c084fc',
  },
  shield: {
    id: 'shield',
    name: 'SHIELD',
    icon: '🛡️',
    desc: 'Spawns a wall in front of your goal for 2s',
    cooldown: 12000,
    duration: 2000,
    color: '#86efac',
  },
  ghost: {
    id: 'ghost',
    name: 'GHOST',
    icon: '👻',
    desc: 'Ball turns invisible for 1.5s',
    cooldown: 9000,
    duration: 1500,
    color: '#e2e8f0',
  },
  dash: {
    id: 'dash',
    name: 'DASH',
    icon: '💨',
    desc: 'Instantly snaps paddle to ball\'s Y position',
    cooldown: 5000,
    duration: 0,
    color: '#6ee7b7',
  },
};

// ── AbilityState manages cooldown + active duration for one side ──
class AbilityState {
  constructor(abilityId) {
    this.ability = ABILITIES[abilityId];
    this.cooldownRemaining = 0; // ms
    this.activeRemaining = 0;   // ms
    this.surgePending = false;
    this.ready = true;
  }

  activate() {
    if (!this.ready) return false;
    this.ready = false;
    this.cooldownRemaining = this.ability.cooldown;
    if (this.ability.duration > 0) {
      this.activeRemaining = this.ability.duration;
    }
    if (this.ability.id === 'surge') this.surgePending = true;
    return true;
  }

  update(dt) {
    if (this.cooldownRemaining > 0) {
      this.cooldownRemaining = Math.max(0, this.cooldownRemaining - dt);
      if (this.cooldownRemaining === 0) this.ready = true;
    }
    if (this.activeRemaining > 0) {
      this.activeRemaining = Math.max(0, this.activeRemaining - dt);
    }
  }

  get isActive() { return this.activeRemaining > 0; }
  get cooldownFraction() {
    if (this.ready) return 1;
    return 1 - (this.cooldownRemaining / this.ability.cooldown);
  }
}
