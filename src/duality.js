// Duality logic — separate from the simplex code path. Implements:
//   - a small linear-system solver (partial-pivot Gaussian elimination)
//   - complementary-slackness analysis: given a primal LP and a candidate x*,
//     identify active/inactive primal constraints and zero/free dual vars,
//     build the resulting square linear system, solve for y*, and verify
//     dual feasibility (and vice versa for known y* → derive x*).
//
// Used by the "Dualità" workspace to walk a student through chapter-4-style
// exercises ("risolvere senza simplesso", "ortogonalità e sensitività").
//
// The primal LP shape this module handles is the standard form the rest of
// the app uses: c, constraints[{a,op,b}], objective ∈ {max,min}, with x ≥ 0.
// Equality constraints are supported (the corresponding dual var is "free").
(function () {
  "use strict";

  // Why: looser than simplex EPS — the user types fractions like 20/3
  // (≈ 6.6667) which may carry 1e-5 round-off; we want activeness to register.
  const EPS = 1e-6;

  // ---------- Linear system solve ----------
  // Solves Ax = b for a square (n×n) A using partial-pivot Gaussian
  // elimination. Returns { x } on success, { x: null, singular: true } if A
  // is singular, or { error: "<reason>" } for bad input.
  function solveSystem(A, b) {
    const n = A.length;
    if (n === 0) return { x: [], singular: false };
    if (A.some((r) => r.length !== n)) return { error: "non-square" };
    if (b.length !== n) return { error: "dim-mismatch" };

    const M = A.map((row, i) => [...row, b[i]]);
    let rank = 0;
    for (let col = 0; col < n; col++) {
      let pivot = rank;
      let pmax = Math.abs(M[rank] ? M[rank][col] : 0);
      for (let i = rank + 1; i < n; i++) {
        if (Math.abs(M[i][col]) > pmax) {
          pmax = Math.abs(M[i][col]);
          pivot = i;
        }
      }
      if (pmax < 1e-12) continue;
      if (pivot !== rank) {
        const tmp = M[rank];
        M[rank] = M[pivot];
        M[pivot] = tmp;
      }
      const piv = M[rank][col];
      for (let j = col; j <= n; j++) M[rank][j] /= piv;
      for (let i = 0; i < n; i++) {
        if (i === rank) continue;
        const factor = M[i][col];
        if (Math.abs(factor) < 1e-14) continue;
        for (let j = col; j <= n; j++) M[i][j] -= factor * M[rank][j];
      }
      rank++;
      if (rank === n) break;
    }
    if (rank < n) return { x: null, singular: true };
    const x = new Array(n).fill(0);
    for (let i = 0; i < n; i++) x[i] = M[i][n];
    return { x, singular: false };
  }

  // ---------- Feasibility checks ----------
  function primalFeasible(lp, x) {
    const issues = [];
    for (let j = 0; j < x.length; j++) {
      const sign = lp.varSigns ? lp.varSigns[j] : ">= 0";
      if (sign === ">= 0" && x[j] < -EPS) {
        issues.push({ kind: "wrong-sign", index: j, sign, value: x[j] });
      } else if (sign === "<= 0" && x[j] > EPS) {
        issues.push({ kind: "wrong-sign", index: j, sign, value: x[j] });
      }
    }
    for (let i = 0; i < lp.constraints.length; i++) {
      const c = lp.constraints[i];
      const lhs = c.a.reduce((s, a, j) => s + a * x[j], 0);
      if (c.op === "<=" && lhs > c.b + EPS) {
        issues.push({ kind: "violated-constraint", index: i, op: c.op, lhs, rhs: c.b });
      } else if (c.op === ">=" && lhs < c.b - EPS) {
        issues.push({ kind: "violated-constraint", index: i, op: c.op, lhs, rhs: c.b });
      } else if (c.op === "=" && Math.abs(lhs - c.b) > EPS) {
        issues.push({ kind: "violated-constraint", index: i, op: c.op, lhs, rhs: c.b });
      }
    }
    return { ok: issues.length === 0, issues };
  }

  function dualFeasible(dual, y) {
    const issues = [];
    for (let i = 0; i < y.length; i++) {
      const sign = dual.varSigns[i];
      if (sign === ">= 0" && y[i] < -EPS) {
        issues.push({ kind: "wrong-sign", index: i, sign, value: y[i] });
      } else if (sign === "<= 0" && y[i] > EPS) {
        issues.push({ kind: "wrong-sign", index: i, sign, value: y[i] });
      }
    }
    for (let j = 0; j < dual.constraints.length; j++) {
      const c = dual.constraints[j];
      const lhs = c.a.reduce((s, a, i) => s + a * y[i], 0);
      if (c.op === "<=" && lhs > c.b + EPS) {
        issues.push({ kind: "violated-constraint", index: j, op: c.op, lhs, rhs: c.b });
      } else if (c.op === ">=" && lhs < c.b - EPS) {
        issues.push({ kind: "violated-constraint", index: j, op: c.op, lhs, rhs: c.b });
      } else if (c.op === "=" && Math.abs(lhs - c.b) > EPS) {
        issues.push({ kind: "violated-constraint", index: j, op: c.op, lhs, rhs: c.b });
      }
    }
    return { ok: issues.length === 0, issues };
  }

  // ---------- Complementary-slackness solver ----------
  // Given primal LP + dual + candidate x*, derive y* by:
  //   1. checking primal feasibility of x*;
  //   2. for each primal constraint i, classify "active" (a_i·x = b_i) or
  //      "inactive" (slack present). For an inactive ≤/≥ constraint, y_i = 0;
  //      for an equality constraint, y_i is always free.
  //   3. for each j with x_j > 0, the j-th dual constraint must be active:
  //      Σ_i a_{i,j} y_i = c_j.
  //   4. solve the resulting linear system for the free y_i's.
  //   5. plug in and verify dual feasibility (sign + non-active dual constrs).
  function solveDualFromPrimal(lp, dual, xStar) {
    const m = lp.constraints.length;
    const n = lp.c.length;
    const steps = [];

    const feasP = primalFeasible(lp, xStar);
    steps.push({ kind: "primal-feasibility", feasible: feasP.ok, issues: feasP.issues });
    if (!feasP.ok) return { steps, ok: false, error: "primal-infeasible" };

    const primalActive = lp.constraints.map((c, i) => {
      const lhs = c.a.reduce((s, a, j) => s + a * xStar[j], 0);
      return {
        i,
        a: c.a.slice(),
        b: c.b,
        op: c.op,
        lhs,
        active: c.op === "=" ? true : Math.abs(lhs - c.b) < EPS,
        slack: c.op === "<=" ? c.b - lhs : c.op === ">=" ? lhs - c.b : 0,
      };
    });
    steps.push({ kind: "primal-active", constraints: primalActive });

    const yKnownZero = [];
    const yFree = [];
    for (let i = 0; i < m; i++) {
      // Equality → y_i free; inequality but not active → y_i = 0; active → free
      if (lp.constraints[i].op === "=") yFree.push(i);
      else if (!primalActive[i].active) yKnownZero.push(i);
      else yFree.push(i);
    }
    steps.push({ kind: "y-zero-from-inactive", zeros: yKnownZero, frees: yFree });

    const xPositive = [];
    const xZero = [];
    for (let j = 0; j < n; j++) {
      if (Math.abs(xStar[j]) < EPS) xZero.push(j);
      else xPositive.push(j);
    }
    steps.push({ kind: "x-positive", positive: xPositive, zeros: xZero });

    const numUnknowns = yFree.length;
    // Equations from x_j > 0: Σ_i a_{i,j} y_i = c_j; restricted to y_i free.
    // Known-zero y_i's contribute 0 and can be omitted.
    const eqs = [];
    for (const j of xPositive) {
      const row = new Array(numUnknowns).fill(0);
      for (let k = 0; k < numUnknowns; k++) {
        const i = yFree[k];
        row[k] = lp.constraints[i].a[j];
      }
      eqs.push({ coefs: row, rhs: lp.c[j], sourceJ: j });
    }
    steps.push({
      kind: "system",
      eqs,
      unknowns: yFree,
      varSymbol: "y",
      rhsLabel: "c",
    });

    if (numUnknowns === 0) {
      // All y_i are known to be zero — y* = 0.
      const y = new Array(m).fill(0);
      return finishWithDual(lp, dual, y, steps, eqs, xStar);
    }

    if (eqs.length === 0) {
      // No equations → free yFree variables; underdetermined.
      steps.push({ kind: "underdetermined", numEq: 0, numUnknowns });
      return { steps, ok: false, error: "underdetermined" };
    }

    if (eqs.length < numUnknowns) {
      steps.push({ kind: "underdetermined", numEq: eqs.length, numUnknowns });
      return { steps, ok: false, error: "underdetermined" };
    }

    const A = eqs.slice(0, numUnknowns).map((e) => e.coefs);
    const bs = eqs.slice(0, numUnknowns).map((e) => e.rhs);
    const sol = solveSystem(A, bs);
    if (sol.error || sol.singular) {
      steps.push({ kind: "system-error", error: sol.error || "singular" });
      return { steps, ok: false, error: "system-error" };
    }
    // Verify any remaining equations (overdetermined consistent or not)
    for (let k = numUnknowns; k < eqs.length; k++) {
      const lhs = eqs[k].coefs.reduce((s, a, kk) => s + a * sol.x[kk], 0);
      if (Math.abs(lhs - eqs[k].rhs) > EPS) {
        steps.push({ kind: "inconsistent", eqIdx: k, lhs, rhs: eqs[k].rhs });
        return { steps, ok: false, error: "inconsistent" };
      }
    }
    const y = new Array(m).fill(0);
    for (let k = 0; k < numUnknowns; k++) y[yFree[k]] = sol.x[k];
    return finishWithDual(lp, dual, y, steps, eqs, xStar);
  }

  function finishWithDual(lp, dual, y, steps, eqs, xStar) {
    steps.push({ kind: "solution-dual", y });
    const feasD = dualFeasible(dual, y);
    steps.push({ kind: "dual-feasibility", feasible: feasD.ok, issues: feasD.issues });

    // Objective values
    const zVal = computeObjective(lp, xStar);
    const wVal = dual.c.reduce((s, c, i) => s + c * y[i], 0);
    steps.push({ kind: "objective-values", z: zVal, w: wVal });
    return { steps, ok: feasD.ok, y };
  }

  function getPrimalXFromSteps(steps) {
    // Recover x from the primal-feasibility check input. We didn't store x
    // directly, but it was passed in by the caller. The simpler path: the
    // caller is the one who has x — but for the convenience of this helper
    // we extract from the primal-active step (each row has lhs = a·x, so we
    // can reconstruct only collectively). Instead, just return null and rely
    // on the caller for z*.
    return null;
  }

  function computeObjective(lp, x) {
    if (!x) return null;
    return lp.c.reduce((s, c, j) => s + c * x[j], 0);
  }

  // Given a candidate y*, derive x* via complementary slackness.
  // Symmetric to solveDualFromPrimal.
  function solvePrimalFromDual(lp, dual, yStar) {
    const m = lp.constraints.length;
    const n = lp.c.length;
    const steps = [];

    const feasD = dualFeasible(dual, yStar);
    steps.push({ kind: "dual-feasibility", feasible: feasD.ok, issues: feasD.issues });
    if (!feasD.ok) return { steps, ok: false, error: "dual-infeasible" };

    const dualActive = dual.constraints.map((c, j) => {
      const lhs = c.a.reduce((s, a, i) => s + a * yStar[i], 0);
      return {
        j,
        a: c.a.slice(),
        b: c.b,
        op: c.op,
        lhs,
        active: Math.abs(lhs - c.b) < EPS,
        slack: c.op === "<=" ? c.b - lhs : c.op === ">=" ? lhs - c.b : 0,
      };
    });
    steps.push({ kind: "dual-active", constraints: dualActive });

    const xKnownZero = [];
    const xFree = [];
    for (let j = 0; j < n; j++) {
      if (!dualActive[j].active) xKnownZero.push(j);
      else xFree.push(j);
    }
    steps.push({ kind: "x-zero-from-inactive", zeros: xKnownZero, frees: xFree });

    const yPositive = [];
    const yZero = [];
    for (let i = 0; i < m; i++) {
      if (Math.abs(yStar[i]) < EPS) yZero.push(i);
      else yPositive.push(i);
    }
    steps.push({ kind: "y-positive", positive: yPositive, zeros: yZero });

    // Active primal constraints to solve: every i with y_i > 0, plus every
    // equality constraint (always active).
    const activeI = new Set(yPositive);
    for (let i = 0; i < m; i++) {
      if (lp.constraints[i].op === "=") activeI.add(i);
    }
    const activeList = Array.from(activeI).sort((a, b) => a - b);

    const numUnknowns = xFree.length;
    const eqs = [];
    for (const i of activeList) {
      const row = new Array(numUnknowns).fill(0);
      for (let k = 0; k < numUnknowns; k++) {
        const j = xFree[k];
        row[k] = lp.constraints[i].a[j];
      }
      eqs.push({ coefs: row, rhs: lp.constraints[i].b, sourceI: i });
    }
    steps.push({
      kind: "system",
      eqs,
      unknowns: xFree,
      varSymbol: "x",
      rhsLabel: "b",
    });

    if (numUnknowns === 0) {
      const x = new Array(n).fill(0);
      return finishWithPrimal(lp, dual, x, steps, yStar);
    }

    if (eqs.length < numUnknowns) {
      steps.push({ kind: "underdetermined", numEq: eqs.length, numUnknowns });
      return { steps, ok: false, error: "underdetermined" };
    }

    const A = eqs.slice(0, numUnknowns).map((e) => e.coefs);
    const bs = eqs.slice(0, numUnknowns).map((e) => e.rhs);
    const sol = solveSystem(A, bs);
    if (sol.error || sol.singular) {
      steps.push({ kind: "system-error", error: sol.error || "singular" });
      return { steps, ok: false, error: "system-error" };
    }
    for (let k = numUnknowns; k < eqs.length; k++) {
      const lhs = eqs[k].coefs.reduce((s, a, kk) => s + a * sol.x[kk], 0);
      if (Math.abs(lhs - eqs[k].rhs) > EPS) {
        steps.push({ kind: "inconsistent", eqIdx: k, lhs, rhs: eqs[k].rhs });
        return { steps, ok: false, error: "inconsistent" };
      }
    }
    const x = new Array(n).fill(0);
    for (let k = 0; k < numUnknowns; k++) x[xFree[k]] = sol.x[k];
    return finishWithPrimal(lp, dual, x, steps, yStar);
  }

  function finishWithPrimal(lp, dual, x, steps, yStar) {
    steps.push({ kind: "solution-primal", x });
    const feasP = primalFeasible(lp, x);
    steps.push({ kind: "primal-feasibility-final", feasible: feasP.ok, issues: feasP.issues });
    const zVal = lp.c.reduce((s, c, j) => s + c * x[j], 0);
    // Keep the step data complete for callers outside the React view too.
    // (caller passes yStar — we don't have direct access; compute later in view).
    const wVal = yStar ? dual.c.reduce((s, c, i) => s + c * yStar[i], 0) : null;
    steps.push({ kind: "objective-values", z: zVal, w: wVal });
    return { steps, ok: feasP.ok, x };
  }

  function cleanZero(v) {
    return Math.abs(v) < EPS ? 0 : v;
  }

  function rankOfColumns(columns, m) {
    if (columns.length === 0) return 0;
    const A = new Array(m).fill(0).map((_, r) => columns.map((col) => col[r]));
    let rank = 0;
    const n = columns.length;
    for (let col = 0; col < n; col++) {
      let pivot = rank;
      let pmax = Math.abs(A[rank] ? A[rank][col] : 0);
      for (let r = rank + 1; r < m; r++) {
        if (Math.abs(A[r][col]) > pmax) {
          pmax = Math.abs(A[r][col]);
          pivot = r;
        }
      }
      if (pmax < 1e-10) continue;
      if (pivot !== rank) {
        const tmp = A[rank];
        A[rank] = A[pivot];
        A[pivot] = tmp;
      }
      const piv = A[rank][col];
      for (let j = col; j < n; j++) A[rank][j] /= piv;
      for (let r = 0; r < m; r++) {
        if (r === rank) continue;
        const factor = A[r][col];
        if (Math.abs(factor) < 1e-14) continue;
        for (let j = col; j < n; j++) A[r][j] -= factor * A[rank][j];
      }
      rank++;
      if (rank === m) break;
    }
    return rank;
  }

  function rowsFromColumns(columns, m) {
    return new Array(m).fill(0).map((_, r) => columns.map((col) => col[r]));
  }

  function standardColumns(lp, xStar) {
    const m = lp.constraints.length;
    const n = lp.c.length;
    const lhs = lp.constraints.map((c) => c.a.reduce((s, a, j) => s + a * (xStar[j] || 0), 0));
    const cols = [];
    for (let j = 0; j < n; j++) {
      cols.push({
        kind: "decision",
        index: j,
        label: (lp.varNames && lp.varNames[j]) || `x${j + 1}`,
        value: cleanZero(xStar[j] || 0),
        col: lp.constraints.map((c) => c.a[j]),
      });
    }
    for (let i = 0; i < m; i++) {
      const c = lp.constraints[i];
      if (c.op === "=") continue;
      const sign = c.op === "<=" ? 1 : -1;
      const slack = c.op === "<=" ? c.b - lhs[i] : lhs[i] - c.b;
      const col = new Array(m).fill(0);
      col[i] = sign;
      cols.push({
        kind: "slack",
        index: i,
        label: `s${i + 1}`,
        value: cleanZero(slack),
        col,
      });
    }
    return { cols, lhs };
  }

  function inferBasis(lp, xStar) {
    const m = lp.constraints.length;
    const signs = lp.varSigns || new Array(lp.c.length).fill(">= 0");
    if (signs.some((s) => s !== ">= 0")) return { error: "unsupported-var-signs" };
    const { cols } = standardColumns(lp, xStar);
    const positive = cols.filter((c) => c.value > EPS);
    if (positive.length > m) return { error: "not-a-bfs" };

    const basis = [];
    let rank = 0;
    for (const c of positive) {
      const nextRank = rankOfColumns([...basis.map((b) => b.col), c.col], m);
      if (nextRank <= rank) return { error: "dependent-positive" };
      basis.push(c);
      rank = nextRank;
    }

    let degenerate = basis.length < m;
    for (const c of cols) {
      if (basis.length === m) break;
      if (basis.includes(c)) continue;
      const nextRank = rankOfColumns([...basis.map((b) => b.col), c.col], m);
      if (nextRank > rank) {
        basis.push(c);
        rank = nextRank;
      }
    }
    if (basis.length < m) return { error: "no-basis" };
    return { basis, degenerate };
  }

  // ---------- RHS sensitivity from x* and y* ----------
  // Slide procedure: the current basis B stays optimal while it stays feasible,
  // so for each single RHS perturbation b_i -> b_i + delta we solve
  // x_B + delta * B^-1 e_i >= 0.
  function rhsSensitivity(lp, xStar, yStar) {
    const m = lp.constraints.length;
    if (!xStar || xStar.length !== lp.c.length) return { ok: false, reason: "missing-primal" };
    const inferred = inferBasis(lp, xStar);
    if (inferred.error) return { ok: false, reason: inferred.error };

    const basis = inferred.basis;
    const B = rowsFromColumns(basis.map((c) => c.col), m);
    const b = lp.constraints.map((c) => c.b);
    const xbSol = solveSystem(B, b);
    if (xbSol.error || xbSol.singular) return { ok: false, reason: "singular-basis" };

    const ranges = [];
    for (let i = 0; i < m; i++) {
      const e = new Array(m).fill(0);
      e[i] = 1;
      const colSol = solveSystem(B, e);
      if (colSol.error || colSol.singular) return { ok: false, reason: "singular-basis" };
      let low = -Infinity;
      let high = Infinity;
      for (let r = 0; r < m; r++) {
        const v = colSol.x[r];
        const xb = xbSol.x[r];
        if (v > EPS) low = Math.max(low, -xb / v);
        else if (v < -EPS) high = Math.min(high, -xb / v);
      }
      ranges.push({
        low,
        high,
        b: lp.constraints[i].b,
        dualValue: yStar && yStar.length > i ? yStar[i] : null,
        column: colSol.x.slice(),
      });
    }

    return {
      ok: true,
      ranges,
      basis: basis.map((c) => ({ kind: c.kind, index: c.index, label: c.label, value: c.value })),
      degenerate: inferred.degenerate,
    };
  }

  window.Duality = {
    solveSystem,
    primalFeasible,
    dualFeasible,
    solveDualFromPrimal,
    solvePrimalFromDual,
    rhsSensitivity,
  };
})();
