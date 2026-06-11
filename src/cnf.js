// Propositional logic -> CNF -> binary linear constraints.
// The engine is independent from React so it can be tested directly.

const MAX_CLAUSES = 512;
const MAX_LITERALS = 4096;

function variable(name) {
  return { type: "var", name };
}

function constant(value) {
  return { type: "const", value: !!value };
}

function unary(type, child) {
  return { type, child };
}

function binary(type, left, right) {
  return { type, left, right };
}

function normalizeSymbols(source) {
  return String(source || "")
    .replace(/[¬]/g, "!")
    .replace(/[∧]/g, " && ")
    .replace(/[∨]/g, " || ")
    .replace(/[⊕⊻]/g, " xor ")
    .replace(/[⇒→]/g, " => ")
    .replace(/[⇔↔]/g, " <=> ")
    .replace(/[≡]/g, " <=> ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
}

function formulaTokens(source) {
  const text = normalizeSymbols(source);
  const tokens = [];
  let i = 0;

  function pushWord(raw) {
    const word = raw.toLowerCase();
    const keywords = {
      not: "NOT",
      non: "NOT",
      and: "AND",
      e: "AND",
      or: "OR",
      oppure: "OR",
      o: "OR",
      xor: "XOR",
      iff: "IFF",
      equivale: "IFF",
      implies: "IMPLIES",
      implica: "IMPLIES",
      true: "TRUE",
      vero: "TRUE",
      false: "FALSE",
      falso: "FALSE",
    };
    tokens.push({ type: keywords[word] || "VAR", value: raw });
  }

  while (i < text.length) {
    if (/\s/.test(text[i])) {
      i++;
      continue;
    }
    const rest = text.slice(i);
    const multi = [
      ["<=>", "IFF"],
      ["<->", "IFF"],
      ["=>", "IMPLIES"],
      ["->", "IMPLIES"],
      ["&&", "AND"],
      ["||", "OR"],
    ].find(([op]) => rest.startsWith(op));
    if (multi) {
      tokens.push({ type: multi[1], value: multi[0] });
      i += multi[0].length;
      continue;
    }
    const single = {
      "(": "LPAREN",
      ")": "RPAREN",
      "!": "NOT",
      "&": "AND",
      "|": "OR",
      "^": "XOR",
    }[text[i]];
    if (single) {
      tokens.push({ type: single, value: text[i] });
      i++;
      continue;
    }
    if (text[i] === '"' || text[i] === "'") {
      const quote = text[i++];
      let value = "";
      while (i < text.length && text[i] !== quote) value += text[i++];
      if (text[i] !== quote) throw new Error("cnf-unclosed-quote");
      i++;
      if (!value.trim()) throw new Error("cnf-empty-atom");
      tokens.push({ type: "VAR", value: value.trim() });
      continue;
    }
    const match = rest.match(/^[A-Za-zÀ-ÖØ-öø-ÿ_][A-Za-zÀ-ÖØ-öø-ÿ0-9_]*/);
    if (match) {
      pushWord(match[0]);
      i += match[0].length;
      continue;
    }
    throw new Error(`cnf-invalid-character:${text[i]}`);
  }
  return { tokens, assertions: [] };
}

function positiveItalianAssertion(raw) {
  let text = String(raw || "")
    .replace(/^[\s,;:.]+|[\s,;:.]+$/g, "")
    .replace(/^(?:se|qualora|che|that)\s+/i, "")
    .replace(/^["“”]|["“”]$/g, "")
    .replace(/\b(?:isn't|aren't|wasn't|weren't)\b/gi, (word) => ({
      "isn't": "is not",
      "aren't": "are not",
      "wasn't": "was not",
      "weren't": "were not",
    })[word.toLowerCase()])
    .replace(/\b(?:doesn't|don't|didn't|won't|can't)\b/gi, (word) => ({
      "doesn't": "does not",
      "don't": "do not",
      "didn't": "did not",
      "won't": "will not",
      "can't": "can not",
    })[word.toLowerCase()])
    .replace(/\bcannot\b/gi, "can not")
    .replace(/\s+/g, " ")
    .trim();
  const negated =
    /\b(?:non|not|never|mai)\b/i.test(text) ||
    /^(?:nessun[oa]?|no)\s+/i.test(text);
  if (!negated) return { label: text, negated: false };

  text = text
    .replace(/\bdoes(?:\s+not|n't)\s+([a-z]+)\b/gi, (_, verb) => {
      if (verb === "have") return "has";
      if (verb === "be") return "is";
      if (/[^aeiou]y$/i.test(verb)) return `${verb.slice(0, -1)}ies`;
      if (/(?:s|sh|ch|x|z|o)$/i.test(verb)) return `${verb}es`;
      return `${verb}s`;
    })
    .replace(/\bnon\s+si\s+sia\b/i, "si è")
    .replace(/\bnon\s+sia\b/i, "è")
    .replace(/\bnon\s+abbia\b/i, "ha")
    .replace(/\bnon\s+venga\b/i, "viene")
    .replace(/\bnon\s+ha\b/i, "ha")
    .replace(/\bnon\s+è\b/i, "è")
    .replace(/^(?:nessun[oa]?|no)\s+/i, "")
    .replace(/\b(?:non|not|never|mai)\b/i, "")
    .replace(/\b(?:do|did)\s+(?=[a-z])/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return { label: text, negated: true };
}

function naturalText(source) {
  return normalizeSymbols(source)
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:.]+|[\s,;:.!?]+$/g, "")
    .trim();
}

function validateNaturalQuotes(text) {
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '"' && text[index - 1] !== "\\") quoted = !quoted;
  }
  if (quoted) throw new Error("cnf-unclosed-quote");
}

function naturalScanStateAt(text, targetIndex) {
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < targetIndex; index++) {
    const char = text[index];
    if (char === '"' && text[index - 1] !== "\\") {
      quoted = !quoted;
    } else if (!quoted && char === "(") {
      depth++;
    } else if (!quoted && char === ")") {
      depth = Math.max(0, depth - 1);
    }
  }
  return { depth, quoted };
}

