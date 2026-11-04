import type { Fighter, Hazard, CombatEvent } from './types';
import { clamp, GROUND } from './geometry';

export interface SkillContext {
  player: Fighter;
  boss: Fighter;
  spawn(hazard: Omit<Hazard, 'id' | 'age'>): void;
  emit(event: CombatEvent): void;
  setHint(hint: string): void;
}
export interface SkillExecution { id: string; frame: number; direction: 1 | -1; targets: number[] }
export type SkillHandler = (context: SkillContext, execution: SkillExecution) => void;

const ball = (context: SkillContext, execution: SkillExecution, y: number, vy: number, empowered = false, warning = 20) => {
  context.spawn({ kind: 'ball', x: context.boss.x + execution.direction * 58, y, vx: execution.direction * (empowered ? 9 : 7.2), vy, radius: empowered ? 26 : 19, life: 260, warning, empowered, bounces: vy ? 1 : 0, gravity: vy ? 0.15 : 0 });
};

// 每项技能拥有独立执行器，新增 Boss 时复用调度器与碰撞系统。
export const SKILL_HANDLERS: Record<string, SkillHandler> = {
  freeKick(context, execution) {
    if (execution.frame === 34) ball(context, execution, GROUND - 30, -3.8);
    if (execution.frame === 64) ball(context, execution, GROUND - 112, 0, false, 16);
  },
  bribe(context, execution) {
    if (execution.frame !== 30) return;
    const x = context.boss.x + execution.direction * 54;
    const y = GROUND - 92;
    context.spawn({ kind: 'envelope', x, y, vx: (1120 - x) / 175, vy: (125 - y) / 175, radius: 24, life: 200, warning: 0 });
  },
  roster(context, execution) {
    if (execution.frame === 1) {
      execution.targets.forEach((x, index) => context.spawn({ kind: 'mark', x, y: GROUND, vx: 0, vy: 0, radius: 62, life: 49 + index * 30, warning: 42 + index * 30 }));
    }
    [42, 72, 102].forEach((frame, index) => {
      if (execution.frame >= frame && execution.frame < frame + 7) {
        const target = clamp(execution.targets[index] + execution.direction * 80, 100, 1180);
        context.boss.x += clamp(target - context.boss.x, -55, 55);
      }
      if (execution.frame === frame) context.emit({ type: 'attack', actor: 'boss', x: execution.targets[index], y: GROUND - 72, text: '突袭' });
    });
    if (execution.frame === 110) context.setHint('突袭结束 · 现在是反击窗口');
  },
  match(context, execution) {
    if (execution.frame === 24) {
      context.setHint('第一球 · 高位弹道，留在地面');
      ball(context, execution, GROUND - 177, 0, true, 40);
    }
    if (execution.frame === 96) {
      context.setHint('第二球 · 低位弹道，跳跃避开');
      ball(context, execution, GROUND - 26, 0, true, 36);
    }
    if (execution.frame === 168) {
      context.setHint('第三球 · 弹跳球，把握闪避时机');
      ball(context, execution, GROUND - 32, -5.2, true, 36);
    }
    if (execution.frame === 220) context.setHint('大招结束 · 靠近后使用重攻击');
  },
};
