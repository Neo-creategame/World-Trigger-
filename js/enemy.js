import * as THREE from 'three';
import { EXP_PER_KILL, expNeed, pointsFor, EXS_GAUGE_MAX } from './data.js';
import { state, SAVE, PLAYER, saveGame } from './save.js';

function getBossDefinition(floor) {
  if (floor === 5) {
    return {
      type: 'rabbit_proto',
      name: '5.5F【新型トリオン兵】ラービット・プロト',
      color: 0xb15cff, scale: 2.1, hpMult: 1.25, atkMult: 1.15
    };
  }
  if (floor === 10) {
    return {
      type: 'vander_heavy',
      name: '10.5F【重砲撃型】メガ・バンダー',
      color: 0xff4500, scale: 2.4, hpMult: 1.5, atkMult: 1.35
    };
  }
  if (floor === 15) {
    return {
      type: 'neighbor_swordsman',
      name: '15.5F【人型ネイバー】黒トリガー使い',
      color: 0x00ffff, scale: 1.35, hpMult: 2.0, atkMult: 1.7
    };
  }

  const isMajor = (floor >= 10 && floor % 10 === 0);
  const title = isMajor
    ? `${floor}.5F【黒トリガー】人型ネイバー指揮官`
    : `${floor}.5F【装甲適応型】特級ラービット`;

  return {
    type: isMajor ? 'neighbor_commander' : 'rabbit_adaptive',
    name: title,
    color: isMajor ? 0xff1144 : 0x805ad5,
    scale: isMajor ? 1.5 : 2.2,
    hpMult: (isMajor ? 2.2 : 1.2) + floor * 0.02,
    atkMult: (isMajor ? 1.6 : 1.1) + floor * 0.015
  };
}

const RARE_TRION_SOLDIERS = [
  { name: '⚠️【特級捕獲型】ラービット',   color: 0xff8c00, scale: 2.3, hpMult: 3.0, atkMult: 1.6, speed: 0.085, range: 3.0, ranged: false, buffType: 'trion' },
  { name: '⚠️【高機動型】ステルスモール', color: 0x00ffff, scale: 1.6, hpMult: 2.2, atkMult: 2.4, speed: 0.145, range: 2.4, ranged: false, buffType: 'power' },
  { name: '⚠️【砲撃型】重装バンダー',     color: 0xb15cff, scale: 1.8, hpMult: 2.5, atkMult: 1.7, speed: 0.075, range: 3.2, ranged: true,  buffType: 'power' }
];

export class EnemyManager {
  constructor(scene, camera, world, onToast, onDamagePopup) {
    this.scene = scene;
    this.camera = camera;
    this.world = world;
    this.onToast = onToast || (() => {});
    this.onDamagePopup = onDamagePopup || (() => {});

    this.enemies = [];
    this.enemyProjectiles = [];
    this.hazardZones = [];
    this.activeBoss = null;
    this.enemyBeams = [];
    this.bossRoomCorners = [
      { x: -18, z: -18 }, { x: 18, z: -18 },
      { x: -18, z: 18 },  { x: 18, z: 18 }
    ];
  }

  clearAll() {
    for (const e of this.enemies) this.scene.remove(e.root);
    this.enemies = [];
    this.activeBoss = null;
    this.clearAllProjectilesAndHazards();
  }

  clearAllProjectilesAndHazards() {
    for (const p of this.enemyProjectiles) this.scene.remove(p.mesh);
    this.enemyProjectiles = [];

    for (const h of this.hazardZones) this.scene.remove(h.mesh);
    this.hazardZones = [];

    for (const b of this.enemyBeams) this.scene.remove(b.group);
    this.enemyBeams = [];
  }

