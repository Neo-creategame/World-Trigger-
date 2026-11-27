import * as THREE from 'three';
import { EXP_PER_KILL, expNeed, pointsFor, EXS_GAUGE_MAX } from './data.js';
import { state, SAVE, PLAYER, saveGame } from './save.js';

// ランク戦対戦相手（ボーダー隊員AIアーキタイプ）
const RIVAL_ARCHETYPES = [
  {
    role: 'attacker',
    title: '攻撃手（アタッカー）',
    names: ['C級攻撃手・荒船訓練生', 'B級攻撃手・村上鋼モデル', 'B級攻撃手・生駒達人モデル', 'A級1位・太刀川慶モデル'],
    color: 0x48bb78,
    visorColor: 0x00ffff,
    trionMult: 1.0,
    powerMult: 1.15,
    speed: 0.155,
    preferredDist: 3.4,
    aiReaction: 0.72
  },
  {
    role: 'shooter',
    title: '射手（シューター）',
    names: ['C級射手・訓練生', 'B級射手・那須玲モデル', 'B級射手・出水公平モデル', 'A級級射手・二宮匡貴モデル'],
    color: 0x38bdf8,
    visorColor: 0xffd36a,
    trionMult: 1.25,
    powerMult: 1.05,
    speed: 0.135,
    preferredDist: 14.0,
    aiReaction: 0.78
  },
  {
    role: 'sniper',
    title: '狙撃手（スナイパー）',
    names: ['C級狙撃手・千佳訓練生', 'B級狙撃手・半崎義人モデル', 'A級狙撃手・当真勇モデル', 'A級狙撃手・東春秋モデル'],
    color: 0xef4444,
    visorColor: 0xff4444,
    trionMult: 0.95,
    powerMult: 1.45,
    speed: 0.13,
    preferredDist: 34.0,
    aiReaction: 0.85
  },
  {
    role: 'allrounder',
    title: '万能手（オールラウンダー）',
    names: ['B級万能手・三雲修モデル', 'B級万能手・諏訪洸太郎モデル', 'A級万能手・嵐山准モデル', 'A級万能手・木崎レイジモデル'],
    color: 0xa855f7,
    visorColor: 0x00ffff,
    trionMult: 1.15,
    powerMult: 1.10,
    speed: 0.145,
    preferredDist: 8.5,
    aiReaction: 0.82
  }
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
    this.fxMeshes = [];
  }

  clearAll() {
    for (const e of this.enemies) {
      if (e.laserLine) this.scene.remove(e.laserLine);
      this.scene.remove(e.root);
    }
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

    for (const f of this.fxMeshes) this.scene.remove(f.mesh);
    this.fxMeshes = [];
  }

  spawnForFloor(floor, rivalStart) {
    this.clearAll();
    if (floor === 0 || !rivalStart) return;

    const arch = RIVAL_ARCHETYPES[(floor - 1) % RIVAL_ARCHETYPES.length];
    const tierIdx = Math.min(arch.names.length - 1, Math.floor((floor - 1) / 4));
    const rivalName = `【Rank.${floor}】${arch.names[tierIdx]}`;

    const baseTrion = 320 + (floor - 1) * 95;
    const maxHp = Math.round(baseTrion * arch.trionMult);
    const atk = Math.round((24 + (floor - 1) * 5) * arch.powerMult);

    // スナイパーの場合は高所屋上（北西ビル屋上）からスタートさせる
    const spawnPos = arch.role === 'sniper'
      ? new THREE.Vector3(-34, 19.5, -32)
      : rivalStart.clone();

    const rival = this.createRivalAgent({
      name: rivalName,
      role: arch.role,
      x: spawnPos.x,
      y: spawnPos.y || 0,
      z: spawnPos.z,
      color: arch.color,
      visorColor: arch.visorColor,
      scale: 1.0,
      hp: maxHp,
      maxHp,
      aiTrion: maxHp,
      aiMaxTrion: maxHp,
      atk,
      speed: arch.speed,
      preferredDist: arch.preferredDist,
      aiReaction: Math.min(0.95, arch.aiReaction + floor * 0.015),
      floor
    });

    this.activeBoss = rival;
    this.onToast(`⚔️ ランク模擬戦開始！対戦相手：${rivalName}（${arch.title}）`);
  }

  createRivalAgent(cfg) {
    const root = new THREE.Group();
    root.position.set(cfg.x, cfg.y || 0, cfg.z);
    this.scene.add(root);

    const mat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      emissive: cfg.color,
      emissiveIntensity: 0.15,
      roughness: 0.4
    });

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 0.9, 6, 12), mat);
    body.position.y = 0.85;
    body.castShadow = true;
    root.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.3 })
    );
    head.position.y = 1.75;
    head.castShadow = true;
    root.add(head);

    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.12, 0.2),
      new THREE.MeshBasicMaterial({ color: cfg.visorColor })
    );
    visor.position.set(0, 1.78, 0.26);
    root.add(visor);

    // 弧月ブレード（アタッカー・オールラウンダー用）
    const swordPivot = new THREE.Group();
    swordPivot.position.set(-0.5, 1.1, 0.1);
    root.add(swordPivot);

    const bladeMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 1.45, 0.16),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: cfg.color, emissiveIntensity: 0.65 })
    );
    bladeMesh.position.set(0, 0.65, 0.25);
    bladeMesh.rotation.x = 0.35;
    bladeMesh.visible = cfg.role === 'attacker' || cfg.role === 'allrounder';
    swordPivot.add(bladeMesh);

    // スナイパーライフル銃身（スナイパー用）
    if (cfg.role === 'sniper') {
      const rifle = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.14, 1.9),
        new THREE.MeshStandardMaterial({ color: 0x0f172a, emissive: 0xef4444, emissiveIntensity: 0.35 })
      );
      rifle.position.set(0.35, 1.35, 0.75);
      root.add(rifle);
    }

    // AIシールド
    const shieldBubble = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.3, 1),
      new THREE.MeshBasicMaterial({ color: 0x00ffff, wireframe: true, transparent: true, opacity: 0.6 })
    );
    shieldBubble.position.y = 1.1;
    shieldBubble.visible = false;
    root.add(shieldBubble);

    // 狙撃レーザーサイト（予兆線）
    const laserGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, 1)
    ]);
    const laserMat = new THREE.LineBasicMaterial({ color: 0xff2244, transparent: true, opacity: 0.85 });
    const laserLine = new THREE.Line(laserGeo, laserMat);
    laserLine.visible = false;
    this.scene.add(laserLine);

    // 頭上HPバー
    const hpBg = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4, 0.15),
      new THREE.MeshBasicMaterial({ color: 0x111111, side: THREE.DoubleSide })
    );
    hpBg.position.y = 2.35;
    root.add(hpBg);

    const hpFill = new THREE.Mesh(
      new THREE.PlaneGeometry(1.34, 0.10),
      new THREE.MeshBasicMaterial({ color: cfg.color, side: THREE.DoubleSide })
    );
    hpFill.position.set(0, 2.35, 0.01);
    root.add(hpFill);

    const agent = {
      ...cfg,
      root,
      body,
      mat,
      swordPivot,
      shieldBubble,
      laserLine,
      hpBg,
      hpFill,
      hpBarWidth: 1.34,
      isBoss: true,
      isRivalAgent: true,

      aiState: 'flank',
      aiDecisionTimer: 0.35,
      strafeSign: Math.random() < 0.5 ? 1 : -1,
      velocityY: 0,
      onGround: true,

      cdNormal: 0,
      cdSub: 0,
      cdMobility: 0,
      cdShield: 0,
      shieldUntil: 0,
      dodgeUntil: 0,
      dodgeVel: new THREE.Vector3(),
      stunUntil: 0,
      hitFlashUntil: 0,
      windupTimer: 0,
      pendingSkill: null,
      lockedAimPos: null
    };

    this.enemies.push(agent);
    return agent;
  }

  onPlayerSkillUsed(playerPos) {
    const now = performance.now();
    for (const agent of this.enemies) {
      if (!agent.isRivalAgent || agent.hp <= 0 || now < agent.stunUntil) continue;
      const dist = agent.root.position.distanceTo(playerPos);
      if (dist > 32) continue;

      if (Math.random() < agent.aiReaction) {
        if (now >= agent.cdShield && agent.aiTrion >= 15) {
          this.activateAgentShield(agent, 2200);
        } else if (now >= agent.cdMobility && agent.aiTrion >= 15) {
          this.useAgentGrasshopper(agent, playerPos, 'evade');
        }
      }
    }
  }

  activateAgentShield(agent, durationMs = 2400) {
    const now = performance.now();
    agent.aiTrion = Math.max(0, agent.aiTrion - 10);
    agent.shieldUntil = now + durationMs;
    agent.cdShield = now + 5200;
    agent.shieldBubble.visible = true;
  }

  useAgentGrasshopper(agent, targetPos, mode = 'approach') {
    const now = performance.now();
    if (now < agent.cdMobility || agent.aiTrion < 10) return false;
    agent.aiTrion -= 10;
    agent.cdMobility = now + 2200;

    const pad = new THREE.Mesh(
      new THREE.RingGeometry(0.4, 1.5, 24),
      new THREE.MeshBasicMaterial({ color: 0x48bb78, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(agent.root.position.x, agent.root.position.y + 0.1, agent.root.position.z);
    this.scene.add(pad);
    this.fxMeshes.push({ mesh: pad, life: 0.45, maxLife: 0.45 });

    const toTarget = targetPos.clone().sub(agent.root.position).setY(0).normalize();
    const right = new THREE.Vector3(-toTarget.z, 0, toTarget.x);

    if (mode === 'approach') {
      agent.dodgeVel.copy(toTarget).addScaledVector(right, agent.strafeSign * 0.55).normalize().multiplyScalar(0.42);
      agent.velocityY = 0.34;
    } else if (mode === 'highground') {
      agent.dodgeVel.copy(toTarget).multiplyScalar(0.24);
      agent.velocityY = 0.52;
    } else {
      agent.dodgeVel.copy(toTarget).multiplyScalar(-0.38).addScaledVector(right, agent.strafeSign * 0.45).normalize().multiplyScalar(0.42);
      agent.velocityY = 0.26;
    }
    agent.onGround = false;
    agent.dodgeUntil = now + 320;
    return true;
  }

  chargeAndFireAgentCube(agent, color, onFire) {
    const yaw = agent.root.rotation.y;
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).normalize();
    const origin = agent.root.position.clone().add(new THREE.Vector3(0, 1.5, 0)).addScaledVector(forward, 0.8);

    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.42, 0.42),
      new THREE.MeshBasicMaterial({ color, wireframe: true })
    );
    cube.position.copy(origin);
    this.scene.add(cube);
    this.fxMeshes.push({ mesh: cube, life: 0.35, maxLife: 0.35 });

    setTimeout(() => {
      if (agent.hp > 0) onFire(origin);
    }, 350);
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

  damageEnemy(enemy, rawDmg, opts = {}) {
    if (!enemy || enemy.hp <= 0) return false;
    const now = performance.now();

    if (now < enemy.dodgeUntil && Math.random() < 0.45) {
      const popupPos = enemy.root.position.clone().add(new THREE.Vector3(0, 2.0, 0));
      this.onDamagePopup(popupPos, 'DODGE', false);
      return false;
    }

    let dmg = Math.round(rawDmg);

    if (now < enemy.shieldUntil) {
      dmg = Math.max(1, Math.round(dmg * 0.30));
      this.world.spawnHitSpark(enemy.root.position.clone().add(new THREE.Vector3(0, 1.2, 0)), 0x00ffff);
    } else if (enemy.isRivalAgent && now >= enemy.cdShield && enemy.aiTrion >= 15 && Math.random() < enemy.aiReaction * 0.45) {
      this.activateAgentShield(enemy, 2000);
    }

    enemy.hp = Math.max(0, enemy.hp - dmg);
    enemy.hitFlashUntil = now + 90;

    if (opts.stunMs) {
      enemy.stunUntil = Math.max(enemy.stunUntil, now + opts.stunMs);
      enemy.aiState = 'flank';
      if (enemy.laserLine) enemy.laserLine.visible = false;
    }

    const popupPos = enemy.root.position.clone().add(new THREE.Vector3(0, 2.0, 0));
    this.onDamagePopup(popupPos, dmg, opts.isCrit || false);
    this.world.spawnHitSpark(popupPos, opts.color || 0x00ffff);

    const ratio = Math.max(0, enemy.hp / enemy.maxHp);
    enemy.hpFill.scale.x = Math.max(0.001, ratio);
    enemy.hpFill.position.x = -(1 - ratio) * (enemy.hpBarWidth * 0.5);

    if (enemy.hp <= 0) {
      this.killEnemy(enemy);
      return true;
    }
    return false;
  }

  killEnemy(enemy) {
    const pos = enemy.root.position.clone();
    if (enemy.laserLine) this.scene.remove(enemy.laserLine);

    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.85, 0.85, 32, 16),
      new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.9 })
    );
    beam.position.set(pos.x, 16, pos.z);
    this.scene.add(beam);
    this.fxMeshes.push({ mesh: beam, life: 0.75, maxLife: 0.75 });

    this.scene.remove(enemy.root);
    this.enemies = this.enemies.filter((e) => e !== enemy);

    if (this.activeBoss === enemy) {
      this.activeBoss = null;
      this.clearAllProjectilesAndHazards();
      this.world.unlockExitPortal();
    }

    const expGain = EXP_PER_KILL * 8;
    const ptsGain = pointsFor(enemy.floor, true);
    PLAYER.exp += expGain;
    PLAYER.points += ptsGain;
    state.exsGauge = Math.min(EXS_GAUGE_MAX, state.exsGauge + 40);

    while (PLAYER.exp >= expNeed(PLAYER.lv)) {
      PLAYER.exp -= expNeed(PLAYER.lv);
      PLAYER.lv++;
      PLAYER.pts += 3;
      this.onToast(`🎉 隊員ランクUP! Lv.${PLAYER.lv} (強化Pt +3)`);
    }

    SAVE.cleared = Math.max(SAVE.cleared, enemy.floor);
    this.onToast(`🏆 目標ベイルアウト確認！功績 +${ptsGain} PTS ＆ EXS+40%`);
    saveGame();
  }

  fireAgentOrb(agent, originPos, dir, speed = 0.52, dmgMult = 1.0, opts = {}) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(opts.radius || 0.22, 8, 8),
      new THREE.MeshBasicMaterial({ color: opts.color || agent.color })
    );
    mesh.position.copy(originPos);
    this.scene.add(mesh);

    this.enemyProjectiles.push({
      mesh,
      vel: dir.clone().multiplyScalar(speed),
      atk: Math.round(agent.atk * dmgMult),
      life: opts.life || 2.8,
      homing: !!opts.homing,
      isExplosive: !!opts.isExplosive
    });
  }

  swingAgentBlade(agent) {
    agent.swordPivot.rotation.x = 1.4;
    let t = 0;
    const anim = () => {
      t += 0.2;
      if (t >= 1) {
        agent.swordPivot.rotation.x = 0;
        return;
      }
      agent.swordPivot.rotation.x = THREE.MathUtils.lerp(1.4, -1.1, t);
      requestAnimationFrame(anim);
    };
    requestAnimationFrame(anim);
  }

  // ---- 人型隊員AIの戦術思考・行動ルーチン ----
  updateRivalAgent(agent, dt, player) {
    const now = performance.now();
    const pPos = player.root.position;
    const aPos = agent.root.position;

    agent.shieldBubble.visible = now < agent.shieldUntil;
    if (agent.shieldBubble.visible) {
      agent.shieldBubble.rotation.y += dt * 3.0;
    }

    agent.aiTrion = Math.min(agent.aiMaxTrion, agent.aiTrion + agent.aiMaxTrion * 0.015 * dt);

    if (now < agent.stunUntil) {
      if (agent.laserLine) agent.laserLine.visible = false;
      return;
    }

    // 飛来弾を検知して自動シールド
    if (now >= agent.cdShield && now >= agent.shieldUntil && agent.aiTrion >= 15) {
      for (const proj of player.projectiles) {
        if (proj.mesh.position.distanceTo(aPos) < 6.5 && Math.random() < agent.aiReaction * 0.25) {
          this.activateAgentShield(agent, 2000);
          break;
        }
      }
    }

    const toPlayer = pPos.clone().sub(aPos);
    const horizDist = Math.hypot(toPlayer.x, toPlayer.z);
    const dirHoriz = horizDist > 0.01
      ? new THREE.Vector3(toPlayer.x, 0, toPlayer.z).normalize()
      : new THREE.Vector3(0, 0, 1);

    agent.root.rotation.y = Math.atan2(dirHoriz.x, dirHoriz.z);

    // 大技・狙撃の照準溜め中
    if (agent.aiState === 'windup') {
      agent.windupTimer -= dt;
      agent.mat.emissiveIntensity = 0.85;

      // スナイパーの場合は赤い照準レーザーを更新
      if (agent.pendingSkill === 'snipe' && agent.laserLine) {
        agent.laserLine.visible = true;
        const startPt = aPos.clone().add(new THREE.Vector3(0, 1.45, 0));
        // 発射0.22秒前に照準位置を固定（ステップや遮蔽物で避けられる猶予を作る）
        if (agent.windupTimer > 0.22) {
          agent.lockedAimPos = pPos.clone().add(new THREE.Vector3(0, 1.15, 0));
        }
        const endPt = agent.lockedAimPos || pPos.clone().add(new THREE.Vector3(0, 1.15, 0));
        agent.laserLine.geometry.setFromPoints([startPt, endPt]);
      }

      if (agent.windupTimer <= 0) {
        agent.mat.emissiveIntensity = 0.15;
        if (agent.laserLine) agent.laserLine.visible = false;
        agent.aiState = 'engage';
        this.executeAgentSubSkill(agent, pPos, dirHoriz);
      }
      this.applyAgentPhysics(agent, new THREE.Vector3());
      return;
    }

    if (agent.laserLine) agent.laserLine.visible = false;

    agent.aiDecisionTimer -= dt;
    const hasLOS = this.world.hasLineOfSight(aPos, pPos);

    if (agent.aiDecisionTimer <= 0) {
      agent.aiDecisionTimer = 0.35 + Math.random() * 0.25;
      if (Math.random() < 0.35) agent.strafeSign *= -1;

      if (agent.role === 'sniper') {
        // スナイパーは常に高所・遠距離を維持
        if (horizDist < 15.0 && now >= agent.cdMobility) {
          this.useAgentGrasshopper(agent, pPos, 'evade');
          agent.aiState = 'evade';
        } else if (aPos.y < 10.0 && now >= agent.cdMobility) {
          this.useAgentGrasshopper(agent, pPos, 'highground');
          agent.aiState = 'engage';
        } else if (!hasLOS) {
          agent.aiState = 'flank';
        } else {
          agent.aiState = 'engage';
        }
      } else if (!hasLOS && horizDist > 7.0) {
        agent.aiState = 'flank';
      } else if (agent.role === 'shooter' && horizDist < 8.5) {
        agent.aiState = 'evade';
        if (now >= agent.cdMobility) this.useAgentGrasshopper(agent, pPos, 'evade');
      } else if (agent.role === 'attacker' && horizDist > 9.0 && hasLOS && now >= agent.cdMobility) {
        this.useAgentGrasshopper(agent, pPos, 'approach');
        agent.aiState = 'engage';
      } else if (pPos.y > aPos.y + 2.2 && now >= agent.cdMobility) {
        this.useAgentGrasshopper(agent, pPos, 'highground');
      } else {
        agent.aiState = 'engage';
      }
    }

    let moveVec = new THREE.Vector3();
    if (now < agent.dodgeUntil) {
      moveVec.copy(agent.dodgeVel);
    } else {
      const right = new THREE.Vector3(-dirHoriz.z, 0, dirHoriz.x).multiplyScalar(agent.strafeSign);

      if (agent.aiState === 'flank') {
        moveVec.copy(dirHoriz).multiplyScalar(0.75).addScaledVector(right, 0.65).normalize().multiplyScalar(agent.speed * 1.1);
      } else if (agent.aiState === 'evade') {
        moveVec.copy(dirHoriz).multiplyScalar(-0.85).addScaledVector(right, 0.55).normalize().multiplyScalar(agent.speed * 1.05);
      } else {
        const diff = horizDist - agent.preferredDist;
        const forwardFactor = Math.abs(diff) < 2.0 ? 0 : Math.sign(diff) * 0.7;
        moveVec.copy(dirHoriz).multiplyScalar(forwardFactor).addScaledVector(right, 0.85).normalize().multiplyScalar(agent.speed);
      }
    }

    this.applyAgentPhysics(agent, moveVec);

    if (hasLOS || horizDist <= 5.0) {
      this.tryAgentAttack(agent, now, horizDist, pPos, dirHoriz);
    }
  }

  tryAgentAttack(agent, now, dist, pPos, dirHoriz) {
    // スナイパー専用：赤い照準レーザーサイト予兆→超高速狙撃
    if (agent.role === 'sniper') {
      if (now >= agent.cdNormal && dist <= 75.0 && agent.aiTrion >= 15) {
        agent.aiTrion -= 15;
        agent.cdNormal = now + 3200;
        agent.aiState = 'windup';
        agent.windupTimer = 0.85;
        agent.pendingSkill = 'snipe';
        agent.lockedAimPos = pPos.clone().add(new THREE.Vector3(0, 1.15, 0));
        this.onToast(`🎯 ${agent.name} の照準レーザーを感知！遮蔽物へ！`);
      }
      return;
    }

    // サブトリガー
    if (now >= agent.cdSub && agent.aiTrion >= 40) {
      if (agent.role === 'attacker' && dist <= 8.5) {
        agent.aiTrion -= 40;
        agent.cdSub = now + 4800;
        agent.aiState = 'windup';
        agent.windupTimer = 0.42;
        agent.pendingSkill = 'senku';
        this.onToast(`⚠️ ${agent.name} が旋空弧月の構えに入った！`);
        return;
      }
      if (agent.role === 'shooter' && dist >= 7.0 && dist <= 26.0) {
        agent.aiTrion -= 45;
        agent.cdSub = now + 4500;
        agent.aiState = 'windup';
        agent.windupTimer = 0.45;
        agent.pendingSkill = Math.random() < 0.5 ? 'viper' : 'meteora';
        return;
      }
      if (agent.role === 'allrounder' && dist <= 18.0) {
        agent.aiTrion -= 40;
        agent.cdSub = now + 4600;
        if (dist <= 6.5) {
          this.spawnAgentEscudo(agent, dirHoriz);
        } else {
          agent.aiState = 'windup';
          agent.windupTimer = 0.4;
          agent.pendingSkill = 'hound';
        }
        return;
      }
    }

    // 通常トリガー
    if (now >= agent.cdNormal) {
      if (agent.role !== 'shooter' && dist <= 3.6) {
        agent.cdNormal = now + 680;
        this.swingAgentBlade(agent);

        const arc = new THREE.Mesh(
          new THREE.RingGeometry(1.4, 3.6, 20, 1, -Math.PI * 0.35, Math.PI * 0.7),
          new THREE.MeshBasicMaterial({ color: agent.color, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
        );
        arc.position.copy(agent.root.position).add(new THREE.Vector3(0, 1.1, 0));
        arc.rotation.x = -Math.PI / 2;
        arc.rotation.z = -agent.root.rotation.y + Math.PI / 2;
        this.scene.add(arc);
        this.fxMeshes.push({ mesh: arc, life: 0.18, maxLife: 0.18 });

        if (this.playerRef && this.playerRef.root.position.distanceTo(agent.root.position) <= 3.8) {
          this.playerRef.receiveEnemyAttack(agent.atk, agent.root.position);
        }
      } else if (dist <= 26.0 && agent.aiTrion >= 8) {
        agent.aiTrion -= 8;
        agent.cdNormal = now + (agent.role === 'shooter' ? 950 : 1350);
        this.chargeAndFireAgentCube(agent, 0x00ffff, (origin) => {
          if (!this.playerRef) return;
          const targetHead = this.playerRef.root.position.clone().add(new THREE.Vector3(0, 1.1, 0));
          const aimDir = targetHead.sub(origin).normalize();
          for (let i = 0; i < 3; i++) {
            setTimeout(() => {
              if (agent.hp > 0) {
                this.fireAgentOrb(agent, origin, aimDir, 0.62, 0.55, { radius: 0.16, color: 0x00ffff });
              }
            }, i * 70);
          }
        });
      }
    }
  }

  executeAgentSubSkill(agent, pPos, dirHoriz) {
    const skill = agent.pendingSkill;
    if (skill === 'snipe') {
      const origin = agent.root.position.clone().add(new THREE.Vector3(0, 1.45, 0));
      const targetPt = agent.lockedAimPos || pPos.clone().add(new THREE.Vector3(0, 1.15, 0));
      const aimDir = targetPt.sub(origin).normalize();
      // 超高速スナイパー弾（弾速 1.85 / 高威力 1.8倍）
      this.fireAgentOrb(agent, origin, aimDir, 1.85, 1.8, { radius: 0.22, color: 0xff2244, life: 2.5 });
    } else if (skill === 'senku') {
      this.swingAgentBlade(agent);
      const origin = agent.root.position.clone().add(new THREE.Vector3(0, 1.1, 0));
      this.fireAgentOrb(agent, origin, dirHoriz, 0.78, 1.55, { radius: 0.55, color: 0x48bb78, life: 1.2 });
    } else if (skill === 'viper') {
      this.chargeAndFireAgentCube(agent, 0x00ffff, (origin) => {
        for (let i = 0; i < 5; i++) {
          const off = (i - 2) * 0.22;
          const d = dirHoriz.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), off);
          this.fireAgentOrb(agent, origin, d, 0.52, 0.65, { radius: 0.17, color: 0x00ffff, homing: true });
        }
      });
    } else if (skill === 'meteora') {
      this.chargeAndFireAgentCube(agent, 0xff4500, (origin) => {
        for (let i = 0; i < 3; i++) {
          const off = (i - 1) * 0.16;
          const d = dirHoriz.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), off);
          this.fireAgentOrb(agent, origin, d, 0.56, 0.95, { radius: 0.26, color: 0xff4500, isExplosive: true });
        }
      });
    } else if (skill === 'hound') {
      this.chargeAndFireAgentCube(agent, 0x63b3ed, (origin) => {
        for (let i = 0; i < 6; i++) {
          const off = (i - 2.5) * 0.15;
          const d = dirHoriz.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), off);
          this.fireAgentOrb(agent, origin, d, 0.50, 0.55, { radius: 0.16, color: 0x63b3ed, homing: true });
        }
      });
    }
  }

  spawnAgentEscudo(agent, dirHoriz) {
    const right = new THREE.Vector3(-dirHoriz.z, 0, dirHoriz.x);
    const center = agent.root.position.clone().addScaledVector(dirHoriz, 2.6);
    [-1.6, 0, 1.6].forEach((offset) => {
      const pos = center.clone().addScaledVector(right, offset);
      if (!this.world.isBlockedForEntity(pos.x, pos.z, 0.6, agent.root.position.y)) {
        this.world.addDestructibleBlock(pos.x, agent.root.position.y + 0.8, pos.z, 0x00ffff, 70);
        this.world.addDestructibleBlock(pos.x, agent.root.position.y + 2.4, pos.z, 0x00ffff, 70);
      }
    });
  }

  applyAgentPhysics(agent, moveVec) {
    const pos = agent.root.position;
    const nextX = pos.x + moveVec.x;
    const nextZ = pos.z + moveVec.z;

    if (!this.world.isBlockedForEntity(nextX, pos.z, 0.45, pos.y)) pos.x = nextX;
    if (!this.world.isBlockedForEntity(pos.x, nextZ, 0.45, pos.y)) pos.z = nextZ;

    agent.velocityY -= 0.014;
    pos.y += agent.velocityY;
    const groundY = this.world.getGroundHeightAt(pos.x, pos.z, pos.y);
    if (pos.y <= groundY) {
      pos.y = groundY;
      agent.velocityY = 0;
      agent.onGround = true;
    } else {
      agent.onGround = false;
    }
  }

  update(dt, player) {
    this.playerRef = player;
    const now = performance.now();
    const pPos = player.root.position;

    for (const enemy of [...this.enemies]) {
      enemy.hpBg.lookAt(this.camera.position);
      enemy.hpFill.lookAt(this.camera.position);

      if (now < enemy.hitFlashUntil) {
        enemy.mat.emissive.setHex(0xffffff);
        enemy.mat.emissiveIntensity = 0.85;
      } else if (enemy.aiState !== 'windup') {
        enemy.mat.emissive.setHex(enemy.color);
        enemy.mat.emissiveIntensity = 0.15;
      }

      if (enemy.isRivalAgent) {
        this.updateRivalAgent(enemy, dt, player);
      }
    }

    this.fxMeshes = this.fxMeshes.filter((fx) => {
      fx.life -= dt;
      if (fx.mesh.material) {
        fx.mesh.material.opacity = Math.max(0, (fx.life / fx.maxLife) * 0.85);
      }
      if (fx.life <= 0) {
        this.scene.remove(fx.mesh);
        return false;
      }
      return true;
    });

    this.enemyProjectiles = this.enemyProjectiles.filter((p) => {
      p.life -= dt;
      if (p.homing) {
        const target = pPos.clone().add(new THREE.Vector3(0, 1.1, 0));
        const toT = target.sub(p.mesh.position).normalize();
        const spd = p.vel.length();
        p.vel.lerp(toT.multiplyScalar(spd), 0.085).normalize().multiplyScalar(spd);
      }
      p.mesh.position.add(p.vel);

      const dPlayer = p.mesh.position.distanceTo(pPos.clone().add(new THREE.Vector3(0, 1.1, 0)));
      if (dPlayer < (p.isExplosive ? 2.4 : 0.85)) {
        if (p.isExplosive) {
          this.world.spawnHitSpark(p.mesh.position, 0xff4500);
        }
        player.receiveEnemyAttack(p.atk, p.mesh.position);
        this.scene.remove(p.mesh);
        return false;
      }

      // 破壊可能オブジェクト（車・自販機・エスクード等）への着弾判定
      for (const wall of this.world.walls) {
        const hx = wall.userData.halfX || 0.8;
        const hy = wall.userData.halfY || 0.8;
        const hz = wall.userData.halfZ || 0.8;
        if (
          Math.abs(p.mesh.position.x - wall.position.x) < hx + 0.2 &&
          Math.abs(p.mesh.position.y - wall.position.y) < hy + 0.2 &&
          Math.abs(p.mesh.position.z - wall.position.z) < hz + 0.2
        ) {
          if (wall.userData.destructible) {
            this.world.damageBlock(wall, p.atk, p.mesh.position);
          } else {
            this.world.spawnHitSpark(p.mesh.position, 0x00ffff, 5);
          }
          if (p.isExplosive && p.mesh.position.distanceTo(pPos) <= 3.5) {
            player.receiveEnemyAttack(Math.round(p.atk * 0.7), p.mesh.position);
          }
          this.scene.remove(p.mesh);
          return false;
        }
      }

      if (p.life <= 0 || p.mesh.position.y <= 0) {
        this.scene.remove(p.mesh);
        return false;
      }
      return true;
    });
  }
}
