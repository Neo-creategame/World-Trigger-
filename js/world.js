import * as THREE from 'three';

const BOX_SIZE = 1.6;
const HALF = BOX_SIZE / 2;
const GRID_CELL_SIZE = 12.0; // 空間ハッシュグリッドの1セルサイズ（12m × 12m）

export class World {
  constructor(scene, onToast) {
    this.scene = scene;
    this.onToast = onToast || (() => {});

    // 論理コライダー配列（互換性維持）＆ 空間ハッシュグリッド
    this.walls = [];
    this.destructibles = [];
    this.spatialGrid = new Map();

    // InstancedMesh バッチ管理用
    this.instancedBatches = [];
    this.pendingInstances = new Map();

    this.sparks = [];
    this.dungeonMeshes = [];
    this.interactables = [];
    this.jumpPads = [];

    this.portalMesh = null;
    this.portalRing = null;
    this.portalPos = new THREE.Vector3();
    this.portalLocked = false;

    this.wallTex = this.createModernPanelTexture('#cbd5e1', '#94a3b8', '#0ea5e9');
    this.floorSlabTex = this.createGridTexture('#475569', '#64748b');
    this.buildingTex = this.createModernPanelTexture('#e2e8f0', '#94a3b8', '#38bdf8');
    this.roadTex = this.createRoadTexture('#1e293b', '#334155');
    this.boxTex = this.createGridTexture('#0284c7', '#7dd3fc');
    this.initSharedMaterials();
  }

