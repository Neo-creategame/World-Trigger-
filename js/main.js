import * as THREE from 'three';
import { World } from './world.js';
import { EnemyManager } from './enemy.js';
import { Player } from './player.js';
import { UIManager } from './ui.js';
import { expNeed, EXS_GAUGE_MAX, TRIGGER_LIST } from './data.js';
import {
  state, SAVE, PLAYER, maxTrion, atkTotal, saveGame, TRIGGER_SLOTS
} from './save.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d12);
scene.fog = new THREE.FogExp2(0x0b0d12, 0.018);

const hemiLight = new THREE.HemisphereLight(0xa0c4ff, 0x2d3748, 1.4);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.6);
dirLight.position.set(25, 45, 25);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.camera.near = 1;
dirLight.shadow.camera.far = 150;
const d = 50;
dirLight.shadow.camera.left = -d;
dirLight.shadow.camera.right = d;
dirLight.shadow.camera.top = d;
dirLight.shadow.camera.bottom = -d;
scene.add(dirLight);

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 200);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.addEventListener('warp-floor', (e) => {
  if (typeof e.detail === 'object' && e.detail !== null) {
    enterFloor(e.detail.floor, !!e.detail.isBoss);
  } else {
    enterFloor(e.detail, false);
  }
});

const toastContainer = document.getElementById('toast-container');
function showToast(msg) {
  const el = document.createElement('div');
  el.className = 'toast-msg';
  el.textContent = msg;
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 1400);
}

const damageLayer = document.getElementById('damage-layer');
function spawnDamagePopup(worldPos, dmg, isCrit = false) {
  const projected = worldPos.clone().project(camera);
  if (projected.z > 1) return;

  const x = (projected.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-projected.y * 0.5 + 0.5) * window.innerHeight;

  const el = document.createElement('div');
  el.className = isCrit ? 'dmg-popup crit' : 'dmg-popup';
  el.textContent = isCrit ? `${dmg}!` : dmg;
  el.style.left = `${x + (Math.random() - 0.5) * 24}px`;
  el.style.top = `${y}px`;
  damageLayer.appendChild(el);
  setTimeout(() => el.remove(), 750);
}

let currentFloor = 0;
let isBossStage = false;
let slowMoUntil = 0;

const world = new World(scene, showToast);
const enemyManager = new EnemyManager(scene, camera, world, showToast, spawnDamagePopup);
let uiManager = null;

const player = new Player(scene, camera, world, enemyManager, {
  onToast: showToast,
  onNextFloor: () => {
    if (currentFloor === 0) {
      const startDungeonFloor = Math.max(1, (SAVE.cleared || 0) + 1);
      enterFloor(startDungeonFloor, false);
    } else if (!isBossStage) {
      enterFloor(currentFloor, true);
    } else {
      enterFloor(currentFloor + 1, false);
    }
  },
  onBailout: () => {
    PLAYER.pts = 0;
    saveGame();
    showToast('📡 トリオン限界値到達！緊急脱出（ベイルアウト）で基地へ帰還');
    enterFloor(0, false);
  },
  onSlowMo: (sec) => { slowMoUntil = performance.now() + sec * 1000; },
  isUiOpen: () => uiManager ? uiManager.isOpen() : false
});

uiManager = new UIManager(player, world, enemyManager, showToast);

function enterFloor(floor, bossFlag = false) {
  currentFloor = floor;
  isBossStage = bossFlag;

  const layout = world.buildFloor(floor, isBossStage);
  player.root.position.copy(layout.playerStart);
  player.velocityY = 0;

  enemyManager.spawnForFloor(floor, layout.spawnPoints, layout.bossPoint, isBossStage, layout.bossRoomCorners);
  showToast(floor === 0 ? '🏢 0F ボーダー本部基地' : isBossStage ? `⚠️ 防衛エリア ${floor}.5F 強敵反応検知！` : `⚔️ 防衛エリア ${floor}F 転送完了`);
  saveGame();
}

enterFloor(currentFloor, false);

// PointerLock
const overlay = document.getElementById('lock-overlay');
overlay.addEventListener('click', () => {
  if (!uiManager.isOpen()) document.body.requestPointerLock();
});

renderer.domElement.addEventListener('mousedown', () => {
  if (!uiManager.isOpen() && document.pointerLockElement !== document.body) {
    document.body.requestPointerLock();
  }
});

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === document.body) {
    overlay.classList.add('hidden');
  }
});

