import { addEdge, addNode, edge, findNodes, firstNode, graph, node, unique } from "./model.js";
import { isDocument, isMetric } from "./symbolize.js";
import { TOOL_SPECS, VOCAB } from "./vocab.js";

function buildDerivationDAG(conceptResult) {
  const g = graph();
  const concept = conceptResult.graph;
  const intent = firstNode(concept, n => n.type === VOCAB.concepts.INTENT);
  const blocked = concept.edges.some(e => e.relation === VOCAB.relations.BLOCKED_BY);

  const input = addNode(g, node("DerivationStep", "InputText", { text: conceptResult.text }));
  const scanned = addNode(g, node("DerivationStep", "ScanLexemes", { count: conceptResult.symbols.length }));
  const classified = addNode(g, node("DerivationStep", "ClassifyLexemes"));
  const resolved = addNode(g, node("DerivationStep", "ResolveSymbolContext"));
  const bound = addNode(g, node("DerivationStep", "BindConceptGraph"));
  const validated = addNode(g, node("DerivationStep", "ValidateConceptGraph", { blocked }));
  const compiled = addNode(g, node("DerivationStep", "CompileExecutableDAG", { intent: intent?.label || null }));

  addEdge(g, edge(scanned.id, VOCAB.relations.DEPENDS_ON, input.id));
  addEdge(g, edge(classified.id, VOCAB.relations.DEPENDS_ON, scanned.id));
  addEdge(g, edge(resolved.id, VOCAB.relations.DEPENDS_ON, classified.id));
  addEdge(g, edge(bound.id, VOCAB.relations.DEPENDS_ON, resolved.id));
  addEdge(g, edge(validated.id, VOCAB.relations.DEPENDS_ON, bound.id));
  addEdge(g, edge(compiled.id, VOCAB.relations.DEPENDS_ON, validated.id));

  return g;
}

