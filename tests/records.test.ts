import { describe, expect, it } from 'vitest';
import { RecordManager, STORAGE_KEY, type BattleRecord } from '../src/ui/RecordManager';

function memoryStorage(initial?: string) {
  const items = new Map(initial === undefined ? [] : [[STORAGE_KEY, initial]]);
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); } };
}

function result(overrides: Partial<BattleRecord> = {}): BattleRecord {
  return { date: '2026-11-04T06:00:00.000Z', time: 61.5, maxCombo: 3, hp: 400, hitsTaken: 5, won: true, mode: 'story', ...overrides };
}

describe('本地玩家记录', () => {
  it('持久保存姓名、声音与故事首场纪录，姓名按 Unicode 字符限制', () => {
    const storage = memoryStorage();
    const manager = new RecordManager(storage);
    expect(manager.profile.name).toBe('路人甲');
    expect(manager.setName('  ')).toBe('路人甲');
    expect(manager.setName(`  ${'𠮷'.repeat(13)}  `)).toBe('𠮷'.repeat(12));
    manager.setSound(false);
    manager.saveResult(result());
    const restored = new RecordManager(storage).profile;
    expect(restored.name).toBe('𠮷'.repeat(12));
    expect(restored.sound).toBe(false);
    expect(restored.best?.time).toBe(61.5);
    expect(restored.history).toHaveLength(1);
  });

  it('训练胜利与失败不覆盖最佳纪录，也不产生完整通关解锁字段', () => {
    const storage = memoryStorage();
    const manager = new RecordManager(storage);
    manager.saveResult(result({ mode: 'training', time: 1 }));
    expect(manager.profile.best).toBeNull();
    manager.saveResult(result());
    manager.saveResult(result({ won: false, time: 2 }));
    manager.saveResult(result({ time: 65 }));
    manager.saveResult(result({ time: 40 }));
    expect(manager.profile.best?.time).toBe(40);
    expect(manager.profile.history).toHaveLength(5);
    expect(Object.keys(JSON.parse(storage.getItem(STORAGE_KEY)!)).sort()).toEqual(['best', 'history', 'name', 'registered', 'sound', 'version']);
  });

  it('损坏 JSON 和未知版本回到默认值', () => {
    for (const raw of ['{ broken', 'null', '[]', '{"version":42,"name":"不应读取"}']) {
      expect(new RecordManager(memoryStorage(raw)).profile).toEqual({ name: '路人甲', registered: false, sound: true, best: null, history: [] });
    }
  });

  it('确认默认姓名后重载仍已命名，并兼容旧存档的有效姓名', () => {
    const storage = memoryStorage();
    const manager = new RecordManager(storage);
    expect(manager.profile.registered).toBe(false);
    manager.setSound(false);
    expect(new RecordManager(storage).profile.registered).toBe(false);
    manager.setName('路人甲');
    expect(manager.profile.registered).toBe(true);
    const restored = new RecordManager(storage).profile;
    expect(restored.name).toBe('路人甲');
    expect(restored.registered).toBe(true);
    expect(new RecordManager(memoryStorage(JSON.stringify({ version: 1, name: '老玩家' }))).profile.registered).toBe(true);
    expect(new RecordManager(memoryStorage(JSON.stringify({ version: 1, name: '   ' }))).profile.registered).toBe(false);
    expect(new RecordManager(memoryStorage(JSON.stringify({ version: 1, name: '路人甲', registered: 'true' }))).profile.registered).toBe(false);
  });

  it('丢弃非法数字、日期、类型与训练 best，同时从合法历史恢复 best', () => {
    const bad = [result({ time: -1 }), result({ time: Number.NaN }), result({ hp: Infinity }),
      result({ maxCombo: 1.5 }), result({ date: 'not-a-date' }), result({ hitsTaken: -1 }),
      { ...result(), time: '30' }, { ...result(), mode: 'rush' }, { ...result(), won: 'true' }];
    const storage = memoryStorage(JSON.stringify({ version: 1, name: 23, sound: 'false', best: result({ mode: 'training', time: 1 }), history: [...bad, result()] }));
    const manager = new RecordManager(storage);
    expect(manager.profile.history).toEqual([result()]);
    expect(manager.profile.best).toEqual(result());
    expect(manager.profile.name).toBe('路人甲');
    expect(manager.profile.sound).toBe(true);
    for (const record of bad) manager.saveResult(record as BattleRecord);
    expect(manager.profile.history).toHaveLength(1);
  });

  it('存储读写被拒绝时继续保留会话内状态', () => {
    const storage = { getItem() { throw new Error('禁止访问'); }, setItem() { throw new Error('配额已满'); } };
    const manager = new RecordManager(storage);
    expect(() => { manager.setName('测试玩家'); manager.setSound(false); manager.saveResult(result()); }).not.toThrow();
    expect(manager.profile.name).toBe('测试玩家');
    expect(manager.profile.best).toEqual(result());
    expect(manager.profile.sound).toBe(false);
  });

  it('历史保留最近 30 次，旧最佳成绩仍保留，返回快照不可污染内部状态', () => {
    const manager = new RecordManager(memoryStorage());
    manager.saveResult(result({ time: 1 }));
    for (let i = 0; i < 35; i++) manager.saveResult(result({ time: 100 + i }));
    const profile = manager.profile;
    expect(profile.history).toHaveLength(30);
    expect(profile.history[0].time).toBe(134);
    expect(profile.best?.time).toBe(1);
    profile.history[0].time = -100;
    profile.best!.time = -100;
    expect(manager.profile.history[0].time).toBe(134);
    expect(manager.profile.best?.time).toBe(1);
  });
});
