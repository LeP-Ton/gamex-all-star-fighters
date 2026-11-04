import './style.css';
import { layout } from './ui/layout';
import { createGameView, type GameView } from './render/GameView';
import type { CombatSnapshot, MoveData } from './core/types';
import { RecordManager } from './ui/RecordManager';

const records = new RecordManager();
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const time = (n: number) => `${Math.floor(n / 60).toString().padStart(2, '0')}:${Math.floor(n % 60).toString().padStart(2, '0')}`;
let mode: 'story' | 'training' = 'story';
let state: 'lobby' | 'playing' | 'paused' | 'result' = 'lobby';
let debug = false;
let ready = false;
let game: GameView;
let lastSnapshot: CombatSnapshot;
let resultSaved = false;
let liveTick = -1;

$('app').innerHTML = layout;

function syncProfile() {
  const p = records.profile;
  for (const id of ['profile-name','preview-name','hud-name']) $(id).textContent = p.name;
  $('best-time').textContent = p.best ? time(p.best.time) : '--:--';
  $('sound').textContent = p.sound ? '♫' : '♪';
  $('sound').classList.toggle('muted', !p.sound);
  $('sound').setAttribute('aria-label', p.sound ? '关闭声音' : '开启声音');
  game?.setMuted(!p.sound);
}
function showDialog(html: string) { if (state === 'playing') pauseBattle(); $('dialog-content').innerHTML = html; ($('dialog') as HTMLDialogElement).showModal(); }
function closeDialog() { ($('dialog') as HTMLDialogElement).close(); }
let toastTimer = 0;
function toast(message: string) { $('toast').textContent = message; $('toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = window.setTimeout(() => $('toast').classList.remove('visible'), 2600); }
function rename(first = false) {
  showDialog(`<div class="eyebrow">PLAYER REGISTRATION</div><h2>${first ? '每个故事，从你的名字开始。' : '你的名字，你的主场。'}</h2><p>给这位普通的挑战者一个名字。</p><form id="name-form"><label for="player-name">角色姓名</label><input id="player-name" name="name" value="${esc(records.profile.name)}" maxlength="24" autocomplete="off" required/><small>最多 12 个字符，仅保存于当前浏览器。</small><button class="primary-button" type="submit"><span>${first ? '以此身份出战' : '保存姓名'}</span><b>→</b></button></form>`);
  $('name-form').addEventListener('submit', e => { e.preventDefault(); records.setName(($('player-name') as HTMLInputElement).value); syncProfile(); closeDialog(); if (first) beginBattle(); });
  ($('player-name') as HTMLInputElement).select();
}
function beginBattle() {
  if (!ready) return;
  closeDialog(); state = 'playing'; resultSaved = false; liveTick = -1;
  document.body.classList.add('in-battle');
  for (const id of ['lobby-overlay','play-panel','battle-overlay','debug-panel']) $(id).classList.add('hidden');
  for (const id of ['hud','pause','fight-note','combat-panel']) $(id).classList.remove('hidden');
  $('round-label').textContent = mode === 'training' ? 'PRACTICE' : 'ROUND 01';
  $('arena-status').textContent = mode === 'training' ? '自由练习 · 满能量开场' : '挑战进行中';
  $('combat-title').textContent = mode === 'training' ? '练好你的下一拳' : '掌握比赛节奏';
  game.start({ training: mode === 'training' });
  game.setDebug(debug);
  $('stage').scrollIntoView({behavior:'smooth',block:'center'});
  if (debug && mode === 'training') { $('debug-panel').classList.remove('hidden'); renderDebug(); }
}
function returnLobby() {
  state = 'lobby'; game.preview(); document.body.classList.remove('in-battle');
  for (const id of ['hud','pause','fight-note','combat-panel','battle-overlay','combo','debug-panel']) $(id).classList.add('hidden');
  for (const id of ['lobby-overlay','play-panel']) $(id).classList.remove('hidden');
  $('arena-status').textContent = '等待挑战者入场'; syncProfile();
}
function pauseBattle() {
  if (state !== 'playing') return;
  state = 'paused'; game.pause(true);
  $('battle-overlay').classList.remove('hidden');
  $('battle-overlay').innerHTML = `<div class="overlay-card"><div class="eyebrow">TAKE A BREATH</div><h2>休息一下，再出发。</h2><p>战斗与计时已暂停。</p><button id="resume" class="primary-button"><span>继续战斗</span><b>→</b></button><button id="restart" class="secondary-button">重新挑战</button><button id="exit" class="text-button">返回大厅</button></div>`;
  $('resume').onclick = resumeBattle; $('restart').onclick = beginBattle; $('exit').onclick = returnLobby;
}
function resumeBattle() { if (state !== 'paused') return; state = 'playing'; $('battle-overlay').classList.add('hidden'); game.pause(false); }
function finishBattle(s: CombatSnapshot) {
  if (resultSaved) return; resultSaved = true; state = 'result';
  records.saveResult({date:new Date().toISOString(),time:s.time,maxCombo:s.maxCombo,hp:Math.round(s.player.hp),hitsTaken:s.hitsTaken,won:s.result==='win',mode}); syncProfile();
  const won = s.result === 'win';
  $('arena-status').textContent = won ? '首场挑战成功' : '本场挑战结束'; $('pause').classList.add('hidden'); $('battle-overlay').classList.remove('hidden');
  $('battle-overlay').innerHTML = `<div class="overlay-card result-card"><div class="eyebrow">${won?'VICTORY / STAGE 01':'ONE MORE ROUND'}</div><h2>${won?'这一场，你是主角。':'下一次，打得更漂亮。'}</h2><p>${mode==='training'?'练习结束，本次不计入正式最佳成绩。':won?'首场已击破。后续场景仍在制作，欢迎再次挑战。':'观察技能预警，试着用闪避换取反击机会。'}</p><div class="result-stats"><div><b>${time(s.time)}</b><span>挑战用时</span></div><div><b>${s.maxCombo}</b><span>最高连击</span></div><div><b>${s.hitsTaken}</b><span>受击次数</span></div><div><b>${Math.ceil(s.player.hp/s.player.maxHp*100)}%</b><span>剩余生命</span></div></div>${won&&s.player.hp===s.player.maxHp?'<div class="flawless">✦ 无伤挑战</div>':''}<button class="primary-button" id="play-again"><span>再战一场</span><b>↗</b></button><button class="text-button" id="result-home">返回大厅</button></div>`;
  $('play-again').onclick = beginBattle; $('result-home').onclick = returnLobby;
}
function updateHud(s: CombatSnapshot) {
  lastSnapshot = s;
  if (state === 'lobby') return;
  $('player-health').style.width = `${s.player.hp/s.player.maxHp*100}%`; $('boss-health').style.width = `${s.boss.hp/s.boss.maxHp*100}%`;
  $('player-energy').style.width = `${s.player.energy}%`; $('boss-buff').style.width = s.boss.buffFrames>0?'100%':'0%';
  $('player-hp').textContent = `${Math.ceil(s.player.hp)} / ${s.player.maxHp}`; $('boss-hp').textContent = `${Math.ceil(s.boss.hp)} / ${s.boss.maxHp}`;
  $('energy-value').textContent = s.player.energy>=100?'U · 必杀就绪':`能量 ${Math.floor(s.player.energy)}%`; $('player-energy').classList.toggle('charged',s.player.energy>=100);
  $('boss-status').textContent = s.boss.buffFrames>0?'攻击强化中':s.bossSkill||'足球攻势';
  $('timer').textContent = mode==='training'?'∞':`${Math.ceil(s.remaining)}`;
  $('combo').classList.toggle('hidden',s.combo<2); $('combo').querySelector('b')!.textContent = `${s.combo}`;
  if (s.frame - liveTick >= 10 || liveTick<0) { $('fight-note').textContent = mode==='training'?'练习：靠近对手，用 J → J → J 连击；U 释放必杀。':s.bossHint; liveTick=s.frame; }
  if (s.result) finishBattle(s);
}
function selectMode(next:'story'|'training') { mode=next; $('mode-story').classList.toggle('selected',mode==='story'); $('mode-training').classList.toggle('selected',mode==='training'); }
function showRecords() {
  const p=records.profile;
  showDialog(`<div class="eyebrow">PERSONAL BEST</div><h2>每一场，都算数。</h2><p>记录只保存在当前浏览器；练习记录不参与正式排名。</p><div class="record-best"><span>首场最佳用时</span><b>${p.best?time(p.best.time):'--:--'}</b></div>${p.history.length?`<div class="record-list">${p.history.map(r=>`<div><span class="record-result ${r.won?'won':''}">${r.mode==='training'?'练习':r.won?'胜利':'落败'}</span><span>${new Date(r.date).toLocaleDateString('zh-CN')}<small>${r.maxCombo} 连击 · ${r.hitsTaken} 次受击</small></span><b>${time(r.time)}</b></div>`).join('')}</div>`:'<div class="empty-state"><span>◇</span><h3>你的第一份战绩，正在等你。</h3><p>进入竞技场，完成一场挑战后自动记录。</p></div>'}`);
}
function showBoss(id=0) {
  if(id>0){ showDialog(`<div class="eyebrow">CHALLENGER 0${id+1} / IN DEVELOPMENT</div><h2>${id===1?'许家印':'释永信'}</h2><p>这一场仍在制作计划中。</p><div class="notice">${id===1?'计划战斗风格：控制、幻象与环境攻击。':'计划战斗风格：防御、能量转移与资源封锁。'}<br><br>首场的人物动作和打击表现通过质量验收后，再开始制作后续角色与场景。</div><button class="primary-button" id="back-first"><span>查看当前可挑战角色</span><b>→</b></button>`); $('back-first').onclick=()=>showBoss(0);return; }
  showDialog(`<div class="eyebrow">CHALLENGER 01 / FOOTBALL TACTICIAN</div><h2>李铁 <span class="dialog-subtitle">足球攻势</span></h2><p>保持移动，观察球路。在每一轮攻势的间隙反击。</p><div class="boss-skill-grid"><div><b>任意球</b><span>不同角度的足球，可跳跃或闪避。</span></div><div><b>行贿上位</b><span>攻击红包，阻止抵达记分牌后的强化。</span></div><div><b>名单内定</b><span>地面提前标记，躲开连续位置突袭。</span></div><div><b>默契球 · 必杀</b><span>三次强化射门，注意高低预警与安全区。</span></div></div><div class="fact-note"><strong>人物事实与虚构玩法</strong><p>李铁曾任中国国家男子足球队主教练。2025 年 4 月 30 日，湖北省高级人民法院二审驳回上诉，维持有期徒刑二十年的原判。<a href="https://www.spp.gov.cn/spp/zdgz/202504/t20250430_694674.shtml" target="_blank" rel="noopener">查看最高检转载消息 ↗</a></p><p>上述技能名称、弹道、强化和战斗演出均为虚构游戏设计，不是现实事件复现。</p></div>`);
}
function renderDebug() {
  const moves=game.getMoveData();
  $('debug-panel').innerHTML=`<div><h3>动作与判定调试</h3><p>红：攻击框 / 绿：受击框 / 蓝：身体框。修改只对本场有效。</p></div><label>招式<select id="debug-move">${Object.values(moves).map(m=>`<option value="${m.id}">${m.name}</option>`).join('')}</select></label><div class="debug-fields" id="debug-fields"></div><button class="secondary-button debug-apply" id="debug-apply">应用本场参数</button><div class="debug-skills"><span>触发 Boss 技能</span>${['freeKick','bribe','roster','match'].map((id,i)=>`<button data-skill="${id}">${['任意球','行贿上位','名单内定','默契球'][i]}</button>`).join('')}</div>`;
  const fields=()=>{ const id=($('debug-move') as HTMLSelectElement).value;const m=game.getMoveData()[id];const labels={startup:'起手帧',active:'有效帧',recovery:'收招帧',damage:'伤害',range:'范围'}; $('debug-fields').innerHTML=Object.entries(labels).map(([k,label])=>`<label>${label}<input type="number" min="${k==='active'?1:0}" max="${k==='range'?800:500}" data-field="${k}" value="${m[k as keyof MoveData]}"/></label>`).join(''); };
  $('debug-move').onchange=fields;fields(); $('debug-apply').onclick=()=>{const id=($('debug-move') as HTMLSelectElement).value;const patch:Partial<MoveData>={};$('debug-fields').querySelectorAll<HTMLInputElement>('input').forEach(input=>{Object.assign(patch,{[input.dataset.field!]:Number(input.value)});});game.updateMove(id,patch);fields();toast('本场招式参数已应用');};
  $('debug-panel').querySelectorAll<HTMLButtonElement>('[data-skill]').forEach(b=>b.onclick=()=>{game.debugStartSkill(b.dataset.skill!);toast('调试技能已触发');});
}

$('dialog-close').onclick=closeDialog;
$('dialog').addEventListener('click',e=>{if(e.target===$('dialog'))closeDialog();});
$('profile').onclick=()=>{if(state==='playing')pauseBattle();rename();};
$('nav-lobby').onclick=()=>{if(state==='playing')pauseBattle();else returnLobby();};
$('nav-roster').onclick=()=>{if(state==='playing')pauseBattle();showBoss();};
$('all-roster').onclick=()=>showBoss();
$('nav-records').onclick=()=>{if(state==='playing')pauseBattle();showRecords();};
$('mode-story').onclick=()=>selectMode('story');$('mode-training').onclick=()=>selectMode('training');
$('start').onclick=()=>{if(!records.profile.registered)rename(true);else beginBattle();};
$('pause').onclick=pauseBattle;$('return-lobby').onclick=returnLobby;
$('sound').onclick=()=>{records.setSound(!records.profile.sound);syncProfile();toast(records.profile.sound?'声音已开启':'声音已关闭');};
$('help').onclick=()=>{if(state==='playing')pauseBattle();showDialog(`<div class="eyebrow">THE BASICS</div><h2>出拳之前，先读懂节奏。</h2><div class="help-list"><p><kbd>A / D</kbd> 左右移动，<kbd>Space</kbd> 跳跃。</p><p><kbd>J</kbd> 普攻；连续点按可衔接三段。空中也能攻击。</p><p><kbd>K</kbd> 重攻击，伤害更高，但收招更久。</p><p><kbd>S</kbd> 按住防御，减轻正面攻击伤害。</p><p><kbd>L</kbd> 闪避；精准躲过攻击会获得慢动作与能量奖励。</p><p><kbd>U</kbd> 能量满后释放必杀。命中与精准闪避积攒能量。</p><p><kbd>Esc</kbd> 暂停。切换窗口也会自动暂停。</p></div><div class="notice">建议使用 PC 键盘游玩。自由练习中的 Boss 不主动进攻，玩家以满能量开场。</div>`);};
$('about').onclick=()=>showDialog(`<div class="eyebrow">ABOUT THIS BUILD</div><h2>普通人，也有主场。</h2><p>GameX《全明星格斗》首场垂直切片 v0.1</p><div class="notice">当前提供路人甲 VS 李铁的首场挑战、自由练习、技能反制和本地战绩。完整闯关、自由 Boss 选择及 Boss 连战尚未完成。<br><br>人物与场景由 AI 原创生成，角色图集仍需逐帧校正与扩帧。本版尚未达到任务书要求的成熟街机动画质量标准。<br><br>战斗系统独立开发，仅研究 5DPLAY 公开工程的通用设计原理；未使用其代码、角色或美术音频。</div>`);
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('stage').requestFullscreen();}catch{toast('当前浏览器不支持全屏，请放大窗口游玩。');}};
$('debug').onclick=()=>{debug=!debug;game.setDebug(debug);$('debug').querySelector('span')!.textContent=debug?'ON':'OFF';$('debug-panel').classList.toggle('hidden',!debug||mode!=='training');if(debug&&mode==='training')renderDebug();else if(debug)toast('已显示判定框；招式调参请进入自由练习。');};
document.querySelectorAll<HTMLButtonElement>('[data-boss]').forEach(b=>b.onclick=()=>showBoss(Number(b.dataset.boss)));
window.addEventListener('keydown',e=>{if(e.code==='Escape'&&state==='paused'&&!($('dialog') as HTMLDialogElement).open){e.preventDefault();e.stopImmediatePropagation();resumeBattle();}});
syncProfile();
game=createGameView($('game-canvas'),{onSnapshot:updateHud,onPause:pauseBattle,onReady:()=>{ready=true;$('loading').classList.add('hidden');($('start') as HTMLButtonElement).disabled=false;syncProfile();},onError:(m)=>{$('loading').textContent=m;}});
game.setMuted(!records.profile.sound);
// 只读测试入口：便于浏览器验证状态，不允许修改游戏或写入战绩。
Object.defineProperty(window,'__gamex',{value:{getSnapshot:()=>lastSnapshot||game.getSnapshot(),getState:()=>state},configurable:true});