function buildExecutionDAG(conceptResult) {
  const cg = conceptResult.graph;
  const g = graph();

  const intent = firstNode(cg, n => n.type === VOCAB.concepts.INTENT)?.label || VOCAB.intents.UNKNOWN;
  const steps = findNodes(cg, n => n.type === VOCAB.concepts.STEP).sort((a, b) => a.props.order - b.props.order);
  const objects = findNodes(cg, n => n.type === VOCAB.concepts.OBJECT);
  const values = findNodes(cg, n => n.type === VOCAB.concepts.VALUE && !n.label.startsWith("Pronoun:"));
  const subjects = findNodes(cg, n => n.type === VOCAB.concepts.SUBJECT);
  const sources = findNodes(cg, n => n.type === VOCAB.concepts.SOURCE);
  const targets = findNodes(cg, n => n.type === VOCAB.concepts.TARGET && !n.label.startsWith("Pronoun:"));
  const outputs = findNodes(cg, n => n.type === VOCAB.concepts.OUTPUT);
  const thresholds = findNodes(cg, n => n.type === VOCAB.concepts.THRESHOLD);
  const temporal = findNodes(cg, n => n.type === VOCAB.concepts.CONSTRAINT && n.label !== "TemporalConstraint" && !n.label.startsWith("Comparator:"));
  const cadence = findNodes(cg, n => n.type === VOCAB.concepts.CADENCE);
  const blocked = cg.edges.some(e => e.relation === VOCAB.relations.BLOCKED_BY);

  if (blocked) {
    const reject = addNode(g, node("ExecStep", "RejectOrClarify", { reason: "Ambiguous symbolic parse" }));
    for (const a of findNodes(cg, n => n.type === VOCAB.concepts.AMBIGUITY)) {
      const input = addNode(g, node("ExecInput", a.label, a.props));
      addEdge(g, edge(reject.id, VOCAB.relations.REQUIRES, input.id));
    }
    return g;
  }

  const uiCommands = inferUiCommands(conceptResult.symbols);
  if (uiCommands.length) {
    for (const command of uiCommands) {
      if (command.type === "move_ball") {
        addNode(g, node("ExecStep", "MoveBall", {
          tool: "ui.moveBall",
          target: command.target,
          direction: command.direction,
          distance: command.distance,
          unit: command.unit,
        }));
      }

      if (command.type === "set_ball_color") {
        addNode(g, node("ExecStep", "SetBallColor", {
          tool: "ui.setBallColor",
          target: command.target,
          color: command.color,
        }));
      }

      if (command.type === "resize_ball") {
        addNode(g, node("ExecStep", "ResizeBall", {
          tool: "ui.resizeBall",
          target: command.target,
          operation: command.operation,
          factor: command.factor,
        }));
      }

      if (command.type === "adjust_shape_color") {
        addNode(g, node("ExecStep", "AdjustShapeColor", {
          tool: "ui.adjustShapeColor",
          target: command.target,
          operation: command.operation,
          value: command.value,
        }));
      }

      if (command.type === "rotate_shape") {
        addNode(g, node("ExecStep", "RotateShape", {
          tool: "ui.rotateShape",
          target: command.target,
          degrees: command.degrees,
        }));
      }

      if (command.type === "set_text") {
        addNode(g, node("ExecStep", "SetTextBoxText", {
          tool: "ui.setText",
          target: command.target,
          text: command.text,
        }));
      }
    }

    return g;
  }

  if (intent === VOCAB.intents.CREATE_REMINDER || hasOperation(steps, VOCAB.directives.REMIND)) {
    const normalize = addNode(g, node("ExecStep", "NormalizeTemporalConstraint", {
      temporal: temporal.map(t => t.label),
      cadence: cadence.map(c => c.label),
    }));
    const create = addNode(g, node("ExecStep", "CreateReminder", {
      tool: "calendar.createReminder",
      object: objects.map(o => o.label),
      rawObjectTokens: objects.map(o => o.props.token),
      actionText: inferActionText(conceptResult.symbols),
    }));
    addEdge(g, edge(create.id, VOCAB.relations.DEPENDS_ON, normalize.id));
    return g;
  }

  if (hasOperation(steps, VOCAB.intents.COMPARE)) {
    const fetches = compileSubjectFetches(g, subjects, objects);
    const compare = addNode(g, node("ExecStep", "Compare", {
      metric: pickMetric(values)?.label || pickMetric(objects)?.label || null,
      tool: "analysis.compare",
    }));

    for (const f of fetches) addEdge(g, edge(compare.id, VOCAB.relations.DEPENDS_ON, f.id));

    const condition = thresholds.length ? addNode(g, node("ExecStep", "EvaluateCondition", {
      thresholds: thresholds.map(t => t.props),
    })) : null;

    if (condition) addEdge(g, edge(condition.id, VOCAB.relations.DEPENDS_ON, compare.id));

    if (hasOperation(steps, VOCAB.directives.NOTIFY) || hasOperation(steps, VOCAB.directives.ALERT)) {
      const notify = addNode(g, node("ExecStep", "Notify", { tool: "notification.send" }));
      addEdge(g, edge(notify.id, VOCAB.relations.DEPENDS_ON, condition?.id || compare.id));
    }

    return g;
  }

  if (intent === VOCAB.intents.MONITOR || hasOperation(steps, VOCAB.intents.MONITOR)) {
    const watch = addNode(g, node("ExecStep", "CreateWatch", {
      tool: "scheduler.createWatch",
      cadence: cadence.map(c => c.label),
      target: compileWatchTargets(subjects, targets, objects, values),
    }));

    let condition = null;
    if (thresholds.length) {
      condition = addNode(g, node("ExecStep", "EvaluateCondition", {
        thresholds: thresholds.map(t => t.props),
      }));
      addEdge(g, edge(condition.id, VOCAB.relations.DEPENDS_ON, watch.id));
    }

    if (hasOperation(steps, VOCAB.directives.NOTIFY) || hasOperation(steps, VOCAB.directives.ALERT)) {
      const notify = addNode(g, node("ExecStep", "Notify", { tool: "notification.send" }));
      addEdge(g, edge(notify.id, VOCAB.relations.DEPENDS_ON, condition?.id || watch.id));
    }

    if (hasOperation(steps, VOCAB.intents.BUILD) || outputs.length) {
      const build = addNode(g, node("ExecStep", "BuildDocument", {
        outputs: outputs.length ? outputs.map(o => o.label) : ["Document:report"],
        tool: "document.build",
      }));
      addEdge(g, edge(build.id, VOCAB.relations.DEPENDS_ON, condition?.id || watch.id));
    }

    return g;
  }

  if (hasOperation(steps, VOCAB.intents.BUILD) || hasOperation(steps, VOCAB.intents.SUMMARIZE) || hasOperation(steps, VOCAB.intents.EXTRACT)) {
    let previous = null;

    if (sources.length) {
      previous = addNode(g, node("ExecStep", "LoadSource", {
        sources: sources.map(s => s.label),
        tool: "object.read",
      }));
    }

    if (hasOperation(steps, VOCAB.intents.EXTRACT) || values.length) {
      const extract = addNode(g, node("ExecStep", "Extract", {
        values: values.map(v => v.label),
        tool: "language.extract",
      }));
      if (previous) addEdge(g, edge(extract.id, VOCAB.relations.DEPENDS_ON, previous.id));
      previous = extract;
    }

    if (hasOperation(steps, VOCAB.intents.SUMMARIZE)) {
      const summarize = addNode(g, node("ExecStep", "Summarize", {
        values: values.map(v => v.label),
        tool: "language.summarize",
      }));
      if (previous) addEdge(g, edge(summarize.id, VOCAB.relations.DEPENDS_ON, previous.id));
      previous = summarize;
    }

    if (hasOperation(steps, VOCAB.intents.BUILD) || hasOperation(steps, VOCAB.intents.CREATE) || outputs.length) {
      const build = addNode(g, node("ExecStep", "BuildDocument", {
        outputs: outputs.length ? outputs.map(o => o.label) : ["Document:report"],
        tool: "document.build",
      }));
      if (previous) addEdge(g, edge(build.id, VOCAB.relations.DEPENDS_ON, previous.id));
    }

    return g;
  }

  const emit = addNode(g, node("ExecStep", "EmitConceptGraphOnly", {
    reason: "No executable compiler registered for intent",
    intent,
  }));

  for (const n of [...subjects, ...objects, ...values]) {
    const input = addNode(g, node("ExecInput", n.label, n.props));
    addEdge(g, edge(emit.id, VOCAB.relations.REQUIRES, input.id));
  }

  return g;
}