  initSharedMaterials() {
    this.sharedMats = {
      wall: new THREE.MeshStandardMaterial({ map: this.buildingTex, roughness: 0.55 }),
      floor: new THREE.MeshStandardMaterial({ map: this.floorSlabTex, roughness: 0.7 }),
      stair: new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.5 }),
      rail: new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.4 }),
      glassRail: new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.42,
        roughness: 0.2
      }),
      destructibleBox: new THREE.MeshStandardMaterial({
        map: this.boxTex,
        color: 0x38bdf8,
        roughness: 0.4
      }),
      destructibleProp: new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.45
      })
    };
    this.unitBoxGeo = new THREE.BoxGeometry(1, 1, 1);
  }

  // ==========================================
  // 空間ハッシュグリッド（Spatial Hash Grid）管理
  // ==========================================
  getCellKey(cx, cz) {
    return `${cx},${cz}`;
  }

  registerWallToGrid(wall) {
    const hx = wall.userData.halfX || HALF;
    const hz = wall.userData.halfZ || HALF;
    const minX = Math.floor((wall.position.x - hx) / GRID_CELL_SIZE);
    const maxX = Math.floor((wall.position.x + hx) / GRID_CELL_SIZE);
    const minZ = Math.floor((wall.position.z - hz) / GRID_CELL_SIZE);
    const maxZ = Math.floor((wall.position.z + hz) / GRID_CELL_SIZE);

    wall.userData._gridKeys = [];
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const key = this.getCellKey(cx, cz);
        let bucket = this.spatialGrid.get(key);
        if (!bucket) {
          bucket = [];
          this.spatialGrid.set(key, bucket);
        }
        bucket.push(wall);
        wall.userData._gridKeys.push(key);
      }
    }
  }

  unregisterWallFromGrid(wall) {
    if (!wall.userData._gridKeys) return;
    for (const key of wall.userData._gridKeys) {
      const bucket = this.spatialGrid.get(key);
      if (bucket) {
        const idx = bucket.indexOf(wall);
        if (idx !== -1) bucket.splice(idx, 1);
      }
    }
    wall.userData._gridKeys = [];
  }

  // 指定座標＋半径範囲の壁だけを高速取得（O(1)）
  queryNearbyWalls(x, z, radius = 2.0) {
    const minX = Math.floor((x - radius) / GRID_CELL_SIZE);
    const maxX = Math.floor((x + radius) / GRID_CELL_SIZE);
    const minZ = Math.floor((z - radius) / GRID_CELL_SIZE);
    const maxZ = Math.floor((z + radius) / GRID_CELL_SIZE);

    const results = [];
    const seen = new Set();
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const bucket = this.spatialGrid.get(this.getCellKey(cx, cz));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const w = bucket[i];
          if (!seen.has(w)) {
            seen.add(w);
            results.push(w);
          }
        }
      }
    }
    return results;
  }

  // ==========================================
  // InstancedMesh 一括描画バッチ化システム
  // ==========================================
  queueInstance(batchKey, mat, cx, cy, cz, w, h, d, colorHex = null, castShadow = false) {
    if (!this.pendingInstances.has(batchKey)) {
      this.pendingInstances.set(batchKey, {
        mat,
        castShadow,
        items: []
      });
    }
    const batch = this.pendingInstances.get(batchKey);
    const index = batch.items.length;
    batch.items.push({ cx, cy, cz, w, h, d, colorHex });
    return { batchKey, index };
  }

  flushInstances() {
    const dummy = new THREE.Object3D();
    const tmpColor = new THREE.Color();

    for (const [batchKey, data] of this.pendingInstances.entries()) {
      const count = data.items.length;
      if (count === 0) continue;

      const instMesh = new THREE.InstancedMesh(this.unitBoxGeo, data.mat, count);
      instMesh.castShadow = data.castShadow;
      instMesh.receiveShadow = true;

      let hasCustomColors = false;
      for (let i = 0; i < count; i++) {
        const it = data.items[i];
        dummy.position.set(it.cx, it.cy, it.cz);
        dummy.scale.set(it.w, it.h, it.d);
        dummy.updateMatrix();
        instMesh.setMatrixAt(i, dummy.matrix);

        if (it.colorHex !== null) {
          tmpColor.setHex(it.colorHex);
          instMesh.setColorAt(i, tmpColor);
          hasCustomColors = true;
        }
      }

      instMesh.instanceMatrix.needsUpdate = true;
      if (hasCustomColors && instMesh.instanceColor) {
        instMesh.instanceColor.needsUpdate = true;
      }

      this.scene.add(instMesh);
      this.instancedBatches.push(instMesh);
      this.dungeonMeshes.push(instMesh);
      data.instMesh = instMesh;
    }
  }

  hideInstance(batchKey, index) {
    const data = this.pendingInstances.get(batchKey);
    if (!data || !data.instMesh) return;
    const zeroMat = new THREE.Matrix4().makeScale(0, 0, 0);
    data.instMesh.setMatrixAt(index, zeroMat);
    data.instMesh.instanceMatrix.needsUpdate = true;
  }

  createGridTexture(bg, line) {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = line;
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, 124, 124);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  createModernPanelTexture(bg, line, accent) {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 128, 128);

    ctx.strokeStyle = line;
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, 124, 124);
    ctx.beginPath();
    ctx.moveTo(0, 64);
    ctx.lineTo(128, 64);
    ctx.stroke();

    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.45;
    ctx.fillRect(6, 58, 116, 4);

    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  createRoadTexture(bg, line) {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = line;
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, 126, 126);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  clearDungeon() {
    if (this.scene) {
      this.scene.background = new THREE.Color(0x0b1120);
      if (this.scene.fog) this.scene.fog.color.setHex(0x0b1120);
    }

    for (const m of this.dungeonMeshes) {
      this.scene.remove(m);
      if (m.isInstancedMesh) m.dispose();
    }
    this.dungeonMeshes = [];
    this.instancedBatches = [];
    this.pendingInstances.clear();

    for (const w of this.walls) {
      if (!w.userData.isInstancedProxy && w.parent) {
        this.scene.remove(w);
      }
    }
    this.walls = [];
    this.destructibles = [];
    this.spatialGrid.clear();
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
      new THREE.PlaneGeometry(420, 420),
      new THREE.MeshStandardMaterial({ map: this.roadTex, roughness: 0.85 })
    );
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.receiveShadow = true;
    this.scene.add(floorMesh);
    this.dungeonMeshes.push(floorMesh);

    let layout;
    if (floor === 0) {
      layout = this.buildBase();
    } else if (floor % 2 === 0) {
      layout = this.buildResidentialArena(floor);
    } else {
      layout = this.buildCityArena(floor);
    }

    this.flushInstances();
    return layout;
  }

  // ---- 軽量コライダープロキシ生成 + InstancedMesh 登録 ----
  addSolidBox(cx, cy, cz, w, h, d, mat, extraData = {}, castShadow = false) {
    const isTransparent = !!(mat && mat.transparent);
    const batchKey = mat === this.sharedMats.wall ? 'wall'
      : mat === this.sharedMats.floor ? 'floor'
      : mat === this.sharedMats.stair ? 'stair'
      : mat === this.sharedMats.rail ? 'rail'
      : mat === this.sharedMats.glassRail ? 'glassRail'
      : `custom_${mat.uuid}`;

    const ref = this.queueInstance(batchKey, mat, cx, cy, cz, w, h, d, null, castShadow);

    const collider = {
      position: new THREE.Vector3(cx, cy, cz),
      material: { transparent: isTransparent },
      userData: {
        isInstancedProxy: true,
        batchKey: ref.batchKey,
        instanceIndex: ref.index,
        halfX: w / 2,
        halfY: h / 2,
        halfZ: d / 2,
        destructible: false,
        ...extraData
      }
    };

    this.walls.push(collider);
    this.registerWallToGrid(collider);
    return collider;
  }

  addDestructibleBlock(cx, cy, cz, colorHex = 0x38bdf8, hp = 50) {
    const ref = this.queueInstance(
      'destructibleBox',
      this.sharedMats.destructibleBox,
      cx, cy, cz,
      BOX_SIZE, BOX_SIZE, BOX_SIZE,
      colorHex,
      false
    );

    const collider = {
      position: new THREE.Vector3(cx, cy, cz),
      material: { transparent: false },
      userData: {
        isInstancedProxy: true,
        batchKey: ref.batchKey,
        instanceIndex: ref.index,
        halfX: HALF,
        halfY: HALF,
        halfZ: HALF,
        destructible: true,
        hp,
        maxHp: hp
      }
    };

    this.walls.push(collider);
    this.destructibles.push(collider);
    this.registerWallToGrid(collider);
    return collider;
  }

  addDestructibleProp(cx, cy, cz, w, h, d, colorHex, hp = 55) {
    const ref = this.queueInstance(
      'destructibleProp',
      this.sharedMats.destructibleProp,
      cx, cy, cz,
      w, h, d,
      colorHex,
      false
    );

    const collider = {
      position: new THREE.Vector3(cx, cy, cz),
      material: { transparent: false },
      userData: {
        isInstancedProxy: true,
        batchKey: ref.batchKey,
        instanceIndex: ref.index,
        halfX: w / 2,
        halfY: h / 2,
        halfZ: d / 2,
        destructible: true,
        hp,
        maxHp: hp
      }
    };

    this.walls.push(collider);
    this.destructibles.push(collider);
    this.registerWallToGrid(collider);
    return collider;
  }

  // ---- ボーダー本部基地（エリア0） ----
  buildBase() {
    this.portalLocked = false;
    const wallMat = new THREE.MeshStandardMaterial({ map: this.wallTex, roughness: 0.5 });
    const trimMat = new THREE.MeshStandardMaterial({
      color: 0x0ea5e9,
      emissive: 0x0284c7,
      emissiveIntensity: 0.6
    });

    const size = 40;
    const half = size / 2;
    const wallH = 6.5;
    this.addSolidBox(0, wallH / 2, -half, size, wallH, 1.2, wallMat);
    this.addSolidBox(0, wallH / 2, half, size, wallH, 1.2, wallMat);
    this.addSolidBox(-half, wallH / 2, 0, 1.2, wallH, size, wallMat);
    this.addSolidBox(half, wallH / 2, 0, 1.2, wallH, size, wallMat);

    [-12, 12].forEach((px) => {
      [-12, 12].forEach((pz) => {
        this.addSolidBox(px, wallH / 2, pz, 1.4, wallH, 1.4, wallMat);
        this.addSolidBox(px, 2.2, pz, 1.5, 0.25, 1.5, trimMat, {}, false);
      });
    });

    this.addDestructibleBlock(-6, HALF, -6, 0x38bdf8, 60);
    this.addDestructibleBlock(-6, HALF + BOX_SIZE, -6, 0x38bdf8, 60);
    this.addDestructibleBlock(6, HALF, -6, 0x38bdf8, 60);
    this.addDestructibleCar(-11, -6, false, 0x64748b);

    this.addSolidBox(-13, 1.6, 8, 5.5, 3.2, 5.5, wallMat);
    this.addSolidBox(-13, 3.3, 8, 5.7, 0.2, 5.7, trimMat, {}, false);

    this.createTerminalMesh(6, 8, 0x38bdf8);
    this.interactables.push({
      type: 'trigger_terminal',
      pos: new THREE.Vector3(6, 1.0, 8),
      radius: 3.0,
      label: '[F] トリガー構成端末'
    });

    this.createTerminalMesh(-6, 8, 0x48bb78);
    this.interactables.push({
      type: 'supply_terminal',
      pos: new THREE.Vector3(-6, 1.0, 8),
      radius: 3.0,
      label: '[F] トリオン供給端末（全充填）'
    });

    this.createPortal(0, 1.8, -14, false);

    const playerStart = new THREE.Vector3(0, 0, 12);
    return {
      playerStart,
      rivalStart: null,
      spawnPos: playerStart,
      enemySpawns: []
    };
  }

  createTerminalMesh(x, z, screenColor) {
    const termGroup = new THREE.Group();
    const baseMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 1.2, 1.2),
      new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.4 })
    );
    baseMesh.position.y = 0.6;
    termGroup.add(baseMesh);

    const screenMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.85, 0.1),
      new THREE.MeshStandardMaterial({
        color: screenColor,
        emissive: screenColor,
        emissiveIntensity: 0.9
      })
    );
    screenMesh.position.set(0, 1.45, 0.25);
    screenMesh.rotation.x = -0.35;
    termGroup.add(screenMesh);

    termGroup.position.set(x, 0, z);
    this.scene.add(termGroup);
    this.dungeonMeshes.push(termGroup);
  }

  addDestructibleCar(cx, cz, rotateZ = false, bodyColor = 0x475569) {
    const w = rotateZ ? 2.1 : 4.2;
    const d = rotateZ ? 4.2 : 2.1;
    this.addDestructibleProp(cx, 0.55, cz, w, 1.1, d, bodyColor, 85);
    this.addDestructibleProp(cx, 1.4, cz, w * 0.58, 0.65, d * 0.85, 0x94a3b8, 45);
  }

  addVendingMachine(cx, cz, colorHex = 0x0ea5e9) {
    this.addDestructibleProp(cx, 1.1, cz, 1.2, 2.2, 0.9, colorHex, 50);
  }

  addGuardRail(cx, cz, alongX = true) {
    const w = alongX ? 4.4 : 0.35;
    const d = alongX ? 0.35 : 4.4;
    this.addDestructibleProp(cx, 0.45, cz, w, 0.9, d, 0xcbd5e1, 35);
  }

  buildSkyBridge(x1, z1, x2, z2, deckY, width = 3.6) {
    const floorMat = this.sharedMats.floor;
    const glassRailMat = this.sharedMats.glassRail;
    const cx = (x1 + x2) / 2;
    const cz = (z1 + z2) / 2;
    const dx = Math.abs(x2 - x1);
    const dz = Math.abs(z2 - z1);

    if (dx > dz) {
      this.addSolidBox(cx, deckY - 0.25, cz, dx, 0.5, width, floorMat, {}, false);
      this.addSolidBox(cx, deckY + 0.55, cz - width / 2 + 0.15, dx, 1.1, 0.25, glassRailMat, {}, false);
      this.addSolidBox(cx, deckY + 0.55, cz + width / 2 - 0.15, dx, 1.1, 0.25, glassRailMat, {}, false);
    } else {
      this.addSolidBox(cx, deckY - 0.25, cz, width, 0.5, dz, floorMat, {}, false);
      this.addSolidBox(cx - width / 2 + 0.15, deckY + 0.55, cz, 0.25, 1.1, dz, glassRailMat, {}, false);
      this.addSolidBox(cx + width / 2 - 0.15, deckY + 0.55, cz, 0.25, 1.1, dz, glassRailMat, {}, false);
    }
  }

  // ---- 市街地ランク戦フィールド（商業ビル街） ----
  // ---- 超広大・高密度：市街地ランク戦フィールド（商業ビル9棟） ----
  buildCityArena(floor) {
    this.portalLocked = true;
    const arenaHalf = 92; // 184m × 184m
    const wallH = 14;
    const wallMat = this.sharedMats.wall;

    // 外周バリア壁
    this.addSolidBox(0, wallH / 2, -arenaHalf, arenaHalf * 2, wallH, 1.5, wallMat);
    this.addSolidBox(0, wallH / 2, arenaHalf, arenaHalf * 2, wallH, 1.5, wallMat);
    this.addSolidBox(-arenaHalf, wallH / 2, 0, 1.5, wallH, arenaHalf * 2, wallMat);
    this.addSolidBox(arenaHalf, wallH / 2, 0, 1.5, wallH, arenaHalf * 2, wallMat);

    // 3×3 グリッド配置の進入可能ビル群（計9棟）
    // 中央：大型3階建て吹き抜けモール
    this.buildEnterableBuilding(0, 0, 3, 28, true);

    // 東西南北の幹線道路沿いビル（4棟）
    this.buildEnterableBuilding(0, -48, 3, 24, false);
    this.buildEnterableBuilding(0, 48, 2, 24, false);
    this.buildEnterableBuilding(-48, 0, 3, 24, false);
    this.buildEnterableBuilding(48, 0, 2, 24, false);

    // 四隅の高層・中層オフィスビル（4棟）
    this.buildEnterableBuilding(-48, -48, 3, 24, false);
    this.buildEnterableBuilding(48, -48, 3, 24, false);
    this.buildEnterableBuilding(-48, 48, 2, 24, false);
    this.buildEnterableBuilding(48, 48, 3, 24, false);

    // ビル同士をつなぐ8本のスカイブリッジ（地上13m・3階高さ）
    this.buildSkyBridge(-36, -48, -12, -48, 13.0, 3.8);
    this.buildSkyBridge(12, -48, 36, -48, 13.0, 3.8);
    this.buildSkyBridge(-36, 48, -12, 48, 13.0, 3.8);
    this.buildSkyBridge(12, 48, 36, 48, 13.0, 3.8);

    this.buildSkyBridge(-48, -36, -48, -12, 13.0, 3.8);
    this.buildSkyBridge(-48, 12, -48, 36, 13.0, 3.8);
    this.buildSkyBridge(48, -36, 48, -12, 13.0, 3.8);
    this.buildSkyBridge(48, 12, 48, 36, 13.0, 3.8);

    // 大通り＆交差点の車両・自販機・ガードレール遮蔽物
    const carSpots = [
      { x: -24, z: -24, rot: true, col: 0x334155 },
      { x: 24, z: 24, rot: true, col: 0x1e3a8a },
      { x: -24, z: 24, rot: false, col: 0x475569 },
      { x: 24, z: -24, rot: false, col: 0x0f172a },
      { x: -20, z: -66, rot: true, col: 0x334155 },
      { x: 20, z: -66, rot: true, col: 0x1e293b },
      { x: -20, z: 66, rot: true, col: 0x475569 },
      { x: 20, z: 66, rot: true, col: 0x1e3a8a },
      { x: -68, z: -22, rot: false, col: 0x334155 },
      { x: 68, z: 22, rot: false, col: 0x0f172a }
    ];
    carSpots.forEach((c) => this.addDestructibleCar(c.x, c.z, c.rot, c.col));

    // 角地の自動販売機
    [
      [-16, -16, 0x0ea5e9], [16, -16, 0xef4444],
      [-16, 16, 0x38bdf8], [16, 16, 0x0ea5e9],
      [-34, -34, 0xef4444], [34, 34, 0x38bdf8]
    ].forEach(([vx, vz, vc]) => this.addVendingMachine(vx, vz, vc));

    // 道路沿いガードレール
    [-26, 26].forEach((gx) => {
      this.addGuardRail(gx, -48, false);
      this.addGuardRail(gx, 48, false);
    });

    this.createPortal(0, 1.8, -80, true);

    const playerStart = new THREE.Vector3(0, 0, 78);
    const candidateSpawns = [
      new THREE.Vector3(0, 0, -72),
      new THREE.Vector3(-72, 0, -72),
      new THREE.Vector3(72, 0, -72),
      new THREE.Vector3(-72, 0, 0),
      new THREE.Vector3(72, 0, 0),
      new THREE.Vector3(-48, 19.5, -48), // 北西ビル屋上
      new THREE.Vector3(48, 19.5, 48),   // 南東ビル屋上
      new THREE.Vector3(0, 19.5, -48)    // 北中央ビル屋上
    ];
    const rivalStart = candidateSpawns[(floor - 1) % candidateSpawns.length].clone();

    return {
      playerStart,
      rivalStart,
      spawnPos: playerStart,
      enemySpawns: candidateSpawns
    };
  }

  // ---- 進入不可の戸建て住宅（屋根の上にグラスホッパーで登れる） ----
  buildClosedHouse(cx, cz, w = 8.5, d = 7.5, stories = 2, wallColor = 0xe2e8f0, roofColor = 0x334155) {
    const wallH = stories === 2 ? 9.2 : 4.6;
    const houseWallMat = new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.65 });
    const roofMat = new THREE.MeshStandardMaterial({ color: roofColor, roughness: 0.5 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.5 });

    this.addSolidBox(cx, wallH / 2, cz, w, wallH, d, houseWallMat);
    this.addSolidBox(cx, wallH + 0.18, cz, w + 0.6, 0.36, d + 0.6, roofMat);

    if (stories === 2) {
      const pY = wallH + 0.55;
      this.addSolidBox(cx, pY, cz - d / 2 - 0.15, w + 0.6, 0.4, 0.25, trimMat, {}, false);
      this.addSolidBox(cx, pY, cz + d / 2 + 0.15, w + 0.6, 0.4, 0.25, trimMat, {}, false);
      this.addSolidBox(cx - w * 0.25, wallH + 0.8, cz, 1.4, 0.9, 1.0, trimMat, {}, false);
    }

    const fenceOffsetZ = d / 2 + 1.1;
    this.addDestructibleProp(cx - w * 0.28, 0.65, cz + fenceOffsetZ, w * 0.42, 1.3, 0.3, 0x94a3b8, 45);
    this.addDestructibleProp(cx + w * 0.28, 0.65, cz + fenceOffsetZ, w * 0.42, 1.3, 0.3, 0x94a3b8, 45);
  }

  // ---- 超広大・高密度：B級ランク戦最終マッチ風「夕暮れの住宅街＆河川敷（52棟）」 ----
  buildResidentialArena(floor) {
    this.portalLocked = true;

    const duskColor = 0x2b1d38;
    this.scene.background = new THREE.Color(duskColor);
    if (this.scene.fog) {
      this.scene.fog.color.setHex(duskColor);
    }

    const arenaHalf = 92; // 184m × 184m
    const wallH = 12;
    const wallMat = this.sharedMats.wall;

    // 外周バリア壁
    this.addSolidBox(0, wallH / 2, -arenaHalf, arenaHalf * 2, wallH, 1.5, wallMat);
    this.addSolidBox(0, wallH / 2, arenaHalf, arenaHalf * 2, wallH, 1.5, wallMat);
    this.addSolidBox(-arenaHalf, wallH / 2, 0, 1.5, wallH, arenaHalf * 2, wallMat);
    this.addSolidBox(arenaHalf, wallH / 2, 0, 1.5, wallH, arenaHalf * 2, wallMat);

    // 1. 南側エリア（z = +44 ~ +84）：広大な河川敷＆水路・4本の橋
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x0f2942,
      emissive: 0x0284c7,
      emissiveIntensity: 0.18,
      roughness: 0.2
    });
    const grassMat = new THREE.MeshStandardMaterial({ color: 0x263829, roughness: 0.85 });
    const bridgeMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.55 });

    const riverMesh = new THREE.Mesh(new THREE.PlaneGeometry(182, 14), waterMat);
    riverMesh.rotation.x = -Math.PI / 2;
    riverMesh.position.set(0, 0.04, 58);
    this.scene.add(riverMesh);
    this.dungeonMeshes.push(riverMesh);

    const bankNorth = new THREE.Mesh(new THREE.PlaneGeometry(182, 12), grassMat);
    bankNorth.rotation.x = -Math.PI / 2;
    bankNorth.position.set(0, 0.03, 45);
    this.scene.add(bankNorth);
    this.dungeonMeshes.push(bankNorth);

    const bankSouth = new THREE.Mesh(new THREE.PlaneGeometry(182, 24), grassMat);
    bankSouth.rotation.x = -Math.PI / 2;
    bankSouth.position.set(0, 0.03, 77);
    this.scene.add(bankSouth);
    this.dungeonMeshes.push(bankSouth);

    // 河川に架かる4本のコンクリート橋
    [-58, -20, 20, 58].forEach((bx) => {
      this.addSolidBox(bx, 0.35, 58, 6.5, 0.7, 17.0, bridgeMat, {}, false);
      this.addGuardRail(bx - 3.0, 54.0, false);
      this.addGuardRail(bx - 3.0, 62.0, false);
      this.addGuardRail(bx + 3.0, 54.0, false);
      this.addGuardRail(bx + 3.0, 62.0, false);
    });

    // 2. 北〜中央エリア（z = -82 ~ +34）：52棟の密集戸建て住宅街区画
    const housePalette = [0xe2e8f0, 0xcbd5e1, 0xd6d3d1, 0x94a3b8];
    const roofPalette = [0x1e293b, 0x334155, 0x3f2e3e, 0x1e3a5f];

    // 6ブロック × 各8〜9棟 ＝ 計52棟の住宅を自動レイアウト配置
    const blockOrigins = [
      { bx: -76, bz: -74 }, // 北西ブロック
      { bx: 14,  bz: -74 }, // 北東ブロック
      { bx: -76, bz: -34 }, // 中央北西ブロック
      { bx: 14,  bz: -34 }, // 中央北東ブロック
      { bx: -76, bz: 6 },   // 南西ブロック（河川敷手前）
      { bx: 14,  bz: 6 }    // 南東ブロック（河川敷手前）
    ];

    let houseIdx = 0;
    blockOrigins.forEach((blk, bIdx) => {
      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 4; col++) {
          const hx = blk.bx + col * 16.5;
          const hz = blk.bz + row * 15.5;
          // 所々に2階建て高台拠点と平屋を織り交ぜる
          const stories = (row + col + bIdx) % 2 === 0 ? 2 : 1;
          const w = stories === 2 ? 9.2 : 8.4;
          const d = stories === 2 ? 8.2 : 7.5;
          const wc = housePalette[houseIdx % housePalette.length];
          const rc = roofPalette[(houseIdx + bIdx) % roofPalette.length];
          this.buildClosedHouse(hx, hz, w, d, stories, wc, rc);
          houseIdx++;
        }
      }
    });

    // 中央大通り（x = 0）＆ 東西幹線道路沿いの4棟のランドマーク2階建て住宅
    this.buildClosedHouse(-34, -32, 9.8, 8.8, 2, 0xe2e8f0, 0x1e3a5f);
    this.buildClosedHouse(34, -32, 9.8, 8.8, 2, 0xe2e8f0, 0x1e3a5f);
    this.buildClosedHouse(-18, 24, 9.2, 8.2, 2, 0xcbd5e1, 0x334155);
    this.buildClosedHouse(18, 24, 9.2, 8.2, 2, 0xcbd5e1, 0x334155);

    // 3. 幹線道路の路上駐車車両・自販機・ガードレール遮蔽物
    const resCars = [
      { x: -6.5, z: -64, rot: true, col: 0x334155 },
      { x: 6.5, z: -46, rot: true, col: 0x1e3a8a },
      { x: -6.5, z: -22, rot: true, col: 0x475569 },
      { x: 6.5, z: 2, rot: true, col: 0x0f172a },
      { x: -6.5, z: 26, rot: true, col: 0x334155 },
      { x: -45, z: -48, rot: false, col: 0x1e293b },
      { x: 45, z: -48, rot: false, col: 0x334155 },
      { x: -45, z: -8, rot: false, col: 0x475569 },
      { x: 45, z: -8, rot: false, col: 0x1e3a8a }
    ];
    resCars.forEach((c) => this.addDestructibleCar(c.x, c.z, c.rot, c.col));

    // 角地の自動販売機
    [
      [-11, -50, 0x0ea5e9], [11, -50, 0xef4444],
      [-11, -10, 0x38bdf8], [11, -10, 0x0ea5e9],
      [-11, 30, 0xef4444], [11, 30, 0x38bdf8]
    ].forEach(([vx, vz, vc]) => this.addVendingMachine(vx, vz, vc));

    // 河川敷沿いのガードレール
    [-72, -40, -10, 10, 40, 72].forEach((gx) => {
      this.addGuardRail(gx, 38.5, true);
    });

    this.createPortal(0, 1.8, -82, true);

    const playerStart = new THREE.Vector3(0, 0, 78);
    const candidateSpawns = [
      new THREE.Vector3(0, 0, -72),
      new THREE.Vector3(-68, 0, -48),
      new THREE.Vector3(68, 0, -48),
      new THREE.Vector3(-68, 0, -8),
      new THREE.Vector3(68, 0, -8),
      new THREE.Vector3(-34, 6.0, -32), // 北西高台2階屋根上
      new THREE.Vector3(34, 6.0, -32),  // 北東高台2階屋根上
      new THREE.Vector3(18, 6.0, 24)    // 南東高台2階屋根上
    ];
    const rivalStart = candidateSpawns[(floor - 1) % candidateSpawns.length].clone();

    return {
      playerStart,
      rivalStart,
      spawnPos: playerStart,
      enemySpawns: candidateSpawns
    };
  }

  buildSwitchbackStaircase(cx, cz, baseY, floorH, stairMat, railMat) {
    const totalW = 6.4;
    const flightW = 3.0;
    const totalLen = 10.0;
    const landingD = 2.8;
    const runLen = totalLen - landingD;
    const midY = baseY + floorH * 0.5;

    const landingZ = cz - totalLen / 2 + landingD / 2;
    this.addSolidBox(cx, midY - 0.25, landingZ, totalW, 0.5, landingD, stairMat, {}, false);

    const leftX = cx - totalW / 2 + flightW / 2;
    const steps1 = 12;
    const stepH1 = (floorH * 0.5) / steps1;
    const stepD1 = runLen / steps1;
    const startZ1 = cz + totalLen / 2;

    for (let i = 0; i < steps1; i++) {
      const topY = baseY + stepH1 * (i + 1);
      const sz = startZ1 - stepD1 * (i + 0.5);
      this.addSolidBox(leftX, topY - 0.25, sz, flightW, 0.5, stepD1 + 0.16, stairMat, {}, false);
    }

    const rightX = cx + totalW / 2 - flightW / 2;
    const steps2 = 12;
    const stepH2 = (floorH * 0.5) / steps2;
    const stepD2 = runLen / steps2;
    const startZ2 = cz - totalLen / 2 + landingD;

    for (let i = 0; i < steps2; i++) {
      const topY = midY + stepH2 * (i + 1);
      const sz = startZ2 + stepD2 * (i + 0.5);
      this.addSolidBox(rightX, topY - 0.25, sz, flightW, 0.5, stepD2 + 0.16, stairMat, {}, false);
    }

    this.addSolidBox(cx, midY + 0.35, cz + 1.0, 0.25, 0.75, runLen - 1.2, railMat, {}, false);
  }

  buildMallEscalator(cx, cz, baseY, floorH, atriumHalf, stairMat, glassRailMat) {
    const width = 3.6;
    const length = atriumHalf * 2;
    const steps = 18;
    const stepH = floorH / steps;
    const stepD = length / steps;

    for (let i = 0; i < steps; i++) {
      const topY = baseY + stepH * (i + 1);
      const offsetZ = (length / 2) - stepD * (i + 0.5);
      const blockH = Math.min(1.8, topY - baseY);
      this.addSolidBox(cx, topY - blockH / 2, cz + offsetZ, width, blockH, stepD + 0.16, stairMat, {}, false);
    }

    [-1, 1].forEach((side) => {
      const rx = cx + side * (width / 2 + 0.16);
      for (let i = 0; i < 4; i++) {
        const segY = baseY + floorH * ((i + 0.5) / 4) + 0.55;
        const segZ = cz + (length / 2) - (length * (i + 0.5)) / 4;
        this.addSolidBox(rx, segY, segZ, 0.22, 1.0, length / 4, glassRailMat, {}, false);
      }
    });
  }

  buildEnterableBuilding(cx, cz, floors = 2, size = 24, isCentralMall = false) {
    const wallMat = this.sharedMats.wall;
    const floorMat = this.sharedMats.floor;
    const stairMat = this.sharedMats.stair;
    const railMat = this.sharedMats.rail;
    const glassRailMat = this.sharedMats.glassRail;

    const floorH = 6.5;
    const slabThick = 0.5;
    const wallThick = 0.75;
    const halfS = size / 2;
    const doorW = 5.6;

    const stairWellW = 7.2;
    const stairCenterX = cx + halfS - wallThick - stairWellW / 2;
    const stairTotalLen = 10.0;
    const rimW = 7.5;
    const atriumHalf = halfS - rimW;

    for (let f = 0; f < floors; f++) {
      const baseY = f * floorH;
      const wallCenterY = baseY + floorH / 2;
      const wallH = floorH - slabThick;

      if (f > 0) {
        if (isCentralMall) {
          this.addSolidBox(cx, baseY - slabThick / 2, cz - halfS + rimW / 2, size, slabThick, rimW, floorMat);
          this.addSolidBox(cx, baseY - slabThick / 2, cz + halfS - rimW / 2, size, slabThick, rimW, floorMat);
          this.addSolidBox(cx - halfS + rimW / 2, baseY - slabThick / 2, cz, rimW, slabThick, size - rimW * 2, floorMat);
          this.addSolidBox(cx + halfS - rimW / 2, baseY - slabThick / 2, cz, rimW, slabThick, size - rimW * 2, floorMat);

          const gateHalfW = 2.2;
          const railSideW = atriumHalf - gateHalfW;
          const railCenterOffset = gateHalfW + railSideW / 2;
          this.addSolidBox(cx - railCenterOffset, baseY + 0.55, cz - atriumHalf, railSideW, 1.1, 0.25, glassRailMat, {}, false);
          this.addSolidBox(cx + railCenterOffset, baseY + 0.55, cz - atriumHalf, railSideW, 1.1, 0.25, glassRailMat, {}, false);
          this.addSolidBox(cx - railCenterOffset, baseY + 0.55, cz + atriumHalf, railSideW, 1.1, 0.25, glassRailMat, {}, false);
          this.addSolidBox(cx + railCenterOffset, baseY + 0.55, cz + atriumHalf, railSideW, 1.1, 0.25, glassRailMat, {}, false);
          this.addSolidBox(cx - atriumHalf, baseY + 0.55, cz, 0.25, 1.1, atriumHalf * 2, glassRailMat, {}, false);
          this.addSolidBox(cx + atriumHalf, baseY + 0.55, cz, 0.25, 1.1, atriumHalf * 2, glassRailMat, {}, false);
        } else {
          const mainSlabW = size - stairWellW - wallThick;
          const mainCenterX = cx - halfS + mainSlabW / 2;
          this.addSolidBox(mainCenterX, baseY - slabThick / 2, cz, mainSlabW, slabThick, size, floorMat);

          const endSlabD = (size - stairTotalLen) / 2;
          this.addSolidBox(stairCenterX, baseY - slabThick / 2, cz - halfS + endSlabD / 2, stairWellW, slabThick, endSlabD, floorMat);
          this.addSolidBox(stairCenterX, baseY - slabThick / 2, cz + halfS - endSlabD / 2, stairWellW, slabThick, endSlabD, floorMat);

          this.addSolidBox(stairCenterX - stairWellW / 2, baseY + 0.55, cz, 0.25, 1.1, stairTotalLen, glassRailMat, {}, false);
        }
      }

      const sideSeg = (size - doorW) / 2;
      [-1, 1].forEach((zSign) => {
        const wz = cz + zSign * (halfS - wallThick / 2);
        this.addSolidBox(cx - halfS + sideSeg / 2, wallCenterY, wz, sideSeg, wallH, wallThick, wallMat);
        this.addSolidBox(cx + halfS - sideSeg / 2, wallCenterY, wz, sideSeg, wallH, wallThick, wallMat);
        this.addSolidBox(cx, baseY + wallH - 0.75, wz, doorW, 1.5, wallThick, wallMat);

        if (f > 0) {
          this.addSolidBox(cx, baseY + 0.55, wz, doorW, 1.1, wallThick * 0.8, glassRailMat, {}, false);
        }
      });

      [-1, 1].forEach((xSign) => {
        const wx = cx + xSign * (halfS - wallThick / 2);
        if (f === 0) {
          this.addSolidBox(wx, wallCenterY, cz - halfS + sideSeg / 2, wallThick, wallH, sideSeg, wallMat);
          this.addSolidBox(wx, wallCenterY, cz + halfS - sideSeg / 2, wallThick, wallH, sideSeg, wallMat);
          this.addSolidBox(wx, baseY + wallH - 0.75, cz, wallThick, 1.5, doorW, wallMat);
        } else {
          this.addSolidBox(wx, wallCenterY, cz - halfS + sideSeg / 2, wallThick, wallH, sideSeg, wallMat);
          this.addSolidBox(wx, wallCenterY, cz + halfS - sideSeg / 2, wallThick, wallH, sideSeg, wallMat);
          this.addDestructibleBlock(wx, baseY + 1.2, cz - 1.2, 0x38bdf8, 45);
          this.addDestructibleBlock(wx, baseY + 1.2, cz + 1.2, 0x38bdf8, 45);
        }
      });

      const colOff = isCentralMall ? 9.5 : 4.8;
      this.addSolidBox(cx - colOff, wallCenterY, cz - colOff, 1.1, wallH, 1.1, wallMat);
      this.addSolidBox(cx - colOff, wallCenterY, cz + colOff, 1.1, wallH, 1.1, wallMat);
      if (isCentralMall) {
        this.addSolidBox(cx + colOff, wallCenterY, cz - colOff, 1.1, wallH, 1.1, wallMat);
        this.addSolidBox(cx + colOff, wallCenterY, cz + colOff, 1.1, wallH, 1.1, wallMat);
      }

      if (isCentralMall) {
        if (f < floors - 1) {
          this.buildMallEscalator(cx, cz, baseY, floorH, atriumHalf, stairMat, glassRailMat);
        }
      } else {
        this.buildSwitchbackStaircase(stairCenterX, cz, baseY, floorH, stairMat, railMat);
      }
    }

    const roofY = floors * floorH;
    if (isCentralMall) {
      this.addSolidBox(cx, roofY - slabThick / 2, cz - halfS + rimW / 2, size, slabThick, rimW, floorMat);
      this.addSolidBox(cx, roofY - slabThick / 2, cz + halfS - rimW / 2, size, slabThick, rimW, floorMat);
      this.addSolidBox(cx - halfS + rimW / 2, roofY - slabThick / 2, cz, rimW, slabThick, size - rimW * 2, floorMat);
      this.addSolidBox(cx + halfS - rimW / 2, roofY - slabThick / 2, cz, rimW, slabThick, size - rimW * 2, floorMat);

      const gateHalfW = 2.2;
      const railSideW = atriumHalf - gateHalfW;
      const railCenterOffset = gateHalfW + railSideW / 2;
      this.addSolidBox(cx - railCenterOffset, roofY + 0.55, cz - atriumHalf, railSideW, 1.1, 0.25, glassRailMat, {}, false);
      this.addSolidBox(cx + railCenterOffset, roofY + 0.55, cz - atriumHalf, railSideW, 1.1, 0.25, glassRailMat, {}, false);
      this.addSolidBox(cx - railCenterOffset, roofY + 0.55, cz + atriumHalf, railSideW, 1.1, 0.25, glassRailMat, {}, false);
      this.addSolidBox(cx + railCenterOffset, roofY + 0.55, cz + atriumHalf, railSideW, 1.1, 0.25, glassRailMat, {}, false);
      this.addSolidBox(cx - atriumHalf, roofY + 0.55, cz, 0.25, 1.1, atriumHalf * 2, glassRailMat, {}, false);
      this.addSolidBox(cx + atriumHalf, roofY + 0.55, cz, 0.25, 1.1, atriumHalf * 2, glassRailMat, {}, false);
    } else {
      const mainSlabW = size - stairWellW - wallThick;
      const mainCenterX = cx - halfS + mainSlabW / 2;
      this.addSolidBox(mainCenterX, roofY - slabThick / 2, cz, mainSlabW, slabThick, size, floorMat);

      const endSlabD = (size - stairTotalLen) / 2;
      this.addSolidBox(stairCenterX, roofY - slabThick / 2, cz - halfS + endSlabD / 2, stairWellW, slabThick, endSlabD, floorMat);
      this.addSolidBox(stairCenterX, roofY - slabThick / 2, cz + halfS - endSlabD / 2, stairWellW, slabThick, endSlabD, floorMat);

      this.addSolidBox(stairCenterX - stairWellW / 2, roofY + 0.55, cz, 0.25, 1.1, stairTotalLen, glassRailMat, {}, false);
    }

    const paraH = 1.15;
    this.addSolidBox(cx, roofY + paraH / 2, cz - halfS + 0.35, size, paraH, 0.7, wallMat);
    this.addSolidBox(cx, roofY + paraH / 2, cz + halfS - 0.35, size, paraH, 0.7, wallMat);
    this.addSolidBox(cx - halfS + 0.35, roofY + paraH / 2, cz, 0.7, paraH, size - 1.4, wallMat);
    this.addSolidBox(cx + halfS - 0.35, roofY + paraH / 2, cz, 0.7, paraH, size - 1.4, wallMat);

    this.addSolidBox(cx - halfS + 3.5, roofY + 1.1, cz - halfS + 3.5, 2.8, 2.2, 2.2, railMat);
    this.addDestructibleBlock(cx - halfS + 3.5, roofY + HALF, cz + halfS - 3.5, 0x38bdf8, 55);
  }

  getNearbyInteractable(playerPos) {
    if (!playerPos) return null;
    for (const item of this.interactables) {
      if (playerPos.distanceTo(item.pos) <= item.radius) {
        return item;
      }
    }
    return null;
  }

  triggerInteractable(item, player, maxTrionVal) {
    if (!item) return;
    if (item.type === 'trigger_terminal') {
      window.dispatchEvent(new CustomEvent('open-town-tab', { detail: 'trigger' }));
    } else if (item.type === 'supply_terminal') {
      if (player) player.trion = maxTrionVal;
      this.onToast('⚡ トリオン体を100%まで急速充填しました！');
    }
  }

  createPortal(x, y, z, locked = false) {
    this.portalPos.set(x, y, z);
    this.portalLocked = locked;

    const coreColor = locked ? 0xef4444 : 0x38bdf8;
    const coreGeo = new THREE.OctahedronGeometry(0.95, 1);
    const coreMat = new THREE.MeshStandardMaterial({
      color: coreColor,
      emissive: coreColor,
      emissiveIntensity: 0.9
    });
    this.portalMesh = new THREE.Mesh(coreGeo, coreMat);
    this.portalMesh.position.copy(this.portalPos);
    this.scene.add(this.portalMesh);

    const ringGeo = new THREE.TorusGeometry(1.65, 0.1, 10, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: coreColor });
    this.portalRing = new THREE.Mesh(ringGeo, ringMat);
    this.portalRing.position.copy(this.portalPos);
    this.scene.add(this.portalRing);
  }

  unlockPortal() {
    if (!this.portalLocked) return;
    this.portalLocked = false;
    if (this.portalMesh) {
      this.portalMesh.material.color.setHex(0x38bdf8);
      this.portalMesh.material.emissive.setHex(0x38bdf8);
    }
    if (this.portalRing) {
      this.portalRing.material.color.setHex(0x38bdf8);
    }
    this.onToast('全敵部隊ベイルアウト！北側転送ゲートが起動しました');
  }

  unlockExitPortal() {
    this.unlockPortal();
  }

  // ---- 破壊可能パーツのダメージ・破壊処理（InstancedMesh＆空間グリッド即座更新） ----
  damageBlock(wallObj, dmg, hitPoint) {
    if (!wallObj || !wallObj.userData || !wallObj.userData.destructible) return;
    wallObj.userData.hp -= dmg;
    this.spawnHitSpark(hitPoint || wallObj.position, 0x38bdf8);

    if (wallObj.userData.hp <= 0) {
      this.spawnHitSpark(wallObj.position, 0x7dd3fc, 14);
      if (wallObj.userData.isInstancedProxy) {
        this.hideInstance(wallObj.userData.batchKey, wallObj.userData.instanceIndex);
      } else {
        this.scene.remove(wallObj);
      }
      this.unregisterWallFromGrid(wallObj);
      this.walls = this.walls.filter((w) => w !== wallObj);
      this.destructibles = this.destructibles.filter((w) => w !== wallObj);
      this.dungeonMeshes = this.dungeonMeshes.filter((w) => w !== wallObj);
    }
  }

  damageWall(wallObj, dmg, hitPoint) {
    this.damageBlock(wallObj, dmg, hitPoint);
  }

  spawnHitSpark(pos, colorHex = 0x38bdf8, count = 7) {
    for (let i = 0; i < count; i++) {
      const p = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.16, 0.16),
        new THREE.MeshBasicMaterial({ color: colorHex })
      );
      p.position.copy(pos);
      this.scene.add(p);
      this.sparks.push({
        mesh: p,
        vel: new THREE.Vector3(
          (Math.random() - 0.5) * 8,
          Math.random() * 6 + 2,
          (Math.random() - 0.5) * 8
        ),
        life: 0.45
      });
    }
  }

  spawnWallSparks(pos, colorHex = 0x38bdf8, count = 7) {
    this.spawnHitSpark(pos, colorHex, count);
  }

  update(dt, player) {
    if (this.portalMesh) {
      this.portalMesh.rotation.y += dt * 1.8;
      this.portalMesh.rotation.x += dt * 0.9;
    }
    if (this.portalRing) {
      this.portalRing.rotation.z -= dt * 1.4;
    }

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.vel.y -= 18 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.life -= dt;
      if (s.life <= 0) {
        this.scene.remove(s.mesh);
        s.mesh.geometry.dispose();
        s.mesh.material.dispose();
        this.sparks.splice(i, 1);
      }
    }

    const playerPos = player && player.root ? player.root.position : player;
    const nearInteractable = this.getNearbyInteractable(playerPos);

    let enteredPortal = false;
    if (this.portalMesh && !this.portalLocked && playerPos) {
      const dx = playerPos.x - this.portalPos.x;
      const dz = playerPos.z - this.portalPos.z;
      const dy = Math.abs(playerPos.y - (this.portalPos.y - 1.5));
      if (Math.hypot(dx, dz) < 2.2 && dy < 2.5) {
        enteredPortal = true;
      }
    }

    return { nearInteractable, enteredPortal };
  }

  // ---- 高速視線判定（通過グリッドセルのみチェック） ----
  hasLineOfSight(posA, posB) {
    const start = posA.clone().add(new THREE.Vector3(0, 1.3, 0));
    const end = posB.clone().add(new THREE.Vector3(0, 1.3, 0));
    const diff = end.clone().sub(start);
    const dist = diff.length();
    if (dist < 0.5) return true;

    const steps = Math.ceil(dist / 1.4);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const pt = start.clone().addScaledVector(diff, t);
      const nearby = this.queryNearbyWalls(pt.x, pt.z, 1.5);
      for (let j = 0; j < nearby.length; j++) {
        const wall = nearby[j];
        if (wall.material?.transparent) continue;
        const hx = wall.userData.halfX || HALF;
        const hy = wall.userData.halfY || HALF;
        const hz = wall.userData.halfZ || HALF;
        if (
          Math.abs(pt.x - wall.position.x) < hx &&
          Math.abs(pt.y - wall.position.y) < hy &&
          Math.abs(pt.z - wall.position.z) < hz
        ) {
          return false;
        }
      }
    }
    return true;
  }

  // ---- 高速衝突判定（周辺グリッドセルのみチェック） ----
  isBlockedForEntity(x, z, radius = 0.5, entityY = 0) {
    const stepUpAllowance = 0.72;
    const feet = entityY + stepUpAllowance;
    const head = entityY + 2.0;
    const nearby = this.queryNearbyWalls(x, z, radius + 2.0);
    for (let i = 0; i < nearby.length; i++) {
      const wall = nearby[i];
      const hx = wall.userData.halfX || HALF;
      const hy = wall.userData.halfY || HALF;
      const hz = wall.userData.halfZ || HALF;
      if (
        x > wall.position.x - hx - radius &&
        x < wall.position.x + hx + radius &&
        z > wall.position.z - hz - radius &&
        z < wall.position.z + hz + radius
      ) {
        if (feet < wall.position.y + hy && head > wall.position.y - hy) {
          return true;
        }
      }
    }
    return false;
  }

  getGroundHeightAt(x, z, currentY = 0) {
    let groundY = 0;
    const nearby = this.queryNearbyWalls(x, z, 2.0);
    for (let i = 0; i < nearby.length; i++) {
      const wall = nearby[i];
      const hx = wall.userData.halfX || HALF;
      const hy = wall.userData.halfY || HALF;
      const hz = wall.userData.halfZ || HALF;
      if (
        x > wall.position.x - hx - 0.45 &&
        x < wall.position.x + hx + 0.45 &&
        z > wall.position.z - hz - 0.45 &&
        z < wall.position.z + hz + 0.45
      ) {
        const top = wall.position.y + hy;
        if (currentY >= top - 0.75) {
          groundY = Math.max(groundY, top);
        }
      }
    }
    return groundY;
  }
}
