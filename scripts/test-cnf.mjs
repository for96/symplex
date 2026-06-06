import assert from "node:assert/strict";
import { analyzeCNF, evaluate } from "../src/cnf.js";

function clauseKeys(result) {
  return result.clauses
    .map((clause) => clause.map((literal) => `${literal.negated ? "!" : ""}${literal.name}`).sort().join("|"))
    .sort();
}

function verifyEquivalent(source, mode = "formula") {
  const result = analyzeCNF(source, mode);
  const total = 2 ** result.variables.length;
  for (let mask = 0; mask < total; mask++) {
    const values = {};
    result.variables.forEach((name, index) => {
      values[name] = !!(mask & (1 << index));
    });
    const original = evaluate(result.ast, values);
    const cnf = result.clauses.every((clause) => clause.some((literal) => (
      literal.negated ? !values[literal.name] : values[literal.name]
    )));
    assert.equal(cnf, original, `${source} differs for assignment ${JSON.stringify(values)}`);
  }
  return result;
}

function astShape(node) {
  if (node.type === "var") return node.name;
  if (node.type === "const") return node.value ? "T" : "F";
  if (node.type === "not") return `!${astShape(node.child)}`;
  const operator = {
    and: "&",
    or: "|",
    xor: "^",
    implies: ">",
    iff: "=",
  }[node.type];
  return `${operator}(${astShape(node.left)},${astShape(node.right)})`;
}

function verifyNatural(source, expectedShape, expectedLabels = null) {
  const result = verifyEquivalent(source, "phrase");
  assert.equal(astShape(result.ast), expectedShape, source);
  if (expectedLabels) {
    assert.deepEqual(result.assertions.map((item) => item.label), expectedLabels, source);
  }
  return result;
}

const slides = verifyEquivalent("((X1 and X2) or (X1 and not X3)) => not X1");
assert.deepEqual(clauseKeys(slides), ["!X1|!X2", "!X1|X3"]);
assert.deepEqual(slides.constraints.map((item) => item.linearForm), ["x1 + x2 ≤ 1", "−x1 + x3 ≥ 0"]);

const xor = verifyEquivalent("A1 => (A2 xor A3)");
assert.deepEqual(clauseKeys(xor), ["!A1|!A2|!A3", "!A1|A2|A3"]);
assert.deepEqual(xor.constraints.map((item) => item.linearForm), ["−x1 + x2 + x3 ≥ 0", "x1 + x2 + x3 ≤ 2"]);

verifyEquivalent("A1 iff (A2 and not A3)");
verifyEquivalent("not (A1 or A2)");
verifyEquivalent("(A1 or not A1) and A2");

const slideExercises = [
  "not (A1 or A2)",
  "not (A1 and A2)",
  "A1 => not A2",
  "A1 => (A2 and A3)",
  "A1 => (A2 or A3)",
  "(A2 and A3) => A1",
  "A1 iff (A2 and not A3 and not A4)",
  "(A2 and A3 and A4) => A1",
  "(A2 or A3) => A1",
  "A1 and (A2 or A3)",
  "A1 or A2 and A3",
  "A1 iff (A2 or A3 or A4)",
  "A1 iff (A2 and A3 and A4)",
  "A1 iff (A2 xor A3)",
];
slideExercises.forEach((formula) => verifyEquivalent(formula));

const phrase = verifyEquivalent(
  "Se piove e fa freddo oppure nevica, allora non esco.",
  "phrase"
);
assert.equal(phrase.assertions.length, 4);
assert.equal(phrase.steps[0].rule, "formalization");

