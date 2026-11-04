import { describe, expect, it } from 'vitest';
import { CombatEngine } from '../src/core/CombatEngine';
import { MOVES } from '../src/data/moves';
import { chooseBossSkill } from '../src/core/BossAI';
import { overlap } from '../src/core/geometry';
import type { InputFrame } from '../src/core/types';

const step = (engine: CombatEngine, count: number, input: InputFrame = {}) => { for (let i = 0; i < count; i++) engine.step(input); return engine.snapshot(); };
const close = () => { const e = new CombatEngine({ training: true }); e.debugSetFighter('player', { x: 500 }); e.debugSetFighter('boss', { x: 590 }); return e; };

describe('独立固定步长战斗系统', () => {
  it('起手结束前不命中，有效帧命中一次，长按不自动重复出招', () => {
    const engine = close();
    step(engine, MOVES.light1.startup - 1, { light: true });
    expect(engine.snapshot().boss.hp).toBe(1600);
    engine.step({ light: true });
    expect(engine.snapshot().boss.hp).toBe(1600 - MOVES.light1.damage);
    step(engine, 90, { light: true });
    expect(engine.snapshot().boss.hp).toBe(1600 - MOVES.light1.damage);
    expect(engine.snapshot().player.state).toBe('idle');
  });

  it('普通攻击可在命中后的取消窗口接上第二段', () => {
    const engine = close();
    engine.step({ light: true });
    step(engine, 20);
    expect(engine.snapshot().player.stateFrame).toBeGreaterThanOrEqual(MOVES.light1.cancelFrom);
    engine.step({ light: true });
    expect(engine.snapshot().player.attack).toBe('light2');
    step(engine, 12);
    expect(engine.snapshot().maxCombo).toBe(2);
  });

  it('空挥不开放三段取消，过早输入不会无限缓存', () => {
    const engine = new CombatEngine({ training: true });
    engine.step({ light: true }); step(engine, 13); engine.step({ light: true });
    expect(engine.snapshot().player.attack).toBe('light1');
    step(engine, 50);
    expect(engine.snapshot().player.state).toBe('idle');
  });

  it('缓冲输入跨过短暂收招后自动执行，过期输入丢弃', () => {
    const engine = new CombatEngine({ training: true });
    engine.step({ heavy: true }); step(engine, 48);
    engine.step({ light: true }); step(engine, 8);
    expect(engine.snapshot().player.attack).toBe('light1');
    const early = new CombatEngine({ training: true });
    early.step({ heavy: true }); step(early, 4); early.step({ light: true }); step(early, 70);
    expect(early.snapshot().player.state).toBe('idle');
  });

  it('Hitstop 冻结动作和位移，但不丢失新输入', () => {
    const engine = close(); step(engine, 6, { light: true });
    const before = engine.snapshot();
    expect(before.hitstop).toBeGreaterThan(0);
    engine.step({ right: true }); const after = engine.snapshot();
    expect(after.player.x).toBe(before.player.x);
    expect(after.player.stateFrame).toBe(before.player.stateFrame);
    expect(after.hitstop).toBe(before.hitstop - 1);
  });

  it('暂停冻结时钟、技能、位移和硬直', () => {
    const engine = close(); engine.debugStartSkill('freeKick'); step(engine, 40);
    engine.setPaused(true); const before = engine.snapshot();
    step(engine, 150, { right: true, light: true });
    expect(engine.snapshot()).toEqual(before);
    engine.setPaused(false); engine.step();
    expect(engine.snapshot().frame).toBe(before.frame + 1);
  });

  it('跳跃产生实际垂直位移，落地恢复地面，空中攻击使用独立招式', () => {
    const engine = new CombatEngine({ training: true }); engine.step({ jump: true }); step(engine, 5);
    expect(engine.snapshot().player.y).toBeLessThan(580);
    engine.step({ light: true }); expect(engine.snapshot().player.attack).toBe('aerial');
    step(engine, 80); expect(engine.snapshot().player.y).toBe(580);
  });

  it('闪避存在前摇和结束后的非无敌窗口', () => {
    const engine = close(); engine.step({ dodge: true });
    expect(engine.snapshot().player.invulnerable).toBe(false);
    step(engine, 2); expect(engine.snapshot().player.invulnerable).toBe(true);
    step(engine, 14); expect(engine.snapshot().player.invulnerable).toBe(false);
  });

  it('精准闪避危险物触发一次慢动作和能量奖励', () => {
    const engine = new CombatEngine({ training: true });
    engine.debugStartSkill('freeKick'); step(engine, 53);
    engine.debugSetFighter('player', { x: 740, energy: 0 });
    const result = step(engine, 3, { dodge: true, right: true });
    expect(result.player.hp).toBe(1000);
    expect(result.player.energy).toBe(22);
    expect(result.slowFrames).toBeGreaterThan(0);
    expect(result.events.some(event => event.type === 'perfect')).toBe(true);
  });

  it('正面防御减少伤害，防御削血不计为有效受击', () => {
    const engine = new CombatEngine({ training: true });
    engine.debugStartSkill('freeKick'); step(engine, 53);
    engine.debugSetFighter('player', { x: 800 });
    const result = engine.step({ guard: true });
    expect(result.player.hp).toBe(993);
    expect(result.player.state).toBe('guard');
    expect(result.hitsTaken).toBe(0);
    expect(result.events.some(event => event.type === 'block')).toBe(true);
  });

  it('必杀仅在能量足够时释放，消耗一次并且单次命中', () => {
    const engine = close(); engine.debugSetFighter('player', { energy: 99 }); engine.step({ ultimate: true });
    expect(engine.snapshot().player.state).not.toBe('ultimate');
    engine.step(); engine.debugSetFighter('player', { energy: 100 }); engine.step({ ultimate: true });
    expect(engine.snapshot().player.energy).toBe(0);
    step(engine, 80); expect(engine.snapshot().boss.hp).toBe(1600 - MOVES.ultimate.damage);
  });

  it('技能预警存在且可打断，所有突袭标记在生效前显示', () => {
    const engine = close(); engine.debugStartSkill('roster'); engine.step();
    const markers = engine.snapshot().hazards;
    expect(markers).toHaveLength(3); expect(markers.every(mark => mark.warning > mark.age)).toBe(true);
    engine.step({ light: true }); step(engine, 6);
    expect(engine.snapshot().bossSkill).toBe(''); expect(engine.snapshot().hazards).toHaveLength(0);
  });

  it('红包可被攻击拦截，抵达记分牌后才强化 Boss', () => {
    const engine = new CombatEngine({ training: true }); engine.debugSetFighter('boss', { x: 800 });
    engine.debugStartSkill('bribe'); step(engine, 31);
    const envelope = engine.snapshot().hazards.find(item => item.kind === 'envelope')!;
    expect(envelope).toBeTruthy();
    engine.debugSetFighter('player', { x: envelope.x - 70 });
    engine.step({ light: true }); const intercepted = step(engine, 8);
    expect(intercepted.hazards.some(item => item.kind === 'envelope')).toBe(false);
    expect(intercepted.boss.buffFrames).toBe(0);
    const missed = new CombatEngine({ training: true }); missed.debugStartSkill('bribe'); step(missed, 206);
    expect(missed.snapshot().boss.buffFrames).toBeGreaterThan(0);
  });

  it('AI 有冷却、资源门槛和低血量大招决策', () => {
    const state = new CombatEngine().snapshot(); state.boss.energy = 100; state.boss.hp = 500;
    expect(chooseBossSkill({ ...state, cooldowns: {}, random: () => 0 })).toBe('match');
    expect(chooseBossSkill({ ...state, cooldowns: { freeKick: 1, bribe: 1, roster: 1, match: 1 }, random: () => 0 })).toBe(null);
    state.boss.energy = 0;
    expect(chooseBossSkill({ ...state, cooldowns: {}, random: () => 0 })).not.toBe('match');
  });

  it('默契球释放三种高度/弹道，预警后才能伤害并最终进入反击窗口', () => {
    const engine = new CombatEngine({ training: true }); engine.debugStartSkill('match');
    const balls = new Map<number, { y: number; vy: number; warning: number }>();
    for (let i = 0; i < 360; i++) {
      engine.debugSetFighter('player', { x: 72, y: 200, vy: 0 });
      for (const hazard of engine.step().hazards) {
        if (hazard.kind === 'ball' && !balls.has(hazard.id)) balls.set(hazard.id, hazard);
      }
    }
    expect(balls.size).toBe(3);
    expect([...balls.values()].every(ball => ball.warning >= 36)).toBe(true);
    expect(new Set([...balls.values()].map(ball => ball.y)).size).toBe(3);
    expect([...balls.values()].some(ball => ball.vy < 0)).toBe(true);
    expect(engine.snapshot().bossSkill).toBe('');
    expect(engine.snapshot().boss.state).toBe('idle');
  });

  it('180 秒超时失败，暂停时间不进入倒计时', () => {
    const engine = new CombatEngine();
    engine.debugSetFighter('player', { hp: 100000, maxHp: 100000 });
    step(engine, 60); engine.setPaused(true); step(engine, 600); engine.setPaused(false);
    expect(engine.snapshot().remaining).toBe(179);
    step(engine, 180 * 60 - 60);
    expect(engine.snapshot().remaining).toBe(0);
    expect(engine.snapshot().result).toBe('lose');
  });

  it('同一种子和输入得到相同结果，快照不能篡改内部状态', () => {
    const a = new CombatEngine({ seed: 123 }); const b = new CombatEngine({ seed: 123 });
    for (let i = 0; i < 1200; i++) {
      const input = { right: i < 60, left: i > 500 && i < 550, light: i % 24 === 0, dodge: i % 90 === 0 };
      a.step(input); b.step(input);
    }
    expect(a.snapshot()).toEqual(b.snapshot());
    const snapshot = a.snapshot(); snapshot.player.hp = -100;
    expect(a.snapshot().player.hp).toBeGreaterThanOrEqual(0);
  });

  it('胜负结算后状态冻结，重开清空记录并恢复初始角色', () => {
    const engine = close(); engine.debugSetFighter('boss', { hp: 1 }); step(engine, 7, { light: true });
    expect(engine.snapshot().result).toBe('win'); const frame = engine.snapshot().frame;
    step(engine, 100); expect(engine.snapshot().frame).toBe(frame);
    engine.reset(); expect(engine.snapshot().result).toBe(null); expect(engine.snapshot().boss.hp).toBe(1600);
  });

  it('调试修改重击伤害和范围后，实际命中使用新数值', () => {
    const original = new CombatEngine({ training: true });
    original.debugSetFighter('player', { x: 500 }); original.debugSetFighter('boss', { x: 800 });
    step(original, MOVES.heavy.startup + MOVES.heavy.active, { heavy: true });
    expect(original.snapshot().boss.hp).toBe(1600);

    const modified = new CombatEngine({ training: true });
    modified.debugSetFighter('player', { x: 500 }); modified.debugSetFighter('boss', { x: 800 });
    modified.updateMove('heavy', { damage: 500, range: 400 });
    const result = step(modified, MOVES.heavy.startup, { heavy: true });
    expect(result.boss.hp).toBe(1100);
    expect(result.events.find(event => event.type === 'hit')?.amount).toBe(500);
    expect(result.hitboxes[0].w).toBe(400);

    const shortened = close(); shortened.updateMove('heavy', { range: 20 });
    step(shortened, MOVES.heavy.startup + MOVES.heavy.active, { heavy: true });
    expect(shortened.snapshot().boss.hp).toBe(1600);
  });

  it('调试参数限制上下界、取整，忽略非有限值和未知招式', () => {
    const engine = new CombatEngine({ training: true });
    engine.updateMove('heavy', { startup: -20, active: 0, recovery: 900, damage: -10, range: 9999 });
    expect(engine.getMoveData().heavy).toMatchObject({ startup: 0, active: 1, recovery: 500, damage: 0, range: 800 });
    engine.updateMove('heavy', { startup: 6.4, active: 3.7, recovery: 14.5, damage: 999, range: -1 });
    expect(engine.getMoveData().heavy).toMatchObject({ startup: 6, active: 4, recovery: 15, damage: 500, range: 0 });
    const before = engine.getMoveData();
    engine.updateMove('heavy', { damage: Number.NaN, range: Number.POSITIVE_INFINITY, recovery: Number.NEGATIVE_INFINITY });
    engine.updateMove('不存在的招式', { damage: 50 });
    expect(engine.getMoveData()).toEqual(before);
  });

  it('判定框只在有效帧出现且身体碰撞与受击框分离', () => {
    const engine = close(); engine.step({ heavy: true }); expect(engine.snapshot().hitboxes).toHaveLength(0);
    step(engine, 17); expect(engine.snapshot().hitboxes).toHaveLength(1);
    const state = engine.snapshot(); expect(state.hurtboxes[0].h).toBeGreaterThan(state.bodies[0].h);
    expect(overlap(state.bodies[0], state.bodies[1])).toBe(false);
  });
});
