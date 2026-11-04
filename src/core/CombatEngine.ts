import { BOSS_SKILLS, CHARACTER_REGISTRY, MOVES } from '../data/moves';
import { chooseBossSkill } from './BossAI';
import { ARENA_LEFT, ARENA_RIGHT, GROUND, bodyBox, circleBox, clamp, hurtBox, overlap } from './geometry';
import { SKILL_HANDLERS, type SkillExecution } from './SkillSystem';
import type { Action, CombatEvent, CombatSnapshot, Fighter, FighterState, Hazard, InputFrame, MoveData, Rect } from './types';

const ACTIONS: Action[] = ['ultimate', 'dodge', 'heavy', 'light', 'jump'];
const NEUTRAL = new Set<FighterState>(['idle', 'run', 'jump', 'guard']);
const createFighter = (id: 'player' | 'boss'): Fighter => ({
  id, x: id === 'player' ? 360 : 900, y: GROUND, vx: 0, vy: 0, facing: id === 'player' ? 1 : -1,
  hp: id === 'player' ? CHARACTER_REGISTRY.civilian.maxHp : CHARACTER_REGISTRY.litie.maxHp,
  maxHp: id === 'player' ? CHARACTER_REGISTRY.civilian.maxHp : CHARACTER_REGISTRY.litie.maxHp,
  energy: 0, state: 'idle', stateFrame: 0, attack: null, comboStep: 0, invulnerable: false, buffFrames: 0,
});

export class CombatEngine {
  private player = createFighter('player');
  private boss = createFighter('boss');
  private frame = 0;
  private simulationFrame = 0;
  private hazards: Hazard[] = [];
  private events: CombatEvent[] = [];
  private previous: InputFrame = {};
  private buffer: { action: Action; expires: number }[] = [];
  private paused = false;
  private result: 'win' | 'lose' | null = null;
  private hitstop = 0;
  private slowFrames = 0;
  private combo = 0;
  private maxCombo = 0;
  private hitsTaken = 0;
  private lastHit = -999;
  private attackHit = { player: false, boss: false };
  private hitstun = { player: 0, boss: 0 };
  private protection = { player: 0, boss: 0 };
  private dodgeCooldown = 0;
  private perfectAwarded = false;
  private nextHazard = 1;
  private skill: SkillExecution | null = null;
  private bossSkill = '';
  private bossHint = '拉近距离，以三段连击积攒能量';
  private cooldowns: Record<string, number> = {};
  private aiDelay = 110;
  private rng = 1;
  private moves: Record<string, MoveData> = structuredClone(MOVES);
  private options: { training?: boolean; seed?: number };

  constructor(options: { training?: boolean; seed?: number } = {}) {
    this.options = options;
    this.reset();
  }

  reset() {
    this.player = createFighter('player');
    this.boss = createFighter('boss');
    this.frame = 0; this.simulationFrame = 0; this.hazards = []; this.events = [];
    this.previous = {}; this.buffer = []; this.paused = false; this.result = null;
    this.hitstop = 0; this.slowFrames = 0; this.combo = 0; this.maxCombo = 0; this.hitsTaken = 0;
    this.lastHit = -999; this.attackHit = { player: false, boss: false }; this.hitstun = { player: 0, boss: 0 };
    this.protection = { player: 0, boss: 0 }; this.dodgeCooldown = 0; this.perfectAwarded = false;
    this.nextHazard = 1; this.skill = null; this.bossSkill = ''; this.bossHint = '拉近距离，以三段连击积攒能量';
    this.cooldowns = {}; this.aiDelay = 110; this.rng = this.options.seed || 0x6a09e667;
    if (this.options.training) this.player.energy = 100;
  }

  setPaused(paused: boolean) { this.paused = paused; this.events = []; }

