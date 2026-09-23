/**
 * Решатель цепей постоянного тока методом узловых потенциалов.
 *
 * Каждый элемент цепи — «ветвь» между узлами a и b: ЭДС `emf` последовательно
 * с сопротивлением `r` (эквивалент Тевенина). Резистор — ветвь с emf = 0,
 * батарея — ветвь с внутренним сопротивлением и emf > 0 (плюс на стороне b).
 * В матрицу ветвь входит как эквивалент Нортона: проводимость 1/r
 * параллельно с источником тока emf/r, втекающим в узел b.
 *
 * Идеальные соединения (контакты макетки, выводы в одном отверстии) задаются
 * списком `links` и сливаются в один узел заранее (union-find), поэтому
 * в матрице нет нулевых сопротивлений.
 *
 * Идеальных источников напряжения нет, поэтому короткое замыкание
 * не делает систему вырожденной — через батарею просто течёт emf/r.
 * Опорный узел выбирается в каждой связной части цепи отдельно, так что
 * «висящие» куски цепи тоже не ломают расчёт.
 */

export interface Branch {
  id: string;
  a: string;
  b: string;
  /** Сопротивление, Ом. Infinity — ветвь разомкнута (выключатель, сгоревший элемент). */
  r: number;
  /** ЭДС, В. Положительная ЭДС поднимает потенциал от a к b. */
  emf?: number;
}

export interface BranchResult {
  /** Ток через ветвь от a к b, А. */
  current: number;
  /** Напряжение Vb − Va на выводах, В. */
  voltage: number;
  /** Мощность, выделяемая на сопротивлении ветви, Вт. */
  power: number;
}

export interface Solution {
  /** Узел после слияния для каждого исходного имени узла. */
  nodeOf: Map<string, string>;
  /** Потенциал каждого исходного узла относительно опорного узла его части цепи, В. */
  voltage: Map<string, number>;
  branches: Map<string, BranchResult>;
}

class UnionFind {
  private parent = new Map<string, string>();

  find(x: string): string {
    let p = this.parent.get(x);
    if (p === undefined) {
      this.parent.set(x, x);
      return x;
    }
    if (p === x) return x;
    p = this.find(p);
    this.parent.set(x, p);
    return p;
  }

  union(x: string, y: string): void {
    const rx = this.find(x);
    const ry = this.find(y);
    if (rx !== ry) this.parent.set(rx, ry);
  }
}

export function solveCircuit(branches: Branch[], links: [string, string][] = []): Solution {
  const uf = new UnionFind();
  for (const [x, y] of links) uf.union(x, y);
  for (const br of branches) {
    uf.find(br.a);
    uf.find(br.b);
  }

  const active = branches.filter((br) => Number.isFinite(br.r) && br.r > 0);
  for (const br of branches) {
    if (!(br.r > 0)) throw new Error(`Ветвь ${br.id}: сопротивление должно быть > 0`);
  }

  // Связные части цепи по активным ветвям (узлы уже слиты по links).
  const adjacency = new Map<string, string[]>();
  const touch = (n: string) => {
    if (!adjacency.has(n)) adjacency.set(n, []);
    return adjacency.get(n)!;
  };
  for (const br of active) {
    const a = uf.find(br.a);
    const b = uf.find(br.b);
    touch(a).push(b);
    touch(b).push(a);
  }

  // Опорный узел части: минус первой батареи, иначе первый встреченный узел.
  const preferredRef = new Set<string>();
  for (const br of active) if (br.emf) preferredRef.add(uf.find(br.a));

  const index = new Map<string, number>(); // узел → строка матрицы; опорные узлы не входят
  const visited = new Set<string>();
  for (const start of adjacency.keys()) {
    if (visited.has(start)) continue;
    const component: string[] = [];
    const stack = [start];
    visited.add(start);
    while (stack.length) {
      const n = stack.pop()!;
      component.push(n);
      for (const m of adjacency.get(n)!) {
        if (!visited.has(m)) {
          visited.add(m);
          stack.push(m);
        }
      }
    }
    const ref = component.find((n) => preferredRef.has(n)) ?? component[0];
    for (const n of component) if (n !== ref) index.set(n, index.size);
  }

  const size = index.size;
  const G = Array.from({ length: size }, () => new Float64Array(size));
  const I = new Float64Array(size);
  for (const br of active) {
    const a = index.get(uf.find(br.a));
    const b = index.get(uf.find(br.b));
    const g = 1 / br.r;
    const src = (br.emf ?? 0) * g; // ток источника Нортона, втекает в b
    if (a !== undefined) {
      G[a][a] += g;
      I[a] -= src;
    }
    if (b !== undefined) {
      G[b][b] += g;
      I[b] += src;
    }
    if (a !== undefined && b !== undefined) {
      G[a][b] -= g;
      G[b][a] -= g;
    }
  }

  const x = gaussianSolve(G, I);
  const potential = (n: string) => {
    const i = index.get(uf.find(n));
    return i === undefined ? 0 : x[i];
  };

  const nodeOf = new Map<string, string>();
  const voltage = new Map<string, number>();
  for (const br of branches) {
    for (const n of [br.a, br.b]) {
      nodeOf.set(n, uf.find(n));
      voltage.set(n, potential(n));
    }
  }
  for (const [p, q] of links) {
    for (const n of [p, q]) {
      nodeOf.set(n, uf.find(n));
      voltage.set(n, potential(n));
    }
  }

  const results = new Map<string, BranchResult>();
  for (const br of branches) {
    const va = potential(br.a);
    const vb = potential(br.b);
    if (!Number.isFinite(br.r)) {
      results.set(br.id, { current: 0, voltage: vb - va, power: 0 });
      continue;
    }
    const current = (va - vb + (br.emf ?? 0)) / br.r;
    results.set(br.id, { current, voltage: vb - va, power: current * current * br.r });
  }

  return { nodeOf, voltage, branches: results };
}

/** Метод Гаусса с выбором главного элемента по столбцу. Матрица портится. */
function gaussianSolve(A: Float64Array[], b: Float64Array): Float64Array {
  const n = b.length;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(A[row][col]) > Math.abs(A[pivot][col])) pivot = row;
    }
    if (Math.abs(A[pivot][col]) < 1e-300) {
      // Не должно случаться: каждая часть цепи связна и заземлена.
      throw new Error("Вырожденная матрица проводимостей");
    }
    if (pivot !== col) {
      [A[pivot], A[col]] = [A[col], A[pivot]];
      [b[pivot], b[col]] = [b[col], b[pivot]];
    }
    for (let row = col + 1; row < n; row++) {
      const f = A[row][col] / A[col][col];
      if (f === 0) continue;
      for (let k = col; k < n; k++) A[row][k] -= f * A[col][k];
      b[row] -= f * b[col];
    }
  }
  const x = new Float64Array(n);
  for (let row = n - 1; row >= 0; row--) {
    let s = b[row];
    for (let k = row + 1; k < n; k++) s -= A[row][k] * x[k];
    x[row] = s / A[row][row];
  }
  return x;
}
