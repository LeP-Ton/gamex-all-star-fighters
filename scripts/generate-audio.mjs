import { mkdirSync, writeFileSync } from 'node:fs';

// 所有音效为项目内程序合成，不使用采样库或第三方录音。
const rate = 22050;
const output = new URL('../public/assets/audio/', import.meta.url);
mkdirSync(output, { recursive: true });
let randomState = 142;
function noise() { randomState = (1664525 * randomState + 1013904223) >>> 0; return randomState / 2147483648 - 1; }
function save(name, duration, sample) {
  const count = Math.ceil(rate * duration);
  const data = Buffer.alloc(44 + count * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + count * 2, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28); data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) {
    const t = i / rate;
    const fade = Math.min(1, t * 1000, (duration - t) * 120);
    const value = sample(t, duration) * fade;
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 26000), 44 + i * 2);
  }
  writeFileSync(new URL(`${name}.wav`, output), data);
}
const tone = (f, t) => Math.sin(2 * Math.PI * f * t);
save('swing', .18, t => noise() * Math.sin(Math.PI * t / .18) ** 2 * .24 + tone(160 - 200 * t, t) * Math.exp(-t * 28) * .2);
save('hit', .22, t => noise() * Math.exp(-t * 36) * .6 + tone(90 - 90 * t, t) * Math.exp(-t * 24) * .75);
save('heavy', .36, t => noise() * Math.exp(-t * 23) * .55 + tone(55 + 70 * Math.exp(-t * 28), t) * Math.exp(-t * 11) * .7);
save('block', .20, t => (tone(740, t) + tone(1110, t) * .5) * Math.exp(-t * 28) * .34 + noise() * Math.exp(-t * 55) * .32);
save('dodge', .22, t => noise() * Math.sin(Math.PI * t / .22) ** 2 * .15 + tone(300 + 2000 * t, t) * Math.exp(-t * 18) * .12);
save('perfect', .54, t => (tone(660, t) + tone(990, t) * .7 + tone(1320, t) * .4) * Math.exp(-t * 9) * .18);
save('land', .17, t => noise() * Math.exp(-t * 42) * .32 + tone(65, t) * Math.exp(-t * 24) * .35);
save('skill', .44, t => tone(180 + 800 * t, t) * Math.sin(Math.PI * t / .44) * .18 + noise() * Math.exp(-t * 16) * .2);
save('ultimate', 1.05, t => (tone(65 + 18 * t, t) * .5 + noise() * .14) * Math.exp(-t * 2) + tone(500 + 700 * t, t) * Math.sin(Math.PI * t / 1.05) * .16);
save('win', 1.20, t => { const notes = [440, 554.37, 659.25, 880]; const p = Math.min(3, Math.floor(t / .18)); return tone(notes[p], t) * .28 * Math.exp(-Math.max(0, t - .54) * 5); });
save('lose', .90, t => tone(320 - t * 170, t) * Math.exp(-t * 3) * .26);
save('start', .55, t => (tone(t < .15 ? 330 : 660, t) + tone(t < .15 ? 495 : 990, t) * .3) * Math.exp(-t * 6) * .3);
console.log('已生成 12 个原创 PCM WAV 音效。');
