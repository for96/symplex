/* global React, Simplex */
// Tableau view, step controls, sensitivity, narration.

const { useMemo: useMemoT } = React;

function Frac({ value }) {
  if (!isFinite(value)) {
    return <span>{value > 0 ? "∞" : "−∞"}</span>;
  }
  const f = Simplex.toFraction(value);
  if (f.isInt) return <span>{f.num}</span>;
  if (Math.abs(f.num) > 9999 || f.den > 99) {
    return <span>{Simplex.fmt(value, 2)}</span>;
  }
  const sign = f.num < 0 ? "−" : "";
  return (
    <span className="frac">
      {sign}
      <span className="frac-stack">
        <span className="n">{Math.abs(f.num)}</span>
        <span className="d">{f.den}</span>
      </span>
    </span>
  );
}

// Tooltip text generators for tableau cells. Pure functions — no React state.
function tipColHeader(j, colLabels, colTypes, lang) {
  const lbl = colLabels[j];
  const type = colTypes[j];
  const it = lang === "it";
  if (type === "decision") return it ? `Variabile di decisione ${lbl}` : `Decision variable ${lbl}`;
  if (type === "slack") return it ? `Variabile di scarto ${lbl}` : `Slack variable ${lbl}`;
  if (type === "artificial") return it ? `Variabile artificiale ${lbl} (fase I)` : `Artificial variable ${lbl} (phase I)`;
  if (type === "cut-gomory") return it ? `Slack del taglio di Gomory ${lbl}` : `Gomory cut slack ${lbl}`;
  if (type === "cut-cover") return it ? `Slack del taglio cover ${lbl}` : `Cover cut slack ${lbl}`;
  return lbl;
}
function tipZCell(j, v, lbl, isPivot, lang) {
  const it = lang === "it";
  const sign = v < -1e-9 ? (it ? "negativo" : "negative") : v > 1e-9 ? (it ? "positivo" : "positive") : (it ? "zero" : "zero");
  const base = it
    ? `Costo ridotto z_${lbl} − c_${lbl} = ${Simplex.fmt(v, 3)} (${sign})`
    : `Reduced cost z_${lbl} − c_${lbl} = ${Simplex.fmt(v, 3)} (${sign})`;
  if (isPivot) return base + " · " + (it ? "scelta come variabile entrante" : "chosen as entering variable");
  if (v < -1e-9) return base + " · " + (it ? "candidata all'ingresso (max)" : "candidate to enter (max)");
  return base;
}
function tipBodyCell(i, j, v, rowBasisLbl, colLbl, isPivotCell, isPivotRow, isPivotCol, lang) {
  const it = lang === "it";
  const head = it
    ? `Coefficiente ā[${rowBasisLbl}, ${colLbl}] = ${Simplex.fmt(v, 3)}`
    : `Coefficient ā[${rowBasisLbl}, ${colLbl}] = ${Simplex.fmt(v, 3)}`;
  if (isPivotCell) return head + " · " + (it ? "elemento di pivot" : "pivot element");
  if (isPivotRow) return head + " · " + (it ? "riga di pivot (esce dalla base)" : "pivot row (leaves basis)");
  if (isPivotCol) return head + " · " + (it ? "colonna di pivot (entra in base)" : "pivot column (enters basis)");
  return head;
}
function tipRhsCell(v, rowBasisLbl, lang) {
  const it = lang === "it";
  return it
    ? `Valore corrente di ${rowBasisLbl} nella base: b̄ = ${Simplex.fmt(v, 3)}`
    : `Current value of ${rowBasisLbl} in basis: b̄ = ${Simplex.fmt(v, 3)}`;
}
function tipZRhs(v, lang) {
  const it = lang === "it";
  return it
    ? `Valore corrente dell'obiettivo z = ${Simplex.fmt(v, 3)}`
    : `Current objective value z = ${Simplex.fmt(v, 3)}`;
}
function tipRatio(r, lang) {
  if (r == null) return "";
  const it = lang === "it";
  return it
    ? `Rapporto b/ā = ${Simplex.fmt(r, 3)} (test del minimo rapporto)`
    : `Ratio b/ā = ${Simplex.fmt(r, 3)} (min ratio test)`;
}
function tipBasis(lbl, lang) {
  const it = lang === "it";
  return it ? `Variabile in base in questa riga: ${lbl}` : `Basic variable for this row: ${lbl}`;
}