function hasOperation(steps, operation) {
  return steps.some(s => s.props.operation === operation);
}

function pickMetric(nodes) {
  return nodes.find(n => isMetric(n.label)) || null;
}

function compileSubjectFetches(g, subjects, objects) {
  if (subjects.length) {
    return subjects.map(s => addNode(g, node("ExecStep", `FetchSubject${s.props.role || ""}`, {
      subject: s.label,
      qualifier: s.props.qualifier || null,
    })));
  }

  const domainObjects = objects.filter(o => !o.label.startsWith("Lexeme:"));
  if (domainObjects.length >= 2) {
    return domainObjects.slice(0, 2).map((o, i) => addNode(g, node("ExecStep", `FetchSubject${i === 0 ? "A" : "B"}`, {
      subject: o.label,
    })));
  }

  return [
    addNode(g, node("ExecStep", "FetchSubjectA")),
    addNode(g, node("ExecStep", "FetchSubjectB")),
  ];
}

function compileWatchTargets(subjects, targets, objects, values) {
  const subjectLabels = subjects.map(s => s.props.qualifier ? `${s.label}(${s.props.qualifier})` : s.label);
  const targetLabels = targets.map(t => t.label);
  const objectLabels = objects.filter(o => !isDocument(o.label)).map(o => o.label);
  const valueLabels = values.filter(v => !v.label.startsWith("Pronoun:")).map(v => v.label);
  return unique([...subjectLabels, ...targetLabels, ...objectLabels, ...valueLabels]);
}

function inferActionText(symbols) {
  const start = symbols.find(s => s.kind === VOCAB.kinds.ACTION && s.concept !== VOCAB.intents.CREATE_REMINDER)
    || symbols.find(s => s.kind === VOCAB.kinds.ENTITY || s.kind === VOCAB.kinds.METRIC);
  if (!start) return null;

  const words = [];
  for (const s of symbols.filter(x => x.index >= start.index)) {
    if ([VOCAB.kinds.TIME, VOCAB.kinds.CADENCE, VOCAB.kinds.DETERMINER, VOCAB.kinds.PREPOSITION, VOCAB.kinds.STRUCTURAL, VOCAB.kinds.PRONOUN].includes(s.kind)) continue;
    if ([".", "?", "!"].includes(s.raw)) continue;
    words.push(s.clean);
  }

  return words.join(" ") || null;
}

