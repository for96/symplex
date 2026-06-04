/* global React, ReactDOM, Simplex, i18n,
   ProblemEditor, DualPanel, GeometryView,
   TableauView, StepBar, Narration, StatGrid, StatusPill, SensitivityPanel,
   CutsPanel,
   DualityWorkspace,
   TweaksPanel, TweakSection, TweakRadio, TweakToggle */

const { useState: useStateApp, useEffect: useEffectApp, useMemo: useMemoApp, useRef: useRefApp } = React;

const DEFAULT_LP = {
  type: "lp",
  objective: "max",
  c: [1, 2],
  varNames: ["x1", "x2"],
  constraints: [
    { a: [5, 6], op: "<=", b: 30 },
    { a: [1, -1], op: ">=", b: 1 },
  ],
  varBounds: [
    { kind: "continuous", ub: Infinity },
    { kind: "continuous", ub: Infinity },
  ],
};

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "light",
  "lang": "it",
  "density": "normal",
  "layout": "cols",
  "palette": "default",
  "tableauStyle": "verbose",
  "rule": "dantzig",
  "showLevels": true,
  "showGradient": true,
  "showPath": true
}/*EDITMODE-END*/;

const HISTORY_KEY = "simplesso_lp_history_v1";
const HISTORY_LIMIT = 8;

// Tweak value constants — keep in sync with TWEAK_DEFAULTS and styles.css class names.
const TABLEAU_STYLES = { CLASSIC: "classic", VERBOSE: "verbose" };
const PIVOT_RULES = { DANTZIG: "dantzig", BLAND: "bland" };
const THEMES = { LIGHT: "light", DARK: "dark" };
const LANGS = { IT: "it", EN: "en" };
// Cut kinds. The header exposes them as action buttons: a click applies one cut
// of that kind immediately (no separate "Apply" step). To remove cuts use the ×
// in the CutsPanel list.
const CUT_KINDS = { COVER: "cover", GOMORY: "gomory" };
// Top-level workspace mode. The Duality view is fully independent of the
// simplex one — it has its own editor, its own state, and is meant for
// chapter-4-style exercises (complementary slackness, optimum without simplex).
const MODES = { SIMPLEX: "simplex", DUALITY: "duality" };

function lpFingerprint(lp) {
  // Canonical, version-stable signature for an LP. Used to dedupe history.
  // Normalize: ub is "inf" for non-finite, varBounds default to continuous.
  const n = (lp.c || []).length;
  const bounds = [];
  for (let j = 0; j < n; j++) {
    const b = (lp.varBounds || [])[j] || { kind: "continuous", ub: Infinity };
    bounds.push([b.kind || "continuous", (typeof b.ub === "number" && isFinite(b.ub)) ? b.ub : "inf"]);
  }
  return JSON.stringify([
    lp.type || "lp",
    lp.objective,
    lp.c,
    (lp.constraints || []).map((c) => [c.a, c.op, c.b]),
    bounds,
  ]);
}
function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw) || [];
  } catch (e) {
    return [];
  }
}
function saveHistory(arr) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(arr));
  } catch (e) {}
}
function pushHistory(lp) {
  const arr = loadHistory();
  const fp = lpFingerprint(lp);
  // Recompute each entry's fp from its stored lp — stored e.fp may be stale
  // across versions/migrations of lpFingerprint. This guarantees real dedup.
  const existsIdx = arr.findIndex((e) => {
    const efp = e.lp ? lpFingerprint(e.lp) : e.fp;
    return efp === fp;
  });
  if (existsIdx !== -1) {
    // Already in history: don't add a duplicate and don't reshuffle the order.
    // Just refresh the stored fp (in case the algorithm changed).
    if (arr[existsIdx].fp !== fp) {
      arr[existsIdx] = { ...arr[existsIdx], fp };
      saveHistory(arr);
    }
    return arr;
  }
  const filtered = [{ fp, lp: JSON.parse(JSON.stringify(lp)), ts: Date.now() }, ...arr];
  while (filtered.length > HISTORY_LIMIT) filtered.pop();
  saveHistory(filtered);
  return filtered;
}

// Mobile/tablet tab IDs: each maps to one of the three .col panels (or to the
// duality workspace). On screens > 1180px the tab bar is hidden via CSS and all panels
// are shown side-by-side; below that breakpoint we render the tab bar and let
// CSS hide all but the active section via the `.mobile-section-X` class on
// `.app-main`. The Duality tab is special — it toggles `mode` to DUALITY which
// swaps the entire main view for `<DualityWorkspace>`.
const MOBILE_TABS = { PROBLEM: "problem", GEOMETRY: "geometry", TABLEAU: "tableau", DUALITY: "duality" };

