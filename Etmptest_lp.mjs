import { readFileSync } from "fs";
const src = readFileSync("src/simplex.js", "utf8");
const shimmed = "var window = globalThis;\n" + src + "\nexport const Simplex = globalThis.Simplex;";
import("data:text/javascript;base64," + Buffer.from(shimmed).toString("base64")).then(({Simplex}) => {
  const lp = {
    objective: "max",
    c: [2, 3],
    varNames: ["x1", "x2"],
    constraints: [
      { a: [3, 4], op: "<=", b: 25 },
      { a: [1, -1], op: ">=", b: 1 },
    ],
  };
  const hist = Simplex.solve(lp);
  console.log("=== STEPS ===");
  hist.forEach((s, k) => {
    console.log(`Step ${k}: phase=${s.phase} status=${s.status} note=${s.note}`);
    console.log("  basis:", s.basis.map(b => s.colLabels[b]).join(", "));
    console.log("  colLabels:", s.colLabels.join(" | "));
    s.T.forEach((row, i) => {
      console.log("  ", row.map(v => v.toFixed(4).padStart(8)).join(" "), i===0?"<- z":"");
    });
  });
  const last = hist[hist.length - 1];
  console.log("\n=== FINAL ===");
  console.log("status:", last.status);
  console.log("z* =", Simplex.objectiveValue(last), "(expected 124/7 ≈", 124/7, ")");
  console.log("x =", Simplex.decisionPoint(last), "(expected [29/7, 22/7] = [", 29/7, ",", 22/7, "])");
  console.log("y =", Simplex.dualValues(last), "(expected [5/7, -1/7] = [", 5/7, ",", -1/7, "])");
  const sens = Simplex.sensitivity(last);
  console.log("sensitivity:", JSON.stringify(sens, null, 2));
});
