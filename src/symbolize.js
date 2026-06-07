import { CORE, VOCAB } from "./vocab.js";
import { nextId, resetIds } from "./model.js";

function scan(text) {
  resetIds();

  const input = text
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");

  const lexemes = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    const start = i;
    const two = input.slice(i, i + 2);

    if ([">=", "<=", "==", "!="].includes(two)) {
      lexemes.push(makeLexeme(two, start, i + 2, lexemes.length));
      i += 2;
      continue;
    }

    if ([">", "<", "="].includes(ch)) {
      lexemes.push(makeLexeme(ch, start, i + 1, lexemes.length));
      i++;
      continue;
    }

    if (ch === "$" && isDigit(input[i + 1])) {
      i++;
      while (isDigit(input[i])) i++;
      if (input[i] === "." && isDigit(input[i + 1])) {
        i++;
        while (isDigit(input[i])) i++;
      }
      lexemes.push(makeLexeme(input.slice(start, i), start, i, lexemes.length));
      continue;
    }

    if (isDigit(ch)) {
      while (isDigit(input[i])) i++;
      if (input[i] === "." && isDigit(input[i + 1])) {
        i++;
        while (isDigit(input[i])) i++;
      }
      if (input[i] === "%") i++;
      lexemes.push(makeLexeme(input.slice(start, i), start, i, lexemes.length));
      continue;
    }

    if (isAlpha(ch) || ch === "_") {
      i++;
      while (isAlphaNum(input[i]) || input[i] === "_" || input[i] === "-" || input[i] === "'") i++;
      lexemes.push(makeLexeme(input.slice(start, i), start, i, lexemes.length));
      continue;
    }

    lexemes.push(makeLexeme(ch, start, i + 1, lexemes.length));
    i++;
  }

  return lexemes.filter(l => !/^[,;:]$/.test(l.raw));
}

