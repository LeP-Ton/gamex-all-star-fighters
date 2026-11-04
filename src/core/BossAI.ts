import { BOSS_SKILLS } from '../data/moves';
import type { Fighter } from './types';

export interface AIContext { player: Fighter; boss: Fighter; cooldowns: Record<string, number>; random(): number }

// 只观察当前坐标、血量和资源；不接收玩家输入，也不推测未来按键。
export function chooseBossSkill(context: AIContext): string | null {
  const { player, boss, cooldowns } = context;
  const distance = Math.abs(player.x - boss.x);
  const candidates = Object.values(BOSS_SKILLS).filter(skill => !(cooldowns[skill.id] > 0) && boss.energy >= skill.cost);
  const score = (id: string) => {
    if (id === 'freeKick') return 0.75 + Math.min(distance / 500, 1);
    if (id === 'bribe') return boss.buffFrames > 0 ? -10 : 1.25;
    if (id === 'roster') return 1.2 + (distance < 340 ? 0.7 : 0.1);
    if (id === 'match') return boss.hp < boss.maxHp * 0.65 ? 3.4 : -10;
    return 0;
  };
  const ranked = candidates.map(skill => ({ id: skill.id, score: score(skill.id) + context.random() * 0.65 })).sort((a, b) => b.score - a.score);
  return ranked[0]?.score > 0 ? ranked[0].id : null;
}
