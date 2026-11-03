// Game Engine for "Mage on the Trail"
// Implements all game logic as specified in the technical requirements

export type GameState = 'menu' | 'playing' | 'paused' | 'gameover' | 'victory';
export type MonsterType = 'slime' | 'goblin' | 'skeleton' | 'boss';
export type SpellId = 'fireball' | 'frostbolt' | 'lightning';

interface Monster {
  id: number;
  type: MonsterType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  speed: number;
  baseSpeed: number;
  points: number;
  color: string;
  slowUntil: number;
}

interface SpellEffect {
  id: SpellId;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  elapsed: number;
  duration: number;
}

interface SpellConfig {
  mana: number;
  cooldown: number;
  damage: number;
  effect: string;
  targets: number;
}

interface WaveConfig {
  monsters: MonsterType[];
  interval: number;
}

export interface StateSnapshot {
  state: GameState;
  mageHp: number;
  mana: number;
  score: number;
  wave: number;
  cooldowns: { fireball: number; frostbolt: number; lightning: number };
  monsters: { id: number; type: MonsterType; x: number; hp: number; speed: number; slowUntil: number }[];
  elapsed: number;
}

const MONSTER_CONFIGS: Record<MonsterType, { hp: number; speed: number; points: number; color: string }> = {
  slime: { hp: 30, speed: 40, points: 10, color: '#22c55e' },
  goblin: { hp: 50, speed: 60, points: 20, color: '#f97316' },
  skeleton: { hp: 80, speed: 30, points: 30, color: '#f0f0f0' },
  boss: { hp: 300, speed: 25, points: 100, color: '#a855f7' },
};

const SPELL_CONFIGS: Record<SpellId, SpellConfig> = {
  fireball: { mana: 10, cooldown: 0.6, damage: 30, effect: 'none', targets: 1 },
  frostbolt: { mana: 15, cooldown: 1.5, damage: 15, effect: 'slow', targets: 1 },
  lightning: { mana: 25, cooldown: 3.0, damage: 20, effect: 'none', targets: 3 },
};

const WAVES: WaveConfig[] = [
  { monsters: ['slime', 'slime', 'slime', 'slime', 'slime'], interval: 1.5 },
  { monsters: ['slime', 'slime', 'goblin', 'slime', 'goblin', 'slime', 'goblin'], interval: 1.2 },
  { monsters: ['goblin', 'skeleton', 'goblin', 'skeleton', 'boss'], interval: 1.8 },
];

const CANVAS_W = 800;
const CANVAS_H = 450;
const MAGE_X = 140;
const MAGE_Y = 330;
const TRAIL_Y = 300;
const TRAIL_H = 60;
const MONSTER_SPAWN_X = 820;
const MONSTER_Y = 330;
const MONSTER_REACH_X = 160;
const MAX_HP = 3;
const MAX_MANA = 100;
const MANA_REGEN = 10;
const WAVE_START_DELAY = 1.0;
const WAVE_PAUSE_DURATION = 2.0;

export class GameEngine {
  private state: GameState = 'menu';
  private mageHp: number = MAX_HP;
  private mana: number = MAX_MANA;
  private score: number = 0;
  private wave: number = 1;
  private elapsed: number = 0;
  private monsters: Monster[] = [];
  private cooldowns: Record<SpellId, number> = { fireball: 0, frostbolt: 0, lightning: 0 };
  private spellEffects: SpellEffect[] = [];
  private nextMonsterId: number = 1;

  // Wave management
  private waveSpawnIndex: number = 0;
  private waveSpawnTimer: number = 0;
  private waveStarted: boolean = false;
  private wavePauseTimer: number = 0;
  private betweenWaves: boolean = false;

  // Visual effects
  private damageFlashTimer: number = 0;

  // Canvas
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  // Callbacks
  private onStateChange: (() => void) | null = null;

  constructor() {
    // Test mode is handled externally
  }

