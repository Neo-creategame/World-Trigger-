import { TRIGGER_LIST, expNeed } from './data.js';
import {
  state, SAVE, PLAYER, maxTrion, atkTotal, spendPoints, saveGame, TRIGGER_SLOTS
} from './save.js';

export class UIManager {
  constructor(player, world, enemyManager, onToast) {
    this.player = player;
    this.world = world;
    this.enemyManager = enemyManager;
    this.onToast = onToast || (() => {});

    this.activeModal = null; // null | 'status' | 'base' | 'pause'
    this.baseTab = 'trigger'; // 'trigger' | 'gacha' | 'supply'
    this.selectedTriggerId = null;

    // レーダー探索履歴
    this.exploredSet = new Set();
    this.lastFloor = -1;

    this.modalOverlay = document.getElementById('modal-overlay');
    this.modalTitle = document.getElementById('modal-title');
    this.modalBody = document.getElementById('modal-body');
    this.minimapCanvas = document.getElementById('minimap-canvas');
    this.minimapCtx = this.minimapCanvas ? this.minimapCanvas.getContext('2d') : null;

    this.bindEvents();
  }

  bindEvents() {
    document.getElementById('modal-close')?.addEventListener('click', () => this.closeModal());
    document.getElementById('btn-open-bag')?.addEventListener('click', () => this.toggleModal('status'));
    document.getElementById('btn-open-town')?.addEventListener('click', () => {
      this.baseTab = 'trigger';
      this.toggleModal('base');
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        this.toggleModal('pause');
      } else if (e.code === 'KeyI') {
        e.preventDefault();
        this.toggleModal('status');
      } else if (e.code === 'KeyT') {
        e.preventDefault();
        this.baseTab = 'trigger';
        this.toggleModal('base');
      } else if (e.code === 'Escape' && this.activeModal) {
        this.closeModal();
      }
    });

    window.addEventListener('open-town-tab', (e) => {
      this.baseTab = e.detail || 'trigger';
      this.openModal('base');
    });