function naturalTopLevelMatches(text, pattern) {
  const regex = new RegExp(pattern, "gi");
  const matches = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const state = naturalScanStateAt(text, match.index);
    if (state.depth === 0 && !state.quoted) matches.push(match);
    if (match[0].length === 0) regex.lastIndex++;
  }
  return matches;
}

function splitNaturalTopLevel(text, pattern, useLast = false) {
  const matches = naturalTopLevelMatches(text, pattern);
  if (matches.length === 0) return null;
  const match = useLast ? matches[matches.length - 1] : matches[0];
  const left = text.slice(0, match.index).trim();
  const right = text.slice(match.index + match[0].length).trim();
  if (!left || !right) return null;
  return { left, right, marker: match[0] };
}

function splitNaturalPunctuation(text) {
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"' && text[index - 1] !== "\\") {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (char === "(") depth++;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && (char === "," || char === ";")) {
      const left = text.slice(0, index).trim();
      const right = text.slice(index + 1).trim();
      if (left && right) return { left, right };
    }
  }
  return null;
}

function isWrappedNaturalExpression(text) {
  if (!text.startsWith("(") || !text.endsWith(")")) return false;
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"' && text[index - 1] !== "\\") {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (char === "(") depth++;
    else if (char === ")") depth--;
    if (depth === 0 && index < text.length - 1) return false;
  }
  return depth === 0;
}

function joinNaturalAst(type, nodes) {
  return nodes.reduce((left, right) => binary(type, left, right));
}

function splitNaturalList(text) {
  const matches = naturalTopLevelMatches(
    text,
    "(?:\\s*,\\s*|\\b(?:e|o|oppure|and|or)\\b)"
  );
  if (matches.length === 0) return [text.trim()].filter(Boolean);

  const parts = [];
  let cursor = 0;
  for (const match of matches) {
    const part = text.slice(cursor, match.index).trim();
    if (part) parts.push(part);
    cursor = match.index + match[0].length;
  }
  const last = text.slice(cursor).trim();
  if (last) parts.push(last);
  return parts;
}

function splitSharedPredicate(text) {
  const matches = naturalTopLevelMatches(
    text,
    "\\b(?:è|sono|viene|vengono|sarà|saranno|sia|siano|deve|devono|può|possono|ha|hanno|is|are|was|were|will|must|can|may|has|have)\\b"
  );
  if (matches.length === 0) return null;
  const match = matches[0];
  const subject = text.slice(0, match.index).trim();
  const predicate = text.slice(match.index).trim();
  return subject && predicate ? { subject, predicate } : null;
}

function sharedNaturalAssertions(prefix, items) {
  const sharedPrefix = String(prefix || "")
    .replace(/\b(?:contemporaneamente|simultaneamente|insieme)\s*$/i, "")
    .trim();
  if (sharedPrefix) {
    return items.map((item) => `${sharedPrefix}: ${item}`.trim());
  }

  if (splitSharedPredicate(items[0])) return items;
  const trailing = splitSharedPredicate(items[items.length - 1]);
  if (!trailing) return items;
  return items.map((item, index) => {
    const subject = index === items.length - 1 ? trailing.subject : item;
    return `${trailing.predicate}: ${subject}`.trim();
  });
}

function combinations(items, size) {
  const result = [];
  function visit(start, chosen) {
    if (chosen.length === size) {
      result.push(chosen.slice());
      if (result.length > MAX_CLAUSES) throw new Error("cnf-too-large");
      return;
    }
    for (let index = start; index <= items.length - (size - chosen.length); index++) {
      chosen.push(items[index]);
      visit(index + 1, chosen);
      chosen.pop();
    }
  }
  visit(0, []);
  return result;
}

function atMostKAst(nodes, count) {
  if (count < 0) return constant(false);
  if (count >= nodes.length) return constant(true);
  const clauses = combinations(nodes, count + 1).map((group) => (
    joinNaturalAst("or", group.map((node) => unary("not", node)))
  ));
  return clauses.length === 1 ? clauses[0] : joinNaturalAst("and", clauses);
}

function atLeastKAst(nodes, count) {
  if (count <= 0) return constant(true);
  if (count > nodes.length) return constant(false);
  const clauses = combinations(nodes, nodes.length - count + 1).map((group) => (
    joinNaturalAst("or", group)
  ));
  return clauses.length === 1 ? clauses[0] : joinNaturalAst("and", clauses);
}

function exactKAst(nodes, count) {
  if (count < 0 || count > nodes.length) return constant(false);
  if (nodes.length === 2 && count === 1) return binary("xor", nodes[0], nodes[1]);
  return binary("and", atLeastKAst(nodes, count), atMostKAst(nodes, count));
}

function naturalNumberValue(raw) {
  const normalized = String(raw || "").toLocaleLowerCase("it");
  if (/^\d+$/.test(normalized)) return Number(normalized);
  return {
    zero: 0,
    uno: 1,
    una: 1,
    one: 1,
    due: 2,
    two: 2,
    tre: 3,
    three: 3,
    quattro: 4,
    four: 4,
    cinque: 5,
    five: 5,
    sei: 6,
    six: 6,
    sette: 7,
    seven: 7,
    otto: 8,
    eight: 8,
    nove: 9,
    nine: 9,
    dieci: 10,
    ten: 10,
  }[normalized];
}