  setCanvas(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  setStateChangeCallback(cb: () => void) {
    this.onStateChange = cb;
  }

  private notifyStateChange() {
    if (this.onStateChange) this.onStateChange();
  }

  start() {
    this.state = 'playing';
    this.mageHp = MAX_HP;
    this.mana = MAX_MANA;
    this.score = 0;
    this.wave = 1;
    this.elapsed = 0;
    this.monsters = [];
    this.cooldowns = { fireball: 0, frostbolt: 0, lightning: 0 };
    this.spellEffects = [];
    this.nextMonsterId = 1;
    this.waveSpawnIndex = 0;
    this.waveSpawnTimer = WAVE_START_DELAY;
    this.waveStarted = false;
    this.betweenWaves = false;
    this.damageFlashTimer = 0;
    this.notifyStateChange();
  }

  reset() {
    this.state = 'menu';
    this.mageHp = MAX_HP;
    this.mana = MAX_MANA;
    this.score = 0;
    this.wave = 1;
    this.elapsed = 0;
    this.monsters = [];
    this.cooldowns = { fireball: 0, frostbolt: 0, lightning: 0 };
    this.spellEffects = [];
    this.nextMonsterId = 1;
    this.waveSpawnIndex = 0;
    this.waveSpawnTimer = 0;
    this.waveStarted = false;
    this.wavePauseTimer = 0;
    this.betweenWaves = false;
    this.damageFlashTimer = 0;
    this.notifyStateChange();
  }

  pause() {
    if (this.state === 'playing') {
      this.state = 'paused';
      this.notifyStateChange();
    }
  }

  resume() {
    if (this.state === 'paused') {
      this.state = 'playing';
      this.notifyStateChange();
    }
  }

  cast(spellId: SpellId): boolean {
    if (this.state !== 'playing') return false;

    const config = SPELL_CONFIGS[spellId];
    if (this.mana < config.mana) return false;
    if (this.cooldowns[spellId] > 0) return false;
    if (this.monsters.length === 0) return false;

    // Find targets
    const targets = this.findTargets(spellId);
    if (targets.length === 0) return false;

    // Apply spell
    this.mana -= config.mana;
    this.cooldowns[spellId] = config.cooldown;

    for (const target of targets) {
      target.hp -= config.damage;
      if (config.effect === 'slow') {
        target.slowUntil = this.elapsed + 3.0;
      }
      // Add visual effect
      this.spellEffects.push({
        id: spellId,
        x: MAGE_X + 18,
        y: MAGE_Y - 43,
        targetX: target.x,
        targetY: target.y,
        elapsed: 0,
        duration: 0.2,
      });
    }

    // Remove dead monsters
    this.removeDeadMonsters();
    this.notifyStateChange();
    return true;
  }

  private findTargets(spellId: SpellId): Monster[] {
    const config = SPELL_CONFIGS[spellId];
    // Sort by x ascending, then by id ascending
    const sorted = [...this.monsters].sort((a, b) => {
      if (a.x !== b.x) return a.x - b.x;
      return a.id - b.id;
    });
    return sorted.slice(0, config.targets);
  }

  private removeDeadMonsters() {
    const alive: Monster[] = [];
    for (const m of this.monsters) {
      if (m.hp <= 0) {
        this.score += m.points;
      } else {
        alive.push(m);
      }
    }
    this.monsters = alive;
  }

  tick(dt: number) {
    if (this.state !== 'playing') return;

    // Clamp dt
    dt = Math.min(dt, 0.05);
    this.elapsed += dt;

    // Regen mana
    this.mana = Math.min(MAX_MANA, this.mana + MANA_REGEN * dt);

    // Update cooldowns
    for (const spell of Object.keys(this.cooldowns) as SpellId[]) {
      if (this.cooldowns[spell] > 0) {
        this.cooldowns[spell] = Math.max(0, this.cooldowns[spell] - dt);
      }
    }

    // Update spell effects
    for (const effect of this.spellEffects) {
      effect.elapsed += dt;
    }
    this.spellEffects = this.spellEffects.filter(e => e.elapsed < e.duration);

    // Update damage flash
    if (this.damageFlashTimer > 0) {
      this.damageFlashTimer = Math.max(0, this.damageFlashTimer - dt);
    }

    // Wave management
    this.updateWaveSpawning(dt);

    // Move monsters
    this.updateMonsters(dt);

    // Check wave completion
    this.checkWaveCompletion();

    this.notifyStateChange();
  }

  private updateWaveSpawning(dt: number) {
    if (this.betweenWaves) {
      this.wavePauseTimer -= dt;
      if (this.wavePauseTimer <= 0) {
        this.betweenWaves = false;
        this.waveSpawnIndex = 0;
        this.waveSpawnTimer = WAVE_START_DELAY;
        this.waveStarted = false;
      }
      return;
    }

    const waveConfig = WAVES[this.wave - 1];
    if (!waveConfig) return;

    if (!this.waveStarted) {
      this.waveSpawnTimer -= dt;
      if (this.waveSpawnTimer <= 0) {
        this.waveStarted = true;
        this.waveSpawnTimer = 0;
      }
      return;
    }

    if (this.waveSpawnIndex < waveConfig.monsters.length) {
      this.waveSpawnTimer -= dt;
      if (this.waveSpawnTimer <= 0) {
        const monsterType = waveConfig.monsters[this.waveSpawnIndex];
        this.spawnMonsterInternal(monsterType, MONSTER_SPAWN_X);
        this.waveSpawnIndex++;
        this.waveSpawnTimer = waveConfig.interval;
      }
    }
  }

  private updateMonsters(dt: number) {
    const toRemove: number[] = [];

    for (const m of this.monsters) {
      // Check slow
      let speed = m.baseSpeed;
      if (m.slowUntil > this.elapsed) {
        speed = m.baseSpeed * 0.5;
      }
      m.speed = speed;
      m.x -= speed * dt;

      if (m.x <= MONSTER_REACH_X) {
        toRemove.push(m.id);
        this.mageHp--;
        this.damageFlashTimer = 0.3;
        if (this.mageHp <= 0) {
          this.state = 'gameover';
          this.notifyStateChange();
          return;
        }
      }
    }

    this.monsters = this.monsters.filter(m => !toRemove.includes(m.id));
  }

  private checkWaveCompletion() {
    const waveConfig = WAVES[this.wave - 1];
    if (!waveConfig) return;

    const allSpawned = this.waveSpawnIndex >= waveConfig.monsters.length;
    const allDead = this.monsters.length === 0;

    if (allSpawned && allDead && this.waveStarted) {
      if (this.wave >= 3) {
        this.state = 'victory';
        this.notifyStateChange();
      } else {
        this.wave++;
        this.betweenWaves = true;
        this.wavePauseTimer = WAVE_PAUSE_DURATION;
        this.notifyStateChange();
      }
    }
  }

  spawnMonster(type: MonsterType, x: number): Monster {
    return this.spawnMonsterInternal(type, x);
  }

  private spawnMonsterInternal(type: MonsterType, x: number): Monster {
    const config = MONSTER_CONFIGS[type];
    const monster: Monster = {
      id: this.nextMonsterId++,
      type,
      x,
      y: MONSTER_Y,
      hp: config.hp,
      maxHp: config.hp,
      speed: config.speed,
      baseSpeed: config.speed,
      points: config.points,
      color: config.color,
      slowUntil: 0,
    };
    this.monsters.push(monster);
    return monster;
  }

  setMana(value: number) {
    this.mana = Math.max(0, Math.min(MAX_MANA, value));
    this.notifyStateChange();
  }

  setMageHp(value: number) {
    this.mageHp = Math.max(0, Math.min(MAX_HP, value));
    if (this.mageHp <= 0 && this.state === 'playing') {
      this.state = 'gameover';
    }
    this.notifyStateChange();
  }

  clearMonsters() {
    this.monsters = [];
    this.notifyStateChange();
  }

  getState(): StateSnapshot {
    return {
      state: this.state,
      mageHp: this.mageHp,
      mana: this.mana,
      score: this.score,
      wave: this.wave,
      cooldowns: { ...this.cooldowns },
      monsters: this.monsters.map(m => ({
        id: m.id,
        type: m.type,
        x: m.x,
        hp: m.hp,
        speed: m.speed,
        slowUntil: m.slowUntil,
      })),
      elapsed: this.elapsed,
    };
  }

  // Rendering
  render() {
    if (!this.ctx || !this.canvas) return;
    const ctx = this.ctx;

    // Clear
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // Background gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    gradient.addColorStop(0, '#1e1b4b');
    gradient.addColorStop(0.5, '#312e81');
    gradient.addColorStop(1, '#1e3a5f');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Stars
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    for (let i = 0; i < 30; i++) {
      const sx = (i * 137.5) % CANVAS_W;
      const sy = (i * 73.3) % (TRAIL_Y - 20);
      ctx.fillRect(sx, sy, 2, 2);
    }

    // Trail
    ctx.fillStyle = '#8B4513';
    ctx.fillRect(0, TRAIL_Y, CANVAS_W, TRAIL_H);
    // Trail texture
    ctx.strokeStyle = '#6B3410';
    ctx.lineWidth = 1;
    for (let i = 0; i < 12; i++) {
      const lx = (i * 71) % CANVAS_W;
      ctx.beginPath();
      ctx.moveTo(lx, TRAIL_Y + 5);
      ctx.lineTo(lx + 20, TRAIL_Y + TRAIL_H - 5);
      ctx.stroke();
    }
    // Trail edges
    ctx.fillStyle = '#5C2D0E';
    ctx.fillRect(0, TRAIL_Y, CANVAS_W, 3);
    ctx.fillRect(0, TRAIL_Y + TRAIL_H - 3, CANVAS_W, 3);

    // Draw mage
    this.drawMage(ctx);

    // Draw monsters
    for (const m of this.monsters) {
      this.drawMonster(ctx, m);
    }

    // Draw spell effects
    for (const effect of this.spellEffects) {
      this.drawSpellEffect(ctx, effect);
    }

    // Damage flash
    if (this.damageFlashTimer > 0) {
      const alpha = this.damageFlashTimer / 0.3 * 0.3;
      ctx.fillStyle = `rgba(255, 0, 0, ${alpha})`;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }

    // HUD on canvas
    this.drawHUD(ctx);
  }

  private drawMage(ctx: CanvasRenderingContext2D) {
    const x = MAGE_X;
    const y = MAGE_Y;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(x, y + 30, 18, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body (robe)
    ctx.fillStyle = '#4338ca';
    ctx.beginPath();
    ctx.moveTo(x - 15, y + 28);
    ctx.lineTo(x + 15, y + 28);
    ctx.lineTo(x + 10, y - 10);
    ctx.lineTo(x - 10, y - 10);
    ctx.closePath();
    ctx.fill();

    // Belt
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(x - 11, y + 2, 22, 4);

    // Head
    ctx.fillStyle = '#fcd34d';
    ctx.beginPath();
    ctx.arc(x, y - 20, 10, 0, Math.PI * 2);
    ctx.fill();

    // Eyes
    ctx.fillStyle = '#1e1b4b';
    ctx.fillRect(x - 4, y - 22, 3, 3);
    ctx.fillRect(x + 2, y - 22, 3, 3);

    // Hat
    ctx.fillStyle = '#4338ca';
    ctx.beginPath();
    ctx.moveTo(x - 14, y - 27);
    ctx.lineTo(x + 14, y - 27);
    ctx.lineTo(x, y - 52);
    ctx.closePath();
    ctx.fill();

    // Hat brim
    ctx.fillStyle = '#3730a3';
    ctx.fillRect(x - 16, y - 28, 32, 4);

    // Hat star
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.arc(x, y - 40, 3, 0, Math.PI * 2);
    ctx.fill();

    // Staff
    ctx.strokeStyle = '#92400e';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + 18, y + 28);
    ctx.lineTo(x + 18, y - 42);
    ctx.stroke();

    // Staff orb
    const orbGlow = 0.5 + Math.sin(this.elapsed * 3) * 0.3;
    ctx.fillStyle = `rgba(96, 165, 250, ${orbGlow})`;
    ctx.beginPath();
    ctx.arc(x + 18, y - 45, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#60a5fa';
    ctx.beginPath();
    ctx.arc(x + 18, y - 45, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#bfdbfe';
    ctx.beginPath();
    ctx.arc(x + 16, y - 47, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawMonster(ctx: CanvasRenderingContext2D, m: Monster) {
    const x = m.x;
    const y = m.y;
    const size = m.type === 'boss' ? 25 : 18;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(x, y + (m.type === 'boss' ? 15 : 12), size * 0.8, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body
    ctx.fillStyle = m.color;
    if (m.type === 'slime') {
      // Blob shape with bounce
      const bounce = Math.sin(this.elapsed * 4 + m.id) * 2;
      ctx.beginPath();
      ctx.ellipse(x, y + 5 + bounce, size, size * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      // Eyes
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(x - 5, y + 2 + bounce, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + 5, y + 2 + bounce, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(x - 5, y + 3 + bounce, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + 5, y + 3 + bounce, 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (m.type === 'goblin') {
      // Body
      ctx.fillRect(x - 8, y - 10, 16, 22);
      // Head
      ctx.beginPath();
      ctx.arc(x, y - 16, 8, 0, Math.PI * 2);
      ctx.fill();
      // Ears
      ctx.beginPath();
      ctx.moveTo(x - 8, y - 18);
      ctx.lineTo(x - 14, y - 24);
      ctx.lineTo(x - 6, y - 14);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x + 8, y - 18);
      ctx.lineTo(x + 14, y - 24);
      ctx.lineTo(x + 6, y - 14);
      ctx.fill();
      // Eyes
      ctx.fillStyle = '#f00';
      ctx.fillRect(x - 4, y - 18, 3, 3);
      ctx.fillRect(x + 2, y - 18, 3, 3);
    } else if (m.type === 'skeleton') {
      // Body (thin)
      ctx.fillRect(x - 5, y - 10, 10, 22);
      // Ribs
      ctx.strokeStyle = '#ccc';
      ctx.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(x - 5, y - 5 + i * 5);
        ctx.lineTo(x + 5, y - 5 + i * 5);
        ctx.stroke();
      }
      // Head (skull)
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.arc(x, y - 16, 8, 0, Math.PI * 2);
      ctx.fill();
      // Eyes (dark sockets)
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(x - 3, y - 17, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + 3, y - 17, 2.5, 0, Math.PI * 2);
      ctx.fill();
      // Jaw
      ctx.fillStyle = '#ddd';
      ctx.fillRect(x - 4, y - 11, 8, 3);
    } else if (m.type === 'boss') {
      // Large menacing body
      ctx.beginPath();
      ctx.moveTo(x - size, y + 12);
      ctx.lineTo(x - size * 0.8, y - size * 0.5);
      ctx.lineTo(x - size * 0.3, y - size);
      ctx.lineTo(x, y - size * 1.2);
      ctx.lineTo(x + size * 0.3, y - size);
      ctx.lineTo(x + size * 0.8, y - size * 0.5);
      ctx.lineTo(x + size, y + 12);
      ctx.closePath();
      ctx.fill();

      // Horns
      ctx.fillStyle = '#7c3aed';
      ctx.beginPath();
      ctx.moveTo(x - 12, y - size * 0.8);
      ctx.lineTo(x - 18, y - size * 1.5);
      ctx.lineTo(x - 6, y - size * 0.8);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x + 12, y - size * 0.8);
      ctx.lineTo(x + 18, y - size * 1.5);
      ctx.lineTo(x + 6, y - size * 0.8);
      ctx.fill();

      // Eyes
      ctx.fillStyle = '#f00';
      ctx.beginPath();
      ctx.arc(x - 8, y - size * 0.5, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + 8, y - size * 0.5, 4, 0, Math.PI * 2);
      ctx.fill();
      // Eye glow
      ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
      ctx.beginPath();
      ctx.arc(x - 8, y - size * 0.5, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + 8, y - size * 0.5, 8, 0, Math.PI * 2);
      ctx.fill();
    }

    // Slow indicator
    if (m.slowUntil > this.elapsed) {
      ctx.strokeStyle = 'rgba(100, 200, 255, 0.6)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(x, y, size + 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      // Ice crystals
      ctx.fillStyle = 'rgba(150, 220, 255, 0.7)';
      for (let i = 0; i < 3; i++) {
        const angle = (i / 3) * Math.PI * 2 + this.elapsed * 2;
        const px = x + Math.cos(angle) * (size + 8);
        const py = y + Math.sin(angle) * (size + 8);
        ctx.fillRect(px - 2, py - 2, 4, 4);
      }
    }

    // HP bar
    const barWidth = m.type === 'boss' ? 50 : 30;
    const barHeight = 5;
    const barX = x - barWidth / 2;
    const barY = y - (m.type === 'boss' ? 50 : 32);
    const hpRatio = m.hp / m.maxHp;

    ctx.fillStyle = '#1f2937';
    ctx.fillRect(barX - 1, barY - 1, barWidth + 2, barHeight + 2);
    ctx.fillStyle = '#374151';
    ctx.fillRect(barX, barY, barWidth, barHeight);
    ctx.fillStyle = hpRatio > 0.5 ? '#22c55e' : hpRatio > 0.25 ? '#eab308' : '#ef4444';
    ctx.fillRect(barX, barY, barWidth * hpRatio, barHeight);
  }

  private drawSpellEffect(ctx: CanvasRenderingContext2D, effect: SpellEffect) {
    const progress = effect.elapsed / effect.duration;
    const alpha = 1 - progress;

    if (effect.id === 'fireball') {
      const cx = effect.x + (effect.targetX - effect.x) * progress;
      const cy = effect.y + (effect.targetY - effect.y) * progress;
      // Outer glow
      ctx.fillStyle = `rgba(255, 100, 0, ${alpha * 0.4})`;
      ctx.beginPath();
      ctx.arc(cx, cy, 20 - progress * 12, 0, Math.PI * 2);
      ctx.fill();
      // Core
      ctx.fillStyle = `rgba(255, 160, 0, ${alpha})`;
      ctx.beginPath();
      ctx.arc(cx, cy, 12 - progress * 8, 0, Math.PI * 2);
      ctx.fill();
      // Hot center
      ctx.fillStyle = `rgba(255, 255, 100, ${alpha})`;
      ctx.beginPath();
      ctx.arc(cx, cy, 6 - progress * 4, 0, Math.PI * 2);
      ctx.fill();
    } else if (effect.id === 'frostbolt') {
      const cx = effect.x + (effect.targetX - effect.x) * progress;
      const cy = effect.y + (effect.targetY - effect.y) * progress;
      // Outer
      ctx.fillStyle = `rgba(100, 200, 255, ${alpha * 0.5})`;
      ctx.beginPath();
      ctx.arc(cx, cy, 15 - progress * 8, 0, Math.PI * 2);
      ctx.fill();
      // Core
      ctx.fillStyle = `rgba(180, 230, 255, ${alpha})`;
      ctx.beginPath();
      ctx.arc(cx, cy, 8 - progress * 5, 0, Math.PI * 2);
      ctx.fill();
      // Ice particles
      ctx.fillStyle = `rgba(200, 240, 255, ${alpha * 0.8})`;
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2 + progress * 5;
        const dist = 12 + progress * 8;
        const px = cx + Math.cos(angle) * dist;
        const py = cy + Math.sin(angle) * dist;
        ctx.fillRect(px - 2, py - 2, 4, 4);
      }
    } else if (effect.id === 'lightning') {
      // Main bolt
      ctx.strokeStyle = `rgba(255, 255, 100, ${alpha})`;
      ctx.lineWidth = 3 - progress * 2;
      ctx.beginPath();
      ctx.moveTo(effect.x, effect.y);
      const segments = 6;
      for (let i = 1; i <= segments; i++) {
        const t = i / segments;
        const lx = effect.x + (effect.targetX - effect.x) * t;
        const ly = effect.y + (effect.targetY - effect.y) * t;
        const offset = (i < segments) ? (Math.sin(i * 11 + effect.elapsed * 30) * 12) : 0;
        ctx.lineTo(lx + offset, ly);
      }
      ctx.stroke();
      // Glow
      ctx.strokeStyle = `rgba(255, 255, 200, ${alpha * 0.4})`;
      ctx.lineWidth = 8 - progress * 5;
      ctx.stroke();
      // Impact flash
      if (progress > 0.5) {
        ctx.fillStyle = `rgba(255, 255, 200, ${(1 - progress) * 2 * 0.5})`;
        ctx.beginPath();
        ctx.arc(effect.targetX, effect.targetY, 15, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawHUD(ctx: CanvasRenderingContext2D) {
    // Hearts
    for (let i = 0; i < MAX_HP; i++) {
      const hx = 20 + i * 28;
      const hy = 15;
      if (i < this.mageHp) {
        ctx.fillStyle = '#ef4444';
      } else {
        ctx.fillStyle = '#374151';
      }
      this.drawHeart(ctx, hx, hy, 9);
    }

    // Mana bar
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(19, 42, 122, 14);
    const manaGrad = ctx.createLinearGradient(20, 0, 140, 0);
    manaGrad.addColorStop(0, '#2563eb');
    manaGrad.addColorStop(1, '#7c3aed');
    ctx.fillStyle = manaGrad;
    ctx.fillRect(20, 43, 120 * (this.mana / MAX_MANA), 12);
    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 1;
    ctx.strokeRect(20, 43, 120, 12);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.floor(this.mana)}/${MAX_MANA}`, 80, 53);
    ctx.textAlign = 'left';

    // Score
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`Счёт: ${this.score}`, CANVAS_W - 15, 25);

    // Wave
    ctx.fillStyle = '#a78bfa';
    ctx.font = 'bold 14px monospace';
    ctx.fillText(`Волна: ${this.wave}/3`, CANVAS_W - 15, 48);
    ctx.textAlign = 'left';

    // Between waves indicator
    if (this.betweenWaves) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(CANVAS_W / 2 - 120, 80, 240, 40);
      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 18px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`Следующая волна: ${Math.ceil(this.wavePauseTimer)}с`, CANVAS_W / 2, 105);
      ctx.textAlign = 'left';
    }
  }

  private drawHeart(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
    ctx.beginPath();
    ctx.moveTo(x, y + size * 0.3);
    ctx.bezierCurveTo(x, y - size * 0.2, x - size, y - size * 0.2, x - size, y + size * 0.3);
    ctx.bezierCurveTo(x - size, y + size * 0.7, x, y + size * 1.1, x, y + size * 1.3);
    ctx.bezierCurveTo(x, y + size * 1.1, x + size, y + size * 0.7, x + size, y + size * 0.3);
    ctx.bezierCurveTo(x + size, y - size * 0.2, x, y - size * 0.2, x, y + size * 0.3);
    ctx.fill();
  }
}
