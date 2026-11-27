import * as THREE from 'three';
import { EXS_GAUGE_MAX, TRIGGER_LIST } from './data.js';
import { state, maxTrion, atkTotal, TRIGGER_SLOTS } from './save.js';

const PLAYER_HEIGHT = 2.2;
const PLAYER_RADIUS = 0.45;
const BASE_MOVE_SPEED = 0.17;
const GRAVITY = 0.014;
const JUMP_POWER = 0.28;

export class Player {
  constructor(scene, camera, world, enemyManager, callbacks = {}) {
    this.scene = scene;
    this.camera = camera;
    this.world = world;
    this.enemyManager = enemyManager;
    this.onToast = callbacks.onToast || (() => {});
    this.onNextFloor = callbacks.onNextFloor || (() => {});
    this.onBailout = callbacks.onBailout || callbacks.onDeath || (() => {});
    this.onSlowMo = callbacks.onSlowMo || (() => {});
    this.isUiOpen = callbacks.isUiOpen || (() => false);

    // 現在トリオン量（旧 hp）
    this.trion = maxTrion();
    this.trionRegenAcc = 0;

    // トリガー用状態管理
    this.trionShieldUntil = 0;
    this.trionShieldReduce = 0;
    this.zoomLevel = 0;
    this.radarUntil = 0;
    this.radarAtkMult = 1.0;
    this.shieldBubbleMesh = null;

    this.root = new THREE.Group();
    this.root.position.set(0, 0, 6);
    this.scene.add(this.root);

    this.velocityY = 0;
    this.onGround = false;

    this.yaw = 0;
    this.pitch = 0.25;
    this.camDist = 6.8;
    this.shakeTime = 0;
    this.shakeIntensity = 0;

    this.comboStep = 0;
    this.comboResetTimer = 0;
    this.nextAtkTime = 0;
    this.nextSkillTime = 0;
    this.nextQTime = 0;
    this.nextOptTimes = [0, 0, 0];
    this.nextDodgeTime = 0;
    this.dodgeUntil = 0;
    this.invulnUntil = 0;
    this.dodgeDir = new THREE.Vector3();

    this.slashEffects = [];
    this.projectiles = [];

    this.keys = {};
    this.buildCharacterModel();
    this.syncTriggerVisual();
    this.bindInputs();
  }