  spawnForFloor(floor, spawnPoints, bossPoint, isBossFloor = false, bossRoomCorners = null) {
    this.clearAll();
    if (bossRoomCorners) this.bossRoomCorners = bossRoomCorners;

    // 標準トリオン兵バリエーション
    const mobTypes = [
      { name: 'バムスター',   color: 0xe53e3e, scale: 1.15, hp: 160, atk: 14, speed: 0.080, range: 2.4 },
      { name: 'モールモッド', color: 0x38bdf8, scale: 0.90, hp: 110, atk: 16, speed: 0.135, range: 2.1 },
      { name: 'バンダー',     color: 0xdd6b20, scale: 1.30, hp: 230, atk: 20, speed: 0.060, range: 2.6, ranged: true }
    ];
    if (floor >= 6) {
      mobTypes.push({ name: 'イルガー（爆撃型）', color: 0xd53f8c, scale: 1.25, hp: 260, atk: 26, speed: 0.110, range: 3.0, ranged: true });
    }

    const scaleMult = 1 + (floor - 1) * 0.22;

    if (!isBossFloor) {
      const rareIndex = (spawnPoints.length > 0 && Math.random() < 0.08)
        ? Math.floor(Math.random() * spawnPoints.length)
        : -1;

      spawnPoints.forEach((pt, idx) => {
        if (idx === rareIndex) {
          const rDef = RARE_TRION_SOLDIERS[Math.floor(Math.random() * RARE_TRION_SOLDIERS.length)];
          const hp = Math.round(220 * scaleMult * rDef.hpMult);
          const atk = Math.round(18 * (1 + (floor - 1) * 0.16) * rDef.atkMult);
          this.onToast(`⚠️ レーダー反応！${rDef.name} が出現！`);

          this.createEnemy({
            name: rDef.name,
            x: pt.x,
            z: pt.z,
            color: rDef.color,
            scale: rDef.scale,
            hp,
            maxHp: hp,
            atk,
            speed: rDef.speed,
            atkRange: rDef.range,
            isBoss: false,
            isRare: true,
            rareBuffType: rDef.buffType,
            ranged: rDef.ranged,
            floor
          });
          return;
        }

        const base = mobTypes[Math.floor(Math.random() * mobTypes.length)];
        const hp = Math.round(base.hp * scaleMult);
        const atk = Math.round(base.atk * (1 + (floor - 1) * 0.16));

        this.createEnemy({
          name: base.name,
          x: pt.x,
          z: pt.z,
          color: base.color,
          scale: base.scale,
          hp,
          maxHp: hp,
          atk,
          speed: base.speed,
          atkRange: base.range,
          isBoss: false,
          isRare: false,
          ranged: !!base.ranged,
          floor
        });
      });
      return;
    }

    // 強敵エリア（X.5F）
    if (bossPoint) {
      const def = getBossDefinition(floor);
      const isMajor = (floor >= 10 && floor % 10 === 0);
      const baseBossHp = isMajor ? 3400 : 1350;
      const bossHp = Math.round(baseBossHp * scaleMult * def.hpMult);
      const bossAtk = Math.round((isMajor ? 30 : 20) * (1 + (floor - 1) * 0.14) * def.atkMult);
      const weakTypes = ['melee', 'ranged', 'skill'];

      const boss = this.createEnemy({
        name: def.name,
        bossType: def.type,
        x: bossPoint.x,
        z: bossPoint.z,
        color: def.color,
        scale: def.scale,
        hp: bossHp,
        maxHp: bossHp,
        atk: bossAtk,
        speed: 0.092,
        atkRange: 4.0,
        isBoss: true,
        isRare: false,
        floor,
        enraged: false,
        lastPattern: null,
        pendingPattern: null,
        hasBarrierMechanics: isMajor,
        barrierThresholds: isMajor ? [0.75, 0.50, 0.25] : [],
        hasBarrier: false,
        hasAdaptiveArmor: floor >= 15,
        weakness: weakTypes[Math.floor(Math.random() * weakTypes.length)],
        breakGauge: 0
      });

      this.activeBoss = boss;
      if (boss.hasAdaptiveArmor) {
        const wLabel = { melee: '近接(弧月等)', ranged: '射撃(アステロイド)', skill: 'トリガースキル' }[boss.weakness];
        this.onToast(`🛡️ 装甲適応システム稼働：現在の有効攻撃は【${wLabel}】！`);
      }
    }
  }

