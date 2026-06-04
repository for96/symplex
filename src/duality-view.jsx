/* global React, Simplex, Duality, VarName, CoefInput */
// Duality workspace — independent from the simplex one.
// Walks a student through chapter-4-style exercises:
//   1. enter a primal LP;
//   2. read off the dual (constructed automatically);
//   3. enter a candidate solution x* (primal) or y* (dual);
//   4. apply complementary-slackness conditions step by step:
//        a) identify active/inactive constraints,
//        b) infer which dual (resp. primal) variables must be zero,
//        c) build & solve the resulting linear system for the unknowns,
//        d) verify feasibility of the recovered solution,
//        e) compare z = c·x with w = b·y (strong duality check).

const { useState: useStateD, useMemo: useMemoD, useEffect: useEffectD } = React;

const DUALITY_DEFAULT_LP = {
  // Esercizio 4.1 — Scarti complementari (Marinelli, Esercizi PM)
  // max 2x1 + x2   s.t.   x1 + 2x2 ≤ 14, 2x1 − x2 ≤ 10, x1 − x2 ≤ 3
  type: "lp",
  objective: "max",
  c: [2, 1],
  varNames: ["x1", "x2"],
  constraints: [
    { a: [1, 2], op: "<=", b: 14 },
    { a: [2, -1], op: "<=", b: 10 },
    { a: [1, -1], op: "<=", b: 3 },
  ],
  varSigns: [">= 0", ">= 0"],
};

// Default known x* for the default LP: (20/3, 11/3).
const DUALITY_DEFAULT_X = [20 / 3, 11 / 3];

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

const DUALITY_HISTORY_KEY = "duality_lp_history_v1";
const DUALITY_HISTORY_LIMIT = 8;

function dualityLpFingerprint(lp) {
  return JSON.stringify([
    lp.objective,
    lp.c,
    (lp.constraints || []).map((c) => [c.a, c.op, c.b]),
    lp.varSigns || [],
  ]);
}

function loadDualityHistory() {
  try {
    const raw = localStorage.getItem(DUALITY_HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw) || [];
  } catch (e) {
    return [];
  }
}

function saveDualityHistory(arr) {
  try {
    localStorage.setItem(DUALITY_HISTORY_KEY, JSON.stringify(arr));
  } catch (e) {}
}

function pushDualityHistory(lp) {
  const arr = loadDualityHistory();
  const fp = dualityLpFingerprint(lp);
  const existsIdx = arr.findIndex((e) => {
    const efp = e.lp ? dualityLpFingerprint(e.lp) : e.fp;
    return efp === fp;
  });
  if (existsIdx !== -1) {
    if (arr[existsIdx].fp !== fp) {
      arr[existsIdx] = { ...arr[existsIdx], fp };
      saveDualityHistory(arr);
    }
    return arr;
  }
  const filtered = [{ fp, lp: JSON.parse(JSON.stringify(lp)), ts: Date.now() }, ...arr];
  while (filtered.length > DUALITY_HISTORY_LIMIT) filtered.pop();
  saveDualityHistory(filtered);
  return filtered;
}

function lpToTextOneLine(lp, t) {
  const firstObjIdx = lp.c.findIndex((v) => Math.abs(v) > 1e-9);
  const obj = lp.c
    .map((v, j) => {
      if (v === 0) return null;
      const sign = v > 0 ? (j === firstObjIdx ? "" : "+") : "−";
      const abs = Math.abs(v);
      const c = abs === 1 ? "" : abs;
      return `${sign}${c}${(lp.varNames[j] || "x").replace("_", "")}`;
    })
    .filter(Boolean)
    .join("");
  const abbr = (t && t.constraintsAbbr) || "vinc.";
  return `${obj} · ${lp.constraints.length} ${abbr}`;
}

function formatFracInput(v) {
  if (typeof v !== "number" || !isFinite(v)) return "";
  const f = Simplex.toFraction(v);
  if (f.isInt) return String(f.num);
  if (Math.abs(f.num) <= 200 && f.den <= 200 && !f.approx) {
    return `${f.num}/${f.den}`;
  }
  return Simplex.fmt(v, 3);
}

function parseFracInput(s) {
  const t = String(s).trim();
  if (t === "") return null;
  const fr = t.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/);
  if (fr) {
    const num = parseFloat(fr[1]);
    const den = parseFloat(fr[2]);
    if (den !== 0) return num / den;
  }
  const n = parseFloat(t);
  if (!isNaN(n)) return n;
  return null;
}

function FracInput({ value, onChange, ariaLabel }) {
  const [text, setText] = useStateD(() => formatFracInput(value));
  const [focused, setFocused] = useStateD(false);
  // While focused, keep the user's typed draft; otherwise mirror the canonical
  // value so external updates (size sync, parent re-renders) are reflected.
  useEffectD(() => {
    if (!focused) setText(formatFracInput(value));
  }, [value, focused]);
  function commit(s) {
    setText(s);
    const v = parseFracInput(s);
    onChange(v);
  }
  return (
    <input
      type="text"
      className="frac-input"
      value={text}
      onFocus={() => setFocused(true)}
      onChange={(e) => commit(e.target.value)}
      onBlur={() => { setFocused(false); setText(formatFracInput(value)); }}
      aria-label={ariaLabel || ""}
      placeholder="?"
    />
  );
}

function dualityLpToText(lp) {
  return window.LPText ? window.LPText.lpToText(lp) : "";
}

function mergeDualityTextLP(current, parsed) {
  const oldSigns = new Map();
  (current.varNames || []).forEach((name, j) => {
    oldSigns.set(String(name).replace("_", ""), current.varSigns ? current.varSigns[j] : ">= 0");
  });
  return {
    ...parsed,
    type: current.type || "lp",
    varSigns: parsed.varNames.map((name) => oldSigns.get(String(name).replace("_", "")) || ">= 0"),
  };
}

