import * as THREE from 'three';
import { saveGame } from './save.js';

const BOX_SIZE = 1.6;
const HALF = BOX_SIZE / 2;

export class World {
  constructor(scene, onToast) {
    this.scene = scene;
    this.onToast = onToast || (() => {});

    this.walls = [];
    this.destructibles = [];
    this.sparks = [];
    this.dungeonMeshes = [];
    this.interactables = [];
    this.jumpPads = [];

    this.portalMesh = null;
    this.portalRing = null;
    this.portalPos = new THREE.Vector3();
    this.portalLocked = false;

    this.wallTex = this.createGridTexture('#1e293b', '#334155');
    this.floorSlabTex = this.createGridTexture('#263244', '#3b4d66');
    this.buildingTex = this.createBuildingTexture('#273449', '#38bdf8');
    this.roadTex = this.createGridTexture('#0f172a', '#1e2636');
    this.boxTex = this.createGridTexture('#2c5282', '#63b3ed');
  }

  createGridTexture(bg, line) {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = line;
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, 124, 124);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  createBuildingTexture(bg, windowColor) {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, 128, 128);

    ctx.fillStyle = windowColor;
    ctx.globalAlpha = 0.25;
    for (let y = 16; y < 112; y += 28) {
      for (let x = 14; x < 114; x += 26) {
        ctx.fillRect(x, y, 16, 16);
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  clearDungeon() {
    for (const m of this.dungeonMeshes) this.scene.remove(m);
    this.dungeonMeshes = [];

    for (const w of this.walls) {
      if (!w.userData.isInstancedProxy) this.scene.remove(w);
    }
    this.walls = [];
    this.destructibles = [];
    this.interactables = [];
    this.jumpPads = [];

    if (this.portalMesh) {
      this.scene.remove(this.portalMesh);
      this.portalMesh = null;
    }
    if (this.portalRing) {
      this.scene.remove(this.portalRing);
      this.portalRing = null;
    }
  }

  buildFloor(floor) {
    this.clearDungeon();

    const floorMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(260, 260),
      new THREE.MeshStandardMaterial({ map: this.roadTex, roughness: 0.85 })
    );
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.receiveShadow = true;
    this.scene.add(floorMesh);
    this.dungeonMeshes.push(floorMesh);

    if (floor === 0) {
      return this.buildBase();
    }
    return this.buildCityArena(floor);
  }

  // 汎用ボックスパーツ追加（壁・床スラブ・柱・渡り廊下）
  addSolidBox(cx, cy, cz, w, h, d, mat, extraData = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(cx, cy, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = {
      halfX: w / 2,
      halfY: h / 2,
      halfZ: d / 2,
      destructible: false,
      ...extraData
    };
    this.scene.add(mesh);
    this.walls.push(mesh);
    this.dungeonMeshes.push(mesh);
    return mesh;
  }

  // ---- 中に入って戦える「大型複合ビル（複数階層・階段・屋上）」を生成 ----
  buildEnterableBuilding(cx, cz, floors = 2, size = 18) {
    const wallMat = new THREE.MeshStandardMaterial({ map: this.buildingTex, roughness: 0.65 });
    const floorMat = new THREE.MeshStandardMaterial({ map: this.floorSlabTex, roughness: 0.75 });
    const stairMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.6 });

    const floorH = 4.2;     // 1フロアの天井高（ジャンプやカメラに余裕を持たせる）
    const slabThick = 0.45; // 床の厚み
    const wallThick = 0.7;  // 外壁の厚み
    const halfS = size / 2;
    const doorW = 4.4;      // 出入り口の広さ

    for (let f = 0; f < floors; f++) {
      const baseY = f * floorH;
      const wallCenterY = baseY + floorH / 2;
      const wallH = floorH - slabThick;

      // 2階以上の床スラブ（階段用の吹き抜け開口を東側に確保）
      if (f > 0) {
        const stairWellW = 4.6;
        const mainSlabW = size - stairWellW;
        // メインフロア床
        this.addSolidBox(
          cx - stairWellW / 2,
          baseY - slabThick / 2,
          cz,
          mainSlabW,
          slabThick,
          size,
          floorMat
        );
        // 吹き抜けの北側・南側の踊り場床
        this.addSolidBox(
          cx + halfS - stairWellW / 2,
          baseY - slabThick / 2,
          cz - halfS + 2.5,
          stairWellW,
          slabThick,
          5.0,
          floorMat
        );
        this.addSolidBox(
          cx + halfS - stairWellW / 2,
          baseY - slabThick / 2,
          cz + halfS - 2.5,
          stairWellW,
          slabThick,
          5.0,
          floorMat
        );
      }

      // 外壁（1階は4方向すべてに広い出入り口を開ける / 2階以上は窓開口＋一部破壊可能ガラス壁）
      const sideSeg = (size - doorW) / 2;

      // 北壁・南壁（中央に出入り口 or バルコニー開口）
      [-1, 1].forEach((zSign) => {
        const wz = cz + zSign * (halfS - wallThick / 2);
        this.addSolidBox(cx - halfS + sideSeg / 2, wallCenterY, wz, sideSeg, wallH, wallThick, wallMat);
        this.addSolidBox(cx + halfS - sideSeg / 2, wallCenterY, wz, sideSeg, wallH, wallThick, wallMat);

        // 出入り口の上部垂れ壁（梁）
        this.addSolidBox(cx, baseY + wallH - 0.5, wz, doorW, 1.0, wallThick, wallMat);

        // 2階以上は腰壁（落下防止＆遮蔽物）を設置
        if (f > 0) {
          this.addSolidBox(cx, baseY + 0.55, wz, doorW, 1.1, wallThick * 0.8, floorMat);
        }
      });

      // 西壁・東壁
      [-1, 1].forEach((xSign) => {
        const wx = cx + xSign * (halfS - wallThick / 2);
        if (f === 0) {
          // 1階は東西にも出入り口を開放（4方向から突入・離脱可能）
          this.addSolidBox(wx, wallCenterY, cz - halfS + sideSeg / 2, wallThick, wallH, sideSeg, wallMat);
          this.addSolidBox(wx, wallCenterY, cz + halfS - sideSeg / 2, wallThick, wallH, sideSeg, wallMat);
          this.addSolidBox(wx, baseY + wallH - 0.5, cz, wallThick, 1.0, doorW, wallMat);
        } else {
          // 2階以上は左右壁＋中央に破壊可能なガラス窓壁（メテオラや旋空で吹き飛ばせる）
          this.addSolidBox(wx, wallCenterY, cz - halfS + sideSeg / 2, wallThick, wallH, sideSeg, wallMat);
          this.addSolidBox(wx, wallCenterY, cz + halfS - sideSeg / 2, wallThick, wallH, sideSeg, wallMat);
          this.addDestructibleBlock(wx, baseY + 1.1, cz - 1.0, 0x38bdf8, 45);
          this.addDestructibleBlock(wx, baseY + 1.1, cz + 1.0, 0x38bdf8, 45);
        }
      });

      // 室内柱と戦術用カバーオブジェクト
      this.addSolidBox(cx - 3.2, wallCenterY, cz - 3.2, 1.1, wallH, 1.1, wallMat);
      this.addSolidBox(cx - 3.2, wallCenterY, cz + 3.2, 1.1, wallH, 1.1, wallMat);
      if (f === 0) {
        this.addDestructibleBlock(cx - 1.2, HALF, cz, 0x4fd1c5, 50);
      }

      // 上の階（または屋上）へ登る内階段（東側の吹き抜け空間に配置）
      const stairX = cx + halfS - 2.3;
      const steps = 8;
      const stepH = floorH / steps;
      const stepD = (size - 8.0) / steps;
      const stairStartZ = cz - (size - 8.0) / 2;

      for (let s = 0; s < steps; s++) {
        const sh = stepH * (s + 1);
        const sz = stairStartZ + stepD * (s + 0.5);
        this.addSolidBox(stairX, baseY + sh / 2, sz, 2.6, sh, stepD + 0.15, stairMat);
      }
    }

    // 屋上スラブ（階段の出口部分だけ吹き抜け開口を残す）
    const roofY = floors * floorH;
    const stairWellW = 4.6;
    const mainRoofW = size - stairWellW;
    this.addSolidBox(cx - stairWellW / 2, roofY - slabThick / 2, cz, mainRoofW, slabThick, size, floorMat);
    this.addSolidBox(cx + halfS - stairWellW / 2, roofY - slabThick / 2, cz - halfS + 2.5, stairWellW, slabThick, 5.0, floorMat);
    this.addSolidBox(cx + halfS - stairWellW / 2, roofY - slabThick / 2, cz + halfS - 2.5, stairWellW, slabThick, 5.0, floorMat);

    // 屋上の外周パラペット（狙撃手用の低い遮蔽壁）
    const paraH = 1.05;
    this.addSolidBox(cx, roofY + paraH / 2, cz - halfS + 0.35, size, paraH, 0.7, wallMat);
    this.addSolidBox(cx, roofY + paraH / 2, cz + halfS - 0.35, size, paraH, 0.7, wallMat);
    this.addSolidBox(cx - halfS + 0.35, roofY + paraH / 2, cz, 0.7, paraH, size - 1.4, wallMat);
    this.addSolidBox(cx + halfS - 0.35, roofY + paraH / 2, cz, 0.7, paraH, size - 1.4, wallMat);

    // 屋上の空調設備（スナイパー・シューター用の遮蔽物）
    this.addDestructibleBlock(cx - 3.5, roofY + HALF, cz - 3.5, 0x63b3ed, 55);
    this.addDestructibleBlock(cx - 3.5, roofY + HALF, cz + 3.5, 0x63b3ed, 55);
  }