function compileFunctionCalls(executionDAG) {
  const calls = [];

  for (const n of executionDAG.nodes) {
    if (n.type !== "ExecStep") continue;

    if (n.label === "NormalizeTemporalConstraint") {
      calls.push({ fn: "time.normalize", args: { temporal: n.props.temporal || [], cadence: n.props.cadence || [] } });
    }

    if (n.label === "CreateReminder") {
      calls.push({ fn: "calendar.createReminder", args: { text: n.props.actionText || `check ${n.props.rawObjectTokens?.join(" ") || "item"}`, temporal: "$NormalizeTemporalConstraint.output" } });
    }

    if (n.label.startsWith("FetchSubject")) {
      calls.push({ fn: "data.fetch", args: { subject: n.props.subject || n.label, qualifier: n.props.qualifier || null } });
    }

    if (n.label === "Compare") {
      calls.push({ fn: "analysis.compare", args: { left: "$FetchSubjectA.output", right: "$FetchSubjectB.output", metric: n.props.metric } });
    }

    if (n.label === "CreateWatch") {
      calls.push({ fn: "scheduler.createWatch", args: { target: n.props.target, cadence: n.props.cadence?.length ? n.props.cadence : ["Repeated"] } });
    }

    if (n.label === "EvaluateCondition") {
      calls.push({ fn: "condition.evaluate", args: { thresholds: n.props.thresholds || [] } });
    }

    if (n.label === "Notify") {
      calls.push({ fn: "notification.send", args: { when: "$EvaluateCondition.output == true" } });
    }

    if (n.label === "LoadSource") {
      calls.push({ fn: "object.read", args: { sources: n.props.sources } });
    }

    if (n.label === "Extract") {
      calls.push({ fn: "language.extract", args: { from: "$LoadSource.output", values: n.props.values } });
    }

    if (n.label === "Summarize") {
      calls.push({ fn: "language.summarize", args: { input: "$Extract.output || $LoadSource.output", values: n.props.values } });
    }

    if (n.label === "BuildDocument") {
      calls.push({ fn: "document.build", args: { outputs: n.props.outputs, input: "$Summarize.output || $Extract.output || $LoadSource.output || $EvaluateCondition.output" } });
    }

    if (n.label === "MoveBall") {
      calls.push({ fn: "ui.moveBall", args: { target: n.props.target, direction: n.props.direction, distance: n.props.distance, unit: n.props.unit } });
    }

    if (n.label === "SetBallColor") {
      calls.push({ fn: "ui.setBallColor", args: { target: n.props.target, color: n.props.color } });
    }

    if (n.label === "AdjustShapeColor") {
      calls.push({ fn: "ui.adjustShapeColor", args: { target: n.props.target, operation: n.props.operation, value: n.props.value } });
    }

    if (n.label === "ResizeBall") {
      calls.push({ fn: "ui.resizeBall", args: { target: n.props.target, operation: n.props.operation, factor: n.props.factor } });
    }

    if (n.label === "SetShape") {
      calls.push({ fn: "ui.setShape", args: { target: n.props.target, shape: n.props.shape } });
    }

    if (n.label === "RotateShape") {
      calls.push({ fn: "ui.rotateShape", args: { target: n.props.target, degrees: n.props.degrees } });
    }

    if (n.label === "SetTextBoxText") {
      calls.push({ fn: "ui.setText", args: { target: n.props.target, text: n.props.text } });
    }
  }

  return calls;
}

function upstreamStepIds(g, nodeId) {
  return g.edges
    .filter(e => e.from === nodeId && e.relation === VOCAB.relations.DEPENDS_ON)
    .map(e => e.to);
}