const naturalCorpus = [
  {
    source: "Se il sensore è attivo, allora l'allarme suona.",
    shape: ">(X1,X2)",
  },
  {
    source: "Se il sensore non è attivo, allora l'allarme suona.",
    shape: ">(!X1,X2)",
  },
  {
    source: "Se piove e fa freddo, allora resto a casa.",
    shape: ">(&(X1,X2),X3)",
  },
  {
    source: "Se piove oppure nevica, allora resto a casa.",
    shape: ">(|(X1,X2),X3)",
  },
  {
    source: "Se piove e fa freddo oppure nevica, allora resto a casa.",
    shape: ">(|(&(X1,X2),X3),X4)",
  },
  {
    source: "Se piove oppure fa freddo e tira vento, allora resto a casa.",
    shape: ">(|(X1,&(X2,X3)),X4)",
  },
  {
    source: "Se il server è sovraccarico e il database non è sincronizzato, oppure se il server è sovraccarico e la rete fallisce, allora il sistema si blocca.",
    shape: ">(|(&(X1,!X2),&(X1,X3)),X4)",
    labels: [
      "il server è sovraccarico",
      "il database è sincronizzato",
      "la rete fallisce",
      "il sistema si blocca",
    ],
  },
  {
    source: "Se il server è sovraccarico e il backup non è disponibile, oppure se il firewall è attivo, allora il servizio non risponde.",
    shape: ">(|(&(X1,!X2),X3),!X4)",
  },
  {
    source: "Se la pressione è alta xor la valvola è aperta, allora parte l'allarme.",
    shape: ">(^(X1,X2),X3)",
  },
  {
    source: "Il motore parte solo se la batteria è carica.",
    shape: ">(X1,X2)",
  },
  {
    source: "Il controllo è superato se e solo se il codice è valido.",
    shape: "=(X1,X2)",
  },
  {
    source: "La richiesta è valida implica il token è presente.",
    shape: ">(X1,X2)",
  },
  {
    source: "Il cancello si apre nel caso in cui il badge è valido e il codice è corretto.",
    shape: ">(&(X2,X3),X1)",
    labels: [
      "Il cancello si apre",
      "il badge è valido",
      "il codice è corretto",
    ],
  },
  {
    source: "Se il sensore è attivo e (la porta è aperta oppure la finestra è aperta), allora suona l'allarme.",
    shape: ">(&(X1,|(X2,X3)),X4)",
  },
  {
    source: "If the sensor is active and the valve is open, then the alarm sounds.",
    shape: ">(&(X1,X2),X3)",
  },
  {
    source: "If the sensor is not active, then the alarm does not sound.",
    shape: ">(!X1,!X2)",
  },
  {
    source: "Il sensore è attivo e la valvola è aperta.",
    shape: "&(X1,X2)",
  },
  {
    source: "Se il sensore è attivo e il sensore non è attivo, allora il test fallisce.",
    shape: ">(&(X1,!X1),X2)",
  },
  {
    source: "Se il nodo A è attivo oppure se il nodo B è attivo, allora il servizio parte.",
    shape: ">(|(X1,X2),X3)",
  },
  {
    source: "Se il carico arriva e la temperatura non raggiunge il target o si verifica un guasto, allora il lotto viene fermato.",
    shape: ">(|(&(X1,!X2),X3),X4)",
  },
  {
    source: "Se A e B e C, allora D.",
    shape: ">(&(&(X1,X2),X3),X4)",
  },
  {
    source: "Se A oppure B oppure C, allora D.",
    shape: ">(|(|(X1,X2),X3),X4)",
  },
  {
    source: "Se (A oppure B) e (C oppure D), allora si verifica l'evento finale.",
    shape: ">(&(|(X1,X2),|(X3,X4)),X5)",
  },
  {
    source: "A xor B.",
    shape: "^(X1,X2)",
  },
  {
    source: "Non piove oppure il terreno è asciutto.",
    shape: "|(!X1,X2)",
  },
  {
    source: "Se non piove e il terreno è asciutto, allora la gara continua.",
    shape: ">(&(!X1,X2),X3)",
  },
  {
    source: "Se il controllo è valido, allora il processo continua e il report viene salvato.",
    shape: ">(X1,&(X2,X3))",
  },
  {
    source: "Se il controllo è valido, allora il processo continua oppure viene chiesto un intervento.",
    shape: ">(X1,|(X2,X3))",
  },
  {
    source: "Se il nodo A è attivo, oppure se il nodo B è attivo, oppure se il nodo C è attivo, allora la rete è disponibile.",
    shape: ">(|(|(X1,X2),X3),X4)",
  },
  {
    source: "Se il nodo A è attivo e il canale A è libero, oppure se il nodo B è attivo e il canale B è libero, allora la trasmissione parte.",
    shape: ">(|(&(X1,X2),&(X3,X4)),X5)",
  },
  {
    source: "Se (il nodo A è attivo e il canale A è libero) oppure (il nodo B è attivo e il canale B è libero), allora la trasmissione parte.",
    shape: ">(|(&(X1,X2),&(X3,X4)),X5)",
  },
  {
    source: "L'accesso è consentito se e solo se il badge è valido e il badge non è scaduto.",
    shape: "=(X1,&(X2,!X3))",
  },
  {
    source: "Il processo continua solo se il controllo è valido e il blocco non è attivo.",
    shape: ">(X1,&(X2,!X3))",
  },
  {
    source: "Il report viene inviato nel caso in cui i dati sono completi oppure l'amministratore autorizza l'invio.",
    shape: ">(|(X2,X3),X1)",
  },
  {
    source: "If the cache is valid or the database is available, then the page loads and the error does not appear.",
    shape: ">(|(X1,X2),&(X3,!X4))",
  },
  {
    source: "Il sensore è attivo e (la porta è aperta oppure la finestra è aperta e la sirena è spenta).",
    shape: "&(X1,|(X2,&(X3,X4)))",
  },
  {
    source: "Non piove xor il terreno è asciutto.",
    shape: "^(!X1,X2)",
  },
  {
    source: "Se il server è sovraccarico e la rete fallisce, allora il sistema si blocca oppure viene inviato un allarme.",
    shape: ">(&(X1,X2),|(X3,X4))",
  },
  {
    source: "Se il sensore è attivo e la porta è aperta e la rete funziona oppure il tecnico è presente e il bypass è abilitato, allora l'impianto parte.",
    shape: ">(|(&(&(X1,X2),X3),&(X4,X5)),X6)",
  },
  {
    source: "Il servizio è disponibile se e solo se il server risponde oppure il backup è attivo.",
    shape: "=(X1,|(X2,X3))",
  },
];
naturalCorpus.forEach((item) => verifyNatural(item.source, item.shape, item.labels));

const productionPhrase = verifyEquivalent(
  "Il lotto di produzione non viene rilasciato nel caso in cui non sia arrivato il carico di titanio, ovvero, se è arrivato, la temperatura del reattore non ha raggiunto il target o si è verificato un calo di tensione.",
  "phrase"
);
assert.deepEqual(productionPhrase.assertions, [
  { name: "X1", label: "Il lotto di produzione viene rilasciato" },
  { name: "X2", label: "è arrivato il carico di titanio" },
  { name: "X3", label: "la temperatura del reattore ha raggiunto il target" },
  { name: "X4", label: "si è verificato un calo di tensione" },
]);
assert.deepEqual(clauseKeys(productionPhrase), ["!X1|!X4", "!X1|X2", "!X1|X3"]);
assert.deepEqual(productionPhrase.constraints.map((item) => item.linearForm), [
  "−x1 + x2 ≥ 0",
  "−x1 + x3 ≥ 0",
  "x1 + x4 ≤ 1",
]);

const tautology = verifyEquivalent("A or not A");
assert.equal(tautology.clauses.length, 0);
assert.equal(tautology.truth.status, "tautology");

console.log("CNF tests passed");