  buildCharacterModel() {
    this.model = new THREE.Group();
    this.root.add(this.model);

    // 隊員服ボディ
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.38, 0.9, 6, 12),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.45 })
    );
    body.position.y = 0.85;
    body.castShadow = true;
    this.model.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.3 })
    );
    head.position.y = 1.75;
    head.castShadow = true;
    this.model.add(head);

    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.12, 0.2),
      new THREE.MeshBasicMaterial({ color: 0x00ffff })
    );
    visor.position.set(0, 1.78, -0.26);
    this.model.add(visor);

    // ブレード（弧月・レイガスト用）
    this.swordPivot = new THREE.Group();
    this.swordPivot.position.set(0.5, 1.1, -0.1);
    this.model.add(this.swordPivot);

    this.bladeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x48bb78,
      emissiveIntensity: 0.55
    });
    this.bladeMesh = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.45, 0.16), this.bladeMat);
    this.bladeMesh.position.set(0, 0.65, -0.2);
    this.bladeMesh.rotation.x = -0.35;
    this.swordPivot.add(this.bladeMesh);
    // スナイパーライフル（イーグレット用）
    this.rifleMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.14, 1.85),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, emissive: 0x0ea5e9, emissiveIntensity: 0.45 })
    );
    this.rifleMesh.position.set(0.35, 1.35, -0.75);
    this.rifleMesh.visible = false;
    this.model.add(this.rifleMesh);

    // 集中シールド（正面一点の小型高耐久パネル）
    this.focusedShieldMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.35, 1.55, 0.12),
      new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.55 })
    );
    this.focusedShieldMesh.position.set(0, 1.25, -1.15);
    this.focusedShieldMesh.visible = false;
    this.root.add(this.focusedShieldMesh);
  }

  // セット中の通常攻撃トリガーに合わせてブレードの見た目・色を切り替え
  syncTriggerVisual() {
    if (!this.bladeMesh) return;
    const normalId = TRIGGER_SLOTS.normal || 'kogetsu';
    if (this.rifleMesh) this.rifleMesh.visible = normalId === 'egret';
    if (normalId !== 'egret' && this.zoomLevel > 0) {
      this.zoomLevel = 0;
    }

    if (normalId === 'asteroid' || normalId === 'egret') {
      this.bladeMesh.visible = false;
    } else if (normalId === 'raygust') {
      this.bladeMesh.visible = true;
      this.bladeMat.emissive.setHex(0x38bdf8);
      this.bladeMesh.scale.set(2.2, 1.15, 1.6);
    } else {
      this.bladeMesh.visible = true;
      this.bladeMat.emissive.setHex(0x48bb78);
      this.bladeMesh.scale.set(1.0, 1.1, 1.0);
    }
  }

  getTriggerPowerMult(id) {
    const lv = (state.ownedTriggers && state.ownedTriggers[id]) || 1;
    const radarBonus = performance.now() < this.radarUntil ? this.radarAtkMult : 1.0;
    return (1 + (lv - 1) * 0.20) * radarBonus;
  }

  consumeTrion(costVal) {
    const cost = Math.max(0, Math.round(costVal));
    if (cost === 0) return true;
    if (this.trion <= cost) {
      this.onToast(`⚠️ トリオン不足（必要: ${cost} / 残り: ${Math.ceil(this.trion)}）`);
      return false;
    }
    this.trion -= cost;
    return true;
  }

  // 3×3×3（27分割）トリオンキューブ展開演出（0.5秒）後に各小キューブ座標から射出
  chargeAndFireTrionCube(color, side, onFire) {
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).normalize();
    const sideSign = side === 'right' ? 1 : -1;

    const centerPos = this.root.position.clone()
      .add(new THREE.Vector3(0, 1.55, 0))
      .addScaledVector(forward, 0.75)
      .addScaledVector(right, 0.68 * sideSign);

    const group = new THREE.Group();
    group.position.copy(centerPos);
    group.rotation.y = this.yaw;

    const subGeo = new THREE.BoxGeometry(0.11, 0.11, 0.11);
    const subMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
    const edgeGeo = new THREE.EdgesGeometry(subGeo);
    const edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });

    const subPositions = [];
    const gap = 0.14;
    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
          const cell = new THREE.Mesh(subGeo, subMat);
          cell.position.set(x * gap, y * gap, z * gap);
          cell.add(new THREE.LineSegments(edgeGeo, edgeMat));
          group.add(cell);

          const worldCellPos = centerPos.clone()
            .addScaledVector(right, x * gap)
            .add(new THREE.Vector3(0, y * gap, 0))
            .addScaledVector(forward, z * gap);
          subPositions.push(worldCellPos);
        }
      }
    }
    this.scene.add(group);

    setTimeout(() => {
      this.scene.remove(group);
      subGeo.dispose();
      subMat.dispose();
      edgeGeo.dispose();
      edgeMat.dispose();
      if (this.trion > 0) onFire(centerPos.clone(), subPositions);
    }, 500);
  }

  bindInputs() {
    window.addEventListener('keydown', (e) => {
      if (this.isUiOpen()) return;
      this.keys[e.code] = true;

      if (e.code === 'Space' && this.onGround) {
        this.velocityY = JUMP_POWER;
        this.onGround = false;
      }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.triggerDodge();
      if (e.code === 'KeyE') this.triggerSkill();
      if (e.code === 'KeyQ') this.triggerQSkill();
      if (e.code === 'KeyZ') this.triggerExS();
      if (e.code === 'KeyF') this.tryInteract();
      if (e.code === 'Digit1') this.triggerOptSlot(0);
      if (e.code === 'Digit2') this.triggerOptSlot(1);
      if (e.code === 'Digit3') this.triggerOptSlot(2);
      if (e.code === 'KeyC') {
        if ((TRIGGER_SLOTS.normal || 'kogetsu') === 'egret') {
          this.zoomLevel = (this.zoomLevel + 1) % 4;
          const labels = ['解除', '2.0倍', '4.0倍', '6.0倍'];
          this.onToast(`🎯 スコープ倍率: ${labels[this.zoomLevel]}`);
        } else {
          this.onToast('🎯 スコープズームは「イーグレット」装備中に [C] キーで使用可能');
        }
      }
    });

    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });

    window.addEventListener('mousemove', (e) => {
      if (!this.isUiOpen() && document.pointerLockElement === document.body) {
        const sensScale = [1.0, 0.55, 0.32, 0.20][this.zoomLevel] || 1.0;
        this.yaw -= e.movementX * 0.0025 * sensScale;
        this.pitch += e.movementY * 0.0022 * sensScale;
        this.pitch = Math.max(-0.35, Math.min(1.15, this.pitch));
      }
    });

    window.addEventListener('mousedown', (e) => {
      if (this.isUiOpen() || document.pointerLockElement !== document.body) return;
      if (e.button === 0) this.triggerAttack();
      if (e.button === 2) this.triggerQSkill();
    });

    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  tryInteract() {
    const nearby = this.world.getNearbyInteractable(this.root.position);
    if (nearby) {
      this.world.triggerInteractable(nearby, this, maxTrion());
      return;
    }

    const dist = Math.hypot(
      this.root.position.x - this.world.portalPos.x,
      this.root.position.z - this.world.portalPos.z
    );
    if (dist > 2.8) return;
    if (this.world.portalLocked) {
      this.onToast('🔒 目標を全滅させるまで転送ゲートはロックされている！');
      return;
    }
    this.onNextFloor();
  }

  receiveEnemyAttack(rawAtk, attackerPos) {
    const now = performance.now();
    if (now < this.invulnUntil) return;

    // 緊急回避（ステップ）によるジャスト回避
    if (now < this.dodgeUntil) {
      this.invulnUntil = now + 950;
      state.exsGauge = Math.min(EXS_GAUGE_MAX, state.exsGauge + 20);
      this.onToast('⚡ 緊急回避成功！EXSゲージ +20%');
      this.onSlowMo(0.35);
      this.addCameraShake(0.15, 0.1);
      return;
    }

    let dmg = Math.max(1, Math.round(rawAtk));
    if (now < this.focusedShieldUntil && attackerPos) {
      const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
      const toAttacker = attackerPos.clone().sub(this.root.position).setY(0).normalize();
      if (forward.dot(toAttacker) > 0.45) {
        const shieldPos = this.root.position.clone()
          .add(new THREE.Vector3(0, 1.25, 0))
          .addScaledVector(forward, 1.15);
        this.world.spawnHitSpark(shieldPos, 0x00ffff, 14);
        this.onDamagePopup(shieldPos, 'BLOCK', false);
        this.onToast('🛡️ 集中シールドで完全防御！（0ダメージ）');
        return;
      }
    }

    // シールドトリガー展開中のダメージ軽減
    if (now < this.trionShieldUntil && this.trionShieldReduce > 0) {
      dmg = Math.max(1, Math.round(dmg * (1 - this.trionShieldReduce)));
      this.world.spawnHitSpark(this.root.position.clone().add(new THREE.Vector3(0, 1.2, 0)), 0x00ffff);
    }
    

    this.trion = Math.max(0, this.trion - dmg);
    this.invulnUntil = now + 650;
    this.addCameraShake(0.22, 0.18);
    this.onToast(`💥 トリオン損傷 -${dmg}`);

    if (attackerPos) {
      const kb = this.root.position.clone().sub(attackerPos).setY(0).normalize().multiplyScalar(0.6);
      if (!this.isCollidingHorizontal(this.root.position.x + kb.x, this.root.position.z + kb.z, this.root.position.y)) {
        this.root.position.add(kb);
      }
    }

    // トリオン限界値到達 → ベイルアウト（緊急脱出）
    if (this.trion <= 0) {
      this.triggerBailout();
    }
  }

  triggerBailout() {
    // 光の柱（ベイルアウトエフェクト）生成
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 0.9, 30, 16),
      new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.85 })
    );
    beam.position.set(this.root.position.x, 15, this.root.position.z);
    this.scene.add(beam);
    this.slashEffects.push({ mesh: beam, life: 0.7, maxLife: 0.7 });

    this.trion = maxTrion();
    this.onBailout();
  }

  // ==========================================
  // 1. 通常攻撃（弧月 / アステロイド / レイガスト）
  // ==========================================
  triggerAttack() {
    const now = performance.now();
    if (now < this.nextAtkTime || now < this.dodgeUntil) return;

    const id = TRIGGER_SLOTS.normal || 'kogetsu';
    const tr = TRIGGER_LIST[id];
    if (!tr || !this.consumeTrion(tr.cost)) return;

    this.nextAtkTime = now + tr.cd;
    this.comboStep = (this.comboStep % 3) + 1;
    this.comboResetTimer = now + 950;
    const isThird = this.comboStep === 3;

    const lv = (state.ownedTriggers && state.ownedTriggers[id]) || 1;
    const dmg = Math.round(atkTotal() * this.getTriggerPowerMult(id));
    this.model.rotation.y = this.yaw;
    
    if (id === 'egret') {
      // イーグレット：超長射程・超高速スナイパーライフル
      this.addCameraShake(0.14, 0.10);
      const zoomBonus = this.zoomLevel > 0 ? 1.25 : 1.0;
      this.fireProjectile(0, Math.round(dmg * 2.45 * zoomBonus), 0x00ffff, {
        projRadius: 0.16,
        speedOverride: 2.6,
        maxDist: 95,
        attackCategory: 'ranged'
      });
    } else if (id === 'asteroid') {
      const shots = 3 + Math.min(2, Math.floor((lv - 1) / 3));
      this.chargeAndFireTrionCube(0x00ffff, 'right', (cubePos, subPositions) => {
        for (let idx = 0; idx < shots; idx++) {
          setTimeout(() => {
            this.model.rotation.y = this.yaw;
            const origin = subPositions[idx % subPositions.length] || cubePos;
            this.fireProjectile(0, Math.round(dmg * 0.48), 0x00ffff, {
              originPos: origin,
              projRadius: 0.14,
              speedOverride: 1.35,
              maxDist: 34,
              attackCategory: 'ranged'
            });
          }, idx * 35);
        }
      });
    } else if (id === 'raygust') {
      this.swingSwordAnimation(this.comboStep);
      this.spawnSlashArc(5.0, 0x38bdf8, 1.5);
      this.enemyManager.clearProjectilesInRadius(this.root.position, 4.5);
      this.performMeleeHit(5.0, Math.round(dmg * 1.15), 0x38bdf8, false, isThird, 0, 1.2, 'melee');
    } else {
      // 弧月
      this.swingSwordAnimation(this.comboStep);
      const reach = isThird ? 4.8 : 4.0;
      this.spawnSlashArc(reach, 0x48bb78, isThird ? 1.4 : 1.0);
      this.performMeleeHit(reach, Math.round(dmg * (isThird ? 1.3 : 1.0)), 0x48bb78, false, isThird, 0, 0, 'melee');
    }
  }

  // ==========================================
  // 2. スキルトリガー発動（E / Q / 1 / 2 / 3）
  // ==========================================
  triggerSkill() {
    this.executeTriggerSlot('skillE', 'nextSkillTime');
  }

  triggerQSkill() {
    this.executeTriggerSlot('skillQ', 'nextQTime');
  }

  triggerOptSlot(slotIdx) {
    const optKeys = ['opt1', 'opt2', 'opt3'];
    this.executeTriggerSlot(optKeys[slotIdx], null, slotIdx);
  }

  executeTriggerSlot(slotKey, timerProp, optIdx = -1, freeCast = false) {
    const id = TRIGGER_SLOTS[slotKey];
    if (!id) {
      if (!freeCast) this.onToast('スロットにトリガーが未セットです');
      return;
    }
    const tr = TRIGGER_LIST[id];
    if (!tr) return;

    const now = performance.now();
    if (!freeCast) {
      const nextTime = optIdx >= 0 ? this.nextOptTimes[optIdx] : this[timerProp];
      if (now < nextTime || now < this.dodgeUntil) return;
      if (!this.consumeTrion(tr.cost)) return;

      const lv = (state.ownedTriggers && state.ownedTriggers[id]) || 1;
      const lvCdMult = Math.max(0.65, 1 - (lv - 1) * 0.04);
      const cdVal = Math.round(tr.cd * lvCdMult);

      if (optIdx >= 0) this.nextOptTimes[optIdx] = now + cdVal;
      else this[timerProp] = now + cdVal;
    }

    this.enemyManager.onPlayerSkillUsed(this.root.position);
    this.runTriggerEffect(id);
  }

  runTriggerEffect(id) {
    const now = performance.now();
    const lv = (state.ownedTriggers && state.ownedTriggers[id]) || 1;
    const mult = this.getTriggerPowerMult(id);
    const dmg = Math.round(atkTotal() * mult);
    this.model.rotation.y = this.yaw;

    if (id === 'viper') {
      const count = Math.min(9, 4 + Math.floor(lv / 2));
      this.chargeAndFireTrionCube(0x00ffff, 'left', (cubePos, subPositions) => {
        for (let i = 0; i < count; i++) {
          const spread = (i - (count - 1) / 2) * 0.14;
          const origin = subPositions[(i * 3) % subPositions.length] || cubePos;
          this.fireProjectile(spread, Math.round(dmg * 0.58), 0x00ffff, {
            originPos: origin,
            projRadius: 0.15,
            isViperArc: true,
            arcUpTime: 0.20 + (i % 3) * 0.04,
            homing: true,
            homingStrength: 0.30,
            maxDist: 36,
            attackCategory: 'skill'
          });
        }
      });
    } else if (id === 'hound') {
      const count = Math.min(10, 5 + Math.floor(lv / 2));
      this.chargeAndFireTrionCube(0x63b3ed, 'left', (cubePos, subPositions) => {
        for (let i = 0; i < count; i++) {
          const off = (i - (count - 1) / 2) * 0.13;
          const origin = subPositions[(i * 3) % subPositions.length] || cubePos;
          this.fireProjectile(off, Math.round(dmg * 0.52), 0x63b3ed, {
            originPos: origin,
            projRadius: 0.15,
            homing: true,
            homingStrength: 0.28,
            maxDist: 36,
            attackCategory: 'skill'
          });
        }
      });
    } else if (id === 'meteora') {
      const count = Math.min(12, 5 + Math.floor(lv * 0.8));
      const blastR = 3.6 + Math.min(2.4, (lv - 1) * 0.25);
      const subDmg = Math.round(dmg * 0.52);

      this.chargeAndFireTrionCube(0xff4500, 'left', (cubePos, subPositions) => {
        for (let i = 0; i < count; i++) {
          setTimeout(() => {
            if (this.trion <= 0) return;
            const spreadYaw = ((i % 5) - 2) * 0.13 + (Math.random() - 0.5) * 0.08;
            const origin = subPositions[(i * 2) % subPositions.length] || cubePos;
            this.fireProjectile(spreadYaw, subDmg, 0xff4500, {
              originPos: origin,
              projRadius: 0.17,
              speedOverride: 1.0 + (i % 3) * 0.15,
              isMeteoraBomb: true,
              blastRadius: blastR,
              maxDist: 45,
              attackCategory: 'skill'
            });
          }, i * 28);
        }
      });
    } else if (id === 'senku') {
      this.swingSwordAnimation(3);
      this.spawnSlashArc(7.5, 0x48bb78, 2.2);
      this.addCameraShake(0.18, 0.14);
      this.performMeleeHit(7.5, Math.round(dmg * 1.6), 0x48bb78, false, true, 0, 1.5, 'skill');
      this.fireProjectile(0, Math.round(dmg * 1.35), 0x48bb78, {
        pierce: true, maxDist: 22, attackCategory: 'skill'
      });
    } else if (id === 'grasshopper') {
      const pad = new THREE.Mesh(
        new THREE.RingGeometry(0.4, 1.6, 24),
        new THREE.MeshBasicMaterial({ color: 0x48bb78, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
      );
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(this.root.position.x, this.root.position.y + 0.1, this.root.position.z);
      this.scene.add(pad);
      this.slashEffects.push({ mesh: pad, life: 0.45, maxLife: 0.45 });

      const moveDir = this.getInputMoveDirection();
      this.invulnUntil = Math.max(this.invulnUntil, now + 350);
      if (moveDir.lengthSq() > 0) {
        this.dodgeDir.copy(moveDir).normalize();
        this.dodgeUntil = now + 260;
        this.velocityY = Math.max(this.velocityY, 0.22);
      } else {
        this.velocityY = 0.44 + Math.min(0.15, lv * 0.02);
        this.onGround = false;
      }
    } else if (id === 'escudo') {
      const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).normalize();
      const baseCenter = this.root.position.clone().addScaledVector(forward, 3.2);
      const wallHp = Math.round(maxTrion() * (0.45 + lv * 0.15));

      [-1.7, 0, 1.7].forEach((offset) => {
        const pos = baseCenter.clone().addScaledVector(right, offset);
        if (!this.world.isBlockedForEntity(pos.x, pos.z, 0.6)) {
          this.world.addDestructibleBlock(pos.x, 0.8, pos.z, 0x00ffff, wallHp);
          this.world.addDestructibleBlock(pos.x, 2.4, pos.z, 0x00ffff, wallHp);
        }
      });
      this.onToast('🛡️ エスクード展開！');
    } else if (id === 'shield') {
      this.trionShieldUntil = now + 3000 + Math.min(2000, (lv - 1) * 250);
      this.trionShieldReduce = Math.min(0.85, 0.55 + (lv - 1) * 0.05);
      if (!this.shieldBubbleMesh) {
        this.shieldBubbleMesh = new THREE.Mesh(
          new THREE.IcosahedronGeometry(1.35, 1),
          new THREE.MeshBasicMaterial({ color: 0x00ffff, wireframe: true, transparent: true, opacity: 0.45 })
        );
        this.shieldBubbleMesh.position.y = 1.1;
        this.root.add(this.shieldBubbleMesh);
      }
      this.shieldBubbleMesh.visible = true;
      this.onToast(`🔷 シールド展開（被ダメ${Math.round(this.trionShieldReduce * 100)}%軽減）`);
    } else if (id === 'focused_shield') {
      this.focusedShieldUntil = now + 4000 + Math.min(2000, (lv - 1) * 250);
      if (this.focusedShieldMesh) this.focusedShieldMesh.visible = true;
      this.onToast('🛡️ 集中シールド展開');
    } else if (id === 'teleporter') {
      const moveDir = this.getInputMoveDirection();
      const dir = moveDir.lengthSq() > 0
        ? moveDir
        : new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
      const dist = 7.5 + Math.min(5.0, (lv - 1) * 0.8);

      for (let i = 0; i < 3; i++) this.spawnAfterimage();
      this.invulnUntil = Math.max(this.invulnUntil, now + 350);

      for (let step = dist; step >= 1.0; step -= 0.5) {
        const tx = this.root.position.x + dir.x * step;
        const tz = this.root.position.z + dir.z * step;
        if (!this.isCollidingHorizontal(tx, tz, this.root.position.y)) {
          this.root.position.set(tx, this.root.position.y, tz);
          break;
        }
      }
      this.spawnSlashArc(2.5, 0x00ffff, 1.2);
    } else if (id === 'radar') {
      this.radarUntil = now + 8000 + (lv - 1) * 1000;
      this.radarAtkMult = 1.15 + Math.min(0.35, (lv - 1) * 0.04);
      this.onToast(`📡 レーダー起動（全探知＋攻撃力+${Math.round((this.radarAtkMult - 1) * 100)}%）`);
    }
  }

  // ==========================================
  // 3. Zキー：EXS（アイビス / フルアタック）
  // ==========================================
  triggerExS() {
    if (state.exsGauge < EXS_GAUGE_MAX) return;
    const id = TRIGGER_SLOTS.exs || 'ibis';
    const tr = TRIGGER_LIST[id];
    if (!tr || !this.consumeTrion(tr.cost)) return;

    state.exsGauge = 0;
    const mult = this.getTriggerPowerMult(id);
    const dmg = Math.round(atkTotal() * mult);
    this.model.rotation.y = this.yaw;

    if (id === 'full_attack') {
      this.onToast('💥 フルアタック（全トリガー一斉起動）！！');
      this.addCameraShake(0.45, 0.28);
      const allKeys = ['skillE', 'skillQ', 'opt1', 'opt2', 'opt3'];
      let launched = 0;
      allKeys.forEach((k) => {
        if (TRIGGER_SLOTS[k]) {
          this.executeTriggerSlot(k, null, -1, true);
          launched++;
        }
      });
      if (launched === 0) {
        this.runTriggerEffect('hound');
        this.runTriggerEffect('meteora');
      }
    } else {
      // アイビス：超威力・壁＆敵貫通の狙撃砲撃＋着弾大爆発
      this.onToast('🎯 アイビス狙撃砲撃！！');
      this.fireIbisCannon(Math.round(dmg * 26.0));
      const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
      const blastCenter = this.root.position.clone().addScaledVector(forward, 14);
      for (const e of [...this.enemyManager.enemies]) {
        if (e.root.position.distanceTo(blastCenter) <= 7.5) {
          this.enemyManager.damageEnemy(e, Math.round(dmg * 8.0), {
            color: 0x00ffff, isCrit: true, stunMs: 2500, attackCategory: 'skill'
          });
        }
      }
    }
  }

  fireIbisCannon(totalDmg) {
    this.addCameraShake(0.45, 0.28);
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
    const length = 55;

    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.8, 1.8, length, 16),
      new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.92 })
    );
    beam.position.copy(this.root.position).add(new THREE.Vector3(0, 1.3, 0)).addScaledVector(forward, length / 2);
    beam.rotation.z = Math.PI / 2;
    beam.rotation.y = this.yaw + Math.PI / 2;
    this.scene.add(beam);
    this.slashEffects.push({ mesh: beam, life: 0.55, maxLife: 0.55 });

    const start = this.root.position;
    for (const e of [...this.enemyManager.enemies]) {
      const toE = e.root.position.clone().sub(start).setY(0);
      const proj = toE.dot(forward);
      if (proj < 0 || proj > length) continue;
      const perp = Math.hypot(toE.x - forward.x * proj, toE.z - forward.z * proj);
      if (perp <= 2.8 + 0.8 * e.scale) {
        this.enemyManager.damageEnemy(e, totalDmg, {
          color: 0x00ffff, isCrit: true, stunMs: 2500, attackCategory: 'skill'
        });
      }
    }
  }

  triggerDodge() {
    const now = performance.now();
    if (now < this.nextDodgeTime || now < this.dodgeUntil) return;
    this.dodgeUntil = now + 240;
    this.nextDodgeTime = now + 850;

    const moveDir = this.getInputMoveDirection();
    if (moveDir.lengthSq() > 0) {
      this.dodgeDir.copy(moveDir).normalize();
      this.model.rotation.y = Math.atan2(-this.dodgeDir.x, -this.dodgeDir.z);
    } else {
      const ang = this.model.rotation.y;
      this.dodgeDir.set(-Math.sin(ang), 0, -Math.cos(ang)).normalize();
    }
    for (let i = 0; i < 3; i++) setTimeout(() => this.spawnAfterimage(), i * 45);
  }

  performMeleeHit(reach, dmg, color, isAllAround = false, isCrit = false, stunMs = 0, knockback = 0, attackCategory = 'melee') {
    const forward = new THREE.Vector3(-Math.sin(this.model.rotation.y), 0, -Math.cos(this.model.rotation.y));
    const origin = this.root.position.clone().add(new THREE.Vector3(0, 1.0, 0));

    let hits = 0;
    let kills = 0;

    for (const enemy of [...this.enemyManager.enemies]) {
      const toEnemy = enemy.root.position.clone().sub(origin);
      const horizDist = Math.hypot(toEnemy.x, toEnemy.z);
      if (horizDist > reach + 0.8 * enemy.scale) continue;

      const dirNorm = new THREE.Vector3(toEnemy.x, 0, toEnemy.z).normalize();
      if (isAllAround || forward.dot(dirNorm) > 0.2 || horizDist < 2.0) {
        const killed = this.enemyManager.damageEnemy(enemy, dmg, {
          color, isCrit, stunMs, attackCategory, playerPos: this.root.position, playerRef: this
        });
        hits++;
        if (killed) kills++;
        else if (knockback > 0 && !enemy.isBoss) {
          const nx = enemy.root.position.x + dirNorm.x * knockback;
          const nz = enemy.root.position.z + dirNorm.z * knockback;
          if (!this.world.isBlockedForEntity(nx, nz, 0.5 * enemy.scale)) {
            enemy.root.position.set(nx, 0, nz);
          }
        }
      }
    }

    for (const box of [...this.world.destructibles]) {
      const toBox = box.position.clone().sub(origin);
      const horizDist = Math.hypot(toBox.x, toBox.z);
      if (horizDist > reach + 1.0 || Math.abs(toBox.y) > 2.4) continue;

      const dirNorm = new THREE.Vector3(toBox.x, 0, toBox.z).normalize();
      if (isAllAround || forward.dot(dirNorm) > 0.2 || horizDist < 1.8) {
        this.world.damageBlock(box, dmg);
        hits++;
      }
    }

    if (hits > 0) {
      state.exsGauge = Math.min(EXS_GAUGE_MAX, state.exsGauge + hits * 8);
    }
    return { hits, kills };
  }

  fireProjectile(angleOffset, dmg, color = 0x00ffff, opts = {}) {
    const ang = this.yaw + angleOffset;
    const pitchFactor = Math.max(-0.3, Math.min(0.5, -this.pitch + 0.15));

    const dir = new THREE.Vector3(
      -Math.sin(ang) * Math.cos(pitchFactor),
      Math.sin(pitchFactor),
      -Math.cos(ang) * Math.cos(pitchFactor)
    ).normalize();

    const radius = opts.projRadius || 0.18;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 8, 8),
      new THREE.MeshBasicMaterial({ color })
    );
    if (opts.originPos) {
      mesh.position.copy(opts.originPos);
    } else {
      mesh.position.copy(this.root.position).add(new THREE.Vector3(0, 1.3, 0)).addScaledVector(dir, 0.8);
    }
    this.scene.add(mesh);

    const spd = opts.speedOverride || 1.0;
    let initVel;
    if (opts.isMeteoraBomb) {
      const elev = Math.max(0.25, Math.min(1.05, 0.55 - this.pitch * 0.55));
      const v0 = opts.speedOverride || 1.15;
      const horizDir = new THREE.Vector3(-Math.sin(ang), 0, -Math.cos(ang)).normalize();
      initVel = horizDir.multiplyScalar(v0 * Math.cos(elev));
      initVel.y = v0 * Math.sin(elev);
    } else {
      initVel = dir.multiplyScalar(spd);
      if (opts.isViperArc) {
        initVel.y += 0.45;
      }
    }

    this.projectiles.push({
      mesh,
      vel: initVel,
      startPos: mesh.position.clone(),
      maxDist: opts.maxDist || 34,
      dmg,
      color,
      hitSet: new Set(),
      attackCategory: opts.attackCategory || 'ranged',
      ...opts
    });
  }

  updateProjectiles() {
    this.projectiles = this.projectiles.filter((p) => {
      if (p.isMeteoraBomb) {
        p.vel.y -= 0.022;
      } else if (p.isViperArc && p.arcUpTime > 0) {
        p.arcUpTime -= 0.016;
        p.vel.y -= 0.015;
      } else if (p.homing && this.enemyManager.enemies.length > 0) {
        let nearest = null;
        let minD = 999;
        for (const e of this.enemyManager.enemies) {
          const d = e.root.position.distanceTo(p.mesh.position);
          if (d < minD) { minD = d; nearest = e; }
        }
        if (nearest) {
          const targetPos = nearest.root.position.clone().add(new THREE.Vector3(0, 1.0, 0));
          const toTarget = targetPos.sub(p.mesh.position).normalize();
          const spd = p.vel.length();
          p.vel.lerp(toTarget.multiplyScalar(spd), p.homingStrength || 0.14).normalize().multiplyScalar(spd);
        }
      }

      p.mesh.position.add(p.vel);
      const traveled = p.mesh.position.distanceTo(p.startPos);
      let hitTarget = false;

      for (const enemy of [...this.enemyManager.enemies]) {
        if (p.hitSet.has(enemy)) continue;
        const hitR = 0.85 * enemy.scale;
        if (Math.hypot(p.mesh.position.x - enemy.root.position.x, p.mesh.position.z - enemy.root.position.z) < hitR &&
            p.mesh.position.y >= 0 && p.mesh.position.y <= 2.3 * enemy.scale) {
          p.hitSet.add(enemy);
          this.enemyManager.damageEnemy(enemy, p.dmg, {
            color: p.color, attackCategory: p.attackCategory, playerPos: this.root.position, playerRef: this
          });
          state.exsGauge = Math.min(EXS_GAUGE_MAX, state.exsGauge + 6);
          if (!p.pierce) { hitTarget = true; break; }
        }
      }

      if (!hitTarget) {
        for (const wall of this.world.walls) {
          if (p.hitSet.has(wall)) continue;
          const hx = wall.userData.halfX || 1.0;
          const hy = wall.userData.halfY || 1.0;
          const hz = wall.userData.halfZ || 1.0;
          if (Math.abs(p.mesh.position.x - wall.position.x) < hx + 0.15 &&
              Math.abs(p.mesh.position.y - wall.position.y) < hy + 0.15 &&
              Math.abs(p.mesh.position.z - wall.position.z) < hz + 0.15) {
            p.hitSet.add(wall);
            if (wall.userData.destructible) {
              this.world.damageBlock(wall, p.dmg);
              if (!p.pierce) { hitTarget = true; break; }
            } else {
              hitTarget = true;
              break;
            }
          }
        }
      }

      const expired = hitTarget || traveled >= p.maxDist || p.mesh.position.y <= 0;
      if (expired) {
        if (p.isMeteoraBomb) {
          const r = p.blastRadius || 4.0;
          this.addCameraShake(0.14, 0.10);

          const blastMesh = new THREE.Mesh(
            new THREE.SphereGeometry(r * 0.65, 12, 12),
            new THREE.MeshBasicMaterial({ color: 0xff5500, transparent: true, opacity: 0.75 })
          );
          blastMesh.position.copy(p.mesh.position);
          this.scene.add(blastMesh);
          this.slashEffects.push({ mesh: blastMesh, life: 0.22, maxLife: 0.22 });

          for (const e of [...this.enemyManager.enemies]) {
            if (e.root.position.distanceTo(p.mesh.position) <= r) {
              this.enemyManager.damageEnemy(e, Math.round(p.dmg * 0.85), {
                color: 0xff4500, isCrit: true, stunMs: 600, attackCategory: 'skill'
              });
            }
          }
          for (const box of [...this.world.destructibles]) {
            if (box.position.distanceTo(p.mesh.position) <= r) {
              this.world.damageBlock(box, p.dmg);
            }
          }
        }
        this.world.spawnHitSpark(p.mesh.position, p.color);
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
      }
      return !expired;
    });
  }

  swingSwordAnimation(step) {
    const startRot = step === 2 ? -1.4 : 1.4;
    const endRot = -startRot;
    this.swordPivot.rotation.y = startRot;
    this.swordPivot.rotation.x = 0.8;
    let t = 0;
    const anim = () => {
      t += 0.16;
      if (t >= 1) { this.swordPivot.rotation.set(0, 0, 0); return; }
      this.swordPivot.rotation.y = THREE.MathUtils.lerp(startRot, endRot, t);
      requestAnimationFrame(anim);
    };
    requestAnimationFrame(anim);
  }

  spawnSlashArc(radius, color, scaleY = 1.0) {
    const geo = new THREE.RingGeometry(radius * 0.45, radius, 24, 1, -Math.PI * 0.35, Math.PI * 0.7);
    const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(this.root.position).add(new THREE.Vector3(0, 1.1, 0));
    mesh.rotation.x = -Math.PI / 2 + (Math.random() - 0.5) * 0.35;
    mesh.rotation.z = this.model.rotation.y + Math.PI / 2;
    mesh.scale.set(1, scaleY, 1);
    this.scene.add(mesh);
    this.slashEffects.push({ mesh, life: 0.18, maxLife: 0.18 });
  }

  spawnAfterimage() {
    const ghost = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.38, 0.9, 4, 8),
      new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.45 })
    );
    ghost.position.copy(this.root.position).add(new THREE.Vector3(0, 0.85, 0));
    this.scene.add(ghost);
    this.slashEffects.push({ mesh: ghost, life: 0.22, maxLife: 0.22 });
  }

  addCameraShake(duration, intensity) {
    this.shakeTime = duration;
    this.shakeIntensity = intensity;
  }

  getInputMoveDirection() {
    if (this.isUiOpen()) return new THREE.Vector3();
    let f = 0, r = 0;
    if (this.keys['KeyW']) f += 1;
    if (this.keys['KeyS']) f -= 1;
    if (this.keys['KeyD']) r += 1;
    if (this.keys['KeyA']) r -= 1;
    const dir = new THREE.Vector3();
    if (f === 0 && r === 0) return dir;
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    dir.addScaledVector(forward, f).addScaledVector(right, r);
    return dir.normalize();
  }

  isCollidingHorizontal(x, z, pY) {
    // 階段の段差（0.58m以下）は自動登坂できるように余裕を持たせる
    const feet = pY + 0.58;
    const head = pY + PLAYER_HEIGHT;
    for (const wall of this.world.walls) {
      const hx = wall.userData.halfX || 1.0;
      const hy = wall.userData.halfY || 1.0;
      const hz = wall.userData.halfZ || 1.0;
      if (x > wall.position.x - hx - PLAYER_RADIUS && x < wall.position.x + hx + PLAYER_RADIUS &&
          z > wall.position.z - hz - PLAYER_RADIUS && z < wall.position.z + hz + PLAYER_RADIUS) {
        if (feet < wall.position.y + hy && head > wall.position.y - hy) return true;
      }
    }
    return false;
  }

  update(dt) {
    const now = performance.now();
    if (now > this.comboResetTimer) this.comboStep = 0;
    const mTrion = maxTrion();
    if (this.trion > mTrion) this.trion = mTrion;

    // トリオン供給機関による自然回復（毎秒最大トリオンの1.0%）
    if (this.trion < mTrion) {
      this.trionRegenAcc += dt;
      if (this.trionRegenAcc >= 1.0) {
        this.trionRegenAcc -= 1.0;
        const heal = Math.max(1, Math.round(mTrion * 0.01));
        this.trion = Math.min(mTrion, this.trion + heal);
      }
    }
    // 集中シールドの向きをカメラの向きに追従
    if (this.focusedShieldMesh) {
      if (now < this.focusedShieldUntil) {
        this.focusedShieldMesh.visible = true;
        this.focusedShieldMesh.rotation.y = this.yaw;
      } else {
        this.focusedShieldMesh.visible = false;
      }
    }

    // シールドトリガー視覚効果の更新
    if (this.shieldBubbleMesh) {
      if (now < this.trionShieldUntil) {
        this.shieldBubbleMesh.visible = true;
        this.shieldBubbleMesh.rotation.y += dt * 2.5;
      } else {
        this.shieldBubbleMesh.visible = false;
      }
    }

    const prevY = this.root.position.y;
    let moveVec = new THREE.Vector3();
    if (now < this.dodgeUntil) {
      moveVec.copy(this.dodgeDir).multiplyScalar(0.42);
    } else {
      const dir = this.getInputMoveDirection();
      if (dir.lengthSq() > 0) {
        moveVec.copy(dir).multiplyScalar(BASE_MOVE_SPEED);
        const targetAng = Math.atan2(-dir.x, -dir.z);
        const diff = Math.atan2(Math.sin(targetAng - this.model.rotation.y), Math.cos(targetAng - this.model.rotation.y));
        this.model.rotation.y += diff * 0.25;
      }
    }

    const nextX = this.root.position.x + moveVec.x;
    const nextZ = this.root.position.z + moveVec.z;
    if (!this.isCollidingHorizontal(nextX, this.root.position.z, this.root.position.y)) this.root.position.x = nextX;
    if (!this.isCollidingHorizontal(this.root.position.x, nextZ, this.root.position.y)) this.root.position.z = nextZ;

    this.velocityY -= GRAVITY;
    this.root.position.y += this.velocityY;

    // update(dt) 内の床・階段着地処理部分
    let groundY = 0;
    let landed = false;

    for (const wall of this.world.walls) {
      const hx = wall.userData.halfX || 1.0;
      const hy = wall.userData.halfY || 1.0;
      const hz = wall.userData.halfZ || 1.0;
      if (this.root.position.x > wall.position.x - hx - PLAYER_RADIUS && this.root.position.x < wall.position.x + hx + PLAYER_RADIUS &&
          this.root.position.z > wall.position.z - hz - PLAYER_RADIUS && this.root.position.z < wall.position.z + hz + PLAYER_RADIUS) {
        const top = wall.position.y + hy;
        const bottom = wall.position.y - hy;
        // 天井への頭ぶつけ判定（2階建てビル室内ジャンプ用）
        if (prevY + PLAYER_HEIGHT <= bottom && this.root.position.y + PLAYER_HEIGHT >= bottom && this.velocityY > 0) {
          this.root.position.y = bottom - PLAYER_HEIGHT;
          this.velocityY = 0;
        }
        // 床スラブ・階段ステップ着地判定（階段登り対応のため -0.62 まで許容）
        //if (this.velocityY <= 0 && this.root.position.y >= top - 0.62 && this.root.position.y <= top + 0.25 && prevY >= top - 0.62) {
          if (this.velocityY <= 0 && this.root.position.y >= top - 0.55 && this.root.position.y <= top + 0.28 && prevY >= top - 0.68) {
          groundY = Math.max(groundY, top);
          landed = true;
        }
      }
    }

    if (landed) {
      this.root.position.y = groundY;
      this.velocityY = 0;
      this.onGround = true;
    } else if (this.root.position.y <= 0) {
      this.root.position.y = 0;
      this.velocityY = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }

    this.updateProjectiles();
    this.updateCamera(dt);

    this.slashEffects = this.slashEffects.filter((fx) => {
      fx.life -= dt;
      fx.mesh.material.opacity = Math.max(0, (fx.life / fx.maxLife) * 0.85);
      if (fx.life <= 0) {
        this.scene.remove(fx.mesh);
        fx.mesh.geometry.dispose();
        fx.mesh.material.dispose();
        return false;
      }
      return true;
    });
  }

  updateCamera(dt) {
    const targetFovs = [65, 34, 18, 11];
    const targetFov = targetFovs[this.zoomLevel] || 65;
    if (Math.abs(this.camera.fov - targetFov) > 0.2) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, 0.35);
      this.camera.updateProjectionMatrix();
    }

    const focus = this.root.position.clone().add(new THREE.Vector3(0, 1.5, 0));
    const dir = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch)
    ).normalize();

    // スコープ展開中は肩越し（一人称に近い位置）へカメラを寄せる
    const baseCamDist = this.zoomLevel > 0 ? 0.6 : this.camDist;
    let safeDist = baseCamDist;
    const focus = this.root.position.clone().add(new THREE.Vector3(0, 1.5, 0));
    const dir = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch)
    ).normalize();

    // 建物内部・壁際でカメラが壁の裏にめり込まないよう距離を自動調整
    let safeDist = baseCamDist;
    for (let d = 1.2; d <= baseCamDist; d += 0.4) {
      const testPos = focus.clone().addScaledVector(dir, d);
      let blocked = false;
      for (const wall of this.world.walls) {
        if (wall.material?.transparent) continue;
        const hx = wall.userData.halfX || 1.0;
        const hy = wall.userData.halfY || 1.0;
        const hz = wall.userData.halfZ || 1.0;
        if (Math.abs(testPos.x - wall.position.x) < hx + 0.35 &&
            Math.abs(testPos.y - wall.position.y) < hy + 0.35 &&
            Math.abs(testPos.z - wall.position.z) < hz + 0.35) {
          blocked = true;
          break;
        }
      }
      if (blocked) {
        safeDist = Math.max(1.4, d - 0.45);
        break;
      }
    }

    const desiredPos = focus.clone().addScaledVector(dir, safeDist);
    if (desiredPos.y < 0.6) desiredPos.y = 0.6;

    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      desiredPos.x += (Math.random() - 0.5) * this.shakeIntensity;
      desiredPos.y += (Math.random() - 0.5) * this.shakeIntensity;
      desiredPos.z += (Math.random() - 0.5) * this.shakeIntensity;
    }

    this.camera.position.lerp(desiredPos, 0.38);
    this.camera.lookAt(focus);
  }
}
