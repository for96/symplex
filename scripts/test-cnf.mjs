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

const contextualCorpus = [
  {
    source: "Se il sensore è attivo, il cancello si apre.",
    shape: ">(X1,X2)",
  },
  {
    source: "Il cancello si apre se il sensore è attivo.",
    shape: ">(X2,X1)",
  },
  {
    source: "Il cancello si apre quando il sensore è attivo.",
    shape: ">(X2,X1)",
  },
  {
    source: "Il cancello si apre purché il badge sia valido.",
    shape: ">(X2,X1)",
  },
  {
    source: "Il cancello si apre a condizione che il badge sia valido.",
    shape: ">(X2,X1)",
  },
  {
    source: "Il cancello si apre a meno che il blocco sia attivo.",
    shape: ">(!X2,X1)",
  },
  {
    source: "Il controllo è valido se e soltanto se il codice è corretto.",
    shape: "=(X1,X2)",
  },
  {
    source: "Il controllo è valido equivale a il codice è corretto.",
    shape: "=(X1,X2)",
  },
  {
    source: "Il controllo è valido è equivalente a il codice è corretto.",
    shape: "=(X1,X2)",
  },
  {
    source: "Il badge valido è necessario per consentire l'accesso.",
    shape: ">(X2,X1)",
  },
  {
    source: "Il badge valido è sufficiente per consentire l'accesso.",
    shape: ">(X1,X2)",
  },
  {
    source: "L'accesso richiede il badge valido.",
    shape: ">(X1,X2)",
  },
  {
    source: "Il badge valido implica che l'accesso è consentito.",
    shape: ">(X1,X2)",
  },
  {
    source: "O il badge è valido o il codice è corretto.",
    shape: "|(X1,X2)",
  },
  {
    source: "Né il badge è valido né il codice è corretto.",
    shape: "&(!X1,!X2)",
  },
  {
    source: "Il badge è valido oppure il codice è corretto, ma non entrambi.",
    shape: "^(X1,X2)",
  },
  {
    source: "Non solo il badge è valido ma anche il codice è corretto.",
    shape: "&(X1,X2)",
  },
  {
    source: "Sia il badge è valido che il codice è corretto.",
    shape: "&(X1,X2)",
  },
  {
    source: "Non (piove oppure nevica).",
    shape: "!|(X1,X2)",
  },
  {
    source: "Se il badge è valido, allora il cancello si apre, altrimenti resta chiuso.",
    shape: "&(>(X1,X2),>(!X1,X3))",
  },
  {
    source: "\"ricerca e sviluppo è finanziata\" e il budget è approvato.",
    shape: "&(X1,X2)",
    labels: ["ricerca e sviluppo è finanziata", "il budget è approvato"],
  },
  {
    source: "Il badge è valido oppure il badge non è valido.",
    shape: "|(X1,!X1)",
  },
  {
    source: "The gate opens if the badge is valid.",
    shape: ">(X2,X1)",
  },
  {
    source: "The gate opens whenever the badge is valid.",
    shape: ">(X2,X1)",
  },
  {
    source: "The gate opens unless the lock is active.",
    shape: ">(!X2,X1)",
  },
  {
    source: "If the badge is valid, the gate opens.",
    shape: ">(X1,X2)",
  },
  {
    source: "Access is allowed if and only if the badge is valid.",
    shape: "=(X1,X2)",
  },
  {
    source: "The badge is necessary for access.",
    shape: ">(X2,X1)",
  },
  {
    source: "The badge is sufficient for access.",
    shape: ">(X1,X2)",
  },
  {
    source: "Either the badge is valid or the code is correct.",
    shape: "|(X1,X2)",
  },
  {
    source: "Neither the badge is valid nor the code is correct.",
    shape: "&(!X1,!X2)",
  },
  {
    source: "The badge is valid or the code is correct, but not both.",
    shape: "^(X1,X2)",
  },
  {
    source: "The alarm sounds or the alarm does not sound.",
    shape: "|(X1,!X1)",
    labels: ["The alarm sounds"],
  },
  {
    source: "Not (the badge is valid or the code is correct).",
    shape: "!|(X1,X2)",
  },
];
contextualCorpus.forEach((item) => verifyNatural(item.source, item.shape, item.labels));
assert.throws(
  () => analyzeCNF("\"assertion without closing quote", "phrase"),
  /cnf-unclosed-quote/
);

