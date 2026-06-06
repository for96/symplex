/* global React, CNF */

const { useEffect: useEffectCnf, useMemo: useMemoCnf, useState: useStateCnf } = React;

const CNF_SOURCE_KEY = "symplex_cnf_source_v2";
const CNF_MODE_KEY = "symplex_cnf_mode";

function CnfFormula({ children, strong = false }) {
  return <div className={"cnf-formula" + (strong ? " strong" : "")}>{children}</div>;
}

function CnfWorkspace({ t }) {
  const [mode, setMode] = useStateCnf(() => {
    try {
      const saved = localStorage.getItem(CNF_MODE_KEY);
      return saved === "formula" ? "formula" : "phrase";
    } catch (error) {
      return "phrase";
    }
  });
  const [source, setSource] = useStateCnf(() => {
    try {
      return localStorage.getItem(CNF_SOURCE_KEY) || "";
    } catch (error) {
      return "";
    }
  });

  useEffectCnf(() => {
    try {
      localStorage.setItem(CNF_MODE_KEY, mode);
      localStorage.setItem(CNF_SOURCE_KEY, source);
    } catch (error) {}
  }, [mode, source]);

  const outcome = useMemoCnf(() => {
    if (!source.trim()) return { result: null, error: null };
    try {
      return { result: CNF.analyze(source, mode), error: null };
    } catch (error) {
      return { result: null, error };
    }
  }, [source, mode]);

  const result = outcome.result;
  return (
    <main className="cnf-workspace">
      <div className="cnf-grid">
        <div className="cnf-input-col">
          <section className="section">
            <div className="section-title">
              {t.cnfInputTitle}
              <div className="seg">
                <button
                  className={mode === "phrase" ? "active" : ""}
                  onClick={() => setMode("phrase")}
                  aria-pressed={mode === "phrase"}
                >
                  {t.cnfPhrase}
                </button>
                <button
                  className={mode === "formula" ? "active" : ""}
                  onClick={() => setMode("formula")}
                  aria-pressed={mode === "formula"}
                >
                  {t.cnfFormula}
                </button>
              </div>
            </div>
            <textarea
              className="cnf-editor"
              value={source}
              onChange={(event) => setSource(event.target.value)}
              spellCheck="false"
              aria-label={t.cnfInputTitle}
            />
            <div className="cnf-hint">{mode === "phrase" ? t.cnfPhraseHint : t.cnfFormulaHint}</div>
            {outcome.error && (
              <div className="text-err" role="alert">
                {t.cnfError}: {cnfErrorMessage(t, outcome.error)}
              </div>
            )}
          </section>

          {result && (
            <section className="section">
              <div className="section-title">{t.cnfAssertions}</div>
              <div className="cnf-symbol-map">
                {result.assertions.length > 0 ? result.assertions.map((item) => (
                  <div className="cnf-map-row" key={item.name}>
                    <span className="cnf-symbol">{item.name}</span>
                    <span className="cnf-map-eq">=</span>
                    <span>{item.label}</span>
                  </div>
                )) : result.variables.map((name) => (
                  <div className="cnf-map-row" key={name}>
                    <span className="cnf-symbol">{name}</span>
                    <span className="cnf-map-eq">↔</span>
                    <span>{result.variableMap[name]} = 1</span>
                  </div>
                ))}
              </div>
              {result.assertions.length > 0 && (
                <CnfFormula>{result.formula}</CnfFormula>
              )}
            </section>
          )}
        </div>

        <div className="cnf-result-col">
          {result && (
            <>
              <section className="section">
                <div className="section-title">
                  {t.cnfStepsTitle}
                  <CnfTruthBadge truth={result.truth} t={t} />
                </div>
                <div className="cnf-steps">
                  {result.steps.map((step, index) => (
                    <div className="cnf-step" key={`${step.rule}-${index}`}>
                      <div className="cnf-step-index">{index + 1}</div>
                      <div className="cnf-step-content">
                        <div className="cnf-step-rule">{cnfRuleLabel(t, step)}</div>
                        <div className="cnf-step-law">{cnfRuleDescription(t, step)}</div>
                        <CnfFormula>{step.formula}</CnfFormula>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="section">
                <div className="section-title">{t.cnfLiteralEncoding}</div>
                <div className="cnf-binary-map">
                  {result.variables.map((name) => (
                    <span className="cnf-binary-item" key={name}>
                      <strong>{result.variableMap[name]}</strong> = 1 ⇔ {name} = T
                    </span>
                  ))}
                </div>
                {result.constraints.length > 0 ? (
                  <div className="cnf-constraint-list">
                    {result.constraints.map((constraint, index) => (
                      <div className="cnf-constraint" key={index}>
                        <div className="cnf-clause-label">
                          C{index + 1}: {formatClauseForView(constraint.clause)}
                        </div>
                        <div className="cnf-encoding-row">
                          <span>{constraint.literalForm}</span>
                          <span className="cnf-equivalent">⇔</span>
                          <strong>{constraint.linearForm}</strong>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="cnf-tautology">{t.cnfNoConstraints}</div>
                )}
              </section>

              <section className="section cnf-final-section">
                <div className="section-title">{t.cnfFinalSystem}</div>
                <CnfFormula strong>{result.cnf}</CnfFormula>
                {result.constraints.map((constraint, index) => (
                  <div className="cnf-final-constraint" key={index}>{constraint.linearForm}</div>
                ))}
                <div className="cnf-domain">
                  {result.variables.map((name) => result.variableMap[name]).join(", ")} ∈ {"{0, 1}"}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

function CnfTruthBadge({ truth, t }) {
  if (!truth || truth.skipped) return null;
  const label =
    truth.status === "tautology" ? t.cnfTautology :
    truth.status === "contradiction" ? t.cnfContradiction :
    `${truth.satisfying}/${truth.total} ${t.cnfAssignments}`;
  return <span className={`badge cnf-truth ${truth.status}`}>{label}</span>;
}

function cnfRuleLabel(t, step) {
  if (step.rule === "formalization") return t.cnfRuleFormalization;
  if (step.rule === "derived") {
    const rules = (step.details || []).map((rule) => rule === "xor" ? t.cnfRuleXor : t.cnfRuleIff);
    return rules.join(" · ");
  }
  if (step.rule === "implication") return t.cnfRuleImplication;
  if (step.rule === "de-morgan") return t.cnfRuleDeMorgan;
  if (step.rule === "distribution") return t.cnfRuleDistribution;
  if (step.rule === "simplification") {
    const names = (step.details || []).map((rule) => ({
      idempotence: t.cnfRuleIdempotence,
      complement: t.cnfRuleComplement,
      absorption: t.cnfRuleAbsorption,
      distribution: t.cnfRuleDistribution,
      "double-negation": t.cnfRuleDoubleNegation,
    }[rule])).filter(Boolean);
    return names.length > 0 ? names.join(" · ") : t.cnfRuleSimplification;
  }
  return step.rule;
}

function cnfRuleDescription(t, step) {
  if (step.rule === "formalization") return t.cnfLawFormalization;
  if (step.rule === "derived") {
    return (step.details || []).map((rule) => (
      rule === "xor" ? t.cnfLawXor : t.cnfLawIff
    )).join(" · ");
  }
  if (step.rule === "implication") return t.cnfLawImplication;
  if (step.rule === "de-morgan") return t.cnfLawDeMorgan;
  if (step.rule === "distribution") return t.cnfLawDistribution;
  if (step.rule === "simplification") {
    return (step.details || []).map((rule) => ({
      idempotence: t.cnfLawIdempotence,
      complement: t.cnfLawComplement,
      absorption: t.cnfLawAbsorption,
      distribution: t.cnfLawDistribution,
      "double-negation": t.cnfLawDoubleNegation,
    }[rule])).filter(Boolean).join(" · ");
  }
  return "";
}

function formatClauseForView(clause) {
  if (!clause || clause.length === 0) return "F";
  return `(${clause.map((literal) => `${literal.negated ? "¬" : ""}${literal.name}`).join(" ∨ ")})`;
}

function cnfErrorMessage(t, error) {
  const message = String(error && error.message || error);
  if (message === "cnf-empty-input") return t.cnfErrEmpty;
  if (message === "cnf-unexpected-end") return t.cnfErrUnexpectedEnd;
  if (message === "cnf-missing-close-paren") return t.cnfErrParen;
  if (message === "cnf-too-large") return t.cnfErrTooLarge;
  if (message === "cnf-unclosed-quote") return t.cnfErrQuote;
  if (message.startsWith("cnf-invalid-character:")) return `${t.cnfErrCharacter} ${message.split(":")[1]}`;
  if (message.startsWith("cnf-unexpected-token:")) return `${t.cnfErrToken} ${message.split(":").slice(1).join(":")}`;
  return t.cnfErrGeneric;
}

Object.assign(window, { CnfWorkspace });
