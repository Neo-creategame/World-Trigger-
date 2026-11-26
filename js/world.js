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
    this.buildingTex = this.createBuildingTexture('#273449', '#38bdf8');
    this.roadTex = this.createGridTexture('#0f172a', '#1e293b');
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

    // 窓グリッド
    ctx.fillStyle = windowColor;
    ctx.globalAlpha = 0.28;
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

  // ---- エリア生成（0F: ボーダー本部基地 / 1F〜: 三門市市街地ランク戦場） ----
  buildFloor(floor) {
    this.clearDungeon();

    const floorMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(220, 220),
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

  // ---- ステップ1：三門市・市街地バトルフィールド生成 ----
  buildCityArena(floor) {
    const ARENA_HALF = 56;
    const WALL_H = 12;
    const bMat = new THREE.MeshStandardMaterial({ map: this.buildingTex, roughness: 0.65 });
    const roofMat = new THREE.MeshStandardMaterial({ map: this.wallTex, roughness: 0.8 });

    // 外周防壁（戦闘区域境界）
    const borders = [
      { x: 0, z: -ARENA_HALF, w: ARENA_HALF * 2 + 4, d: 3 },
      { x: 0, z: ARENA_HALF,  w: ARENA_HALF * 2 + 4, d: 3 },
      { x: -ARENA_HALF, z: 0, w: 3, d: ARENA_HALF * 2 + 4 },
      { x: ARENA_HALF,  z: 0, w: 3, d: ARENA_HALF * 2 + 4 }
    ];
    borders.forEach((b) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, WALL_H, b.d), roofMat);
      m.position.set(b.x, WALL_H / 2, b.z);
      m.userData = { halfX: b.w / 2, halfY: WALL_H / 2, halfZ: b.d / 2, destructible: false };
      this.scene.add(m);
      this.walls.push(m);
      this.dungeonMeshes.push(m);
    });

    // 市街地ブロック（道路グリッドを挟んでビル群を配置）
    const blockCoords = [-34, -17, 0, 17, 34];
    const cityVariant = floor % 3; // エリアごとに配置パターン変化

    blockCoords.forEach((bx, ix) => {
      blockCoords.forEach((bz, iz) => {
        // プレイヤー初期位置(0, 42)と敵初期位置(0, -42)付近は開けておく
        if (Math.abs(bx) <= 18 && Math.abs(bz) >= 34) return;
        // 中央広場は低めの遮蔽物のみにする
        if (bx === 0 && bz === 0) {
          this.addDestructibleBlock(-3.5, HALF, -3.5, 0x38bdf8, 60);
          this.addDestructibleBlock(3.5, HALF, 3.5, 0x38bdf8, 60);
          this.addDestructibleBlock(-3.5, HALF, 3.5, 0x38bdf8, 60);
          this.addDestructibleBlock(3.5, HALF, -3.5, 0x38bdf8, 60);
          return;
        }

        const hash = (ix * 7 + iz * 13 + cityVariant) % 5;
        if (hash === 0) {
          // 駐車車両・破壊可能バリケード（遮蔽物）
          this.addDestructibleBlock(bx - 2.2, HALF, bz, 0x4fd1c5, 45);
          this.addDestructibleBlock(bx + 2.2, HALF, bz, 0x4fd1c5, 45);
          this.addDestructibleBlock(bx, HALF + BOX_SIZE, bz, 0x63b3ed, 45);
          return;
        }

        // ビルのサイズと高さ（低層 2.6m / 中層 4.8m / 高層 7.5m）
        const bw = hash % 2 === 0 ? 9.5 : 8.0;
        const bd = hash >= 3 ? 9.5 : 8.0;
        const bh = hash === 1 ? 2.6 : hash === 2 ? 4.8 : 7.2;

        const building = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), bMat);
        building.position.set(bx, bh / 2, bz);
        building.castShadow = true;
        building.receiveShadow = true;
        building.userData = { halfX: bw / 2, halfY: bh / 2, halfZ: bd / 2, destructible: false, isBuilding: true };
        this.scene.add(building);
        this.walls.push(building);
        this.dungeonMeshes.push(building);

        // 低層ビルには屋上へ登れる外階段を設置
        if (bh <= 3.0) {
          this.buildExternalStairs(bx, bz, bw, bh, bd, roofMat);
        } else if (bh <= 5.2 && (ix + iz) % 2 === 0) {
          // 中層ビル横には屋上へ跳べるグラスホッパー起動パッドを設置
          this.spawnJumpPad(bx + bw / 2 + 1.8, bz, 0.46);
        }

        // 路地裏の破壊可能カバーブロック
        if ((ix + iz) % 2 === 1) {
          this.addDestructibleBlock(bx - bw / 2 - 1.4, HALF, bz + 2.0, 0x38bdf8, 40);
        }
      });
    });

    // 転送ゲート（勝利後に次戦または基地へ移動可能）
    this.createExitPortal(0, 0, true);

    return {
      playerStart: new THREE.Vector3(0, 0, 42),
      rivalStart: new THREE.Vector3(0, 0, -42)
    };
  }

  buildExternalStairs(bx, bz, bw, bh, bd, mat) {
    const steps = 5;
    const stepH = bh / steps;
    const stepD = 0.95;
    for (let i = 0; i < steps; i++) {
      const h = stepH * (i + 1);
      const step = new THREE.Mesh(new THREE.BoxGeometry(2.0, h, stepD), mat);
      step.position.set(bx, h / 2, bz + bd / 2 + stepD * (steps - i - 0.5));
      step.castShadow = true;
      step.receiveShadow = true;
      step.userData = { halfX: 1.0, halfY: h / 2, halfZ: stepD / 2, destructible: false };
      this.scene.add(step);
      this.walls.push(step);
      this.dungeonMeshes.push(step);
    }
  }

  spawnJumpPad(x, z, power = 0.45) {
    const pad = new THREE.Mesh(
      new THREE.RingGeometry(0.4, 1.35, 24),
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
    this.onToast('✨ ランク戦勝利！中央転送ゲート（Fキー）から次の模擬戦へ進めます！');
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

  // 2点間に建物・壁の遮蔽物があるか判定（AIの射線・索敵チェック用）
  hasLineOfSight(posA, posB) {
    const start = new THREE.Vector3(posA.x, Math.max(1.2, posA.y + 1.2), posA.z);
    const end = new THREE.Vector3(posB.x, Math.max(1.2, posB.y + 1.2), posB.z);
    const dir = end.clone().sub(start);
    const dist = dir.length();
    if (dist < 0.5) return true;
    dir.normalize();

    for (let step = 1.0; step < dist - 0.8; step += 1.2) {
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

  isBlockedForEntity(x, z, radius = 0.5, entityY = 0) {
    const feet = entityY + 0.15;
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
      if (x > wall.position.x - hx - 0.4 && x < wall.position.x + hx + 0.4 &&
          z > wall.position.z - hz - 0.4 && z < wall.position.z + hz + 0.4) {
        const top = wall.position.y + hy;
        if (currentY >= top - 0.45) {
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

    // フィールド設置型グラスホッパーパッド判定
    if (player) {
      for (const pad of this.jumpPads) {
        const d = Math.hypot(player.root.position.x - pad.pos.x, player.root.position.z - pad.pos.z);
        if (d < 1.35 && player.root.position.y <= 0.35 && player.velocityY <= 0.05) {
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
