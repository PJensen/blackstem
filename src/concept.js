import { addEdge, addNode, edge, findNodes, firstNode, graph, node, unique } from "./model.js";
import {
  isAnd,
  isDocument,
  isFrom,
  isQuantityLike,
  isSemanticObject,
  isSemanticValue,
  isTo,
  nearestAfter,
  nearestBefore,
  round4,
  symbolize,
} from "./symbolize.js";
import { TOOL_HINTS, VOCAB } from "./vocab.js";

const Heads = {
  requestIntentHead(symbols, g) {
    const request = addNode(g, node(VOCAB.concepts.REQUEST, "UserRequest"));
    const plan = addNode(g, node(VOCAB.concepts.PLAN, "ConceptualPlan"));
    addEdge(g, edge(request.id, VOCAB.relations.HAS_PLAN, plan.id));

    const firstOperation = symbols.find(s => s.kind === VOCAB.kinds.ACTION || s.kind === VOCAB.kinds.DIRECTIVE);
    const intentLabel = firstOperation?.kind === VOCAB.kinds.DIRECTIVE
      ? directiveToIntent(firstOperation.concept)
      : firstOperation?.concept || VOCAB.intents.UNKNOWN;

    const intent = addNode(g, node(VOCAB.concepts.INTENT, intentLabel, {
      source: firstOperation?.clean || null,
      sourceKind: firstOperation?.kind || null,
      confidence: firstOperation ? 1 : 0,
    }));

    addEdge(g, edge(request.id, VOCAB.relations.HAS_INTENT, intent.id));
    addEdge(g, edge(plan.id, VOCAB.relations.HAS_INTENT, intent.id));
    return { request, plan, intent };
  },

  operationHead(symbols, g, ctx) {
    let order = 1;

    for (const s of symbols.filter(x => x.kind === VOCAB.kinds.ACTION || x.kind === VOCAB.kinds.DIRECTIVE)) {
      const conceptType = s.kind === VOCAB.kinds.ACTION ? VOCAB.concepts.ACTION : VOCAB.concepts.DIRECTIVE;
      const relation = s.kind === VOCAB.kinds.ACTION ? VOCAB.relations.HAS_ACTION : VOCAB.relations.HAS_DIRECTIVE;
      const op = addNode(g, node(conceptType, s.concept, {
        token: s.clean,
        index: s.index,
      }));
      const step = addNode(g, node(VOCAB.concepts.STEP, `Step:${order}`, {
        order,
        symbolIndex: s.index,
        operation: s.concept,
        operationKind: s.kind,
      }));

      addEdge(g, edge(ctx.request.id, relation, op.id));
      addEdge(g, edge(ctx.intent.id, relation, op.id));
      addEdge(g, edge(ctx.plan.id, VOCAB.relations.HAS_STEP, step.id));
      addEdge(g, edge(step.id, relation, op.id));
      order++;
    }
  },

  objectAndValueHead(symbols, g, ctx) {
    for (const s of symbols.filter(isSemanticObject)) {
      const obj = addNode(g, node(VOCAB.concepts.OBJECT, s.concept, {
        token: s.clean,
        index: s.index,
        kind: s.kind,
      }));
      addEdge(g, edge(ctx.intent.id, VOCAB.relations.HAS_OBJECT, obj.id));
    }

    for (const s of symbols.filter(isSemanticValue)) {
      const value = addNode(g, node(VOCAB.concepts.VALUE, s.concept, {
        token: s.clean,
        index: s.index,
        kind: s.kind,
      }));
      addEdge(g, edge(ctx.intent.id, VOCAB.relations.HAS_VALUE, value.id));
    }
  },

  qualifierHead(symbols, g) {
    const attachableNodes = findNodes(g, n => n.type === VOCAB.concepts.OBJECT || n.type === VOCAB.concepts.VALUE);

    for (const q of symbols.filter(s => s.kind === VOCAB.kinds.QUALIFIER)) {
      const targetSymbol = nearestAfter(symbols, q.index, s => s.kind === VOCAB.kinds.ENTITY || s.kind === VOCAB.kinds.METRIC);
      if (!targetSymbol) continue;

      const targetNode = attachableNodes.find(n => n.props.index === targetSymbol.index);
      if (!targetNode) continue;

      const qualifierNode = addNode(g, node(VOCAB.concepts.CONSTRAINT, q.concept, {
        token: q.clean,
        index: q.index,
      }));
      addEdge(g, edge(qualifierNode.id, VOCAB.relations.QUALIFIES, targetNode.id));
    }
  },

  pairedSubjectHead(symbols, g, ctx) {
    for (let i = 0; i < symbols.length - 3; i++) {
      const a = symbols[i];
      const conj = symbols[i + 1];
      const b = symbols[i + 2];
      const domain = symbols.slice(i + 3).find(s => s.kind === VOCAB.kinds.ENTITY);

      if (a.kind !== VOCAB.kinds.QUALIFIER || !isAnd(conj) || b.kind !== VOCAB.kinds.QUALIFIER || !domain) continue;

      const subjectA = addNode(g, node(VOCAB.concepts.SUBJECT, domain.concept, {
        role: "A",
        qualifier: a.concept,
        qualifierToken: a.clean,
        domainToken: domain.clean,
      }));
      const subjectB = addNode(g, node(VOCAB.concepts.SUBJECT, domain.concept, {
        role: "B",
        qualifier: b.concept,
        qualifierToken: b.clean,
        domainToken: domain.clean,
      }));

      addEdge(g, edge(ctx.intent.id, VOCAB.relations.HAS_SUBJECT, subjectA.id));
      addEdge(g, edge(ctx.intent.id, VOCAB.relations.HAS_SUBJECT, subjectB.id));
    }
  },

  sourceTargetOutputHead(symbols, g, ctx) {
    const objectNodes = findNodes(g, n => n.type === VOCAB.concepts.OBJECT);

    for (const prep of symbols.filter(isFrom)) {
      const srcSym = nearestAfter(symbols, prep.index, s => s.kind === VOCAB.kinds.ENTITY || s.kind === VOCAB.kinds.UNKNOWN);
      if (!srcSym) continue;
      const srcNode = objectNodes.find(n => n.props.index === srcSym.index);
      if (!srcNode) continue;

      const source = addNode(g, node(VOCAB.concepts.SOURCE, srcNode.label, { token: srcSym.clean }));
      addEdge(g, edge(ctx.intent.id, VOCAB.relations.HAS_SOURCE, source.id));
      addEdge(g, edge(source.id, VOCAB.relations.REFERS_TO, srcNode.id));
    }

    for (const prep of symbols.filter(isTo)) {
      const targetSym = nearestAfter(symbols, prep.index, s => s.kind === VOCAB.kinds.ENTITY || s.kind === VOCAB.kinds.UNKNOWN);
      if (!targetSym) continue;
      const targetNode = objectNodes.find(n => n.props.index === targetSym.index);
      if (!targetNode) continue;

      const target = addNode(g, node(VOCAB.concepts.TARGET, targetNode.label, { token: targetSym.clean }));
      addEdge(g, edge(ctx.intent.id, VOCAB.relations.HAS_TARGET, target.id));
      addEdge(g, edge(target.id, VOCAB.relations.REFERS_TO, targetNode.id));
    }

    for (const s of symbols.filter(x => x.kind === VOCAB.kinds.ENTITY && isDocument(x.concept))) {
      const priorBuild = nearestBefore(symbols, s.index, x => x.kind === VOCAB.kinds.ACTION && [VOCAB.intents.BUILD, VOCAB.intents.CREATE].includes(x.concept));
      const priorFrom = nearestBefore(symbols, s.index, isFrom);
      if (!priorBuild) continue;
      if (priorFrom && priorFrom.index < s.index && priorBuild.index < priorFrom.index) continue;

      const out = addNode(g, node(VOCAB.concepts.OUTPUT, s.concept, { token: s.clean }));
      addEdge(g, edge(ctx.intent.id, VOCAB.relations.HAS_OUTPUT, out.id));
    }

    const hasMonitor = symbols.some(s => s.kind === VOCAB.kinds.ACTION && s.concept === VOCAB.intents.MONITOR);
    if (hasMonitor) {
      for (const n of findNodes(g, x => x.type === VOCAB.concepts.OBJECT || x.type === VOCAB.concepts.VALUE)) {
        const target = addNode(g, node(VOCAB.concepts.TARGET, n.label, { token: n.props.token }));
        addEdge(g, edge(ctx.intent.id, VOCAB.relations.HAS_TARGET, target.id));
        addEdge(g, edge(target.id, VOCAB.relations.REFERS_TO, n.id));
      }
    }
  },

  temporalCadenceHead(symbols, g, ctx) {
    const temporal = symbols.filter(s => s.kind === VOCAB.kinds.TIME);
    if (temporal.length) {
      const constraint = addNode(g, node(VOCAB.concepts.CONSTRAINT, "TemporalConstraint"));
      addEdge(g, edge(ctx.intent.id, VOCAB.relations.HAS_CONSTRAINT, constraint.id));

      for (const s of temporal) {
        const t = addNode(g, node(VOCAB.concepts.CONSTRAINT, s.concept, {
          token: s.clean,
          index: s.index,
          value: s.value ?? null,
        }));
        addEdge(g, edge(constraint.id, VOCAB.relations.HAS_CONSTRAINT, t.id));
      }
    }

    for (const s of symbols.filter(x => x.kind === VOCAB.kinds.CADENCE)) {
      const cadence = addNode(g, node(VOCAB.concepts.CADENCE, s.concept, {
        token: s.clean,
        index: s.index,
        derivedFrom: s.derivedFrom || null,
      }));
      addEdge(g, edge(ctx.intent.id, VOCAB.relations.HAS_CADENCE, cadence.id));
    }
  },

  thresholdConditionHead(symbols, g, ctx) {
    const quantities = symbols.filter(isQuantityLike);

    for (const q of quantities) {
      const comparator = inferComparator(symbols, q.index);
      const metric = inferMetric(symbols, q.index);
      const threshold = addNode(g, node(VOCAB.concepts.THRESHOLD, "Threshold", {
        value: q.value,
        displayValue: q.displayValue ?? q.value,
        unit: q.unit || "value",
        operator: comparator,
        metric: metric?.concept || null,
        token: q.clean,
        index: q.index,
      }));
      addEdge(g, edge(ctx.intent.id, VOCAB.relations.HAS_THRESHOLD, threshold.id));
    }

    const markers = symbols.filter(s => s.kind === VOCAB.kinds.CONDITION);
    const comparators = symbols.filter(s => s.kind === VOCAB.kinds.COMPARATOR);
    const thresholds = findNodes(g, n => n.type === VOCAB.concepts.THRESHOLD);
    if (!markers.length && !comparators.length && !thresholds.length) return;

    const condition = addNode(g, node(VOCAB.concepts.CONDITION, "Condition"));
    addEdge(g, edge(ctx.intent.id, VOCAB.relations.HAS_CONDITION, condition.id));

    for (const m of markers) {
      const marker = addNode(g, node(VOCAB.concepts.CONDITION, m.concept, {
        token: m.clean,
        index: m.index,
      }));
      addEdge(g, edge(condition.id, VOCAB.relations.HAS_CONDITION, marker.id));
    }

    for (const c of comparators) {
      const comp = addNode(g, node(VOCAB.concepts.CONSTRAINT, `Comparator:${c.concept}`, {
        token: c.clean,
        index: c.index,
      }));
      addEdge(g, edge(condition.id, VOCAB.relations.HAS_CONSTRAINT, comp.id));
    }

    for (const t of thresholds) {
      addEdge(g, edge(condition.id, VOCAB.relations.HAS_THRESHOLD, t.id));
    }
  },

  pronounResolutionHead(symbols, g) {
    const referable = findNodes(g, n => n.type === VOCAB.concepts.VALUE || n.type === VOCAB.concepts.OBJECT)
      .sort((a, b) => a.props.index - b.props.index);

    for (const p of symbols.filter(s => s.kind === VOCAB.kinds.PRONOUN && s.concept.startsWith("anaphora"))) {
      const referent = [...referable]
        .filter(n => n.props.index < p.index)
        .sort((a, b) => b.props.index - a.props.index)[0];
      if (!referent) continue;

      const pronoun = addNode(g, node(VOCAB.concepts.VALUE, `Pronoun:${p.clean}`, {
        token: p.clean,
        index: p.index,
        resolved: true,
      }));
      addEdge(g, edge(pronoun.id, VOCAB.relations.REFERS_TO, referent.id));
    }
  },

  toolAffordanceHead(symbols, g, ctx) {
    const operations = unique([
      ...symbols.filter(s => s.kind === VOCAB.kinds.ACTION || s.kind === VOCAB.kinds.DIRECTIVE).map(s => s.concept),
      ctx.intent.label,
    ]);

    for (const op of operations) {
      for (const toolName of TOOL_HINTS[op] || []) {
        const tool = addNode(g, node(VOCAB.concepts.TOOL, toolName, { sourceOperation: op }));
        addEdge(g, edge(ctx.intent.id, VOCAB.relations.COMPILES_TO, tool.id));
      }
    }
  },

  ambiguityHead(symbols, g, ctx) {
    const meaningful = symbols.filter(s => ![
      VOCAB.kinds.STRUCTURAL,
      VOCAB.kinds.DETERMINER,
      VOCAB.kinds.AUXILIARY,
      VOCAB.kinds.PRONOUN,
    ].includes(s.kind));
    const unknowns = meaningful.filter(s => s.kind === VOCAB.kinds.UNKNOWN);
    const unknownRatio = unknowns.length / Math.max(1, meaningful.length);

    if (unknownRatio < 0.35) return;

    const ambiguity = addNode(g, node(VOCAB.concepts.AMBIGUITY, "HighUnknownSymbolRatio", {
      unknownRatio: round4(unknownRatio),
      unknowns: unknowns.map(s => s.clean),
    }));
    addEdge(g, edge(ctx.intent.id, VOCAB.relations.BLOCKED_BY, ambiguity.id));
  },
};