  // 隣り合う大型ビル同士を2階の高さで繋ぐ渡り廊下（スカイブリッジ）
  buildSkyBridge(x1, z1, x2, z2, floorLevel = 1) {
    const floorH = 4.2;
    const bridgeY = floorLevel * floorH - 0.22;
    const midX = (x1 + x2) / 2;
    const midZ = (z1 + z2) / 2;
    const bridgeMat = new THREE.MeshStandardMaterial({ map: this.floorSlabTex, roughness: 0.6 });
    const railMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.45 });

    if (Math.abs(x1 - x2) > Math.abs(z1 - z2)) {
      const span = Math.abs(x1 - x2) - 17.5;
      if (span <= 1) return;
      this.addSolidBox(midX, bridgeY, midZ, span, 0.45, 3.8, bridgeMat);
      this.addSolidBox(midX, bridgeY + 0.75, midZ - 1.75, span, 1.1, 0.25, railMat);
      this.addSolidBox(midX, bridgeY + 0.75, midZ + 1.75, span, 1.1, 0.25, railMat);
    } else {
      const span = Math.abs(z1 - z2) - 17.5;
      if (span <= 1) return;
      this.addSolidBox(midX, bridgeY, midZ, 3.8, 0.45, span, bridgeMat);
      this.addSolidBox(midX - 1.75, bridgeY + 0.75, midZ, 0.25, 1.1, span, railMat);
      this.addSolidBox(midX + 1.75, bridgeY + 0.75, midZ, 0.25, 1.1, span, railMat);
    }
  }

  // ---- 三門市・大型市街地バトルフィールド生成 ----
  buildCityArena(floor) {
    const ARENA_HALF = 68;
    const WALL_H = 16;
    const roofMat = new THREE.MeshStandardMaterial({ map: this.wallTex, roughness: 0.8 });

    // 外周防壁
    this.addSolidBox(0, WALL_H / 2, -ARENA_HALF, ARENA_HALF * 2 + 4, WALL_H, 3, roofMat);
    this.addSolidBox(0, WALL_H / 2,  ARENA_HALF, ARENA_HALF * 2 + 4, WALL_H, 3, roofMat);
    this.addSolidBox(-ARENA_HALF, WALL_H / 2, 0, 3, WALL_H, ARENA_HALF * 2 + 4, roofMat);
    this.addSolidBox( ARENA_HALF, WALL_H / 2, 0, 3, WALL_H, ARENA_HALF * 2 + 4, roofMat);

    // 大型複合ビル群の配置（すべて中に入って戦える立体建築）
    const variant = floor % 2;

    // 1. 中央の巨大ランドマークビル（3階建て＋屋上＝高さ12.6mの超大型施設）
    this.buildEnterableBuilding(0, 0, 3, 20);

    // 2. 四方の大型複合ビル（2階建て＋屋上）
    const megaCoords = [
      { x: -30, z: -24, floors: variant === 0 ? 3 : 2 },
      { x:  30, z: -24, floors: variant === 0 ? 2 : 3 },
      { x: -30, z:  24, floors: variant === 0 ? 2 : 3 },
      { x:  30, z:  24, floors: variant === 0 ? 3 : 2 }
    ];
    megaCoords.forEach((b) => {
      this.buildEnterableBuilding(b.x, b.z, b.floors, 18);
    });

    // 3. 北西・北東・南西・南東の連絡空中ブリッジ（2階の高さで接続）
    this.buildSkyBridge(-30, -24, -30, 24, 1);
    this.buildSkyBridge( 30, -24,  30, 24, 1);

    // 4. 大通り沿いのグラスホッパー起動パッド（一気に屋上へ跳べるショートカット）
    this.spawnJumpPad(-14, -14, 0.56);
    this.spawnJumpPad( 14,  14, 0.56);
    this.spawnJumpPad(-14,  14, 0.56);
    this.spawnJumpPad( 14, -14, 0.56);

    // 5. 大通りの破壊可能遮蔽物（車両・バリケード）
    [
      [-15, 0], [15, 0], [0, -24], [0, 24],
      [-30, 0], [30, 0]
    ].forEach(([vx, vz]) => {
      this.addDestructibleBlock(vx - 1.6, HALF, vz, 0x4fd1c5, 50);
      this.addDestructibleBlock(vx + 1.6, HALF, vz, 0x4fd1c5, 50);
      this.addDestructibleBlock(vx, HALF + BOX_SIZE, vz, 0x63b3ed, 50);
    });

    // 中央大型ビル1階ロビー中央に転送ゲート設置
    this.createExitPortal(0, 0, true);

    return {
      playerStart: new THREE.Vector3(0, 0, 52),
      rivalStart: new THREE.Vector3(0, 0, -52)
    };
  }

  spawnJumpPad(x, z, power = 0.52) {
    const pad = new THREE.Mesh(
      new THREE.RingGeometry(0.4, 1.5, 24),
      new THREE.MeshBasicMaterial({ color: 0x48bb78, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(x, 0.08, z);
    this.scene.add(pad);
    this.dungeonMeshes.push(pad);
    this.jumpPads.push({ pos: new THREE.Vector3(x, 0, z), power });
  }

  // ---- 0F：ボーダー本部基地 ----
  buildBase() {
    const W = 20;
    const H = 20;
    const TILE_SIZE = 4.5;
    const WALL_HEIGHT = 4.5;
    const wallPositions = [];
    const toWorldX = (gx) => (gx - 9.5) * TILE_SIZE;
    const toWorldZ = (gy) => (gy - 9.5) * TILE_SIZE;

    for (let gy = 0; gy < H; gy++) {
      for (let gx = 0; gx < W; gx++) {
        if (gx === 0 || gx === W - 1 || gy === 0 || gy === H - 1) {
          wallPositions.push({ x: toWorldX(gx), z: toWorldZ(gy) });
        }
      }
    }

    const wallGeo = new THREE.BoxGeometry(TILE_SIZE, WALL_HEIGHT, TILE_SIZE);
    const wallMat = new THREE.MeshStandardMaterial({ map: this.wallTex, roughness: 0.75 });
    const inst = new THREE.InstancedMesh(wallGeo, wallMat, wallPositions.length);
    const dummy = new THREE.Object3D();
    const halfTile = TILE_SIZE / 2;

    wallPositions.forEach((p, idx) => {
      dummy.position.set(p.x, WALL_HEIGHT / 2, p.z);
      dummy.updateMatrix();
      inst.setMatrixAt(idx, dummy.matrix);
      this.walls.push({
        position: new THREE.Vector3(p.x, WALL_HEIGHT / 2, p.z),
        userData: { isInstancedProxy: true, halfX: halfTile, halfY: WALL_HEIGHT / 2, halfZ: halfTile, destructible: false }
      });
    });
    inst.instanceMatrix.needsUpdate = true;
    this.scene.add(inst);
    this.dungeonMeshes.push(inst);

    this.spawnBaseFacility(-12, -4, 'trigger', 0x00ffff, '[F] 💠 トリガー開発室');
    this.spawnBaseFacility( 12, -4, 'gacha',   0xffd36a, '[F] 🎰 技術開発室・トリガー支給');
    this.spawnBaseFacility(  0,  6, 'supply',  0x48bb78, '[F] ⚡ トリオン供給所');

    this.createExitPortal(0, -28, false);

    return {
      playerStart: new THREE.Vector3(0, 0, 22),
      rivalStart: null
    };
  }

  spawnBaseFacility(x, z, tabId, color, label) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    const pillar = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 2.4, 2.2),
      new THREE.MeshStandardMaterial({ color, roughness: 0.4 })
    );
    pillar.position.y = 1.2;
    pillar.castShadow = true;
    group.add(pillar);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.4, 1.8, 24),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.08;
    group.add(ring);

    this.scene.add(group);
    this.dungeonMeshes.push(group);

    this.interactables.push({
      type: 'base_facility',
      tabId,
      label,
      pos: new THREE.Vector3(x, 0, z)
    });
  }

  getNearbyInteractable(playerPos) {
    for (const item of this.interactables) {
      if (playerPos.distanceTo(item.pos) <= 2.6) {
        return item;
      }
    }
    return null;
  }

  triggerInteractable(item) {
    if (item.type === 'base_facility') {
      saveGame();
      window.dispatchEvent(new CustomEvent('open-town-tab', { detail: item.tabId }));
    }
  }

  createExitPortal(x, z, locked = false) {
    this.portalPos.set(x, 0, z);
    this.portalLocked = locked;

    const color = locked ? 0xff1144 : 0x00ffff;
    this.portalMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 1.6, 0.25, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75 })
    );
    this.portalMesh.position.set(x, 0.14, z);
    this.scene.add(this.portalMesh);

    this.portalRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.65, 0.1, 10, 32),
      new THREE.MeshBasicMaterial({ color: locked ? 0xff4500 : 0x63b3ed })
    );
    this.portalRing.rotation.x = Math.PI / 2;
    this.portalRing.position.set(x, 1.3, z);
    this.scene.add(this.portalRing);
  }

  unlockExitPortal() {
    if (!this.portalLocked || !this.portalMesh) return;
    this.portalLocked = false;
    this.portalMesh.material.color.setHex(0x00ffff);
    this.portalRing.material.color.setHex(0x63b3ed);
    this.onToast('✨ ランク戦勝利！中央大型ビル1階の転送ゲート（Fキー）が解除されました！');
  }

  addDestructibleBlock(x, y, z, color, hp) {
    const mat = new THREE.MeshStandardMaterial({
      map: this.boxTex,
      color,
      roughness: 0.4,
      emissive: color,
      emissiveIntensity: 0.18
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(BOX_SIZE, BOX_SIZE, BOX_SIZE), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = {
      halfX: HALF,
      halfY: HALF,
      halfZ: HALF,
      destructible: true,
      hp,
      maxHp: hp,
      color
    };
    this.scene.add(mesh);
    this.walls.push(mesh);
    this.destructibles.push(mesh);
  }

  damageBlock(block, dmg) {
    if (!block.userData.destructible) return;
    block.userData.hp -= dmg;
    this.spawnHitSpark(block.position, block.userData.color);
    block.material.emissiveIntensity = 0.85;
    setTimeout(() => {
      if (block.material) block.material.emissiveIntensity = 0.18;
    }, 80);

    if (block.userData.hp <= 0) {
      this.destroyBlock(block);
    }
  }

  destroyBlock(block) {
    const pos = block.position.clone();
    const color = block.userData.color;
    for (let i = 0; i < 12; i++) {
      this.spawnHitSpark(pos, color);
    }
    this.scene.remove(block);
    this.walls = this.walls.filter((w) => w !== block);
    this.destructibles = this.destructibles.filter((d) => d !== block);
  }

  spawnHitSpark(pos, color = 0x00ffff) {
    const geo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
    const mat = new THREE.MeshBasicMaterial({ color });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    this.scene.add(mesh);

    this.sparks.push({
      mesh,
      vel: new THREE.Vector3(
        (Math.random() - 0.5) * 0.25,
        Math.random() * 0.2 + 0.08,
        (Math.random() - 0.5) * 0.25
      ),
      life: 0.42
    });
  }

  hasLineOfSight(posA, posB) {
    const start = new THREE.Vector3(posA.x, posA.y + 1.2, posA.z);
    const end = new THREE.Vector3(posB.x, posB.y + 1.2, posB.z);
    const dir = end.clone().sub(start);
    const dist = dir.length();
    if (dist < 0.5) return true;
    dir.normalize();

    for (let step = 1.0; step < dist - 0.8; step += 1.0) {
      const px = start.x + dir.x * step;
      const py = start.y + dir.y * step;
      const pz = start.z + dir.z * step;
      for (const wall of this.walls) {
        const hx = wall.userData.halfX || HALF;
        const hy = wall.userData.halfY || HALF;
        const hz = wall.userData.halfZ || HALF;
        if (Math.abs(px - wall.position.x) < hx &&
            Math.abs(py - wall.position.y) < hy &&
            Math.abs(pz - wall.position.z) < hz) {
          return false;
        }
      }
    }
    return true;
  }

  // 段差（階段の1段分 0.55m以下）は自動乗り越え可能にし、それ以上の壁だけ衝突判定
  isBlockedForEntity(x, z, radius = 0.5, entityY = 0) {
    const stepUpAllowance = 0.58;
    const feet = entityY + stepUpAllowance;
    const head = entityY + 2.0;
    for (const wall of this.walls) {
      const hx = wall.userData.halfX || HALF;
      const hy = wall.userData.halfY || HALF;
      const hz = wall.userData.halfZ || HALF;
      if (x > wall.position.x - hx - radius && x < wall.position.x + hx + radius &&
          z > wall.position.z - hz - radius && z < wall.position.z + hz + radius) {
        if (feet < wall.position.y + hy && head > wall.position.y - hy) {
          return true;
        }
      }
    }
    return false;
  }

  getGroundHeightAt(x, z, currentY) {
    let groundY = 0;
    for (const wall of this.walls) {
      const hx = wall.userData.halfX || HALF;
      const hy = wall.userData.halfY || HALF;
      const hz = wall.userData.halfZ || HALF;
      if (x > wall.position.x - hx - 0.42 && x < wall.position.x + hx + 0.42 &&
          z > wall.position.z - hz - 0.42 && z < wall.position.z + hz + 0.42) {
        const top = wall.position.y + hy;
        // 階段の段差（+0.6mまで）または現在足元の床スラブを検出
        if (currentY >= top - 0.62) {
          groundY = Math.max(groundY, top);
        }
      }
    }
    return groundY;
  }

  update(dt, player) {
    if (this.portalRing) {
      this.portalRing.rotation.z += dt * 1.8;
      this.portalRing.position.y = 1.25 + Math.sin(performance.now() * 0.004) * 0.2;
    }

    if (player) {
      for (const pad of this.jumpPads) {
        const d = Math.hypot(player.root.position.x - pad.pos.x, player.root.position.z - pad.pos.z);
        if (d < 1.5 && player.root.position.y <= 0.35 && player.velocityY <= 0.05) {
          player.velocityY = pad.power;
          player.onGround = false;
          this.spawnHitSpark(pad.pos.clone().add(new THREE.Vector3(0, 0.3, 0)), 0x48bb78);
        }
      }
    }

    this.sparks = this.sparks.filter((s) => {
      s.vel.y -= 0.012;
      s.mesh.position.add(s.vel);
      s.mesh.rotation.x += 0.15;
      s.mesh.rotation.y += 0.15;
      s.life -= dt;
      s.mesh.scale.setScalar(Math.max(0.01, s.life * 2.2));
      if (s.life <= 0) {
        this.scene.remove(s.mesh);
        s.mesh.geometry.dispose();
        s.mesh.material.dispose();
        return false;
      }
      return true;
    });
  }
}