  // 调试入口不依赖渲染；正式输入通路不会调用这些方法。
  debugSetFighter(id: 'player' | 'boss', patch: Partial<Fighter>) { Object.assign(id === 'player' ? this.player : this.boss, patch); }
  debugStartSkill(id: string) { if (BOSS_SKILLS[id]) this.startBossSkill(id); }
  getMoveData(): Record<string, MoveData> { return structuredClone(this.moves); }
  updateMove(id: string, patch: Partial<Pick<MoveData, 'startup' | 'active' | 'recovery' | 'damage' | 'range'>>) {
    const move = this.moves[id];
    if (!move) return;
    for (const key of ['startup', 'active', 'recovery', 'damage', 'range'] as const) {
      const value = patch[key];
      if (typeof value === 'number' && Number.isFinite(value)) move[key] = clamp(Math.round(value), key === 'active' ? 1 : 0, key === 'range' ? 800 : 500);
    }
  }

  snapshot(): CombatSnapshot {
    return {
      frame: this.frame, time: this.frame / 60, remaining: Math.max(0, 180 - this.frame / 60),
      player: { ...this.player }, boss: { ...this.boss }, hazards: this.hazards.map(item => ({ ...item })), events: this.events.map(item => ({ ...item })),
      combo: this.combo, maxCombo: this.maxCombo, hitsTaken: this.hitsTaken, hitstop: this.hitstop, slowFrames: this.slowFrames,
      paused: this.paused, result: this.result, bossSkill: this.bossSkill, bossHint: this.bossHint,
      hitboxes: [this.attackBox(this.player), this.attackBox(this.boss)].filter((box): box is Rect => box !== null),
      hurtboxes: [hurtBox(this.player), hurtBox(this.boss)], bodies: [bodyBox(this.player), bodyBox(this.boss)],
    };
  }

  step(input: InputFrame = {}): CombatSnapshot {
    this.events = [];
    if (this.paused || this.result) return this.snapshot();
    this.frame++;
    for (const action of [...ACTIONS].reverse()) {
      if (input[action] && !this.previous[action]) this.buffer.push({ action, expires: this.frame + 8 });
    }
    this.previous = { ...input };
    this.buffer = this.buffer.filter(item => item.expires >= this.frame).slice(-6);
    if (this.frame >= 180 * 60 && !this.options.training) { this.finish('lose'); return this.snapshot(); }
    if (this.hitstop > 0) { this.hitstop--; return this.snapshot(); }
    if (this.slowFrames > 0) {
      this.slowFrames--;
      if (this.slowFrames % 2 === 0) return this.snapshot();
    }
    this.simulationFrame++;
    for (const key of Object.keys(this.cooldowns)) this.cooldowns[key] = Math.max(0, this.cooldowns[key] - 1);
    this.dodgeCooldown = Math.max(0, this.dodgeCooldown - 1);
    for (const fighter of [this.player, this.boss]) {
      fighter.buffFrames = Math.max(0, fighter.buffFrames - 1);
      this.protection[fighter.id] = Math.max(0, this.protection[fighter.id] - 1);
    }
    if (this.simulationFrame - this.lastHit > 90) this.combo = 0;
    this.controlPlayer(input);
    this.controlBoss();
    this.advanceFighter(this.player);
    this.advanceFighter(this.boss);
    this.separateBodies();
    this.executeSkill();
    this.resolveAttack(this.player, this.boss);
    this.resolveAttack(this.boss, this.player);
    this.advanceHazards();
    if (this.player.hp <= 0) this.finish('lose');
    else if (this.boss.hp <= 0) this.finish('win');
    return this.snapshot();
  }

  private random = () => {
    this.rng ^= this.rng << 13; this.rng ^= this.rng >>> 17; this.rng ^= this.rng << 5;
    return (this.rng >>> 0) / 0x100000000;
  };
  private emit = (event: CombatEvent) => { this.events.push(event); };
  private spawn = (hazard: Omit<Hazard, 'id' | 'age'>) => { this.hazards.push({ ...hazard, age: 0, id: this.nextHazard++ }); };
  private setState(fighter: Fighter, state: FighterState) {
    if (fighter.state === state) return;
    fighter.state = state; fighter.stateFrame = 0;
    if (!['light', 'heavy', 'ultimate'].includes(state)) fighter.attack = null;
  }