// Compact LP editor used only inside the duality workspace. Adds/removes rows
// and variables but does NOT touch var bounds, ILP toggle or LP history —
// those live in the simplex workspace and would just be noise here.
function DualityLPEditor({ lp, setLp, t }) {
  const [mode, setMode] = useStateD("structured");
  const [text, setText] = useStateD(() => dualityLpToText(lp));
  const [textErr, setTextErr] = useStateD("");

  useEffectD(() => {
    setText(dualityLpToText(lp));
  }, [lp]);

  function applyText() {
    try {
      if (!window.LPText) throw new Error("parser unavailable");
      setLp(mergeDualityTextLP(lp, window.LPText.parseText(text, t)));
      setTextErr("");
    } catch (e) {
      setTextErr(e.message);
    }
  }

  function setObj(v) { setLp({ ...lp, objective: v }); }
  function setC(j, v) { const c = lp.c.slice(); c[j] = v; setLp({ ...lp, c }); }
  function setA(i, j, v) {
    const cs = lp.constraints.map((c) => ({ ...c, a: c.a.slice() }));
    cs[i].a[j] = v;
    setLp({ ...lp, constraints: cs });
  }
  function setOp(i, v) {
    const cs = lp.constraints.map((c) => ({ ...c, a: c.a.slice() }));
    cs[i].op = v;
    setLp({ ...lp, constraints: cs });
  }
  function setB(i, v) {
    const cs = lp.constraints.map((c) => ({ ...c, a: c.a.slice() }));
    cs[i].b = v;
    setLp({ ...lp, constraints: cs });
  }
  function addConstr() {
    const a = new Array(lp.c.length).fill(0); a[0] = 1;
    setLp({ ...lp, constraints: [...lp.constraints, { a, op: "<=", b: 1 }] });
  }
  function rmConstr(i) {
    if (lp.constraints.length <= 1) return;
    setLp({ ...lp, constraints: lp.constraints.filter((_, k) => k !== i) });
  }
  function addVar() {
    const n = lp.c.length;
    const newVarName = `x${n + 1}`;
    const varSigns = lp.varSigns ? [...lp.varSigns, ">= 0"] : new Array(n + 1).fill(">= 0");
    setLp({
      ...lp,
      c: [...lp.c, 0],
      varNames: [...lp.varNames, newVarName],
      constraints: lp.constraints.map((c) => ({ ...c, a: [...c.a, 0] })),
      varSigns,
    });
  }
  function rmVar() {
    if (lp.c.length <= 1) return;
    const varSigns = lp.varSigns ? lp.varSigns.slice(0, -1) : new Array(lp.c.length - 1).fill(">= 0");
    setLp({
      ...lp,
      c: lp.c.slice(0, -1),
      varNames: lp.varNames.slice(0, -1),
      constraints: lp.constraints.map((c) => ({ ...c, a: c.a.slice(0, -1) })),
      varSigns,
    });
  }
  const freeLabel = (t.subjectTo === "soggetto a") ? "libera" : "free";
  return (
    <div className="dy-editor">
      <div className="dy-editor-tabs">
        <div className="seg">
          <button
            className={mode === "structured" ? "active" : ""}
            onClick={() => setMode("structured")}
          >
            {t.editStructured}
          </button>
          <button
            className={mode === "text" ? "active" : ""}
            onClick={() => setMode("text")}
          >
            {t.editText}
          </button>
        </div>
      </div>
      <div style={{ display: mode === "structured" ? "block" : "none" }}>
      <div className="obj-row">
        <div className="obj-label">
          <select className="op-select" value={lp.objective} onChange={(e) => setObj(e.target.value)}>
            <option value="max">{t.max}</option>
            <option value="min">{t.min}</option>
          </select>
        </div>
        <div className="coef-line">
          <span className="coef-z" style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}>z =</span>
          {lp.c.map((v, j) => (
            <React.Fragment key={j}>
              <span className="coef-term">
                <CoefInput value={v} onChange={(nv) => setC(j, nv)} />
                <VarName name={lp.varNames[j]} />
              </span>
              {j < lp.c.length - 1 && <span className="coef-plus">+</span>}
            </React.Fragment>
          ))}
        </div>
      </div>
      <div className="obj-row" style={{ marginTop: 8 }}>
        <div className="sub-label">{t.subjectTo}</div><div></div>
      </div>
      {lp.constraints.map((c, i) => (
        <div className="constr-row" key={i}>
          <div></div>
          <div className="coef-line">
            {c.a.map((v, j) => (
              <React.Fragment key={j}>
                <span className="coef-term">
                  <CoefInput value={v} onChange={(nv) => setA(i, j, nv)} />
                  <VarName name={lp.varNames[j]} />
                </span>
                {j < c.a.length - 1 && <span className="coef-plus">+</span>}
              </React.Fragment>
            ))}
            <span className="coef-rhs">
              <select className="op-select" value={c.op} onChange={(e) => setOp(i, e.target.value)}>
                <option value="<=">≤</option><option value="=">=</option><option value=">=">≥</option>
              </select>
              <CoefInput value={c.b} onChange={(nv) => setB(i, nv)} />
              <button className="rm-btn" title={t.removeConstraint} aria-label={t.ariaRemoveConstraint} onClick={() => rmConstr(i)}>×</button>
            </span>
          </div>
        </div>
      ))}
      <div className="var-signs-row" style={{ marginTop: 12, display: "flex", gap: 12, flexWrap: "wrap", fontSize: 13, borderTop: "1px solid var(--rule)", paddingTop: 10 }}>
        <span style={{ color: "var(--ink-2)" }}>{t.varBoundsSection}:</span>
        {lp.c.map((_, j) => {
          const sign = lp.varSigns ? lp.varSigns[j] : ">= 0";
          return (
            <span key={j} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <VarName name={lp.varNames[j]} />
              <select
                className="op-select"
                style={{ padding: "1px 4px", fontSize: 12 }}
                value={sign}
                onChange={(e) => {
                  const varSigns = (lp.varSigns || new Array(lp.c.length).fill(">= 0")).slice();
                  while (varSigns.length < lp.c.length) varSigns.push(">= 0");
                  varSigns[j] = e.target.value;
                  setLp({ ...lp, varSigns });
                }}
              >
                <option value=">= 0">≥ 0</option>
                <option value="<= 0">≤ 0</option>
                <option value="free">{freeLabel}</option>
              </select>
            </span>
          );
        })}
      </div>
      <div className="editor-actions" style={{ marginTop: 12 }}>
        <button className="pill-btn" onClick={addConstr}>{t.addConstraint}</button>
        <button className="pill-btn" onClick={addVar} title={t.addVariable}>+ {t.variables.toLowerCase()}</button>
        {lp.c.length > 1 && (
          <button className="pill-btn" onClick={rmVar} title={t.removeVariable}>− {t.variables.toLowerCase()}</button>
        )}
      </div>
      </div>
      <div style={{ display: mode === "text" ? "block" : "none" }}>
        <textarea
          className="text-editor dy-text-editor"
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck="false"
        />
        {textErr && <div className="text-err">⚠ {textErr}</div>}
        <div className="editor-actions">
          <button className="pill-btn active" onClick={applyText}>{t.apply}</button>
          <button className="pill-btn" onClick={() => setText(dualityLpToText(lp))}>{t.reset}</button>
        </div>
      </div>
    </div>
  );
}

