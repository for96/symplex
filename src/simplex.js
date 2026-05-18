// Simplex algorithm — Two-Phase method (no Big-M), configurable pivot rule.
// Pivot rules:
//   - "dantzig"  : entering var = most-negative reduced cost (default)
//   - "bland"    : entering var = smallest index with negative reduced cost (anti-cycling)
// Leaving var is always min positive ratio test; Bland tie-breaks by smallest basis index.
(function () {
  "use strict";

  // Why: tighter than geometry's EPS (1e-7) because tableau values arise from
  // repeated row operations on rationals — a "true zero" in the algebra can
  // still be 1e-12..1e-10 numerically. Loosening risks accepting fake degeneracy.
  const EPS = 1e-9;

  function normalize(constraints) {
    return constraints.map((c) => {
      if (c.b < 0) {
        return {
          a: c.a.map((v) => -v),
          op: c.op === "<=" ? ">=" : c.op === ">=" ? "<=" : "=",
          b: -c.b,
        };
      }
      return { a: c.a.slice(), op: c.op, b: c.b };
    });
  }

  function computeZRow(constraintRows, basis, phaseObj, totalCols) {
    const m = basis.length;
    const z = new Array(totalCols).fill(0);
    for (let j = 0; j < totalCols; j++) {
      let zj = 0;
      for (let i = 0; i < m; i++) zj += phaseObj[basis[i]] * constraintRows[i][j];
      const cj = j < totalCols - 1 ? phaseObj[j] : 0;
      z[j] = zj - cj;
    }
    return z;
  }

  function buildLP(lp, options) {
    options = options || {};
    const rule = options.rule || "dantzig";
    const isMin = lp.objective === "min";
    const n = lp.c.length;
    const constraints = normalize(lp.constraints);
    const m = constraints.length;

    let nSlack = 0;
    let nArt = 0;
    for (const c of constraints) {
      if (c.op === "<=") nSlack++;
      else if (c.op === ">=") {
        nSlack++;
        nArt++;
      } else {
        nArt++;
      }
    }
    const hasArt = nArt > 0;

    const colLabels = [];
    const colTypes = [];
    for (let j = 0; j < n; j++) {
      colLabels.push((lp.varNames && lp.varNames[j]) || `x${j + 1}`);
      colTypes.push("decision");
    }
    for (let i = 0, s = 1; i < m; i++) {
      if (constraints[i].op === "<=" || constraints[i].op === ">=") {
        colLabels.push(`s${s}`);
        colTypes.push("slack");
        s++;
      }
    }
    for (let i = 0, a = 1; i < m; i++) {
      if (constraints[i].op === ">=" || constraints[i].op === "=") {
        colLabels.push(`a${a}`);
        colTypes.push("artificial");
        a++;
      }
    }
    colLabels.push("RHS");

    const totalCols = colLabels.length;
    const dataCols = totalCols - 1;
    const slackStart = n;
    const artStart = n + nSlack;

    const T = [];
    const basis = new Array(m).fill(-1);
    const starterCol = new Array(m).fill(-1); // column whose initial coef is e_i — used for dual recovery

    let sPos = 0;
    let aPos = 0;
    for (let i = 0; i < m; i++) {
      const c = constraints[i];
      const row = new Array(totalCols).fill(0);
      for (let j = 0; j < n; j++) row[j] = c.a[j];
      if (c.op === "<=") {
        row[slackStart + sPos] = 1;
        basis[i] = slackStart + sPos;
        starterCol[i] = slackStart + sPos;
        sPos++;
      } else if (c.op === ">=") {
        row[slackStart + sPos] = -1;
        sPos++;
        row[artStart + aPos] = 1;
        basis[i] = artStart + aPos;
        starterCol[i] = artStart + aPos;
        aPos++;
      } else {
        row[artStart + aPos] = 1;
        basis[i] = artStart + aPos;
        starterCol[i] = artStart + aPos;
        aPos++;
      }
      row[totalCols - 1] = c.b;
      T.push(row);
    }

    const cOrig = lp.c.slice();
    const cFull = new Array(dataCols).fill(0);
    for (let j = 0; j < n; j++) cFull[j] = isMin ? -cOrig[j] : cOrig[j];
    // Artificials and slacks have cFull = 0

    const phase = hasArt ? 1 : 2;
    const phaseObj = new Array(dataCols).fill(0);
    if (phase === 1) {
      // Phase 1: maximize -(sum of artificials)  =>  c_a = -1, rest 0
      for (let j = artStart; j < dataCols; j++) phaseObj[j] = -1;
    } else {
      for (let j = 0; j < dataCols; j++) phaseObj[j] = cFull[j];
    }

    const zRow = computeZRow(T, basis, phaseObj, totalCols);

    return {
      T: [zRow, ...T],
      basis,
      colLabels,
      colTypes,
      n,
      m,
      nSlack,
      nArt,
      artStart,
      slackStart,
      starterCol,
      isMin,
      cOrig,
      cFull,
      hasArt,
      phase,
      phaseObj,
      rule,
      iteration: 0,
      pivot: null,
      status: "running",
      note: phase === 1 ? "phase1-init" : "init",
      objective: lp.objective,
      varNames: lp.varNames.slice(),
      originalLP: JSON.parse(JSON.stringify(lp)),
    };
  }

  function findEnteringCol(state) {
    const { T, colTypes, phase, rule } = state;
    const cols = T[0].length;
    if (rule === "bland") {
      for (let j = 0; j < cols - 1; j++) {
        if (phase === 2 && colTypes[j] === "artificial") continue;
        if (T[0][j] < -EPS) return j;
      }
      return -1;
    }
    // Dantzig (most negative reduced cost)
    let pivotCol = -1;
    let minVal = -EPS;
    for (let j = 0; j < cols - 1; j++) {
      if (phase === 2 && colTypes[j] === "artificial") continue;
      if (T[0][j] < minVal) {
        minVal = T[0][j];
        pivotCol = j;
      }
    }
    return pivotCol;
  }

  function findLeavingRow(state, pivotCol) {
    const { T, basis, m, rule } = state;
    const cols = T[0].length;
    let pivotRow = -1;
    let minRatio = Infinity;
    for (let i = 0; i < m; i++) {
      const v = T[i + 1][pivotCol];
      if (v > EPS) {
        const r = T[i + 1][cols - 1] / v;
        if (r < minRatio - EPS) {
          minRatio = r;
          pivotRow = i;
        } else if (Math.abs(r - minRatio) < EPS && pivotRow >= 0) {
          if (rule === "bland" && basis[i] < basis[pivotRow]) pivotRow = i;
        }
      }
    }
    return { pivotRow, minRatio };
  }

  function pivotStep(state) {
    const { T, basis, m, phase } = state;
    const cols = T[0].length;

    const pivotCol = findEnteringCol(state);

    if (pivotCol === -1) {
      // Optimal for this phase
      if (phase === 1) {
        const phase1Obj = T[0][cols - 1];
        // Why: phase 1 maximizes −Σ(artificials); optimum is 0 iff feasible.
        // 1e-6 (looser than EPS) absorbs the rounding accumulated across pivots.
        if (phase1Obj < -1e-6) {
          return { ...state, status: "infeasible", note: "phase1-infeasible" };
        }
        // Transition to phase 2: rebuild z-row with original objective
        const newPhaseObj = state.cFull.slice();
        while (newPhaseObj.length < cols - 1) newPhaseObj.push(0);
        const constraintRows = T.slice(1);
        const newZRow = computeZRow(constraintRows, basis, newPhaseObj, cols);
        const newT = [newZRow, ...constraintRows.map((r) => r.slice())];
        return {
          ...state,
          T: newT,
          phase: 2,
          phaseObj: newPhaseObj,
          status: "running",
          pivot: null,
          note: "phase2-start",
        };
      }
      return { ...state, status: "optimal", note: "optimal" };
    }

    const { pivotRow, minRatio } = findLeavingRow(state, pivotCol);
    if (pivotRow === -1) {
      return { ...state, status: "unbounded", note: "unbounded" };
    }

    // Perform pivot
    const newT = T.map((r) => r.slice());
    const pr = pivotRow + 1;
    const piv = newT[pr][pivotCol];
    for (let j = 0; j < cols; j++) newT[pr][j] /= piv;
    for (let i = 0; i < newT.length; i++) {
      if (i === pr) continue;
      const factor = newT[i][pivotCol];
      // Why: skipping a near-zero factor is a no-op for the subtraction (factor*row ≈ 0)
      // and avoids accumulating round-off in untouched rows. 1e-14 is strict enough
      // that we never skip a genuinely nonzero coefficient.
      if (Math.abs(factor) < 1e-14) continue;
      for (let j = 0; j < cols; j++) newT[i][j] -= factor * newT[pr][j];
    }
    const newBasis = basis.slice();
    const leaving = newBasis[pivotRow];
    newBasis[pivotRow] = pivotCol;

    return {
      ...state,
      T: newT,
      basis: newBasis,
      iteration: state.iteration + 1,
      pivot: {
        row: pivotRow,
        col: pivotCol,
        enterIdx: pivotCol,
        leaveIdx: leaving,
        enterLabel: state.colLabels[pivotCol],
        leaveLabel: state.colLabels[leaving],
        ratio: minRatio,
      },
      status: "running",
      note: "pivot",
    };
  }

  function snapshot(s) {
    return {
      ...s,
      T: s.T.map((r) => r.slice()),
      basis: s.basis.slice(),
    };
  }

  function solve(lp, options) {
    let state = buildLP(lp, options);
    const history = [snapshot(state)];
    let guard = 200;
    while (state.status === "running" && guard-- > 0) {
      const next = pivotStep(state);
      history.push(snapshot(next));
      state = next;
      if (state.status !== "running") break;
    }
    return history;
  }

  function decisionPoint(state) {
    const { T, basis, m, n } = state;
    const cols = T[0].length;
    const pt = new Array(n).fill(0);
    for (let i = 0; i < m; i++) {
      if (basis[i] < n) pt[basis[i]] = T[i + 1][cols - 1];
    }
    return pt;
  }

  function currentSolution(state) {
    const { T, basis, m, colLabels } = state;
    const cols = T[0].length;
    const values = {};
    for (let i = 0; i < colLabels.length - 1; i++) values[colLabels[i]] = 0;
    for (let i = 0; i < m; i++) {
      values[colLabels[basis[i]]] = T[i + 1][cols - 1];
    }
    return values;
  }

  function dualValues(state) {
    // y_i* = z-row entry of starter col (for max-internal); sign-flip if primal was min.
    // Iterate over original constraints only — after cuts, m grows but starterCol doesn't.
    const { T, starterCol, isMin } = state;
    const origM = starterCol ? starterCol.length : 0;
    const y = new Array(origM).fill(0);
    for (let i = 0; i < origM; i++) {
      const v = T[0][starterCol[i]];
      y[i] = isMin ? -v : v;
    }
    return y;
  }

  function objectiveValue(state) {
    if (state.phase === 1) {
      // During phase 1 we report the original-objective value at current x
      const x = decisionPoint(state);
      let z = 0;
      for (let j = 0; j < state.n; j++) z += state.cOrig[j] * x[j];
      return z;
    }
    const cols = state.T[0].length;
    let z = state.T[0][cols - 1];
    if (state.isMin) z = -z;
    return z;
  }

  function nextPivotPreview(state) {
    const pivotCol = findEnteringCol(state);
    if (pivotCol === -1) return null;
    const { T, m } = state;
    const cols = T[0].length;
    const ratios = new Array(m).fill(null);
    let minRatio = Infinity;
    let minRow = -1;
    for (let i = 0; i < m; i++) {
      const v = T[i + 1][pivotCol];
      if (v > EPS) {
        const r = T[i + 1][cols - 1] / v;
        ratios[i] = r;
        if (r < minRatio - EPS) {
          minRatio = r;
          minRow = i;
        } else if (Math.abs(r - minRatio) < EPS && state.rule === "bland") {
          if (state.basis[i] < state.basis[minRow]) minRow = i;
        }
      }
    }
    return { pivotCol, ratios, minRow, minRatio };
  }

  function buildDual(lp) {
    const isMin = lp.objective === "min";
    const dualObjective = isMin ? "max" : "min";
    const m = lp.constraints.length;
    const n = lp.c.length;

    const dualVarNames = [];
    for (let i = 0; i < m; i++) dualVarNames.push(`y_${i + 1}`);

    const dualC = lp.constraints.map((c) => c.b);
    const dualConstraints = [];
    for (let j = 0; j < n; j++) {
      const a = lp.constraints.map((c) => c.a[j]);
      dualConstraints.push({ a, op: isMin ? "<=" : ">=", b: lp.c[j] });
    }
    const dualVarSigns = lp.constraints.map((c) => {
      if (c.op === "=") return "free";
      if (isMin) return c.op === ">=" ? ">= 0" : "<= 0";
      return c.op === "<=" ? ">= 0" : "<= 0";
    });

    return {
      objective: dualObjective,
      c: dualC,
      varNames: dualVarNames,
      constraints: dualConstraints,
      varSigns: dualVarSigns,
    };
  }

  function fmt(v, digits = 2) {
    if (!isFinite(v)) return v > 0 ? "∞" : "-∞";
    if (Math.abs(v) > 1e5) return v.toExponential(1);
    if (Math.abs(v) < 1e-9) return "0";
    const rounded = Number(v.toFixed(digits));
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(digits);
  }

  function toFraction(v, maxDen = 200) {
    if (!isFinite(v)) return { num: v, den: 1, isInt: false, special: true };
    if (Math.abs(v) < 1e-9) return { num: 0, den: 1, isInt: true };
    const sign = v < 0 ? -1 : 1;
    let x = Math.abs(v);
    let h0 = 0, h1 = 1, k0 = 1, k1 = 0;
    let b = x;
    for (let i = 0; i < 64; i++) {
      const a = Math.floor(b);
      const h2 = a * h1 + h0;
      const k2 = a * k1 + k0;
      if (k2 > maxDen) break;
      h0 = h1; h1 = h2; k0 = k1; k1 = k2;
      if (Math.abs(x - h1 / k1) < 1e-12) break;
      const frac = b - a;
      if (frac < 1e-12) break;
      b = 1 / frac;
      if (!isFinite(b)) break;
    }
    return {
      num: sign * h1,
      den: k1,
      isInt: k1 === 1,
      approx: Math.abs(x - h1 / k1) > 1e-9,
    };
  }

  function sensitivity(state) {
    if (state.status !== "optimal") return null;
    const { T, basis, colTypes, n, m, isMin } = state;
    const cols = T[0].length;
    const dataCols = cols - 1;

    // Sensitivity ranges are only meaningful for the ORIGINAL constraints. After
    // a Gomory/cover cut is applied the tableau gains an extra row, but the user
    // wants to see ranges of their original b_i, not of cut RHSs. starterCol is
    // built once at problem setup and not extended by cuts, so its length gives
    // us the number of original constraints regardless of how many cuts ran.
    const origM = state.starterCol ? state.starterCol.length : m;

    const rhsRanges = [];
    for (let i = 0; i < origM; i++) {
      let starter = state.starterCol[i];
      if (starter < 0) {
        rhsRanges.push({ low: -Infinity, high: Infinity });
        continue;
      }
      // For ≥ starter is artificial (sign +1); for ≤ slack is +1 too.
      const col = [];
      for (let r = 0; r < m; r++) col.push(T[r + 1][starter]);
      let lo = -Infinity, hi = Infinity;
      for (let r = 0; r < m; r++) {
        const v = col[r];
        const xb = T[r + 1][cols - 1];
        if (v > EPS) lo = Math.max(lo, -xb / v);
        else if (v < -EPS) hi = Math.min(hi, -xb / v);
      }
      rhsRanges.push({ low: lo, high: hi });
    }

    const costRanges = [];
    for (let j = 0; j < n; j++) {
      const r = basis.indexOf(j);
      if (r === -1) {
        // Non-basic: for max, c_j can fall to −∞ (stays non-basic) and rise up to
        // current + margin (where margin = z_j − c_j ≥ 0). For min we internally
        // maximize −c_min, so the user-facing range flips: c_min can rise to +∞
        // and fall down to current − margin, i.e. Δc_min ∈ [−margin, +∞).
        const margin = T[0][j];
        costRanges.push({
          low: isMin ? -margin : -Infinity,
          high: isMin ? Infinity : margin,
        });
      } else {
        let lo = -Infinity, hi = Infinity;
        for (let q = 0; q < dataCols; q++) {
          if (basis.indexOf(q) !== -1) continue;
          if (colTypes[q] === "artificial") continue;
          const arq = T[r + 1][q];
          const zq = T[0][q];
          if (arq > EPS) hi = Math.min(hi, zq / arq);
          else if (arq < -EPS) lo = Math.max(lo, zq / arq);
        }
        costRanges.push({ low: isMin ? -hi : lo, high: isMin ? -lo : hi });
      }
    }

    return { rhsRanges, costRanges };
  }

  // ---------- IP support: variable bounds and integrality ----------
  //
  // The simplex algorithm itself stays a pure LP solver. IP support is layered
  // on top: variable upper bounds become extra ≤ constraints (kind="bound");
  // integrality is checked AFTER the relaxation by inspecting decisionPoint().
  // Cuts (gomory/cover) generate additional rows that are appended to the
  // already-optimal tableau, after which dual simplex re-optimizes.

  function defaultBound() { return { kind: "continuous", ub: Infinity }; }

  function ensureBounds(lp) {
    const n = lp.c.length;
    const bounds = (lp.varBounds || []).slice();
    while (bounds.length < n) bounds.push(defaultBound());
    return bounds;
  }

  // Returns LP enriched with upper-bound and binary-bound constraints. The added
  // constraints are tagged { kind: "bound", varIndex } so the UI can style them.
  // For continuous PL (lp.type !== "ilp"), bounds with finite ub still produce
  // constraints — variable bounds aren't IP-only.
  function expandBounds(lp) {
    const bounds = ensureBounds(lp);
    const extras = [];
    for (let j = 0; j < bounds.length; j++) {
      const b = bounds[j];
      const ub = b.kind === "binary" ? 1 : b.ub;
      if (ub !== undefined && isFinite(ub) && ub < Infinity) {
        const a = new Array(lp.c.length).fill(0);
        a[j] = 1;
        extras.push({ a, op: "<=", b: ub, kind: "bound", varIndex: j });
      }
    }
    if (extras.length === 0) {
      return { ...lp, varBounds: bounds, constraints: lp.constraints.slice() };
    }
    return {
      ...lp,
      varBounds: bounds,
      constraints: [...lp.constraints, ...extras],
    };
  }

  function isIntegerVar(lp, j) {
    const bounds = ensureBounds(lp);
    return bounds[j] && (bounds[j].kind === "integer" || bounds[j].kind === "binary");
  }

  function fractionalPart(v) {
    const f = v - Math.floor(v);
    return f;
  }

  // Returns the index of the most-fractional integer-required basic decision
  // variable, or -1 if all integer-required vars are already integer.
  function mostFractionalIntegerVar(state, lp) {
    if (state.status !== "optimal") return -1;
    const sol = currentSolution(state);
    let bestJ = -1, bestDist = 0;
    for (let j = 0; j < lp.c.length; j++) {
      if (!isIntegerVar(lp, j)) continue;
      const name = state.colLabels[j];
      const v = sol[name] || 0;
      const f = fractionalPart(v);
      const dist = Math.min(f, 1 - f);
      if (dist > 1e-7 && dist > bestDist) {
        bestDist = dist;
        bestJ = j;
      }
    }
    return bestJ;
  }

  function isIntegerOptimal(state, lp) {
    if (state.status !== "optimal") return false;
    return mostFractionalIntegerVar(state, lp) === -1;
  }

  // ---------- Dual simplex ----------
  // Used after a cut has been added: the cut row introduces a negative RHS
  // (primal-infeasible) while the z-row stays ≥ 0 (dual-feasible). Dual simplex
  // pivots back to a feasible+optimal state.
  function dualSimplexStep(state) {
    const { T, basis, m, colTypes } = state;
    const cols = T[0].length;

    // Leaving: row with most negative RHS
    let leavingRow = -1, mostNeg = -1e-9;
    for (let i = 0; i < m; i++) {
      const v = T[i + 1][cols - 1];
      if (v < mostNeg) { mostNeg = v; leavingRow = i; }
    }
    if (leavingRow === -1) {
      return { ...state, status: "optimal", note: "optimal", pivot: null };
    }

    // Entering: column j with a_rj < 0, minimum |z_j / a_rj|
    let enterCol = -1, minRatio = Infinity;
    for (let j = 0; j < cols - 1; j++) {
      if (colTypes[j] === "artificial") continue;
      const arj = T[leavingRow + 1][j];
      if (arj < -1e-9) {
        const zj = T[0][j];
        const r = zj / -arj;
        if (r < minRatio - 1e-9) {
          minRatio = r;
          enterCol = j;
        } else if (Math.abs(r - minRatio) < 1e-9 && state.rule === "bland" && enterCol >= 0 && j < enterCol) {
          enterCol = j;
        }
      }
    }
    if (enterCol === -1) {
      return { ...state, status: "infeasible", note: "dual-infeasible", pivot: null };
    }

    // Pivot on (leavingRow, enterCol)
    const newT = T.map((r) => r.slice());
    const pr = leavingRow + 1;
    const piv = newT[pr][enterCol];
    for (let j = 0; j < cols; j++) newT[pr][j] /= piv;
    for (let i = 0; i < newT.length; i++) {
      if (i === pr) continue;
      const factor = newT[i][enterCol];
      if (Math.abs(factor) < 1e-14) continue;
      for (let j = 0; j < cols; j++) newT[i][j] -= factor * newT[pr][j];
    }
    const newBasis = basis.slice();
    const leavingVarIdx = newBasis[leavingRow];
    newBasis[leavingRow] = enterCol;

    return {
      ...state,
      T: newT,
      basis: newBasis,
      iteration: state.iteration + 1,
      pivot: {
        row: leavingRow,
        col: enterCol,
        enterIdx: enterCol,
        leaveIdx: leavingVarIdx,
        enterLabel: state.colLabels[enterCol],
        leaveLabel: state.colLabels[leavingVarIdx],
        ratio: minRatio,
        kind: "dual",
      },
      status: "running",
      note: "dual-pivot",
    };
  }

  // ---------- Gomory cut ----------
  // Adds a Gomory fractional cut derived from the most-fractional integer basic
  // variable. Returns a new state with one extra row (the cut) and one extra
  // column (the cut's slack) — primal-infeasible until dual simplex runs.
  function generateGomoryCut(state, lp) {
    if (state.status !== "optimal") return null;
    const j = mostFractionalIntegerVar(state, lp);
    if (j === -1) return null;
    const basicRow = state.basis.indexOf(j);
    if (basicRow === -1) return null;

    const T = state.T;
    const cols = T[0].length;
    const dataCols = cols - 1;
    const sourceRow = T[basicRow + 1];

    const f_b = sourceRow[cols - 1] - Math.floor(sourceRow[cols - 1]);
    const f_coefs = new Array(dataCols).fill(0);
    for (let q = 0; q < dataCols; q++) {
      // Skip artificials (they should be 0 at optimum and shouldn't re-enter)
      if (state.colTypes[q] === "artificial") continue;
      const aij = sourceRow[q];
      f_coefs[q] = aij - Math.floor(aij);
    }

    return {
      kind: "gomory",
      sourceRow: basicRow,
      sourceVarIdx: j,
      sourceVarLabel: state.colLabels[j],
      f_b,
      f_coefs, // -f_ij coefs go in the cut row; this stores +f_ij for display
      geomConstraint: gomoryCutGeomConstraint(state, lp, f_coefs, f_b),
    };
  }

  // Translate a Gomory cut from tableau-space (decisions + slacks + prior-cut
  // slacks) into decision-variable space, by substituting each slack with the
  // expression of its underlying constraint. The result is a linear inequality
  // Σ A_l x_l ≥ B in the original decision variables — perfect to draw as a
  // line on the 2D feasibility plot.
  //
  // For a slack of a ≤ constraint:  s = b - Σ a'_l x_l
  // For a slack of a ≥ constraint:  s = Σ a'_l x_l - b
  // For a prior cut's slack:        depends on its own geomConstraint:
  //                                   if op="≤":  s = b - Σ a_l x_l
  //                                   if op="≥":  s = Σ a_l x_l - b
  // Artificials are skipped (they're 0 at optimum).
  function gomoryCutGeomConstraint(state, lp, f_coefs, f_b) {
    const n = lp.c.length;
    const dataCols = state.T[0].length - 1;

    // Re-derive the normalized constraints (the way buildLP normalized them: b≥0).
    const normCons = state.originalLP.constraints.map((c) => {
      if (c.b < 0) {
        return {
          a: c.a.map((v) => -v),
          op: c.op === "<=" ? ">=" : c.op === ">=" ? "<=" : "=",
          b: -c.b,
        };
      }
      return { a: c.a.slice(), op: c.op, b: c.b };
    });

    // Map slack-col-index → normalized constraint. Slacks are appended in order
    // of constraint index (only "<=" or ">=" produce a slack).
    const slackColMap = {};
    let slackColCursor = n;
    for (let i = 0; i < normCons.length; i++) {
      const c = normCons[i];
      if (c.op === "<=" || c.op === ">=") {
        slackColMap[slackColCursor] = c;
        slackColCursor++;
      }
    }

    // Map cut-slack-col-index → prior cut (with its geomConstraint already set).
    const prevCuts = state.appliedCuts || [];
    const cutSlackColMap = {};
    let prevIdx = 0;
    for (let q = 0; q < dataCols; q++) {
      if (state.colTypes[q] === "cut-gomory" || state.colTypes[q] === "cut-cover") {
        if (prevIdx < prevCuts.length) {
          cutSlackColMap[q] = prevCuts[prevIdx];
          prevIdx++;
        }
      }
    }

    const A = new Array(n).fill(0);
    let K = 0; // constant term accumulated during substitution
    for (let q = 0; q < dataCols; q++) {
      const f_q = f_coefs[q];
      if (Math.abs(f_q) < 1e-12) continue;
      const ctype = state.colTypes[q];
      if (ctype === "decision") {
        A[q] += f_q;
      } else if (ctype === "slack") {
        const info = slackColMap[q];
        if (!info) continue;
        if (info.op === "<=") {
          K += f_q * info.b;
          for (let l = 0; l < n; l++) A[l] -= f_q * info.a[l];
        } else if (info.op === ">=") {
          K -= f_q * info.b;
          for (let l = 0; l < n; l++) A[l] += f_q * info.a[l];
        }
      } else if (ctype === "cut-gomory" || ctype === "cut-cover") {
        const prev = cutSlackColMap[q];
        if (!prev || !prev.geomConstraint) continue;
        const g = prev.geomConstraint;
        if (g.op === "<=") {
          K += f_q * g.b;
          for (let l = 0; l < n; l++) A[l] -= f_q * g.a[l];
        } else if (g.op === ">=") {
          K -= f_q * g.b;
          for (let l = 0; l < n; l++) A[l] += f_q * g.a[l];
        }
      }
      // artificial: skip (assumed 0 at optimum)
    }
    return { a: A, op: ">=", b: f_b - K };
  }

  // ---------- Cover cut ----------
  // For each ≤ constraint (original LP) with all-positive coefficients on
  // binary vars, look for a minimal cover violated by the current fractional
  // solution. Returns the first one found.
  function generateCoverCut(state, lp) {
    if (state.status !== "optimal") return null;
    const bounds = ensureBounds(lp);
    const binaryVars = [];
    for (let j = 0; j < lp.c.length; j++) {
      if (bounds[j].kind === "binary") binaryVars.push(j);
    }
    if (binaryVars.length === 0) return null;

    const sol = currentSolution(state);
    const xStar = lp.c.map((_, j) => sol[state.colLabels[j]] || 0);

    for (let ci = 0; ci < lp.constraints.length; ci++) {
      const c = lp.constraints[ci];
      if (c.op !== "<=") continue;
      // All coefs on binary vars positive (≥ 0), and at least one positive
      if (binaryVars.some((j) => c.a[j] < 0)) continue;
      if (binaryVars.every((j) => Math.abs(c.a[j]) < 1e-9)) continue;

      // Greedy minimal cover: sort binaries by x*_j desc (and by a_j desc as tiebreak)
      const sorted = binaryVars.slice().sort((a, b) => {
        const dx = xStar[b] - xStar[a];
        if (Math.abs(dx) > 1e-9) return dx;
        return c.a[b] - c.a[a];
      });

      let sumA = 0;
      const cover = [];
      for (const j of sorted) {
        sumA += c.a[j];
        cover.push(j);
        if (sumA > c.b + 1e-9) break;
      }
      if (sumA <= c.b + 1e-9) continue; // not a cover

      // Make it minimal: remove redundant elements while still a cover
      let minimalCover = cover.slice();
      let restart = true;
      while (restart) {
        restart = false;
        for (let k = 0; k < minimalCover.length; k++) {
          const trial = minimalCover.filter((_, idx) => idx !== k);
          const s = trial.reduce((acc, j) => acc + c.a[j], 0);
          if (s > c.b + 1e-9) {
            minimalCover = trial;
            restart = true;
            break;
          }
        }
      }

      // Violated by current fractional solution?
      const lhs = minimalCover.reduce((acc, j) => acc + xStar[j], 0);
      const rhs = minimalCover.length - 1;
      if (lhs > rhs + 1e-7) {
        // Decision-space form: Σ_{j ∈ cover} x_j ≤ |C|−1. Used both as a slack
        // expression for any cascaded Gomory cuts AND to draw the cut as a line.
        const aGeom = new Array(lp.c.length).fill(0);
        for (const j of minimalCover) aGeom[j] = 1;
        return {
          kind: "cover",
          constraintIdx: ci,
          cover: minimalCover.slice(),
          rhs,
          lhsValue: lhs,
          geomConstraint: { a: aGeom, op: "<=", b: rhs },
        };
      }
    }
    return null;
  }

  // ---------- Apply a generated cut to the tableau ----------
  // Returns a new state with an extra row and column. RHS of the new row is
  // negative for Gomory (always) and for violated cover cuts (since the cut is
  // violated by the current solution).
  function applyCutToTableau(state, cut) {
    const T = state.T;
    const oldCols = T[0].length;
    const dataCols = oldCols - 1;
    const newCols = oldCols + 1; // one extra slack col before RHS
    const newSlackIdx = dataCols; // new slack column index

    // Extend every existing row by one column (the new slack); RHS shifts right
    const newT = [];
    for (let r = 0; r < T.length; r++) {
      const row = new Array(newCols).fill(0);
      for (let q = 0; q < dataCols; q++) row[q] = T[r][q];
      row[newSlackIdx] = 0;
      row[newCols - 1] = T[r][oldCols - 1];
      newT.push(row);
    }

    // Build the cut row
    const cutRow = new Array(newCols).fill(0);
    let cutLabel;
    let cutKind;
    if (cut.kind === "gomory") {
      // -f_ij x_j + s_new = -f_b → RHS negative
      for (let q = 0; q < dataCols; q++) cutRow[q] = -cut.f_coefs[q];
      cutRow[newSlackIdx] = 1;
      cutRow[newCols - 1] = -cut.f_b;
      cutLabel = `g${state.basis.length + 1}`;
      cutKind = "cut-gomory";
    } else if (cut.kind === "cover") {
      // Σ_{j∈cover} x_j + s_new = rhs (=|C|-1)
      // But x_j basic in current tableau need substitution to keep tableau in proper form
      for (const j of cut.cover) cutRow[j] = 1;
      cutRow[newSlackIdx] = 1;
      cutRow[newCols - 1] = cut.rhs;
      // Substitute: for each basic var x_j in cover, subtract its row to zero out the coef
      for (let i = 0; i < state.basis.length; i++) {
        const bj = state.basis[i];
        if (cut.cover.includes(bj)) {
          const factor = cutRow[bj]; // == 1
          for (let q = 0; q < newCols; q++) cutRow[q] -= factor * newT[i + 1][q];
        }
      }
      cutLabel = `c${state.basis.length + 1}`;
      cutKind = "cut-cover";
    } else {
      return null;
    }
    newT.push(cutRow);

    // Update metadata: new slack column added before RHS
    const oldLabels = state.colLabels;
    const newColLabels = [
      ...oldLabels.slice(0, -1),
      cutLabel,
      oldLabels[oldLabels.length - 1],
    ];
    const newColTypes = [...state.colTypes, cutKind];
    const newBasis = [...state.basis, newSlackIdx];

    return {
      ...state,
      T: newT,
      basis: newBasis,
      colLabels: newColLabels,
      colTypes: newColTypes,
      m: state.basis.length + 1,
      iteration: state.iteration + 1,
      pivot: null,
      status: "running",
      note: "cut-added",
      lastCut: cut,
      appliedCuts: [...(state.appliedCuts || []), { ...cut, label: cutLabel }],
    };
  }

  // ---------- Detect which cut kinds are applicable at the current state ----------
  function cutsAvailability(state, lp) {
    if (state.status !== "optimal") return { gomory: false, cover: false };
    if (lp.type !== "ilp") return { gomory: false, cover: false };
    const fracVar = mostFractionalIntegerVar(state, lp);
    if (fracVar === -1) return { gomory: false, cover: false };
    const bounds = ensureBounds(lp);
    const allBinary = bounds.slice(0, lp.c.length).every((b) => b.kind === "binary");
    // Cover requires all integer vars to be binary, plus a violated cover exists.
    const coverCut = allBinary ? generateCoverCut(state, lp) : null;
    return {
      gomory: true, // Gomory always works if there's a fractional integer var
      cover: !!coverCut,
    };
  }

  // ---------- Public: apply a cut and run dual simplex until optimum or infeasible ----------
  function applyCut(state, lp, kind) {
    let cut;
    if (kind === "gomory") cut = generateGomoryCut(state, lp);
    else if (kind === "cover") cut = generateCoverCut(state, lp);
    if (!cut) return null;
    let s = applyCutToTableau(state, cut);
    if (!s) return null;
    const states = [snapshot(s)];
    let guard = 200;
    while (s.status === "running" && guard-- > 0) {
      const next = dualSimplexStep(s);
      states.push(snapshot(next));
      s = next;
      if (s.status !== "running") break;
    }
    return states;
  }

  window.Simplex = {
    buildLP,
    pivotStep,
    solve,
    snapshot,
    currentSolution,
    decisionPoint,
    objectiveValue,
    dualValues,
    buildDual,
    sensitivity,
    nextPivotPreview,
    fmt,
    toFraction,
    expandBounds,
    ensureBounds,
    defaultBound,
    isIntegerVar,
    mostFractionalIntegerVar,
    isIntegerOptimal,
    fractionalPart,
    dualSimplexStep,
    generateGomoryCut,
    generateCoverCut,
    applyCutToTableau,
    cutsAvailability,
    applyCut,
  };
})();