function directiveToIntent(directive) {
  switch (directive) {
    case VOCAB.directives.REMIND:
      return VOCAB.intents.CREATE_REMINDER;
    case VOCAB.directives.NOTIFY:
    case VOCAB.directives.ALERT:
    case VOCAB.directives.WATCH:
      return VOCAB.intents.MONITOR;
    case VOCAB.directives.EXPLAIN:
    case VOCAB.directives.COMPRESS:
      return VOCAB.intents.SUMMARIZE;
    case VOCAB.directives.EXPORT:
      return VOCAB.intents.SEND;
    case VOCAB.directives.VALIDATE:
      return VOCAB.intents.ANALYZE;
    default:
      return VOCAB.intents.UNKNOWN;
  }
}

function inferComparator(symbols, quantityIndex) {
  const nearest = symbols
    .filter(s => s.kind === VOCAB.kinds.COMPARATOR && Math.abs(s.index - quantityIndex) <= 5)
    .sort((a, b) => Math.abs(a.index - quantityIndex) - Math.abs(b.index - quantityIndex))[0];
  return nearest?.concept || VOCAB.operators.GTE;
}

function inferMetric(symbols, quantityIndex) {
  return nearestBefore(symbols, quantityIndex, s => s.kind === VOCAB.kinds.METRIC)
    || nearestBefore(symbols, quantityIndex, s => s.kind === VOCAB.kinds.ENTITY)
    || null;
}

function buildConceptGraph(text) {
  const symbols = symbolize(text);
  const g = graph();
  const ctx = Heads.requestIntentHead(symbols, g);

  Heads.operationHead(symbols, g, ctx);
  Heads.objectAndValueHead(symbols, g, ctx);
  Heads.qualifierHead(symbols, g, ctx);
  Heads.pairedSubjectHead(symbols, g, ctx);
  Heads.sourceTargetOutputHead(symbols, g, ctx);
  Heads.temporalCadenceHead(symbols, g, ctx);
  Heads.thresholdConditionHead(symbols, g, ctx);
  Heads.pronounResolutionHead(symbols, g, ctx);
  Heads.toolAffordanceHead(symbols, g, ctx);
  Heads.ambiguityHead(symbols, g, ctx);

  return { text, symbols, graph: g };
}

export {
  buildConceptGraph,
};