// HUD要素
const fpsSpan = document.getElementById('fps-value');
const enemyCountSpan = document.getElementById('enemy-count');
const statusSpan = document.getElementById('action-status');
const floorSpan = document.getElementById('hud-floor');
const bossHud = document.getElementById('boss-hud');
const bossNameSpan = document.getElementById('boss-name');
const bossHpBar = document.getElementById('boss-hp-bar');
const bossHpText = document.getElementById('boss-hp-text');
const interactPrompt = document.getElementById('interact-prompt');

const lvSpan = document.getElementById('hud-lv');
const hpBar = document.getElementById('hud-hp-bar');
const hpText = document.getElementById('hud-hp-text');
const expBar = document.getElementById('hud-exp-bar');
const atkSpan = document.getElementById('hud-atk');
const goldSpan = document.getElementById('hud-gold');

const mainWepSpan = document.getElementById('hud-main-wep');
const subWepSpan = document.getElementById('hud-sub-wep');

const cdDodge = document.getElementById('cd-dodge');
const cdSkill = document.getElementById('cd-skill');
const nameSkill = document.getElementById('name-skill');
const nameQ = document.getElementById('name-q');
const cdQ = document.getElementById('cd-q');
const nameExs = document.getElementById('name-exs');
const cdExs = document.getElementById('cd-exs');

