// ---- ワールドトリガー 3D マスターデータ ----

export const SAVE_KEY = 'wt_3d_save_data_v1';

// 隊員・トリオン体基礎定数
export const BASE_TRION = 200;
export const TRION_PER_PT = 25;
export const POWER_PER_PT = 5;
export const EXP_PER_KILL = 30;
export const expNeed = (lv) => 50 + 25 * (lv - 1);

// 功績ポイント（旧GOLD）
export const POINTS = { start: 1000, perKill: 30, perFloor: 20, bossMult: 10 };
export const pointsFor = (floor, boss) => (POINTS.perKill + POINTS.perFloor * floor) * (boss ? POINTS.bossMult : 1);

export const EXS_GAUGE_MAX = 100;

// トリガーホルダー基本スペック
export const TRIGGER_HOLDER_DEF = {
  type: 'trigger_holder',
  name: 'ボーダー標準トリガーホルダー',
  baseAtk: 100,
  cd: 300,
  range: 4.5,
  speedMult: 1.15
};

// 開発室倉庫用トリガー一覧（重複でLvUP）
export const TRIGGER_LIST = {
  // --- 通常攻撃枠（normal） ---
  kogetsu: {
    id: 'kogetsu', slotType: 'normal', name: '弧月',
    cd: 300, cost: 0,
    desc: '素早い3段斬撃コンボ（消費トリオン: 0 / LvUPで威力+20%）'
  },
  asteroid: {
    id: 'asteroid', slotType: 'normal', name: 'アステロイド',
    cd: 340, cost: 10,
    desc: 'トリオン弾を連射する標準射手トリガー（消費トリオン: 10 / LvUPで威力+20%）'
  },
  raygust: {
    id: 'raygust', slotType: 'normal', name: 'レイガスト',
    cd: 420, cost: 5,
    desc: '広範囲を薙ぎ払い敵弾をかき消す重厚ブレード（消費トリオン: 5 / LvUPで威力+20%）'
  },
  egret: {
    id: 'egret', slotType: 'normal', name: 'イーグレット',
    cd: 950, cost: 25,
    desc: '超長射程・高速スナイパーライフル。[C]キーでスコープ倍率ズーム切替（消費: 25）'
  },

  // --- スキル枠（skill: E / Q / 1 / 2 / 3 にセット可） ---
  viper: {
    id: 'viper', slotType: 'skill', name: 'バイパー',
    cd: 3800, cost: 50,
    desc: '大きく蛇行しながら死角から追尾する変化軌道弾（消費: 50）'
  },
  hound: {
    id: 'hound', slotType: 'skill', name: 'ハウンド',
    cd: 3500, cost: 75,
    desc: '敵を執拗に追尾する誘導弾を一斉発射（消費: 75）'
  },
  meteora: {
    id: 'meteora', slotType: 'skill', name: 'メテオラ',
    cd: 4800, cost: 100,
    desc: '着弾地点で大爆発を起こし周囲を吹き飛ばす炸裂弾（消費: 100）'
  },
  senku: {
    id: 'senku', slotType: 'skill', name: '旋空弧月',
    cd: 4200, cost: 100,
    desc: '刀身を伸ばし前方の敵と障害物を薙ぎ払う長距離貫通斬撃波（消費: 100）'
  },
  grasshopper: {
    id: 'grasshopper', slotType: 'skill', name: 'グラスホッパー',
    cd: 1500, cost: 10,
    desc: '緑の反発パッドを生成し入力方向（未入力時は上空）へ高速跳躍（消費: 10）'
  },
  escudo: {
    id: 'escudo', slotType: 'skill', name: 'エスクード',
    cd: 5500, cost: 75,
    desc: '前方に破壊可能な盾壁を3枚せり上げ敵の突進やレーザーを遮蔽（消費: 75）'
  },
  shield: {
    id: 'shield', slotType: 'skill', name: 'シールド',
    cd: 5000, cost: 10,
    desc: '3秒間全身にトリオン障壁を展開し被ダメ大幅軽減（消費: 10 / LvUPで軽減率UP）'
  },
  focused_shield: {
    id: 'focused_shield', slotType: 'skill', name: '集中シールド',
    cd: 4200, cost: 20,
    desc: '4秒間正面一点に小型高耐久シールドを固定。正面からの攻撃を90%カット＆弾き返す（消費: 20）'
  },
  teleporter: {
    id: 'teleporter', slotType: 'skill', name: 'テレポーター',
    cd: 3200, cost: 150,
    desc: '視線・入力方向へ障害物をすり抜けて瞬間移動（消費: 150）'
  },
  radar: {
    id: 'radar', slotType: 'skill', name: 'レーダー',
    cd: 8000, cost: 5,
    desc: '8秒間攻撃力UP＆全エリアの敵・障害物をミニマップに完全探知（消費: 5）'
  },

  // --- EXS / 必殺枠（exs: ZキーでEXSゲージ100%消費） ---
  ibis: {
    id: 'ibis', slotType: 'exs', name: 'アイビス',
    cd: 1000, cost: 150,
    desc: '【EXS】超威力・壁＆敵貫通の狙撃砲撃＋着弾大爆発（EXS100% + トリオン150）'
  },
  full_attack: {
    id: 'full_attack', slotType: 'exs', name: 'フルアタック',
    cd: 1000, cost: 300,
    desc: '【EXS】E/Q/1/2/3にセット中の全スキルトリガーをノータイム一斉同時発動（EXS100% + トリオン300）'
  }
};
