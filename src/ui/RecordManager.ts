export interface BattleRecord {
  date: string;
  time: number;
  maxCombo: number;
  hp: number;
  hitsTaken: number;
  won: boolean;
  mode: 'story' | 'training';
}

export interface PlayerProfile {
  name: string;
  registered: boolean;
  best: BattleRecord | null;
  history: BattleRecord[];
  sound: boolean;
}

export const STORAGE_KEY = 'gamex-all-star-fighters:v1';
const HISTORY_LIMIT = 30;
type RecordStorage = Pick<Storage, 'getItem' | 'setItem'>;

function normalizeName(value: string): string {
  return Array.from(value.trim()).slice(0, 12).join('') || '路人甲';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function parseRecord(value: unknown): BattleRecord | null {
  if (!isObject(value) || typeof value.date !== 'string' || value.date.length > 64 ||
      !Number.isFinite(Date.parse(value.date)) || !nonnegative(value.time) ||
      !nonnegative(value.maxCombo) || !Number.isInteger(value.maxCombo) ||
      !nonnegative(value.hp) || !nonnegative(value.hitsTaken) ||
      !Number.isInteger(value.hitsTaken) || typeof value.won !== 'boolean' ||
      (value.mode !== 'story' && value.mode !== 'training')) return null;

  return {
    date: value.date, time: value.time, maxCombo: value.maxCombo,
    hp: value.hp, hitsTaken: value.hitsTaken, won: value.won, mode: value.mode,
  };
}

function isBetter(candidate: BattleRecord, best: BattleRecord | null): boolean {
  if (!candidate.won || candidate.mode !== 'story') return false;
  return best === null || candidate.time < best.time ||
    (candidate.time === best.time && candidate.hp > best.hp) ||
    (candidate.time === best.time && candidate.hp === best.hp && candidate.hitsTaken < best.hitsTaken);
}

function browserStorage(): RecordStorage | undefined {
  // 浏览器隐私设置可能在读取 localStorage 属性时直接抛错。
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export class RecordManager {
  private readonly storage: RecordStorage | undefined;
  private state: PlayerProfile = { name: '路人甲', registered: false, best: null, history: [], sound: true };

  constructor(storage?: RecordStorage) {
    this.storage = storage ?? browserStorage();
    this.load();
  }

  get profile(): PlayerProfile {
    // 不让界面意外修改内部记录，下一次保存时带入未经校验的数据。
    return {
      ...this.state,
      best: this.state.best ? { ...this.state.best } : null,
      history: this.state.history.map(record => ({ ...record })),
    };
  }

  setName(name: string): string {
    this.state.name = typeof name === 'string' ? normalizeName(name) : '路人甲';
    this.state.registered = true;
    this.persist();
    return this.state.name;
  }

  setSound(sound: boolean): void {
    if (typeof sound !== 'boolean') return;
    this.state.sound = sound;
    this.persist();
  }

  saveResult(record: BattleRecord): void {
    const safe = parseRecord(record);
    if (!safe) return;
    this.state.history = [safe, ...this.state.history].slice(0, HISTORY_LIMIT);
    if (isBetter(safe, this.state.best)) this.state.best = { ...safe };
    // 首场胜利不等于完整通关；此存档不产生自由挑战或连战解锁标记。
    this.persist();
  }

  private load(): void {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved: unknown = JSON.parse(raw);
      if (!isObject(saved) || saved.version !== 1) return;
      if (typeof saved.name === 'string') this.state.name = normalizeName(saved.name);
      // 旧存档以有效姓名推断已命名；显式 false 必须保留，不能由默认姓名覆盖。
      this.state.registered = saved.registered === true ||
        (!Object.hasOwn(saved, 'registered') && typeof saved.name === 'string' && saved.name.trim().length > 0);
      if (typeof saved.sound === 'boolean') this.state.sound = saved.sound;
      if (Array.isArray(saved.history)) {
        this.state.history = saved.history.map(parseRecord)
          .filter((record): record is BattleRecord => record !== null).slice(0, HISTORY_LIMIT);
      }
      const best = parseRecord(saved.best);
      this.state.best = best?.won && best.mode === 'story' ? best : null;
      for (const record of this.state.history) {
        if (isBetter(record, this.state.best)) this.state.best = { ...record };
      }
    } catch {
      // 损坏 JSON、禁用存储都不应阻断首次启动，保留已验证的默认值。
    }
  }

  private persist(): void {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify({ version: 1, ...this.state }));
    } catch {
      // 超额或存储拒绝时仍保留本次会话中的姓名、声音设置与成绩。
    }
  }
}