  private controlPlayer(input: InputFrame) {
    const fighter = this.player;
    const move = fighter.attack ? this.moves[fighter.attack] : null;
    const canCancel = move && this.attackHit.player && fighter.stateFrame >= move.cancelFrom && fighter.stateFrame <= move.cancelTo;
    for (let index = this.buffer.length - 1; index >= 0; index--) {
      const action = this.buffer[index].action;
      const neutral = NEUTRAL.has(fighter.state);
      if (action === 'light' && (neutral || (canCancel && fighter.comboStep < 3))) {
        const next = fighter.y < GROUND ? 'aerial' : canCancel ? `light${fighter.comboStep + 1}` : 'light1';
        this.beginAttack(fighter, next); this.buffer.splice(index, 1); break;
      }
      if (action === 'heavy' && (neutral || canCancel)) {
        this.beginAttack(fighter, fighter.y < GROUND ? 'aerial' : 'heavy'); this.buffer.splice(index, 1); break;
      }
      if (action === 'ultimate' && (neutral || canCancel) && fighter.energy >= 100) {
        fighter.energy -= 100; this.beginAttack(fighter, 'ultimate'); this.buffer.splice(index, 1); break;
      }
      if (action === 'dodge' && (neutral || canCancel) && this.dodgeCooldown === 0 && fighter.y >= GROUND) {
        this.setState(fighter, 'dodge'); fighter.facing = input.left ? -1 : input.right ? 1 : fighter.facing;
        fighter.vx = fighter.facing * 13; this.dodgeCooldown = 44; this.perfectAwarded = false;
        this.emit({ type: 'dodge', actor: 'player', x: fighter.x, y: fighter.y - 70 });
        this.buffer.splice(index, 1); break;
      }
      if (action === 'jump' && neutral && fighter.y >= GROUND) {
        this.setState(fighter, 'jump'); fighter.vy = CHARACTER_REGISTRY.civilian.jumpVelocity;
        this.buffer.splice(index, 1); break;
      }
    }
    if (!NEUTRAL.has(fighter.state)) return;
    const axis = Number(!!input.right) - Number(!!input.left);
    if (input.guard && fighter.y >= GROUND) {
      this.setState(fighter, 'guard'); fighter.vx = 0;
    } else {
      fighter.vx = axis * CHARACTER_REGISTRY.civilian.speed;
      this.setState(fighter, fighter.y < GROUND || fighter.vy < 0 ? 'jump' : axis ? 'run' : 'idle');
    }
    if (Math.abs(this.boss.x - fighter.x) > 2) fighter.facing = this.boss.x > fighter.x ? 1 : -1;
  }

  private controlBoss() {
    const boss = this.boss;
    boss.energy = clamp(boss.energy + 0.045, 0, 100);
    if (this.options.training || !NEUTRAL.has(boss.state)) return;
    boss.facing = this.player.x > boss.x ? 1 : -1;
    this.aiDelay--;
    if (this.aiDelay <= 0) {
      const skill = chooseBossSkill({ player: this.player, boss, cooldowns: this.cooldowns, random: this.random });
      if (skill) { this.startBossSkill(skill); return; }
      if (Math.abs(this.player.x - boss.x) < 145 && !(this.cooldowns.bossKick > 0)) {
        this.beginAttack(boss, 'bossKick'); this.cooldowns.bossKick = 100; this.aiDelay = 35; return;
      }
      this.aiDelay = 24;
    }
    const distance = Math.abs(this.player.x - boss.x);
    boss.vx = distance > 460 ? boss.facing * 2.3 : distance < 220 ? -boss.facing * 1.8 : 0;
    this.setState(boss, boss.vx ? 'run' : 'idle');
  }

