import Phaser from 'phaser';
import { CombatEngine } from '../core/CombatEngine';
import type { Action, CombatEvent, CombatSnapshot, Fighter, Hazard, InputFrame, MoveData, Rect } from '../core/types';
import { fighterFrame } from './AnimationController';

export interface GameViewOptions {
  onSnapshot: (snapshot: CombatSnapshot) => void;
  onPause: () => void;
  onReady?: () => void;
  onError?: (message: string) => void;
}
export interface StartOptions { training?: boolean; seed?: number }
export interface GameView {
  start(options?: StartOptions): void;
  preview(): void;
  pause(paused: boolean): void;
  destroy(): void;
  setDebug(enabled: boolean): void;
  setMuted(muted: boolean): void;
  getSnapshot(): CombatSnapshot;
  getMoveData(): Record<string, MoveData>;
  updateMove(id: string, patch: Partial<Pick<MoveData, 'startup' | 'active' | 'recovery' | 'damage' | 'range'>>): void;
  debugStartSkill(id: string): void;
}

const WIDTH = 1280;
const HEIGHT = 720;
const GROUND = 580;
const STEP = 1000 / 60;
const keyActions: Record<string, Action> = {
  KeyA: 'left', KeyD: 'right', Space: 'jump', KeyS: 'guard',
  KeyJ: 'light', KeyK: 'heavy', KeyL: 'dodge', KeyU: 'ultimate',
};
const audioNames = ['swing', 'hit', 'heavy', 'block', 'dodge', 'perfect', 'land', 'skill', 'ultimate', 'win', 'lose', 'start'];

interface Spark { x: number; y: number; vx: number; vy: number; age: number; life: number; color: number; size: number; gravity: number }
interface Ring { x: number; y: number; age: number; life: number; radius: number; color: number; kind: 'ring' | 'slash' | 'dust'; facing: number }
interface Ghost { image: Phaser.GameObjects.Image; age: number; life: number }

