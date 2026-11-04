import { describe, expect, it } from 'vitest';
import { fighterFrame } from '../src/render/AnimationController';
import { MOVES } from '../src/data/moves';
import type { Fighter } from '../src/core/types';

const fighter = (patch: Partial<Fighter> = {}): Fighter => ({
  id: 'player', x: 360, y: 580, vx: 0, vy: 0, facing: 1, hp: 1000, maxHp: 1000,
  energy: 0, state: 'heavy', stateFrame: 0, attack: 'heavy', comboStep: 0, invulnerable: false, buffFrames: 0,
  ...patch,
});

describe('动画与逻辑帧同步', () => {
  it('重击姿态在有效帧开始时切换，结束时收招', () => {
    const move = MOVES.heavy;
    expect(fighterFrame(fighter({ stateFrame: move.startup - 1 }), move)).toBe(15);
    expect(fighterFrame(fighter({ stateFrame: move.startup }), move)).toBe(16);
    expect(fighterFrame(fighter({ stateFrame: move.startup + move.active }), move)).toBe(17);
  });
  it('调试修改起手帧后，视觉姿态跟随同一份数据', () => {
    const move = { ...MOVES.heavy, startup: 30 };
    expect(fighterFrame(fighter({ stateFrame: 29 }), move)).toBe(15);
    expect(fighterFrame(fighter({ stateFrame: 30 }), move)).toBe(16);
  });
  it('不同 Boss 技能选择独立姿态', () => {
    const boss = fighter({ id: 'boss', state: 'skill', stateFrame: 32, attack: null });
    expect(fighterFrame(boss, undefined, '行贿上位')).toBe(20);
    expect(fighterFrame(boss, undefined, '任意球')).toBe(21);
  });
});
