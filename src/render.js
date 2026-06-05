import { unique } from "./model.js";
import { TOOL_SPECS, VOCAB } from "./vocab.js";

const NL = String.fromCharCode(10);
const MD_FENCE = String.fromCharCode(96, 96, 96);

function linesToMarkdown(lines) {
  return lines.join(NL);
}

function renderMermaidGraph(title, g) {
  const lines = [];
  lines.push("### " + title);
  lines.push("");
  lines.push(MD_FENCE + "mermaid");
  lines.push("flowchart TD");

  for (const n of g.nodes) {
    const nodeId = mermaidId(n.id);
    const label = mermaidNodeLabel(n);
    const shape = mermaidShape(n.type, label);
    lines.push("  " + nodeId + shape);
  }

  for (const e of g.edges) {
    lines.push("  " + mermaidId(e.from) + " -->|" + escapeMermaid(e.relation) + "| " + mermaidId(e.to));
  }

  lines.push(MD_FENCE);
  return linesToMarkdown(lines);
}

function mermaidId(idValue) {
  return String(idValue).replace(/[^a-zA-Z0-9_]/g, "_");
}

function mermaidNodeLabel(n) {
  const parts = [n.type, n.label];
  const props = compactNodeProps(n.props || {});
  if (props) parts.push(props);
  return parts.map(escapeMermaid).join("<br/>");
}

function compactNodeProps(props) {
  const entries = Object.entries(props)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .filter(([key]) => !["index", "symbolIndex"].includes(key))
    .slice(0, 4)
    .map(([key, value]) => key + ": " + compactValue(value));

  return entries.join(" | ");
}

function compactValue(value) {
  if (Array.isArray(value)) return "[" + value.map(compactValue).join(", ") + "]";
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
}

function escapeMermaid(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/\"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[{}]/g, "");
}

function mermaidShape(type, label) {
  if (type === VOCAB.concepts.REQUEST) return `([\"${label}\"])`;
  if (type === VOCAB.concepts.INTENT) return `{{\"${label}\"}}`;
  if (type === VOCAB.concepts.PLAN) return `[[\"${label}\"]]`;
  if (type === VOCAB.concepts.STEP) return `([\"${label}\"])`;
  if (type === VOCAB.concepts.CONDITION || type === VOCAB.concepts.THRESHOLD) return `{\"${label}\"}`;
  if (type === VOCAB.concepts.TOOL) return `[(\"${label}\")]`;
  return `[\"${label}\"]`;
}

function renderGraphMarkdown(title, g) {
  const lines = [];
  lines.push("### " + title);
  lines.push("");
  lines.push("#### Nodes");
  lines.push("");
  lines.push("| id | type | label | props |");
  lines.push("|---|---|---|---|");

  for (const n of g.nodes) {
    lines.push("| " + md(n.id) + " | " + md(n.type) + " | " + md(n.label) + " | " + md(JSON.stringify(n.props || {})) + " |");
  }

  lines.push("");
  lines.push("#### Edges");
  lines.push("");
  lines.push("| from | relation | to |");
  lines.push("|---|---|---|");

  for (const e of g.edges) {
    lines.push("| " + md(e.from) + " | " + md(e.relation) + " | " + md(e.to) + " |");
  }

  return linesToMarkdown(lines);
}

function renderSymbolsMarkdown(symbols) {
  const lines = [];
  lines.push("### Symbols");
  lines.push("");
  lines.push("| # | raw | clean | span | kind | concept | value |");
  lines.push("|---:|---|---|---|---|---|---|");

  for (const s of symbols) {
    const valueParts = [];
    if (s.value !== undefined) valueParts.push("value=" + s.value);
    if (s.unit) valueParts.push("unit=" + s.unit);
    if (s.displayValue !== undefined) valueParts.push("display=" + s.displayValue);

    lines.push("| " + s.index + " | " + md(s.raw) + " | " + md(s.clean) + " | " + md("[" + s.start + "," + s.end + ")") + " | " + md(s.kind) + " | " + md(s.concept) + " | " + md(valueParts.join(" ")) + " |");
  }

  return linesToMarkdown(lines);
}

function renderFunctionCallsMarkdown(calls) {
  return fencedBlock("Function Calls", "json", JSON.stringify(calls, null, 2));
}

function renderToolCallsMarkdown(toolPlan) {
  return fencedBlock("Tool Calls", "json", JSON.stringify(toolPlan.calls || [], null, 2));
}

function renderToolRegistryMarkdown(toolPlans) {
  const usedNames = unique(toolPlans.flatMap(plan => (plan.calls || []).map(call => call.name)));
  const specs = usedNames.map(name => TOOL_SPECS[name]).filter(Boolean);
  return fencedBlock("Tool Specs Used", "json", JSON.stringify(specs, null, 2));
}

function renderToolGatesMarkdown(toolPlans) {
  const gatesById = new Map();
  for (const plan of toolPlans) {
    for (const gate of plan.gates || []) gatesById.set(gate.id, gate);
  }
  return fencedBlock("Tool Gates", "json", JSON.stringify([...gatesById.values()], null, 2));
}

function fencedBlock(title, language, body) {
  const lines = [];
  lines.push("### " + title);
  lines.push("");
  lines.push(MD_FENCE + language);
  lines.push(String(body));
  lines.push(MD_FENCE);
  return linesToMarkdown(lines);
}

function renderResultMarkdown(result) {
  return joinBlocks(
    "## Input" + NL + NL + blockquote(result.input),
    renderSymbolsMarkdown(result.symbols),
    renderMermaidGraph("Conceptual Graph", result.conceptualGraph),
    renderGraphMarkdown("Derivation DAG", result.derivationDAG),
    renderGraphMarkdown("Execution DAG", result.executionDAG),
    renderFunctionCallsMarkdown(result.functionCalls),
    renderToolCallsMarkdown(result.toolPlan)
  );
}

function joinBlocks(...blocks) {
  return blocks
    .filter(block => block !== null && block !== undefined && block !== "")
    .map(block => String(block).trim())
    .join(NL + NL);
}

function md(value) {
  return String(value ?? "")
    .replace(/[|]/g, String.fromCharCode(92) + "|")
    .split(NL)
    .join("<br/>");
}

function blockquote(value) {
  return String(value)
    .split(NL)
    .map(line => "> " + line)
    .join(NL);
}

export {
  NL,
  joinBlocks,
  renderGraphMarkdown,
  renderMermaidGraph,
  renderResultMarkdown,
  renderToolGatesMarkdown,
  renderToolRegistryMarkdown,
};