function makeLexeme(raw, start, end, index) {
  return {
    raw,
    clean: raw.toLowerCase().replace(/^["'`]+|["'`]+$/g, ""),
    start,
    end,
    index,
  };
}

function isDigit(ch) {
  return typeof ch === "string" && ch >= "0" && ch <= "9";
}

function isAlpha(ch) {
  return typeof ch === "string" && /[a-zA-Z]/.test(ch);
}

function isAlphaNum(ch) {
  return typeof ch === "string" && /[a-zA-Z0-9]/.test(ch);
}

function symbolize(text) {
  return resolveSymbolContext(classifyLexemes(scan(text)));
}

function classifyLexemes(lexemes) {
  return lexemes.map((lexeme, index) => classifyLexeme(lexeme, index, lexemes));
}

function classifyLexeme(lexeme, index, lexemes) {
  const clean = lexeme.clean;

  if (/^[.?!()]$/.test(clean || lexeme.raw)) {
    return symbol(lexeme, VOCAB.kinds.STRUCTURAL, `Punctuation:${lexeme.raw}`);
  }

  if ([">", ">=", "<", "<=", "=", "==", "!="].includes(clean)) {
    return symbol(lexeme, VOCAB.kinds.COMPARATOR, clean === "==" ? VOCAB.operators.EQ : clean);
  }

  const percent = clean.match(/^(\d+(?:\.\d+)?)%$/);
  if (percent) {
    const displayValue = Number(percent[1]);
    return symbol(lexeme, VOCAB.kinds.QUANTITY, "Quantity:percent", {
      value: round4(displayValue / 100),
      displayValue,
      unit: "percent",
    });
  }

  const money = clean.match(/^\$(\d+(?:\.\d+)?)$/);
  if (money) {
    const value = Number(money[1]);
    return symbol(lexeme, VOCAB.kinds.MONEY, "Money:usd", {
      value,
      displayValue: value,
      unit: "USD",
    });
  }

  const number = clean.match(/^\d+(?:\.\d+)?$/);
  if (number) {
    const value = Number(clean);
    return symbol(lexeme, VOCAB.kinds.QUANTITY, "Quantity:number", {
      value,
      displayValue: value,
      unit: "number",
    });
  }

  const clock = clean.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/);
  if (clock) {
    return symbol(lexeme, VOCAB.kinds.TIME, "ClockTime", {
      hour: Number(clock[1]),
      minute: Number(clock[2] || 0),
      meridiem: clock[3],
    });
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    return symbol(lexeme, VOCAB.kinds.TIME, "Date:iso", { value: clean });
  }

  if (CORE.conditionMarkers[clean]) return symbol(lexeme, VOCAB.kinds.CONDITION, CORE.conditionMarkers[clean]);
  if (CORE.comparatorWords[clean]) return symbol(lexeme, VOCAB.kinds.COMPARATOR, CORE.comparatorWords[clean]);
  if (CORE.directives[clean]) return symbol(lexeme, VOCAB.kinds.DIRECTIVE, CORE.directives[clean]);
  if (CORE.actions[clean]) return symbol(lexeme, VOCAB.kinds.ACTION, CORE.actions[clean]);
  if (CORE.metrics[clean]) return symbol(lexeme, VOCAB.kinds.METRIC, CORE.metrics[clean]);
  if (CORE.units[clean]) return symbol(lexeme, VOCAB.kinds.UNIT, CORE.units[clean]);
  if (CORE.entities[clean]) return symbol(lexeme, VOCAB.kinds.ENTITY, CORE.entities[clean]);
  if (CORE.time[clean]) return symbol(lexeme, VOCAB.kinds.TIME, CORE.time[clean]);
  if (CORE.cadence[clean]) return symbol(lexeme, VOCAB.kinds.CADENCE, CORE.cadence[clean]);
  if (CORE.qualifiers[clean]) return symbol(lexeme, VOCAB.kinds.QUALIFIER, CORE.qualifiers[clean]);
  if (CORE.pronouns[clean]) return symbol(lexeme, VOCAB.kinds.PRONOUN, CORE.pronouns[clean]);
  if (CORE.determiners.has(clean)) return symbol(lexeme, VOCAB.kinds.DETERMINER, `Determiner:${clean}`);
  if (CORE.auxiliaries.has(clean)) return symbol(lexeme, VOCAB.kinds.AUXILIARY, `Auxiliary:${clean}`);
  if (CORE.modals.has(clean)) return symbol(lexeme, VOCAB.kinds.MODAL, `Modal:${clean}`);
  if (CORE.negations.has(clean)) return symbol(lexeme, VOCAB.kinds.NEGATION, `Negation:${clean}`);
  if (CORE.conjunctions[clean]) return symbol(lexeme, VOCAB.kinds.CONJUNCTION, CORE.conjunctions[clean]);
  if (CORE.prepositions[clean]) return symbol(lexeme, VOCAB.kinds.PREPOSITION, CORE.prepositions[clean]);
  if (CORE.structural.has(clean)) return symbol(lexeme, VOCAB.kinds.STRUCTURAL, `Structural:${clean}`);

  return symbol(lexeme, VOCAB.kinds.UNKNOWN, `Lexeme:${clean}`);
}

function symbol(lexeme, kind, concept, props = {}) {
  return {
    id: nextId("sym"),
    raw: lexeme.raw,
    clean: lexeme.clean,
    start: lexeme.start,
    end: lexeme.end,
    index: lexeme.index,
    kind,
    concept,
    ...props,
  };
}

function resolveSymbolContext(symbols) {
  const resolved = symbols.map(s => ({ ...s }));

  for (let i = 0; i < resolved.length; i++) {
    const s = resolved[i];
    const prev = prevNonStructural(resolved, i);
    const next = nextNonStructural(resolved, i);

    if (s.clean === "report") {
      mutate(s, VOCAB.kinds.ENTITY, "Document:report");
    }

    if (s.clean === "search" && next?.concept === "SearchIndex") {
      mutate(s, VOCAB.kinds.ATTRIBUTE, CORE.domainModifiers.search);
    }

    if (["over", "above", "under", "below"].includes(s.clean)) {
      if (near(resolved, i, x => isQuantityLike(x), 3) || near(resolved, i, x => x.kind === VOCAB.kinds.METRIC, 3)) {
        mutate(s, VOCAB.kinds.COMPARATOR, CORE.comparatorWords[s.clean]);
      }
    }

    if (prev?.clean === "every" && s.kind === VOCAB.kinds.TIME) {
      mutate(s, VOCAB.kinds.CADENCE, `Every(${s.concept})`, { derivedFrom: "every+time" });
    }

    if (prev?.kind === VOCAB.kinds.DETERMINER && CORE.entities[s.clean]) {
      mutate(s, VOCAB.kinds.ENTITY, CORE.entities[s.clean]);
    }

    if (s.clean === "box" && prev?.clean === "text") {
      mutate(s, VOCAB.kinds.ENTITY, "UI:textbox");
    }

    if (s.clean === "text" && next?.clean === "box") {
      mutate(s, VOCAB.kinds.ATTRIBUTE, "UIQualifier:text");
    }
  }

  return resolved;
}

function mutate(symbolRef, kind, concept, props = {}) {
  symbolRef.kind = kind;
  symbolRef.concept = concept;
  Object.assign(symbolRef, props);
}

function prevNonStructural(symbols, index) {
  for (let i = index - 1; i >= 0; i--) {
    if (!isPureStructural(symbols[i])) return symbols[i];
  }
  return null;
}

function nextNonStructural(symbols, index) {
  for (let i = index + 1; i < symbols.length; i++) {
    if (!isPureStructural(symbols[i])) return symbols[i];
  }
  return null;
}

function near(symbols, index, predicate, radius) {
  return symbols.some(s => Math.abs(s.index - index) <= radius && predicate(s));
}

function isPureStructural(s) {
  return [VOCAB.kinds.STRUCTURAL, VOCAB.kinds.DETERMINER].includes(s.kind);
}

function isQuantityLike(s) {
  return [VOCAB.kinds.QUANTITY, VOCAB.kinds.MONEY].includes(s.kind);
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

function isSemanticObject(s) {
  return [VOCAB.kinds.ENTITY, VOCAB.kinds.UNKNOWN].includes(s.kind) && !isIgnorable(s);
}

function isSemanticValue(s) {
  return s.kind === VOCAB.kinds.METRIC;
}

function isIgnorable(s) {
  return [
    VOCAB.kinds.DETERMINER,
    VOCAB.kinds.AUXILIARY,
    VOCAB.kinds.MODAL,
    VOCAB.kinds.CONJUNCTION,
    VOCAB.kinds.PREPOSITION,
    VOCAB.kinds.STRUCTURAL,
    VOCAB.kinds.ATTRIBUTE,
  ].includes(s.kind);
}

function nearestBefore(symbols, index, predicate) {
  for (let i = index - 1; i >= 0; i--) {
    if (predicate(symbols[i])) return symbols[i];
  }
  return null;
}

function nearestAfter(symbols, index, predicate) {
  for (let i = index + 1; i < symbols.length; i++) {
    if (predicate(symbols[i])) return symbols[i];
  }
  return null;
}

function isFrom(s) {
  return s.kind === VOCAB.kinds.PREPOSITION && s.concept === "FROM";
}

function isTo(s) {
  return s.kind === VOCAB.kinds.PREPOSITION && s.concept === "TO";
}

function isAnd(s) {
  return s.kind === VOCAB.kinds.CONJUNCTION && s.concept === "AND";
}

function isDocument(label) {
  return label.startsWith("Document:");
}

function isMetric(label) {
  return label.startsWith("Metric:");
}

export {
  classifyLexeme,
  classifyLexemes,
  isAnd,
  isDocument,
  isFrom,
  isMetric,
  isQuantityLike,
  isSemanticObject,
  isSemanticValue,
  isTo,
  nearestAfter,
  nearestBefore,
  nextNonStructural,
  prevNonStructural,
  resolveSymbolContext,
  round4,
  scan,
  symbolize,
};
