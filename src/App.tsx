import { useEffect, useRef, useState, useCallback } from 'react';

// ============================================================
// ТИПЫ И КОНСТАНТЫ
// ============================================================

type GameState = 'menu' | 'playing' | 'paused' | 'gameover' | 'victory';
type MonsterType = 'slime' | 'goblin' | 'skeleton' | 'boss';
type SpellId = 'fireball' | 'frostbolt' | 'lightning';

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

interface StateSnapshot {
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

const SPELL_CONFIGS: Record<SpellId, { mana: number; cooldown: number; damage: number; effect: string; targets: number }> = {
  fireball: { mana: 10, cooldown: 0.6, damage: 30, effect: 'none', targets: 1 },
  frostbolt: { mana: 15, cooldown: 1.5, damage: 15, effect: 'slow', targets: 1 },
  lightning: { mana: 25, cooldown: 3.0, damage: 20, effect: 'none', targets: 3 },
};

const WAVES: { monsters: MonsterType[]; interval: number }[] = [
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

// ============================================================
// ИГРОВОЙ ДВИЖОК
// ============================================================

class GameEngine {
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
  private waveSpawnIndex: number = 0;
  private waveSpawnTimer: number = 0;
  private waveStarted: boolean = false;
  private wavePauseTimer: number = 0;
  private betweenWaves: boolean = false;
  private damageFlashTimer: number = 0;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private onStateChange: (() => void) | null = null;

  setCanvas(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  setStateChangeCallback(cb: () => void) {
    this.onStateChange = cb;
  }

  private notify() {
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
    this.notify();
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
    this.notify();
  }

  pause() {
    if (this.state === 'playing') { this.state = 'paused'; this.notify(); }
  }

  resume() {
    if (this.state === 'paused') { this.state = 'playing'; this.notify(); }
  }

  cast(spellId: SpellId): boolean {
    if (this.state !== 'playing') return false;
    const config = SPELL_CONFIGS[spellId];
    if (this.mana < config.mana) return false;
    if (this.cooldowns[spellId] > 0) return false;
    if (this.monsters.length === 0) return false;
    const targets = this.findTargets(spellId);
    if (targets.length === 0) return false;

    this.mana -= config.mana;
    this.cooldowns[spellId] = config.cooldown;

    for (const target of targets) {
      target.hp -= config.damage;
      if (config.effect === 'slow') {
        target.slowUntil = this.elapsed + 3.0;
      }
      this.spellEffects.push({
        id: spellId,
        x: MAGE_X + 18, y: MAGE_Y - 43,
        targetX: target.x, targetY: target.y,
        elapsed: 0, duration: 0.2,
      });
    }
    this.removeDeadMonsters();
    this.notify();
    return true;
  }

  private findTargets(spellId: SpellId): Monster[] {
    const config = SPELL_CONFIGS[spellId];
    const sorted = [...this.monsters].sort((a, b) => a.x !== b.x ? a.x - b.x : a.id - b.id);
    return sorted.slice(0, config.targets);
  }

  private removeDeadMonsters() {
    const alive: Monster[] = [];
    for (const m of this.monsters) {
      if (m.hp <= 0) { this.score += m.points; }
      else { alive.push(m); }
    }
    this.monsters = alive;
  }

  tick(dt: number) {
    if (this.state !== 'playing') return;
    dt = Math.min(dt, 0.05);
    this.elapsed += dt;
    this.mana = Math.min(MAX_MANA, this.mana + MANA_REGEN * dt);

    for (const spell of Object.keys(this.cooldowns) as SpellId[]) {
      if (this.cooldowns[spell] > 0) this.cooldowns[spell] = Math.max(0, this.cooldowns[spell] - dt);
    }

    for (const effect of this.spellEffects) effect.elapsed += dt;
    this.spellEffects = this.spellEffects.filter(e => e.elapsed < e.duration);

    if (this.damageFlashTimer > 0) this.damageFlashTimer = Math.max(0, this.damageFlashTimer - dt);

    this.updateWaveSpawning(dt);
    this.updateMonsters(dt);
    this.checkWaveCompletion();
    this.notify();
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
      if (this.waveSpawnTimer <= 0) { this.waveStarted = true; this.waveSpawnTimer = 0; }
      return;
    }
    if (this.waveSpawnIndex < waveConfig.monsters.length) {
      this.waveSpawnTimer -= dt;
      if (this.waveSpawnTimer <= 0) {
        this.spawnMonsterInternal(waveConfig.monsters[this.waveSpawnIndex], MONSTER_SPAWN_X);
        this.waveSpawnIndex++;
        this.waveSpawnTimer = waveConfig.interval;
      }
    }
  }

  private updateMonsters(dt: number) {
    const toRemove: number[] = [];
    for (const m of this.monsters) {
      let speed = m.baseSpeed;
      if (m.slowUntil > this.elapsed) speed = m.baseSpeed * 0.5;
      m.speed = speed;
      m.x -= speed * dt;
      if (m.x <= MONSTER_REACH_X) {
        toRemove.push(m.id);
        this.mageHp--;
        this.damageFlashTimer = 0.3;
        if (this.mageHp <= 0) { this.state = 'gameover'; this.notify(); return; }
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
      if (this.wave >= 3) { this.state = 'victory'; this.notify(); }
      else { this.wave++; this.betweenWaves = true; this.wavePauseTimer = WAVE_PAUSE_DURATION; this.notify(); }
    }
  }

  spawnMonster(type: MonsterType, x: number): Monster {
    return this.spawnMonsterInternal(type, x);
  }

  private spawnMonsterInternal(type: MonsterType, x: number): Monster {
    const config = MONSTER_CONFIGS[type];
    const monster: Monster = {
      id: this.nextMonsterId++, type, x, y: MONSTER_Y,
      hp: config.hp, maxHp: config.hp, speed: config.speed, baseSpeed: config.speed,
      points: config.points, color: config.color, slowUntil: 0,
    };
    this.monsters.push(monster);
    return monster;
  }

  setMana(value: number) { this.mana = Math.max(0, Math.min(MAX_MANA, value)); this.notify(); }
  setMageHp(value: number) {
    this.mageHp = Math.max(0, Math.min(MAX_HP, value));
    if (this.mageHp <= 0 && this.state === 'playing') this.state = 'gameover';
    this.notify();
  }
  clearMonsters() { this.monsters = []; this.notify(); }

  getState(): StateSnapshot {
    return {
      state: this.state, mageHp: this.mageHp, mana: this.mana,
      score: this.score, wave: this.wave,
      cooldowns: { ...this.cooldowns },
      monsters: this.monsters.map(m => ({ id: m.id, type: m.type, x: m.x, hp: m.hp, speed: m.speed, slowUntil: m.slowUntil })),
      elapsed: this.elapsed,
    };
  }

  // ---- РЕНДЕРИНГ ----
  render() {
    if (!this.ctx || !this.canvas) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // Фон — градиент
    const gradient = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    gradient.addColorStop(0, '#1e1b4b');
    gradient.addColorStop(0.5, '#312e81');
    gradient.addColorStop(1, '#1e3a5f');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Звёзды
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (let i = 0; i < 30; i++) {
      ctx.fillRect((i * 137.5) % CANVAS_W, (i * 73.3) % (TRAIL_Y - 20), 2, 2);
    }

    // Луна
    ctx.fillStyle = 'rgba(255,255,200,0.15)';
    ctx.beginPath();
    ctx.arc(650, 60, 35, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,220,0.3)';
    ctx.beginPath();
    ctx.arc(650, 60, 25, 0, Math.PI * 2);
    ctx.fill();

    // Тропа
    ctx.fillStyle = '#8B4513';
    ctx.fillRect(0, TRAIL_Y, CANVAS_W, TRAIL_H);
    ctx.fillStyle = '#5C2D0E';
    ctx.fillRect(0, TRAIL_Y, CANVAS_W, 3);
    ctx.fillRect(0, TRAIL_Y + TRAIL_H - 3, CANVAS_W, 3);
    ctx.strokeStyle = '#6B3410';
    ctx.lineWidth = 1;
    for (let i = 0; i < 12; i++) {
      const lx = (i * 71) % CANVAS_W;
      ctx.beginPath();
      ctx.moveTo(lx, TRAIL_Y + 5);
      ctx.lineTo(lx + 20, TRAIL_Y + TRAIL_H - 5);
      ctx.stroke();
    }

    // Маг
    this.drawMage(ctx);
    // Монстры
    for (const m of this.monsters) this.drawMonster(ctx, m);
    // Эффекты заклинаний
    for (const effect of this.spellEffects) this.drawSpellEffect(ctx, effect);

    // Вспышка при уроне
    if (this.damageFlashTimer > 0) {
      ctx.fillStyle = `rgba(255,0,0,${this.damageFlashTimer / 0.3 * 0.3})`;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }

    // HUD
    this.drawHUD(ctx);
  }

  private drawMage(ctx: CanvasRenderingContext2D) {
    const x = MAGE_X, y = MAGE_Y;
    // Тень
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(x, y + 30, 18, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    // Мантия
    ctx.fillStyle = '#4338ca';
    ctx.beginPath();
    ctx.moveTo(x - 15, y + 28); ctx.lineTo(x + 15, y + 28);
    ctx.lineTo(x + 10, y - 10); ctx.lineTo(x - 10, y - 10);
    ctx.closePath(); ctx.fill();
    // Пояс
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(x - 11, y + 2, 22, 4);
    // Голова
    ctx.fillStyle = '#fcd34d';
    ctx.beginPath(); ctx.arc(x, y - 20, 10, 0, Math.PI * 2); ctx.fill();
    // Глаза
    ctx.fillStyle = '#1e1b4b';
    ctx.fillRect(x - 4, y - 22, 3, 3);
    ctx.fillRect(x + 2, y - 22, 3, 3);
    // Шляпа
    ctx.fillStyle = '#4338ca';
    ctx.beginPath();
    ctx.moveTo(x - 14, y - 27); ctx.lineTo(x + 14, y - 27); ctx.lineTo(x, y - 52);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#3730a3';
    ctx.fillRect(x - 16, y - 28, 32, 4);
    // Звезда на шляпе
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath(); ctx.arc(x, y - 40, 3, 0, Math.PI * 2); ctx.fill();
    // Посох
    ctx.strokeStyle = '#92400e'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x + 18, y + 28); ctx.lineTo(x + 18, y - 42); ctx.stroke();
    // Орб
    const glow = 0.5 + Math.sin(this.elapsed * 3) * 0.3;
    ctx.fillStyle = `rgba(96,165,250,${glow})`;
    ctx.beginPath(); ctx.arc(x + 18, y - 45, 12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#60a5fa';
    ctx.beginPath(); ctx.arc(x + 18, y - 45, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#bfdbfe';
    ctx.beginPath(); ctx.arc(x + 16, y - 47, 2, 0, Math.PI * 2); ctx.fill();
  }

  private drawMonster(ctx: CanvasRenderingContext2D, m: Monster) {
    const x = m.x, y = m.y;
    const size = m.type === 'boss' ? 25 : 18;
    // Тень
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(x, y + (m.type === 'boss' ? 15 : 12), size * 0.8, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = m.color;
    if (m.type === 'slime') {
      const bounce = Math.sin(this.elapsed * 4 + m.id) * 2;
      ctx.beginPath();
      ctx.ellipse(x, y + 5 + bounce, size, size * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(x - 5, y + 2 + bounce, 4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x + 5, y + 2 + bounce, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.arc(x - 5, y + 3 + bounce, 2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x + 5, y + 3 + bounce, 2, 0, Math.PI * 2); ctx.fill();
    } else if (m.type === 'goblin') {
      ctx.fillRect(x - 8, y - 10, 16, 22);
      ctx.beginPath(); ctx.arc(x, y - 16, 8, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x - 8, y - 18); ctx.lineTo(x - 14, y - 24); ctx.lineTo(x - 6, y - 14); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x + 8, y - 18); ctx.lineTo(x + 14, y - 24); ctx.lineTo(x + 6, y - 14); ctx.fill();
      ctx.fillStyle = '#f00';
      ctx.fillRect(x - 4, y - 18, 3, 3);
      ctx.fillRect(x + 2, y - 18, 3, 3);
    } else if (m.type === 'skeleton') {
      ctx.fillRect(x - 5, y - 10, 10, 22);
      ctx.strokeStyle = '#ccc'; ctx.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath(); ctx.moveTo(x - 5, y - 5 + i * 5); ctx.lineTo(x + 5, y - 5 + i * 5); ctx.stroke();
      }
      ctx.fillStyle = m.color;
      ctx.beginPath(); ctx.arc(x, y - 16, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.arc(x - 3, y - 17, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x + 3, y - 17, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ddd';
      ctx.fillRect(x - 4, y - 11, 8, 3);
    } else if (m.type === 'boss') {
      ctx.beginPath();
      ctx.moveTo(x - size, y + 12); ctx.lineTo(x - size * 0.8, y - size * 0.5);
      ctx.lineTo(x - size * 0.3, y - size); ctx.lineTo(x, y - size * 1.2);
      ctx.lineTo(x + size * 0.3, y - size); ctx.lineTo(x + size * 0.8, y - size * 0.5);
      ctx.lineTo(x + size, y + 12); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#7c3aed';
      ctx.beginPath(); ctx.moveTo(x - 12, y - size * 0.8); ctx.lineTo(x - 18, y - size * 1.5); ctx.lineTo(x - 6, y - size * 0.8); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x + 12, y - size * 0.8); ctx.lineTo(x + 18, y - size * 1.5); ctx.lineTo(x + 6, y - size * 0.8); ctx.fill();
      ctx.fillStyle = '#f00';
      ctx.beginPath(); ctx.arc(x - 8, y - size * 0.5, 4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x + 8, y - size * 0.5, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,0,0,0.3)';
      ctx.beginPath(); ctx.arc(x - 8, y - size * 0.5, 8, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x + 8, y - size * 0.5, 8, 0, Math.PI * 2); ctx.fill();
    }

    // Индикатор замедления
    if (m.slowUntil > this.elapsed) {
      ctx.strokeStyle = 'rgba(100,200,255,0.6)'; ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.arc(x, y, size + 5, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(150,220,255,0.7)';
      for (let i = 0; i < 3; i++) {
        const angle = (i / 3) * Math.PI * 2 + this.elapsed * 2;
        ctx.fillRect(x + Math.cos(angle) * (size + 8) - 2, y + Math.sin(angle) * (size + 8) - 2, 4, 4);
      }
    }

    // HP bar
    const barW = m.type === 'boss' ? 50 : 30;
    const barH = 5;
    const barX = x - barW / 2;
    const barY = y - (m.type === 'boss' ? 50 : 32);
    const hpRatio = m.hp / m.maxHp;
    ctx.fillStyle = '#1f2937'; ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
    ctx.fillStyle = '#374151'; ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = hpRatio > 0.5 ? '#22c55e' : hpRatio > 0.25 ? '#eab308' : '#ef4444';
    ctx.fillRect(barX, barY, barW * hpRatio, barH);
  }

  private drawSpellEffect(ctx: CanvasRenderingContext2D, effect: SpellEffect) {
    const progress = effect.elapsed / effect.duration;
    const alpha = 1 - progress;
    if (effect.id === 'fireball') {
      const cx = effect.x + (effect.targetX - effect.x) * progress;
      const cy = effect.y + (effect.targetY - effect.y) * progress;
      ctx.fillStyle = `rgba(255,100,0,${alpha * 0.4})`;
      ctx.beginPath(); ctx.arc(cx, cy, 20 - progress * 12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(255,160,0,${alpha})`;
      ctx.beginPath(); ctx.arc(cx, cy, 12 - progress * 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(255,255,100,${alpha})`;
      ctx.beginPath(); ctx.arc(cx, cy, 6 - progress * 4, 0, Math.PI * 2); ctx.fill();
    } else if (effect.id === 'frostbolt') {
      const cx = effect.x + (effect.targetX - effect.x) * progress;
      const cy = effect.y + (effect.targetY - effect.y) * progress;
      ctx.fillStyle = `rgba(100,200,255,${alpha * 0.5})`;
      ctx.beginPath(); ctx.arc(cx, cy, 15 - progress * 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(180,230,255,${alpha})`;
      ctx.beginPath(); ctx.arc(cx, cy, 8 - progress * 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(200,240,255,${alpha * 0.8})`;
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2 + progress * 5;
        const dist = 12 + progress * 8;
        ctx.fillRect(cx + Math.cos(angle) * dist - 2, cy + Math.sin(angle) * dist - 2, 4, 4);
      }
    } else if (effect.id === 'lightning') {
      ctx.strokeStyle = `rgba(255,255,100,${alpha})`; ctx.lineWidth = 3 - progress * 2;
      ctx.beginPath(); ctx.moveTo(effect.x, effect.y);
      for (let i = 1; i <= 6; i++) {
        const t = i / 6;
        const lx = effect.x + (effect.targetX - effect.x) * t;
        const ly = effect.y + (effect.targetY - effect.y) * t;
        const offset = (i < 6) ? Math.sin(i * 11 + effect.elapsed * 30) * 12 : 0;
        ctx.lineTo(lx + offset, ly);
      }
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,200,${alpha * 0.4})`; ctx.lineWidth = 8 - progress * 5;
      ctx.stroke();
      if (progress > 0.5) {
        ctx.fillStyle = `rgba(255,255,200,${(1 - progress) * 2 * 0.5})`;
        ctx.beginPath(); ctx.arc(effect.targetX, effect.targetY, 15, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  private drawHUD(ctx: CanvasRenderingContext2D) {
    // Сердца
    for (let i = 0; i < MAX_HP; i++) {
      ctx.fillStyle = i < this.mageHp ? '#ef4444' : '#374151';
      this.drawHeart(ctx, 20 + i * 28, 15, 9);
    }
    // Мана
    ctx.fillStyle = '#1e293b'; ctx.fillRect(19, 42, 122, 14);
    const manaGrad = ctx.createLinearGradient(20, 0, 140, 0);
    manaGrad.addColorStop(0, '#2563eb'); manaGrad.addColorStop(1, '#7c3aed');
    ctx.fillStyle = manaGrad;
    ctx.fillRect(20, 43, 120 * (this.mana / MAX_MANA), 12);
    ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = 1;
    ctx.strokeRect(20, 43, 120, 12);
    ctx.fillStyle = '#e2e8f0'; ctx.font = '10px monospace'; ctx.textAlign = 'center';
    ctx.fillText(`${Math.floor(this.mana)}/${MAX_MANA}`, 80, 53);
    ctx.textAlign = 'left';
    // Счёт
    ctx.fillStyle = '#fbbf24'; ctx.font = 'bold 16px monospace'; ctx.textAlign = 'right';
    ctx.fillText(`Счёт: ${this.score}`, CANVAS_W - 15, 25);
    // Волна
    ctx.fillStyle = '#a78bfa'; ctx.font = 'bold 14px monospace';
    ctx.fillText(`Волна: ${this.wave}/3`, CANVAS_W - 15, 48);
    ctx.textAlign = 'left';
    // Между волнами
    if (this.betweenWaves) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(CANVAS_W / 2 - 120, 80, 240, 40);
      ctx.fillStyle = '#fbbf24'; ctx.font = 'bold 18px monospace'; ctx.textAlign = 'center';
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

// ============================================================
// SINGLETON И window.game API
// ============================================================

const engine = new GameEngine();
const testMode = new URLSearchParams(window.location.search).get('test') === '1';

(window as any).game = {
  start: () => engine.start(),
  reset: () => engine.reset(),
  pause: () => engine.pause(),
  resume: () => engine.resume(),
  cast: (spellId: SpellId) => engine.cast(spellId),
  tick: (dt: number) => engine.tick(dt),
  getState: () => engine.getState(),
  spawnMonster: (type: MonsterType, x: number) => engine.spawnMonster(type, x),
  setMana: (value: number) => engine.setMana(value),
  setMageHp: (value: number) => engine.setMageHp(value),
  clearMonsters: () => engine.clearMonsters(),
};

// ============================================================
// REACT КОМПОНЕНТ
// ============================================================

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<GameState>('menu');
  const [score, setScore] = useState(0);
  const [wave, setWave] = useState(1);
  const [mana, setMana] = useState(100);
  const [cooldowns, setCooldowns] = useState({ fireball: 0, frostbolt: 0, lightning: 0 });
  const animFrameRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  const updateUI = useCallback(() => {
    const s = engine.getState();
    setGameState(s.state);
    setScore(s.score);
    setWave(s.wave);
    setMana(s.mana);
    setCooldowns({ ...s.cooldowns });
  }, []);

  useEffect(() => {
    if (canvasRef.current) {
      engine.setCanvas(canvasRef.current);
      engine.setStateChangeCallback(updateUI);
      lastTimeRef.current = performance.now();

      const loop = (time: number) => {
        const dt = (time - lastTimeRef.current) / 1000;
        lastTimeRef.current = time;
        if (!testMode) engine.tick(dt);
        engine.render();
        animFrameRef.current = requestAnimationFrame(loop);
      };
      animFrameRef.current = requestAnimationFrame(loop);
      return () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current); };
    }
  }, [updateUI]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === '1') engine.cast('fireball');
      else if (e.key === '2') engine.cast('frostbolt');
      else if (e.key === '3') engine.cast('lightning');
      else if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
        const s = engine.getState();
        if (s.state === 'playing') engine.pause();
        else if (s.state === 'paused') engine.resume();
      } else if (e.key === 'r' || e.key === 'R') {
        const s = engine.getState();
        if (s.state === 'gameover' || s.state === 'victory') engine.start();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4 select-none">
      <h1 className="text-2xl font-bold text-purple-300 mb-4 font-mono">🧙 Маг на тропе</h1>
      <div className="relative" style={{ width: '800px', maxWidth: '100%' }}>
        <canvas
          ref={canvasRef}
          width={800}
          height={450}
          className="border-2 border-purple-700 rounded-lg shadow-lg shadow-purple-900/50 w-full"
        />
        {/* Кнопки заклинаний */}
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-3">
          <SpellBtn label="🔥 Огненный шар" hotkey="1" cd={cooldowns.fireball} maxCd={0.6} cost={10} mana={mana} onClick={() => engine.cast('fireball')} disabled={gameState !== 'playing'} />
          <SpellBtn label="❄️ Ледяная стрела" hotkey="2" cd={cooldowns.frostbolt} maxCd={1.5} cost={15} mana={mana} onClick={() => engine.cast('frostbolt')} disabled={gameState !== 'playing'} />
          <SpellBtn label="⚡ Молния" hotkey="3" cd={cooldowns.lightning} maxCd={3.0} cost={25} mana={mana} onClick={() => engine.cast('lightning')} disabled={gameState !== 'playing'} />
        </div>
        {/* Оверлеи */}
        {gameState === 'menu' && (
          <Overlay>
            <h2 className="text-4xl font-bold text-purple-300 mb-4 font-mono">🧙 Маг на тропе</h2>
            <p className="text-gray-300 mb-2 text-center">Защити тропу от монстров!</p>
            <p className="text-gray-400 text-sm mb-6 text-center max-w-md">
              <span className="text-orange-400">[1]</span> Огненный шар · <span className="text-blue-400">[2]</span> Ледяная стрела · <span className="text-yellow-400">[3]</span> Молния
            </p>
            <button onClick={() => engine.start()} className="px-8 py-3 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-lg text-lg transition-colors font-mono cursor-pointer">▶ Начать игру</button>
          </Overlay>
        )}
        {gameState === 'paused' && (
          <Overlay>
            <h2 className="text-3xl font-bold text-yellow-300 mb-4 font-mono">⏸ Пауза</h2>
            <p className="text-gray-300 mb-6">Esc или P — продолжить</p>
            <button onClick={() => engine.resume()} className="px-6 py-2 bg-yellow-600 hover:bg-yellow-500 text-white font-bold rounded-lg transition-colors font-mono cursor-pointer">Продолжить</button>
          </Overlay>
        )}
        {gameState === 'gameover' && (
          <Overlay>
            <h2 className="text-4xl font-bold text-red-400 mb-4 font-mono">💀 Поражение</h2>
            <p className="text-gray-300 mb-2">Счёт: <span className="text-yellow-300 font-bold">{score}</span></p>
            <p className="text-gray-400 mb-6">Волна: {wave}/3</p>
            <button onClick={() => engine.start()} className="px-8 py-3 bg-red-600 hover:bg-red-500 text-white font-bold rounded-lg text-lg transition-colors font-mono cursor-pointer">🔄 Заново (R)</button>
          </Overlay>
        )}
        {gameState === 'victory' && (
          <Overlay>
            <h2 className="text-4xl font-bold text-green-400 mb-4 font-mono">🏆 Победа!</h2>
            <p className="text-gray-300 mb-2">Все волны пройдены!</p>
            <p className="text-yellow-300 text-xl mb-6 font-bold">Счёт: {score}</p>
            <button onClick={() => engine.start()} className="px-8 py-3 bg-green-600 hover:bg-green-500 text-white font-bold rounded-lg text-lg transition-colors font-mono cursor-pointer">🔄 Играть снова (R)</button>
          </Overlay>
        )}
      </div>
      <div className="mt-4 text-gray-500 text-sm font-mono text-center">
        <p>1 - Огненный шар | 2 - Ледяная стрела | 3 - Молния | Esc/P - Пауза | R - Рестарт</p>
      </div>
    </div>
  );
}

// ============================================================
// ВСПОМОГАТЕЛЬНЫЕ КОМПОНЕНТЫ
// ============================================================

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center rounded-lg backdrop-blur-sm">
      {children}
    </div>
  );
}

function SpellBtn({ label, hotkey, cd, maxCd, cost, mana, onClick, disabled }: {
  label: string; hotkey: string; cd: number; maxCd: number; cost: number; mana: number; onClick: () => void; disabled: boolean;
}) {
  const onCd = cd > 0;
  const noMana = mana < cost;
  const isDisabled = disabled || onCd || noMana;
  return (
    <button onClick={onClick} disabled={isDisabled}
      className={`relative px-3 py-2 rounded-lg font-mono text-xs font-bold transition-all overflow-hidden min-w-[90px]
        ${isDisabled ? 'bg-gray-700/90 text-gray-500 cursor-not-allowed' : 'bg-indigo-700/90 hover:bg-indigo-600 text-white cursor-pointer active:scale-95 shadow-lg shadow-indigo-900/50'}`}>
      {onCd && <div className="absolute inset-0 bg-black/60" style={{ width: `${(cd / maxCd) * 100}%` }} />}
      <span className="relative z-10">
        <span className="block whitespace-nowrap">{label}</span>
        <span className="block text-[10px] opacity-70">[{hotkey}] {cost}💧</span>
      </span>
    </button>
  );
}
