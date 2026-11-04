import type { MoveData } from '../core/types';

// 帧数以 60 Hz 为基准；取消窗口只对命中过目标的普通攻击开放。
export const MOVES: Record<string, MoveData> = {
  light1: { id: 'light1', name: '直拳', startup: 6, active: 4, recovery: 18, damage: 42, range: 100, height: 88, knockback: 3.2, hitstun: 22, energy: 8, cancelFrom: 12, cancelTo: 24, cooldown: 0, cost: 0 },
  light2: { id: 'light2', name: '追身肘', startup: 7, active: 5, recovery: 19, damage: 52, range: 116, height: 94, knockback: 4, hitstun: 24, energy: 10, cancelFrom: 13, cancelTo: 27, cooldown: 0, cost: 0 },
  light3: { id: 'light3', name: '回旋踢', startup: 10, active: 6, recovery: 26, damage: 78, range: 148, height: 112, knockback: 10, hitstun: 32, energy: 14, cancelFrom: 20, cancelTo: 27, cooldown: 0, cost: 0 },
  heavy: { id: 'heavy', name: '破阵重击', startup: 18, active: 6, recovery: 30, damage: 118, range: 156, height: 132, knockback: 13, hitstun: 36, energy: 17, cancelFrom: 0, cancelTo: 0, cooldown: 0, cost: 0 },
  aerial: { id: 'aerial', name: '凌空踢', startup: 7, active: 9, recovery: 17, damage: 60, range: 118, height: 120, knockback: 6, hitstun: 26, energy: 10, cancelFrom: 0, cancelTo: 0, cooldown: 0, cost: 0 },
  ultimate: { id: 'ultimate', name: '平凡之怒', startup: 26, active: 14, recovery: 36, damage: 310, range: 460, height: 240, knockback: 20, hitstun: 54, energy: 0, cancelFrom: 0, cancelTo: 0, cooldown: 0, cost: 100 },
  bossKick: { id: 'bossKick', name: '低位抽射', startup: 24, active: 5, recovery: 35, damage: 65, range: 130, height: 100, knockback: 7, hitstun: 25, energy: 0, cancelFrom: 0, cancelTo: 0, cooldown: 90, cost: 0 },
};

export const CHARACTER_REGISTRY = {
  civilian: { name: '路人甲', maxHp: 1000, speed: 5.6, jumpVelocity: -16, bodyWidth: 52, hurtHeight: 144, moves: ['light1', 'light2', 'light3', 'heavy', 'aerial', 'ultimate'] },
  litie: { name: '李铁', maxHp: 1600, speed: 2.3, jumpVelocity: -14, bodyWidth: 56, hurtHeight: 148, moves: ['bossKick'] },
} as const;

export interface BossSkillData { id: string; name: string; hint: string; duration: number; cooldown: number; cost: number }
export const BOSS_SKILLS: Record<string, BossSkillData> = {
  freeKick: { id: 'freeKick', name: '任意球', hint: '观察足球高度，跳跃或闪避穿过弹道', duration: 124, cooldown: 230, cost: 0 },
  bribe: { id: 'bribe', name: '行贿上位', hint: '击中飞向记分牌的红包，阻止攻击强化', duration: 98, cooldown: 620, cost: 0 },
  roster: { id: 'roster', name: '名单内定', hint: '离开地面红色标记；最后一击后可反击', duration: 172, cooldown: 420, cost: 0 },
  match: { id: 'match', name: '默契球', hint: '三段强化球：低身等待 → 跳跃 → 闪避', duration: 268, cooldown: 1000, cost: 60 },
};

export const BOSS_REGISTRY = {
  litie: { character: 'litie', stage: 'stadium', skills: ['freeKick', 'bribe', 'roster', 'match'] },
} as const;
