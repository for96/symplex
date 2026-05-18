/* global React, Geom, Simplex */
// 2D geometric visualization — feasible region, constraints, level curves, gradient, vertex path.
// Switch between primal and dual (when the dual is 2D-representable).

const { useMemo: useMemoG, useRef: useRefG, useEffect: useEffectG, useState: useStateG } = React;

// Build a dual LP suitable for the 2D Geom helpers: any var with sign "≤ 0" is negated
// so all axes can be drawn in the non-negative quadrant. Label the axes accordingly.
function buildDualGeomLP(primalLP) {
  const d = Simplex.buildDual(primalLP);
  if (d.c.length !== 2) return null;
  // Free vars not supported in 2D quadrant visualization
  if (d.varSigns.some((s) => s === "free")) return null;

  const flip = d.varSigns.map((s) => s === "<= 0");
  const newC = d.c.map((v, i) => (flip[i] ? -v : v));
  const newCons = d.constraints.map((c) => ({
    a: c.a.map((v, i) => (flip[i] ? -v : v)),
    op: c.op,
    b: c.b,
  }));
  const newNames = d.varNames.map((n, i) => (flip[i] ? `-${n}` : n));
  return {
    objective: d.objective,
    c: newC,
    constraints: newCons,
    varNames: newNames,
    flipMask: flip,
    origVarNames: d.varNames.slice(),
    varSigns: d.varSigns.slice(),
  };
}

