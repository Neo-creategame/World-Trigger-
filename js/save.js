import {
  SAVE_KEY, BASE_TRION, TRION_PER_PT, POWER_PER_PT, POINTS, TRIGGER_HOLDER_DEF
} from './data.js';

export const SAVE = { cleared: 0 };

export const PLAYER = {
  lv: 1,
  exp: 0,
  pts: 0,
  trionPts: 0,   // 旧 hpPts（トリオン容量振り分け）
  powerPts: 0,   // 旧 atkPts（トリオン出力振り分け）
  bonusTrion: 0, // レア討伐などの永続ボーナス
  bonusPower: 0,
  points: POINTS.start // 功績ポイント（旧 gold）
};

export const TRIGGER_SLOTS = {
  normal: 'kogetsu', // 左クリック（初期は弧月）
  skillE: null,      // Eキー
  skillQ: null,      // Q / 右クリック
  opt1: null,        // 1キー
  opt2: null,        // 2キー
  opt3: null,        // 3キー
  exs: 'ibis'        // Zキー（EXS枠）
};

export const state = {
  weapon: { ...TRIGGER_HOLDER_DEF },
  exsGauge: 0,
  ownedTriggers: {
    kogetsu: 1,
    asteroid: 1,
    shield: 1,
    ibis: 1
  }
};

// 最大トリオン量
export function maxTrion() {
  return BASE_TRION + PLAYER.trionPts * TRION_PER_PT + (PLAYER.bonusTrion || 0);
}

// トリオン出力（基礎攻撃力）
export function atkTotal() {
  return TRIGGER_HOLDER_DEF.baseAtk + PLAYER.powerPts * POWER_PER_PT + (PLAYER.bonusPower || 0);
}

export const spendPoints = (n) => {
  if (PLAYER.points < n) return false;
  PLAYER.points -= n;
  return true;
};

// ---- セーブ＆ロード ----
export function saveGame() {
  try {
    const data = {
      cleared: SAVE.cleared,
      player: { ...PLAYER },
      exsGauge: state.exsGauge,
      triggerSlots: { ...TRIGGER_SLOTS },
      ownedTriggers: { ...state.ownedTriggers }
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    console.error('セーブ失敗:', e);
    return false;
  }
}

export function loadGame() {
  try {
    const json = localStorage.getItem(SAVE_KEY);
    if (!json) return false;
    const data = JSON.parse(json);

    SAVE.cleared = data.cleared || 0;
    if (data.player) Object.assign(PLAYER, data.player);
    if (data.triggerSlots) Object.assign(TRIGGER_SLOTS, data.triggerSlots);
    if (data.ownedTriggers) Object.assign(state.ownedTriggers, data.ownedTriggers);
    if (data.exsGauge != null) state.exsGauge = data.exsGauge;
    return true;
  } catch (e) {
    console.error('ロード失敗:', e);
    return false;
  }
}

loadGame();
