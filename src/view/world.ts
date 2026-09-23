import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { BOARD, HOLES, LAYOUT, PCB, breadboardX, layoutBottom, layoutRight, type Hole } from "../model/breadboard";
import { breadboardTexture, matTexture, pcbTexture, puffTexture } from "./textures";

const MAX_DOTS = 3000;
const MAX_PUFFS = 240;

/** Частица дыма или искра. */
interface Puff {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  life: number;
  size: number;
  kind: "smoke" | "spark";
}

/** Three.js-часть: рендер, плата, стол, частицы, анимация тока, пересечения с курсором. */
export class World {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  readonly componentLayer = new THREE.Group();
  readonly wireLayer = new THREE.Group();
  /** Медные дорожки печатной платы. */
  readonly traceLayer = new THREE.Group();
  readonly overlay = new THREE.Group();

  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  /** Верхние корпуса макеток (для попадания курсора) и печатная плата. */
  private breadboards: THREE.Mesh[] = [];
  private pcb!: THREE.Mesh;
  private boardGroup = new THREE.Group();
  private breadboardTexture?: THREE.CanvasTexture;
  private table: THREE.Mesh;
  private holeMarks!: THREE.InstancedMesh;
  private dots: THREE.InstancedMesh;
  private puffs: Puff[] = [];
  private puffSprites: THREE.Sprite[] = [];
  private raycaster = new THREE.Raycaster();
  private userMovedCamera = false;
  /** Конструктор отработал (есть рендер и постобработка) — можно перекадрировать. */
  private ready = false;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x2b3a3e);
    this.scene.fog = new THREE.Fog(0x2b3a3e, 220, 420);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 600);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    // Сам щелчок по сцене — не движение камеры: считаем только реальное смещение
    let startPos = new THREE.Vector3();
    this.controls.addEventListener("start", () => (startPos = this.camera.position.clone()));
    this.controls.addEventListener("end", () => {
      if (this.camera.position.distanceTo(startPos) > 0.05) this.userMovedCamera = true;
    });
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 260;
    this.controls.update();

    // Свет: мягкий небесный + направленный с тенями + контровой
    this.scene.add(new THREE.HemisphereLight(0xf1f4ef, 0x3a4a4c, 0.65));
    const sun = new THREE.DirectionalLight(0xffffff, 1.35);
    sun.position.set(-30, 60, 25);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -60;
    sc.right = 60;
    sc.top = 50;
    sc.bottom = -50;
    sc.near = 1;
    sc.far = 200;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0xcfe3ff, 0.35);
    rim.position.set(40, 30, -40);
    this.scene.add(rim);

    // Стол — антистатический коврик
    const mat = matTexture();
    mat.repeat.set(24, 24);
    this.table = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshStandardMaterial({ map: mat, roughness: 0.95 }),
    );
    this.table.rotation.x = -Math.PI / 2;
    this.table.receiveShadow = true;
    this.scene.add(this.table);

    // Платы и подсветка отверстий строятся по раскладке (см. rebuildBoards)
    this.rebuildBoards();

    // Бегущие точки тока
    this.dots = new THREE.InstancedMesh(
      // Радиус больше, чем у провода (≈ 0,3), иначе точки прячутся внутри изоляции
      new THREE.SphereGeometry(0.36, 12, 8),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff1a8).multiplyScalar(2.6) }),
      MAX_DOTS,
    );
    this.dots.count = 0;
    this.dots.frustumCulled = false;
    this.scene.add(this.dots);

    // Частицы
    const puffTex = puffTexture();
    for (let i = 0; i < MAX_PUFFS; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false }));
      s.visible = false;
      this.puffSprites.push(s);
      this.scene.add(s);
    }

    this.scene.add(this.componentLayer, this.wireLayer, this.traceLayer, this.overlay);

    // Постобработка: свечение ламп и искр
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Порог выше яркости освещённой белой платы: светятся только нити ламп и искры.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.4, 2.2);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    new ResizeObserver(() => this.resize()).observe(container);
    this.ready = true;
    this.resize();
  }

  resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.camera.aspect = w / h;
    if (!this.userMovedCamera) this.frameView();
    else {
      const shift = (this.insets.right - this.insets.left) / 2;
      if (shift) this.camera.setViewOffset(w, h, shift, 0, w, h);
      else this.camera.clearViewOffset();
    }
    this.camera.updateProjectionMatrix();
  }

  /** Сколько пикселей слева и справа закрыто панелями интерфейса. */
  insets = { left: 0, right: 0 };

  /**
   * Начальный ракурс под пропорции экрана и панели: сцена вписывается в видимую область
   * между панелью инструментов и панелью справа. На узком экране (телефон) — плата целиком.
   */
  frameView(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const aspect = w / h;
    const narrow = aspect < 1;
    const usable = Math.max(0.3, (w - this.insets.left - this.insets.right) / w);
    // Сдвиг центра проекции к середине видимой области
    const shift = (this.insets.right - this.insets.left) / 2;
    if (shift) this.camera.setViewOffset(w, h, shift, 0, w, h);
    else this.camera.clearViewOffset();
    // Всё, что стоит на столе: слева батарея и блок питания, справа — платы до правого края
    const left = narrow ? -16 : -44;
    const right = layoutRight() + 2;
    const back = -12;
    const front = layoutBottom() + 2;
    const halfWidth = Math.max((right - left) / 2, ((front - back) / 2) * (narrow ? 0.9 : 1.2));
    const tanH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * aspect * usable;
    const dist = THREE.MathUtils.clamp(halfWidth / tanH, 60, 230);
    const target = new THREE.Vector3((left + right) / 2, 0, (back + front) / 2 - 7);
    const dir = new THREE.Vector3(0.04, 0.7, 0.71).normalize();
    this.controls.target.copy(target);
    this.camera.position.copy(target).addScaledVector(dir, dist);
    this.controls.update();
  }

  render(): void {
    this.controls.update();
    this.composer.render();
  }

  // ─── Платы ─────────────────────────────────────────────────────────────

  /**
   * Построить платы по текущей раскладке (LAYOUT): макетки вплотную вправо, печатная плата
   * нужного размера, подсветку отверстий — на всё новое число отверстий.
   */
  rebuildBoards(): void {
    this.scene.remove(this.boardGroup);
    this.boardGroup.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        const map = (mat as THREE.MeshStandardMaterial).map;
        if (map && map !== this.breadboardTexture) map.dispose();
        mat.dispose();
      }
    });
    this.boardGroup = new THREE.Group();
    this.breadboardTexture ??= breadboardTexture();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xece9e0, roughness: 0.7 });
    const topMat = new THREE.MeshStandardMaterial({ map: this.breadboardTexture, roughness: 0.75 });
    this.breadboards = [];
    for (let bb = 0; bb < LAYOUT.breadboards; bb++) {
      const body = new THREE.Mesh(new THREE.BoxGeometry(BOARD.width, BOARD.height, BOARD.depth), [bodyMat, bodyMat, topMat, bodyMat, bodyMat, bodyMat]);
      body.position.set(breadboardX(bb), BOARD.height / 2, 0);
      body.castShadow = true;
      body.receiveShadow = true;
      this.breadboards.push(body);
      this.boardGroup.add(body);
    }
    const fr4 = new THREE.MeshStandardMaterial({ color: 0x2c6e47, roughness: 0.55 });
    const pcbTop = new THREE.MeshStandardMaterial({ map: pcbTexture(), roughness: 0.45, metalness: 0.05 });
    this.pcb = new THREE.Mesh(new THREE.BoxGeometry(PCB.width, PCB.height, PCB.depth), [fr4, fr4, pcbTop, fr4, fr4, fr4]);
    this.pcb.position.set(PCB.x, PCB.height / 2, PCB.z);
    this.pcb.castShadow = true;
    this.pcb.receiveShadow = true;
    this.boardGroup.add(this.pcb);
    // Подсветка отверстий: квадраты над гнёздами, по умолчанию скрыты
    this.holeMarks = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.62, 0.62).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }),
      HOLES.length,
    );
    this.holeMarks.renderOrder = 2;
    this.clearHoleMarks();
    this.boardGroup.add(this.holeMarks);
    this.scene.add(this.boardGroup);
    // Платы поменялись (или загружена другая схема) — показываем всё заново
    this.userMovedCamera = false;
    if (this.ready) this.resize();
  }

  // ─── Отверстия ─────────────────────────────────────────────────────────

  clearHoleMarks(): void {
    const m = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < HOLES.length; i++) this.holeMarks.setMatrixAt(i, m);
    this.holeMarks.instanceMatrix.needsUpdate = true;
  }

  /** Подсветить отверстия: hole → цвет. */
  markHoles(marks: Map<string, THREE.ColorRepresentation>): void {
    const m = new THREE.Matrix4();
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const color = new THREE.Color();
    HOLES.forEach((h, i) => {
      const c = marks.get(h.id);
      if (c === undefined) {
        this.holeMarks.setMatrixAt(i, zero);
        return;
      }
      m.makeTranslation(h.x, h.y + 0.01, h.z);
      this.holeMarks.setMatrixAt(i, m);
      this.holeMarks.setColorAt(i, color.set(c));
    });
    this.holeMarks.instanceMatrix.needsUpdate = true;
    if (this.holeMarks.instanceColor) this.holeMarks.instanceColor.needsUpdate = true;
  }

  // ─── Курсор ────────────────────────────────────────────────────────────

  private setRay(ndc: THREE.Vector2): void {
    this.raycaster.setFromCamera(ndc, this.camera);
  }

  ndcFromEvent(ev: { clientX: number; clientY: number }): THREE.Vector2 {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  }

  /** Экранные координаты (px) точки сцены. */
  toScreen(p: THREE.Vector3): THREE.Vector2 {
    const v = p.clone().project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((v.x + 1) / 2) * r.width + r.left, ((1 - v.y) / 2) * r.height + r.top);
  }

  /** Верхняя грань какой-либо платы под курсором. */
  private boardHit(ndc: THREE.Vector2): { point: THREE.Vector3; board: Hole["board"] } | undefined {
    this.setRay(ndc);
    const hit = this.raycaster.intersectObjects([...this.breadboards, this.pcb], false)[0];
    if (!hit) return undefined;
    const board = hit.object === this.pcb ? "pcb" : "breadboard";
    const top = board === "pcb" ? PCB.height : BOARD.height;
    return hit.point.y > top - 0.01 ? { point: hit.point, board } : undefined;
  }

  /** Ближайшее отверстие под курсором (если курсор над платой). */
  pickHole(ndc: THREE.Vector2): Hole | undefined {
    const hit = this.boardHit(ndc);
    if (!hit) return undefined;
    let best: Hole | undefined;
    let bestD = 0.6;
    for (const h of HOLES) {
      if (h.board !== hit.board) continue;
      const d = Math.hypot(h.x - hit.point.x, h.z - hit.point.z);
      if (d < bestD) {
        bestD = d;
        best = h;
      }
    }
    return best;
  }

  /** Попадает ли курсор на плату (даже мимо отверстия). */
  overBoard(ndc: THREE.Vector2): boolean {
    return !!this.boardHit(ndc);
  }

  /** Точка на столе под курсором (мимо платы). */
  pickTable(ndc: THREE.Vector2): THREE.Vector3 | undefined {
    this.setRay(ndc);
    const hits = this.raycaster.intersectObjects([...this.breadboards, this.pcb, this.table], false);
    return hits[0]?.object === this.table ? hits[0].point.clone() : undefined;
  }

  /** Ближайшая деталь или провод под курсором. */
  pickObject(ndc: THREE.Vector2): { componentId?: string; wireId?: string; traceId?: string } | undefined {
    this.setRay(ndc);
    const hit = this.raycaster.intersectObjects([this.componentLayer, this.wireLayer, this.traceLayer], true)[0];
    if (!hit) return undefined;
    return { componentId: hit.object.userData.componentId, wireId: hit.object.userData.wireId, traceId: hit.object.userData.traceId };
  }

  // ─── Ток ───────────────────────────────────────────────────────────────

  private dotMatrix = new THREE.Matrix4();

  /** Расставить точки тока. paths: кривая и фаза каждой точки 0…1. */
  setDots(items: { curve: THREE.Curve<THREE.Vector3>; phases: number[] }[]): void {
    let n = 0;
    for (const it of items) {
      for (const t of it.phases) {
        if (n >= MAX_DOTS) break;
        const p = it.curve.getPointAt(t);
        this.dotMatrix.makeTranslation(p.x, p.y, p.z);
        this.dots.setMatrixAt(n++, this.dotMatrix);
      }
    }
    this.dots.count = n;
    this.dots.instanceMatrix.needsUpdate = true;
  }

  // ─── Частицы ───────────────────────────────────────────────────────────

  emitSmoke(at: THREE.Vector3, amount: number): void {
    for (let i = 0; i < amount; i++) {
      this.puffs.push({
        pos: at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0, (Math.random() - 0.5) * 0.4)),
        vel: new THREE.Vector3((Math.random() - 0.5) * 0.6, 2.2 + Math.random() * 1.4, (Math.random() - 0.5) * 0.6),
        age: 0,
        life: 1.6 + Math.random() * 1.2,
        size: 0.6 + Math.random() * 0.5,
        kind: "smoke",
      });
    }
  }

  emitSparks(at: THREE.Vector3, amount: number): void {
    for (let i = 0; i < amount; i++) {
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.3, Math.random() - 0.5).normalize();
      this.puffs.push({
        pos: at.clone(),
        vel: dir.multiplyScalar(6 + Math.random() * 8),
        age: 0,
        life: 0.25 + Math.random() * 0.35,
        size: 0.25 + Math.random() * 0.2,
        kind: "spark",
      });
    }
  }

  stepParticles(dt: number): void {
    this.puffs = this.puffs.filter((p) => (p.age += dt) < p.life).slice(-MAX_PUFFS);
    for (const p of this.puffs) {
      if (p.kind === "spark") p.vel.y -= 25 * dt;
      else p.vel.multiplyScalar(1 - 0.6 * dt);
      p.pos.addScaledVector(p.vel, dt);
    }
    this.puffSprites.forEach((s, i) => {
      const p = this.puffs[i];
      if (!p) {
        s.visible = false;
        return;
      }
      const k = p.age / p.life;
      const mat = s.material;
      s.visible = true;
      s.position.copy(p.pos);
      if (p.kind === "smoke") {
        s.scale.setScalar(p.size * (1 + k * 3));
        mat.color.setRGB(0.62, 0.62, 0.6);
        mat.opacity = 0.55 * (1 - k);
        mat.blending = THREE.NormalBlending;
      } else {
        s.scale.setScalar(p.size);
        mat.color.setRGB(4, 2.6, 1.1); // яркие — попадают в свечение
        mat.opacity = 1 - k;
        mat.blending = THREE.AdditiveBlending;
      }
    });
  }
}