function App() {
  const [lp, setLp] = useStateApp(DEFAULT_LP);
  const [step, setStep] = useStateApp(0);
  const [playing, setPlaying] = useStateApp(false);
  const [lpHistory, setLpHistory] = useStateApp(() => loadHistory());
  const [tweaks, setTweak] = window.useTweaks(TWEAK_DEFAULTS);
  const [appliedCuts, setAppliedCuts] = useStateApp([]);
  const [mode, setMode] = useStateApp(MODES.SIMPLEX);
  const [mobileSection, setMobileSection] = useStateApp(MOBILE_TABS.PROBLEM);
  const [menuOpen, setMenuOpen] = useStateApp(false);

  // Expand variable bounds (kind="binary" → x ≤ 1, finite ub → x ≤ ub) into
  // explicit constraints. The solver and downstream display work on this
  // augmented LP. The user keeps editing `lp` (without bound constraints).
  const effectiveLP = useMemoApp(() => Simplex.expandBounds(lp), [lp]);

  const history = useMemoApp(() => {
    try {
      const base = Simplex.solve(effectiveLP, { rule: tweaks.rule });
      let states = base.slice();
      let cur = base[base.length - 1];
      for (const cutKind of appliedCuts) {
        const extra = Simplex.applyCut(cur, effectiveLP, cutKind);
        if (!extra) break;
        states = [...states, ...extra];
        cur = extra[extra.length - 1];
        if (cur.status !== "optimal") break;
      }
      return states;
    } catch (e) {
      console.error(e);
      return [Simplex.snapshot(Simplex.buildLP(effectiveLP, { rule: tweaks.rule }))];
    }
  }, [effectiveLP, tweaks.rule, appliedCuts]);

  // Reset cuts when the LP itself changes
  useEffectApp(() => {
    setAppliedCuts([]);
  }, [effectiveLP]);

  const prevLP = useRefApp(effectiveLP);
  const prevRule = useRefApp(tweaks.rule);
  const prevCutsLength = useRefApp(appliedCuts.length);

  useEffectApp(() => {
    const lpChanged = prevLP.current !== effectiveLP;
    const ruleChanged = prevRule.current !== tweaks.rule;
    const cutsLengthChanged = prevCutsLength.current !== appliedCuts.length;

    prevLP.current = effectiveLP;
    prevRule.current = tweaks.rule;
    prevCutsLength.current = appliedCuts.length;

    if (lpChanged || ruleChanged) {
      setStep(0);
      setPlaying(false);
    } else if (cutsLengthChanged) {
      if (history.length > 0) {
        setStep(history.length - 1);
      }
      setPlaying(false);
    }
  }, [effectiveLP, tweaks.rule, appliedCuts.length, history.length]);

  const [isMobile, setIsMobile] = useStateApp(() => {
    return typeof window !== "undefined" && window.innerWidth <= 1180;
  });

  useEffectApp(() => {
    function handleResize() {
      setIsMobile(window.innerWidth <= 1180);
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Persistence is manual: the user controls when an LP enters the history via
  // an explicit "Save" button. The previous debounced auto-save flooded the
  // history with near-identical entries when editing coefficient by coefficient.

  useEffectApp(() => {
    const prevent = (event) => event.preventDefault();
    const preventTouchZoom = (event) => {
      if (event.touches && event.touches.length > 1) event.preventDefault();
    };
    const preventWheelZoom = (event) => {
      if (event.ctrlKey || event.metaKey) event.preventDefault();
    };
    const preventKeyZoom = (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (["+", "-", "=", "_", "0"].includes(event.key)) event.preventDefault();
    };

    document.addEventListener("gesturestart", prevent, { passive: false });
    document.addEventListener("gesturechange", prevent, { passive: false });
    document.addEventListener("gestureend", prevent, { passive: false });
    document.addEventListener("touchmove", preventTouchZoom, { passive: false });
    window.addEventListener("wheel", preventWheelZoom, { passive: false });
    window.addEventListener("keydown", preventKeyZoom);
    return () => {
      document.removeEventListener("gesturestart", prevent);
      document.removeEventListener("gesturechange", prevent);
      document.removeEventListener("gestureend", prevent);
      document.removeEventListener("touchmove", preventTouchZoom);
      window.removeEventListener("wheel", preventWheelZoom);
      window.removeEventListener("keydown", preventKeyZoom);
    };
  }, []);

  useEffectApp(() => {
    if (!playing) return;
    if (step >= history.length - 1) {
      setPlaying(false);
      return;
    }
    const id = setTimeout(() => setStep((s) => Math.min(history.length - 1, s + 1)), 1100);
    return () => clearTimeout(id);
  }, [playing, step, history.length]);

  const t = i18n[tweaks.lang];
  const state = history[Math.min(step, history.length - 1)];
  const latestState = history[history.length - 1];

  // Cut applicability at the latest reached state (not the currently viewed step)
  const cutAvail = useMemoApp(() => {
    if (!latestState) return { gomory: false, cover: false };
    return Simplex.cutsAvailability(latestState, effectiveLP);
  }, [latestState, effectiveLP]);



  function handleApplyCut(kind) {
    if (!cutAvail[kind]) return;
    setAppliedCuts((cs) => [...cs, kind]);
  }
  function handleRemoveLastCut() {
    setAppliedCuts((cs) => cs.slice(0, -1));
  }
  function handleResetCuts() {
    setAppliedCuts([]);
  }
  function cutButtonTitle(kind) {
    if (cutAvail[kind]) return kind === CUT_KINDS.COVER ? t.cutCoverDesc : t.cutGomoryDesc;
    const reason = cutAvail.reasons && cutAvail.reasons[kind];
    if (reason === "structure") {
      return kind === CUT_KINDS.COVER ? t.cutCoverUnavailable : t.cutGomoryUnavailable;
    }
    if (reason === "integer-optimal") return t.noFractional;
    return t.cutNone;
  }

  return (
    <div
      className={[
        `theme-${tweaks.theme}`,
        `density-${tweaks.density}`,
        `palette-${tweaks.palette}`,
        `layout-${tweaks.layout}`,
      ].join(" ")}
      style={{ display: "flex", flexDirection: "column", height: "100%" }}
    >
      <header className={"app-header" + (menuOpen ? " menu-open" : "")}>
        <div>
          <h1
            className="app-title"
            onClick={() => {
              if (typeof window !== "undefined" && window.innerWidth > 480) {
                window.location.reload();
              }
            }}
            title={typeof window !== "undefined" && window.innerWidth > 480 ? (tweaks.lang === "it" ? "Ricarica la pagina" : "Reload page") : undefined}
          >
            {t.appTitlePrefix} <em>{t.appTitleEm}</em>
          </h1>
        </div>
        <button
          className="hamburger-btn"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="Menu"
          aria-expanded={menuOpen}
        >
          ☰
        </button>
        <div className="app-tools">
          <div className="seg seg-collapsible">
            <button
              className={tweaks.lang === LANGS.IT ? "active" : ""}
              aria-label={t.ariaLanguageIt}
              aria-pressed={tweaks.lang === LANGS.IT}
              onClick={() => setTweak("lang", LANGS.IT)}
            >
              IT
            </button>
            <button
              className={tweaks.lang === LANGS.EN ? "active" : ""}
              aria-label={t.ariaLanguageEn}
              aria-pressed={tweaks.lang === LANGS.EN}
              onClick={() => setTweak("lang", LANGS.EN)}
            >
              EN
            </button>
          </div>
          <div className="seg seg-collapsible">
            <button
              className={tweaks.theme === THEMES.LIGHT ? "active" : ""}
              aria-label={t.ariaLightMode}
              aria-pressed={tweaks.theme === THEMES.LIGHT}
              onClick={() => setTweak("theme", THEMES.LIGHT)}
            >
              ☼
            </button>
            <button
              className={tweaks.theme === THEMES.DARK ? "active" : ""}
              aria-label={t.ariaDarkMode}
              aria-pressed={tweaks.theme === THEMES.DARK}
              onClick={() => setTweak("theme", THEMES.DARK)}
            >
              ☾
            </button>
          </div>
          {/* The .mode-toggle class is a marker for CSS to hide this control
              on mobile widths — the mobile tab bar takes over the Simplex/Duality
              switch (plus a per-section selector). */}
          <div className="seg mode-toggle" role="group" aria-label={t.modeToggle}>
            <button
              className={mode === MODES.SIMPLEX ? "active" : ""}
              aria-pressed={mode === MODES.SIMPLEX}
              onClick={() => setMode(MODES.SIMPLEX)}
              title={t.modeSimplexDesc}
            >
              {t.modeSimplex}
            </button>
            <button
              className={mode === MODES.DUALITY ? "active" : ""}
              aria-pressed={mode === MODES.DUALITY}
              onClick={() => setMode(MODES.DUALITY)}
              title={t.modeDualityDesc}
            >
              {t.modeDuality}
            </button>
          </div>
          {mode === MODES.SIMPLEX && (
            <>
              <span className="help-link" style={{ marginLeft: 8 }}>
                {t.methodNote}
              </span>
              <div className="seg seg-collapsible" title={t.pivotRule} role="group" aria-label={t.pivotRule}>
                <button
                  className={tweaks.rule === PIVOT_RULES.DANTZIG ? "active" : ""}
                  aria-pressed={tweaks.rule === PIVOT_RULES.DANTZIG}
                  onClick={() => setTweak("rule", PIVOT_RULES.DANTZIG)}
                >
                  {t.ruleDantzig}
                </button>
                <button
                  className={tweaks.rule === PIVOT_RULES.BLAND ? "active" : ""}
                  aria-pressed={tweaks.rule === PIVOT_RULES.BLAND}
                  onClick={() => setTweak("rule", PIVOT_RULES.BLAND)}
                >
                  {t.ruleBland}
                </button>
              </div>
              {lp.type === "ilp" && (
                <div className="cut-actions cut-actions-desktop" role="group" aria-label={t.cuts}>
                  <span className="cut-actions-label">{t.cuts}:</span>
                  <button
                    className="pill-btn"
                    disabled={!cutAvail.cover}
                    aria-disabled={!cutAvail.cover}
                    title={cutButtonTitle(CUT_KINDS.COVER)}
                    onClick={() => handleApplyCut(CUT_KINDS.COVER)}
                  >
                    + {t.cutsCover}
                  </button>
                  <button
                    className="pill-btn"
                    disabled={!cutAvail.gomory}
                    aria-disabled={!cutAvail.gomory}
                    title={cutButtonTitle(CUT_KINDS.GOMORY)}
                    onClick={() => handleApplyCut(CUT_KINDS.GOMORY)}
                  >
                    + {t.cutsGomory}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </header>

      {/* Mobile/tablet tab bar — hidden via CSS on screens > 1180px. The duality tab
          toggles top-level `mode`; the other three swap which .col is visible.
          We also scroll the new section to the top so the user doesn't land
          mid-page after a tab switch. */}
      {(() => {
        const activeTab = mode === MODES.DUALITY ? MOBILE_TABS.DUALITY : mobileSection;
        function handleMobileTab(tab) {
          if (tab === MOBILE_TABS.DUALITY) {
            setMode(MODES.DUALITY);
          } else {
            setMode(MODES.SIMPLEX);
            setMobileSection(tab);
          }
          requestAnimationFrame(() => {
            try { window.scrollTo({ top: 0, behavior: "instant" }); } catch (e) { window.scrollTo(0, 0); }
            const main = document.querySelector(".app-main");
            if (main) main.scrollTop = 0;
          });
        }
        return (
          <nav className="mobile-tab-bar" role="tablist" aria-label={t.modeToggle}>
            <button
              role="tab"
              aria-selected={activeTab === MOBILE_TABS.PROBLEM}
              className={activeTab === MOBILE_TABS.PROBLEM ? "active" : ""}
              onClick={() => handleMobileTab(MOBILE_TABS.PROBLEM)}
            >
              {t.problem}
            </button>
            <button
              role="tab"
              aria-selected={activeTab === MOBILE_TABS.GEOMETRY}
              className={activeTab === MOBILE_TABS.GEOMETRY ? "active" : ""}
              onClick={() => handleMobileTab(MOBILE_TABS.GEOMETRY)}
            >
              {t.geometry}
            </button>
            <button
              role="tab"
              aria-selected={activeTab === MOBILE_TABS.TABLEAU}
              className={activeTab === MOBILE_TABS.TABLEAU ? "active" : ""}
              onClick={() => handleMobileTab(MOBILE_TABS.TABLEAU)}
            >
              {t.tableau}
            </button>
            <button
              role="tab"
              aria-selected={activeTab === MOBILE_TABS.DUALITY}
              className={activeTab === MOBILE_TABS.DUALITY ? "active" : ""}
              onClick={() => handleMobileTab(MOBILE_TABS.DUALITY)}
            >
              {t.modeDuality}
            </button>
          </nav>
        );
      })()}

      {mode === MODES.DUALITY ? (
        <DualityWorkspace t={t} />
      ) : (
      <div className={`app-main mobile-section-${mobileSection}`}>
        {/* Left column — input + dual */}
        {(!isMobile || mobileSection === MOBILE_TABS.PROBLEM) && (
          <div className="col left">
            <ProblemEditor
              lp={lp}
              setLp={setLp}
              t={t}
              lpHistory={lpHistory}
              currentFp={lpFingerprint(lp)}
              onSaveLp={() => setLpHistory(pushHistory(lp))}
              onClearHistory={() => {
                saveHistory([]);
                setLpHistory([]);
              }}
            />
            <DualPanel lp={effectiveLP} state={state} t={t} />
          </div>
        )}

        {/* Center — geometry */}
        {(!isMobile || mobileSection === MOBILE_TABS.GEOMETRY) && (
          <div className="col center">
            <GeometryView
              lp={effectiveLP}
              state={state}
              history={history}
              step={step}
              t={t}
              tweaks={tweaks}
              appliedCuts={state.appliedCuts || []}
            />
          </div>
        )}

        {/* Right column — tableau, controls, stats */}
        {(!isMobile || mobileSection === MOBILE_TABS.TABLEAU) && (
          <div className="col right">
            <div className="section" data-screen-label="tableau">
              <div className="section-title">
                {t.tableau}
                <StatusPill status={state.status} t={t} />
              </div>
              {lp.type === "ilp" && (
                <div className="cut-actions cut-actions-mobile" role="group" aria-label={t.cuts}>
                  <span className="cut-actions-label">{t.cuts}:</span>
                  <button
                    className="pill-btn"
                    disabled={!cutAvail.cover}
                    aria-disabled={!cutAvail.cover}
                    title={cutButtonTitle(CUT_KINDS.COVER)}
                    onClick={() => handleApplyCut(CUT_KINDS.COVER)}
                  >
                    + {t.cutsCover}
                  </button>
                  <button
                    className="pill-btn"
                    disabled={!cutAvail.gomory}
                    aria-disabled={!cutAvail.gomory}
                    title={cutButtonTitle(CUT_KINDS.GOMORY)}
                    onClick={() => handleApplyCut(CUT_KINDS.GOMORY)}
                  >
                    + {t.cutsGomory}
                  </button>
                </div>
              )}
              <TableauView state={state} t={t} verbose={tweaks.tableauStyle === TABLEAU_STYLES.VERBOSE} lang={tweaks.lang} />
              <StepBar
                step={step}
                total={history.length}
                setStep={setStep}
                playing={playing}
                setPlaying={setPlaying}
                t={t}
              />
              {tweaks.tableauStyle === TABLEAU_STYLES.VERBOSE && (
                <Narration state={state} step={step} t={t} lang={tweaks.lang} />
              )}
              <StatGrid state={state} t={t} />
            </div>

            <SensitivityPanel state={state} t={t} />

            {lp.type === "ilp" && (
              <CutsPanel
                lp={effectiveLP}
                latestState={latestState}
                onRemoveLast={handleRemoveLastCut}
                onReset={handleResetCuts}
                t={t}
              />
            )}
          </div>
        )}
      </div>
      )}

      <TweaksPanel>
        <TweakSection label={t.layout}>
          <TweakRadio
            label={t.layout}
            value={tweaks.layout}
            options={[
              { value: "cols", label: t.threeCol },
              { value: "stacked", label: t.stacked },
            ]}
            onChange={(v) => setTweak("layout", v)}
          />
          <TweakRadio
            label={t.density}
            value={tweaks.density}
            options={[
              { value: "compact", label: t.compact },
              { value: "normal", label: "·" },
              { value: "airy", label: t.airy },
            ]}
            onChange={(v) => setTweak("density", v)}
          />
        </TweakSection>
        <TweakSection label={t.palette}>
          <TweakRadio
            label={t.palette}
            value={tweaks.palette}
            options={[
              { value: "default", label: "Vermiglio" },
              { value: "ink", label: "Inchiostro" },
              { value: "mono", label: "Mono" },
            ]}
            onChange={(v) => setTweak("palette", v)}
          />
          <TweakRadio
            label={t.tableauStyle}
            value={tweaks.tableauStyle}
            options={[
              { value: "classic", label: t.classic },
              { value: "verbose", label: t.verbose },
            ]}
            onChange={(v) => setTweak("tableauStyle", v)}
          />
        </TweakSection>
        <TweakSection label={t.geometry}>
          <TweakToggle
            label={t.showLevels}
            value={tweaks.showLevels}
            onChange={(v) => setTweak("showLevels", v)}
          />
          <TweakToggle
            label={t.showGradient}
            value={tweaks.showGradient}
            onChange={(v) => setTweak("showGradient", v)}
          />
          <TweakToggle
            label={t.showPath}
            value={tweaks.showPath}
            onChange={(v) => setTweak("showPath", v)}
          />
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