function updateHud(now) {
  const mTrion = maxTrion();
  if (player.trion > mTrion) player.trion = mTrion;

  floorSpan.textContent = currentFloor === 0 ? '0 (ボーダー本部基地)' : isBossStage ? `${currentFloor}.5F (強敵戦)` : `${currentFloor}F`;
  enemyCountSpan.textContent = enemyManager.enemies.length;

  const boss = enemyManager.activeBoss;
  const extraHud = document.getElementById('boss-extra-hud');
  const weakBadge = document.getElementById('boss-weak-badge');
  const subWrap = document.getElementById('boss-sub-bar-wrap');
  const subBar = document.getElementById('boss-sub-bar');
  const subText = document.getElementById('boss-sub-text');

  if (boss && boss.hp > 0) {
    bossHud.classList.remove('hidden');
    bossNameSpan.textContent = boss.name;
    bossHpBar.style.width = `${(boss.hp / boss.maxHp) * 100}%`;
    bossHpText.textContent = `${boss.hp.toLocaleString()} / ${boss.maxHp.toLocaleString()}`;

    if (extraHud) {
      if (boss.hasAdaptiveArmor) {
        extraHud.classList.remove('hidden');
        weakBadge.classList.remove('hidden');
        const wLabel = { melee: '⚔️ 有効: 近接', ranged: '🔫 有効: 射撃', skill: '💠 有効: スキル' }[boss.weakness];
        weakBadge.textContent = boss.isAdaptiveBroken ? '💥 ARMOR BREAK!' : wLabel;
        subWrap.classList.remove('hidden');
        subBar.style.width = `${boss.breakGauge}%`;
        subText.textContent = `装甲ブレイク ${Math.floor(boss.breakGauge)}%`;
      } else {
        extraHud.classList.add('hidden');
      }
    }
  } else {
    bossHud.classList.add('hidden');
  }

  // 基地施設・転送ゲートの接近プロンプト
  const nearbyItem = world.getNearbyInteractable(player.root.position);
  const distPortal = Math.hypot(
    player.root.position.x - world.portalPos.x,
    player.root.position.z - world.portalPos.z
  );
  if (nearbyItem) {
    interactPrompt.classList.remove('hidden');
    interactPrompt.textContent = nearbyItem.label;
  } else if (distPortal <= 2.8) {
    interactPrompt.classList.remove('hidden');
    interactPrompt.textContent = currentFloor === 0
      ? '[F] 防衛エリアへ出撃する'
      : world.portalLocked ? '🔒 目標撃破でロック解除' : '[F] 次のエリアへ転送';
  } else {
    interactPrompt.classList.add('hidden');
  }

  lvSpan.textContent = PLAYER.lv;
  hpBar.style.width = `${(player.trion / mTrion) * 100}%`;
  hpText.textContent = `TRION ${Math.ceil(player.trion)} / ${mTrion}`;
  expBar.style.width = `${Math.min(100, (PLAYER.exp / expNeed(PLAYER.lv)) * 100)}%`;

  atkSpan.textContent = atkTotal().toLocaleString();
  goldSpan.textContent = PLAYER.points.toLocaleString();

  const normTrig = TRIGGER_LIST[TRIGGER_SLOTS.normal];
  const eTrig = TRIGGER_SLOTS.skillE ? TRIGGER_LIST[TRIGGER_SLOTS.skillE] : null;
  const qTrig = TRIGGER_SLOTS.skillQ ? TRIGGER_LIST[TRIGGER_SLOTS.skillQ] : null;
  const zTrig = TRIGGER_SLOTS.exs ? TRIGGER_LIST[TRIGGER_SLOTS.exs] : null;

  mainWepSpan.textContent = normTrig ? normTrig.name : '未セット';
  subWepSpan.textContent = `${eTrig ? eTrig.name : '未セット'} / ${qTrig ? qTrig.name : '未セット'}`;

  const dodgeLeft = Math.max(0, player.nextDodgeTime - now);
  cdDodge.textContent = dodgeLeft > 0 ? `${(dodgeLeft / 1000).toFixed(1)}s` : 'READY';
  cdDodge.style.color = dodgeLeft > 0 ? '#ffd36a' : '#48bb78';

  // Eスロット表示
  nameSkill.textContent = eTrig ? eTrig.name : '未セット';
  if (!eTrig) {
    cdSkill.textContent = '-';
    cdSkill.style.color = '#718096';
  } else {
    const skillLeft = Math.max(0, player.nextSkillTime - now);
    cdSkill.textContent = skillLeft > 0 ? `${(skillLeft / 1000).toFixed(1)}s` : 'READY';
    cdSkill.style.color = skillLeft > 0 ? '#ffd36a' : '#48bb78';
  }

  // Qスロット表示
  nameQ.textContent = qTrig ? qTrig.name : '未セット';
  if (!qTrig) {
    cdQ.textContent = '-';
    cdQ.style.color = '#718096';
  } else {
    const qLeft = Math.max(0, player.nextQTime - now);
    cdQ.textContent = qLeft > 0 ? `${(qLeft / 1000).toFixed(1)}s` : 'READY';
    cdQ.style.color = qLeft > 0 ? '#ffd36a' : '#48bb78';
  }

  // 1・2・3オプショナルスロット表示
  const optKeys = ['opt1', 'opt2', 'opt3'];
  for (let i = 0; i < 3; i++) {
    const sl = TRIGGER_SLOTS[optKeys[i]] ? TRIGGER_LIST[TRIGGER_SLOTS[optKeys[i]]] : null;
    document.getElementById(`sb-name-${i}`).textContent = sl ? sl.name : '未セット';
    const cdEl = document.getElementById(`sb-cd-${i}`);
    if (!sl) {
      cdEl.textContent = '-';
      cdEl.style.color = '#718096';
    } else {
      const left = Math.max(0, player.nextOptTimes[i] - now);
      cdEl.textContent = left > 0 ? `${(left / 1000).toFixed(1)}s` : 'READY';
      cdEl.style.color = left > 0 ? '#ffd36a' : '#48bb78';
    }
  }

  // Z (EXS) スロット表示
  nameExs.textContent = zTrig ? zTrig.name : 'EXS';
  cdExs.textContent = state.exsGauge >= EXS_GAUGE_MAX ? 'READY!!' : `${Math.floor(state.exsGauge)}%`;
  cdExs.style.color = state.exsGauge >= EXS_GAUGE_MAX ? '#00ffff' : '#a0aec0';

  if (now < slowMoUntil) statusSpan.textContent = '⚡ 緊急回避スロー';
  else if (now < player.dodgeUntil) statusSpan.textContent = 'ステップ移動中';
  else if (now < player.trionShieldUntil) statusSpan.textContent = '🔷 シールド展開中';
  else statusSpan.textContent = '戦闘待機';

  uiManager.updateMinimap(currentFloor);
}

let lastFpsTime = performance.now();
let prevFrameTime = performance.now();
let frames = 0;

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  let dt = Math.min((now - prevFrameTime) / 1000, 0.05);
  prevFrameTime = now;

  frames++;
  if (now >= lastFpsTime + 1000) {
    fpsSpan.textContent = frames;
    frames = 0;
    lastFpsTime = now;
  }

  if (!uiManager.isOpen()) {
    const worldDt = now < slowMoUntil ? dt * 0.25 : dt;
    world.update(worldDt);
    enemyManager.update(worldDt, player);
    player.update(dt);
  }

  updateHud(now);
  renderer.render(scene, camera);
}

animate();