  private beginAttack(fighter: Fighter, id: string) {
    const move = this.moves[id];
    fighter.state = id === 'ultimate' ? 'ultimate' : id === 'heavy' || id === 'bossKick' ? 'heavy' : 'light';
    fighter.stateFrame = 0; fighter.attack = id; fighter.vx = 0;
    fighter.comboStep = id.startsWith('light') ? Number(id.slice(-1)) : 0;
    this.attackHit[fighter.id] = false;
    fighter.facing = (fighter.id === 'player' ? this.boss.x : this.player.x) > fighter.x ? 1 : -1;
    this.emit({ type: id === 'ultimate' ? 'ultimate' : 'attack', actor: fighter.id, x: fighter.x, y: fighter.y - 80, text: move.name });
  }

  private advanceFighter(fighter: Fighter) {
    fighter.stateFrame++;
    if (fighter.attack) {
      const move = this.moves[fighter.attack];
      if (fighter.stateFrame === move.startup && fighter.id === 'player') fighter.vx = fighter.facing * (fighter.attack === 'ultimate' ? 10 : 3);
      if (fighter.stateFrame >= move.startup + move.active + move.recovery) this.setState(fighter, fighter.y < GROUND ? 'jump' : 'idle');
    } else if (fighter.state === 'dodge' && fighter.stateFrame >= 25) this.setState(fighter, 'idle');
    else if (fighter.state === 'hit' && fighter.stateFrame >= this.hitstun[fighter.id]) {
      this.setState(fighter, fighter.y < GROUND ? 'jump' : 'idle');
      if (fighter.id === 'boss') this.combo = 0;
    }
    else if (fighter.state === 'down' && fighter.stateFrame >= Math.max(20, this.hitstun[fighter.id] - 16)) this.setState(fighter, 'rise');
    else if (fighter.state === 'rise' && fighter.stateFrame >= 18) {
      this.setState(fighter, 'idle');
      if (fighter.id === 'boss') this.combo = 0;
    }
    else if (fighter.state === 'land' && fighter.stateFrame >= 5) this.setState(fighter, 'idle');
    fighter.invulnerable = this.protection[fighter.id] > 0 || fighter.state === 'rise' || fighter.state === 'dodge' && fighter.stateFrame >= 3 && fighter.stateFrame <= 16 || fighter.id === 'player' && fighter.state === 'ultimate' && fighter.stateFrame <= 42;
    fighter.x = clamp(fighter.x + fighter.vx, ARENA_LEFT, ARENA_RIGHT);
    if (!['run', 'dodge', 'jump'].includes(fighter.state)) fighter.vx *= 0.78;
    if (fighter.y < GROUND || fighter.vy < 0) {
      fighter.y += fighter.vy; fighter.vy += 0.75;
      if (fighter.y >= GROUND) {
        fighter.y = GROUND; fighter.vy = 0;
        this.emit({ type: 'land', actor: fighter.id, x: fighter.x, y: GROUND });
        if (fighter.state === 'jump') this.setState(fighter, 'land');
      }
    }
  }

  private separateBodies() {
    if (this.player.state === 'dodge' || this.boss.state === 'dodge') return;
    const a = bodyBox(this.player); const b = bodyBox(this.boss);
    if (!overlap(a, b)) return;
    const direction = this.player.x < this.boss.x ? -1 : 1;
    const separation = (52 - Math.abs(this.player.x - this.boss.x)) / 2;
    this.player.x = clamp(this.player.x + separation * direction, ARENA_LEFT, ARENA_RIGHT);
    this.boss.x = clamp(this.boss.x - separation * direction, ARENA_LEFT, ARENA_RIGHT);
    // 墙边一方无法后退时，剩余推开距离由另一方承担。
    const remaining = Math.max(0, 52 - Math.abs(this.player.x - this.boss.x));
    if (remaining > 0) {
      if (this.player.x === ARENA_LEFT || this.player.x === ARENA_RIGHT) this.boss.x = clamp(this.boss.x - remaining * direction, ARENA_LEFT, ARENA_RIGHT);
      else this.player.x = clamp(this.player.x + remaining * direction, ARENA_LEFT, ARENA_RIGHT);
    }
  }