// Right-hand panel: the dual problem.
function DualBlock({ dual, t }) {
  const fmt = Simplex.fmt;
  const renderLHS = (coefs, names) => {
    const firstIdx = coefs.findIndex(v => Math.abs(v) > 1e-9);
    return coefs.map((v, j) => {
      if (v === 0) return null;
      const sign = v > 0 ? "+" : "−";
      const abs = Math.abs(v);
      const coefStr = abs === 1 ? "" : fmt(abs);
      return (
        <React.Fragment key={j}>
          {" "}
          <span className="mono dual-sign">{j === firstIdx && v > 0 ? "" : sign}</span>{" "}
          <span className="mono">{coefStr}</span>
          <VarName name={names[j]} />
        </React.Fragment>
      );
    });
  };
  return (
    <div className="dual-block">
      <span className="dual-line">
        <span className="dual-sign">{dual.objective}</span>{" "}
        <span style={{ fontStyle: "italic" }}>w</span> ={" "}
        {renderLHS(dual.c, dual.varNames)}
      </span>
      <span className="dual-line dual-sign">{t.subjectTo}</span>
      {dual.constraints.map((c, i) => (
        <span className="dual-line" key={i}>
          {"  "}
          {renderLHS(c.a, dual.varNames)}{" "}
          <span className="mono">
            {c.op === "<=" ? "≤" : c.op === ">=" ? "≥" : "="} {fmt(c.b)}
          </span>
        </span>
      ))}
      <span className="dual-line dual-sign" style={{ marginTop: 6, display: "block" }}>
        {dual.varNames.map((n, i) => (
          <React.Fragment key={i}>
            <VarName name={n} />{" "}
            <span className="mono">{dual.varSigns[i]}</span>
            {i < dual.varNames.length - 1 && ", "}
          </React.Fragment>
        ))}
      </span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Step renderers
// ────────────────────────────────────────────────────────────────────────────

function FracDisplay({ value }) {
  return window.Frac ? <window.Frac value={value} /> : <span>{Simplex.fmt(value, 3)}</span>;
}

function StepHeader({ idx, title }) {
  return (
    <div className="dy-step-head">
      <span className="dy-step-num">{idx}.</span> <span className="dy-step-title" dangerouslySetInnerHTML={{ __html: title }} />
    </div>
  );
}

function FeasibilityRow({ feasible, issues, t, lp, dual, isDual, partial, parametric }) {
  return (
    <div className={"dy-feas " + (feasible ? "ok" : "ko")}>
      {feasible
        ? (parametric ? `✓ ${t.dyFeasibleRange}` : partial ? `✓ ${t.dyFeasiblePartial}` : `✓ ${t.dyFeasible}`)
        : `✗ ${t.dyInfeasible}`}
      {!feasible && (
        <ul className="dy-issues">
          {issues.map((iss, k) => (
            <li key={k}>
              {iss.kind === "negative-var" && (
                <span>{(isDual ? "y" : "x")}<sub>{iss.index + 1}</sub> = {Simplex.fmt(iss.value, 3)} {"< 0"}</span>
              )}
              {iss.kind === "wrong-sign" && (
                <span>{(isDual ? "y" : "x")}<sub>{iss.index + 1}</sub> = {Simplex.fmt(iss.value, 3)} ({t.dyShouldBe} {iss.sign})</span>
              )}
              {iss.kind === "violated-constraint" && (
                <span>
                  {isDual ? `D${iss.index + 1}` : `C${iss.index + 1}`}: {Simplex.fmt(iss.lhs, 3)} {iss.op === "<=" ? ">" : iss.op === ">=" ? "<" : "≠"} {Simplex.fmt(iss.rhs, 3)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PrimalActiveTable({ constraints, xStar, lp, t }) {
  return (
    <table className="dy-table">
      <thead>
        <tr>
          <th>i</th>
          <th>a<sub>i</sub><sup>T</sup> x<sup>*</sup></th>
          <th>b<sub>i</sub></th>
          <th>{t.dyStatus}</th>
        </tr>
      </thead>
      <tbody>
        {constraints.map((c, i) => (
          <tr key={i} className={c.active ? "active" : "inactive"}>
            <td>C{i + 1}</td>
            <td>{c.lhs === null ? "?" : <FracDisplay value={c.lhs} />}</td>
            <td><FracDisplay value={c.b} /></td>
            <td>
              {c.active === null ? (
                <span className="dy-tag inactive">{t.dyUnknown}</span>
              ) : c.op === "=" ? (
                <span className="dy-tag eq">= ({t.dyEquality})</span>
              ) : c.active ? (
                <span className="dy-tag active">{t.dyActive}</span>
              ) : (
                <span className="dy-tag inactive">{t.dyInactive} ({t.dySlack} = <FracDisplay value={c.slack} />)</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DualActiveTable({ constraints, yStar, t }) {
  return (
    <table className="dy-table">
      <thead>
        <tr>
          <th>j</th>
          <th>y<sup>*T</sup> A<sub>j</sub></th>
          <th>c<sub>j</sub></th>
          <th>{t.dyStatus}</th>
        </tr>
      </thead>
      <tbody>
        {constraints.map((c, j) => (
          <tr key={j} className={c.active ? "active" : "inactive"}>
            <td>D{j + 1}</td>
            <td>{c.lhs === null ? "?" : <FracDisplay value={c.lhs} />}</td>
            <td><FracDisplay value={c.b} /></td>
            <td>
              {c.active === null ? (
                <span className="dy-tag inactive">{t.dyUnknown}</span>
              ) : c.active ? (
                <span className="dy-tag active">{t.dyActive}</span>
              ) : (
                <span className="dy-tag inactive">{t.dyInactive} ({t.dySlack} = <FracDisplay value={c.slack} />)</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SystemView({ eqs, unknowns, varSymbol, t }) {
  if (eqs.length === 0) {
    return <div className="dy-note">{t.dyNoEquations}</div>;
  }
  return (
    <table className="dy-system">
      <tbody>
        {eqs.map((e, r) => {
          const firstNonZeroK = e.coefs.findIndex((co) => Math.abs(co) > 1e-9);
          return (
            <tr key={r}>
              {unknowns.flatMap((_, k) => {
                const co = e.coefs[k];
                const hasTerm = Math.abs(co) > 1e-9;
                
                const termNode = (() => {
                  if (!hasTerm) {
                    return <td key={`t-${k}`} className="dy-sys-term empty"></td>;
                  }
                  const isFirst = k === firstNonZeroK;
                  const showNeg = isFirst && co < 0;
                  const absCo = Math.abs(co);
                  const coefStr = absCo === 1 ? "" : Simplex.fmt(absCo, 2);
                  return (
                    <td key={`t-${k}`} className="dy-sys-term">
                      {showNeg && <span className="dy-op-sign">−</span>}
                      {coefStr && <span className="dy-coef-val">{coefStr}</span>}
                      <VarName name={`${varSymbol}_${unknowns[k] + 1}`} />
                    </td>
                  );
                })();

                if (k < unknowns.length - 1) {
                  const nextK = k + 1;
                  const nextCo = e.coefs[nextK];
                  const nextHasTerm = Math.abs(nextCo) > 1e-9;
                  const showOp = nextHasTerm && nextK > firstNonZeroK;
                  const opNode = showOp ? (
                    <td key={`o-${k}`} className="dy-sys-op">
                      <span className="dy-op-sign">{nextCo > 0 ? "+" : "−"}</span>
                    </td>
                  ) : (
                    <td key={`o-${k}`} className="dy-sys-op empty"></td>
                  );
                  return [termNode, opNode];
                }

                return [termNode];
              })}
              <td className="dy-eq">=</td>
              <td className="dy-rhs"><FracDisplay value={e.rhs} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function SolutionVector({ values, symbol, t }) {
  return (
    <div className="dy-solution">
      {values.map((v, i) => (
        <span key={i} className="dy-sol-item">
          <VarName name={`${symbol}_${i + 1}`} />
          <sup>*</sup>
          <span className="dy-eq">=</span>
          <FracDisplay value={v} />
          {i < values.length - 1 && <span className="sep">,</span>}
        </span>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Main workspace
// ────────────────────────────────────────────────────────────────────────────

function ParamName({ symbol, index }) {
  return (
    <span>
      <VarName name={`${symbol}_${index + 1}`} />
      <sup>*</sup>
    </span>
  );
}

function AffineExpr({ base, coef, param }) {
  if (Math.abs(coef) < 1e-9) return <FracDisplay value={base} />;

  const fb = Simplex.toFraction(base);
  const fc = Simplex.toFraction(coef);
  const isRational = fb.den <= 100 && fc.den <= 100 && !fb.approx && !fc.approx;

  if (isRational) {
    const gcd = (x, y) => {
      x = Math.abs(x);
      y = Math.abs(y);
      while (y) {
        const t = y;
        y = x % y;
        x = t;
      }
      return x;
    };
    const lcm = (x, y) => (x * y) / gcd(x, y);
    const D = lcm(fb.den, fc.den);
    const nB = fb.num * (D / fb.den);
    const nC = fc.num * (D / fc.den);

    if (D === 1) {
      if (nB === 0) {
        return (
          <span>
            {nC < 0 ? "−" : ""}
            {Math.abs(nC) !== 1 && <span>{Math.abs(nC)}·</span>}
            <ParamName symbol={param.symbol} index={param.index} />
          </span>
        );
      } else {
        return (
          <span className="dy-affine-expr">
            <span>{nB}</span>
            <span className="dy-eq">{nC > 0 ? "+" : "−"}</span>
            {Math.abs(nC) !== 1 && <span>{Math.abs(nC)}·</span>}
            <ParamName symbol={param.symbol} index={param.index} />
          </span>
        );
      }
    } else {
      if (nB === 0) {
        return (
          <span className="dy-affine-expr">
            {nC < 0 && <span className="dy-eq">−</span>}
            <span className="frac" style={{ display: "inline-flex", alignItems: "center" }}>
              <span className="frac-stack">
                <span className="n">
                  {Math.abs(nC) !== 1 && <span>{Math.abs(nC)}·</span>}
                  <ParamName symbol={param.symbol} index={param.index} />
                </span>
                <span className="d">{D}</span>
              </span>
            </span>
          </span>
        );
      } else {
        return (
          <span className="dy-affine-expr">
            <span className="frac" style={{ display: "inline-flex", alignItems: "center" }}>
              <span className="frac-stack">
                <span className="n">
                  {nB}
                  {nC > 0 ? " + " : " − "}
                  {Math.abs(nC) !== 1 && <span>{Math.abs(nC)}·</span>}
                  <ParamName symbol={param.symbol} index={param.index} />
                </span>
                <span className="d">{D}</span>
              </span>
            </span>
          </span>
        );
      }
    }
  }

  const showBase = Math.abs(base) > 1e-9;
  const absCoef = Math.abs(coef);
  return (
    <span className="dy-affine-expr">
      {showBase && <FracDisplay value={base} />}
      {showBase && <span className="dy-eq">{coef >= 0 ? "+" : "−"}</span>}
      {!showBase && coef < 0 && <span className="dy-eq">−</span>}
      {Math.abs(absCoef - 1) > 1e-9 && <FracDisplay value={absCoef} />}
      {Math.abs(absCoef - 1) > 1e-9 && <span className="dy-eq">·</span>}
      <ParamName symbol={param.symbol} index={param.index} />
    </span>
  );
}

function IntervalDisplay({ low, high }) {
  return (
    <span>
      [<FracDisplay value={low} /> , <FracDisplay value={high} />]
    </span>
  );
}

function SolutionRange({ range, symbol, t }) {
  const param = { symbol, index: range.parameterIndex };
  const items = [];
  range.base.forEach((base, i) => {
    if (i === range.parameterIndex) return;
    items.push(
      <span key={i} className="dy-sol-item">
        <VarName name={`${symbol}_${i + 1}`} />
        <sup>*</sup>
        <span className="dy-eq">=</span>
        <AffineExpr base={base} coef={range.direction[i]} param={param} />
      </span>
    );
  });
  return (
    <div className="dy-solution-range">
      <div className="dy-solution">
        {items.map((item, idx) => (
          <React.Fragment key={idx}>
            {item}
            {idx < items.length - 1 && <span className="sep">,</span>}
          </React.Fragment>
        ))}
      </div>
      <div className="dy-frees">
        <ParamName symbol={symbol} index={range.parameterIndex} /> ∈ <IntervalDisplay low={range.low} high={range.high} />
      </div>
      {!range.feasible && <div className="dy-note">{t.dyRangeEmpty}</div>}
    </div>
  );
}

function sensitivityReason(t, reason) {
  const map = {
    "unsupported-var-signs": t.dySensitivityUnsupportedSigns,
    "not-a-bfs": t.dySensitivityNotBfs,
    "dependent-positive": t.dySensitivityNotBfs,
    "no-basis": t.dySensitivityNoBasis,
    "singular-basis": t.dySensitivityNoBasis,
    "missing-primal": t.dySensitivityNoBasis,
  };
  return map[reason] || reason;
}

function DualitySensitivityPanel({ data, lp, t }) {
  if (!data.ok) {
    const isIt = t.subjectTo === "soggetto a";
    const msg = data.reason === "infeasible-or-missing"
      ? (isIt ? "Inserisci una soluzione candidata ammissibile ed ottima per calcolare la sensitività." : "Enter a feasible and optimal candidate solution to calculate sensitivity.")
      : `${t.dySensitivityUnavailable}: ${sensitivityReason(t, data.reason)}`;
    return (
      <div className="dy-note" style={{ margin: 0 }}>
        {msg}
      </div>
    );
  }
  return (
    <div className="dy-step-body">
      <div className="dy-explain" dangerouslySetInnerHTML={{ __html: t.dySensitivityExplain }} />
      {data.degenerate && (
        <div className="dy-note">{t.dySensitivityDegenerate}</div>
      )}
      <div className="dy-frees">
        {t.currentBasis}: {data.basis.map((b) => b.label).join(", ")}
      </div>
      <table className="sens-table" style={{ marginTop: 10 }}>
        <thead>
          <tr>
            <th>{t.constraintLabel}</th>
            <th>b<sub>i</sub></th>
            <th dangerouslySetInnerHTML={{ __html: t.rhsRange }} />
            <th>{t.dySensitivityFormula}</th>
          </tr>
        </thead>
        <tbody>
          {data.ranges.map((r, i) => (
            <tr key={i}>
              <td>C{i + 1}</td>
              <td><FracDisplay value={lp.constraints[i].b} /></td>
              <td>
                [<FracDisplay value={r.b + r.low} /> , <FracDisplay value={r.b + r.high} />]
              </td>
              <td>
                z<sup>*</sup> + δ<sub>{i + 1}</sub>·<FracDisplay value={r.dualValue || 0} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DualityWorkspace({ t }) {
  const [lp, setLp] = useStateD(() => {
    try {
      const stored = localStorage.getItem("duality_lp_current");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed === "object") return parsed;
      }
    } catch (e) {}
    return DUALITY_DEFAULT_LP;
  });
  const [knownType, setKnownType] = useStateD(() => {
    try {
      const stored = localStorage.getItem("duality_known_type");
      if (stored) return stored;
    } catch (e) {}
    return "primal";
  });
  const [knownX, setKnownX] = useStateD(() => {
    try {
      const stored = localStorage.getItem("duality_known_x");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {}
    return DUALITY_DEFAULT_X;
  });
  const [knownY, setKnownY] = useStateD(() => {
    try {
      const stored = localStorage.getItem("duality_known_y");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {}
    return [0, 0, 0];
  });
  const [dyHistory, setDyHistory] = useStateD(() => loadDualityHistory());

  useEffectD(() => {
    try {
      localStorage.setItem("duality_lp_current", JSON.stringify(lp));
    } catch (e) {}
  }, [lp]);

  useEffectD(() => {
    try {
      localStorage.setItem("duality_known_type", knownType);
    } catch (e) {}
  }, [knownType]);

  useEffectD(() => {
    try {
      localStorage.setItem("duality_known_x", JSON.stringify(knownX));
    } catch (e) {}
  }, [knownX]);

  useEffectD(() => {
    try {
      localStorage.setItem("duality_known_y", JSON.stringify(knownY));
    } catch (e) {}
  }, [knownY]);

  // Keep the size of knownX / knownY / varSigns in sync with the LP shape. We don't reset
  // values on every coefficient edit, only when the dimensions change.
  useEffectD(() => {
    if (knownX.length !== lp.c.length) {
      setKnownX(new Array(lp.c.length).fill(null));
    }
    if (!lp.varSigns || lp.varSigns.length !== lp.c.length) {
      const nextSigns = lp.varSigns ? lp.varSigns.slice(0, lp.c.length) : [];
      while (nextSigns.length < lp.c.length) nextSigns.push(">= 0");
      setLp({ ...lp, varSigns: nextSigns });
    }
  }, [lp.c.length]);
  useEffectD(() => {
    if (knownY.length !== lp.constraints.length) {
      setKnownY(new Array(lp.constraints.length).fill(null));
    }
  }, [lp.constraints.length]);

  const dual = useMemoD(() => Simplex.buildDual(lp), [lp]);

  const result = useMemoD(() => {
    try {
      if (knownType === "primal") {
        return Duality.solveDualFromPrimal(lp, dual, knownX);
      }
      return Duality.solvePrimalFromDual(lp, dual, knownY);
    } catch (e) {
      console.error(e);
      return { steps: [], ok: false, error: "exception" };
    }
  }, [lp, dual, knownType, knownX, knownY]);

  const sensitivity = useMemoD(() => {
    if (!result || !result.ok) return { ok: false, reason: "infeasible-or-missing" };
    
    function representativeFromRange(range) {
      if (!range || !range.feasible) return null;
      let t = 0;
      if (isFinite(range.low)) t = range.low;
      else if (isFinite(range.high)) t = range.high;
      return range.base.map((b, i) => b + t * range.direction[i]);
    }

    let xStar = knownType === "primal" ? knownX : result.x;
    if (!xStar && result.xRange) {
      xStar = representativeFromRange(result.xRange);
    }

    let yStar = knownType === "primal" ? result.y : knownY;
    if (!yStar && result.yRange) {
      yStar = representativeFromRange(result.yRange);
    }

    if (!xStar || !yStar) return { ok: false, reason: "infeasible-or-missing" };
    return Duality.rhsSensitivity(lp, xStar, yStar);
  }, [lp, result, knownType, knownX, knownY]);

  return (
    <div className="duality-workspace">
      <div className="dy-grid">
        {/* Left: primal editor + dual display */}
        <div className="dy-col dy-col-left">
          <div className="section">
            <div className="section-title">{t.dyPrimalProblem}</div>
            <DualityLPEditor lp={lp} setLp={setLp} t={t} />
          </div>

          <div className="section">
            <div className="section-title" style={{ marginBottom: 6 }}>
              {t.history}
              {dyHistory && dyHistory.length > 0 && (
                <button
                  className="pill-btn"
                  style={{ fontSize: 10, padding: "2px 8px" }}
                  onClick={() => {
                    saveDualityHistory([]);
                    setDyHistory([]);
                  }}
                  title={t.clearHistory}
                  aria-label={t.ariaClearHistory}
                >
                  ×
                </button>
              )}
            </div>
            {(() => {
              const currentFp = dualityLpFingerprint(lp);
              const alreadySaved = !!(dyHistory && dyHistory.some((h) => {
                const hfp = h.lp ? dualityLpFingerprint(h.lp) : h.fp;
                return hfp === currentFp;
              }));
              return (
                <div className="save-action">
                  <button
                    className={"pill-btn save-lp-btn" + (alreadySaved ? "" : " active")}
                    onClick={() => {
                      const updated = pushDualityHistory(lp);
                      setDyHistory(updated);
                    }}
                    disabled={alreadySaved}
                    title={alreadySaved ? t.alreadyInHistory : t.saveToHistory}
                  >
                    {alreadySaved ? `✓ ${t.alreadyInHistory}` : `💾 ${t.saveToHistory}`}
                  </button>
                </div>
              );
            })()}
            {dyHistory && dyHistory.length > 0 && (
              <div className="history-list">
                {dyHistory.map((h, i) => {
                  const currentFp = dualityLpFingerprint(lp);
                  const hfp = h.lp ? dualityLpFingerprint(h.lp) : h.fp;
                  const isCurrent = hfp === currentFp;
                  return (
                    <button
                      key={h.fp}
                      className={"history-item" + (isCurrent ? " is-current" : "")}
                      onClick={() => {
                        const newLp = JSON.parse(JSON.stringify(h.lp));
                        setLp(newLp);
                        setKnownX(new Array(newLp.c.length).fill(null));
                        setKnownY(new Array(newLp.constraints.length).fill(null));
                      }}
                      title={new Date(h.ts).toLocaleString()}
                    >
                      <span className="hi-obj">{h.lp.objective}</span>{" "}
                      <span className="hi-expr">{lpToTextOneLine(h.lp, t)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="section">
            <div className="section-title">
              {t.dyDualProblem}
              <span className="badge">{t.primalDualBadge}</span>
            </div>
            <DualBlock dual={dual} t={t} />
          </div>
        </div>

        {/* Right: known solution input + steps */}
        <div className="dy-col dy-col-right">
          <div className="section">
            <div className="section-title">{t.dyKnownSolution}</div>
            <div className="dy-known-tabs">
              <div className="seg">
                <button
                  className={knownType === "primal" ? "active" : ""}
                  onClick={() => setKnownType("primal")}
                  aria-pressed={knownType === "primal"}
                  dangerouslySetInnerHTML={{ __html: t.dyKnownPrimal }}
                />
                <button
                  className={knownType === "dual" ? "active" : ""}
                  onClick={() => setKnownType("dual")}
                  aria-pressed={knownType === "dual"}
                  dangerouslySetInnerHTML={{ __html: t.dyKnownDual }}
                />
              </div>
            </div>
            <div className="dy-vector-input">
              {knownType === "primal" ? (
                <>
                  <span className="dy-vec-label">x<sup>*</sup> =</span>
                  <span className="dy-vec-tuple">
                    {"("}
                    {knownX.map((v, j) => (
                      <React.Fragment key={j}>
                        <FracInput
                          value={v}
                          onChange={(nv) => {
                            const next = knownX.slice(); next[j] = nv;
                            setKnownX(next);
                          }}
                          ariaLabel={`x${j + 1}`}
                        />
                        {j < knownX.length - 1 && <span className="sep">,</span>}
                      </React.Fragment>
                    ))}
                    {")"}
                  </span>
                  <div className="dy-hint">{t.dyFractionHint}</div>
                </>
              ) : (
                <>
                  <span className="dy-vec-label">y<sup>*</sup> =</span>
                  <span className="dy-vec-tuple">
                    {"("}
                    {knownY.map((v, i) => (
                      <React.Fragment key={i}>
                        <FracInput
                          value={v}
                          onChange={(nv) => {
                            const next = knownY.slice(); next[i] = nv;
                            setKnownY(next);
                          }}
                          ariaLabel={`y_${i + 1}`}
                        />
                        {i < knownY.length - 1 && <span className="sep">,</span>}
                      </React.Fragment>
                    ))}
                    {")"}
                  </span>
                  <div className="dy-hint">{t.dyFractionHint}</div>
                </>
              )}
            </div>
          </div>

          <div className="section">
            <div className="section-title">
              {t.dyResolution}
              <span className={"badge " + (result.ok ? "ok" : "ko")}>
                {result.ok ? t.dySolved : (result.error ? t.dyError + ": " + tErr(t, result.error) : "")}
              </span>
            </div>
            <StepsView
              result={result}
              lp={lp}
              dual={dual}
              knownType={knownType}
              knownX={knownX}
              knownY={knownY}
              t={t}
            />
          </div>

          {sensitivity && (
            <div className="section">
              <div className="section-title">{t.sensitivity}</div>
              <DualitySensitivityPanel data={sensitivity} lp={lp} t={t} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function tErr(t, err) {
  const map = {
    "primal-infeasible": t.dyErrPrimalInfeasible,
    "dual-infeasible": t.dyErrDualInfeasible,
    "underdetermined": t.dyErrUnderdetermined,
    "inconsistent": t.dyErrInconsistent,
    "system-error": t.dyErrSystem,
    "exception": "exception",
  };
  return map[err] || err;
}

function StepsView({ result, lp, dual, knownType, knownX, knownY, t }) {
  let stepIdx = 0;
  const elems = [];

  for (const step of result.steps) {
    stepIdx++;
    if (step.kind === "primal-feasibility") {
      elems.push(
        <div className="dy-step" key={stepIdx}>
          <StepHeader idx={stepIdx} title={t.dyStepPrimalFeas} />
          <FeasibilityRow feasible={step.feasible} issues={step.issues} t={t} lp={lp} isDual={false} partial={step.partial} />
        </div>
      );
    } else if (step.kind === "primal-active") {
      elems.push(
        <div className="dy-step" key={stepIdx}>
          <StepHeader idx={stepIdx} title={t.dyStepPrimalActive} />
          <div className="dy-step-body">
            <div className="dy-explain">{t.dyExplainPrimalActive}</div>
            <PrimalActiveTable constraints={step.constraints} xStar={knownX} lp={lp} t={t} />
          </div>
        </div>
      );
    } else if (step.kind === "y-zero-from-inactive") {
      elems.push(
        <div className="dy-step" key={stepIdx}>
          <StepHeader idx={stepIdx} title={t.dyStepYZero} />
          <div className="dy-step-body">
            <div className="dy-explain">{t.dyExplainYZero}</div>
            {step.zeros.length > 0 ? (
              <div className="dy-deductions">
                {step.zeros.map((i) => (
                  <span key={i} className="dy-deduction">
                    <VarName name={`y_${i + 1}`} /><sup>*</sup><span className="dy-eq">=</span> 0
                  </span>
                ))}
              </div>
            ) : (
              <div className="dy-note">{t.dyNoZeroDual}</div>
            )}
            {step.frees.length > 0 && (
              <div className="dy-frees">
                {t.dyFree}: {step.frees.map((i) => `y_${i + 1}`).join(", ")}
              </div>
            )}
          </div>
        </div>
      );
    } else if (step.kind === "x-positive") {
      elems.push(
        <div className="dy-step" key={stepIdx}>
          <StepHeader idx={stepIdx} title={t.dyStepXPositive} />
          <div className="dy-step-body">
            <div className="dy-explain">{t.dyExplainXPositive}</div>
            {step.positive.length > 0 ? (
              <div className="dy-deductions">
                {step.positive.map((j) => (
                  <span key={j} className="dy-deduction">
                    <VarName name={lp.varNames[j]} /><sup>*</sup> ≠ 0 ⇒ <span className="dy-tag active">D{j + 1} {t.dyActive}</span>
                  </span>
                ))}
              </div>
            ) : step.unknown && step.unknown.length > 0 ? (
              <div className="dy-note">{t.dyNoKnownNonzeroX}</div>
            ) : (
              <div className="dy-note">{t.dyAllXZero}</div>
            )}
            {step.unknown && step.unknown.length > 0 && (
              <div className="dy-note">
                {t.dyUnknownComponents}: {step.unknown.map((j) => lp.varNames[j].replace("_", "")).join(", ")}
              </div>
            )}
          </div>
        </div>
      );
    } else if (step.kind === "dual-active") {
      elems.push(
        <div className="dy-step" key={stepIdx}>
          <StepHeader idx={stepIdx} title={t.dyStepDualActive} />
          <div className="dy-step-body">
            <div className="dy-explain">{t.dyExplainDualActive}</div>
            <DualActiveTable constraints={step.constraints} yStar={knownY} t={t} />
          </div>
        </div>
      );
    } else if (step.kind === "x-zero-from-inactive") {
      elems.push(
        <div className="dy-step" key={stepIdx}>
          <StepHeader idx={stepIdx} title={t.dyStepXZero} />
          <div className="dy-step-body">
            <div className="dy-explain">{t.dyExplainXZero}</div>
            {step.zeros.length > 0 ? (
              <div className="dy-deductions">
                {step.zeros.map((j) => (
                  <span key={j} className="dy-deduction">
                    <VarName name={lp.varNames[j]} /><sup>*</sup><span className="dy-eq">=</span> 0
                  </span>
                ))}
              </div>
            ) : (
              <div className="dy-note">{t.dyNoZeroPrimal}</div>
            )}
            {step.frees.length > 0 && (
              <div className="dy-frees">
                {t.dyFree}: {step.frees.map((j) => lp.varNames[j].replace("_", "")).join(", ")}
              </div>
            )}
          </div>
        </div>
      );
    } else if (step.kind === "y-positive") {
      elems.push(
        <div className="dy-step" key={stepIdx}>
          <StepHeader idx={stepIdx} title={t.dyStepYPositive} />
          <div className="dy-step-body">
            <div className="dy-explain">{t.dyExplainYPositive}</div>
            {step.positive.length > 0 ? (
              <div className="dy-deductions">
                {step.positive.map((i) => (
                  <span key={i} className="dy-deduction">
                    <VarName name={`y_${i + 1}`} /><sup>*</sup> ≠ 0 ⇒ <span className="dy-tag active">C{i + 1} {t.dyActive}</span>
                  </span>
                ))}
              </div>
            ) : step.unknown && step.unknown.length > 0 ? (
              <div className="dy-note">{t.dyNoKnownNonzeroY}</div>
            ) : (
              <div className="dy-note">{t.dyAllYZero}</div>
            )}
            {step.unknown && step.unknown.length > 0 && (
              <div className="dy-note">
                {t.dyUnknownComponents}: {step.unknown.map((i) => `y_${i + 1}`).join(", ")}
              </div>
            )}
          </div>
        </div>
      );
    } else if (step.kind === "system") {
      elems.push(
        <div className="dy-step" key={stepIdx}>
          <StepHeader idx={stepIdx} title={t.dyStepSystem} />
          <div className="dy-step-body">
            <div className="dy-explain">{t.dyExplainSystem}</div>
            <SystemView eqs={step.eqs} unknowns={step.unknowns} varSymbol={step.varSymbol} t={t} />
          </div>
        </div>
      );
    } else if (step.kind === "underdetermined") {
      elems.push(
        <div className="dy-step ko" key={stepIdx}>
          <StepHeader idx={stepIdx} title={t.dyStepUnderdetermined} />
          <div className="dy-step-body">
            <div className="dy-explain">
              {t.dyExplainUnderdetermined(step.numEq, step.numUnknowns)}
            </div>
          </div>
        </div>
      );
    } else if (step.kind === "inconsistent") {
      elems.push(
        <div className="dy-step ko" key={stepIdx}>
          <StepHeader idx={stepIdx} title={t.dyStepInconsistent} />
          <div className="dy-step-body">
            <div className="dy-explain">
              {t.dyExplainInconsistent(Simplex.fmt(step.lhs, 3), Simplex.fmt(step.rhs, 3))}
            </div>
          </div>
        </div>
      );
    } else if (step.kind === "system-error") {
      elems.push(
        <div className="dy-step ko" key={stepIdx}>
          <StepHeader idx={stepIdx} title={t.dyStepSystemError} />
          <div className="dy-step-body">
            <div className="dy-explain">{t.dyExplainSystemError}</div>
          </div>
        </div>
      );
    } else if (step.kind === "solution-dual") {
      elems.push(
        <div className="dy-step solved" key={stepIdx}>
          <StepHeader idx={stepIdx} title={t.dyStepSolutionDual} />
          <div className="dy-step-body">
            <SolutionVector values={step.y} symbol="y" t={t} />
          </div>
        </div>
      );
    } else if (step.kind === "solution-dual-range") {
      elems.push(
        <div className="dy-step solved" key={stepIdx}>
          <StepHeader idx={stepIdx} title={t.dyStepSolutionDualRange} />
          <div className="dy-step-body">
            <div className="dy-explain">{t.dyExplainRange}</div>
            <SolutionRange range={step.range} symbol="y" t={t} />
          </div>
        </div>
      );
    } else if (step.kind === "solution-primal") {
      elems.push(
        <div className="dy-step solved" key={stepIdx}>
          <StepHeader idx={stepIdx} title={t.dyStepSolutionPrimal} />
          <div className="dy-step-body">
            <SolutionVector values={step.x} symbol="x" t={t} />
          </div>
        </div>
      );
    } else if (step.kind === "solution-primal-range") {
      elems.push(
        <div className="dy-step solved" key={stepIdx}>
          <StepHeader idx={stepIdx} title={t.dyStepSolutionPrimalRange} />
          <div className="dy-step-body">
            <div className="dy-explain">{t.dyExplainRange}</div>
            <SolutionRange range={step.range} symbol="x" t={t} />
          </div>
        </div>
      );
    } else if (step.kind === "dual-feasibility") {
      elems.push(
        <div className="dy-step" key={stepIdx}>
          <StepHeader idx={stepIdx} title={t.dyStepDualFeas} />
          <FeasibilityRow feasible={step.feasible} issues={step.issues} t={t} isDual={true} partial={step.partial} parametric={step.parametric} />
        </div>
      );
    } else if (step.kind === "primal-feasibility-final") {
      elems.push(
        <div className="dy-step" key={stepIdx}>
          <StepHeader idx={stepIdx} title={t.dyStepPrimalFeas} />
          <FeasibilityRow feasible={step.feasible} issues={step.issues} t={t} isDual={false} partial={step.partial} parametric={step.parametric} />
        </div>
      );
    } else if (step.kind === "objective-values") {
      const z = step.z;
      const w = step.w;
      const zDir = step.zDir || 0;
      const wDir = step.wDir || 0;
      const param = step.param;
      const zKnown = z !== null && z !== undefined;
      const wKnown = w !== null && w !== undefined;
      const matches = zKnown && wKnown && Math.abs(z - w) < 1e-6 && Math.abs(zDir - wDir) < 1e-6;
      const valueNode = (base, dir) => {
        if (base === null || base === undefined) return "?";
        if (param && Math.abs(dir || 0) > 1e-9) return <AffineExpr base={base} coef={dir || 0} param={param} />;
        return <FracDisplay value={base} />;
      };
      elems.push(
        <div className="dy-step" key={stepIdx}>
          <StepHeader idx={stepIdx} title={t.dyStepStrongDuality} />
          <div className="dy-step-body">
            <div className="dy-strong-duality">
              <span>z = c<sup>T</sup>x<sup>*</sup> = {valueNode(z, zDir)}</span>
              <span className="sep">·</span>
              <span>w = b<sup>T</sup>y<sup>*</sup> = {valueNode(w, wDir)}</span>
              <span className="sep">·</span>
              <span className={matches ? "dy-tag active" : "dy-tag inactive"}>
                {matches ? `✓ z = w (${t.dyStrongDuality})` : `✗ z ≠ w`}
              </span>
            </div>
          </div>
        </div>
      );
    }
  }

  if (elems.length === 0) {
    return <div className="dy-note">{t.dyNoSteps}</div>;
  }

  return <div className="dy-steps">{elems}</div>;
}

Object.assign(window, { DualityWorkspace });