    this.modalOverlay?.addEventListener('click', (e) => {
      if (e.target === this.modalOverlay) this.closeModal();
    });
  }

  isOpen() {
    return this.activeModal !== null;
  }

  toggleModal(type) {
    if (this.activeModal === type) {
      this.closeModal();
    } else {
      this.openModal(type);
    }
  }

  openModal(type) {
    this.activeModal = type;
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
    this.modalOverlay.classList.remove('hidden');
    this.render();
  }

  closeModal() {
    this.activeModal = null;
    this.modalOverlay.classList.add('hidden');
    saveGame();
    try {
      document.body.requestPointerLock?.()?.catch?.(() => {});
    } catch (e) {}
  }

  render() {
    if (!this.activeModal) return;
    if (this.activeModal === 'pause') {
      this.modalTitle.textContent = '⏸ ポーズメニュー [Tab]';
      this.renderPauseScreen();
    } else if (this.activeModal === 'status') {
      this.modalTitle.textContent = '📊 ボーダー隊員ステータス [I]';
      this.renderStatusScreen();
    } else if (this.activeModal === 'base') {
      const titles = {
        trigger: '💠 トリガー開発室（ホルダー構成）',
        gacha:   '🎰 技術開発室・トリガー支給',
        supply:  '⚡ トリオン供給所'
      };
      this.modalTitle.textContent = titles[this.baseTab] || '🏢 ボーダー本部基地';
      this.renderBaseScreen();
    }
  }

  // ==========================================
  // 1. 隊員ステータス＆パラメータ振り分け画面 [I]
  // ==========================================
  renderStatusScreen() {
    const mTrion = maxTrion();
    const slotLabels = [
      { key: 'normal', name: '左クリック (通常)' },
      { key: 'skillE', name: 'E キー' },
      { key: 'skillQ', name: 'Q / 右クリック' },
      { key: 'opt1',   name: '1 キー' },
      { key: 'opt2',   name: '2 キー' },
      { key: 'opt3',   name: '3 キー' },
      { key: 'exs',    name: 'Z キー (EXS)' }
    ];

    this.modalBody.innerHTML = `
      <div class="ui-grid-2">
        <div class="ui-card">
          <h3>📊 隊員パラメータ (強化Pt: <b class="gold">${PLAYER.pts}</b>)</h3>
          <div class="stat-lines" style="line-height: 2.1;">
            <div>隊員ランク Lv.<b>${PLAYER.lv}</b> (EXP: ${PLAYER.exp} / ${expNeed(PLAYER.lv)})</div>
            <div>最大トリオン量: <b style="color:#00ffff;">${mTrion}</b> (現在: ${Math.ceil(this.player.trion)})
              ${PLAYER.pts > 0 ? `<button class="mini-btn primary" data-stat="add-trion">+1Pt (TRION+25)</button>` : ''}
            </div>
            <div>トリオン出力 (POWER): <b style="color:#ffd36a;">${atkTotal()}</b>
              ${PLAYER.pts > 0 ? `<button class="mini-btn primary" data-stat="add-power">+1Pt (POWER+5)</button>` : ''}
            </div>
            <div>保有功績ポイント: <b class="gold">${PLAYER.points.toLocaleString()} PTS</b></div>
            <div>最高踏破エリア: <b>${SAVE.cleared > 0 ? `${SAVE.cleared}.5F` : '未出撃'}</b></div>
          </div>
        </div>

        <div class="ui-card">
          <h3>💠 現在のトリガーホルダー構成</h3>
          <div class="equip-list">
            ${slotLabels.map((s) => {
              const id = TRIGGER_SLOTS[s.key];
              const tr = id ? TRIGGER_LIST[id] : null;
              const lv = tr ? (state.ownedTriggers[tr.id] || 1) : 0;
              return `
                <div class="equip-row">
                  <span>${s.name}:</span>
                  <b style="color:${tr ? '#00ffff' : '#718096'};">${tr ? `${tr.name} Lv.${lv}` : '未セット'}</b>
                </div>
              `;
            }).join('')}
          </div>
          <div style="margin-top:12px; text-align:right;">
            <button class="act-btn primary" data-stat="open-dev">トリガー構成を変更する →</button>
          </div>
        </div>
      </div>
    `;

    this.modalBody.querySelectorAll('[data-stat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const act = btn.dataset.stat;
        if (act === 'add-trion' && PLAYER.pts > 0) {
          PLAYER.pts--;
          PLAYER.trionPts++;
          this.player.trion += 25;
        } else if (act === 'add-power' && PLAYER.pts > 0) {
          PLAYER.pts--;
          PLAYER.powerPts++;
        } else if (act === 'open-dev') {
          this.baseTab = 'trigger';
          this.openModal('base');
          return;
        }
        saveGame();
        this.render();
      });
    });
  }

  // ==========================================
  // 2. ボーダー本部基地メニュー画面 [T]
  // ==========================================
  renderBaseScreen() {
    let contentHtml = '';
    if (this.baseTab === 'trigger') contentHtml = this.renderTriggerTab();
    else if (this.baseTab === 'gacha') contentHtml = this.renderGachaTab();
    else if (this.baseTab === 'supply') contentHtml = this.renderSupplyTab();

    this.modalBody.innerHTML = `
      <div class="town-header">
        <div class="tab-bar">
          <button class="tab-btn ${this.baseTab === 'trigger' ? 'active' : ''}" data-tab="trigger">💠 トリガー開発室</button>
          <button class="tab-btn ${this.baseTab === 'gacha' ? 'active' : ''}" data-tab="gacha">🎰 トリガー支給</button>
          <button class="tab-btn ${this.baseTab === 'supply' ? 'active' : ''}" data-tab="supply">⚡ トリオン供給所</button>
        </div>
        <div class="gold-disp">功績ポイント: <b class="gold">${PLAYER.points.toLocaleString()} PTS</b></div>
      </div>
      <div class="town-content">${contentHtml}</div>
    `;

    this.bindBaseEvents();
  }

  renderTriggerTab() {
    const slotDefs = [
      { key: 'normal', label: '左クリック (通常攻撃)', accept: 'normal' },
      { key: 'skillE', label: 'E キー (メインスキル)', accept: 'skill' },
      { key: 'skillQ', label: 'Q / 右クリック (サブスキル)', accept: 'skill' },
      { key: 'opt1',   label: '1 キー (オプショナル1)', accept: 'skill' },
      { key: 'opt2',   label: '2 キー (オプショナル2)', accept: 'skill' },
      { key: 'opt3',   label: '3 キー (オプショナル3)', accept: 'skill' },
      { key: 'exs',    label: 'Z キー (EXS / 必殺)', accept: 'exs' }
    ];

    const ownedIds = Object.keys(state.ownedTriggers || {});
    if (!this.selectedTriggerId && ownedIds.length > 0) {
      this.selectedTriggerId = ownedIds[0];
    }
    const selTrig = TRIGGER_LIST[this.selectedTriggerId];
    const selLv = selTrig ? (state.ownedTriggers[selTrig.id] || 1) : 1;

    return `
      <div class="ui-grid-2">
        <!-- 左カラム：トリガーホルダー 7スロット構成 -->
        <div class="ui-card">
          <h3>💠 トリガーホルダー構成（重複セット可）</h3>
          <p class="muted" style="margin-bottom:8px;">
            各ボタンにトリガーを自由に割り当てて独自の戦闘スタイルを構築できます。
          </p>
          <div class="shop-list">
            ${slotDefs.map((sd) => {
              const eqId = TRIGGER_SLOTS[sd.key];
              const tr = eqId ? TRIGGER_LIST[eqId] : null;
              const lv = tr ? (state.ownedTriggers[tr.id] || 1) : 0;
              return `
                <div class="shop-row">
                  <div>
                    <div style="font-size:11px; color:#a0aec0;">${sd.label}</div>
                    <div style="font-size:13px; color:${tr ? '#00ffff' : '#718096'}; font-weight:bold;">
                      ${tr ? `${tr.name} Lv.${lv}` : '未セット'}
                    </div>
                  </div>
                  ${tr ? `<button class="mini-btn danger" data-base="tr-clear" data-slot="${sd.key}">解除</button>` : ''}
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- 右カラム：開発室トリガー倉庫 -->
        <div class="ui-card">
          <h3>🗄️ 開発室トリガー倉庫 (${ownedIds.length} / ${Object.keys(TRIGGER_LIST).length}種)</h3>
          <div class="pack-grid" style="grid-template-columns: repeat(3, 1fr);">
            ${Object.values(TRIGGER_LIST).map((tr) => {
              const lv = state.ownedTriggers[tr.id] || 0;
              if (lv <= 0) {
                return `<div class="pack-cell empty" style="opacity:0.4;">未支給<br><small>${tr.name}</small></div>`;
              }
              const sel = this.selectedTriggerId === tr.id ? 'selected' : '';
              const badge = tr.slotType === 'normal' ? '通常' : tr.slotType === 'exs' ? 'EXS' : 'スキル';
              return `
                <div class="pack-cell ${sel}" data-base="tr-select" data-tid="${tr.id}">
                  <b>${tr.name}</b>
                  <small style="color:#ffd36a;">Lv.${lv} [${badge}]</small>
                </div>
              `;
            }).join('')}
          </div>

          <div class="detail-panel" style="margin-top:10px;">
            ${!selTrig ? `<div class="muted">所持トリガーを選択してください</div>` : `
              <div class="detail-text">
                <b>${selTrig.name} Lv.${selLv}</b>（威力補正: <b>${100 + (selLv - 1) * 20}%</b>）<br>
                <span style="font-size:11px; color:#cbd5e0;">${selTrig.desc}</span>
              </div>
              <div class="detail-actions">
                ${selTrig.slotType === 'normal' ? `
                  <button class="act-btn primary" data-base="tr-set" data-slot="normal">左クリック(通常)にセット</button>
                ` : selTrig.slotType === 'exs' ? `
                  <button class="act-btn primary" data-base="tr-set" data-slot="exs">Zキー(EXS)にセット</button>
                ` : `
                  <button class="mini-btn primary" data-base="tr-set" data-slot="skillE">Eにセット</button>
                  <button class="mini-btn primary" data-base="tr-set" data-slot="skillQ">Q/右にセット</button>
                  <button class="mini-btn primary" data-base="tr-set" data-slot="opt1">1にセット</button>
                  <button class="mini-btn primary" data-base="tr-set" data-slot="opt2">2にセット</button>
                  <button class="mini-btn primary" data-base="tr-set" data-slot="opt3">3にセット</button>
                `}
              </div>
            `}
          </div>
        </div>
      </div>
    `;
  }

  renderGachaTab() {
    return `
      <div class="ui-card center-card">
        <h3>🎰 技術開発室・新規トリガー支給</h3>
        <p style="color:#cbd5e0;">
          功績ポイントを消費して新たなトリガーの支給申請を行います。<br>
          すでに所持しているトリガーが支給された場合、自動的にレベルアップして威力が強化されます！
        </p>
        <div style="display:flex; justify-content:center; gap:16px; margin-top:18px;">
          <button class="act-btn primary" data-base="gacha" data-count="1">1回申請 (500 PTS)</button>
          <button class="act-btn primary" data-base="gacha" data-count="5">5連申請 (2,200 PTS)</button>
        </div>
      </div>
    `;
  }

  renderSupplyTab() {
    return `
      <div class="ui-card center-card">
        <h3>⚡ 本部トリオン供給所</h3>
        <p>戦闘で消耗したトリオン体を最大値まで急速充填します（無料）。</p>
        <p>現在トリオン: <b style="color:#00ffff;">${Math.ceil(this.player.trion)} / ${maxTrion()}</b></p>
        <button class="act-btn primary" data-base="supply-full">トリオンを全充填する</button>
      </div>
    `;
  }

  bindBaseEvents() {
    this.modalBody.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.baseTab = btn.dataset.tab;
        this.render();
      });
    });

    this.modalBody.querySelectorAll('[data-base]').forEach((el) => {
      el.addEventListener('click', () => {
        const act = el.dataset.base;

        if (act === 'tr-select') {
          this.selectedTriggerId = el.dataset.tid;
        } else if (act === 'tr-set') {
          const slotKey = el.dataset.slot;
          const tr = TRIGGER_LIST[this.selectedTriggerId];
          if (tr) {
            TRIGGER_SLOTS[slotKey] = tr.id;
            this.player.syncTriggerVisual?.();
            this.onToast(`💠 【${tr.name}】をセットしました！`);
          }
        } else if (act === 'tr-clear') {
          const slotKey = el.dataset.slot;
          TRIGGER_SLOTS[slotKey] = null;
          this.player.syncTriggerVisual?.();
          this.onToast('スロットを解除しました');
        } else if (act === 'supply-full') {
          this.player.trion = maxTrion();
          this.onToast('⚡ トリオン体を100%まで充填しました！');
        } else if (act === 'gacha') {
          const count = Number(el.dataset.count);
          const cost = count === 5 ? 2200 : 500;
          if (!spendPoints(cost)) return this.onToast('功績ポイントが不足しています');
          this.runTriggerGacha(count);
        }

        saveGame();
        this.render();
      });
    });
  }

  runTriggerGacha(count) {
    const results = [];
    const triggerKeys = Object.keys(TRIGGER_LIST);
    const rareTriggers = ['ibis', 'full_attack'];
    const normalTriggers = triggerKeys.filter((k) => !rareTriggers.includes(k));

    for (let i = 0; i < count; i++) {
      const r = Math.random();
      const pickId = r < 0.16
        ? rareTriggers[Math.floor(Math.random() * rareTriggers.length)]
        : normalTriggers[Math.floor(Math.random() * normalTriggers.length)];

      const trDef = TRIGGER_LIST[pickId];
      const prevLv = state.ownedTriggers[pickId] || 0;
      state.ownedTriggers[pickId] = prevLv + 1;

      if (prevLv === 0) {
        results.push(`💠新規支給【${trDef.name}】`);
      } else {
        results.push(`💠【${trDef.name}】Lv.${prevLv + 1}`);
      }
    }

    this.onToast(`🎰 支給結果: ${results.join(' / ')}`);
  }

  // ==========================================
  // ポーズメニュー画面 [Tab]
  // ==========================================
  renderPauseScreen(showFloorList = false) {
    const maxCleared = SAVE.cleared || 0;
    const nextChallengeFloor = maxCleared + 1;

    if (!showFloorList) {
      this.modalBody.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; min-height:360px; padding:16px;">
          <div style="background:rgba(30, 38, 52, 0.92); border:1px solid #4a5568; padding:10px 28px; font-size:16px; font-weight:bold; color:#cbd5e0; margin-bottom:6px;">
            作戦一時停止中 ｜ 攻略済み最高エリア: ${maxCleared > 0 ? `${maxCleared}.5F` : 'なし'} (Tabで再開)
          </div>

          <button class="pause-btn" data-pause="latest">
            ⚡ 最新の防衛エリアへ出撃 (${nextChallengeFloor}F)
          </button>

          <button class="pause-btn" data-pause="town">
            🏢 ボーダー本部基地へ帰還
          </button>

          <button class="pause-btn" data-pause="floors" ${maxCleared === 0 ? 'disabled' : ''}>
            攻略済みのエリア一覧から選ぶ
          </button>

          <button class="pause-btn" data-pause="save">
            💾 戦績データを手動セーブ
          </button>

          <button class="pause-btn" data-pause="resume">
            ▶ 作戦に戻る
          </button>
        </div>
      `;
    } else {
      const perPage = 5;
      const totalPages = Math.max(1, Math.ceil(maxCleared / perPage));
      if (this.floorPage === undefined) this.floorPage = 0;
      this.floorPage = Math.max(0, Math.min(totalPages - 1, this.floorPage));

      const startFloor = maxCleared - this.floorPage * perPage;
      const endFloor = Math.max(1, startFloor - perPage + 1);
      const floors = [];
      for (let f = startFloor; f >= endFloor; f--) floors.push(f);

      this.modalBody.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:center; justify-content:space-between; min-height:360px; padding:12px;">
          <div style="background:rgba(30, 38, 52, 0.92); border:1px solid #4a5568; padding:10px 28px; font-size:16px; font-weight:bold; color:#cbd5e0;">
            出撃エリア選択 ｜ 最高: ${maxCleared}.5F
          </div>

          <div style="display:grid; grid-template-columns:160px 160px; column-gap:90px; row-gap:14px; margin:22px 0;">
            ${floors.map((f) => `
              <button class="pause-btn" style="min-width:160px;" data-warp="${f}" data-boss="1">
                ${f}.5F (強敵戦)
              </button>
              <button class="pause-btn" style="min-width:160px;" data-warp="${f}" data-boss="0">
                ${f}F (通常戦)
              </button>
            `).join('')}
          </div>

          <div style="display:flex; gap:110px; margin-bottom:18px;">
            <button class="pause-btn" style="min-width:165px;" data-pause="prev-page" ${this.floorPage <= 0 ? 'disabled' : ''}>
              ← 前のページ
            </button>
            <button class="pause-btn" style="min-width:165px;" data-pause="next-page" ${this.floorPage >= totalPages - 1 ? 'disabled' : ''}>
              次のページ →
            </button>
          </div>

          <button class="pause-btn" style="min-width:120px;" data-pause="back">
            戻る
          </button>
        </div>
      `;
    }

    this.modalBody.querySelectorAll('[data-pause]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const act = btn.dataset.pause;
        if (act === 'resume') {
          this.closeModal();
        } else if (act === 'latest') {
          this.closeModal();
          window.dispatchEvent(new CustomEvent('warp-floor', { detail: { floor: nextChallengeFloor, isBoss: false } }));
        } else if (act === 'town') {
          this.closeModal();
          window.dispatchEvent(new CustomEvent('warp-floor', { detail: { floor: 0, isBoss: false } }));
        } else if (act === 'floors') {
          this.floorPage = 0;
          this.renderPauseScreen(true);
        } else if (act === 'prev-page') {
          this.floorPage = Math.max(0, (this.floorPage || 0) - 1);
          this.renderPauseScreen(true);
        } else if (act === 'next-page') {
          this.floorPage = (this.floorPage || 0) + 1;
          this.renderPauseScreen(true);
        } else if (act === 'back') {
          this.renderPauseScreen(false);
        } else if (act === 'save') {
          saveGame();
          this.onToast('💾 戦績データを保存しました！');
        }
      });
    });

    this.modalBody.querySelectorAll('[data-warp]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const f = Number(btn.dataset.warp);
        const isBoss = btn.dataset.boss === '1';
        this.closeModal();
        window.dispatchEvent(new CustomEvent('warp-floor', { detail: { floor: f, isBoss } }));
      });
    });
  }

  // ==========================================
  // 3. 右上レーダー（ミニマップ）更新
  // ==========================================
  updateMinimap(currentFloor) {
    if (!this.minimapCtx) return;
    this._mmTick = ((this._mmTick || 0) + 1) % 3;
    if (this._mmTick !== 0 && this.lastFloor === currentFloor) return;
    if (!this.minimapCtx) return;
    if (this.lastFloor !== currentFloor) {
      this.exploredSet.clear();
      this.lastFloor = currentFloor;
    }

    const pPos = this.player.root.position;
    const gx = Math.round(pPos.x / 4.5);
    const gz = Math.round(pPos.z / 4.5);
    if (this.player.radarUntil > performance.now()) {
      for (let rx = -22; rx <= 22; rx++) {
        for (let rz = -22; rz <= 22; rz++) {
          this.exploredSet.add(`${rx},${rz}`);
        }
      }
    }
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        this.exploredSet.add(`${gx + dx},${gz + dz}`);
      }
    }

    const ctx = this.minimapCtx;
    const w = this.minimapCanvas.width;
    const h = this.minimapCanvas.height;
    ctx.clearRect(0, 0, w, h);

    const scale = 1.65;
    const cx = w / 2;
    const cy = h / 2;

    // 探索済みエリア
    ctx.fillStyle = 'rgba(45, 55, 72, 0.72)';
    for (const key of this.exploredSet) {
      const [ex, ez] = key.split(',').map(Number);
      const sx = cx + (ex * 4.5 - pPos.x) * scale;
      const sy = cy + (ez * 4.5 - pPos.z) * scale;
      if (sx < -12 || sx > w + 12 || sy < -12 || sy > h + 12) continue;
      ctx.fillRect(sx - 3.8, sy - 3.8, 7.6, 7.6);
    }

    // 周囲の壁
    ctx.fillStyle = '#718096';
    for (const wall of this.world.walls) {
      if (wall.userData.destructible) continue;
      const sx = cx + (wall.position.x - pPos.x) * scale;
      const sy = cy + (wall.position.z - pPos.z) * scale;
      if (sx < -12 || sx > w + 12 || sy < -12 || sy > h + 12) continue;
      ctx.fillRect(sx - 3.6, sy - 3.6, 7.2, 7.2);
    }

    // 基地施設（シアン）
    for (const item of this.world.interactables) {
      const ix = cx + (item.pos.x - pPos.x) * scale;
      const iy = cy + (item.pos.z - pPos.z) * scale;
      if (ix < 0 || ix > w || iy < 0 || iy > h) continue;
      ctx.fillStyle = '#00ffff';
      ctx.fillRect(ix - 3, iy - 3, 6, 6);
    }

    // 転送ゲート（シアン / ロック時は赤）
    const px = cx + (this.world.portalPos.x - pPos.x) * scale;
    const py = cy + (this.world.portalPos.z - pPos.z) * scale;
    ctx.fillStyle = this.world.portalLocked ? '#ff2244' : '#00ffff';
    ctx.beginPath();
    ctx.arc(px, py, 4.5, 0, Math.PI * 2);
    ctx.fill();

    // 敵反応（赤点）
    for (const e of this.enemyManager.enemies) {
      const ex = cx + (e.root.position.x - pPos.x) * scale;
      const ey = cy + (e.root.position.z - pPos.z) * scale;
      if (ex < 0 || ex > w || ey < 0 || ey > h) continue;
      ctx.fillStyle = e.isBoss ? '#ff1144' : e.isRare ? '#ffd36a' : '#f56565';
      ctx.beginPath();
      ctx.arc(ex, ey, e.isBoss ? 5 : 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // 自機（中央白矢印）
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-this.player.yaw);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4, 5);
    ctx.lineTo(-4, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