  private attackBox(fighter: Fighter): Rect | null {
    if (!fighter.attack) return null;
    const move = this.moves[fighter.attack];
    if (fighter.stateFrame < move.startup || fighter.stateFrame >= move.startup + move.active) return null;
    return { x: fighter.facing > 0 ? fighter.x : fighter.x - move.range, y: fighter.y - 124, w: move.range, h: move.height };
  }

  private resolveAttack(attacker: Fighter, target: Fighter) {
    const box = this.attackBox(attacker);
    if (!box || !attacker.attack) return;
    if (attacker.id === 'player') {
      this.hazards = this.hazards.filter(hazard => {
        if (hazard.kind !== 'envelope' || !overlap(box, circleBox(hazard.x, hazard.y, hazard.radius))) return true;
        this.player.energy = clamp(this.player.energy + 18, 0, 100);
        this.emit({ type: 'intercept', actor: 'player', x: hazard.x, y: hazard.y, text: '强化已拦截' });
        this.bossHint = '红包拦截成功 · 获得 18 能量';
        this.hitstop = 5;
        return false;
      });
    }
    if (this.attackHit[attacker.id] || !overlap(box, hurtBox(target))) return;
    const move = this.moves[attacker.attack];
    const accepted = this.damage(target, move.damage, attacker.x, move.knockback, move.hitstun, attacker.id);
    if (accepted) {
      this.attackHit[attacker.id] = true;
      if (attacker.id === 'player') attacker.energy = clamp(attacker.energy + move.energy, 0, 100);
    }
  }

  private damage(target: Fighter, amount: number, sourceX: number, knockback: number, stun: number, actor: 'player' | 'boss'): boolean {
    if (target.invulnerable) {
      if (target.id === 'player' && target.state === 'dodge' && target.stateFrame <= 9 && !this.perfectAwarded) {
        this.perfectAwarded = true; this.slowFrames = 32; target.energy = clamp(target.energy + 22, 0, 100);
        this.emit({ type: 'perfect', actor: 'player', x: target.x, y: target.y - 96, text: '精准闪避 +22' });
      }
      return false;
    }
    const guarded = target.state === 'guard' && (sourceX - target.x) * target.facing >= 0;
    const buffed = actor === 'boss' && this.boss.buffFrames > 0 ? amount * 1.35 : amount;
    const damage = Math.round(buffed * (guarded ? 0.12 : 1));
    target.hp = Math.max(0, target.hp - damage);
    target.vx = (sourceX < target.x ? 1 : -1) * knockback * (guarded ? 0.3 : 1);
    this.emit({ type: guarded ? 'block' : 'hit', actor, x: target.x, y: target.y - 88, amount: damage });
    this.hitstop = guarded ? 3 : amount >= 100 ? 9 : 6;
    if (!guarded) {
      this.setState(target, stun >= 36 || amount >= 90 ? 'down' : 'hit'); this.hitstun[target.id] = stun; this.protection[target.id] = 8;
      target.invulnerable = true;
      if (target.id === 'boss') {
        this.combo++; this.maxCombo = Math.max(this.combo, this.maxCombo); this.lastHit = this.simulationFrame;
        this.boss.energy = clamp(this.boss.energy + 5, 0, 100);
        if (this.skill) {
          this.skill = null; this.bossSkill = ''; this.bossHint = '施法已打断 · 连击追击'; this.aiDelay = 42;
          this.hazards = this.hazards.filter(hazard => hazard.kind !== 'mark' || hazard.age >= hazard.warning);
        }
      } else { this.hitsTaken++; this.combo = 0; }
    }
    return true;
  }

