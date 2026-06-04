/* global React */
// Problem input — structured & text editors, dual viewer.

const { useState, useEffect, useRef, useMemo } = React;

function VarName({ name }) {
  const safeName = String(name || "x");
  // Render "x1" (or legacy "x_1" from saved history) as x with subscript 1
  const m = safeName.match(/^([a-zA-Z]+)_?(\d+)?$/);
  if (m && m[2]) {
    return (
      <span className="var-name">
        {m[1]}
        <sub>{m[2]}</sub>
      </span>
    );
  }
  return <span className="var-name">{safeName}</span>;
}

function CoefInput({ value, onChange }) {
  // On mobile, tapping an input usually drops the cursor at the tap position,
  // making it tedious to overwrite the existing value. We mirror the displayed
  // text in a local `draft` while the input is focused: focus clears it, so
  // typing a new number immediately replaces the old. On blur we drop the draft
  // and snap back to the canonical parent value (so an accidental tap doesn't
  // destroy data).
  const [draft, setDraft] = useState(null);
  const [pendingNegative, setPendingNegative] = useState(false);
  const shown = draft !== null ? draft : value;
  const isNegative = pendingNegative || String(shown).startsWith("-");

  function parsedNumber(raw) {
    const n = parseFloat(String(raw).replace(",", "."));
    return isNaN(n) ? null : n;
  }

  function commitRaw(raw) {
    let next = raw;
    if (pendingNegative && raw !== "" && !String(raw).startsWith("-")) {
      next = `-${raw}`;
      setPendingNegative(false);
    }
    setDraft(next);
    if (next !== "" && next !== "-" && next !== "." && next !== "-.") {
      const v = parsedNumber(next);
      if (v !== null) onChange(v);
    }
  }

  function toggleSign(e) {
    e.preventDefault();
    e.stopPropagation();
    const raw = draft !== null ? String(draft) : String(value ?? "");
    if (raw === "" || raw === "-") {
      setDraft("");
      setPendingNegative((v) => !v);
      return;
    }
    const next = raw.startsWith("-") ? raw.slice(1) : `-${raw}`;
    setPendingNegative(false);
    setDraft(next);
    const v = parsedNumber(next);
    if (v !== null) onChange(v);
  }

  return (
    <span className={"coef-input-wrap" + (isNegative ? " is-negative" : "")}>
      <input
        type="number"
        step="any"
        inputMode="decimal"
        value={shown}
        onFocus={() => {
          setDraft("");
          setPendingNegative(false);
        }}
        onChange={(e) => commitRaw(e.target.value)}
        onBlur={() => {
          setDraft(null);
          setPendingNegative(false);
        }}
      />
      <button
        type="button"
        className="coef-sign-btn"
        aria-label="Cambia segno"
        tabIndex={-1}
        onPointerDown={toggleSign}
      >
        -
      </button>
    </span>
  );
}

// Same tap-to-clear behaviour for the upper-bound field. It's a text input
// (accepts "∞" / "inf" / empty for Infinity), so we can't reuse CoefInput.
function VbUbInput({ value, isBinary, onChange }) {
  const [draft, setDraft] = useState(null);
  const formatted = isBinary ? "1" : (isFinite(value) ? String(value) : "∞");
  return (
    <input
      type="text"
      className="vb-ub"
      value={draft !== null ? draft : formatted}
      onFocus={() => setDraft("")}
      onChange={(e) => {
        const v = e.target.value;
        setDraft(v);
        if (v === "" || v === "∞" || v.toLowerCase() === "inf") onChange(Infinity);
        else {
          const n = parseFloat(v);
          if (!isNaN(n)) onChange(n);
        }
      }}
      onBlur={() => setDraft(null)}
      disabled={isBinary}
      aria-label="upper bound"
    />
  );
}

function ensureLPBounds(lp) {
  const bounds = (lp.varBounds || []).slice();
  while (bounds.length < lp.c.length) bounds.push({ kind: "continuous", ub: Infinity });
  return bounds.map((b) => {
    const ub = (typeof b.ub === "number" && isFinite(b.ub)) ? b.ub : Infinity;
    return { ...b, ub };
  });
}

function defaultVarName(j) {
  return `x${j + 1}`;
}

