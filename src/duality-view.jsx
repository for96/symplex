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
  const obj = lp.c
    .map((v, j) => {
      if (v === 0) return null;
      const sign = v > 0 ? (j === 0 ? "" : "+") : "−";
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
  if (t === "") return 0;
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
    if (v !== null) onChange(v);
  }
  return (
    <input
      type="text"
      className="frac-input"
      value={text}
      onFocus={() => { setFocused(true); setText(""); }}
      onChange={(e) => commit(e.target.value)}
      onBlur={() => { setFocused(false); setText(formatFracInput(value)); }}
      aria-label={ariaLabel || ""}
    />
  );
}

// Compact LP editor used only inside the duality workspace. Adds/removes rows
// and variables but does NOT touch var bounds, ILP toggle or LP history —
// those live in the simplex workspace and would just be noise here.
function DualityLPEditor({ lp, setLp, t }) {
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
  );
}

// Right-hand panel: the dual problem.
function DualBlock({ dual, t }) {
  const fmt = Simplex.fmt;
  const term = (v, j, names) => {
    if (v === 0) return null;
    const sign = v > 0 ? "+" : "−";
    const abs = Math.abs(v);
    const coef = abs === 1 ? "" : fmt(abs);
    return (
      <React.Fragment key={j}>
        {" "}
        <span className="mono dual-sign">{j === 0 && v > 0 ? "" : sign}</span>{" "}
        <span className="mono">{coef}</span>
        <VarName name={names[j]} />
      </React.Fragment>
    );
  };
  return (
    <div className="dual-block">
      <span className="dual-line">
        <span className="dual-sign">{dual.objective}</span>{" "}
        <span style={{ fontStyle: "italic" }}>w</span> ={" "}
        {dual.c.map((v, j) => term(v, j, dual.varNames))}
      </span>
      <span className="dual-line dual-sign">{t.subjectTo}</span>
      {dual.constraints.map((c, i) => (
        <span className="dual-line" key={i}>
          {"  "}
          {c.a.map((v, j) => term(v, j, dual.varNames))}{" "}
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
      <span className="dy-step-num">{idx}.</span> <span className="dy-step-title">{title}</span>
    </div>
  );
}

function FeasibilityRow({ feasible, issues, t, lp, dual, isDual }) {
  return (
    <div className={"dy-feas " + (feasible ? "ok" : "ko")}>
      {feasible ? `✓ ${t.dyFeasible}` : `✗ ${t.dyInfeasible}`}
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
          <th>a<sub>i</sub><sup>T</sup> x*</th>
          <th>b<sub>i</sub></th>
          <th>{t.dyStatus}</th>
        </tr>
      </thead>
      <tbody>
        {constraints.map((c, i) => (
          <tr key={i} className={c.active ? "active" : "inactive"}>
            <td>C{i + 1}</td>
            <td><FracDisplay value={c.lhs} /></td>
            <td><FracDisplay value={c.b} /></td>
            <td>
              {c.op === "=" ? (
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
          <th>y*<sup>T</sup> A<sub>j</sub></th>
          <th>c<sub>j</sub></th>
          <th>{t.dyStatus}</th>
        </tr>
      </thead>
      <tbody>
        {constraints.map((c, j) => (
          <tr key={j} className={c.active ? "active" : "inactive"}>
            <td>D{j + 1}</td>
            <td><FracDisplay value={c.lhs} /></td>
            <td><FracDisplay value={c.b} /></td>
            <td>
              {c.active ? (
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
        {eqs.map((e, r) => (
          <tr key={r}>
            {e.coefs.map((co, k) => (
              <React.Fragment key={k}>
                <td className={"dy-coef " + (k === 0 ? "first" : "")}>
                  {k > 0 && (co >= 0 ? "+" : "−")}
                  {Math.abs(co) === 1 ? "" : Simplex.fmt(Math.abs(co), 2)}
                </td>
                <td className="dy-var">
                  <VarName name={`${varSymbol}_${unknowns[k] + 1}`} />
                </td>
              </React.Fragment>
            ))}
            <td className="dy-eq">=</td>
            <td className="dy-rhs"><FracDisplay value={e.rhs} /></td>
          </tr>
        ))}
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
          <span className="dy-eq">*</span>
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

function DualityWorkspace({ t }) {
  const [lp, setLp] = useStateD(DUALITY_DEFAULT_LP);
  const [knownType, setKnownType] = useStateD("primal"); // "primal" or "dual"
  const [knownX, setKnownX] = useStateD(DUALITY_DEFAULT_X);
  const [knownY, setKnownY] = useStateD([0, 0, 0]);
  const [dyHistory, setDyHistory] = useStateD(() => loadDualityHistory());

  // Keep the size of knownX / knownY / varSigns in sync with the LP shape. We don't reset
  // values on every coefficient edit, only when the dimensions change.
  useEffectD(() => {
    if (knownX.length !== lp.c.length) {
      const next = new Array(lp.c.length).fill(0);
      for (let j = 0; j < Math.min(knownX.length, lp.c.length); j++) next[j] = knownX[j];
      setKnownX(next);
    }
    if (!lp.varSigns || lp.varSigns.length !== lp.c.length) {
      const nextSigns = lp.varSigns ? lp.varSigns.slice(0, lp.c.length) : [];
      while (nextSigns.length < lp.c.length) nextSigns.push(">= 0");
      setLp({ ...lp, varSigns: nextSigns });
    }
  }, [lp.c.length]);
  useEffectD(() => {
    if (knownY.length !== lp.constraints.length) {
      const next = new Array(lp.constraints.length).fill(0);
      for (let i = 0; i < Math.min(knownY.length, lp.constraints.length); i++) next[i] = knownY[i];
      setKnownY(next);
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
                      onClick={() => setLp(JSON.parse(JSON.stringify(h.lp)))}
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
                >
                  {t.dyKnownPrimal}
                </button>
                <button
                  className={knownType === "dual" ? "active" : ""}
                  onClick={() => setKnownType("dual")}
                  aria-pressed={knownType === "dual"}
                >
                  {t.dyKnownDual}
                </button>
              </div>
            </div>
            <div className="dy-vector-input">
              {knownType === "primal" ? (
                <>
                  <span className="dy-vec-label">x* =</span>
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
                  <span className="dy-vec-label">y* =</span>
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
          <FeasibilityRow feasible={step.feasible} issues={step.issues} t={t} lp={lp} isDual={false} />
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
                    <VarName name={`y_${i + 1}`} /><span className="dy-eq">*</span><span className="dy-eq">=</span> 0
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
                    <VarName name={lp.varNames[j]} /><span className="dy-eq">*</span> &gt; 0 ⇒ <span className="dy-tag active">D{j + 1} {t.dyActive}</span>
                  </span>
                ))}
              </div>
            ) : (
              <div className="dy-note">{t.dyAllXZero}</div>
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
                    <VarName name={lp.varNames[j]} /><span className="dy-eq">*</span><span className="dy-eq">=</span> 0
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
                    <VarName name={`y_${i + 1}`} /><span className="dy-eq">*</span> &gt; 0 ⇒ <span className="dy-tag active">C{i + 1} {t.dyActive}</span>
                  </span>
                ))}
              </div>
            ) : (
              <div className="dy-note">{t.dyAllYZero}</div>
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
    } else if (step.kind === "solution-primal") {
      elems.push(
        <div className="dy-step solved" key={stepIdx}>
          <StepHeader idx={stepIdx} title={t.dyStepSolutionPrimal} />
          <div className="dy-step-body">
            <SolutionVector values={step.x} symbol="x" t={t} />
          </div>
        </div>
      );
    } else if (step.kind === "dual-feasibility") {
      elems.push(
        <div className="dy-step" key={stepIdx}>
          <StepHeader idx={stepIdx} title={t.dyStepDualFeas} />
          <FeasibilityRow feasible={step.feasible} issues={step.issues} t={t} isDual={true} />
        </div>
      );
    } else if (step.kind === "primal-feasibility-final") {
      elems.push(
        <div className="dy-step" key={stepIdx}>
          <StepHeader idx={stepIdx} title={t.dyStepPrimalFeas} />
          <FeasibilityRow feasible={step.feasible} issues={step.issues} t={t} isDual={false} />
        </div>
      );
    } else if (step.kind === "objective-values") {
      // Compute z* / w* directly from inputs / result for clean display
      const xUsed = knownType === "primal"
        ? knownX
        : (result.x || []);
      const yUsed = knownType === "primal"
        ? (result.y || [])
        : knownY;
      const z = xUsed.length ? lp.c.reduce((s, c, j) => s + c * (xUsed[j] || 0), 0) : null;
      const w = yUsed.length ? dual.c.reduce((s, c, i) => s + c * (yUsed[i] || 0), 0) : null;
      const matches = z !== null && w !== null && Math.abs(z - w) < 1e-6;
      elems.push(
        <div className="dy-step" key={stepIdx}>
          <StepHeader idx={stepIdx} title={t.dyStepStrongDuality} />
          <div className="dy-step-body">
            <div className="dy-strong-duality">
              <span>z = c<sup>T</sup>x* = <FracDisplay value={z} /></span>
              <span className="sep">·</span>
              <span>w = b<sup>T</sup>y* = <FracDisplay value={w} /></span>
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
