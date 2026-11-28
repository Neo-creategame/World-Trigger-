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
scene.fog = new THREE.FogExp2(0x0b0d12, 0.012);

const hemiLight = new THREE.HemisphereLight(0xa0c4ff, 0x2d3748, 1.45);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.65);
dirLight.position.set(35, 55, 35);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 1024;
dirLight.shadow.mapSize.height = 1024;
dirLight.shadow.camera.near = 1;
dirLight.shadow.camera.far = 180;
const d = 65;
dirLight.shadow.camera.left = -d;
dirLight.shadow.camera.right = d;
dirLight.shadow.camera.top = d;
dirLight.shadow.camera.bottom = -d;
scene.add(dirLight);

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 240);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
document.body.appendChild(renderer.domElement);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.addEventListener('warp-floor', (e) => {
  const target = (typeof e.detail === 'object' && e.detail !== null) ? e.detail.floor : e.detail;
  enterFloor(target);
});

const toastContainer = document.getElementById('toast-container');
function showToast(msg) {
  const el = document.createElement('div');
  el.className = 'toast-msg';
  el.textContent = msg;
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 1600);
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
let slowMoUntil = 0;

const world = new World(scene, showToast);
const enemyManager = new EnemyManager(scene, camera, world, showToast, spawnDamagePopup);
let uiManager = null;

const player = new Player(scene, camera, world, enemyManager, {
  onToast: showToast,
  onNextFloor: () => {
    if (currentFloor === 0) {
      const nextRank = Math.max(1, (SAVE.cleared || 0) + 1);
      enterFloor(nextRank);
    } else {
      enterFloor(currentFloor + 1);
    }
  },
  onBailout: () => {
    PLAYER.pts = 0;
    saveGame();
    showToast('📡 トリオン限界値到達！緊急脱出（ベイルアウト）で基地へ帰還');
    enterFloor(0);
  },
  onSlowMo: (sec) => { slowMoUntil = performance.now() + sec * 1000; },
  isUiOpen: () => uiManager ? uiManager.isOpen() : false
});

uiManager = new UIManager(player, world, enemyManager, showToast);

function enterFloor(floor) {
  currentFloor = floor;
  const layout = world.buildFloor(floor);
  player.root.position.copy(layout.playerStart);
  player.velocityY = 0;

  enemyManager.spawnForFloor(floor, layout.rivalStart);
  if (floor === 0) {
    showToast('🏢 0F ボーダー本部基地');
  }
  renderer.shadowMap.needsUpdate = true;
  saveGame();
}