function lpVarNames(lp) {
  const n = (lp.c || []).length;
  const names = (lp.varNames || []).slice();
  while (names.length < n) names.push(defaultVarName(names.length));
  return names;
}

function ProblemEditor({ lp, setLp, t, lpHistory, currentFp, onSaveLp, onClearHistory }) {
  const [mode, setMode] = useState("structured");
  const [text, setText] = useState(() => lpToText(lp));
  const [textErr, setTextErr] = useState("");
  const lpType = lp.type || "lp";
  const names = lpVarNames(lp);

  useEffect(() => {
    setText(lpToText(lp));
  }, [lp]);

  function updateObjective(v) {
    setLp({ ...lp, objective: v });
  }
  function updateC(i, v) {
    const c = lp.c.slice();
    c[i] = v;
    setLp({ ...lp, c });
  }
  function updateConstr(i, key, v) {
    const cs = lp.constraints.map((c) => ({ ...c, a: c.a.slice() }));
    if (key === "op") cs[i].op = v;
    else if (key === "b") cs[i].b = v;
    setLp({ ...lp, constraints: cs });
  }
  function updateA(i, j, v) {
    const cs = lp.constraints.map((c) => ({ ...c, a: c.a.slice() }));
    cs[i].a[j] = v;
    setLp({ ...lp, constraints: cs });
  }
  function addConstr() {
    const newA = new Array(lp.c.length).fill(0);
    newA[0] = 1;
    setLp({
      ...lp,
      constraints: [...lp.constraints, { a: newA, op: "<=", b: 1 }],
    });
  }
  function removeConstr(i) {
    if (lp.constraints.length <= 1) return;
    setLp({
      ...lp,
      constraints: lp.constraints.filter((_, idx) => idx !== i),
    });
  }
  function addVariable() {
    const n = lp.c.length;
    const usedNames = new Set(names);
    let k = n + 1;
    let newName = `x${k}`;
    while (usedNames.has(newName)) {
      k += 1;
      newName = `x${k}`;
    }
    const bounds = (lp.varBounds || []).slice();
    while (bounds.length < n) bounds.push({ kind: "continuous", ub: Infinity });
    bounds.push({ kind: "continuous", ub: Infinity });
    setLp({
      ...lp,
      c: [...lp.c, 0],
      varNames: [...names, newName],
      constraints: lp.constraints.map((cs) => ({ ...cs, a: [...cs.a, 0] })),
      varBounds: bounds,
    });
  }
  function removeVariable(j) {
    if (lp.c.length <= 1) return;
    const bounds = (lp.varBounds || []).slice();
    while (bounds.length < lp.c.length) bounds.push({ kind: "continuous", ub: Infinity });
    setLp({
      ...lp,
      c: lp.c.filter((_, i) => i !== j),
      varNames: names.filter((_, i) => i !== j),
      constraints: lp.constraints.map((cs) => ({ ...cs, a: cs.a.filter((_, i) => i !== j) })),
      varBounds: bounds.filter((_, i) => i !== j),
    });
  }
  function applyText() {
    try {
      const parsed = parseText(text, t);
      // preserve current type & varBounds when applying text edits
      const merged = { ...parsed, type: lp.type || "lp", varBounds: ensureLPBounds({ ...parsed, varBounds: lp.varBounds }) };
      setLp(merged);
      setTextErr("");
    } catch (e) {
      setTextErr(e.message);
    }
  }
  function setLpType(newType) {
    // Switching to LP collapses all kinds to "continuous".
    // Switching to ILP defaults previously-continuous vars to "integer" (preserving
    // any existing integer/binary kinds). Otherwise the cut detection finds no
    // integer-required variable and the cuts are wrongly reported as unavailable.
    const bounds = ensureLPBounds(lp);
    const newBounds = newType === "lp"
      ? bounds.map((b) => ({ kind: "continuous", ub: b.ub }))
      : bounds.map((b) => b.kind === "continuous" ? { ...b, kind: "integer" } : b);
    setLp({ ...lp, type: newType, varBounds: newBounds });
  }
  function setVarKind(j, kind) {
    const bounds = ensureLPBounds(lp);
    bounds[j] = { ...bounds[j], kind };
    setLp({ ...lp, varBounds: bounds });
  }
  function setVarUb(j, ub) {
    const bounds = ensureLPBounds(lp);
    bounds[j] = { ...bounds[j], ub };
    setLp({ ...lp, varBounds: bounds });
  }

  const bounds = ensureLPBounds(lp);

  return (
    <div className="section" data-screen-label="input">
      <div className="section-title">
        {t.problem}
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

      <div className="lp-type-row" role="group" aria-label={t.programType}>
        <span className="lp-type-label">{t.programType}</span>
        <div className="seg">
          <button
            className={lpType === "lp" ? "active" : ""}
            onClick={() => setLpType("lp")}
            title={t.lpTypeLong}
            aria-pressed={lpType === "lp"}
          >
            {t.lpType}
          </button>
          <button
            className={lpType === "ilp" ? "active" : ""}
            onClick={() => setLpType("ilp")}
            title={t.ilpTypeLong}
            aria-pressed={lpType === "ilp"}
          >
            {t.ilpType}
          </button>
        </div>
      </div>

      {mode === "structured" ? (
        <div>
          <div className="obj-row">
            <div className="obj-label">
              <select
                className="op-select"
                value={lp.objective}
                onChange={(e) => updateObjective(e.target.value)}
              >
                <option value="max">{t.max}</option>
                <option value="min">{t.min}</option>
              </select>
            </div>
            <div className="coef-line">
              <span className="coef-z" style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}>z =</span>
              {lp.c.map((v, j) => (
                <React.Fragment key={j}>
                  <span className="coef-term">
                    <CoefInput value={v} onChange={(nv) => updateC(j, nv)} />
                    <VarName name={names[j]} />
                  </span>
                  {j < lp.c.length - 1 && <span className="coef-plus">+</span>}
                </React.Fragment>
              ))}
            </div>
          </div>

          <div className="obj-row" style={{ marginTop: 8 }}>
            <div className="sub-label">{t.subjectTo}</div>
            <div></div>
          </div>

          {lp.constraints.map((c, i) => (
            <div className="constr-row" key={i}>
              <div></div>
              <div className="coef-line">
                {c.a.map((v, j) => (
                  <React.Fragment key={j}>
                    <span className="coef-term">
                      <CoefInput value={v} onChange={(nv) => updateA(i, j, nv)} />
                      <VarName name={names[j]} />
                    </span>
                    {j < c.a.length - 1 && <span className="coef-plus">+</span>}
                  </React.Fragment>
                ))}
                <span className="coef-rhs">
                  <select
                    className="op-select"
                    value={c.op}
                    onChange={(e) => updateConstr(i, "op", e.target.value)}
                  >
                    <option value="<=">≤</option>
                    <option value="=">=</option>
                    <option value=">=">≥</option>
                  </select>
                  <CoefInput
                    value={c.b}
                    onChange={(nv) => updateConstr(i, "b", nv)}
                  />
                  <button
                    className="rm-btn"
                    title={t.removeConstraint}
                    aria-label={t.ariaRemoveConstraint}
                    onClick={() => removeConstr(i)}
                  >
                    ×
                  </button>
                </span>
              </div>
            </div>
          ))}
          <div className="editor-actions">
            <button className="pill-btn" onClick={addConstr}>
              {t.addConstraint}
            </button>
            <button className="pill-btn" onClick={addVariable}>
              + {t.addVariable}
            </button>
          </div>
        </div>
      ) : (
        <div>
          <textarea
            className="text-editor"
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck="false"
          />
          {textErr && <div className="text-err">⚠ {textErr}</div>}
          <div className="editor-actions">
            <button className="pill-btn active" onClick={applyText}>
              {t.apply}
            </button>
            <button
              className="pill-btn"
              onClick={() => setText(lpToText(lp))}
            >
              {t.reset}
            </button>
          </div>
        </div>
      )}

      <hr className="rule" />
      <div className="section-title" style={{ marginBottom: 6 }}>{t.varBoundsSection}</div>
      <div className="var-bounds">
        {lp.c.map((_, j) => {
          const b = bounds[j];
          const isBinary = b.kind === "binary";
          return (
            <div className="var-bound-row" key={j}>
              <span className="vb-name"><VarName name={names[j]} /></span>
              <select
                className="op-select"
                value={b.kind}
                onChange={(e) => setVarKind(j, e.target.value)}
                aria-label={t.varKind}
              >
                <option value="continuous">{t.varKindContinuous}</option>
                <option value="integer" disabled={lpType === "lp"}>{t.varKindInteger}</option>
                <option value="binary" disabled={lpType === "lp"}>{t.varKindBinary}</option>
              </select>
              <span className="vb-bound-pair">
                <span className="vb-mono">0 ≤ {names[j].replace("_", "")} ≤</span>
                <VbUbInput
                  value={b.ub}
                  isBinary={isBinary}
                  onChange={(nv) => setVarUb(j, nv)}
                />
              </span>
              {lp.c.length > 1 && (
                <button
                  className="rm-btn"
                  title={t.removeVariable}
                  aria-label={t.removeVariable}
                  onClick={() => removeVariable(j)}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>

      <hr className="rule" />
      <div className="section-title" style={{ marginBottom: 6 }}>
        {t.history}
        {lpHistory && lpHistory.length > 0 && (
          <button
            className="pill-btn"
            style={{ fontSize: 10, padding: "2px 8px" }}
            onClick={onClearHistory}
            title={t.clearHistory}
            aria-label={t.ariaClearHistory}
          >
            ×
          </button>
        )}
      </div>
      {(() => {
        const alreadySaved = !!(lpHistory && currentFp && lpHistory.some((h) => h.fp === currentFp));
        return (
          <div className="save-action">
            <button
              className={"pill-btn save-lp-btn" + (alreadySaved ? "" : " active")}
              onClick={onSaveLp}
              disabled={alreadySaved}
              title={alreadySaved ? t.alreadyInHistory : t.saveToHistory}
            >
              {alreadySaved ? `✓ ${t.alreadyInHistory}` : `💾 ${t.saveToHistory}`}
            </button>
          </div>
        );
      })()}
      {lpHistory && lpHistory.length > 0 && (
        <div className="history-list">
          {lpHistory.map((h, i) => {
            const isCurrent = currentFp && h.fp === currentFp;
            return (
              <button
                key={h.fp}
                className={"history-item" + (isCurrent ? " is-current" : "")}
                onClick={() => setLp(JSON.parse(JSON.stringify(h.lp)))}
                title={new Date(h.ts).toLocaleString()}
              >
                <span className={`hi-type hi-type-${(h.lp.type || "lp")}`}>
                  {(h.lp.type || "lp") === "ilp" ? t.ilpType : t.lpType}
                </span>
                <span className="hi-obj">{h.lp.objective}</span>{" "}
                <span className="hi-expr">{lpToTextOneLine(h.lp, t)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function lpToTextOneLine(lp, t) {
  const names = lpVarNames(lp);
  const obj = lp.c
    .map((v, j) => {
      if (v === 0) return null;
      const sign = v > 0 ? (j === 0 ? "" : "+") : "−";
      const abs = Math.abs(v);
      const c = abs === 1 ? "" : abs;
      return `${sign}${c}${names[j].replace("_", "")}`;
    })
    .filter(Boolean)
    .join("");
  const abbr = (t && t.constraintsAbbr) || "constr.";
  return `${obj} · ${lp.constraints.length} ${abbr}`;
}

function lpToText(lp) {
  const names = lpVarNames(lp);
  const sign = (v, first) => {
    if (v === 0) return "";
    if (v > 0) return first ? `${v}` : ` + ${v}`;
    return first ? `${v}` : ` - ${Math.abs(v)}`;
  };
  let s = `${lp.objective} z = `;
  const objTerms = lp.c
    .map((v, j) => `${sign(v, j === 0)}${formatVar(names[j])}`)
    .filter(Boolean)
    .join("");
  s += objTerms || "0";
  s += "\nsubject to\n";
  for (const c of lp.constraints) {
    s += "  ";
    const lhsTerms = c.a
      .map((v, j) => `${sign(v, j === 0)}${formatVar(names[j])}`)
      .filter(Boolean)
      .join("");
    s += lhsTerms || "0";
    s += ` ${c.op === "<=" ? "<=" : c.op === ">=" ? ">=" : "="} ${c.b}\n`;
  }
  return s.trim();
}
function formatVar(n) {
  return String(n || "x").replace("_", "");
}

function parseText(text, t) {
  // Very forgiving parser for "max z = 1x1 + 2x2 \n 5x1+6x2<=30 \n x1-x2>=1"
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^subject to/i.test(l) && !/^s\.t\./i.test(l) && !/^soggetto a/i.test(l));
  if (lines.length < 2) throw new Error(t.errMinLines);
  const objLine = lines[0];
  const objMatch = objLine.match(/^(max|min)\b[\s\S]*?=\s*(.+)$/i);
  if (!objMatch) throw new Error(t.errObjLine);
  const objective = objMatch[1].toLowerCase();
  const objRhs = objMatch[2];
  let parsedObj;
  if (/^[+-]?\d*\.?\d+(?:[eE][+-]?\d+)?$/.test(objRhs.trim())) {
    parsedObj = { vars: [], coefs: [] };
  } else {
    parsedObj = parseExpr(objRhs, t);
  }
  const { vars, coefs } = parsedObj;
  const varNames = vars.map((v) => insertSub(v));
  const c = coefs;
  const constraints = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^(.+?)(<=|>=|=)(.+)$/);
    if (!m) throw new Error(t.errInvalidConstr(line));
    const lhs = m[1];
    const op = m[2];
    const rhs = parseFloat(m[3]);
    const { vars: lhVars, coefs: lhCoefs } = parseExpr(lhs, t);
    for (let k = 0; k < lhVars.length; k++) {
      if (vars.indexOf(lhVars[k]) === -1) {
        vars.push(lhVars[k]);
        varNames.push(insertSub(lhVars[k]));
        c.push(0);
        // Backfill previous constraints with 0
        for (const prev of constraints) {
          prev.a.push(0);
        }
      }
    }
    const a = new Array(varNames.length).fill(0);
    for (let k = 0; k < lhVars.length; k++) {
      const idx = vars.indexOf(lhVars[k]);
      a[idx] = lhCoefs[k];
    }
    constraints.push({ a, op, b: rhs });
  }
  return { objective, c, varNames, constraints };
}

function insertSub(v) {
  // Variables are stored without underscores (e.g. "x1") — the VarName component
  // splits the letter prefix from the digit suffix at render time for subscript
  // formatting. Kept as a no-op for symmetry with legacy callers.
  return v;
}

function parseExpr(expr, t) {
  const cleaned = expr.replace(/\s+/g, "").replace(/-/g, "+-");
  const terms = cleaned.split("+").filter((s) => s);
  const vars = [];
  const coefs = [];
  for (const term of terms) {
    const m = term.match(/^(-?\d*\.?\d*)\*?([a-zA-Z]+_?\d*)$/);
    if (!m) throw new Error(t.errInvalidTerm(term));
    let coef = m[1];
    if (coef === "" || coef === "+") coef = 1;
    else if (coef === "-") coef = -1;
    else coef = parseFloat(coef);
    const v = m[2].replace("_", "");
    const idx = vars.indexOf(v);
    if (idx === -1) {
      vars.push(v);
      coefs.push(coef);
    } else {
      coefs[idx] += coef;
    }
  }
  return { vars, coefs };
}

function DualPanel({ lp, state, t }) {
  const dual = useMemo(() => window.Simplex.buildDual(lp), [lp]);
  const names = lpVarNames(lp);
  const fmt = window.Simplex.fmt;
  const Frac = window.Frac;
  const term = (v, j, names) => {
    if (v === 0) return null;
    const sign = v > 0 ? "+" : "-";
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

  const isOptimal = state && state.status === "optimal";
  const xStar = isOptimal ? window.Simplex.decisionPoint(state) : null;
  const yStar = isOptimal ? window.Simplex.dualValues(state) : null;
  const zStar = isOptimal ? window.Simplex.objectiveValue(state) : null;

  return (
    <div className="section" data-screen-label="dual">
      <div className="section-title">
        {t.dual}
        <span className="badge">{t.primalDualBadge}</span>
      </div>
      <div className="dual-block">
        <span className="dual-line">
          <span className="dual-sign">{dual.objective}</span>{" "}
          <span style={{ fontStyle: "italic" }}>w</span> ={" "}
          {dual.c.map((v, j) => term(v, j, dual.varNames))}
        </span>
        <span className="dual-line dual-sign">subject to</span>
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
    </div>
  );
}

Object.assign(window, {
  ProblemEditor,
  DualPanel,
  VarName,
  CoefInput,
  LPText: { lpToText, parseText },
});