  private startBossSkill(id: string) {
    const data = BOSS_SKILLS[id];
    const direction: 1 | -1 = this.player.x > this.boss.x ? 1 : -1;
    this.boss.state = id === 'match' ? 'ultimate' : 'skill'; this.boss.stateFrame = 0;
    this.boss.attack = null; this.boss.vx = 0; this.boss.facing = direction;
    this.boss.energy = Math.max(0, this.boss.energy - data.cost);
    this.cooldowns[id] = data.cooldown; this.aiDelay = 38;
    this.skill = { id, frame: 0, direction, targets: [-125, 0, 125].map(offset => clamp(this.player.x + offset, 140, 1140)) };
    this.bossSkill = data.name; this.bossHint = data.hint;
    this.emit({ type: id === 'match' ? 'ultimate' : 'skill', actor: 'boss', x: this.boss.x, y: this.boss.y - 96, text: data.name });
  }

  private executeSkill() {
    if (!this.skill) return;
    this.skill.frame++;
    SKILL_HANDLERS[this.skill.id]?.({ player: this.player, boss: this.boss, spawn: this.spawn, emit: this.emit, setHint: hint => { this.bossHint = hint; } }, this.skill);
    if (this.skill.frame >= BOSS_SKILLS[this.skill.id].duration) {
      this.skill = null; this.setState(this.boss, 'idle'); this.bossSkill = ''; this.bossHint = '收招破绽 · 靠近后反击';
    }
  }

  private advanceHazards() {
    for (const hazard of this.hazards) {
      hazard.age++;
      if (hazard.age < hazard.warning || hazard.hit) continue;
      if (hazard.kind === 'envelope') {
        hazard.x += hazard.vx; hazard.y += hazard.vy;
        if (hazard.age >= 175) {
          hazard.hit = true; this.boss.buffFrames = 360;
          this.bossHint = '强化生效 6 秒 · 注意足球伤害';
          this.emit({ type: 'skill', actor: 'boss', x: 1120, y: 125, text: '攻击强化' });
        }
        continue;
      }
      if (hazard.kind === 'ball' || hazard.kind === 'wave') {
        hazard.x += hazard.vx; hazard.y += hazard.vy;
        if (hazard.gravity) {
          hazard.vy += hazard.gravity;
          if (hazard.y + hazard.radius >= GROUND && hazard.vy > 0 && (hazard.bounces || 0) > 0) {
            hazard.y = GROUND - hazard.radius; hazard.vy = -Math.abs(hazard.vy) * 0.82;
            hazard.bounces = (hazard.bounces || 0) - 1;
          }
        }
        if (hazard.x < -60 || hazard.x > 1340 || hazard.y > 780) { hazard.hit = true; continue; }
      }
      const box = hazard.kind === 'mark' ? { x: hazard.x - hazard.radius, y: GROUND - 150, w: hazard.radius * 2, h: 150 } : circleBox(hazard.x, hazard.y, hazard.radius);
      if (overlap(box, hurtBox(this.player))) {
        const accepted = this.damage(this.player, hazard.kind === 'mark' ? 72 : hazard.empowered ? 95 : 62, hazard.kind === 'mark' ? this.boss.x : hazard.x, 8, 28, 'boss');
        if (accepted || this.player.state === 'dodge') hazard.hit = true;
      }
    }
    this.hazards = this.hazards.filter(hazard => !hazard.hit && hazard.age < hazard.life);
  }

  private finish(result: 'win' | 'lose') {
    this.result = result; this.skill = null; this.hazards = []; this.buffer = [];
    this.setState(this.player, result === 'win' ? 'victory' : 'defeat');
    this.setState(this.boss, result === 'win' ? 'defeat' : 'victory');
    this.emit({ type: 'end', actor: 'player', x: this.player.x, y: this.player.y, text: result === 'win' ? '挑战成功' : '挑战失败' });
  }
}
