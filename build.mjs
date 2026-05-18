import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const config = {
  entryPoints: ["src/main.jsx"],
  bundle: true,
  outfile: "dist/bundle.js",
  format: "iife",
  target: "es2020",
  loader: { ".jsx": "jsx", ".js": "js" },
  jsx: "transform",
  sourcemap: "linked",
  logLevel: "info",
  // React/ReactDOM stay as CDN globals — JSX is transpiled to React.createElement
  // calls that resolve `React` via the global scope (window.React).
};

if (watch) {
  const ctx = await esbuild.context(config);
  await ctx.watch();
  console.log("[esbuild] watching src/ — Ctrl+C to stop");
} else {
  await esbuild.build(config);
}
