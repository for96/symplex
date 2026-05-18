// 2D geometry helpers — feasible region, vertices, level sets.
(function () {
  "use strict";
  // Why: geometry works on user-typed coefficients (small, exact-ish numbers),
  // not the long pivot chain of simplex.js. A looser EPS (1e-7) avoids spurious
  // vertex rejections from minor float drift on otherwise-clean intercepts.
  const EPS = 1e-7;

  function lineIntersect(a1, b1, c1, a2, b2, c2) {
    const det = a1 * b2 - a2 * b1;
    // Why: 1e-12 is a determinant test (product of two coefficient magnitudes),
    // not a coordinate test — much tighter than EPS so we still detect truly
    // parallel lines without rejecting near-parallel-but-distinct ones.
    if (Math.abs(det) < 1e-12) return null;
    return {
      x: (c1 * b2 - c2 * b1) / det,
      y: (a1 * c2 - a2 * c1) / det,
    };
  }

  // Why: 1e-6 is the user-visible feasibility slack — looser than EPS because
  // axis-intercept points often land slightly off a constraint due to division.
  function isFeasible(p, lp, tol = 1e-6) {
    if (p.x < -tol || p.y < -tol) return false;
    for (const c of lp.constraints) {
      const v = c.a[0] * p.x + c.a[1] * p.y;
      if (c.op === "<=" && v > c.b + tol) return false;
      if (c.op === ">=" && v < c.b - tol) return false;
      if (c.op === "=" && Math.abs(v - c.b) > tol) return false;
    }
    return true;
  }

  function vertices(lp) {
    if (lp.c.length !== 2) return [];
    const lines = [
      ...lp.constraints.map((c, i) => ({
        a: c.a[0],
        b: c.a[1],
        c: c.b,
        idx: i,
        kind: "constraint",
      })),
      { a: 1, b: 0, c: 0, idx: -1, kind: "axis-y" },
      { a: 0, b: 1, c: 0, idx: -2, kind: "axis-x" },
    ];
    const verts = [];
    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        const p = lineIntersect(
          lines[i].a,
          lines[i].b,
          lines[i].c,
          lines[j].a,
          lines[j].b,
          lines[j].c,
        );
        if (!p) continue;
        if (!isFinite(p.x) || !isFinite(p.y)) continue;
        if (!isFeasible(p, lp)) continue;
        // Why: 1e-5 (deliberately looser than the feasibility tol) merges
        // intersections that geometrically coincide but compute with slight
        // drift — typical when three constraints meet at one degenerate vertex.
        const dup = verts.find(
          (v) => Math.abs(v.x - p.x) < 1e-5 && Math.abs(v.y - p.y) < 1e-5,
        );
        if (dup) {
          dup.lines.push(lines[i], lines[j]);
          continue;
        }
        verts.push({ ...p, lines: [lines[i], lines[j]] });
      }
    }
    if (verts.length === 0) return [];
    const cx = verts.reduce((s, p) => s + p.x, 0) / verts.length;
    const cy = verts.reduce((s, p) => s + p.y, 0) / verts.length;
    verts.sort(
      (a, b) =>
        Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx),
    );
    return verts;
  }

  function bounds(lp) {
    const v = vertices(lp);
    let xmax = 6;
    let ymax = 6;
    if (v.length) {
      xmax = Math.max(...v.map((p) => p.x));
      ymax = Math.max(...v.map((p) => p.y));
    }
    // also factor in axis intercepts of constraints
    for (const c of lp.constraints) {
      if (Math.abs(c.a[0]) > EPS) xmax = Math.max(xmax, Math.abs(c.b / c.a[0]));
      if (Math.abs(c.a[1]) > EPS) ymax = Math.max(ymax, Math.abs(c.b / c.a[1]));
    }
    xmax = xmax * 1.25 + 1;
    ymax = ymax * 1.25 + 1;
    const span = Math.max(xmax, ymax);
    return { xmin: -span * 0.08, ymin: -span * 0.08, xmax, ymax };
  }

  // Clip a line a*x + b*y = c to bounds; returns two endpoints inside the viewbox.
  function clipLine(a, b, c, bb) {
    const pts = [];
    if (Math.abs(b) > EPS) {
      // intersect with x = xmin, x = xmax
      [bb.xmin, bb.xmax].forEach((x) => {
        const y = (c - a * x) / b;
        if (y >= bb.ymin - EPS && y <= bb.ymax + EPS) pts.push({ x, y });
      });
    }
    if (Math.abs(a) > EPS) {
      [bb.ymin, bb.ymax].forEach((y) => {
        const x = (c - b * y) / a;
        if (x >= bb.xmin - EPS && x <= bb.xmax + EPS) pts.push({ x, y });
      });
    }
    if (pts.length < 2) return null;
    return [pts[0], pts[pts.length - 1]];
  }

  window.Geom = { vertices, isFeasible, bounds, clipLine, lineIntersect };
})();
