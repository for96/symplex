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
  const MAX_COMPLETION_COMBINATIONS = 20000;

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

  // ---------- Feasibility and affine-system helpers ----------
  function isKnown(v) {
    return typeof v === "number" && isFinite(v);
  }

  function normalizedVector(values, len) {
    const out = new Array(len).fill(null);
    for (let i = 0; i < Math.min(values ? values.length : 0, len); i++) {
      out[i] = isKnown(values[i]) ? values[i] : null;
    }
    return out;
  }

  function vectorComplete(values, len) {
    if (!values || values.length < len) return false;
    for (let i = 0; i < len; i++) {
      if (!isKnown(values[i])) return false;
    }
    return true;
  }

  function knownLinearValue(coefs, values) {
    let total = 0;
    for (let i = 0; i < coefs.length; i++) {
      const a = coefs[i] || 0;
      if (Math.abs(a) < EPS) continue;
      if (!isKnown(values[i])) return null;
      total += a * values[i];
    }
    return cleanZero(total);
  }

  function constraintIssue(index, op, lhs, rhs) {
    if (op === "<=" && lhs > rhs + EPS) return { kind: "violated-constraint", index, op, lhs, rhs };
    if (op === ">=" && lhs < rhs - EPS) return { kind: "violated-constraint", index, op, lhs, rhs };
    if (op === "=" && Math.abs(lhs - rhs) > EPS) return { kind: "violated-constraint", index, op, lhs, rhs };
    return null;
  }

  function primalFeasible(lp, x) {
    const n = lp.c.length;
    const values = normalizedVector(x, n);
    const issues = [];
    const unknown = [];
    for (let j = 0; j < n; j++) {
      if (!isKnown(values[j])) {
        unknown.push({ kind: "var", index: j });
        continue;
      }
      const sign = lp.varSigns ? lp.varSigns[j] : ">= 0";
      if (sign === ">= 0" && values[j] < -EPS) {
        issues.push({ kind: "wrong-sign", index: j, sign, value: values[j] });
      } else if (sign === "<= 0" && values[j] > EPS) {
        issues.push({ kind: "wrong-sign", index: j, sign, value: values[j] });
      }
    }
    for (let i = 0; i < lp.constraints.length; i++) {
      const c = lp.constraints[i];
      const lhs = knownLinearValue(c.a, values);
      if (lhs === null) {
        unknown.push({ kind: "constraint", index: i });
        continue;
      }
      const issue = constraintIssue(i, c.op, lhs, c.b);
      if (issue) issues.push(issue);
    }
    return { ok: issues.length === 0, issues, partial: unknown.length > 0, unknown };
  }

  function dualFeasible(dual, y) {
    const m = dual.c.length;
    const values = normalizedVector(y, m);
    const issues = [];
    const unknown = [];
    for (let i = 0; i < m; i++) {
      if (!isKnown(values[i])) {
        unknown.push({ kind: "var", index: i });
        continue;
      }
      const sign = dual.varSigns[i];
      if (sign === ">= 0" && values[i] < -EPS) {
        issues.push({ kind: "wrong-sign", index: i, sign, value: values[i] });
      } else if (sign === "<= 0" && values[i] > EPS) {
        issues.push({ kind: "wrong-sign", index: i, sign, value: values[i] });
      }
    }
    for (let j = 0; j < dual.constraints.length; j++) {
      const c = dual.constraints[j];
      const lhs = knownLinearValue(c.a, values);
      if (lhs === null) {
        unknown.push({ kind: "constraint", index: j });
        continue;
      }
      const issue = constraintIssue(j, c.op, lhs, c.b);
      if (issue) issues.push(issue);
    }
    return { ok: issues.length === 0, issues, partial: unknown.length > 0, unknown };
  }

  function affineSystem(eqs, numUnknowns) {
    const m = eqs.length;
    if (numUnknowns === 0) {
      const bad = eqs.find((e) => Math.abs(e.rhs || 0) > EPS);
      return bad
        ? { inconsistent: true, lhs: 0, rhs: bad.rhs }
        : { inconsistent: false, rank: 0, dof: 0, particular: [], basis: [], freeCols: [], pivotCols: [] };
    }
    const M = eqs.map((e) => [...e.coefs.map((v) => v || 0), e.rhs || 0]);
    let rank = 0;
    const pivotCols = [];
    for (let col = 0; col < numUnknowns && rank < m; col++) {
      let pivot = rank;
      let pmax = Math.abs(M[rank] ? M[rank][col] : 0);
      for (let r = rank + 1; r < m; r++) {
        if (Math.abs(M[r][col]) > pmax) {
          pmax = Math.abs(M[r][col]);
          pivot = r;
        }
      }
      if (pmax < 1e-10) continue;
      if (pivot !== rank) {
        const tmp = M[rank];
        M[rank] = M[pivot];
        M[pivot] = tmp;
      }
      const piv = M[rank][col];
      for (let c = col; c <= numUnknowns; c++) M[rank][c] /= piv;
      for (let r = 0; r < m; r++) {
        if (r === rank) continue;
        const factor = M[r][col];
        if (Math.abs(factor) < 1e-14) continue;
        for (let c = col; c <= numUnknowns; c++) M[r][c] -= factor * M[rank][c];
      }
      pivotCols.push(col);
      rank++;
    }
    for (let r = rank; r < m; r++) {
      const allZero = M[r].slice(0, numUnknowns).every((v) => Math.abs(v) < EPS);
      if (allZero && Math.abs(M[r][numUnknowns]) > EPS) {
        return { inconsistent: true, lhs: 0, rhs: M[r][numUnknowns] };
      }
    }
    const freeCols = [];
    for (let c = 0; c < numUnknowns; c++) {
      if (!pivotCols.includes(c)) freeCols.push(c);
    }
    const particular = new Array(numUnknowns).fill(0);
    for (let r = 0; r < pivotCols.length; r++) {
      particular[pivotCols[r]] = cleanZero(M[r][numUnknowns]);
    }
    const basis = freeCols.map((fc) => {
      const v = new Array(numUnknowns).fill(0);
      v[fc] = 1;
      for (let r = 0; r < pivotCols.length; r++) {
        v[pivotCols[r]] = cleanZero(-M[r][fc]);
      }
      return v;
    });
    return { inconsistent: false, rank, dof: freeCols.length, particular, basis, freeCols, pivotCols };
  }

  function addLowerBound(range, low) {
    if (low > range.low) range.low = cleanZero(low);
  }

  function addUpperBound(range, high) {
    if (high < range.high) range.high = cleanZero(high);
  }

  function addInequalityRange(range, alpha, beta) {
    // beta + alpha*t >= 0
    if (Math.abs(alpha) < EPS) {
      if (beta < -EPS) range.feasible = false;
      return;
    }
    const bound = -beta / alpha;
    if (alpha > 0) addLowerBound(range, bound);
    else addUpperBound(range, bound);
  }

  function addEqualityRange(range, alpha, beta) {
    // beta + alpha*t = 0
    if (Math.abs(alpha) < EPS) {
      if (Math.abs(beta) > EPS) range.feasible = false;
      return;
    }
    const value = -beta / alpha;
    addLowerBound(range, value);
    addUpperBound(range, value);
  }

  function fullAffineVector(length, unknowns, affine) {
    const base = new Array(length).fill(0);
    const direction = new Array(length).fill(0);
    const dir = affine.basis[0] || new Array(unknowns.length).fill(0);
    for (let k = 0; k < unknowns.length; k++) {
      base[unknowns[k]] = cleanZero(affine.particular[k] || 0);
      direction[unknowns[k]] = cleanZero(dir[k] || 0);
    }
    return { base, direction };
  }

  function parametricRange(kind, lp, dual, unknowns, affine) {
    const length = kind === "primal" ? lp.c.length : dual.c.length;
    const { base, direction } = fullAffineVector(length, unknowns, affine);
    const freeCol = affine.freeCols[0];
    const parameterIndex = unknowns[freeCol];
    const range = {
      kind,
      base,
      direction,
      parameterIndex,
      low: -Infinity,
      high: Infinity,
      feasible: true,
    };

    if (kind === "primal") {
      for (let j = 0; j < lp.c.length; j++) {
        const sign = lp.varSigns ? lp.varSigns[j] : ">= 0";
        if (sign === ">= 0") addInequalityRange(range, direction[j], base[j]);
        else if (sign === "<= 0") addInequalityRange(range, -direction[j], -base[j]);
      }
      for (const c of lp.constraints) {
        const lhsBase = c.a.reduce((s, a, j) => s + a * base[j], 0);
        const lhsDir = c.a.reduce((s, a, j) => s + a * direction[j], 0);
        if (c.op === "<=") addInequalityRange(range, -lhsDir, c.b - lhsBase);
        else if (c.op === ">=") addInequalityRange(range, lhsDir, lhsBase - c.b);
        else addEqualityRange(range, lhsDir, lhsBase - c.b);
      }
    } else {
      for (let i = 0; i < dual.c.length; i++) {
        const sign = dual.varSigns[i];
        if (sign === ">= 0") addInequalityRange(range, direction[i], base[i]);
        else if (sign === "<= 0") addInequalityRange(range, -direction[i], -base[i]);
      }
      for (const c of dual.constraints) {
        const lhsBase = c.a.reduce((s, a, i) => s + a * base[i], 0);
        const lhsDir = c.a.reduce((s, a, i) => s + a * direction[i], 0);
        if (c.op === "<=") addInequalityRange(range, -lhsDir, c.b - lhsBase);
        else if (c.op === ">=") addInequalityRange(range, lhsDir, lhsBase - c.b);
        else addEqualityRange(range, lhsDir, lhsBase - c.b);
      }
    }
    if (range.low > range.high + EPS) range.feasible = false;
    return range;
  }

  function objectiveValue(coefs, values) {
    if (!values || !vectorComplete(values, coefs.length)) return null;
    return cleanZero(coefs.reduce((s, c, i) => s + c * values[i], 0));
  }

  function objectiveRange(coefs, range) {
    if (!range) return null;
    return {
      base: cleanZero(coefs.reduce((s, c, i) => s + c * range.base[i], 0)),
      direction: cleanZero(coefs.reduce((s, c, i) => s + c * range.direction[i], 0)),
    };
  }

  function targetForKnownSide(kind, lp, dual) {
    return kind === "primal" ? lp : dual;
  }

  function targetVarSign(target, index) {
    return target.varSigns && target.varSigns[index] ? target.varSigns[index] : ">= 0";
  }

  function addCompletionRow(model, coefs, op, rhs) {
    const row = coefs.map((v) => cleanZero(v || 0));
    const right = cleanZero(rhs || 0);
    const allZero = row.every((v) => Math.abs(v) < EPS);
    if (allZero) {
      const violated =
        (op === "<=" && 0 > right + EPS) ||
        (op === ">=" && 0 < right - EPS) ||
        (op === "=" && Math.abs(right) > EPS);
      if (violated) model.infeasible = true;
      return;
    }
    if (op === "<=") {
      model.ineqs.push({ coefs: row, rhs: right });
    } else if (op === ">=") {
      model.ineqs.push({ coefs: row.map((v) => -v), rhs: cleanZero(-right) });
    } else {
      model.eqs.push({ coefs: row, rhs: right });
    }
  }

  function buildCompletionModel(kind, lp, dual, values, unknowns) {
    const target = targetForKnownSide(kind, lp, dual);
    const unknownSet = new Set(unknowns);
    const model = {
      kind,
      target,
      values: values.slice(),
      unknowns: unknowns.slice(),
      eqs: [],
      ineqs: [],
      infeasible: false,
      obj: unknowns.map((j) => target.c[j] || 0),
      objConst: 0,
    };

    for (let j = 0; j < target.c.length; j++) {
      if (unknownSet.has(j)) continue;
      model.objConst += (target.c[j] || 0) * (values[j] || 0);
    }

    for (let k = 0; k < unknowns.length; k++) {
      const sign = targetVarSign(target, unknowns[k]);
      const row = new Array(unknowns.length).fill(0);
      row[k] = 1;
      if (sign === ">= 0") addCompletionRow(model, row, ">=", 0);
      else if (sign === "<= 0") addCompletionRow(model, row, "<=", 0);
    }

    for (const c of target.constraints || []) {
      const row = new Array(unknowns.length).fill(0);
      let knownPart = 0;
      for (let j = 0; j < target.c.length; j++) {
        const a = c.a[j] || 0;
        const k = unknowns.indexOf(j);
        if (k >= 0) row[k] = a;
        else knownPart += a * (values[j] || 0);
      }
      addCompletionRow(model, row, c.op, c.b - knownPart);
    }

    return model;
  }

  function completionVector(model, coords) {
    const out = model.values.slice();
    for (let k = 0; k < model.unknowns.length; k++) {
      out[model.unknowns[k]] = cleanZero(coords[k] || 0);
    }
    return out;
  }

  function completionObjective(model, coords) {
    return cleanZero(model.objConst + model.obj.reduce((s, c, k) => s + c * (coords[k] || 0), 0));
  }

  function completionFeasible(model, coords) {
    for (const e of model.eqs) {
      const lhs = e.coefs.reduce((s, c, k) => s + c * (coords[k] || 0), 0);
      if (Math.abs(lhs - e.rhs) > EPS) return false;
    }
    for (const e of model.ineqs) {
      const lhs = e.coefs.reduce((s, c, k) => s + c * (coords[k] || 0), 0);
      if (lhs > e.rhs + EPS) return false;
    }
    return true;
  }

  function combinationCount(n, k) {
    if (k < 0 || k > n) return 0;
    k = Math.min(k, n - k);
    let count = 1;
    for (let i = 1; i <= k; i++) {
      count = (count * (n - k + i)) / i;
      if (count > MAX_COMPLETION_COMBINATIONS) return count;
    }
    return count;
  }

  function forEachCombination(n, k, cb) {
    const picked = [];
    function rec(start) {
      if (picked.length === k) {
        cb(picked.slice());
        return;
      }
      const need = k - picked.length;
      for (let i = start; i <= n - need; i++) {
        picked.push(i);
        rec(i + 1);
        picked.pop();
      }
    }
    rec(0);
  }

  function completionRangeFromAffine(model, affine) {
    if (!affine || affine.dof !== 1) return null;
    const length = model.target.c.length;
    const base = model.values.map((v) => (isKnown(v) ? v : 0));
    const direction = new Array(length).fill(0);
    const dir = affine.basis[0] || new Array(model.unknowns.length).fill(0);
    for (let k = 0; k < model.unknowns.length; k++) {
      base[model.unknowns[k]] = cleanZero(affine.particular[k] || 0);
      direction[model.unknowns[k]] = cleanZero(dir[k] || 0);
    }
    const range = {
      kind: model.kind,
      base,
      direction,
      parameterIndex: model.unknowns[affine.freeCols[0]],
      low: -Infinity,
      high: Infinity,
      feasible: true,
    };
    for (const e of model.ineqs) {
      const lhsBase = e.coefs.reduce((s, c, k) => s + c * (affine.particular[k] || 0), 0);
      const lhsDir = e.coefs.reduce((s, c, k) => s + c * (dir[k] || 0), 0);
      addInequalityRange(range, -lhsDir, e.rhs - lhsBase);
    }
    if (range.low > range.high + EPS) range.feasible = false;
    return range;
  }

  function vectorFromRangeAt(range, t) {
    return range.base.map((v, i) => cleanZero(v + t * (range.direction[i] || 0)));
  }

  function optimizeCompletionModel(model) {
    if (model.infeasible) return { status: "infeasible" };
    const q = model.unknowns.length;
    const sense = model.target.objective;

    if (q === 0) {
      return completionFeasible(model, [])
        ? { status: "unique", values: model.values.slice(), objective: completionObjective(model, []) }
        : { status: "infeasible" };
    }

    const baseAffine = affineSystem(model.eqs, q);
    if (baseAffine.inconsistent) return { status: "infeasible" };

    const need = q - baseAffine.rank;
    const candidates = [];
    function addCandidate(coords) {
      if (!completionFeasible(model, coords)) return;
      candidates.push({
        coords: coords.map(cleanZero),
        values: completionVector(model, coords),
        objective: completionObjective(model, coords),
      });
    }

    if (need === 0) {
      addCandidate(baseAffine.particular);
    } else if (need > 0 && need <= model.ineqs.length && combinationCount(model.ineqs.length, need) <= MAX_COMPLETION_COMBINATIONS) {
      forEachCombination(model.ineqs.length, need, (picked) => {
        const eqs = model.eqs.concat(picked.map((idx) => model.ineqs[idx]));
        const affine = affineSystem(eqs, q);
        if (!affine.inconsistent && affine.dof === 0) addCandidate(affine.particular);
      });
    }

    if (candidates.length > 0) {
      let best = candidates[0].objective;
      for (const c of candidates) {
        if ((sense === "max" && c.objective > best + EPS) || (sense === "min" && c.objective < best - EPS)) {
          best = c.objective;
        }
      }
      const bestCandidates = candidates.filter((c) => Math.abs(c.objective - best) < EPS);
      const optEqs = model.eqs.concat([{ coefs: model.obj.slice(), rhs: best - model.objConst }]);
      const optAffine = affineSystem(optEqs, q);
      if (!optAffine.inconsistent) {
        if (optAffine.dof === 0) {
          const coords = optAffine.particular;
          if (completionFeasible(model, coords)) {
            return { status: "unique", values: completionVector(model, coords), objective: best };
          }
        } else if (optAffine.dof === 1) {
          const range = completionRangeFromAffine(model, optAffine);
          if (range && range.feasible) {
            return { status: "range", range, objective: best };
          }
        }
      }
      if (bestCandidates.length === 1) {
        return { status: "unique", values: bestCandidates[0].values, objective: best };
      }
      return { status: "underdetermined", objective: best };
    }

    if (baseAffine.dof === 1) {
      const range = completionRangeFromAffine(model, baseAffine);
      if (!range || !range.feasible) return { status: "infeasible" };
      const objRange = objectiveRange(model.target.c, range);
      const dir = objRange ? objRange.direction : 0;
      if (Math.abs(dir) < EPS) {
        return { status: "range", range, objective: objRange ? objRange.base : null };
      }
      const chooseHigh = (sense === "max" && dir > 0) || (sense === "min" && dir < 0);
      const t = chooseHigh ? range.high : range.low;
      if (!isFinite(t)) return { status: "unbounded" };
      const values = vectorFromRangeAt(range, t);
      return { status: "unique", values, objective: objectiveValue(model.target.c, values) };
    }

    return { status: "underdetermined" };
  }

  function completeKnownOptimal(kind, lp, dual, rawValues) {
    const target = targetForKnownSide(kind, lp, dual);
    const values = normalizedVector(rawValues, target.c.length);
    const unknowns = [];
    let known = 0;
    for (let i = 0; i < values.length; i++) {
      if (isKnown(values[i])) known++;
      else unknowns.push(i);
    }
    if (unknowns.length === 0 || known === 0) {
      return { status: "skipped", values };
    }
    const model = buildCompletionModel(kind, lp, dual, values, unknowns);
    const result = optimizeCompletionModel(model);
    return { ...result, values: result.values || values, unknowns };
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

  // Complementary-slackness path with support for partial x*/y* inputs and
  // one-parameter ranges.
  function solveDualFromPrimal(lp, dual, xStar) {
    const m = lp.constraints.length;
    const n = lp.c.length;
    const steps = [];
    let x = normalizedVector(xStar, n);

    const feasP = primalFeasible(lp, x);
    steps.push({ kind: "primal-feasibility", feasible: feasP.ok, issues: feasP.issues, partial: feasP.partial });
    if (!feasP.ok) return { steps, ok: false, error: "primal-infeasible" };

    const completion = completeKnownOptimal("primal", lp, dual, x);
    if (completion.status === "unique") {
      x = completion.values;
      steps.push({
        kind: "known-completion",
        side: "primal",
        symbol: "x",
        values: x,
        unknowns: completion.unknowns,
        objective: completion.objective,
      });
    } else if (completion.status === "range") {
      steps.push({
        kind: "known-completion-range",
        side: "primal",
        symbol: "x",
        range: completion.range,
        unknowns: completion.unknowns,
        objective: completion.objective,
      });
    } else if (completion.status === "infeasible" || completion.status === "unbounded") {
      steps.push({ kind: "known-completion-failed", side: "primal", symbol: "x", reason: completion.status });
      return {
        steps,
        ok: false,
        error: completion.status === "infeasible" ? "primal-infeasible" : "underdetermined",
      };
    }

    const primalActive = lp.constraints.map((c, i) => {
      const lhs = knownLinearValue(c.a, x);
      const active = c.op === "=" ? true : lhs === null ? null : Math.abs(lhs - c.b) < EPS;
      return {
        i,
        a: c.a.slice(),
        b: c.b,
        op: c.op,
        lhs,
        active,
        slack: lhs === null ? null : c.op === "<=" ? c.b - lhs : c.op === ">=" ? lhs - c.b : 0,
      };
    });
    steps.push({ kind: "primal-active", constraints: primalActive });

    const yKnownZero = [];
    const yFree = [];
    for (let i = 0; i < m; i++) {
      if (lp.constraints[i].op === "=") yFree.push(i);
      else if (primalActive[i].active === false) yKnownZero.push(i);
      else yFree.push(i);
    }
    steps.push({ kind: "y-zero-from-inactive", zeros: yKnownZero, frees: yFree });

    const xPositive = [];
    const xZero = [];
    const xUnknown = [];
    for (let j = 0; j < n; j++) {
      if (!isKnown(x[j])) xUnknown.push(j);
      else if (Math.abs(x[j]) < EPS) xZero.push(j);
      else xPositive.push(j);
    }
    steps.push({ kind: "x-positive", positive: xPositive, zeros: xZero, unknown: xUnknown });

    const numUnknowns = yFree.length;
    const eqs = [];
    for (const j of xPositive) {
      const row = new Array(numUnknowns).fill(0);
      for (let k = 0; k < numUnknowns; k++) {
        const i = yFree[k];
        row[k] = lp.constraints[i].a[j];
      }
      eqs.push({ coefs: row, rhs: lp.c[j], sourceJ: j });
    }
    steps.push({ kind: "system", eqs, unknowns: yFree, varSymbol: "y", rhsLabel: "c" });

    const affine = affineSystem(eqs, numUnknowns);
    if (affine.inconsistent) {
      steps.push({ kind: "inconsistent", lhs: affine.lhs || 0, rhs: affine.rhs || 0 });
      return { steps, ok: false, error: "inconsistent" };
    }
    if (affine.dof === 0) {
      const y = new Array(m).fill(0);
      for (let k = 0; k < numUnknowns; k++) y[yFree[k]] = affine.particular[k];
      return finishWithDual(lp, dual, y, steps, x);
    }
    if (affine.dof === 1) {
      const range = parametricRange("dual", lp, dual, yFree, affine);
      return finishWithDualRange(lp, dual, range, steps, x);
    }
    steps.push({ kind: "underdetermined", numEq: affine.rank, numUnknowns, dof: affine.dof });
    return { steps, ok: false, error: "underdetermined" };
  }

  function finishWithDual(lp, dual, y, steps, xStar) {
    steps.push({ kind: "solution-dual", y });
    const feasD = dualFeasible(dual, y);
    steps.push({ kind: "dual-feasibility", feasible: feasD.ok, issues: feasD.issues });
    steps.push({ kind: "objective-values", z: objectiveValue(lp.c, xStar), w: objectiveValue(dual.c, y) });
    return { steps, ok: feasD.ok, y };
  }

  function finishWithDualRange(lp, dual, range, steps, xStar) {
    steps.push({ kind: "solution-dual-range", range });
    steps.push({ kind: "dual-feasibility", feasible: range.feasible, issues: [], parametric: true });
    const wRange = objectiveRange(dual.c, range);
    steps.push({
      kind: "objective-values",
      z: objectiveValue(lp.c, xStar),
      w: wRange ? wRange.base : null,
      wDir: wRange ? wRange.direction : 0,
      param: { symbol: "y", index: range.parameterIndex },
    });
    return { steps, ok: range.feasible, yRange: range };
  }

  function solvePrimalFromDual(lp, dual, yStar) {
    const m = lp.constraints.length;
    const n = lp.c.length;
    const steps = [];
    let y = normalizedVector(yStar, m);

    const feasD = dualFeasible(dual, y);
    steps.push({ kind: "dual-feasibility", feasible: feasD.ok, issues: feasD.issues, partial: feasD.partial });
    if (!feasD.ok) return { steps, ok: false, error: "dual-infeasible" };

    const completion = completeKnownOptimal("dual", lp, dual, y);
    if (completion.status === "unique") {
      y = completion.values;
      steps.push({
        kind: "known-completion",
        side: "dual",
        symbol: "y",
        values: y,
        unknowns: completion.unknowns,
        objective: completion.objective,
      });
    } else if (completion.status === "range") {
      steps.push({
        kind: "known-completion-range",
        side: "dual",
        symbol: "y",
        range: completion.range,
        unknowns: completion.unknowns,
        objective: completion.objective,
      });
    } else if (completion.status === "infeasible" || completion.status === "unbounded") {
      steps.push({ kind: "known-completion-failed", side: "dual", symbol: "y", reason: completion.status });
      return {
        steps,
        ok: false,
        error: completion.status === "infeasible" ? "dual-infeasible" : "underdetermined",
      };
    }

    const dualActive = dual.constraints.map((c, j) => {
      const lhs = knownLinearValue(c.a, y);
      const active = c.op === "=" ? true : lhs === null ? null : Math.abs(lhs - c.b) < EPS;
      return {
        j,
        a: c.a.slice(),
        b: c.b,
        op: c.op,
        lhs,
        active,
        slack: lhs === null ? null : c.op === "<=" ? c.b - lhs : c.op === ">=" ? lhs - c.b : 0,
      };
    });
    steps.push({ kind: "dual-active", constraints: dualActive });

    const xKnownZero = [];
    const xFree = [];
    for (let j = 0; j < n; j++) {
      if (dualActive[j].active === false) xKnownZero.push(j);
      else xFree.push(j);
    }
    steps.push({ kind: "x-zero-from-inactive", zeros: xKnownZero, frees: xFree });

    const yPositive = [];
    const yZero = [];
    const yUnknown = [];
    for (let i = 0; i < m; i++) {
      if (!isKnown(y[i])) yUnknown.push(i);
      else if (Math.abs(y[i]) < EPS) yZero.push(i);
      else yPositive.push(i);
    }
    steps.push({ kind: "y-positive", positive: yPositive, zeros: yZero, unknown: yUnknown });

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
    steps.push({ kind: "system", eqs, unknowns: xFree, varSymbol: "x", rhsLabel: "b" });

    const affine = affineSystem(eqs, numUnknowns);
    if (affine.inconsistent) {
      steps.push({ kind: "inconsistent", lhs: affine.lhs || 0, rhs: affine.rhs || 0 });
      return { steps, ok: false, error: "inconsistent" };
    }
    if (affine.dof === 0) {
      const x = new Array(n).fill(0);
      for (let k = 0; k < numUnknowns; k++) x[xFree[k]] = affine.particular[k];
      return finishWithPrimal(lp, dual, x, steps, y);
    }
    if (affine.dof === 1) {
      const range = parametricRange("primal", lp, dual, xFree, affine);
      return finishWithPrimalRange(lp, dual, range, steps, y);
    }
    steps.push({ kind: "underdetermined", numEq: affine.rank, numUnknowns, dof: affine.dof });
    return { steps, ok: false, error: "underdetermined" };
  }

  function finishWithPrimal(lp, dual, x, steps, yStar) {
    steps.push({ kind: "solution-primal", x });
    const feasP = primalFeasible(lp, x);
    steps.push({ kind: "primal-feasibility-final", feasible: feasP.ok, issues: feasP.issues });
    steps.push({ kind: "objective-values", z: objectiveValue(lp.c, x), w: objectiveValue(dual.c, yStar) });
    return { steps, ok: feasP.ok, x };
  }

  function finishWithPrimalRange(lp, dual, range, steps, yStar) {
    steps.push({ kind: "solution-primal-range", range });
    steps.push({ kind: "primal-feasibility-final", feasible: range.feasible, issues: [], parametric: true });
    const zRange = objectiveRange(lp.c, range);
    steps.push({
      kind: "objective-values",
      z: zRange ? zRange.base : null,
      zDir: zRange ? zRange.direction : 0,
      w: objectiveValue(dual.c, yStar),
      param: { symbol: "x", index: range.parameterIndex },
    });
    return { steps, ok: range.feasible, xRange: range };
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