function parseQuantifiedNaturalExpression(text, registry) {
  const number = "(zero|uno|una|one|due|two|tre|three|quattro|four|cinque|five|sei|six|sette|seven|otto|eight|nove|nine|dieci|ten|\\d+)";
  const classifier = "(?:\\s+(?:progett[oi]|alternative?|opzion[ei]|projects?|alternatives?|options?))?";
  const patterns = [
    {
      kind: "exactly",
      pattern: `\\b(?:esattamente|exactly)\\s+${number}${classifier}(?:\\s+(?:tra|fra|di|dei|delle|of))?\\b`,
      countGroup: 1,
    },
    {
      kind: "exactly",
      pattern: "\\b(?:(?:uno|una|one)\\s+(?:e|and)\\s+(?:uno|one)\\s+(?:solo|soltanto|only)|(?:solo|soltanto|only)\\s+(?:uno|una|one)|(?:uno|una|one)\\s+(?:solo|soltanto|only))(?:\\s+(?:progett[oi]|alternative?|opzion[ei]|projects?|alternatives?|options?))?(?:\\s+(?:tra|fra|di|dei|delle|of))?\\b",
      fixedCount: 1,
    },
    {
      kind: "at-most",
      pattern: `\\b(?:al\\s+massimo|non\\s+più\\s+di|non\\s+piu\\s+di|at\\s+most|no\\s+more\\s+than)\\s+${number}${classifier}(?:\\s+(?:tra|fra|di|dei|delle|of))?\\b`,
      countGroup: 1,
    },
    {
      kind: "at-least",
      pattern: `\\b(?:almeno|at\\s+least)\\s+${number}${classifier}(?:\\s+(?:tra|fra|di|dei|delle|of))?\\b`,
      countGroup: 1,
    },
    {
      kind: "not-all",
      pattern: "\\b(?:non\\s+(?:entrambi|entrambe|tutti\\s+e\\s+due)|not\\s+both)\\b",
    },
    {
      kind: "all",
      pattern: "\\b(?:entrambi|entrambe|ambedue|tutti\\s+e\\s+due|both|congiuntamente|simultaneamente|il\\s+finanziamento\\s+congiunto\\s+di|la\\s+selezione\\s+congiunta\\s+di)\\b",
    },
  ];

  for (const definition of patterns) {
    const matches = naturalTopLevelMatches(text, definition.pattern);
    if (matches.length === 0) continue;
    const match = matches[0];
    const prefix = text.slice(0, match.index).trim();
    const tail = text
      .slice(match.index + match[0].length)
      .trim()
      .replace(/^(?:(?:i|le|the)\s+)?(?:progett[oi]|alternative?|opzion[ei]|projects?|alternatives?|options?)\s+/i, "")
      .trim();
    const items = splitNaturalList(tail);
    if (items.length < 2) continue;

    const assertions = sharedNaturalAssertions(prefix, items);
    const nodes = assertions.map((assertion) => parseNaturalClause(assertion, registry));
    if (definition.kind === "all") return joinNaturalAst("and", nodes);
    if (definition.kind === "not-all") return unary("not", joinNaturalAst("and", nodes));
    const count = definition.fixedCount ?? naturalNumberValue(match[definition.countGroup]);
    if (!Number.isInteger(count)) continue;
    if (definition.kind === "at-least") return atLeastKAst(nodes, count);
    if (definition.kind === "at-most") return atMostKAst(nodes, count);
    return exactKAst(nodes, count);
  }
  return null;
}

function parseItalianCorrelative(text, registry) {
  const firstMarkers = naturalTopLevelMatches(text, "\\bsia\\b");
  for (let index = firstMarkers.length - 1; index >= 0; index--) {
    const firstMarker = firstMarkers[index];
    const tail = text.slice(firstMarker.index + firstMarker[0].length);
    const secondMarkers = naturalTopLevelMatches(tail, "\\b(?:sia|che)\\b");
    if (secondMarkers.length === 0) continue;

    const secondMarker = secondMarkers[0];
    const prefix = text.slice(0, firstMarker.index).trim();
    const first = tail.slice(0, secondMarker.index).trim();
    const second = tail.slice(secondMarker.index + secondMarker[0].length).trim();
    if (!first || !second) continue;

    const forbiddenTogether =
      /\bnon\s+(?:possono|devono|potranno)\b/i.test(prefix) &&
      /\b(?:contemporaneamente|simultaneamente|insieme)\b/i.test(prefix);
    if (forbiddenTogether) {
      const nodes = [first, second].map((assertion) => parseNaturalClause(assertion, registry));
      return unary("not", joinNaturalAst("and", nodes));
    }
    const assertions = sharedNaturalAssertions(prefix, [first, second]);
    const nodes = assertions.map((assertion) => parseNaturalClause(assertion, registry));
    return joinNaturalAst("and", nodes);
  }
  return null;
}

function parseMutualExclusion(text, registry) {
  const direct = splitNaturalTopLevel(
    text,
    "(?:(?:è|e')\\s+incompatibile\\s+con\\b|\\b(?:is\\s+incompatible\\s+with|esclude|excludes)\\b)"
  );
  if (direct) {
    return unary(
      "not",
      binary(
        "and",
        parseNaturalClause(direct.left, registry),
        parseNaturalClause(direct.right, registry)
      )
    );
  }

  const relation = naturalTopLevelMatches(
    text,
    "\\s+(?:sono\\s+(?:mutuamente\\s+)?(?:incompatibili|esclusiv[ei])|non\\s+possono\\s+essere\\s+(?:entramb[ei]\\s+.+|.+?(?:contemporaneamente|simultaneamente|insieme))|are\\s+(?:mutually\\s+)?(?:incompatible|exclusive)|cannot\\s+(?:both\\s+be\\s+.+|be\\s+.+?(?:together|simultaneously)))\\s*$"
  );
  if (relation.length === 0) return null;
  const subjects = text.slice(0, relation[0].index).trim();
  const items = splitNaturalList(subjects);
  if (items.length < 2) return null;
  const nodes = items.map((item) => parseNaturalClause(item, registry));
  return unary("not", joinNaturalAst("and", nodes));
}

function parseJointSelection(text, registry) {
  const relation = naturalTopLevelMatches(
    text,
    "\\s+(?:(?:devono|dovranno)\\s+essere\\s+.+?(?:contemporaneamente|simultaneamente|insieme)|must\\s+(?:both\\s+)?be\\s+.+?(?:together|simultaneously))\\s*$"
  );
  if (relation.length === 0) return null;
  const subjects = text.slice(0, relation[0].index).trim();
  const items = splitNaturalList(subjects);
  if (items.length < 2) return null;
  const nodes = items.map((item) => parseNaturalClause(item, registry));
  const links = nodes.slice(1).map((node) => binary("iff", nodes[0], node));
  return links.length === 1 ? links[0] : joinNaturalAst("and", links);
}

function createNaturalRegistry() {
  return {
    assertions: [],
    names: new Map(),
  };
}

function naturalAtomName(registry, label) {
  const key = label
    .toLocaleLowerCase("it")
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  if (registry.names.has(key)) return registry.names.get(key);
  const name = `X${registry.assertions.length + 1}`;
  registry.names.set(key, name);
  registry.assertions.push({ name, label });
  return name;
}