function TableauView({ state, t, verbose, lang }) {
  const { T, basis, colLabels, colTypes } = state;
  const cols = colLabels.length;
  const m = basis.length;

  // Live preview of the next pivot for the ratio-test column. Only shown while running.
  const preview =
    state.status === "running" || state.status === undefined
      ? Simplex.nextPivotPreview(state)
      : null;
  const pivotCol = preview ? preview.pivotCol : -1;
  const pivotRow = preview ? preview.minRow : -1;
  const ratios = preview ? preview.ratios : null;

  // In Phase II the artificials are no longer needed for the algorithm: hide
  // them from the displayed tableau (they may still linger in the data — kept
  // only for = constraints so dual recovery still works — but the user sees a
  // clean tableau without artificial columns).
  const hideArt = state.phase === 2;
  const visibleCols = [];
  for (let j = 0; j < cols - 1; j++) {
    if (hideArt && colTypes[j] === "artificial") continue;
    visibleCols.push(j);
  }

  // Which rows are cut rows? Their basis column has colType "cut-gomory" or "cut-cover".
  const cutRowKind = basis.map((b) => {
    const ct = colTypes[b];
    if (ct === "cut-gomory") return "cut-gomory";
    if (ct === "cut-cover") return "cut-cover";
    return null;
  });

  return (
    <div className="tab-wrap">
      <table className="tableau">
        <thead>
          <tr>
            {visibleCols.map((j) => (
              <th
                key={j}
                className={[
                  colTypes[j] === "slack" ? "col-slack" : "",
                  colTypes[j] === "artificial" ? "col-art" : "",
                  colTypes[j] === "cut-gomory" || colTypes[j] === "cut-cover" ? "col-cut" : "",
                  j === pivotCol ? "enter-col" : "",
                ].join(" ")}
                title={tipColHeader(j, colLabels, colTypes, lang)}
              >
                {colLabels[j]}
              </th>
            ))}
            <th className="col-rhs">−z</th>
            <th className="col-basis">base</th>
            {preview && (
              <th className="col-ratio">
                <span style={{ opacity: 0.55 }}>b /</span>{" "}
                {colLabels[pivotCol]}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          <tr className="z-row">
            {visibleCols.map((j) => {
              const v = T[0][j];
              return (
                <td
                  key={j}
                  className={[
                    Math.abs(v) < 1e-9 ? "zero" : "",
                    j === pivotCol ? "in-pivot-col" : "",
                  ].join(" ")}
                  title={tipZCell(j, v, colLabels[j], j === pivotCol, lang)}
                >
                  <Frac value={v} />
                </td>
              );
            })}
            <td className="col-rhs" title={tipZRhs(T[0][cols - 1], lang)}>
              <Frac value={T[0][cols - 1]} />
            </td>
            <td className="col-basis" title={lang === "it" ? "Riga della funzione obiettivo (costi ridotti)" : "Objective row (reduced costs)"}>z</td>
            {preview && <td className="col-ratio">—</td>}
          </tr>
          {T.slice(1).map((row, i) => (
            <tr
              key={i}
              className={[
                i === pivotRow ? "row-leave" : "",
                cutRowKind[i] === "cut-gomory" ? "row-cut" : "",
                cutRowKind[i] === "cut-cover" ? "row-cut row-cut-cover" : "",
              ].join(" ").trim()}
            >
              {visibleCols.map((j) => {
                const v = row[j];
                const isPivot = i === pivotRow && j === pivotCol;
                const rowBasisLbl = colLabels[basis[i]];
                return (
                  <td
                    key={j}
                    className={[
                      Math.abs(v) < 1e-9 ? "zero" : "",
                      i === pivotRow ? "in-pivot-row" : "",
                      j === pivotCol ? "in-pivot-col" : "",
                      isPivot ? "pivot-cell" : "",
                    ].join(" ")}
                    title={tipBodyCell(i, j, v, rowBasisLbl, colLabels[j], isPivot, i === pivotRow, j === pivotCol, lang)}
                  >
                    <Frac value={v} />
                  </td>
                );
              })}
              <td className="col-rhs" title={tipRhsCell(row[cols - 1], colLabels[basis[i]], lang)}>
                <Frac value={row[cols - 1]} />
              </td>
              <td
                className={[
                  "col-basis",
                  i === pivotRow ? "leave-row-label" : "",
                ].join(" ")}
                title={tipBasis(colLabels[basis[i]], lang)}
              >
                {colLabels[basis[i]]}
              </td>
              {preview && (
                <td
                  className={[
                    "col-ratio",
                    i === pivotRow ? "ratio-min" : "",
                  ].join(" ")}
                  title={tipRatio(ratios[i], lang)}
                >
                  {ratios[i] == null ? "—" : <Frac value={ratios[i]} />}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusPill({ status, t }) {
  const map = {
    running: { c: "status-running", l: t.running },
    optimal: { c: "status-optimal", l: t.optimal },
    unbounded: { c: "status-unbounded", l: t.unbounded },
    infeasible: { c: "status-infeasible", l: t.infeasible },
  };
  const v = map[status] || map.running;
  return <span className={`status-pill ${v.c}`}>{v.l}</span>;
}

function StepBar({ step, total, setStep, playing, setPlaying, t }) {
  return (
    <div className="step-bar">
      <div className="stepper" role="group" aria-label={t.step}>
        <button
          onClick={() => setStep(0)}
          disabled={step === 0}
          title={t.restart}
          aria-label={t.ariaRestart}
        >
          ↺
        </button>
        <button
          onClick={() => setStep(Math.max(0, step - 1))}
          disabled={step === 0}
          aria-label={t.ariaPrevStep}
        >
          {t.prev}
        </button>
        <span className="step-count" aria-live="polite">
          {step + 1} / {total}
        </span>
        <button
          onClick={() => setStep(Math.min(total - 1, step + 1))}
          disabled={step >= total - 1}
          aria-label={t.ariaNextStep}
        >
          {t.next}
        </button>
        <button
          onClick={() => setPlaying(!playing)}
          disabled={step >= total - 1 && !playing}
          aria-label={playing ? t.ariaPause : t.ariaPlay}
        >
          {playing ? t.pause : t.play}
        </button>
      </div>
    </div>
  );
}

function Narration({ state, step, t, lang }) {
  const fmt = Simplex.fmt;
  let body;
  let phaseLabel = "";
  if (state.hasArt) {
    phaseLabel = state.phase === 1 ? ` · ${t.phaseI}` : ` · ${t.phaseII}`;
  }
  if (state.note === "cut-added" && state.lastCut) {
    body = t.narrationCutAdded(state.lastCut.kind, state.lastCut.label || "");
  } else if (state.note === "dual-pivot" && state.pivot) {
    body = t.narrationDualPivot(state.pivot.enterLabel, state.pivot.leaveLabel);
  } else if (state.note === "phase2-start") {
    body = t.narrationPhase2;
  } else if (state.note === "phase1-infeasible") {
    body = t.narrationInfeasible;
  } else if (state.status === "optimal" && (state.appliedCuts || []).length > 0) {
    body = t.narrationDualOptimal;
  } else if (state.status === "optimal") {
    body = t.narrationOptimal;
  } else if (state.status === "unbounded") {
    body = t.narrationUnbounded;
  } else if (state.status === "infeasible") {
    body = t.narrationInfeasible;
  } else if (step === 0) {
    body = state.phase === 1 ? t.narrationPhase1Start : t.narrationStep0;
  } else if (state.pivot) {
    body = t.narrationPivot(state.pivot.enterLabel, state.pivot.leaveLabel);
  }

  return (
    <div className="narration" data-screen-label="narration">
      <span className="meta">
        {t.step} {step}
        {phaseLabel}
      </span>
      {body}
      {state.pivot && step > 0 && (
        <div style={{ marginTop: 6, fontStyle: "normal", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-2)" }}>
          {t.enter}: <b>{state.pivot.enterLabel}</b> ·{" "}
          {t.leave}: <b>{state.pivot.leaveLabel}</b> · {t.ratio}: {fmt(state.pivot.ratio)}
        </div>
      )}
    </div>
  );
}

function StatGrid({ state, t }) {
  const fmt = Simplex.fmt;
  const z = Simplex.objectiveValue(state);
  const sol = Simplex.currentSolution(state);
  const decisionVars = state.colLabels
    .map((lbl, i) => ({ lbl, type: state.colTypes[i] }))
    .filter((c) => c.type === "decision");

  return (
    <div className="stat-grid">
      <div className="stat accent">
        <div className="l">{t.objValue}</div>
        <div className="v">{fmt(z)}</div>
        <div className="sub">
          {state.objective === "max" ? t.max : t.min}{" "}
          {state.status === "running" ? `· ${t.inProgress}` : ""}
        </div>
      </div>
      <div className="stat">
        <div className="l">{t.currentBasis}</div>
        <div className="v" style={{ fontSize: 14 }}>
          {"{ "}
          {state.basis.map((b) => state.colLabels[b]).join(", ")}
          {" }"}
        </div>
        <div className="sub">{t.iteration} {state.iteration}</div>
      </div>
      {decisionVars.map((v, i) => (
        <div className="stat" key={i}>
          <div className="l">{v.lbl.replace("_", "")}</div>
          <div className="v">{fmt(sol[v.lbl] || 0)}</div>
        </div>
      ))}
    </div>
  );
}

function SensitivityPanel({ state, t }) {
  const data = useMemoT(() => Simplex.sensitivity(state), [state]);
  if (!data) return null;
  const fmt = Simplex.fmt;
  return (
    <div className="section" data-screen-label="sensitivity">
      <div className="section-title">{t.sensitivity}</div>
      <table className="sens-table">
        <thead>
          <tr>
            <th>{t.constraintLabel}</th>
            <th>b<sub>i</sub></th>
            <th>{t.rhsRange}</th>
          </tr>
        </thead>
        <tbody>
          {data.rhsRanges.map((r, i) => {
            const oc = state.originalLP && state.originalLP.constraints[i];
            if (!oc) return null;
            return (
              <tr key={i}>
                <td>C{i + 1}</td>
                <td>{fmt(oc.b)}</td>
                <td>
                  [{fmt(oc.b + r.low)} , {fmt(oc.b + r.high)}]
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <table className="sens-table" style={{ marginTop: 10 }}>
        <thead>
          <tr>
            <th>{t.variableLabel}</th>
            <th>c<sub>j</sub></th>
            <th>{t.costRange}</th>
          </tr>
        </thead>
        <tbody>
          {data.costRanges.map((r, j) => (
            <tr key={j}>
              <td>{state.varNames[j].replace("_", "")}</td>
              <td>{fmt(state.cOrig[j])}</td>
              <td>
                [{fmt(state.cOrig[j] + r.low)} , {fmt(state.cOrig[j] + r.high)}]
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Cuts panel ──────────────────────────────────────────────────────────────
// Visible only for ILP. Shows the integer/fractional status at the latest
// reached state and the list of cuts already applied (with their inequalities
// and remove/reset controls). To ADD a cut, the user clicks the Cover/Gomory
// action buttons in the page header — there is no separate "Apply" button.
function CutsPanel({ lp, latestState, onRemoveLast, onReset, t }) {
  if (!latestState) return null;
  const isOpt = latestState.status === "optimal";
  const cuts = (latestState.appliedCuts || []);
  const hasFracOpt = isOpt && !Simplex.isIntegerOptimal(latestState, lp);
  const isIntOpt = isOpt && Simplex.isIntegerOptimal(latestState, lp);

  return (
    <div className="section" data-screen-label="cuts">
      <div className="section-title">
        {t.cuts}
        <span className="badge">
          {isIntOpt ? t.integerOptimal : (hasFracOpt ? t.fractionalOptimal : "")}
        </span>
      </div>

      {isIntOpt && cuts.length === 0 && (
        <div className="cuts-note">{t.noFractional}</div>
      )}

      {cuts.length > 0 && (
        <>
          <div className="cuts-subtitle">
            {t.cutsApplied} ({cuts.length})
            <div className="cuts-controls">
              <button
                className="pill-btn"
                style={{ fontSize: 10, padding: "2px 7px" }}
                onClick={onRemoveLast}
              >
                ←
              </button>
              <button
                className="pill-btn"
                style={{ fontSize: 10, padding: "2px 7px" }}
                onClick={onReset}
              >
                ×
              </button>
            </div>
          </div>
          <div className="cuts-list">
            {cuts.map((cut, i) => (
              <CutItem key={i} cut={cut} lp={lp} t={t} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function CutItem({ cut, lp, t }) {
  const fmt = Simplex.fmt;
  if (cut.kind === "cover") {
    return (
      <div className="cut-item cut-cover">
        <span className="cut-label">{cut.label}</span>
        <span className="cut-kind">cover</span>
        <span className="cut-ineq">
          {cut.cover.map((j, k) => (
            <React.Fragment key={k}>
              {k > 0 && " + "}
              <VarNameInline name={lp.varNames[j]} />
            </React.Fragment>
          ))}
          {" ≤ "}
          {cut.rhs}
        </span>
      </div>
    );
  }
  if (cut.kind === "gomory") {
    return (
      <div className="cut-item cut-gomory">
        <span className="cut-label">{cut.label}</span>
        <span className="cut-kind">gomory</span>
        <span className="cut-ineq">
          <span className="cut-source">
            {t.pivot}: <b>{cut.sourceVarLabel}</b> · {"{b}"} = {fmt(cut.f_b, 3)}
          </span>
        </span>
      </div>
    );
  }
  return null;
}

// Small inline variable-name (without the React.Fragment wrap of VarName)
function VarNameInline({ name }) {
  const m = name.match(/^([a-zA-Z]+)_?(\d+)?$/);
  if (m && m[2]) {
    return (
      <span className="var-name">
        {m[1]}
        <sub>{m[2]}</sub>
      </span>
    );
  }
  return <span className="var-name">{name}</span>;
}

Object.assign(window, {
  TableauView,
  StatusPill,
  StepBar,
  Narration,
  StatGrid,
  SensitivityPanel,
  CutsPanel,
  Frac,
});
