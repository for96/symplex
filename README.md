# Simplesso — Simulatore di Ricerca Operativa

Webapp didattica per il corso di Ricerca Operativa: algoritmo del **simplesso** a due fasi, **tagli di Gomory** e di **copertura** per problemi interi, **analisi di sensitività** e **dualità**.

Gira tutto nel browser in localStorage. React 18 caricato da CDN, JSX pre-compilato via esbuild in un singolo bundle.

## Funzionalità

- **Editor LP/ILP** strutturato e testuale, con storico locale
- **Simplesso a due fasi** con regola di Dantzig (gradiente) o di Bland
- **Visualizzazione geometrica 2D** della regione ammissibile, vertici, percorso del simplesso, vettore gradiente
- **Tagli di Gomory** (frazionari, fila per fila del tableau) e **tagli di copertura** (su variabili binarie), con resa anche sul piano cartesiano
- **Analisi di sensitività** sui costi e sui termini noti
- **Problema duale** generato automaticamente con visualizzazione
- **Workspace di dualità** separato: dato `x*` ricava `y*` (e viceversa) tramite scarti complementari, completo dei passaggi
- Tema chiaro/scuro, italiano/inglese, tipografia accademica

## Sviluppo locale

Requisiti: Node.js ≥ 18.

```bash
npm install
npm run build      # build singolo → dist/bundle.js
# oppure
npm run dev        # watch mode (ricompila a ogni salvataggio)
```

Apri `index.html` direttamente nel browser (funziona anche con `file://`) oppure lancia `Avvia.cmd` (Windows) per un server HTTP locale su `http://localhost:8000`.

## Deploy su Vercel

Il repository è già configurato (`vercel.json`):

1. Importa il repo su [vercel.com/new](https://vercel.com/new)
2. Conferma — niente da configurare, Vercel rileva `package.json` e usa:
   - **Build command**: `npm run build`
   - **Output directory**: `.` (la root, dove si trova `index.html` e la cartella `dist/` rigenerata)
3. Push su `main` → deploy automatico

La cartella `dist/` è in `.gitignore` perché viene ricreata da Vercel al build.

## Struttura del progetto

```
index.html              # Entry HTML, carica React da CDN + dist/bundle.js
styles.css              # Design tokens, temi, responsive
build.mjs               # Config esbuild
src/
  main.jsx              # Bundle entry: ordine import
  simplex.js            # Algoritmo: due fasi, pivoting, tagli, sensitività, duale
  geometry.js           # Vertici regione ammissibile, clipping rette
  duality.js            # Risoluzione duale via scarti complementari
  i18n.js               # Dizionario IT/EN
  app.jsx               # Root component, orchestrazione stato
  problem.jsx           # Editor LP/ILP
  tableau.jsx           # Vista tableau + step bar + tagli
  geometry-view.jsx     # SVG regione ammissibile
  duality-view.jsx      # Workspace dualità (cap. 4)
  tweaks-panel.jsx      # Pannello sviluppatore (palette, densità, tema)
```

### 📋 Todo
- [ ] Aggiungere i vincoli sulle variabili primali nel selettore problema Primale in **Dualità** 

## Crediti

Creato come strumento di studio per Ricerca Operativa.