function compileToolPlan(conceptResult, executionDAG, specs = TOOL_SPECS) {
  const directToolPlan = compileDirectToolPlan(conceptResult, specs);
  if (directToolPlan) return directToolPlan;

  const calls = [];
  const gates = toolPlanGates();

  for (const n of executionDAG.nodes) {
    if (n.type !== "ExecStep") continue;

    if (n.label === "NormalizeTemporalConstraint") {
      calls.push(toolCallNode({
        id: n.id,
        name: "time_normalize",
        arguments: {
          temporal: n.props.temporal || [],
          cadence: n.props.cadence || [],
        },
        dependsOn: upstreamStepIds(executionDAG, n.id),
        specs,
      }));
    }

    if (n.label === "CreateReminder") {
      calls.push(toolCallNode({
        id: n.id,
        name: "calendar_create_reminder",
        arguments: {
          text: n.props.actionText || "check " + (n.props.rawObjectTokens || ["item"]).join(" "),
          temporal: "$NormalizeTemporalConstraint.output",
        },
        dependsOn: upstreamStepIds(executionDAG, n.id),
        specs,
      }));
    }

    if (n.label.startsWith("FetchSubject")) {
      calls.push(toolCallNode({
        id: n.id,
        name: "data_fetch",
        arguments: {
          subject: n.props.subject || n.label,
          qualifier: n.props.qualifier || null,
        },
        dependsOn: upstreamStepIds(executionDAG, n.id),
        specs,
      }));
    }

    if (n.label === "Compare") {
      calls.push(toolCallNode({
        id: n.id,
        name: "analysis_compare",
        arguments: {
          left: "$FetchSubjectA.output",
          right: "$FetchSubjectB.output",
          metric: n.props.metric || null,
        },
        dependsOn: upstreamStepIds(executionDAG, n.id),
        specs,
      }));
    }

    if (n.label === "CreateWatch") {
      calls.push(toolCallNode({
        id: n.id,
        name: "scheduler_create_watch",
        arguments: {
          target: n.props.target || [],
          cadence: n.props.cadence && n.props.cadence.length ? n.props.cadence : ["Repeated"],
        },
        dependsOn: upstreamStepIds(executionDAG, n.id),
        specs,
      }));
    }

    if (n.label === "EvaluateCondition") {
      calls.push(toolCallNode({
        id: n.id,
        name: "condition_evaluate",
        arguments: {
          input: inferConditionInput(n, executionDAG),
          thresholds: normalizeThresholds(n.props.thresholds || []),
        },
        dependsOn: upstreamStepIds(executionDAG, n.id),
        gate: true,
        specs,
      }));
    }

    if (n.label === "Notify") {
      calls.push(toolCallNode({
        id: n.id,
        name: "notification_send",
        arguments: {
          message: inferNotificationMessage(conceptResult),
          when: "$EvaluateCondition.output == true",
        },
        dependsOn: upstreamStepIds(executionDAG, n.id),
        gatedBy: upstreamStepIds(executionDAG, n.id),
        specs,
      }));
    }

    if (n.label === "LoadSource") {
      calls.push(toolCallNode({
        id: n.id,
        name: "object_read",
        arguments: {
          sources: n.props.sources || [],
        },
        dependsOn: upstreamStepIds(executionDAG, n.id),
        specs,
      }));
    }

    if (n.label === "Extract") {
      calls.push(toolCallNode({
        id: n.id,
        name: "language_extract",
        arguments: {
          from: "$LoadSource.output",
          values: n.props.values || [],
        },
        dependsOn: upstreamStepIds(executionDAG, n.id),
        specs,
      }));
    }

    if (n.label === "Summarize") {
      calls.push(toolCallNode({
        id: n.id,
        name: "language_summarize",
        arguments: {
          input: "$Extract.output || $LoadSource.output",
          values: n.props.values || [],
        },
        dependsOn: upstreamStepIds(executionDAG, n.id),
        specs,
      }));
    }

    if (n.label === "BuildDocument") {
      calls.push(toolCallNode({
        id: n.id,
        name: "document_build",
        arguments: {
          outputs: n.props.outputs || ["Document:report"],
          input: "$Summarize.output || $Extract.output || $LoadSource.output || $EvaluateCondition.output",
        },
        dependsOn: upstreamStepIds(executionDAG, n.id),
        specs,
      }));
    }

    if (n.label === "MoveBall") {
      calls.push(toolCallNode({
        id: n.id,
        name: "ui_move_ball",
        arguments: {
          target: n.props.target,
          direction: n.props.direction,
          distance: n.props.distance,
          unit: n.props.unit,
        },
        dependsOn: upstreamStepIds(executionDAG, n.id),
        specs,
      }));
    }

    if (n.label === "SetBallColor") {
      calls.push(toolCallNode({
        id: n.id,
        name: "ui_set_ball_color",
        arguments: {
          target: n.props.target,
          color: n.props.color,
        },
        dependsOn: upstreamStepIds(executionDAG, n.id),
        specs,
      }));
    }

    if (n.label === "AdjustShapeColor") {
      calls.push(toolCallNode({
        id: n.id,
        name: "ui_adjust_shape_color",
        arguments: {
          target: n.props.target,
          operation: n.props.operation,
          value: n.props.value,
        },
        dependsOn: upstreamStepIds(executionDAG, n.id),
        specs,
      }));
    }

    if (n.label === "ResizeBall") {
      calls.push(toolCallNode({
        id: n.id,
        name: "ui_resize_ball",
        arguments: {
          target: n.props.target,
          operation: n.props.operation,
          factor: n.props.factor,
        },
        dependsOn: upstreamStepIds(executionDAG, n.id),
        specs,
      }));
    }

    if (n.label === "RotateShape") {
      calls.push(toolCallNode({
        id: n.id,
        name: "ui_rotate_shape",
        arguments: {
          target: n.props.target,
          degrees: n.props.degrees,
        },
        dependsOn: upstreamStepIds(executionDAG, n.id),
        specs,
      }));
    }

    if (n.label === "SetTextBoxText") {
      calls.push(toolCallNode({
        id: n.id,
        name: "ui_set_text",
        arguments: {
          target: n.props.target,
          text: n.props.text,
        },
        dependsOn: upstreamStepIds(executionDAG, n.id),
        specs,
      }));
    }
  }

  return {
    type: "ToolPlan",
    source: conceptResult.text,
    model: "named tools with JSON Schema parameters",
    tools: Object.values(specs),
    gates,
    calls,
  };
}

function compileDirectToolPlan(conceptResult, specs) {
  const lower = conceptResult.text.toLowerCase();

  if (lower.includes("weather") || lower.includes("forecast")) {
    return {
      type: "ToolPlan",
      source: conceptResult.text,
      model: "named tools with JSON Schema parameters",
      tools: [specs.get_weather],
      gates: toolPlanGates(),
      calls: [toolCallNode({
        id: "toolcall_get_weather_0001",
        name: "get_weather",
        arguments: inferWeatherArguments(conceptResult.text),
        dependsOn: [],
        specs,
      })],
    };
  }

  return null;
}

