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
  buildSwitchbackStaircase(cx, cz, baseY, floorH, stairMat, railMat) {
    const totalW = 6.6;      // 階段ユニット全幅（往路3.1 + 仕切り0.4 + 復路3.1）
    const flightW = 3.1;     // 階段1本あたりの幅（余裕を持って走れる広さ）
    const totalLen = 12.0;   // 階段ユニット全長
    const landingD = 3.4;    // 踊り場の奥行き
    const runLen = totalLen - landingD; // 傾斜部分の長さ (8.6m)
    const midY = baseY + floorH * 0.5;

    // 1. 中2階踊り場（北側奥）
    const landingZ = cz - totalLen / 2 + landingD / 2;
    this.addSolidBox(cx, midY - 0.3, landingZ, totalW, 0.6, landingD, stairMat, {}, false);
    // 踊り場奥の転落防止壁
    this.addSolidBox(cx, midY + 0.65, cz - totalLen / 2 - 0.15, totalW, 1.4, 0.3, railMat, {}, false);

    // 2. 前半階段（左側レーン：南側から北側の踊り場へ登る）
    // 12段構成（1段 0.27m）＋下まで詰まったソリッド段差にして透けを完全に防止
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

    // 4. 中央仕切り壁（往路と復路の間の壁）
    this.addSolidBox(cx, baseY + floorH * 0.5, cz + 1.2, 0.36, floorH * 0.85, runLen - 0.6, railMat, {}, false);
  }

  // ---- 中央吹き抜けの商業モール風エスカレーター（吹き抜け空間内に独立配置） ----
  buildMallEscalator(cx, cz, baseY, floorH, stairMat, glassRailMat) {
    const width = 3.4;
    const length = 11.0;
    const steps = 16;
    const stepH = floorH / steps;
    const stepD = length / steps;

    // 常に南（+Z）から北（-Z）へ向かって上階ブリッジへ接続する統一ルート
    for (let i = 0; i < steps; i++) {
      const topY = baseY + stepH * (i + 1);
      const offsetZ = (length / 2) - stepD * (i + 0.5);
      const blockH = Math.min(1.6, topY - baseY);
      this.addSolidBox(cx, topY - blockH / 2, cz + offsetZ, width, blockH, stepD + 0.14, stairMat, {}, false);
    }

    // 左右のガラス手すり
    [-1, 1].forEach((side) => {
      const rx = cx + side * (width / 2 + 0.15);
      for (let i = 0; i < 4; i++) {
        const segY = baseY + floorH * ((i + 0.5) / 4) + 0.55;
        const segZ = cz + (length / 2) - (length * (i + 0.5)) / 4;
        this.addSolidBox(rx, segY, segZ, 0.22, 1.0, length / 4, glassRailMat, {}, false);
      }
    });
  }

  // ---- ワールドトリガー風 大型商業・オフィスビル（階段吹き抜け開口を完全確保） ----
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

    // 階段ユニットの寸法（床スラブ開口と完全に一致させる）
    const stairWellW = 7.4;   // 階段室の横幅
    const stairCenterX = cx + halfS - wallThick - stairWellW / 2; // 外壁の内側にピッタリ配置
    const stairTotalLen = 12.0; // cz - 6.0 ～ cz + 6.0 が階段の昇降空間

    for (let f = 0; f < floors; f++) {
      const baseY = f * floorH;
      const wallCenterY = baseY + floorH / 2;
      const wallH = floorH - slabThick;

      // 2階以上の床スラブ
      if (f > 0) {
        if (isCentralMall) {
          // 中央モール：中央の吹き抜けアトリウム（幅15m×奥行15m）を完全に空ける
          const rimW = 7.5;
          this.addSolidBox(cx, baseY - slabThick / 2, cz - halfS + rimW / 2, size, slabThick, rimW, floorMat);
          this.addSolidBox(cx, baseY - slabThick / 2, cz + halfS - rimW / 2, size, slabThick, rimW, floorMat);
          this.addSolidBox(cx - halfS + rimW / 2, baseY - slabThick / 2, cz, rimW, slabThick, size - rimW * 2, floorMat);
          this.addSolidBox(cx + halfS - rimW / 2, baseY - slabThick / 2, cz, rimW, slabThick, size - rimW * 2, floorMat);

          // 吹き抜け手すり（エスカレーターの出口部分だけ通路として空ける）
          const atriumHalf = halfS - rimW;
          this.addSolidBox(cx - 4.8, baseY + 0.55, cz - atriumHalf, 5.2, 1.1, 0.25, glassRailMat, {}, false);
          this.addSolidBox(cx + 4.8, baseY + 0.55, cz - atriumHalf, 5.2, 1.1, 0.25, glassRailMat, {}, false);
          this.addSolidBox(cx, baseY + 0.55, cz + atriumHalf, atriumHalf * 2, 1.1, 0.25, glassRailMat, {}, false);
          this.addSolidBox(cx - atriumHalf, baseY + 0.55, cz, 0.25, 1.1, atriumHalf * 2, glassRailMat, {}, false);
          this.addSolidBox(cx + atriumHalf, baseY + 0.55, cz, 0.25, 1.1, atriumHalf * 2, glassRailMat, {}, false);
        } else {
          // 通常大型ビル：メイン床スラブ（階段室の西側まで）
          const mainSlabW = size - stairWellW - wallThick;
          const mainCenterX = cx - halfS + mainSlabW / 2;
          this.addSolidBox(mainCenterX, baseY - slabThick / 2, cz, mainSlabW, slabThick, size, floorMat);

          // 階段室の北側・南側の踊り場床（階段の昇降エリア cz-6.0～cz+6.0 は完全に吹き抜けにする）
          const sideLandingD = (size - stairTotalLen) / 2;
          if (sideLandingD > 0.5) {
            this.addSolidBox(stairCenterX, baseY - slabThick / 2, cz - halfS + sideLandingD / 2, stairWellW, slabThick, sideLandingD, floorMat);
            this.addSolidBox(stairCenterX, baseY - slabThick / 2, cz + halfS - sideLandingD / 2, stairWellW, slabThick, sideLandingD, floorMat);
          }

          // 階段吹き抜けの西側手すり（南側の出入り口 3.5m は通れるように空ける）
          const railLen = stairTotalLen - 3.6;
          this.addSolidBox(stairCenterX - stairWellW / 2, baseY + 0.55, cz - 1.8, 0.25, 1.1, railLen, glassRailMat, {}, false);
        }
      }

      // 外壁
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

      // 室内柱（階段やエスカレーターの動線に干渉しない位置に配置）
      const colOff = isCentralMall ? 9.5 : 5.2;
      this.addSolidBox(cx - colOff, wallCenterY, cz - colOff, 1.2, wallH, 1.2, wallMat);
      this.addSolidBox(cx - colOff, wallCenterY, cz + colOff, 1.2, wallH, 1.2, wallMat);
      if (isCentralMall) {
        this.addSolidBox(cx + colOff, wallCenterY, cz - colOff, 1.2, wallH, 1.2, wallMat);
        this.addSolidBox(cx + colOff, wallCenterY, cz + colOff, 1.2, wallH, 1.2, wallMat);
      }

      // 階段・エスカレーター生成
      if (isCentralMall) {
        this.buildMallEscalator(cx, cz - 1.5, baseY, floorH, stairMat, glassRailMat);
      } else {
        this.buildSwitchbackStaircase(stairCenterX, cz, baseY, floorH, stairMat, railMat);
      }
    }

    // 屋上スラブ（階段の出口開口を完全に空ける）
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

    // 屋上の外周パラペット（胸壁）
    const paraH = 1.15;
    this.addSolidBox(cx, roofY + paraH / 2, cz - halfS + 0.35, size, paraH, 0.7, wallMat);
    this.addSolidBox(cx, roofY + paraH / 2, cz + halfS - 0.35, size, paraH, 0.7, wallMat);
    this.addSolidBox(cx - halfS + 0.35, roofY + paraH / 2, cz, 0.7, paraH, size - 1.4, wallMat);
    this.addSolidBox(cx + halfS - 0.35, roofY + paraH / 2, cz, 0.7, paraH, size - 1.4, wallMat);

    // 屋上の空調ユニット
    this.addSolidBox(cx - halfS + 3.5, roofY + 1.1, cz - halfS + 3.5, 2.8, 2.2, 2.2, railMat);
    this.addDestructibleBlock(cx - halfS + 3.5, roofY + HALF, cz + halfS - 3.5, 0x38bdf8, 55);
  }

      // 外壁（1階は4方向すべて広い出入り口 / 2階以上はガラス窓＋バルコニー開口）
      const sideSeg = (size - doorW) / 2;

      [-1, 1].forEach((zSign) => {
        const wz = cz + zSign * (halfS - wallThick / 2);
        this.addSolidBox(cx - halfS + sideSeg / 2, wallCenterY, wz, sideSeg, wallH, wallThick, wallMat);
        this.addSolidBox(cx + halfS - sideSeg / 2, wallCenterY, wz, sideSeg, wallH, wallThick, wallMat);
        // 上部垂れ壁
        this.addSolidBox(cx, baseY + wallH - 0.75, wz, doorW, 1.5, wallThick, wallMat);

        if (f > 0) {
          this.addSolidBox(cx, baseY + 0.55, wz, doorW, 1.1, wallThick * 0.8, glassRailMat);
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
          // 2階以上の東西窓は破壊可能な強化ガラスパネル（旋空やメテオラで割り入って突入可能）
          this.addDestructibleBlock(wx, baseY + 1.2, cz - 1.2, 0x38bdf8, 45);
          this.addDestructibleBlock(wx, baseY + 1.2, cz + 1.2, 0x38bdf8, 45);
        }
      });

      // 室内の構造柱（遮蔽物）
      const colOff = isCentralMall ? 8.5 : 4.5;
      this.addSolidBox(cx - colOff, wallCenterY, cz - colOff, 1.3, wallH, 1.3, wallMat);
      this.addSolidBox(cx - colOff, wallCenterY, cz + colOff, 1.3, wallH, 1.3, wallMat);
      if (isCentralMall) {
        this.addSolidBox(cx + colOff, wallCenterY, cz - colOff, 1.3, wallH, 1.3, wallMat);
        this.addSolidBox(cx + colOff, wallCenterY, cz + colOff, 1.3, wallH, 1.3, wallMat);
      }

      // 階段配置（中央モールは吹き抜けエスカレーター / 通常ビルは折り返し階段）
      if (isCentralMall) {
        const escDir = f % 2 === 0 ? 1 : -1;
        this.buildMallEscalator(cx - 4.2, cz, baseY, floorH, escDir, stairMat, glassRailMat);
        this.buildMallEscalator(cx + 4.2, cz, baseY, floorH, -escDir, stairMat, glassRailMat);
      } else {
        const stairCenterX = cx + halfS - 3.6;
        this.buildSwitchbackStaircase(stairCenterX, cz, baseY, floorH, stairMat, railMat);
      }
    }

    // 屋上スラブ
    const roofY = floors * floorH;
    if (isCentralMall) {
      const rimW = 7.5;
      this.addSolidBox(cx, roofY - slabThick / 2, cz - halfS + rimW / 2, size, slabThick, rimW, floorMat);
      this.addSolidBox(cx, roofY - slabThick / 2, cz + halfS - rimW / 2, size, slabThick, rimW, floorMat);
      this.addSolidBox(cx - halfS + rimW / 2, roofY - slabThick / 2, cz, rimW, slabThick, size - rimW * 2, floorMat);
      this.addSolidBox(cx + halfS - rimW / 2, roofY - slabThick / 2, cz, rimW, slabThick, size - rimW * 2, floorMat);
    } else {
      const stairWellW = 7.2;
      const mainRoofW = size - stairWellW;
      this.addSolidBox(cx - stairWellW / 2, roofY - slabThick / 2, cz, mainRoofW, slabThick, size, floorMat);
      this.addSolidBox(cx + halfS - stairWellW / 2, roofY - slabThick / 2, cz - halfS + 3.2, stairWellW, slabThick, 6.4, floorMat);
      this.addSolidBox(cx + halfS - stairWellW / 2, roofY - slabThick / 2, cz + halfS - 3.2, stairWellW, slabThick, 6.4, floorMat);
    }

    // 屋上の外周パラペット（狙撃戦用の胸壁）
    const paraH = 1.15;
    this.addSolidBox(cx, roofY + paraH / 2, cz - halfS + 0.35, size, paraH, 0.7, wallMat);
    this.addSolidBox(cx, roofY + paraH / 2, cz + halfS - 0.35, size, paraH, 0.7, wallMat);
    this.addSolidBox(cx - halfS + 0.35, roofY + paraH / 2, cz, 0.7, paraH, size - 1.4, wallMat);
    this.addSolidBox(cx + halfS - 0.35, roofY + paraH / 2, cz, 0.7, paraH, size - 1.4, wallMat);

    // 屋上の空調室外機ユニット（遮蔽カバー）
    this.addSolidBox(cx - halfS + 3.5, roofY + 1.1, cz - halfS + 3.5, 2.8, 2.2, 2.2, railMat);
    this.addDestructibleBlock(cx - halfS + 3.5, roofY + HALF, cz + halfS - 3.5, 0x38bdf8, 55);
  }

  // 隣り合う大型ビル同士を2階の高さ（6.5m）で繋ぐ空中渡り廊下
  buildSkyBridge(x1, z1, x2, z2, floorLevel = 1) {
    const floorH = 6.5;
    const bridgeY = floorLevel * floorH - 0.25;
    const midX = (x1 + x2) / 2;
    const midZ = (z1 + z2) / 2;
    const bridgeMat = new THREE.MeshStandardMaterial({ map: this.floorSlabTex, roughness: 0.6 });
    const glassRailMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.45 });

    if (Math.abs(x1 - x2) > Math.abs(z1 - z2)) {
      const span = Math.abs(x1 - x2) - 23.5;
      if (span <= 1) return;
      this.addSolidBox(midX, bridgeY, midZ, span, 0.5, 4.4, bridgeMat);
      this.addSolidBox(midX, bridgeY + 0.85, midZ - 2.05, span, 1.2, 0.25, glassRailMat);
      this.addSolidBox(midX, bridgeY + 0.85, midZ + 2.05, span, 1.2, 0.25, glassRailMat);
    } else {
      const span = Math.abs(z1 - z2) - 23.5;
      if (span <= 1) return;
      this.addSolidBox(midX, bridgeY, midZ, 4.4, 0.5, span, bridgeMat);
      this.addSolidBox(midX - 2.05, bridgeY + 0.85, midZ, 0.25, 1.2, span, glassRailMat);
      this.addSolidBox(midX + 2.05, bridgeY + 0.85, midZ, 0.25, 1.2, span, glassRailMat);
    }
  }

  // ---- 三門市・大型市街地バトルフィールド生成 ----
  buildCityArena(floor) {
    const ARENA_HALF = 82;
    const WALL_H = 22;
    const borderMat = new THREE.MeshStandardMaterial({ map: this.wallTex, roughness: 0.8 });

    // 外周防壁
    this.addSolidBox(0, WALL_H / 2, -ARENA_HALF, ARENA_HALF * 2 + 4, WALL_H, 3, borderMat);
    this.addSolidBox(0, WALL_H / 2,  ARENA_HALF, ARENA_HALF * 2 + 4, WALL_H, 3, borderMat);
    this.addSolidBox(-ARENA_HALF, WALL_H / 2, 0, 3, WALL_H, ARENA_HALF * 2 + 4, borderMat);
    this.addSolidBox( ARENA_HALF, WALL_H / 2, 0, 3, WALL_H, ARENA_HALF * 2 + 4, borderMat);

    const variant = floor % 2;

    // 1. 中央の巨大商業モール（30m×30m / 3層吹き抜けアトリウム＋エスカレーター）
    this.buildEnterableBuilding(0, 0, 3, 30, true);

    // 2. 四方の大型複合オフィスビル（24m×24m / 折り返し階段＋屋上狙撃ポイント）
    const megaCoords = [
      { x: -38, z: -30, floors: variant === 0 ? 3 : 2 },
      { x:  38, z: -30, floors: variant === 0 ? 2 : 3 },
      { x: -38, z:  30, floors: variant === 0 ? 2 : 3 },
      { x:  38, z:  30, floors: variant === 0 ? 3 : 2 }
    ];
    megaCoords.forEach((b) => {
      this.buildEnterableBuilding(b.x, b.z, b.floors, 24, false);
    });

    // 3. 南北の大型ビル同士を2階の高さ（6.5m）で結ぶ空中スカイブリッジ
    this.buildSkyBridge(-38, -30, -38, 30, 1);
    this.buildSkyBridge( 38, -30,  38, 30, 1);

    // 4. 大通り交差点のグラスホッパー起動パッド（一気に屋上へ跳べる立体起動ポイント）
    this.spawnJumpPad(-19, -18, 0.65);
    this.spawnJumpPad( 19,  18, 0.65);
    this.spawnJumpPad(-19,  18, 0.65);
    this.spawnJumpPad( 19, -18, 0.65);

    // 5. 大通りの破壊可能遮蔽物（車両・トリオンバリケード）
    [
      [-20, 0], [20, 0], [0, -32], [0, 32],
      [-38, 0], [38, 0]
    ].forEach(([vx, vz]) => {
      this.addDestructibleBlock(vx - 1.8, HALF, vz, 0x0284c7, 50);
      this.addDestructibleBlock(vx + 1.8, HALF, vz, 0x0284c7, 50);
      this.addDestructibleBlock(vx, HALF + BOX_SIZE, vz, 0x38bdf8, 50);
    });

    // 中央商業モール1階アトリウム中央に転送ゲート設置
    this.createExitPortal(0, 0, true);

    return {
      playerStart: new THREE.Vector3(0, 0, 62),
      rivalStart: new THREE.Vector3(0, 0, -62)
    };
  }

  spawnJumpPad(x, z, power = 0.62) {
    const pad = new THREE.Mesh(
      new THREE.RingGeometry(0.45, 1.65, 24),
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
    const WALL_HEIGHT = 6.0;
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
    const wallMat = new THREE.MeshStandardMaterial({ map: this.wallTex, roughness: 0.7 });
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
    this.onToast('✨ ランク戦勝利！中央モール1階の転送ゲート（Fキー）が解除されました！');
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

  isBlockedForEntity(x, z, radius = 0.5, entityY = 0) {
    const stepUpAllowance = 0.55;
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
        if (currentY >= top - 0.58) {
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
        if (d < 1.65 && player.root.position.y <= 0.35 && player.velocityY <= 0.05) {
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
