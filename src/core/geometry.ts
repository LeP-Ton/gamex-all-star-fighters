import type { Fighter, Rect } from './types';

export const GROUND = 580;
export const ARENA_LEFT = 72;
export const ARENA_RIGHT = 1208;
export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
export const bodyBox = (f: Fighter): Rect => ({ x: f.x - 26, y: f.y - 128, w: 52, h: 128 });
export const hurtBox = (f: Fighter): Rect => ({ x: f.x - 30, y: f.y - 148, w: 60, h: 148 });
export const circleBox = (x: number, y: number, radius: number): Rect => ({ x: x - radius, y: y - radius, w: radius * 2, h: radius * 2 });