function inferWeatherArguments(text) {
  const lower = text.toLowerCase();
  const args = { units: "fahrenheit" };

  if (lower.includes("boston")) {
    args.city = "Boston";
    args.state = "MA";
    return args;
  }

  const words = text
    .replace(/[?.!,]/g, " ")
    .split(" ")
    .map(word => word.trim())
    .filter(Boolean);

  for (let i = 0; i < words.length; i++) {
    const token = words[i].toLowerCase();
    if ((token === "in" || token === "for") && words[i + 1]) {
      args.city = titleCase(words[i + 1]);
      if (words[i + 2] && words[i + 2].length === 2) args.state = words[i + 2].toUpperCase();
      return args;
    }
  }

  args.city = "Unknown";
  return args;
}

function titleCase(value) {
  return String(value || "")
    .split("-")
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("-");
}

function toolCallNode(spec) {
  const toolSpec = spec.specs[spec.name];
  const validation = toolSpec ? validateToolArguments(toolSpec.parameters, spec.arguments) : ["unknown tool: " + spec.name];

  return {
    id: spec.id,
    type: spec.gate ? "gate_tool_call" : "tool_call",
    name: spec.name,
    arguments: stripNullArguments(spec.arguments || {}),
    dependsOn: spec.dependsOn || [],
    gatedBy: spec.gatedBy || [],
    schemaValid: validation.length === 0,
    validation,
  };
}

function validateToolArguments(schema, args) {
  const errors = [];
  const required = schema.required || [];
  const properties = schema.properties || {};

  for (const key of required) {
    if (!(key in args) || args[key] === null || args[key] === undefined || args[key] === "") {
      errors.push("missing required argument: " + key);
    }
  }

  for (const [key, value] of Object.entries(args)) {
    if (value === null || value === undefined) continue;
    const prop = properties[key];
    if (!prop) continue;
    if (prop.type === "string" && typeof value !== "string") errors.push(key + " must be string");
    if (prop.type === "number" && typeof value !== "number") errors.push(key + " must be number");
    if (prop.type === "array" && !Array.isArray(value)) errors.push(key + " must be array");
    if (prop.enum && !prop.enum.includes(value)) errors.push(key + " must be one of " + prop.enum.join(", "));
  }

  return errors;
}

function stripNullArguments(args) {
  return Object.fromEntries(Object.entries(args).filter(([, value]) => value !== null && value !== undefined));
}

function toolPlanGates() {
  return [
    {
      id: "schema_validation",
      appliesTo: "*",
      assert: "tool arguments must satisfy the named tool JSON Schema",
    },
    {
      id: "dependency_order",
      appliesTo: "*",
      assert: "a tool call may only consume outputs from completed dependencies",
    },
    {
      id: "condition_gate",
      appliesTo: "gated tool calls",
      assert: "downstream side effects require condition_evaluate to pass",
    },
  ];
}

function normalizeThresholds(thresholds) {
  return thresholds.map(t => ({
    metric: t.metric || undefined,
    operator: t.operator || ">=",
    value: Number(t.value),
    unit: t.unit || undefined,
  }));
}

function inferConditionInput(n, executionDAG) {
  const deps = upstreamStepIds(executionDAG, n.id);
  return deps.length ? "$" + deps.join(".output && $") + ".output" : "$observed.output";
}

function inferNotificationMessage(conceptResult) {
  return "Condition matched for request: " + conceptResult.text;
}