function naturalExpressionTokens(source, registry) {
  const text = naturalText(source)
    .replace(/\boppure\s+se\b/gi, " oppure ")
    .replace(/\bo\s+se\b/gi, " o ")
    .replace(/\band\s+if\b/gi, " and ")
    .replace(/\bor\s+if\b/gi, " or ")
    .replace(/\bnon\s+solo\b/gi, "")
    .replace(/\bma\s+anche\b/gi, " e ")
    .replace(/\b(?:nonché|nonche|ed)\b/gi, " e ")
    .replace(/\b(?:and\s+also|as\s+well\s+as)\b/gi, " and ")
    .replace(/\bod\b/gi, " o ")
    .replace(/\b(?:ma|però|pero|however)\b/gi, " e ");
  const marker = /(<=>|<->|=>|->|&&|\|\||[()!&|^]|\b(?:non|not)\b(?=\s*\()|\bxor\b|\boppure\b|\bor\b|\band\b|\be\b|\bo\b)/gi;
  const pieces = [];
  let cursor = 0;
  let match;
  while ((match = marker.exec(text)) !== null) {
    if (naturalScanStateAt(text, match.index).quoted) continue;
    pieces.push({ kind: "text", value: text.slice(cursor, match.index) });
    pieces.push({ kind: "marker", value: match[0] });
    cursor = match.index + match[0].length;
  }
  pieces.push({ kind: "text", value: text.slice(cursor) });

  const tokens = [];
  function flushAtom(raw) {
    const atom = positiveItalianAssertion(raw);
    if (!atom.label) return;
    const lower = atom.label.toLocaleLowerCase("it");
    if (lower === "vero" || lower === "true") {
      tokens.push({ type: atom.negated ? "FALSE" : "TRUE", value: atom.label });
      return;
    }
    if (lower === "falso" || lower === "false") {
      tokens.push({ type: atom.negated ? "TRUE" : "FALSE", value: atom.label });
      return;
    }
    if (atom.negated) tokens.push({ type: "NOT", value: "non" });
    tokens.push({ type: "VAR", value: naturalAtomName(registry, atom.label) });
  }

  for (const piece of pieces) {
    if (piece.kind === "text") {
      flushAtom(piece.value);
      continue;
    }
    const value = piece.value.toLowerCase().trim();
    const type =
      value === "<=>" || value === "<->" ? "IFF" :
      value === "=>" || value === "->" ? "IMPLIES" :
      value === "&&" || value === "&" || value === "and" || value === "e" ? "AND" :
      value === "||" || value === "|" || value === "or" || value === "oppure" || value === "o" ? "OR" :
      value === "xor" || value === "^" ? "XOR" :
      value === "!" || value === "non" || value === "not" ? "NOT" :
      value === "(" ? "LPAREN" :
      value === ")" ? "RPAREN" : null;
    if (type) tokens.push({ type, value: piece.value });
  }
  return tokens;
}

function parseNaturalExpression(source, registry) {
  let text = naturalText(source);

  const quantified = parseQuantifiedNaturalExpression(text, registry);
  if (quantified) return quantified;

  const correlative = parseItalianCorrelative(text, registry);
  if (correlative) return correlative;

  const exclusion = parseMutualExclusion(text, registry);
  if (exclusion) return exclusion;

  const joint = parseJointSelection(text, registry);
  if (joint) return joint;

  const neitherPrefix = text.match(/^(?:né|ne|neither)\s+/i);
  if (neitherPrefix) {
    const body = text.slice(neitherPrefix[0].length);
    const parts = [];
    let cursor = 0;
    for (const match of naturalTopLevelMatches(body, "(?:né|\\bne\\b|\\bnor\\b)")) {
      parts.push(body.slice(cursor, match.index).trim());
      cursor = match.index + match[0].length;
    }
    parts.push(body.slice(cursor).trim());
    const nodes = parts.filter(Boolean).map((part) => unary("not", parseNaturalClause(part, registry)));
    if (nodes.length >= 2) return joinNaturalAst("and", nodes);
  }

  if (/^both\s+/i.test(text)) text = text.replace(/^both\s+/i, "");
  if (/^(?:either|o|oppure)\s+/i.test(text)) {
    text = text.replace(/^(?:either|o|oppure)\s+/i, "");
  }

  const exclusiveMatches = naturalTopLevelMatches(
    text,
    "\\s*,?\\s*(?:ma\\s+non\\s+(?:entrambi|entrambe)|but\\s+not\\s+both)\\s*$"
  );
  if (exclusiveMatches.length > 0) {
    const exclusive = exclusiveMatches[exclusiveMatches.length - 1];
    const alternatives = splitNaturalTopLevel(
      text.slice(0, exclusive.index).trim(),
      "\\b(?:o|oppure|or)\\b"
    );
    if (alternatives) {
      return binary(
        "xor",
        parseNaturalClause(alternatives.left, registry),
        parseNaturalClause(alternatives.right, registry)
      );
    }
  }

  const tokens = naturalExpressionTokens(text, registry);
  return parseTokens({ tokens, assertions: registry.assertions }).ast;
}

function splitItalianOr(source) {
  return String(source || "")
    .split(/\s+(?:o|oppure|ovvero)\s+/i)
    .map((part) => part.replace(/^[\s,;:.]+|[\s,;:.]+$/g, "").trim())
    .filter(Boolean);
}

// Recognizes the "P nel caso in cui Q, ovvero, se ... R o S" construction
// used in the lecture slides. The clause after "se" resumes the first event:
// ¬X2 ∨ [X2 ∧ (...)] ⇒ ±X1.
function parseItalianCasePhrase(source) {
  const text = String(source || "").replace(/\s+/g, " ").trim();
  const match = text.match(
    /^(.+?)\s+nel caso in cui\s+(.+?),\s*ovvero\s*,?\s*se\s+(.+?),\s*(.+?)[.!?]*$/i
  );
  if (!match) return null;

  const main = positiveItalianAssertion(match[1]);
  const firstCase = positiveItalianAssertion(match[2]);
  const alternatives = splitItalianOr(match[4]).map(positiveItalianAssertion);
  if (!main.label || !firstCase.label || alternatives.length === 0) return null;

  const assertions = [
    { name: "X1", label: main.label },
    { name: "X2", label: firstCase.label },
    ...alternatives.map((item, index) => ({ name: `X${index + 3}`, label: item.label })),
  ];

  const mainNode = main.negated ? unary("not", variable("X1")) : variable("X1");
  const firstNode = firstCase.negated ? unary("not", variable("X2")) : variable("X2");
  const resumedFirstNode = firstCase.negated ? variable("X2") : unary("not", variable("X2"));
  const alternativeNodes = alternatives.map((item, index) => {
    const atom = variable(`X${index + 3}`);
    return item.negated ? unary("not", atom) : atom;
  });
  const alternativeNode = alternativeNodes.reduce((left, right) => binary("or", left, right));
  const cases = binary("or", firstNode, binary("and", resumedFirstNode, alternativeNode));

  return {
    ast: binary("implies", cases, mainNode),
    variables: assertions.map((item) => item.name),
    assertions,
    phrasePattern: "italian-case",
  };
}

function parseNaturalClause(source, registry, depth = 0) {
  if (depth > 64) throw new Error("cnf-too-large");
  const text = naturalText(source)
    .replace(/\boppure\s+se\b/gi, "oppure ")
    .replace(/\bo\s+se\b/gi, "o ")
    .replace(/\band\s+if\b/gi, "and ")
    .replace(/\bor\s+if\b/gi, "or ");
  if (!text) throw new Error("cnf-empty-input");

  if (isWrappedNaturalExpression(text)) {
    return parseNaturalClause(text.slice(1, -1), registry, depth + 1);
  }

  const conditionalPrefix = text.match(
    /^(?:se|qualora|if|nel\s+caso\s+in\s+cui|quando|ogni\s+volta\s+che|whenever|provided\s+that|purché|purche)\s+/i
  );
  if (conditionalPrefix) {
    const body = text.slice(conditionalPrefix[0].length);
    const explicitThen = splitNaturalTopLevel(body, "\\b(?:allora|then)\\b");
    const parts = explicitThen || splitNaturalPunctuation(body);
    if (parts) {
      const condition = parseNaturalClause(parts.left, registry, depth + 1);
      const otherwise = splitNaturalTopLevel(
        parts.right,
        "\\b(?:altrimenti|otherwise|in\\s+caso\\s+contrario)\\b"
      );
      if (otherwise) {
        return binary(
          "and",
          binary("implies", condition, parseNaturalClause(otherwise.left, registry, depth + 1)),
          binary("implies", unary("not", condition), parseNaturalClause(otherwise.right, registry, depth + 1))
        );
      }
      return binary("implies", condition, parseNaturalClause(parts.right, registry, depth + 1));
    }
  }

  const iff = splitNaturalTopLevel(
    text,
    "(?:\\b(?:se\\s+e\\s+(?:solo|soltanto)\\s+se|if\\s+and\\s+only\\s+if|iff|equivale\\s+a|is\\s+equivalent\\s+to|esattamente\\s+quando|exactly\\s+when)\\b|(?:è|e')\\s+equivalente\\s+a\\b)"
  ) || splitNaturalTopLevel(
    text,
    "\\s+(?:è|e')\\s+(?:una\\s+)?condizione\\s+necessaria\\s+e\\s+sufficiente\\s+(?:per|affinché|affinche)\\s+"
  ) || splitNaturalTopLevel(
    text,
    "\\s+is\\s+(?:a\\s+)?necessary\\s+and\\s+sufficient\\s+condition\\s+for\\s+"
  );
  if (iff) {
    return binary(
      "iff",
      parseNaturalClause(iff.left, registry, depth + 1),
      parseNaturalClause(iff.right, registry, depth + 1)
    );
  }

  const unless = splitNaturalTopLevel(text, "\\b(?:a\\s+meno\\s+che|unless)\\b");
  if (unless) {
    const left = parseNaturalClause(unless.left, registry, depth + 1);
    const condition = parseNaturalClause(unless.right, registry, depth + 1);
    return binary("implies", unary("not", condition), left);
  }

  const without = splitNaturalTopLevel(text, "\\b(?:senza|without)\\b");
  if (without) {
    const dependent = without.left
      .replace(/\bnon\s+(?:può|puo|potrà|potra)(?=\s|$)/i, "può")
      .replace(/\b(?:cannot|can't)\b/i, "can");
    return binary(
      "implies",
      parseNaturalClause(dependent, registry, depth + 1),
      parseNaturalClause(without.right, registry, depth + 1)
    );
  }

  const onlyIf = splitNaturalTopLevel(
    text,
    "(?:\\b(?:(?:solo|soltanto|unicamente)\\s+(?:se|quando|insieme\\s+(?:a|al|alla))|only\\s+(?:if|when|together\\s+with)|dipende\\s+(?:da|dal|dalla|dai|dalle)|necessita\\s+di|presuppone|depends\\s+on|is\\s+(?:conditional|subject)\\s+to)\\b|(?:è|e')\\s+(?:subordinat[oa]|vincolat[oa])\\s+(?:a|al|alla)\\b)"
  );
  if (onlyIf) {
    return binary(
      "implies",
      parseNaturalClause(onlyIf.left, registry, depth + 1),
      parseNaturalClause(onlyIf.right, registry, depth + 1)
    );
  }

  const sufficient = splitNaturalTopLevel(
    text,
    "\\s+(?:è|e')\\s+(?:una\\s+condizione\\s+)?sufficient[ei]?\\s+(?:perché|perche|affinché|affinche|per)\\s+"
  ) || splitNaturalTopLevel(
    text,
    "\\s+is\\s+(?:a\\s+)?sufficient(?:\\s+condition)?\\s+for\\s+"
  );
  if (sufficient) {
    return binary(
      "implies",
      parseNaturalClause(sufficient.left, registry, depth + 1),
      parseNaturalClause(sufficient.right, registry, depth + 1)
    );
  }

  const necessary = splitNaturalTopLevel(
    text,
    "\\s+(?:è|e')\\s+(?:una\\s+condizione\\s+)?necessari[oa]?\\s+(?:perché|perche|affinché|affinche|per)\\s+"
  ) || splitNaturalTopLevel(
    text,
    "\\s+(?:è|e'|costituisce)\\s+(?:un\\s+)?prerequisito\\s+per\\s+"
  ) || splitNaturalTopLevel(
    text,
    "\\s+is\\s+(?:a\\s+)?necessary(?:\\s+condition)?\\s+for\\s+"
  );
  if (necessary) {
    const left = parseNaturalClause(necessary.left, registry, depth + 1);
    const right = parseNaturalClause(necessary.right, registry, depth + 1);
    return binary("implies", right, left);
  }

  const direct = splitNaturalTopLevel(
    text,
    "\\b(?:implica(?:\\s+che)?|implies(?:\\s+that)?|comporta(?:\\s+che)?|garantisce(?:\\s+che)?|ensures(?:\\s+that)?|quindi|pertanto|therefore|richiede|requires)\\b"
  );
  if (direct) {
    return binary(
      "implies",
      parseNaturalClause(direct.left, registry, depth + 1),
      parseNaturalClause(direct.right, registry, depth + 1)
    );
  }

  const reverse = splitNaturalTopLevel(
    text,
    "(?:\\b(?:nel\\s+caso\\s+in\\s+cui|a\\s+condizione\\s+che|a\\s+patto\\s+che|qualora|purche|provided\\s+that|as\\s+long\\s+as|ogni\\s+volta\\s+che|whenever|quando|when|se|if|perche|because)\\b|(?:purché|perché)(?=\\s|$))"
  );
  if (reverse) {
    const left = parseNaturalClause(reverse.left, registry, depth + 1);
    const right = parseNaturalClause(reverse.right, registry, depth + 1);
    return binary("implies", right, left);
  }

  return parseNaturalExpression(text, registry);
}

function parseNaturalPhrase(source) {
  const specialCase = parseItalianCasePhrase(source);
  if (specialCase) return specialCase;

  const text = naturalText(source);
  if (!text) throw new Error("cnf-empty-input");
  validateNaturalQuotes(text);

  const registry = createNaturalRegistry();
  const ast = parseNaturalClause(text, registry);
  return {
    ast,
    variables: registry.assertions.map((item) => item.name),
    assertions: registry.assertions,
    phrasePattern: "natural",
  };
}

function parseTokens(tokenData) {
  const tokens = tokenData.tokens;
  let pos = 0;
  const variableOrder = [];
  const seenVariables = new Set();

  function peek(type) {
    return tokens[pos] && tokens[pos].type === type;
  }

  function take(type) {
    if (!peek(type)) return null;
    return tokens[pos++];
  }

  function parsePrimary() {
    if (take("LPAREN")) {
      const value = parseIff();
      if (!take("RPAREN")) throw new Error("cnf-missing-close-paren");
      return value;
    }
    const token = tokens[pos++];
    if (!token) throw new Error("cnf-unexpected-end");
    if (token.type === "TRUE") return constant(true);
    if (token.type === "FALSE") return constant(false);
    if (token.type !== "VAR") throw new Error(`cnf-unexpected-token:${token.value}`);
    if (!seenVariables.has(token.value)) {
      seenVariables.add(token.value);
      variableOrder.push(token.value);
    }
    return variable(token.value);
  }

  function parseNot() {
    if (take("NOT")) return unary("not", parseNot());
    return parsePrimary();
  }

  function parseAnd() {
    let left = parseNot();
    while (take("AND")) left = binary("and", left, parseNot());
    return left;
  }

  function parseXor() {
    let left = parseAnd();
    while (take("XOR")) left = binary("xor", left, parseAnd());
    return left;
  }

  function parseOr() {
    let left = parseXor();
    while (take("OR")) left = binary("or", left, parseXor());
    return left;
  }

  function parseImplies() {
    const left = parseOr();
    if (take("IMPLIES")) return binary("implies", left, parseImplies());
    return left;
  }

  function parseIff() {
    let left = parseImplies();
    while (take("IFF")) left = binary("iff", left, parseImplies());
    return left;
  }

  if (tokens.length === 0) throw new Error("cnf-empty-input");
  const ast = parseIff();
  if (pos < tokens.length) throw new Error(`cnf-unexpected-token:${tokens[pos].value}`);
  return { ast, variables: variableOrder, assertions: tokenData.assertions };
}

function parseLogic(source, mode = "formula") {
  if (mode === "phrase") return parseNaturalPhrase(source);
  return parseTokens(formulaTokens(source));
}

const PRECEDENCE = {
  iff: 1,
  implies: 2,
  or: 3,
  xor: 4,
  and: 5,
  not: 6,
  var: 7,
  const: 7,
};

function groupFormula(text, depth) {
  return depth % 2 === 0 ? `[${text}]` : `(${text})`;
}

function formatAst(node, groupDepth = 0) {
  if (node.type === "var") return node.name;
  if (node.type === "const") return node.value ? "T" : "F";
  if (node.type === "not") {
    const inner = formatAst(node.child, groupDepth + 1);
    return node.child.type === "var" || node.child.type === "const"
      ? `¬${inner}`
      : `¬${groupFormula(inner, groupDepth)}`;
  }
  const symbols = {
    and: "∧",
    or: "∨",
    xor: "⊕",
    implies: "⇒",
    iff: "⇔",
  };
  function formatChild(child) {
    const childText = formatAst(child, groupDepth + 1);
    if (child.type === "var" || child.type === "const" || child.type === "not") return childText;
    const lowerPrecedence = PRECEDENCE[child.type] < PRECEDENCE[node.type];
    const compoundImplicationSide = node.type === "implies" || node.type === "iff";
    const explicitMixedBranch =
      (node.type === "or" && child.type === "and") ||
      (node.type === "and" && child.type === "or");
    return lowerPrecedence || compoundImplicationSide || explicitMixedBranch
      ? groupFormula(childText, groupDepth)
      : childText;
  }

  return `${formatChild(node.left)} ${symbols[node.type]} ${formatChild(node.right)}`;
}

function astKey(node) {
  if (node.type === "var") return `v:${node.name}`;
  if (node.type === "const") return node.value ? "T" : "F";
  if (node.type === "not") return `n(${astKey(node.child)})`;
  return `${node.type}(${astKey(node.left)},${astKey(node.right)})`;
}

function areComplements(left, right) {
  return (
    left.type === "not" && astKey(left.child) === astKey(right)
  ) || (
    right.type === "not" && astKey(right.child) === astKey(left)
  );
}

function simplifyBooleanAst(node, reasons = new Set()) {
  if (node.type === "var" || node.type === "const") return node;
  if (node.type === "not") {
    const child = simplifyBooleanAst(node.child, reasons);
    if (child.type === "not") {
      reasons.add("double-negation");
      return simplifyBooleanAst(child.child, reasons);
    }
    if (child.type === "const") return constant(!child.value);
    return unary("not", child);
  }

  const left = simplifyBooleanAst(node.left, reasons);
  const right = simplifyBooleanAst(node.right, reasons);
  if (node.type !== "and" && node.type !== "or") return binary(node.type, left, right);

  if (astKey(left) === astKey(right)) {
    reasons.add("idempotence");
    return left;
  }
  if (areComplements(left, right)) {
    reasons.add("complement");
    return constant(node.type === "or");
  }

  if (node.type === "or") {
    if (left.type === "const") return left.value ? left : right;
    if (right.type === "const") return right.value ? right : left;
  } else {
    if (left.type === "const") return left.value ? right : left;
    if (right.type === "const") return right.value ? left : right;
  }

  const nestedType = node.type === "or" ? "and" : "or";
  function reduceWithNested(plain, nested) {
    if (nested.type !== nestedType) return null;
    if (astKey(plain) === astKey(nested.left) || astKey(plain) === astKey(nested.right)) {
      reasons.add("absorption");
      return plain;
    }
    if (areComplements(plain, nested.left)) {
      reasons.add("distribution");
      reasons.add("complement");
      return binary(node.type, plain, nested.right);
    }
    if (areComplements(plain, nested.right)) {
      reasons.add("distribution");
      reasons.add("complement");
      return binary(node.type, plain, nested.left);
    }
    return null;
  }

  const reduced = reduceWithNested(left, right) || reduceWithNested(right, left);
  return reduced ? simplifyBooleanAst(reduced, reasons) : binary(node.type, left, right);
}

function rewriteIffAndXor(node, used) {
  if (node.type === "var" || node.type === "const") return node;
  if (node.type === "not") return unary("not", rewriteIffAndXor(node.child, used));
  const left = rewriteIffAndXor(node.left, used);
  const right = rewriteIffAndXor(node.right, used);
  if (node.type === "iff") {
    used.add("iff");
    return binary("and", binary("implies", left, right), binary("implies", right, left));
  }
  if (node.type === "xor") {
    used.add("xor");
    return binary(
      "or",
      binary("and", left, unary("not", right)),
      binary("and", unary("not", left), right)
    );
  }
  return binary(node.type, left, right);
}

function rewriteImplications(node, used) {
  if (node.type === "var" || node.type === "const") return node;
  if (node.type === "not") return unary("not", rewriteImplications(node.child, used));
  const left = rewriteImplications(node.left, used);
  const right = rewriteImplications(node.right, used);
  if (node.type === "implies") {
    used.add("implies");
    return binary("or", unary("not", left), right);
  }
  return binary(node.type, left, right);
}

function toNnf(node, negate = false, used = new Set()) {
  if (node.type === "const") return constant(negate ? !node.value : node.value);
  if (node.type === "var") return negate ? unary("not", node) : node;
  if (node.type === "not") {
    if (node.child.type === "not") used.add("double-negation");
    return toNnf(node.child, !negate, used);
  }
  if (node.type !== "and" && node.type !== "or") {
    throw new Error("cnf-derived-operator-left");
  }
  if (negate) used.add("de-morgan");
  const type = negate ? (node.type === "and" ? "or" : "and") : node.type;
  return binary(type, toNnf(node.left, negate, used), toNnf(node.right, negate, used));
}

function clausesFromNnf(node) {
  let literalCount = 0;

  function visit(current) {
    if (current.type === "const") return current.value ? [] : [[]];
    if (current.type === "var") {
      literalCount++;
      return [[{ name: current.name, negated: false }]];
    }
    if (current.type === "not" && current.child.type === "var") {
      literalCount++;
      return [[{ name: current.child.name, negated: true }]];
    }
    if (current.type === "and") {
      const clauses = visit(current.left).concat(visit(current.right));
      if (clauses.length > MAX_CLAUSES) throw new Error("cnf-too-large");
      return clauses;
    }
    if (current.type === "or") {
      const left = visit(current.left);
      const right = visit(current.right);
      if (left.length === 0 || right.length === 0) return [];
      const clauses = [];
      for (const a of left) {
        for (const b of right) {
          const clause = a.concat(b);
          literalCount += clause.length;
          if (clauses.length >= MAX_CLAUSES || literalCount > MAX_LITERALS) {
            throw new Error("cnf-too-large");
          }
          clauses.push(clause);
        }
      }
      return clauses;
    }
    throw new Error("cnf-invalid-nnf");
  }

  return visit(node);
}

function literalKey(literal) {
  return `${literal.negated ? "!" : ""}${literal.name}`;
}

function simplifyClauses(clauses) {
  const reasons = new Set();
  const normalized = [];

  for (const clause of clauses) {
    const signs = new Map();
    const result = [];
    let tautology = false;
    for (const literal of clause) {
      const previous = signs.get(literal.name);
      if (previous === literal.negated) {
        reasons.add("idempotence");
        continue;
      }
      if (previous !== undefined && previous !== literal.negated) {
        tautology = true;
        reasons.add("complement");
        break;
      }
      signs.set(literal.name, literal.negated);
      result.push(literal);
    }
    if (!tautology) normalized.push(result);
  }

  const unique = [];
  const seen = new Set();
  for (const clause of normalized) {
    const key = clause.map(literalKey).sort().join("|");
    if (seen.has(key)) {
      reasons.add("idempotence");
      continue;
    }
    seen.add(key);
    unique.push(clause);
  }

  const kept = unique.filter((clause, index) => {
    const keys = new Set(clause.map(literalKey));
    for (let i = 0; i < unique.length; i++) {
      if (i === index || unique[i].length > clause.length) continue;
      const other = unique[i].map(literalKey);
      if (other.length < clause.length && other.every((key) => keys.has(key))) {
        reasons.add("absorption");
        return false;
      }
    }
    return true;
  });

  return { clauses: kept, reasons: Array.from(reasons) };
}

function formatClause(clause) {
  if (clause.length === 0) return "F";
  return `(${clause.map((literal) => `${literal.negated ? "¬" : ""}${literal.name}`).join(" ∨ ")})`;
}

function formatClauses(clauses) {
  if (clauses.length === 0) return "T";
  return clauses.map(formatClause).join(" ∧ ");
}

function binaryVariableMap(variables) {
  const map = {};
  variables.forEach((name, index) => {
    map[name] = `x${index + 1}`;
  });
  return map;
}

function formatLinearTerms(terms) {
  if (terms.length === 0) return "0";
  let text = "";
  terms.forEach((term, index) => {
    const magnitude = Math.abs(term.coef);
    const body = magnitude === 1 ? term.variable : `${magnitude}${term.variable}`;
    if (index === 0) text += term.coef < 0 ? `−${body}` : body;
    else text += term.coef < 0 ? ` − ${body}` : ` + ${body}`;
  });
  return text;
}

function encodeClause(clause, variableMap) {
  const orderedClause = clause.slice().sort((a, b) => {
    const ai = Number(String(variableMap[a.name]).replace(/\D/g, "")) || 0;
    const bi = Number(String(variableMap[b.name]).replace(/\D/g, "")) || 0;
    return ai - bi;
  });
  const literalTerms = orderedClause.map((literal) => (
    literal.negated ? `(1 − ${variableMap[literal.name]})` : variableMap[literal.name]
  ));
  const negativeCount = orderedClause.filter((literal) => literal.negated).length;
  const positiveCount = orderedClause.length - negativeCount;
  let terms = orderedClause.map((literal) => ({
    variable: variableMap[literal.name],
    coef: literal.negated ? -1 : 1,
  }));
  let operator = "≥";
  let rhs = 1 - negativeCount;
  if (positiveCount === 0) {
    terms = terms.map((term) => ({ ...term, coef: -term.coef }));
    operator = "≤";
    rhs = -rhs;
  }
  return {
    clause,
    literalForm: `${literalTerms.join(" + ") || "0"} ≥ 1`,
    terms,
    operator,
    rhs,
    linearForm: `${formatLinearTerms(terms)} ${operator} ${rhs}`,
  };
}

function evaluate(node, values) {
  if (node.type === "var") return !!values[node.name];
  if (node.type === "const") return node.value;
  if (node.type === "not") return !evaluate(node.child, values);
  const left = evaluate(node.left, values);
  const right = evaluate(node.right, values);
  if (node.type === "and") return left && right;
  if (node.type === "or") return left || right;
  if (node.type === "xor") return left !== right;
  if (node.type === "implies") return !left || right;
  if (node.type === "iff") return left === right;
  throw new Error("cnf-evaluation-error");
}

function truthSummary(ast, variables) {
  if (variables.length > 12) return { skipped: true };
  const total = 2 ** variables.length;
  let satisfying = 0;
  for (let mask = 0; mask < total; mask++) {
    const values = {};
    variables.forEach((name, index) => {
      values[name] = !!(mask & (1 << index));
    });
    if (evaluate(ast, values)) satisfying++;
  }
  return {
    skipped: false,
    total,
    satisfying,
    status: satisfying === 0 ? "contradiction" : satisfying === total ? "tautology" : "satisfiable",
  };
}

function analyzeCNF(source, mode = "formula") {
  const parsed = parseLogic(source, mode);
  const steps = [{ rule: "formalization", formula: formatAst(parsed.ast) }];

  const derivedUsed = new Set();
  const withoutIffXor = rewriteIffAndXor(parsed.ast, derivedUsed);
  if (astKey(withoutIffXor) !== astKey(parsed.ast)) {
    steps.push({
      rule: "derived",
      details: Array.from(derivedUsed),
      formula: formatAst(withoutIffXor),
    });
  }

  const booleanReasons = new Set();
  const booleanSimplified = simplifyBooleanAst(withoutIffXor, booleanReasons);
  if (astKey(booleanSimplified) !== astKey(withoutIffXor)) {
    steps.push({
      rule: "simplification",
      details: Array.from(booleanReasons),
      formula: formatAst(booleanSimplified),
    });
  }

  const implicationUsed = new Set();
  const withoutImplications = rewriteImplications(booleanSimplified, implicationUsed);
  if (astKey(withoutImplications) !== astKey(booleanSimplified)) {
    steps.push({
      rule: "implication",
      details: Array.from(implicationUsed),
      formula: formatAst(withoutImplications),
    });
  }

  const nnfUsed = new Set();
  const nnf = toNnf(withoutImplications, false, nnfUsed);
  if (astKey(nnf) !== astKey(withoutImplications)) {
    steps.push({
      rule: "de-morgan",
      details: Array.from(nnfUsed),
      formula: formatAst(nnf),
    });
  }

  const rawClauses = clausesFromNnf(nnf);
  const rawCnf = formatClauses(rawClauses);
  if (rawCnf !== formatAst(nnf)) {
    steps.push({ rule: "distribution", details: ["distribution"], formula: rawCnf });
  }

  const simplified = simplifyClauses(rawClauses);
  const cnf = formatClauses(simplified.clauses);
  if (simplified.reasons.length > 0 || cnf !== rawCnf) {
    steps.push({ rule: "simplification", details: simplified.reasons, formula: cnf });
  }

  const variableMap = binaryVariableMap(parsed.variables);
  const constraints = simplified.clauses.map((clause) => encodeClause(clause, variableMap));
  return {
    source,
    mode,
    ast: parsed.ast,
    formula: formatAst(parsed.ast),
    assertions: parsed.assertions,
    variables: parsed.variables,
    variableMap,
    steps,
    rawClauses,
    clauses: simplified.clauses,
    cnf,
    constraints,
    truth: truthSummary(parsed.ast, parsed.variables),
  };
}

const CNF = {
  analyze: analyzeCNF,
  parse: parseLogic,
  formatAst,
  formatClauses,
  evaluate,
};

if (typeof window !== "undefined") window.CNF = CNF;

export {
  analyzeCNF,
  parseLogic,
  formatAst,
  formatClauses,
  evaluate,
};