function GeometryView({ lp, state, history, step, t, tweaks, appliedCuts }) {
  const wrapRef = useRefG(null);
  const [size, setSize] = useStateG({ w: 600, h: 480 });
  const [mode, setMode] = useStateG("primal"); // "primal" | "dual"

  useEffectG(() => {
    function measure() {
      if (!wrapRef.current) return;
      const r = wrapRef.current.getBoundingClientRect();
      setSize({ w: Math.max(320, r.width), h: Math.max(280, r.height) });
    }
    measure();
    const ro = new ResizeObserver(measure);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // Decide which LP to render. Each applied cut (cover or Gomory) carries a
  // pre-computed `geomConstraint` expressed in original decision variables; we
  // fold these into the primal LP so the feasible region tightens and the cut
  // appears as a labeled line on the plane.
  const lpWithCuts = useMemoG(() => {
    if (!appliedCuts || appliedCuts.length === 0) return lp;
    if (lp.c.length !== 2) return lp;
    const extraCons = [];
    for (const cut of appliedCuts) {
      const g = cut.geomConstraint;
      if (!g) continue;
      extraCons.push({
        a: g.a.slice(),
        op: g.op,
        b: g.b,
        kind: cut.kind === "gomory" ? "cut-gomory" : "cut-cover",
        label: cut.label,
      });
    }
    if (extraCons.length === 0) return lp;
    return { ...lp, constraints: [...lp.constraints, ...extraCons] };
  }, [lp, appliedCuts]);

  const dualLP = useMemoG(() => buildDualGeomLP(lp), [lp]);
  const canDual = !!dualLP;
  const effective = mode === "dual" && canDual ? dualLP : lpWithCuts;
  // Reset to primal if dual not available
  useEffectG(() => {
    if (mode === "dual" && !canDual) setMode("primal");
  }, [canDual, mode]);

  // IMPORTANT: all hooks must be called unconditionally. The early-return for
  // non-2D LPs below would otherwise skip the useMemo calls and trigger
  // "Rendered fewer hooks than expected" when the user adds a 3rd decision var.
  const bb = useMemoG(() => Geom.bounds(effective), [effective]);
  const verts = useMemoG(() => Geom.vertices(effective), [effective]);

  if (effective.c.length !== 2) {
    return (
      <div className="geom-wrap" data-screen-label="geometry">
        <div className="geom-head">
          <div className="section-title" style={{ margin: 0 }}>
            {t.geometry}
          </div>
        </div>
        <div className="geom-svg-wrap" ref={wrapRef}>
          <div className="geom-no">{t.noGeometry}</div>
        </div>
      </div>
    );
  }

  const margin = { top: 24, right: 32, bottom: 30, left: 40 };
  const W = size.w;
  const H = size.h;
  const plotW = W - margin.left - margin.right;
  const plotH = H - margin.top - margin.bottom;

  const xScale = (x) =>
    margin.left + ((x - bb.xmin) / (bb.xmax - bb.xmin)) * plotW;
  const yScale = (y) =>
    margin.top + (1 - (y - bb.ymin) / (bb.ymax - bb.ymin)) * plotH;

  // Decision points along history (for path). Only meaningful in primal mode.
  const pathPoints =
    mode === "primal"
      ? history
          .filter((s) => s.iteration >= 0)
          .map((s) => {
            const pt = Simplex.decisionPoint(s);
            return { x: pt[0] || 0, y: pt[1] || 0 };
          })
      : [];

  const current =
    mode === "primal"
      ? pathPoints[step] || pathPoints[0] || { x: 0, y: 0 }
      : null;

  // Tick generator
  function niceStep(s) {
    const exp = Math.floor(Math.log10(s));
    const f = s / Math.pow(10, exp);
    let nf;
    if (f < 1.5) nf = 1;
    else if (f < 3) nf = 2;
    else if (f < 7) nf = 5;
    else nf = 10;
    return nf * Math.pow(10, exp);
  }
  function makeTicks(min, max) {
    const range = max - min;
    const stepT = niceStep(range / 7);
    const start = Math.ceil(min / stepT) * stepT;
    const ticks = [];
    for (let v = start; v <= max + 1e-9; v += stepT) {
      ticks.push(Number(v.toFixed(6)));
    }
    return ticks;
  }
  const xTicks = makeTicks(Math.max(0, bb.xmin), bb.xmax);
  const yTicks = makeTicks(Math.max(0, bb.ymin), bb.ymax);

  // Level curves
  const cv = effective.c;
  const z_curr = current ? cv[0] * current.x + cv[1] * current.y : 0;
  const levels = [];
  if (Math.abs(cv[0]) > 1e-9 || Math.abs(cv[1]) > 1e-9) {
    const span =
      Math.abs(z_curr) * 1.5 +
      Math.max(bb.xmax * Math.abs(cv[0]), bb.ymax * Math.abs(cv[1]));
    const stepZ = niceStep(span / 6);
    let zmin =
      Math.floor((bb.xmin * cv[0] + bb.ymin * cv[1]) / stepZ) * stepZ;
    let zmax = Math.ceil((bb.xmax * cv[0] + bb.ymax * cv[1]) / stepZ) * stepZ;
    for (let z = zmin; z <= zmax + 1e-9; z += stepZ) levels.push(z);
  }

  // Gradient
  const gradLen = Math.hypot(cv[0], cv[1]);
  const gradScale = (Math.min(bb.xmax, bb.ymax) * 0.3) / Math.max(gradLen, 1e-6);
  const gradStart = { x: 0.3, y: 0.3 };
  const gradEnd = {
    x: gradStart.x + cv[0] * gradScale * 0.6,
    y: gradStart.y + cv[1] * gradScale * 0.6,
  };

  const polyD = verts.length
    ? verts.map((p) => `${xScale(p.x)},${yScale(p.y)}`).join(" ")
    : "";

  const axisLabels = effective.varNames.map((v) => v.replace("_", ""));

  return (
    <div className="geom-wrap" data-screen-label="geometry">
      <div className="geom-head">
        <div className="section-title" style={{ margin: 0 }}>
          {t.geometry}
          <span className="badge">
            ℝ² · {axisLabels.join(", ")}
          </span>
        </div>
        <div className="geom-tools">
          <div className="seg">
            <button
              className={mode === "primal" ? "active" : ""}
              onClick={() => setMode("primal")}
            >
              {t.switchToPrimal}
            </button>
            <button
              className={mode === "dual" && canDual ? "active" : ""}
              onClick={() => canDual && setMode("dual")}
              disabled={!canDual}
              title={canDual ? "" : t.dualNotAvailable2D}
              aria-label={canDual ? t.switchToDual : t.dualNotAvailable2D}
            >
              {t.switchToDual}
            </button>
          </div>
        </div>
      </div>

      <div className="geom-svg-wrap" ref={wrapRef}>
        <svg className="geom-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {xTicks.map((x, i) => (
            <line
              key={`gx${i}`}
              className="g-grid"
              x1={xScale(x)}
              x2={xScale(x)}
              y1={margin.top}
              y2={H - margin.bottom}
            />
          ))}
          {yTicks.map((y, i) => (
            <line
              key={`gy${i}`}
              className="g-grid"
              x1={margin.left}
              x2={W - margin.right}
              y1={yScale(y)}
              y2={yScale(y)}
            />
          ))}

          {verts.length >= 3 && (
            <polygon className="g-feasible" points={polyD} />
          )}

          {effective.constraints.map((c, i) => {
            const clipped = Geom.clipLine(c.a[0], c.a[1], c.b, bb);
            if (!clipped) return null;
            const [p1, p2] = clipped;
            const mx = (p1.x + p2.x) / 2;
            const my = (p1.y + p2.y) / 2;
            const isBound = c.kind === "bound";
            const isCutGomory = c.kind === "cut-gomory";
            const isCutCover = c.kind === "cut-cover";
            const isCut = isCutGomory || isCutCover;
            let lineClass = "g-constr";
            if (isBound) lineClass = "g-constr g-constr-bound";
            else if (isCutGomory) lineClass = "g-cut g-cut-gomory";
            else if (isCutCover) lineClass = "g-cut g-cut-cover";
            return (
              <g key={`c${i}`}>
                <line
                  className={lineClass}
                  x1={xScale(p1.x)}
                  y1={yScale(p1.y)}
                  x2={xScale(p2.x)}
                  y2={yScale(p2.y)}
                />
                <text
                  className={isCut ? "g-cut-label" : "g-constr-label"}
                  x={xScale(mx) + 6}
                  y={yScale(my) - 6}
                >
                  {isCut
                    ? (c.label || "cut")
                    : isBound
                    ? `${effective.varNames[c.varIndex].replace("_", "")}≤${c.b}`
                    : `${mode === "primal" ? "C" : "D"}${i + 1}`}
                </text>
              </g>
            );
          })}

          {tweaks.showLevels &&
            levels.map((z, i) => {
              const clipped = Geom.clipLine(cv[0], cv[1], z, bb);
              if (!clipped) return null;
              const [p1, p2] = clipped;
              const isBest =
                current &&
                Math.abs(z - z_curr) <
                  niceStep(Math.abs(z_curr) || 1) * 0.5;
              return (
                <line
                  key={`l${i}`}
                  className={isBest ? "g-level-best" : "g-level"}
                  x1={xScale(p1.x)}
                  y1={yScale(p1.y)}
                  x2={xScale(p2.x)}
                  y2={yScale(p2.y)}
                />
              );
            })}

          <line
            className="g-axis"
            x1={margin.left}
            x2={W - margin.right}
            y1={yScale(0)}
            y2={yScale(0)}
          />
          <line
            className="g-axis"
            x1={xScale(0)}
            x2={xScale(0)}
            y1={margin.top}
            y2={H - margin.bottom}
          />
          {xTicks.map((x, i) => (
            <g key={`tx${i}`}>
              <line
                className="g-axis"
                x1={xScale(x)}
                x2={xScale(x)}
                y1={yScale(0) - 3}
                y2={yScale(0) + 3}
              />
              <text
                className="g-tick-label"
                x={xScale(x)}
                y={yScale(0) + 14}
                textAnchor="middle"
              >
                {x}
              </text>
            </g>
          ))}
          {yTicks.map((y, i) => (
            <g key={`ty${i}`}>
              <line
                className="g-axis"
                x1={xScale(0) - 3}
                x2={xScale(0) + 3}
                y1={yScale(y)}
                y2={yScale(y)}
              />
              <text
                className="g-tick-label"
                x={xScale(0) - 6}
                y={yScale(y) + 3}
                textAnchor="end"
              >
                {y}
              </text>
            </g>
          ))}
          <text
            className="g-axis-label"
            x={W - margin.right - 4}
            y={yScale(0) - 6}
            textAnchor="end"
          >
            {axisLabels[0]}
          </text>
          <text
            className="g-axis-label"
            x={xScale(0) + 8}
            y={margin.top + 4}
          >
            {axisLabels[1]}
          </text>

          {tweaks.showPath && pathPoints.length > 1 && mode === "primal" && (
            <polyline
              className="g-path"
              points={pathPoints
                .slice(0, step + 1)
                .map((p) => `${xScale(p.x)},${yScale(p.y)}`)
                .join(" ")}
            />
          )}

          {verts.map((v, i) => (
            <circle
              key={`v${i}`}
              className="g-vertex"
              cx={xScale(v.x)}
              cy={yScale(v.y)}
              r={4}
            />
          ))}
          {verts.map((v, i) => (
            <text
              key={`vl${i}`}
              className="g-vertex-label"
              x={xScale(v.x) + 6}
              y={yScale(v.y) - 6}
            >
              ({Simplex.fmt(v.x, 1)}, {Simplex.fmt(v.y, 1)})
            </text>
          ))}

          {tweaks.showGradient && (
            <g>
              <defs>
                <marker
                  id="arrow"
                  markerWidth="8"
                  markerHeight="8"
                  refX="6"
                  refY="3"
                  orient="auto"
                >
                  <path d="M0,0 L6,3 L0,6 z" fill="var(--accent)" />
                </marker>
              </defs>
              <line
                className="g-grad"
                x1={xScale(gradStart.x)}
                y1={yScale(gradStart.y)}
                x2={xScale(gradEnd.x)}
                y2={yScale(gradEnd.y)}
                markerEnd="url(#arrow)"
              />
              <text
                className="g-axis-label"
                x={xScale(gradEnd.x) + 6}
                y={yScale(gradEnd.y) - 2}
              >
                ∇{mode === "primal" ? "z" : "w"}
              </text>
            </g>
          )}

          {current && (
            <>
              <circle
                className="g-vertex-current"
                cx={xScale(current.x)}
                cy={yScale(current.y)}
                r={7}
              />
              <circle
                className="g-path-marker"
                cx={xScale(current.x)}
                cy={yScale(current.y)}
                r={3}
                fill="var(--bg-paper)"
              />
            </>
          )}
        </svg>
      </div>

      {/* Footer area: current vertex info only — legend moved inside SVG as overlay */}
      <div className="geom-foot">
        <div className="geom-info">
          {mode === "primal" && current ? (
            <>
              <span className="lbl">{t.currentVertex}:</span>{" "}
              <span className="val">
                ({Simplex.fmt(current.x)}, {Simplex.fmt(current.y)})
              </span>
              <span className="sep">·</span>
              <span className="lbl">z =</span>{" "}
              <span className="val">{Simplex.fmt(Simplex.objectiveValue(state))}</span>
            </>
          ) : (
            <span className="lbl">
              {mode === "dual" ? t.dualVisualization : ""}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

window.GeometryView = GeometryView;