enterFloor(currentFloor);

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

  floorSpan.textContent = currentFloor === 0 ? '0 (ボーダー本部基地)' : `Rank.${currentFloor} 市街地模擬戦`;
  enemyCountSpan.textContent = enemyManager.enemies.length;

  const boss = enemyManager.activeBoss;
  if (boss && boss.hp > 0) {
    bossHud.classList.remove('hidden');
    bossNameSpan.textContent = boss.name;
    bossHpBar.style.width = `${(boss.hp / boss.maxHp) * 100}%`;
    bossHpText.textContent = `TRION ${boss.hp.toLocaleString()} / ${boss.maxHp.toLocaleString()}`;
  } else {
    bossHud.classList.add('hidden');
  }

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
      ? '[F] 市街地ランク模擬戦へ転送'
      : world.portalLocked ? '🔒 対戦相手のベイルアウトで解除' : '[F] 次のランク模擬戦へ進む';
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

  nameSkill.textContent = eTrig ? eTrig.name : '未セット';
  if (!eTrig) {
    cdSkill.textContent = '-';
    cdSkill.style.color = '#718096';
  } else {
    const skillLeft = Math.max(0, player.nextSkillTime - now);
    cdSkill.textContent = skillLeft > 0 ? `${(skillLeft / 1000).toFixed(1)}s` : 'READY';
    cdSkill.style.color = skillLeft > 0 ? '#ffd36a' : '#48bb78';
  }

  nameQ.textContent = qTrig ? qTrig.name : '未セット';
  if (!qTrig) {
    cdQ.textContent = '-';
    cdQ.style.color = '#718096';
  } else {
    const qLeft = Math.max(0, player.nextQTime - now);
    cdQ.textContent = qLeft > 0 ? `${(qLeft / 1000).toFixed(1)}s` : 'READY';
    cdQ.style.color = qLeft > 0 ? '#ffd36a' : '#48bb78';
  }

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

  nameExs.textContent = zTrig ? zTrig.name : 'EXS';
  cdExs.textContent = state.exsGauge >= EXS_GAUGE_MAX ? 'READY!!' : `${Math.floor(state.exsGauge)}%`;
  cdExs.style.color = state.exsGauge >= EXS_GAUGE_MAX ? '#00ffff' : '#a0aec0';

  // スナイパースコープHUD更新
  const scopeEl = document.getElementById('sniper-scope');
  const scopeZoomLabel = document.getElementById('scope-zoom-label');
  const scopeDistLabel = document.getElementById('scope-dist-label');
  if (scopeEl) {
    if (player.zoomLevel > 0) {
      scopeEl.classList.remove('hidden');
      const zoomTable = [1.0, 2.0, 4.0, 6.0];
      scopeZoomLabel.textContent = `ZOOM ${zoomTable[player.zoomLevel].toFixed(1)}x`;
      if (boss && boss.hp > 0) {
        const dist = Math.round(player.root.position.distanceTo(boss.root.position));
        scopeDistLabel.textContent = `DIST ${dist}m`;
      } else {
        scopeDistLabel.textContent = 'DIST --m';
      }
    } else {
      scopeEl.classList.add('hidden');
    }
  }

  if (now < slowMoUntil) statusSpan.textContent = '⚡ 緊急回避スロー';
  else if (now < player.dodgeUntil) statusSpan.textContent = 'ステップ移動中';
  else if (now < player.focusedShieldUntil) statusSpan.textContent = '🛡️ 集中シールド展開中';
  else if (now < player.trionShieldUntil) statusSpan.textContent = '🔷 シールド展開中';
  else if (player.zoomLevel > 0) statusSpan.textContent = '🎯 スコープ照準中';
  else statusSpan.textContent = '戦闘待機';

  uiManager.updateMinimap(currentFloor);
}

let lastFpsTime = performance.now();
let prevFrameTime = performance.now();
let frames = 0;
// ---- 開発・デバッグ用コンソールコマンド ----
window.addPts = (amount = 10000) => {
  PLAYER.points += Number(amount);
  saveGame();
  showToast(`💰 デバッグ支給：功績ポイント +${Number(amount).toLocaleString()} PTS`);
  console.log(`現在の功績ポイント: ${PLAYER.points} PTS`);
};