  createEnemy(cfg) {
    const root = new THREE.Group();
    root.position.set(cfg.x, 0, cfg.z);
    this.scene.add(root);

    const s = cfg.scale;
    const mat = new THREE.MeshStandardMaterial({
      color: cfg.color,
      emissive: cfg.color,
      emissiveIntensity: cfg.isBoss ? 0.28 : 0.12,
      roughness: 0.4,
      transparent: true,
      opacity: 1.0
    });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.9 * s, 1.3 * s, 0.9 * s), mat);
    body.position.y = 0.75 * s;
    body.castShadow = true;
    root.add(body);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.65 * s, 0.65 * s, 0.65 * s), mat);
    head.position.y = 1.65 * s;
    head.castShadow = true;
    root.add(head);

    // トリオン兵特有の単眼センサー
    const eye = new THREE.Mesh(
      new THREE.BoxGeometry(0.45 * s, 0.14 * s, 0.1 * s),
      new THREE.MeshBasicMaterial({ color: 0xff1144 })
    );
    eye.position.set(0, 1.68 * s, 0.34 * s);
    root.add(eye);

    let barrierMesh = null;
    if (cfg.isBoss) {
      barrierMesh = new THREE.Mesh(
        new THREE.SphereGeometry(1.7 * s, 18, 18),
        new THREE.MeshBasicMaterial({ color: 0x00ffff, wireframe: true, transparent: true, opacity: 0.65 })
      );
      barrierMesh.position.y = 1.2 * s;
      barrierMesh.visible = false;
      root.add(barrierMesh);
    } else if (cfg.isRare) {
      const rareAura = new THREE.Mesh(
        new THREE.RingGeometry(1.1 * s, 1.45 * s, 24),
        new THREE.MeshBasicMaterial({ color: 0xffd36a, side: THREE.DoubleSide, transparent: true, opacity: 0.75 })
      );
      rareAura.rotation.x = -Math.PI / 2;
      rareAura.position.y = 0.08;
      root.add(rareAura);
      cfg._rareAura = rareAura;
    }

    const warnGeo = new THREE.RingGeometry(0.2, cfg.atkRange, 28);
    const warnMat = new THREE.MeshBasicMaterial({
      color: 0xff2244,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.0
    });
    const warnRing = new THREE.Mesh(warnGeo, warnMat);
    warnRing.rotation.x = -Math.PI / 2;
    warnRing.position.y = 0.06;
    root.add(warnRing);

    const stunBox = new THREE.Mesh(
      new THREE.BoxGeometry(1.35 * s, 2.1 * s, 1.35 * s),
      new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.32 })
    );
    stunBox.position.y = 1.05 * s;
    stunBox.visible = false;
    root.add(stunBox);

    const hpBg = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4 * s, 0.16),
      new THREE.MeshBasicMaterial({ color: 0x111111, side: THREE.DoubleSide })
    );
    hpBg.position.y = 2.4 * s;
    root.add(hpBg);

    const hpFill = new THREE.Mesh(
      new THREE.PlaneGeometry(1.34 * s, 0.11),
      new THREE.MeshBasicMaterial({ color: cfg.isBoss ? 0xff1144 : cfg.isRare ? 0xffd36a : 0xe53e3e, side: THREE.DoubleSide })
    );
    hpFill.position.set(0, 2.4 * s, 0.01);
    root.add(hpFill);

    const enemy = {
      ...cfg,
      root,
      body,
      mat,
      barrierMesh,
      warnRing,
      warnMat,
      stunBox,
      hpBg,
      hpFill,
      hpBarWidth: 1.34 * s,
      state: 'idle',
      stateTimer: 0,
      patternTimer: 2.2,
      dashVel: new THREE.Vector3(),
      stunUntil: 0,
      slowUntil: 0,
      hitFlashUntil: 0
    };

    this.enemies.push(enemy);
    return enemy;
  }

  onPlayerSkillUsed() {
    // 拡張用フック（人型ネイバーの反応行動など）
  }

  clearProjectilesInRadius(centerPos, radius) {
    let removed = 0;
    this.enemyProjectiles = this.enemyProjectiles.filter((p) => {
      if (p.mesh.position.distanceTo(centerPos) <= radius) {
        this.scene.remove(p.mesh);
        removed++;
        return false;
      }
      return true;
    });
    return removed;
  }

  activateBossBarrier(boss) {
    boss.hasBarrier = true;
    if (boss.barrierMesh) boss.barrierMesh.visible = true;
    this.onToast('🛡️ 目標が多重シールド展開！四隅の「トリオン中継結晶」を4基破壊せよ！');

    for (const oldBox of [...this.world.destructibles]) {
      this.world.destroyBlock(oldBox);
    }
    for (const c of this.bossRoomCorners) {
      this.world.addDestructibleBlock(c.x, 1.0, c.z, 0x00ffff, Math.max(40, Math.round(boss.maxHp * 0.04)));
    }
  }

  breakBossBarrier(msg = '💥 中継結晶全破壊！多重シールド解除＋2.5秒硬直！') {
    const boss = this.activeBoss;
    if (!boss) return;
    boss.hasBarrier = false;
    if (boss.barrierMesh) boss.barrierMesh.visible = false;
    boss.stunUntil = performance.now() + 2500;
    this.onToast(msg);
  }

  damageEnemy(enemy, rawDmg, opts = {}) {
    if (!enemy || enemy.hp <= 0) return false;
    const now = performance.now();
    const cat = opts.attackCategory || 'melee';

    if (enemy.isBoss && enemy.hasBarrier) {
      const popupPos = enemy.root.position.clone().add(new THREE.Vector3(0, 1.8 * enemy.scale, 0));
      this.onDamagePopup(popupPos, 'SHIELD', false);
      return false;
    }

    let dmg = Math.round(rawDmg);

    // 装甲ブレイク中の被ダメージ2.5倍
    if (enemy.stunUntil > now && enemy.isAdaptiveBroken) {
      dmg = Math.round(dmg * 2.5);
    }

    // 装甲適応システム（有効攻撃カテゴリでブレイク蓄積、不一致は軽減）
    if (enemy.isBoss && enemy.hasAdaptiveArmor && enemy.stunUntil <= now) {
      enemy.isAdaptiveBroken = false;
      if (cat === enemy.weakness) {
        dmg = Math.round(dmg * 1.25);
        const addBreak = (cat === 'skill') ? 24 : 14;
        enemy.breakGauge = Math.min(100, enemy.breakGauge + addBreak);
        if (enemy.breakGauge >= 100) {
          enemy.breakGauge = 0;
          enemy.isAdaptiveBroken = true;
          enemy.stunUntil = now + 3500;
          const weakTypes = ['melee', 'ranged', 'skill'].filter((t) => t !== enemy.weakness);
          enemy.weakness = weakTypes[Math.floor(Math.random() * weakTypes.length)];
          const wLabel = { melee: '近接(弧月等)', ranged: '射撃(アステロイド)', skill: 'トリガースキル' }[enemy.weakness];
          this.onToast(`💥 装甲ブレイク(3.5秒・被ダメ2.5倍)！次の有効攻撃は【${wLabel}】！`);
        }
      } else {
        dmg = Math.round(dmg * 0.45);
      }
    }

    enemy.hp = Math.max(0, enemy.hp - dmg);
    enemy.hitFlashUntil = now + 90;

    if (opts.stunMs) {
      enemy.stunUntil = Math.max(enemy.stunUntil, now + opts.stunMs);
      enemy.state = 'idle';
      enemy.warnMat.opacity = 0;
    }

    const popupPos = enemy.root.position.clone().add(new THREE.Vector3(0, 1.8 * enemy.scale, 0));
    this.onDamagePopup(popupPos, dmg, opts.isCrit || enemy.stunUntil > now);
    this.world.spawnHitSpark(popupPos, opts.color || 0x00ffff);

    const ratio = Math.max(0, enemy.hp / enemy.maxHp);
    enemy.hpFill.scale.x = Math.max(0.001, ratio);
    enemy.hpFill.position.x = -(1 - ratio) * (enemy.hpBarWidth * 0.5);

    if (enemy.isBoss && enemy.hp > 0) {
      if (!enemy.enraged && ratio <= 0.5) {
        enemy.enraged = true;
        this.onToast('💢 目標がリミッター解除状態に突入！攻撃速度＆弾幕強化！');
      }
      if (enemy.barrierThresholds.length > 0 && ratio <= enemy.barrierThresholds[0]) {
        enemy.barrierThresholds.shift();
        this.activateBossBarrier(enemy);
      }
    }

    if (enemy.hp <= 0) {
      this.killEnemy(enemy);
      return true;
    }
    return false;
  }

  killEnemy(enemy) {
    const pos = enemy.root.position.clone();
    for (let i = 0; i < 12; i++) {
      this.world.spawnHitSpark(pos.clone().add(new THREE.Vector3(0, 1, 0)), enemy.color);
    }

    this.scene.remove(enemy.root);
    this.enemies = this.enemies.filter((e) => e !== enemy);

    if (this.activeBoss === enemy) {
      this.activeBoss = null;
      this.clearAllProjectilesAndHazards();
      this.world.unlockExitPortal();
    }

    const expGain = EXP_PER_KILL * (enemy.isBoss ? 10 : enemy.isRare ? 3 : 1);
    const ptsGain = pointsFor(enemy.floor, enemy.isBoss) * (enemy.isRare ? 2 : 1);
    PLAYER.exp += expGain;
    PLAYER.points += ptsGain;
    state.exsGauge = Math.min(EXS_GAUGE_MAX, state.exsGauge + (enemy.isBoss ? 40 : 12));

    while (PLAYER.exp >= expNeed(PLAYER.lv)) {
      PLAYER.exp -= expNeed(PLAYER.lv);
      PLAYER.lv++;
      PLAYER.pts += 3;
      this.onToast(`🎉 隊員ランクUP! Lv.${PLAYER.lv} (強化Pt +3)`);
    }

    if (enemy.isBoss) {
      SAVE.cleared = Math.max(SAVE.cleared, enemy.floor);
      this.onToast(`🏆 ${enemy.floor}.5F 目標撃破！功績 +${ptsGain} PTS ＆ EXS+40%`);
    } else if (enemy.isRare) {
      if (enemy.rareBuffType === 'trion') {
        PLAYER.bonusTrion = (PLAYER.bonusTrion || 0) + 50;
        if (this.playerRef) this.playerRef.trion += 50;
        this.onToast('🌟 特級トリオン兵撃破！最大トリオン容量 +50（永続）！');
      } else {
        PLAYER.bonusPower = (PLAYER.bonusPower || 0) + 25;
        this.onToast('🌟 特級トリオン兵撃破！トリオン出力 +25（永続）！');
      }
    }

    saveGame();
  }

  fireEnemyOrb(enemy, dir, speed = 0.25, homing = false) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 10, 10),
      new THREE.MeshBasicMaterial({ color: homing ? 0xff00ff : enemy.color })
    );
    mesh.position.copy(enemy.root.position).add(new THREE.Vector3(0, 1.2 * enemy.scale, 0));
    this.scene.add(mesh);

    this.enemyProjectiles.push({
      mesh,
      vel: dir.clone().multiplyScalar(speed),
      atk: enemy.atk,
      life: 3.5,
      homing
    });
  }

  beginBossPatternWindup(boss) {
    const f = boss.floor;
    const warnMult = boss.enraged ? 0.7 : 1.0;

    const pool = ['omni', 'fan', 'dash'];
    if (f >= 3) pool.push('summon', 'homing');
    if (f >= 5) pool.push('shockwave');
    if (f >= 10) pool.push('eruption');
    if (f >= 15) pool.push('blaster');

    const candidates = pool.filter((p) => p !== boss.lastPattern);
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    boss.lastPattern = pick;
    boss.pendingPattern = pick;

    const baseWarn = {
      omni: 0.8, fan: 0.6, dash: 0.9, summon: 1.0,
      homing: 0.7, shockwave: 1.1, eruption: 1.8, blaster: 1.2
    }[pick] || 0.8;

    boss.state = 'pattern_windup';
    boss.stateTimer = baseWarn * warnMult;
  }

  executeBossPattern(boss, targetPos) {
    const pick = boss.pendingPattern;
    const f = boss.floor;
    const enraged = boss.enraged;
    const toP = targetPos.clone().sub(boss.root.position).setY(0).normalize();

    if (pick === 'omni') {
      const count = enraged ? 18 : 12;
      for (let i = 0; i < count; i++) {
        const ang = (Math.PI * 2 * i) / count;
        this.fireEnemyOrb(boss, new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang)), 0.24);
      }
    } else if (pick === 'fan') {
      const count = enraged ? 7 : 5;
      const spread = 0.16;
      for (let i = 0; i < count; i++) {
        const off = (i - (count - 1) / 2) * spread;
        const d = toP.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), off);
        this.fireEnemyOrb(boss, d, 0.27);
      }
    } else if (pick === 'dash') {
      boss.state = 'dash';
      boss.stateTimer = 0.55;
      boss.dashVel.copy(toP).multiplyScalar(0.36);
      return;
    } else if (pick === 'summon') {
      const minionCount = this.enemies.filter((e) => !e.isBoss).length;
      if (minionCount < 5) {
        const addCount = enraged ? 2 : 1;
        for (let i = 0; i < addCount; i++) {
          const sx = boss.root.position.x + (Math.random() - 0.5) * 6;
          const sz = boss.root.position.z + (Math.random() - 0.5) * 6;
          this.createEnemy({
            name: '増援モールモッド',
            x: sx, z: sz,
            color: 0x38bdf8, scale: 0.9,
            hp: Math.round(boss.maxHp * 0.08),
            maxHp: Math.round(boss.maxHp * 0.08),
            atk: Math.round(boss.atk * 0.5),
            speed: 0.12, atkRange: 2.1,
            isBoss: false, isRare: false, floor: f
          });
        }
        this.onToast('👾 目標が増援トリオン兵を展開した！');
      }
    } else if (pick === 'homing') {
      this.fireEnemyOrb(boss, toP, 0.21, true);
    } else if (pick === 'shockwave') {
      this.spawnHazardZone(boss.root.position.x, boss.root.position.z, 6.2, 0.35, Math.round(boss.atk * 1.3), 0xb15cff, false);
    } else if (pick === 'eruption') {
      this.onToast('⚠️ 広域トリオン爆撃！足元の「緑の安全地帯円」へ退避せよ！');
      this.spawnHazardZone(targetPos.x, targetPos.z, 6.8, 0.85, Math.round(boss.atk * 1.8), 0x48bb78, true);
    } else if (pick === 'blaster') {
      const count = enraged ? 4 : 3;
      this.onToast('⚡ 高出力トリオン砲照準！赤い射線から離脱せよ！');
      const baseAngle = Math.random() * Math.PI * 2;
      for (let i = 0; i < count; i++) {
        const angle = baseAngle + (Math.PI * 2 * i) / count;
        const startPos = new THREE.Vector3(
          targetPos.x + Math.cos(angle) * 14,
          0,
          targetPos.z + Math.sin(angle) * 14
        );
        const dir = targetPos.clone().sub(startPos).setY(0).normalize();
        this.fireBossCannon(startPos, dir, Math.round(boss.atk * 1.65));
      }
    }

    boss.state = 'chase';
  }

  spawnHazardZone(x, z, radius, delaySec, atk, color, isSafeZone = false) {
    const geo = isSafeZone
      ? new THREE.RingGeometry(radius - 0.4, radius, 32)
      : new THREE.CircleGeometry(radius, 28);
    const ring = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.45 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.09, z);
    this.scene.add(ring);

    this.hazardZones.push({
      mesh: ring,
      pos: new THREE.Vector3(x, 0, z),
      radius,
      timer: delaySec,
      maxTimer: delaySec,
      atk,
      color,
      isSafeZone
    });
  }

  fireBossCannon(startPos, dir, atk) {
    const length = 30;
    const width = 1.6;
    const midPos = startPos.clone().addScaledVector(dir, length * 0.5);
    const rotY = Math.atan2(dir.x, dir.z);

    const warnMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, length),
      new THREE.MeshBasicMaterial({ color: 0xff1144, side: THREE.DoubleSide, transparent: true, opacity: 0.45 })
    );
    warnMesh.rotation.x = -Math.PI / 2;
    warnMesh.rotation.z = -rotY;
    warnMesh.position.set(midPos.x, 0.08, midPos.z);
    this.scene.add(warnMesh);

    const pod = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 1.3, 1.8),
      new THREE.MeshStandardMaterial({ color: 0x1a202c, emissive: 0xff1144, emissiveIntensity: 0.5 })
    );
    pod.position.set(startPos.x, 1.4, startPos.z);
    pod.rotation.y = rotY;
    this.scene.add(pod);

    setTimeout(() => {
      this.scene.remove(warnMesh);
      if (!this.activeBoss || this.activeBoss.hp <= 0) {
        this.scene.remove(pod);
        return;
      }

      const group = new THREE.Group();
      group.add(pod);

      const outerGeo = new THREE.CylinderGeometry(width * 0.65, width * 0.65, length, 14, 1, true);
      outerGeo.rotateX(Math.PI / 2);
      const outerMat = new THREE.MeshBasicMaterial({
        color: 0xff1144, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false
      });
      const outerBeam = new THREE.Mesh(outerGeo, outerMat);
      outerBeam.position.set(midPos.x, 1.3, midPos.z);
      outerBeam.rotation.y = rotY;
      group.add(outerBeam);

      const innerGeo = new THREE.CylinderGeometry(width * 0.32, width * 0.32, length, 12);
      innerGeo.rotateX(Math.PI / 2);
      const innerMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 });
      const innerBeam = new THREE.Mesh(innerGeo, innerMat);
      innerBeam.position.set(midPos.x, 1.3, midPos.z);
      innerBeam.rotation.y = rotY;
      group.add(innerBeam);

      this.scene.add(group);
      this.enemyBeams.push({ group, outerBeam, innerBeam, life: 0.4, maxLife: 0.4 });

      if (this.playerRef && this.playerRef.root.position.y < 2.2) {
        const p = this.playerRef.root.position;
        const apx = p.x - startPos.x;
        const apz = p.z - startPos.z;
        const proj = apx * dir.x + apz * dir.z;
        if (proj >= -0.5 && proj <= length + 0.5) {
          const perpDist = Math.abs(apx * dir.z - apz * dir.x);
          if (perpDist <= width * 0.65) {
            this.playerRef.receiveEnemyAttack(atk, startPos);
          }
        }
      }
    }, 650);
  }

  update(dt, player) {
    this.playerRef = player;
    const now = performance.now();
    const pPos = player.root.position;

    if (this.activeBoss && this.activeBoss.hasBarrier && this.world.destructibles.length === 0) {
      this.breakBossBarrier();
    }

    this.enemyBeams = this.enemyBeams.filter((b) => {
      b.life -= dt;
      const ratio = Math.max(0, b.life / b.maxLife);
      b.outerBeam.scale.set(ratio, ratio, 1);
      b.innerBeam.scale.set(ratio, ratio, 1);
      b.outerBeam.material.opacity = ratio * 0.6;
      b.innerBeam.material.opacity = ratio * 0.95;
      if (b.life <= 0) {
        this.scene.remove(b.group);
        return false;
      }
      return true;
    });

    this.hazardZones = this.hazardZones.filter((h) => {
      h.timer -= dt;
      h.mesh.material.opacity = 0.3 + (1 - Math.max(0, h.timer / h.maxTimer)) * 0.6;
      if (h.timer <= 0) {
        const dist = Math.hypot(pPos.x - h.pos.x, pPos.z - h.pos.z);
        if (h.isSafeZone) {
          if (dist > h.radius) player.receiveEnemyAttack(h.atk, h.pos);
        } else {
          for (let i = 0; i < 8; i++) {
            this.world.spawnHitSpark(h.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), h.color);
          }
          if (dist <= h.radius && pPos.y < 1.6) {
            player.receiveEnemyAttack(h.atk, h.pos);
          }
        }
        this.scene.remove(h.mesh);
        return false;
      }
      return true;
    });

    for (const enemy of [...this.enemies]) {
      enemy.hpBg.lookAt(this.camera.position);
      enemy.hpFill.lookAt(this.camera.position);
      if (enemy._rareAura) {
        enemy._rareAura.rotation.z += dt * 2.2;
      }

      if (now < enemy.hitFlashUntil) {
        enemy.mat.emissive.setHex(0xffffff);
        enemy.mat.emissiveIntensity = 0.85;
      } else if (enemy.state === 'pattern_windup') {
        const blink = Math.sin(now * 0.035) > 0;
        enemy.mat.emissive.setHex(blink ? 0xff1133 : enemy.color);
        enemy.mat.emissiveIntensity = blink ? 0.9 : 0.25;
      } else {
        enemy.mat.emissive.setHex(enemy.color);
        enemy.mat.emissiveIntensity = enemy.isBoss ? 0.28 : 0.12;
      }

      if (now < enemy.stunUntil) {
        enemy.warnMat.opacity = 0;
        enemy.stunBox.visible = true;
        enemy.stunBox.rotation.y += dt * 2.5;
        continue;
      } else {
        enemy.stunBox.visible = false;
      }

      const speedMult = now < enemy.slowUntil ? 0.45 : 1.0;
      const toTarget = new THREE.Vector3(pPos.x - enemy.root.position.x, 0, pPos.z - enemy.root.position.z);
      const dist = toTarget.length();
      const dir = dist > 0.01 ? toTarget.clone().normalize() : new THREE.Vector3(0, 0, 1);

      if (enemy.isBoss) {
        if (enemy.state === 'pattern_windup') {
          enemy.stateTimer -= dt;
          enemy.warnMat.opacity = 0.45;
          if (enemy.stateTimer <= 0) {
            enemy.warnMat.opacity = 0;
            this.executeBossPattern(enemy, pPos);
          }
          continue;
        }

        if (enemy.state === 'dash') {
          enemy.stateTimer -= dt;
          const nx = enemy.root.position.x + enemy.dashVel.x * speedMult;
          const nz = enemy.root.position.z + enemy.dashVel.z * speedMult;
          if (!this.world.isBlockedForEntity(nx, nz, 0.5 * enemy.scale)) {
            enemy.root.position.set(nx, 0, nz);
          }
          if (enemy.root.position.distanceTo(pPos) < 1.8 * enemy.scale) {
            player.receiveEnemyAttack(Math.round(enemy.atk * 1.5), enemy.root.position);
          }
          if (enemy.stateTimer <= 0) enemy.state = 'chase';
          continue;
        }

        if (dist <= 28) {
          enemy.patternTimer -= dt;
          if (enemy.patternTimer <= 0) {
            enemy.patternTimer = enemy.enraged ? 1.4 : 2.2;
            this.beginBossPatternWindup(enemy);
            continue;
          }
        }
      }

      const aggroRange = enemy.isBoss ? 26 : 22;
      if (dist > aggroRange && enemy.state === 'idle') continue;

      if (enemy.state === 'idle' || enemy.state === 'chase') {
        enemy.state = 'chase';
        enemy.root.rotation.y = Math.atan2(dir.x, dir.z);

        const stopDist = enemy.ranged ? 9.0 : enemy.atkRange * 0.85;
        if (dist > stopDist) {
          const nextX = enemy.root.position.x + dir.x * enemy.speed * speedMult;
          const nextZ = enemy.root.position.z + dir.z * enemy.speed * speedMult;
          if (!this.world.isBlockedForEntity(nextX, enemy.root.position.z, 0.5 * enemy.scale)) {
            enemy.root.position.x = nextX;
          }
          if (!this.world.isBlockedForEntity(enemy.root.position.x, nextZ, 0.5 * enemy.scale)) {
            enemy.root.position.z = nextZ;
          }
        } else {
          enemy.state = 'windup';
          enemy.stateTimer = (enemy.isBoss ? 0.65 : 0.55) * (enemy.enraged ? 0.7 : 1.0);
        }
      } else if (enemy.state === 'windup') {
        enemy.stateTimer -= dt;
        const progress = 1 - Math.max(0, enemy.stateTimer / 0.65);
        enemy.warnMat.opacity = 0.2 + progress * 0.65;
        enemy.warnRing.scale.setScalar(0.5 + progress * 0.5);

        if (enemy.stateTimer <= 0) {
          enemy.warnMat.opacity = 0;
          enemy.state = 'cooldown';
          enemy.stateTimer = enemy.isBoss ? (enemy.enraged ? 0.8 : 1.1) : 1.3;

          if (enemy.ranged) {
            this.fireEnemyOrb(enemy, dir, 0.22);
          } else if (dist <= enemy.atkRange + 0.6) {
            player.receiveEnemyAttack(enemy.atk, enemy.root.position);
          }
        }
      } else if (enemy.state === 'cooldown') {
        enemy.stateTimer -= dt;
        if (enemy.stateTimer <= 0) enemy.state = 'chase';
      }
    }

    this.enemyProjectiles = this.enemyProjectiles.filter((p) => {
      p.life -= dt;
      if (p.homing) {
        const target = pPos.clone().add(new THREE.Vector3(0, 1.0, 0));
        const toT = target.sub(p.mesh.position).normalize();
        const spd = p.vel.length();
        p.vel.lerp(toT.multiplyScalar(spd), 0.06).normalize().multiplyScalar(spd);
      }
      p.mesh.position.add(p.vel);

      const dPlayer = p.mesh.position.distanceTo(pPos.clone().add(new THREE.Vector3(0, 1.0, 0)));
      if (dPlayer < 0.85) {
        player.receiveEnemyAttack(p.atk, p.mesh.position);
        this.scene.remove(p.mesh);
        return false;
      }

      if (p.life <= 0 || this.world.isBlockedForEntity(p.mesh.position.x, p.mesh.position.z, 0.25)) {
        this.scene.remove(p.mesh);
        return false;
      }
      return true;
    });
  }
}
