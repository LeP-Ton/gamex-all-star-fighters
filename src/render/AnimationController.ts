import type { Fighter, FighterState, MoveData } from '../core/types';

const cycles: Partial<Record<FighterState, readonly number[]>> = {
  idle: [0, 1, 2, 3, 2, 1], run: [4, 5, 6, 7], jump: [8], land: [9],
  guard: [10], dodge: [11], hit: [18], down: [19], rise: [19, 9, 0],
  victory: [23], defeat: [19],
};
const movePoses: Record<string, readonly [number, number, number]> = {
  light1: [10, 12, 0], light2: [12, 13, 10], light3: [15, 14, 17],
  heavy: [15, 16, 17], aerial: [8, 14, 8], ultimate: [20, 21, 22], bossKick: [15, 21, 17],
};

/** 起手、有效、收招分别使用对应姿态；伤害始终由战斗核心的帧数据决定。 */
export function fighterFrame(fighter: Fighter, move?: MoveData, bossSkill = ''): number {
  const frame = fighter.stateFrame;
  if (fighter.attack && move) {
    const poses = movePoses[fighter.attack] ?? [10, 12, 0];
    return frame < move.startup ? poses[0] : frame < move.startup + move.active ? poses[1] : poses[2];
  }
  if (fighter.id === 'boss' && (fighter.state === 'skill' || fighter.state === 'ultimate')) {
    if (bossSkill === '行贿上位') return frame < 25 ? 10 : frame < 55 ? 20 : 0;
    if (bossSkill === '任意球') return frame < 27 ? 15 : frame < 76 ? 21 : 17;
    if (bossSkill === '名单内定') return frame < 36 ? 10 : frame < 110 ? 4 + Math.floor(frame / 4) % 4 : 0;
    if (bossSkill === '默契球') return frame < 24 ? 22 : [24, 96, 168].some(start => frame >= start && frame < start + 25) ? 21 : 15;
  }
  if (fighter.state === 'skill' || fighter.state === 'ultimate') return 20 + Math.min(2, Math.floor(frame / 12) % 3);
  const sequence = cycles[fighter.state] ?? cycles.idle!;
  const pace = fighter.state === 'run' ? 5 : fighter.state === 'rise' ? 4 : 9;
  return sequence[Math.floor(frame / pace) % sequence.length];
}