/** Phaser 只承担资源、输入和表现，60 Hz 战斗事实来自独立的 CombatEngine。 */
export function createGameView(parent: HTMLElement, options: GameViewOptions): GameView {
  let scene: ArenaScene | undefined;
  let engine = new CombatEngine();
  let snapshot = engine.snapshot();
  let moveData = engine.getMoveData();
  let requestedStart: StartOptions | null = null;
  let running = false;
  let paused = true;
  let muted = false;
  let debug = false;
  let destroyed = false;
  const input: InputFrame = {};
  const clearInput = () => { for (const action of Object.values(keyActions)) input[action] = false; };

  class ArenaScene extends Phaser.Scene {
    private accumulator = 0;
    private previewFrame = 0;
    private introRemaining = 0;
    private stage!: Phaser.GameObjects.Image;
    private player!: Phaser.GameObjects.Image;
    private boss!: Phaser.GameObjects.Image;
    private shadow!: Phaser.GameObjects.Graphics;
    private atmosphere!: Phaser.GameObjects.Graphics;
    private hazards!: Phaser.GameObjects.Graphics;
    private effects!: Phaser.GameObjects.Graphics;
    private debugGraphics!: Phaser.GameObjects.Graphics;
    private debugText!: Phaser.GameObjects.Text;
    private callout!: Phaser.GameObjects.Text;
    private calloutTimer = 0;
    private sparks: Spark[] = [];
    private rings: Ring[] = [];
    private ghosts: Ghost[] = [];
    private fxTime = 0;
    private lastGhost = 0;
    private textureScale: Record<string, number> = {};

    constructor() { super('arena'); }
    preload() {
      this.load.image('stadium', '/assets/stadium.png');
      this.load.image('player-sheet', '/assets/player-sheet.png');
      this.load.image('boss-sheet', '/assets/boss-sheet.png');
      for (const name of audioNames) this.load.audio(name, `/assets/audio/${name}.wav`);
      this.load.on('loaderror', (file: { key: string }) => options.onError?.(`资源加载失败：${file.key}`));
    }
    create() {
      scene = this;
      this.sound.mute = muted;
      this.cameras.main.setBackgroundColor('#101e1c');
      this.stage = this.add.image(WIDTH / 2, HEIGHT / 2, 'stadium');
      this.stage.setDisplaySize(WIDTH, HEIGHT);
      // 景深色罩让前景人物与危险预警保持可读，不覆盖原创背景细节。
      this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x081b19, .12);
      this.atmosphere = this.add.graphics().setDepth(1);
      this.shadow = this.add.graphics().setDepth(3);
      this.hazards = this.add.graphics().setDepth(5);
      for (const key of ['player-sheet', 'boss-sheet']) {
        const texture = this.textures.get(key);
        const source = texture.getSourceImage() as HTMLImageElement;
        const cellW = Math.floor(source.width / 6);
        const cellH = Math.floor(source.height / 4);
        for (let i = 0; i < 24; i++) texture.add(i, 0, (i % 6) * cellW, Math.floor(i / 6) * cellH, cellW, cellH);
        // 资源格子包含透明余量，以统一格子尺度维持全部动作基准一致。
        this.textureScale[key] = 205 / cellH;
      }
      this.player = this.add.image(360, GROUND, 'player-sheet', 0).setOrigin(.5, .955).setDepth(10);
      this.boss = this.add.image(900, GROUND, 'boss-sheet', 0).setOrigin(.5, .955).setDepth(10);
      this.player.setScale(this.textureScale['player-sheet']);
      this.boss.setScale(this.textureScale['boss-sheet']);
      this.effects = this.add.graphics().setDepth(30);
      this.debugGraphics = this.add.graphics().setDepth(60);
      this.debugText = this.add.text(24, 630, '', { fontFamily: 'monospace', fontSize: '15px', color: '#ddf7ef', backgroundColor: '#081814cc', padding: { x: 10, y: 7 } }).setDepth(61);
      this.callout = this.add.text(WIDTH / 2, 260, '', {
        fontFamily: 'Arial, "PingFang SC", sans-serif', fontSize: '54px', fontStyle: '900', color: '#e6f5c1',
        stroke: '#112a24', strokeThickness: 9, align: 'center',
      }).setOrigin(.5).setDepth(50);
      options.onReady?.();
      if (requestedStart) this.begin(requestedStart);
      else this.renderSnapshot(snapshot, 0);
    }
    begin(startOptions: StartOptions) {
      engine = new CombatEngine(startOptions);
      moveData = engine.getMoveData();
      snapshot = engine.snapshot();
      clearInput();
      paused = false;
      running = true;
      this.accumulator = 0;
      this.introRemaining = 1300;
      this.sparks = [];
      this.rings = [];
      this.ghosts.forEach(ghost => ghost.image.destroy());
      this.ghosts = [];
      this.showCallout(startOptions.training ? '自由练习' : '第一战 · 开场', '#e6f5c1', 1250);
      this.playSound('start', .5);
      options.onSnapshot(snapshot);
    }
    showPreview() {
      this.accumulator = 0;
      this.previewFrame = 0;
      this.introRemaining = 0;
      this.calloutTimer = 0;
      this.callout.setText('').setAlpha(0);
      this.sparks = [];
      this.rings = [];
      this.ghosts.forEach(ghost => ghost.image.destroy());
      this.ghosts = [];
      this.sound.stopAll();
      this.cameras.main.resetFX();
      this.renderSnapshot(snapshot, 0);
    }
    setPaused(value: boolean) {
      this.accumulator = 0;
      if (value) { this.sound.pauseAll(); this.cameras.main.resetFX(); }
      else this.sound.resumeAll();
      engine.setPaused(value);
      snapshot = engine.snapshot();
      options.onSnapshot(snapshot);
    }
    update(_time: number, delta: number) {
      if (destroyed) return;
      const safeDelta = Math.min(delta, 100);
      if (running && !paused) {
        if (this.introRemaining > 0) {
          this.introRemaining -= safeDelta;
          if (this.introRemaining <= 0) this.showCallout('开战', '#e7f8c3', 420);
        } else if (!snapshot.result) {
          this.accumulator += safeDelta;
          // 丢弃超长页面卡顿的积压，防止恢复标签页后一次推进数秒战斗。
          let steps = 0;
          while (this.accumulator >= STEP && steps++ < 6) {
            snapshot = engine.step(input);
            for (const event of snapshot.events) this.consumeEvent(event);
            this.accumulator -= STEP;
          }
          if (steps >= 6) this.accumulator = 0;
          options.onSnapshot(snapshot);
        }
      } else if (!running) {
        this.previewFrame += safeDelta / STEP;
        snapshot.player.stateFrame = Math.floor(this.previewFrame);
        snapshot.boss.stateFrame = Math.floor(this.previewFrame + 16);
      }
      const effectDelta = paused && running ? 0 : safeDelta;
      this.fxTime += effectDelta;
      this.renderSnapshot(snapshot, effectDelta);
    }
    private renderSnapshot(state: CombatSnapshot, delta: number) {
      this.drawAtmosphere();
      this.drawFighter(this.player, state.player, 'player-sheet');
      this.drawFighter(this.boss, state.boss, 'boss-sheet');
      this.drawShadows(state);
      this.drawHazards(state.hazards);
      this.drawEffects(delta);
      this.drawDebug(state);
      if (this.calloutTimer > 0) {
        this.calloutTimer -= delta;
        this.callout.setAlpha(Math.min(1, Math.max(0, this.calloutTimer / 150)));
      } else this.callout.setAlpha(0);
      if (state.slowFrames > 0) {
        this.effects.fillStyle(0x76efd0, .035).fillRect(0, 0, WIDTH, HEIGHT);
      }
    }
    private drawFighter(image: Phaser.GameObjects.Image, fighter: Fighter, key: string) {
      image.setPosition(fighter.x, fighter.y).setFrame(fighterFrame(fighter, fighter.attack ? moveData[fighter.attack] : undefined, snapshot.bossSkill));
      image.setFlipX(fighter.facing === -1);
      image.setAlpha(fighter.invulnerable && fighter.state === 'dodge' ? .76 : 1);
      image.clearTint();
      if (fighter.state === 'hit' && fighter.stateFrame < 4) image.setTintFill(0xfff2d7);
      else if (fighter.buffFrames > 0) image.setTint(0xffd892);
      else if (fighter.invulnerable && fighter.state === 'dodge') image.setTint(0xa5ffe7);
      const scale = this.textureScale[key];
      image.setScale(scale);
      if ((fighter.state === 'dodge' || fighter.state === 'ultimate') && this.fxTime - this.lastGhost > 48 && !paused) {
        const ghost = this.add.image(fighter.x - fighter.facing * 9, fighter.y, key, image.frame.name)
          .setOrigin(.5, .955).setScale(scale).setFlipX(fighter.facing === -1).setTintFill(0x88f3c7).setAlpha(.35).setDepth(8);
        this.ghosts.push({ image: ghost, age: 0, life: 220 });
        this.lastGhost = this.fxTime;
      }
    }
    private drawShadows(state: CombatSnapshot) {
      this.shadow.clear();
      for (const fighter of [state.player, state.boss]) {
        const elevation = Math.max(0, GROUND - fighter.y);
        this.shadow.fillStyle(0x071512, .45 - Math.min(.25, elevation / 1000));
        this.shadow.fillEllipse(fighter.x, GROUND + 3, Math.max(35, 100 - elevation * .15), 17);
      }
    }
    private drawAtmosphere() {
      const g = this.atmosphere;
      g.clear();
      // 轻量像素尘粒仅作氛围，不参与战斗判定。
      for (let i = 0; i < 26; i++) {
        const x = (i * 137 + this.fxTime * (.004 + (i % 3) * .002)) % WIDTH;
        const y = 140 + ((i * 53) % 360) + Math.sin(this.fxTime / 2200 + i) * 14;
        g.fillStyle(i % 3 ? 0xa3dcc2 : 0xe4ed9f, .1 + (Math.sin(this.fxTime / 700 + i) + 1) * .06);
        g.fillRect(x, y, i % 4 === 0 ? 3 : 2, 2);
      }
      g.lineStyle(1, 0x96bda2, .08).lineBetween(0, GROUND + 5, WIDTH, GROUND + 5);
    }
    private drawHazards(hazards: Hazard[]) {
      const g = this.hazards;
      g.clear();
      for (const hazard of hazards) {
        if (hazard.hit) continue;
        const color = hazard.empowered ? 0xf6bc70 : 0xe5f5dc;
        if (hazard.kind === 'ball') {
          const r = hazard.radius;
          if (hazard.age < hazard.warning) {
            g.fillStyle(0xeeb26e, .09).fillRect(0, hazard.y - r, WIDTH, r * 2);
            g.lineStyle(2, 0xf8c17e, .5).lineBetween(0, hazard.y, WIDTH, hazard.y);
          }
          for (let i = 3; i >= 1; i--) {
            g.fillStyle(color, .08 * (4 - i)).fillCircle(hazard.x - hazard.vx * i * 1.4, hazard.y - hazard.vy * i * 1.4, r * (1 - i * .12));
          }
          g.fillStyle(0x0b211b, 1).fillCircle(hazard.x, hazard.y, r + 2);
          g.fillStyle(color, 1).fillCircle(hazard.x, hazard.y, r);
          g.fillStyle(0x25433b, 1);
          const spin = hazard.age * .15;
          const points = Array.from({ length: 5 }, (_, index) => ({ x: hazard.x + Math.cos(spin + index * Math.PI * .4) * r * .43, y: hazard.y + Math.sin(spin + index * Math.PI * .4) * r * .43 }));
          g.fillPoints(points, true);
          g.lineStyle(2, 0x25433b, 1);
          for (const point of points) g.lineBetween(point.x, point.y, hazard.x + (point.x - hazard.x) * 2.1, hazard.y + (point.y - hazard.y) * 2.1);
          g.lineStyle(2, 0xffffff, .6).strokeCircle(hazard.x, hazard.y, r - 2);
        } else if (hazard.kind === 'envelope') {
          g.fillStyle(0xff665c, .1).fillCircle(hazard.x, hazard.y, 35 + Math.sin(hazard.age * .2) * 4);
          g.lineStyle(2, 0xffc28c, .3).lineBetween(hazard.x + 16, hazard.y - 16, 1120, 100);
          g.fillStyle(0x801c23, 1).fillRoundedRect(hazard.x - 15, hazard.y - 20, 30, 40, 3);
          g.fillStyle(0xf16350, 1).fillRoundedRect(hazard.x - 12, hazard.y - 18, 24, 34, 2);
          g.lineStyle(2, 0xffce87, 1).strokeTriangle(hazard.x - 11, hazard.y - 15, hazard.x + 11, hazard.y - 15, hazard.x, hazard.y - 3);
          g.fillStyle(0xffd383, 1).fillCircle(hazard.x, hazard.y + 7, 5);
        } else if (hazard.kind === 'mark') {
          const active = hazard.age >= hazard.warning;
          const width = Math.max(70, hazard.radius * 2);
          g.fillStyle(active ? 0xf5c777 : 0xf7b76a, active ? .3 : .09 + Math.sin(hazard.age * .35) * .035);
          g.fillRect(hazard.x - width / 2, GROUND - 160, width, 163);
          g.lineStyle(active ? 4 : 2, 0xffc982, active ? 1 : .8).strokeRect(hazard.x - width / 2, GROUND - 160, width, 163);
          for (let i = 0; i < width; i += 18) {
            g.lineStyle(3, 0xf7bc76, .7).lineBetween(hazard.x - width / 2 + i, GROUND + 2, hazard.x - width / 2 + i + 10, GROUND - 8);
          }
          g.fillStyle(0xffd095, 1).fillTriangle(hazard.x - 8, GROUND - 179, hazard.x + 8, GROUND - 179, hazard.x, GROUND - 165);
        } else if (hazard.kind === 'wave') {
          g.lineStyle(8, color, .18).strokeCircle(hazard.x, hazard.y, hazard.radius + 5);
          g.lineStyle(3, color, .9).strokeCircle(hazard.x, hazard.y, hazard.radius);
        }
      }
    }
    private consumeEvent(event: CombatEvent) {
      const { x, y } = event;
      if (event.type === 'hit') {
        const heavy = (event.amount ?? 0) >= 100;
        this.sparkBurst(x, y, heavy ? 26 : 16, heavy ? 0xffd396 : 0xf1f9d8, heavy ? 1.4 : 1);
        this.rings.push({ x, y, age: 0, life: 180, radius: heavy ? 75 : 48, color: 0xffefc2, kind: 'ring', facing: 1 });
        this.cameras.main.shake(heavy ? 130 : 75, heavy ? .004 : .0021);
        this.playSound(heavy ? 'heavy' : 'hit', .55);
      } else if (event.type === 'attack') {
        const actor = event.actor === 'boss' ? snapshot.boss : snapshot.player;
        this.rings.push({ x: x + actor.facing * 35, y, age: 0, life: 170, radius: actor.state === 'heavy' ? 100 : 69, color: event.actor === 'boss' ? 0xffd09a : 0xb8ffdb, kind: 'slash', facing: actor.facing });
        this.playSound('swing', .42);
      } else if (event.type === 'block') {
        this.sparkBurst(x, y, 9, 0xa6d4f7, .65);
        this.rings.push({ x, y, age: 0, life: 180, radius: 43, color: 0xb3e9ff, kind: 'ring', facing: 1 });
        this.playSound('block', .45);
      } else if (event.type === 'dodge') this.playSound('dodge', .4);
      else if (event.type === 'perfect') {
        this.showCallout('精准闪避', '#a5ffe0', 720);
        this.rings.push({ x, y, age: 0, life: 500, radius: 180, color: 0x93f5d5, kind: 'ring', facing: 1 });
        this.playSound('perfect', .55);
      } else if (event.type === 'land') {
        this.rings.push({ x, y, age: 0, life: 350, radius: 65, color: 0xc0bfa0, kind: 'dust', facing: 1 });
        this.playSound('land', .24);
      } else if (event.type === 'intercept') {
        this.sparkBurst(x, y, 22, 0xf5b893, 1);
        this.showCallout('拦截成功', '#b7f8d0', 650);
        this.playSound('perfect', .45);
      } else if (event.type === 'skill') {
        this.playSound('skill', .35);
      } else if (event.type === 'ultimate') {
        this.showCallout(event.text || (event.actor === 'boss' ? '默 契 球' : '平 凡 之 力'), event.actor === 'boss' ? '#ffcb8b' : '#b9ffdc', 1000);
        this.cameras.main.flash(120, 186, 238, 200, false);
        this.cameras.main.shake(260, .004);
        this.rings.push({ x, y, age: 0, life: 650, radius: 370, color: 0xc3ffda, kind: 'ring', facing: 1 });
        this.sparkBurst(x, y, 42, 0xd1ffd8, 2);
        this.playSound('ultimate', .55);
      } else if (event.type === 'end') {
        this.playSound(snapshot.result === 'win' ? 'win' : 'lose', .6);
        this.showCallout(snapshot.result === 'win' ? '挑 战 成 功' : '再 战 一 次', snapshot.result === 'win' ? '#d9f3af' : '#f4bd9c', 1600);
      }
    }
    private sparkBurst(x: number, y: number, count: number, color: number, force: number) {
      for (let i = 0; i < count; i++) {
        const angle = Math.PI * 2 * i / count + Math.random() * .3;
        const speed = (70 + Math.random() * 260) * force;
        this.sparks.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, age: 0, life: 150 + Math.random() * 240, color, size: 2 + Math.random() * 3, gravity: 120 });
      }
    }
    private drawEffects(delta: number) {
      const g = this.effects;
      g.clear();
      for (const spark of this.sparks) {
        spark.age += delta;
        spark.x += spark.vx * delta / 1000;
        spark.y += spark.vy * delta / 1000;
        spark.vy += spark.gravity * delta / 1000;
        const alpha = Math.max(0, 1 - spark.age / spark.life);
        g.lineStyle(spark.size, spark.color, alpha).lineBetween(spark.x, spark.y, spark.x - spark.vx * .024, spark.y - spark.vy * .024);
      }
      this.sparks = this.sparks.filter(spark => spark.age < spark.life);
      for (const ring of this.rings) {
        ring.age += delta;
        const progress = ring.age / ring.life;
        const alpha = Math.max(0, 1 - progress);
        const radius = ring.radius * (.25 + progress * .75);
        if (ring.kind === 'ring') {
          g.lineStyle(2 + alpha * 5, ring.color, alpha * .85).strokeCircle(ring.x, ring.y, radius);
          if (progress < .25) {
            g.fillStyle(0xfff8df, alpha * .7).fillTriangle(ring.x - 38, ring.y - 4, ring.x + 42, ring.y + 3, ring.x, ring.y - 9);
            g.fillTriangle(ring.x - 3, ring.y - 35, ring.x + 3, ring.y + 38, ring.x + 8, ring.y);
          }
        } else if (ring.kind === 'slash') {
          const center = ring.facing === 1 ? 0 : Math.PI;
          g.lineStyle(4 + alpha * 8, ring.color, alpha * .72);
          g.beginPath(); g.arc(ring.x, ring.y, radius, center - 1.05, center + .9, false); g.strokePath();
          g.lineStyle(2, 0xffffff, alpha * .8);
          g.beginPath(); g.arc(ring.x, ring.y, radius + 7, center - .9, center + .7, false); g.strokePath();
        } else {
          g.fillStyle(ring.color, alpha * .25);
          g.fillEllipse(ring.x - progress * 32, ring.y, radius, 10 * alpha);
          g.fillEllipse(ring.x + progress * 32, ring.y + 1, radius, 8 * alpha);
        }
      }
      this.rings = this.rings.filter(ring => ring.age < ring.life);
      for (const ghost of this.ghosts) {
        ghost.age += delta;
        ghost.image.setAlpha(Math.max(0, .3 * (1 - ghost.age / ghost.life)));
        if (ghost.age >= ghost.life) ghost.image.destroy();
      }
      this.ghosts = this.ghosts.filter(ghost => ghost.age < ghost.life);
    }
    private drawDebug(state: CombatSnapshot) {
      this.debugGraphics.clear();
      this.debugText.setVisible(debug);
      if (!debug) return;
      const boxes = (rects: Rect[], color: number) => {
        this.debugGraphics.lineStyle(2, color, .9).fillStyle(color, .12);
        for (const rect of rects) { this.debugGraphics.fillRect(rect.x, rect.y, rect.w, rect.h); this.debugGraphics.strokeRect(rect.x, rect.y, rect.w, rect.h); }
      };
      boxes(state.bodies, 0x83aaff); boxes(state.hurtboxes, 0x8dffc8); boxes(state.hitboxes, 0xff7e7e);
      this.debugText.setText(`帧 ${state.frame}  停顿 ${state.hitstop}  慢速 ${state.slowFrames}  FPS ${Math.round(this.game.loop.actualFps)}\n玩家 ${state.player.state}:${state.player.stateFrame}  Boss ${state.boss.state}:${state.boss.stateFrame}  蓝：身体  绿：受击  红：攻击`);
    }
    private showCallout(text: string, color: string, duration: number) {
      this.callout.setText(text).setColor(color).setAlpha(1);
      this.calloutTimer = duration;
    }
    private playSound(name: string, volume: number) {
      if (this.cache.audio.exists(name)) this.sound.play(name, { volume });
    }
  }

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: '#101e1c',
    pixelArt: true,
    antialias: false,
    roundPixels: true,
    banner: false,
    audio: { disableWebAudio: false },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    fps: { target: 60, forceSetTimeOut: false },
    scene: ArenaScene,
  });

  const editable = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
  const onKeyDown = (event: KeyboardEvent) => {
    if (!running || editable(event.target)) return;
    if (event.code === 'Escape') {
      event.preventDefault();
      if (!event.repeat) { clearInput(); options.onPause(); }
      return;
    }
    const action = keyActions[event.code];
    if (action && !paused && !snapshot.result) { event.preventDefault(); input[action] = true; }
  };
  const onKeyUp = (event: KeyboardEvent) => { const action = keyActions[event.code]; if (action) input[action] = false; };
  const onBlur = () => {
    clearInput();
    if (running && !paused && !snapshot.result) { paused = true; scene?.setPaused(true); options.onPause(); }
  };
  const onVisibility = () => { if (document.hidden) onBlur(); };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVisibility);

  return {
    start(startOptions = {}) { requestedStart = startOptions; scene?.begin(startOptions); },
    preview() {
      requestedStart = null;
      running = false;
      paused = true;
      clearInput();
      engine = new CombatEngine();
      engine.setPaused(true);
      moveData = engine.getMoveData();
      snapshot = engine.snapshot();
      scene?.showPreview();
      options.onSnapshot(snapshot);
    },
    pause(value) { paused = value; clearInput(); scene?.setPaused(value); },
    destroy() {
      destroyed = true;
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      game.destroy(true);
    },
    setDebug(value) { debug = value; },
    setMuted(value) { muted = value; game.sound.mute = value; },
    getSnapshot() { return snapshot; },
    getMoveData() { return engine.getMoveData(); },
    updateMove(id, patch) { engine.updateMove(id, patch); moveData = engine.getMoveData(); },
    debugStartSkill(id) { engine.debugStartSkill(id); },
  };
}