function inferUiCommands(symbols) {
  const clauses = splitClauses(symbols);
  const commands = [];
  let activeTarget = "circle";

  for (const clause of clauses) {
    const directions = inferMovementDirections(clause);
    const color = clause.find(symbol => typeof symbol.concept === "string" && symbol.concept.startsWith("Color:"));
    const mentionedShape = inferMentionedShape(clause);
    const hasShapeToken = clause.some(symbol => ["UI:ball", "UI:square", "UI:triangle", "UI:shape"].includes(symbol.concept));
    const hasTextBox = clause.some(symbol => symbol.concept === "UI:textbox");
    const hasMove = clause.some(symbol => symbol.concept === VOCAB.intents.MOVE);
    const hasUpdate = clause.some(symbol => symbol.concept === VOCAB.intents.UPDATE || symbol.concept === VOCAB.intents.CREATE);
    const hasColorWord = clause.some(symbol => symbol.clean === "color" || symbol.clean === "colour");
    const colorAdjustment = inferColorAdjustment(clause);
    const resizeOperation = inferResizeOperation(clause);
    const rotation = inferRotationDegrees(clause);
    const target = inferUiTarget(clause, activeTarget);
    const hasShapeContext = hasShapeToken || Boolean(mentionedShape) || Boolean(colorAdjustment) || rotation !== null || hasMove || Boolean(color) || Boolean(resizeOperation);

    if (mentionedShape) {
      activeTarget = mentionedShape;
    }

    if (hasShapeContext && hasMove && directions.length) {
      const movement = inferMovementDistance(clause);
      for (const direction of directions) {
        commands.push({
          type: "move_ball",
          target,
          direction,
          distance: movement.distance,
          unit: movement.unit,
        });
      }
    }

    if (hasShapeContext && hasUpdate && color && (hasColorWord || mentionedShape || clause.some(symbol => symbol.clean === "shape") || clause.some(symbol => symbol.clean === "it"))) {
      commands.push({
        type: "set_ball_color",
        target,
        color: color.concept.split(":")[1],
      });
    }

    if (hasShapeContext && colorAdjustment) {
      commands.push({
        type: "adjust_shape_color",
        target,
        operation: colorAdjustment.operation,
        value: colorAdjustment.value,
      });
    }

    if (hasShapeContext) {
      if (resizeOperation) {
        commands.push({
          type: "resize_ball",
          target,
          operation: resizeOperation,
          factor: inferResizeFactor(clause, resizeOperation),
        });
      }

      if (rotation !== null) {
        commands.push({
          type: "rotate_shape",
          target,
          degrees: rotation,
        });
      }
    }

    if (hasTextBox && hasUpdate) {
      const text = inferTextAssignment(clause);
      if (text) {
        commands.push({
          type: "set_text",
          target: "textbox",
          text,
        });
      }
    }
  }

  return commands;
}

function inferUiTarget(clause, activeTarget) {
  const mentionedShape = inferMentionedShape(clause);
  if (mentionedShape) return mentionedShape;

  const hasShapePronoun = clause.some(symbol => symbol.clean === "it" || symbol.clean === "shape");
  if (hasShapePronoun) return activeTarget;

  return activeTarget;
}

function splitClauses(symbols) {
  const clauses = [];
  let current = [];

  for (let index = 0; index < symbols.length; index++) {
    const symbol = symbols[index];
    if (symbol.kind === VOCAB.kinds.CONJUNCTION && symbol.concept === "AND") {
      if (shouldKeepCompoundMoveClause(symbols, index, current)) continue;
      if (current.length) clauses.push(current);
      current = [];
      continue;
    }

    current.push(symbol);
  }

  if (current.length) clauses.push(current);
  return clauses;
}

function shouldKeepCompoundMoveClause(symbols, index, current) {
  const hasMove = current.some(symbol => symbol.concept === VOCAB.intents.MOVE);
  if (!hasMove) return false;

  const next = symbols.slice(index + 1);
  const nextBoundary = next.findIndex(symbol => symbol.kind === VOCAB.kinds.CONJUNCTION && symbol.concept === "AND");
  const nextClause = nextBoundary === -1 ? next : next.slice(0, nextBoundary);
  const hasNextAction = nextClause.some(symbol => symbol.kind === VOCAB.kinds.ACTION || symbol.kind === VOCAB.kinds.DIRECTIVE);
  return !hasNextAction && inferMovementDirections(nextClause).length > 0;
}

function inferMovementDirections(clause) {
  const directions = [];
  const add = direction => {
    if (!directions.includes(direction)) directions.push(direction);
  };

  for (const symbol of clause) {
    if (symbol.concept === "Direction:up") add("up");
    if (symbol.concept === "Direction:down") add("down");
    if (symbol.concept === "Side:left") add("left");
    if (symbol.concept === "Side:right") add("right");
  }

  return directions;
}

function inferMovementDistance(clause) {
  const isNudge = clause.some(symbol => symbol.clean === "nudge" || symbol.clean === "scoot");
  const explicit = clause.find(symbol => symbol.kind === VOCAB.kinds.QUANTITY && typeof symbol.value === "number");
  if (explicit) {
    if (explicit.unit === "percent") {
      return {
        distance: explicit.displayValue ?? roundPercent(explicit.value),
        unit: "percent",
      };
    }

    return {
      distance: explicit.value,
      unit: "px",
    };
  }

  return {
    distance: isNudge ? 48 : 140,
    unit: "px",
  };
}

