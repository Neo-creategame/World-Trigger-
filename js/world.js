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

    // ワールドトリガーの市街地・ボーダー訓練場風のクリーンな白・グレー・シアンテクスチャ
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
      })
    };
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

    // 建築パネル目地
    ctx.strokeStyle = line;
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, 124, 124);
    ctx.beginPath();
    ctx.moveTo(0, 64);
    ctx.lineTo(128, 64);
    ctx.stroke();

    // シアン（トリオン発光ライン）
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
      new THREE.PlaneGeometry(300, 300),
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

  // addSolidBox に castShadow オプションを追加（デフォルトは大きな構造物のみ影を落とす）
  addSolidBox(cx, cy, cz, w, h, d, mat, extraData = {}, castShadow = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(cx, cy, cz);
    mesh.castShadow = castShadow;
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

  // ---- 折り返し階段（ソリッド段差・踊り場付き・絶対に詰まらない構造） ----
  // ---- 折り返し階段（ソリッド段差・踊り場付き・絶対に詰まらない構造） ----
  buildSwitchbackStaircase(cx, cz, baseY, floorH, stairMat, railMat) {
    const totalW = 6.6;
    const flightW = 3.1;
    const totalLen = 12.0;
    const landingD = 3.4;
    const runLen = totalLen - landingD;
    const midY = baseY + floorH * 0.5;

    // 1. 中2階踊り場（北側奥）
    const landingZ = cz - totalLen / 2 + landingD / 2;
    this.addSolidBox(cx, midY - 0.3, landingZ, totalW, 0.6, landingD, stairMat, {}, false);
    this.addSolidBox(cx, midY + 0.65, cz - totalLen / 2 - 0.15, totalW, 1.4, 0.3, railMat, {}, false);

    // 2. 前半階段（左側レーン：南側から北側の踊り場へ登る）
    const leftX = cx - totalW / 2 + flightW / 2;
    const steps1 = 12;
    const stepH1 = (floorH * 0.5) / steps1;
    const stepD1 = runLen / steps1;
    const startZ1 = cz + totalLen / 2;

    for (let i = 0; i < steps1; i++) {
      const topY = baseY + stepH1 * (i + 1);
      const sz = startZ1 - stepD1 * (i + 0.5);
      const blockH = topY - baseY;
      this.addSolidBox(leftX, baseY + blockH / 2, sz, flightW, blockH, stepD1 + 0.12, stairMat, {}, false);
    }

    // 3. 後半階段（右側レーン：踊り場から南側の上階フロア出口へ登る）
    const rightX = cx + totalW / 2 - flightW / 2;
    const steps2 = 12;
    const stepH2 = (floorH * 0.5) / steps2;
    const stepD2 = runLen / steps2;
    const startZ2 = cz - totalLen / 2 + landingD;

    for (let i = 0; i < steps2; i++) {
      const topY = midY + stepH2 * (i + 1);
      const sz = startZ2 + stepD2 * (i + 0.5);
      const blockH = topY - baseY;
      this.addSolidBox(rightX, baseY + blockH / 2, sz, flightW, blockH, stepD2 + 0.12, stairMat, {}, false);
    }

    // 4. 中央仕切り壁
    this.addSolidBox(cx, baseY + floorH * 0.5, cz + 1.2, 0.36, floorH * 0.85, runLen - 0.6, railMat, {}, false);
  }

  // ---- 中央吹き抜けの商業モール風エスカレーター ----
  buildMallEscalator(cx, cz, baseY, floorH, stairMat, glassRailMat) {
    const width = 3.4;
    const length = 11.0;
    const steps = 16;
    const stepH = floorH / steps;
    const stepD = length / steps;

    for (let i = 0; i < steps; i++) {
      const topY = baseY + stepH * (i + 1);
      const offsetZ = (length / 2) - stepD * (i + 0.5);
      const blockH = Math.min(1.6, topY - baseY);
      this.addSolidBox(cx, topY - blockH / 2, cz + offsetZ, width, blockH, stepD + 0.14, stairMat, {}, false);
    }

    [-1, 1].forEach((side) => {
      const rx = cx + side * (width / 2 + 0.15);
      for (let i = 0; i < 4; i++) {
        const segY = baseY + floorH * ((i + 0.5) / 4) + 0.55;
        const segZ = cz + (length / 2) - (length * (i + 0.5)) / 4;
        this.addSolidBox(rx, segY, segZ, 0.22, 1.0, length / 4, glassRailMat, {}, false);
      }
    });
  }

  // ---- ワールドトリガー風 大型商業・オフィスビル ----
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

    const stairWellW = 7.4;
    const stairCenterX = cx + halfS - wallThick - stairWellW / 2;
    const stairTotalLen = 12.0;

    for (let f = 0; f < floors; f++) {
      const baseY = f * floorH;
      const wallCenterY = baseY + floorH / 2;
      const wallH = floorH - slabThick;

      if (f > 0) {
        if (isCentralMall) {
          const rimW = 7.5;
          this.addSolidBox(cx, baseY - slabThick / 2, cz - halfS + rimW / 2, size, slabThick, rimW, floorMat);
          this.addSolidBox(cx, baseY - slabThick / 2, cz + halfS - rimW / 2, size, slabThick, rimW, floorMat);
          this.addSolidBox(cx - halfS + rimW / 2, baseY - slabThick / 2, cz, rimW, slabThick, size - rimW * 2, floorMat);
          this.addSolidBox(cx + halfS - rimW / 2, baseY - slabThick / 2, cz, rimW, slabThick, size - rimW * 2, floorMat);

          const atriumHalf = halfS - rimW;
          this.addSolidBox(cx - 4.8, baseY + 0.55, cz - atriumHalf, 5.2, 1.1, 0.25, glassRailMat, {}, false);
          this.addSolidBox(cx + 4.8, baseY + 0.55, cz - atriumHalf, 5.2, 1.1, 0.25, glassRailMat, {}, false);
          this.addSolidBox(cx, baseY + 0.55, cz + atriumHalf, atriumHalf * 2, 1.1, 0.25, glassRailMat, {}, false);
          this.addSolidBox(cx - atriumHalf, baseY + 0.55, cz, 0.25, 1.1, atriumHalf * 2, glassRailMat, {}, false);
          this.addSolidBox(cx + atriumHalf, baseY + 0.55, cz, 0.25, 1.1, atriumHalf * 2, glassRailMat, {}, false);
        } else {
          const mainSlabW = size - stairWellW - wallThick;
          const mainCenterX = cx - halfS + mainSlabW / 2;
          this.addSolidBox(mainCenterX, baseY - slabThick / 2, cz, mainSlabW, slabThick, size, floorMat);

          const sideLandingD = (size - stairTotalLen) / 2;
          if (sideLandingD > 0.5) {
            this.addSolidBox(stairCenterX, baseY - slabThick / 2, cz - halfS + sideLandingD / 2, stairWellW, slabThick, sideLandingD, floorMat);
            this.addSolidBox(stairCenterX, baseY - slabThick / 2, cz + halfS - sideLandingD / 2, stairWellW, slabThick, sideLandingD, floorMat);
          }

          const railLen = stairTotalLen - 3.6;
          this.addSolidBox(stairCenterX - stairWellW / 2, baseY + 0.55, cz - 1.8, 0.25, 1.1, railLen, glassRailMat, {}, false);
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

      const colOff = isCentralMall ? 9.5 : 5.2;
      this.addSolidBox(cx - colOff, wallCenterY, cz - colOff, 1.2, wallH, 1.2, wallMat);
      this.addSolidBox(cx - colOff, wallCenterY, cz + colOff, 1.2, wallH, 1.2, wallMat);
      if (isCentralMall) {
        this.addSolidBox(cx + colOff, wallCenterY, cz - colOff, 1.2, wallH, 1.2, wallMat);
        this.addSolidBox(cx + colOff, wallCenterY, cz + colOff, 1.2, wallH, 1.2, wallMat);
      }

      if (isCentralMall) {
        this.buildMallEscalator(cx, cz - 1.5, baseY, floorH, stairMat, glassRailMat);
      } else {
        this.buildSwitchbackStaircase(stairCenterX, cz, baseY, floorH, stairMat, railMat);
      }
    }

    const roofY = floors * floorH;
    if (isCentralMall) {
      const rimW = 7.5;
      this.addSolidBox(cx, roofY - slabThick / 2, cz - halfS + rimW / 2, size, slabThick, rimW, floorMat);
      this.addSolidBox(cx, roofY - slabThick / 2, cz + halfS - rimW / 2, size, slabThick, rimW, floorMat);
      this.addSolidBox(cx - halfS + rimW / 2, roofY - slabThick / 2, cz, rimW, slabThick, size - rimW * 2, floorMat);
      this.addSolidBox(cx + halfS - rimW / 2, roofY - slabThick / 2, cz, rimW, slabThick, size - rimW * 2, floorMat);
    } else {
      const mainSlabW = size - stairWellW - wallThick;
      const mainCenterX = cx - halfS + mainSlabW / 2;
      this.addSolidBox(mainCenterX, roofY - slabThick / 2, cz, mainSlabW, slabThick, size, floorMat);

      const sideLandingD = (size - stairTotalLen) / 2;
      if (sideLandingD > 0.5) {
        this.addSolidBox(stairCenterX, roofY - slabThick / 2, cz - halfS + sideLandingD / 2, stairWellW, slabThick, sideLandingD, floorMat);
        this.addSolidBox(stairCenterX, roofY - slabThick / 2, cz + halfS - sideLandingD / 2, stairWellW, slabThick, sideLandingD, floorMat);
      }
    }

    const paraH = 1.15;
    this.addSolidBox(cx, roofY + paraH / 2, cz - halfS + 0.35, size, paraH, 0.7, wallMat);
    this.addSolidBox(cx, roofY + paraH / 2, cz + halfS - 0.35, size, paraH, 0.7, wallMat);
    this.addSolidBox(cx - halfS + 0.35, roofY + paraH / 2, cz, 0.7, paraH, size - 1.4, wallMat);
    this.addSolidBox(cx + halfS - 0.35, roofY + paraH / 2, cz, 0.7, paraH, size - 1.4, wallMat);

    this.addSolidBox(cx - halfS + 3.5, roofY + 1.1, cz - halfS + 3.5, 2.8, 2.2, 2.2, railMat);
    this.addDestructibleBlock(cx - halfS + 3.5, roofY + HALF, cz + halfS - 3.5, 0x38bdf8, 55);
  }
}
