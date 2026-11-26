<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WORLD TRIGGER 3D - BORDER ACTION</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="./css/style.css">
</head>
<body>

<div id="crosshair"></div>
<div id="damage-layer"></div>
<div id="toast-container"></div>

<!-- 中央上：エリア表示＆強敵（トリオン兵/人型ネイバー）巨大HPバー -->
<div id="hud-top-center">
  <div class="floor-badge">エリア <span id="hud-floor">0 (ボーダー本部基地)</span></div>
  <div id="boss-hud" class="hidden">
    <div id="boss-name" class="boss-title">TARGET</div>
    <div class="boss-bar-wrap">
      <div id="boss-hp-bar" class="boss-hp-fill"></div>
      <span id="boss-hp-text" class="bar-label">1000 / 1000</span>
    </div>
    <div id="boss-extra-hud" class="boss-extra-row hidden">
      <span id="boss-weak-badge" class="weak-badge hidden">弱点: 近接</span>
      <div id="boss-sub-bar-wrap" class="boss-sub-wrap hidden">
        <div id="boss-sub-bar" class="boss-sub-fill"></div>
        <span id="boss-sub-text" class="bar-label">装甲ブレイク 0%</span>
      </div>
    </div>
  </div>
</div>

<!-- 施設・転送ゲート接近時のインタラクト表示 -->
<div id="interact-prompt" class="hidden">[F] 実行</div>

<!-- 左上：隊員トリオン＆ステータスHUD -->
<div id="hud-top-left" class="hud-panel">
  <div class="lv-badge">Lv.<span id="hud-lv">1</span></div>
  <div class="bars">
    <div class="bar-wrap hp-wrap">
      <div id="hud-hp-bar" class="bar-fill special-fill"></div>
      <span id="hud-hp-text" class="bar-label">TRION 200 / 200</span>
    </div>
    <div class="bar-wrap exp-wrap">
      <div id="hud-exp-bar" class="bar-fill exp-fill"></div>
    </div>
    <div class="stat-sub">
      <span>POWER <b id="hud-atk">100</b></span>
      <span>PTS <b id="hud-gold">1,000</b></span>
    </div>
  </div>
</div>

<!-- 左下：セット中のメイン/サブトリガー構成 -->
<div id="hud-bottom-left" class="hud-panel">
  <div class="weapon-row main-wep">
    <span class="tag">通常 [左]</span>
    <span id="hud-main-wep">弧月</span>
  </div>
  <div class="weapon-row sub-wep">
    <span class="tag">E / Q</span>
    <span id="hud-sub-wep">未セット / 未セット</span>
  </div>
  <div class="weapon-row potion-row">
    <span class="tag">状態</span>
    <span style="color:#00ffff;">トリオン体稼働中</span>
  </div>
</div>

<!-- 右上：レーダー（ミニマップ）・メニューボタン・FPS -->
<div id="hud-top-right-wrap">
  <div id="minimap-box">
    <canvas id="minimap-canvas" width="136" height="136"></canvas>
  </div>
  <div class="hud-panel mini-info">
    <div>FPS: <span id="fps-value">0</span> | 残敵: <span id="enemy-count">0</span></div>
    <div id="action-status" class="status-text">戦闘待機</div>
    <div class="menu-shortcuts">
      <button id="btn-open-bag" class="hud-btn">[I] 隊員ステータス</button>
      <button id="btn-open-town" class="hud-btn">[T] トリガー開発室</button>
    </div>
  </div>
</div>

<!-- 右下：トリガースロット（1・2・3・Shift・Q・E・Z） -->
<div id="hud-bottom-right">
  <div id="spellbook-hud-slots" style="display:flex; gap:8px;">
    <div class="skill-slot sb-slot"><span class="key-hint">1</span><span class="slot-icon" id="sb-name-0">未セット</span><span class="slot-cd" id="sb-cd-0">-</span></div>
    <div class="skill-slot sb-slot"><span class="key-hint">2</span><span class="slot-icon" id="sb-name-1">未セット</span><span class="slot-cd" id="sb-cd-1">-</span></div>
    <div class="skill-slot sb-slot"><span class="key-hint">3</span><span class="slot-icon" id="sb-name-2">未セット</span><span class="slot-cd" id="sb-cd-2">-</span></div>
  </div>
  <div class="skill-slot" id="slot-dodge">
    <span class="key-hint">Shift</span>
    <span class="slot-icon">緊急回避</span>
    <span class="slot-cd" id="cd-dodge">READY</span>
  </div>
  <div class="skill-slot" id="slot-q">
    <span class="key-hint">Q / 右ｸﾘｯｸ</span>
    <span class="slot-icon" id="name-q">未セット</span>
    <span class="slot-cd" id="cd-q">-</span>
  </div>
  <div class="skill-slot" id="slot-skill">
    <span class="key-hint">E</span>
    <span class="slot-icon" id="name-skill">未セット</span>
    <span class="slot-cd" id="cd-skill">-</span>
  </div>
  <div class="skill-slot exs-slot" id="slot-exs">
    <span class="key-hint">Z (EXS)</span>
    <span class="slot-icon" id="name-exs">アイビス</span>
    <span class="slot-cd" id="cd-exs">0%</span>
  </div>
</div>

<!-- モーダルウィンドウ -->
<div id="modal-overlay" class="hidden">
  <div class="modal-window">
    <div class="modal-header">
      <h2 id="modal-title">メニュー</h2>
      <button id="modal-close" class="close-btn">✕ 閉じる</button>
    </div>
    <div id="modal-body" class="modal-body"></div>
  </div>
</div>

<!-- 操作ガイド -->
<div id="lock-overlay">
  <div class="overlay-box">
    <h2>画面をクリックしてトリオン体起動</h2>
    <p>WASD: 移動 / マウス: 視点操作 / Space: ジャンプ / F: 施設・転送ゲート起動</p>
    <p>左クリック: 通常トリガー / E・Q(右クリック)・1・2・3: セットトリガー / Shift: 緊急回避 / Z: EXS</p>
    <p class="sub-note">[I] 隊員ステータス強化 / [T] トリガー開発室・トリガー支給 / [Tab] ポーズ・エリア移動</p>
  </div>
</div>

<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js"
  }
}
</script>
<script type="module" src="./js/main.js"></script>
</body>
</html>
