export type FighterState = 'idle' | 'run' | 'jump' | 'land' | 'light' | 'heavy' | 'guard' | 'dodge' | 'hit' | 'down' | 'rise' | 'skill' | 'ultimate' | 'victory' | 'defeat';
export type Action = 'left' | 'right' | 'jump' | 'guard' | 'light' | 'heavy' | 'dodge' | 'ultimate';
export type InputFrame = Partial<Record<Action, boolean>>;
export interface Fighter {
 id: 'player' | 'boss'; x: number; y: number; vx: number; vy: number; facing: 1 | -1;
 hp: number; maxHp: number; energy: number; state: FighterState; stateFrame: number;
 attack: string | null; comboStep: number; invulnerable: boolean; buffFrames: number;
}
export interface Rect { x: number; y: number; w: number; h: number }
export interface Hazard { id: number; kind: 'ball' | 'envelope' | 'mark' | 'wave'; x: number; y: number; vx: number; vy: number; radius: number; age: number; life: number; warning: number; empowered?: boolean; bounces?: number; gravity?: number; hit?: boolean }
export interface CombatEvent { type: 'hit' | 'block' | 'dodge' | 'perfect' | 'attack' | 'land' | 'skill' | 'ultimate' | 'intercept' | 'end'; x: number; y: number; text?: string; amount?: number; actor?: 'player' | 'boss' }
export interface CombatSnapshot { frame: number; time: number; remaining: number; player: Fighter; boss: Fighter; hazards: Hazard[]; events: CombatEvent[]; combo: number; maxCombo: number; hitsTaken: number; hitstop: number; slowFrames: number; paused: boolean; result: 'win' | 'lose' | null; bossSkill: string; bossHint: string; hitboxes: Rect[]; hurtboxes: Rect[]; bodies: Rect[] }
export interface MoveData { id: string; name: string; startup: number; active: number; recovery: number; damage: number; range: number; height: number; knockback: number; hitstun: number; energy: number; cancelFrom: number; cancelTo: number; cooldown: number; cost: number }