const projectFunding = verifyNatural(
  "Il progetto di ricerca C può essere finanziato solo se vengono finanziati contemporaneamente sia il progetto A che il progetto B.",
  ">(X1,&(X2,X3))",
  [
    "Il progetto di ricerca C può essere finanziato",
    "vengono finanziati: il progetto A",
    "vengono finanziati: il progetto B",
  ]
);
assert.deepEqual(clauseKeys(projectFunding), ["!X1|X2", "!X1|X3"]);
assert.deepEqual(projectFunding.constraints.map((item) => item.linearForm), [
  "−x1 + x2 ≥ 0",
  "−x1 + x3 ≥ 0",
]);

const operationsResearchCorpus = [
  {
    source: "Il progetto C viene finanziato solo se sono finanziati sia A sia B.",
    shape: ">(X1,&(X2,X3))",
  },
  {
    source: "C richiede che siano finanziati sia A che B.",
    shape: ">(X1,&(X2,X3))",
  },
  {
    source: "C richiede il finanziamento congiunto di A e B.",
    shape: ">(X1,&(X2,X3))",
  },
  {
    source: "C only if both A and B are funded.",
    shape: ">(X1,&(X2,X3))",
  },
  {
    source: "Devono essere scelti entrambi il progetto A e il progetto B.",
    shape: "&(X1,X2)",
  },
  {
    source: "Almeno uno tra il progetto A e il progetto B deve essere finanziato.",
    shape: "|(X1,X2)",
  },
  {
    source: "Al massimo uno tra il progetto A e il progetto B deve essere finanziato.",
    shape: "|(!X1,!X2)",
  },
  {
    source: "Esattamente uno tra il progetto A e il progetto B deve essere finanziato.",
    shape: "^(X1,X2)",
  },
  {
    source: "Solo uno dei progetti A e B deve essere finanziato.",
    shape: "^(X1,X2)",
  },
  {
    source: "Almeno due tra A, B e C devono essere finanziati.",
    shape: "&(&(|(X1,X2),|(X1,X3)),|(X2,X3))",
  },
  {
    source: "Al massimo due tra A, B e C devono essere finanziati.",
    shape: "|(|(!X1,!X2),!X3)",
  },
  {
    source: "Esattamente due tra i progetti A, B e C devono essere finanziati.",
    shape: "&(&(&(|(X1,X2),|(X1,X3)),|(X2,X3)),|(|(!X1,!X2),!X3))",
    labels: [
      "devono essere finanziati: A",
      "devono essere finanziati: B",
      "devono essere finanziati: C",
    ],
  },
  {
    source: "At least two of A, B and C are funded.",
    shape: "&(&(|(X1,X2),|(X1,X3)),|(X2,X3))",
  },
  {
    source: "Il progetto A e il progetto B sono incompatibili.",
    shape: "!&(X1,X2)",
  },
  {
    source: "Il progetto A esclude il progetto B.",
    shape: "!&(X1,X2)",
  },
  {
    source: "Il progetto A è incompatibile con il progetto B.",
    shape: "!&(X1,X2)",
  },
  {
    source: "Non possono essere finanziati contemporaneamente sia il progetto A che il progetto B.",
    shape: "!&(X1,X2)",
  },
  {
    source: "Il progetto A e il progetto B non possono essere entrambi finanziati.",
    shape: "!&(X1,X2)",
  },
  {
    source: "Project A and project B cannot both be funded.",
    shape: "!&(X1,X2)",
  },
  {
    source: "Il progetto A e il progetto B devono essere finanziati insieme.",
    shape: "=(X1,X2)",
  },
  {
    source: "Project A and project B must be selected together.",
    shape: "=(X1,X2)",
  },
  {
    source: "Il progetto A dipende dal progetto B.",
    shape: ">(X1,X2)",
  },
  {
    source: "Il progetto A è subordinato al progetto B.",
    shape: ">(X1,X2)",
  },
  {
    source: "Il progetto A costituisce un prerequisito per il progetto B.",
    shape: ">(X2,X1)",
  },
  {
    source: "Il progetto A può essere finanziato solo insieme al progetto B.",
    shape: ">(X1,X2)",
  },
  {
    source: "Il progetto C non può essere finanziato senza il progetto A e il progetto B.",
    shape: ">(X1,&(X2,X3))",
  },
  {
    source: "Project C cannot be funded without both project A and project B.",
    shape: ">(X1,&(X2,X3))",
  },
];
operationsResearchCorpus.forEach((item) => verifyNatural(item.source, item.shape, item.labels));

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
