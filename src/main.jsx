// Bundle entry — order matters: lower-level helpers attach to window first,
// then JSX components, then the root App that uses ReactDOM.createRoot.
import "./simplex.js";
import "./geometry.js";
import "./duality.js";
import "./cnf.js";
import "./i18n.js";
import "./tweaks-panel.jsx";
import "./problem.jsx";
import "./geometry-view.jsx";
import "./tableau.jsx";
import "./duality-view.jsx";
import "./cnf-view.jsx";
import "./app.jsx";
