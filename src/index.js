import { buildConceptGraph } from "./concept.js";
import { buildDerivationDAG, buildExecutionDAG, compileFunctionCalls, compileToolPlan } from "./compile.js";
import { NL, joinBlocks, renderGraphMarkdown, renderMermaidGraph, renderResultMarkdown, renderToolGatesMarkdown, renderToolRegistryMarkdown } from "./render.js";
import { classifyLexemes, resolveSymbolContext, scan, symbolize } from "./symbolize.js";
import { CORE, TOOL_HINTS, TOOL_SPECS, VOCAB } from "./vocab.js";

function symbolicTransform(text) {
  const concept = buildConceptGraph(text);
  const derivationDAG = buildDerivationDAG(concept);
  const executionDAG = buildExecutionDAG(concept);
  const functionCalls = compileFunctionCalls(executionDAG);
  const toolPlan = compileToolPlan(concept, executionDAG, TOOL_SPECS);

  return {
    input: text,
    symbols: concept.symbols,
    conceptualGraph: concept.graph,
    derivationDAG,
    executionDAG,
    functionCalls,
    toolPlan,
  };
}

function renderRunMarkdown(text) {
  return renderResultMarkdown(symbolicTransform(text));
}

function renderRunsMarkdown(texts, title = "Symbolic Transformer Concept DAG Output") {
  const results = texts.map(text => symbolicTransform(text));
  const runs = results.map((result, index) => {
    const body = renderResultMarkdown(result).replace(/^## Input/, "### Input");
    return joinBlocks("## Run " + (index + 1), body);
  });
  const toolPlans = results.map(result => result.toolPlan);

  return joinBlocks(
    "# " + title,
    "Generated: " + new Date().toISOString(),
    runs.join(NL + NL + "---" + NL + NL),
    "## Tool Appendix",
    renderToolRegistryMarkdown(toolPlans),
    renderToolGatesMarkdown(toolPlans)
  ) + NL;
}

export {
  CORE,
  TOOL_HINTS,
  TOOL_SPECS,
  VOCAB,
  buildConceptGraph,
  buildDerivationDAG,
  buildExecutionDAG,
  classifyLexemes,
  compileFunctionCalls,
  compileToolPlan,
  renderGraphMarkdown,
  renderMermaidGraph,
  renderRunMarkdown,
  renderRunsMarkdown,
  resolveSymbolContext,
  scan,
  symbolicTransform,
  symbolize,
};