function inferTextAssignment(clause) {
  const toIndex = clause.findIndex(symbol => symbol.clean === "to");
  if (toIndex === -1) return null;

  const valueWords = clause
    .slice(toIndex + 1)
    .filter(symbol => ![
      VOCAB.kinds.STRUCTURAL,
      VOCAB.kinds.DETERMINER,
      VOCAB.kinds.PREPOSITION,
      VOCAB.kinds.CONJUNCTION,
    ].includes(symbol.kind))
    .map(symbol => symbol.raw.replace(/^["'`]+|["'`]+$/g, ""));

  return valueWords.join(" ").trim() || null;
}

function inferResizeOperation(clause) {
  if (clause.some(symbol => ["grow", "bigger", "larger", "big", "expand", "enlarge", "inflate", "widen"].includes(symbol.clean))) return "grow";
  if (clause.some(symbol => ["shrink", "smaller", "small", "reduce", "tiny", "contract", "compress"].includes(symbol.clean))) return "shrink";
  return null;
}

function inferResizeFactor(clause, operation) {
  const explicit = clause.find(symbol => symbol.kind === VOCAB.kinds.QUANTITY && typeof symbol.value === "number");
  if (explicit) {
    if (explicit.unit === "percent") {
      return operation === "grow" ? 1 + explicit.value : Math.max(0.2, 1 - explicit.value);
    }

    if (explicit.value > 0 && explicit.value <= 10) return Math.max(0.2, explicit.value);
    return operation === "grow"
      ? 1 + explicit.value / 100
      : Math.max(0.2, 1 - explicit.value / 100);
  }

  return operation === "grow" ? 1.35 : 0.75;
}

function inferMentionedShape(clause) {
  const shapeMap = {
    "UI:ball": "circle",
    "UI:square": "square",
    "UI:triangle": "triangle",
  };

  const mention = clause.find(symbol => shapeMap[symbol.concept]);
  return mention ? shapeMap[mention.concept] : null;
}

function inferColorAdjustment(clause) {
  const explicit = clause.find(symbol => symbol.kind === VOCAB.kinds.QUANTITY && typeof symbol.value === "number");
  const hasHue = clause.some(symbol => symbol.clean === "hue");
  const hasSaturation = clause.some(symbol => symbol.clean === "saturation" || symbol.clean === "saturate" || symbol.clean === "desaturate");
  const hasLightness = clause.some(symbol => symbol.clean === "lightness" || symbol.clean === "brightness" || symbol.clean === "brighten" || symbol.clean === "darken" || symbol.clean === "lighten");
  const hasBy = clause.some(symbol => symbol.clean === "by");
  const hasTo = clause.some(symbol => symbol.clean === "to");

  if (hasHue) {
    const value = explicit ? (explicit.displayValue ?? explicit.value) : 45;
    if (clause.some(symbol => ["rotate", "spin", "twist", "shift"].includes(symbol.clean)) || hasBy) {
      return { operation: "rotate_hue", value };
    }

    if (clause.some(symbol => ["set", "make", "change"].includes(symbol.clean)) || hasTo) {
      return { operation: "set_hue", value };
    }
  }

  if (hasSaturation) {
    const value = explicit ? (explicit.displayValue ?? explicit.value * 100) : 15;
    if (clause.some(symbol => ["desaturate", "reduce", "lower", "less"].includes(symbol.clean))) {
      return { operation: hasTo ? "set_saturation" : "adjust_saturation", value: hasTo ? value : -value };
    }

    if (clause.some(symbol => ["saturate", "increase", "raise", "boost", "more"].includes(symbol.clean))) {
      return { operation: hasTo ? "set_saturation" : "adjust_saturation", value };
    }

    if (hasTo) {
      return { operation: "set_saturation", value };
    }
  }

  if (hasLightness) {
    const value = explicit ? (explicit.displayValue ?? explicit.value * 100) : 10;
    if (clause.some(symbol => ["darken", "decrease", "lower"].includes(symbol.clean))) {
      return { operation: hasTo ? "set_lightness" : "adjust_lightness", value: hasTo ? value : -value };
    }

    if (clause.some(symbol => ["brighten", "lighten", "increase", "raise"].includes(symbol.clean))) {
      return { operation: hasTo ? "set_lightness" : "adjust_lightness", value };
    }

    if (hasTo) {
      return { operation: "set_lightness", value };
    }
  }

  return null;
}

function inferRotationDegrees(clause) {
  const hasRotation = clause.some(symbol => ["rotate", "rotation", "spin", "twist", "tilt"].includes(symbol.clean));
  if (!hasRotation) return null;
  if (clause.some(symbol => ["hue", "saturation", "lightness", "brightness", "color", "colour"].includes(symbol.clean))) return null;

  const explicit = clause.find(symbol => symbol.kind === VOCAB.kinds.QUANTITY && typeof symbol.value === "number");
  if (!explicit) return 45;
  return explicit.displayValue ?? explicit.value;
}

function roundPercent(value) {
  return Math.round(Number(value) * 10000) / 100;
}

export {
  buildDerivationDAG,
  buildExecutionDAG,
  compileFunctionCalls,
  compileToolPlan,
};