window.unlockAllTriggers = () => {
  Object.keys(TRIGGER_LIST).forEach((id) => {
    state.ownedTriggers[id] = Math.max(1, state.ownedTriggers[id] || 0);
  });
  saveGame();
  showToast('💠 全トリガーを解放しました！');
};
// ==========================================
// 訓練室（模擬戦シミュレーター）UI ＆ 起動処理
// ==========================================
function openTrainingRoomModal() {
  if (document.pointerLockElement) document.exitPointerLock();

  let modal = document.getElementById('training-room-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'training-room-modal';
    modal.style.cssText = `
      position:fixed; inset:0; background:rgba(9,14,26,0.85); z-index:9999;
      display:flex; align-items:center; justify-content:center; font-family:sans-serif; color:#e2e8f0;
    `;
    modal.innerHTML = `
      <div style="background:#0f172a; border:2px solid #38bdf8; border-radius:12px; padding:24px 28px; width:440px; max-width:92vw; box-shadow:0 0 30px rgba(56,189,248,0.3);">
        <h2 style="margin:0 0 8px; color:#38bdf8; font-size:20px;">🎯 ボーダー訓練室（模擬戦設定）</h2>
        <p style="margin:0 0 18px; font-size:13px; color:#94a3b8;">フィールド環境と対戦AI編成を選択して模擬戦を開始します。</p>

        <label style="display:block; font-size:13px; margin-bottom:6px; color:#7dd3fc;">■ 模擬戦フィールド選択</label>
        <select id="tr-map-select" style="width:100%; padding:10px; margin-bottom:14px; background:#1e293b; color:#fff; border:1px solid #475569; border-radius:6px; font-size:14px;">
          <option value="industrial">🏭 工業地区（220m×220m・大型プラント＆高架パイプ・チーム戦向け）</option>
          <option value="residential">🌇 夕暮れの住宅街（184m×184m・1階4.6m住宅52棟＆河川敷）</option>
          <option value="city">🏙️ 商業オフィスビル街（184m×184m・多層ビル9棟＆連絡橋）</option>
        </select>

        <label style="display:block; font-size:13px; margin-bottom:6px; color:#7dd3fc;">■ 対戦AI人数（スクワッド規模）</label>
        <select id="tr-count-select" style="width:100%; padding:10px; margin-bottom:14px; background:#1e293b; color:#fff; border:1px solid #475569; border-radius:6px; font-size:14px;">
          <option value="1">1 vs 1（タイマン模擬戦）</option>
          <option value="2" selected>1 vs 2（ツーマンセル連携戦）</option>
          <option value="3">1 vs 3（B級上位部隊戦）</option>
          <option value="4">1 vs 4（フルスクワッド総力戦）</option>
        </select>

        <label style="display:block; font-size:13px; margin-bottom:6px; color:#7dd3fc;">■ AI強さランク</label>
        <select id="tr-rank-select" style="width:100%; padding:10px; margin-bottom:20px; background:#1e293b; color:#fff; border:1px solid #475569; border-radius:6px; font-size:14px;">
          <option value="1">C級〜B級下位相当（標準）</option>
          <option value="3" selected>B級上位相当（高機動・高精度）</option>
          <option value="6">A級精鋭相当（高耐久・高火力）</option>
        </select>

        <div style="display:flex; gap:10px; justify-content:flex-end;">
          <button id="tr-cancel-btn" style="padding:10px 16px; background:#334155; color:#e2e8f0; border:none; border-radius:6px; cursor:pointer;">閉じる</button>
          <button id="tr-start-btn" style="padding:10px 20px; background:#0284c7; color:#fff; font-weight:bold; border:none; border-radius:6px; cursor:pointer;">模擬戦スタート！</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('tr-cancel-btn').onclick = () => {
      modal.style.display = 'none';
    };

    document.getElementById('tr-start-btn').onclick = () => {
      const mapId = document.getElementById('tr-map-select').value;
      const count = parseInt(document.getElementById('tr-count-select').value, 10) || 2;
      const rankTier = parseInt(document.getElementById('tr-rank-select').value, 10) || 3;
      modal.style.display = 'none';

      // マップ構築＆プレイヤー初期位置移動
      const layout = world.buildFloor(rankTier, mapId);
      player.root.position.copy(layout.playerStart);
      player.velocityY = 0;
      player.trion = maxTrion();

      // 訓練室AIスポーン
      enemyManager.spawnTrainingMatch(layout.enemySpawns, count, rankTier);

      const mapNames = { industrial: '工業地区', residential: '夕暮れの住宅街', city: '商業ビル街' };
      showToast(`🎯 訓練開始：【${mapNames[mapId]}】敵AI ${count}機 転送完了！`);
    };
  }
  modal.style.display = 'flex';
}

window.addEventListener('open-training-room', openTrainingRoomModal);
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
    world.update(worldDt, player);
    enemyManager.update(worldDt, player);
    player.update(dt);
  }

  updateHud(now);
  renderer.render(scene, camera);
}

animate();
