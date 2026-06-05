import { symbolicTransform } from "./src/index.js";

const ENTITY_ORDER = Object.freeze(["circle", "square", "triangle"]);

const DEFAULT_RULE_PROMPTS = Object.freeze([
  "when the circle is above the square notify me",
  "when the circle and square are the same color notify me",
]);

const INITIAL_ENTITIES = Object.freeze({
  circle: Object.freeze({ x: 36, y: 0, hue: 1, saturation: 85, lightness: 66, scale: 1, rotation: 0 }),
  square: Object.freeze({ x: 244, y: 0, hue: 210, saturation: 22, lightness: 28, scale: 1, rotation: 0 }),
  triangle: Object.freeze({ x: 452, y: 0, hue: 42, saturation: 84, lightness: 58, scale: 1, rotation: 0 }),
});

const UI_TOOL_NAMES = new Set([
  "ui_move_ball",
  "ui_set_ball_color",
  "ui_adjust_shape_color",
  "ui_resize_ball",
  "ui_rotate_shape",
]);

const STAGE_LIMITS = Object.freeze({
  x: 560,
  y: 180,
});

const COLOR_PRESETS = Object.freeze({
  black: { hue: 0, saturation: 0, lightness: 10 },
  white: { hue: 0, saturation: 0, lightness: 97 },
  red: { hue: 0, saturation: 84, lightness: 62 },
  crimson: { hue: 348, saturation: 83, lightness: 47 },
  scarlet: { hue: 7, saturation: 88, lightness: 52 },
  blue: { hue: 220, saturation: 84, lightness: 58 },
  navy: { hue: 218, saturation: 60, lightness: 28 },
  cyan: { hue: 188, saturation: 84, lightness: 58 },
  teal: { hue: 176, saturation: 67, lightness: 41 },
  green: { hue: 132, saturation: 64, lightness: 46 },
  lime: { hue: 95, saturation: 78, lightness: 57 },
  emerald: { hue: 152, saturation: 65, lightness: 42 },
  yellow: { hue: 48, saturation: 95, lightness: 61 },
  gold: { hue: 45, saturation: 90, lightness: 53 },
  orange: { hue: 28, saturation: 90, lightness: 56 },
  amber: { hue: 38, saturation: 92, lightness: 56 },
  purple: { hue: 273, saturation: 72, lightness: 58 },
  violet: { hue: 280, saturation: 78, lightness: 66 },
  magenta: { hue: 320, saturation: 78, lightness: 60 },
  pink: { hue: 337, saturation: 82, lightness: 71 },
  brown: { hue: 22, saturation: 45, lightness: 36 },
  gray: { hue: 0, saturation: 0, lightness: 56 },
  silver: { hue: 210, saturation: 8, lightness: 72 },
});

function createDemoState() {
  const state = {
    focusTarget: "circle",
    entities: createInitialEntities(),
    history: [],
    rules: [],
    nextRuleId: 1,
    editingRuleId: null,
  };
  installDefaultRules(state);
  return state;
}

function createInitialEntities() {
  return Object.fromEntries(ENTITY_ORDER.map(name => [name, { ...INITIAL_ENTITIES[name] }]));
}

function initializeDemo(root = document) {
  const elements = {
    promptInput: root.querySelector("#prompt-input"),
    runButton: root.querySelector("#run-button"),
    resetButton: root.querySelector("#reset-button"),
    actionLog: root.querySelector("#action-log"),
    actionLogSummary: root.querySelector("#action-log-summary"),
    rulesList: root.querySelector("#rules-list"),
    toolPlan: root.querySelector("#tool-plan"),
    status: root.querySelector("#status"),
    shapeWraps: Object.fromEntries(ENTITY_ORDER.map(name => [name, root.querySelector(`[data-shape-wrap="${name}"]`)])),
    shapes: Object.fromEntries(ENTITY_ORDER.map(name => [name, root.querySelector(`[data-shape="${name}"]`)])),
    exampleButtons: [...root.querySelectorAll("[data-prompt]")],
  };

  const state = createDemoState();
  renderScene(elements, state);
  renderActionLog(elements, []);
  renderRules(elements, state);
  renderToolPlan(elements, null);
  renderStatus(elements, "Ready.");

  elements.runButton?.addEventListener("click", () => runPrompt(elements, state));
  elements.promptInput?.addEventListener("keydown", event => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    runPrompt(elements, state);
  });

  elements.resetButton?.addEventListener("click", () => {
    resetScene(state);
    renderScene(elements, state);
    renderActionLog(elements, state.history);
    renderRules(elements, state);
    renderStatus(elements, "Scene reset.");
    renderToolPlan(elements, null);
  });

  for (const button of elements.exampleButtons) {
    button.addEventListener("click", () => {
      if (elements.promptInput) elements.promptInput.value = button.dataset.prompt || "";
      runPrompt(elements, state);
    });
  }

  elements.rulesList?.addEventListener("click", event => {
    const row = event.target.closest("[data-rule-id]");
    if (!row) return;
    editRule(row.dataset.ruleId, elements, state);
  });

  elements.rulesList?.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest("[data-rule-id]");
    if (!row) return;
    event.preventDefault();
    editRule(row.dataset.ruleId, elements, state);
  });
}

function runPrompt(elements, state) {
  const prompt = elements.promptInput?.value?.trim() || "";
  if (!prompt) {
    renderStatus(elements, "Enter a prompt first.");
    return;
  }

  const result = symbolicTransform(prompt);
  const resetResult = compileResetShapes(prompt, result);
  if (resetResult) {
    state.editingRuleId = null;
    resetShapes(state);
    const evaluationLines = evaluateRules(state);

    state.history.push(`> ${prompt}`);
    state.history.push(resetResult.line, ...evaluationLines);

    renderScene(elements, state);
    renderRules(elements, state);
    renderActionLog(elements, state.history);
    renderToolPlan(elements, resetResult.toolPlan);
    renderStatus(elements, "Shapes reset.");
    return;
  }

  const compiledRule = compileShapeRule(prompt, result, state);
  if (compiledRule) {
    const ruleLines = installOrRunRule(compiledRule, state);
    const evaluationLines = evaluateRules(state);

    state.history.push(`> ${prompt}`);
    state.history.push(...ruleLines, ...evaluationLines);

    renderScene(elements, state);
    renderRules(elements, state);
    renderActionLog(elements, state.history);
    renderToolPlan(elements, compiledRule.toolPlan);
    renderStatus(elements, compiledRule.mode === "watch" ? "Rule compiled and armed." : "Conditional compiled and evaluated.");
    return;
  }

  const compiledConditionalAction = compileTrailingConditionalAction(prompt, result, state);
  if (compiledConditionalAction) {
    const lines = installOrRunRule(compiledConditionalAction, state);
    const evaluationLines = evaluateRules(state);

    state.history.push(`> ${prompt}`);
    state.history.push(...lines, ...evaluationLines);

    renderScene(elements, state);
    renderRules(elements, state);
    renderActionLog(elements, state.history);
    renderToolPlan(elements, compiledConditionalAction.toolPlan);
    renderStatus(elements, "Conditional compiled and evaluated.");
    return;
  }

  if (hasTrailingIf(result)) {
    state.history.push(`> ${prompt}`);
    state.history.push("conditional blocked: unsupported or ambiguous condition");
    renderRules(elements, state);
    renderActionLog(elements, state.history);
    renderToolPlan(elements, blockedConditionalToolPlan(prompt));
    renderStatus(elements, "Conditional blocked.");
    return;
  }

  state.editingRuleId = null;

  const filteredPlan = expandAllShapeToolPlan(filterBallToolPlan(result.toolPlan), result);
  const calls = filteredPlan.calls;

  renderToolPlan(elements, filteredPlan);

  if (!calls.length) {
    const evaluationLines = evaluateRules(state);
    state.history.push(`> ${prompt}`);
    state.history.push(...evaluationLines);
    renderRules(elements, state);
    renderActionLog(elements, state.history);
    renderStatus(elements, evaluationLines.length ? "No browser-scene action compiled; rules evaluated." : "No browser-scene action compiled for that prompt.");
    return;
  }

  const actionLines = [];
  for (const call of calls) {
    actionLines.push(executeToolCall(call, state));
  }
  actionLines.push(...evaluateRules(state));

  state.history.push(`> ${prompt}`);
  state.history.push(...actionLines);

  renderScene(elements, state);
  renderRules(elements, state);
  renderActionLog(elements, state.history);
  renderStatus(elements, `Executed ${calls.length} UI action${calls.length === 1 ? "" : "s"}.`);
}

function executeToolCall(call, state) {
  const target = resolveTarget(call.arguments?.target);
  const entity = state.entities[target];

  if (call.name === "ui_move_ball") {
    moveShape(entity, call.arguments.direction, Number(call.arguments.distance || 0), call.arguments.unit || "px");
    state.focusTarget = target;
    return `ui_move_ball target=${call.arguments.target} direction=${call.arguments.direction} distance=${call.arguments.distance}${call.arguments.unit === "percent" ? "%" : "px"}`;
  }

  if (call.name === "ui_set_ball_color") {
    applyNamedColor(entity, String(call.arguments.color || "red"));
    state.focusTarget = target;
    return `ui_set_ball_color target=${call.arguments.target} color=${call.arguments.color}`;
  }

  if (call.name === "ui_adjust_shape_color") {
    adjustShapeColor(entity, call.arguments.operation, Number(call.arguments.value || 0));
    state.focusTarget = target;
    return `ui_adjust_shape_color target=${call.arguments.target} operation=${call.arguments.operation} value=${call.arguments.value}`;
  }

  if (call.name === "ui_resize_ball") {
    resizeBall(entity, call.arguments.operation, Number(call.arguments.factor || 1));
    state.focusTarget = target;
    return `ui_resize_ball target=${call.arguments.target} operation=${call.arguments.operation} factor=${call.arguments.factor}`;
  }

  if (call.name === "ui_set_shape") {
    return `ui_set_shape target=${call.arguments.target} shape=${call.arguments.shape} skipped(identity-preserving field)`;
  }

  if (call.name === "ui_rotate_shape") {
    entity.rotation = round2(entity.rotation + Number(call.arguments.degrees || 0));
    state.focusTarget = target;
    return `ui_rotate_shape target=${call.arguments.target} degrees=${call.arguments.degrees}`;
  }

  return `ignored ${call.name}`;
}

function moveShape(entity, direction, distance, unit) {
  const safeDistance = Number.isFinite(distance) ? distance : 0;
  const appliedDistance = unit === "percent"
    ? (direction === "left" || direction === "right" ? STAGE_LIMITS.x : STAGE_LIMITS.y) * (safeDistance / 100)
    : safeDistance;

  if (direction === "right") entity.x = clamp(round2(entity.x + appliedDistance), 0, STAGE_LIMITS.x);
  if (direction === "left") entity.x = clamp(round2(entity.x - appliedDistance), 0, STAGE_LIMITS.x);
  if (direction === "up") entity.y = clamp(round2(entity.y + appliedDistance), 0, STAGE_LIMITS.y);
  if (direction === "down") entity.y = clamp(round2(entity.y - appliedDistance), 0, STAGE_LIMITS.y);
}

function resizeBall(entity, operation, factor) {
  const safeFactor = Number.isFinite(factor) ? factor : 1;

  if (operation === "grow") entity.scale = clamp(round2(entity.scale * safeFactor), 0.45, 2.6);
  if (operation === "shrink") entity.scale = clamp(round2(entity.scale * safeFactor), 0.45, 2.6);
}

function renderScene(elements, state) {
  for (const name of ENTITY_ORDER) {
    const entity = state.entities[name];
    const wrap = elements.shapeWraps[name];
    const shape = elements.shapes[name];
    if (wrap) {
      wrap.style.transform = `translate(${entity.x}px, ${-entity.y}px)`;
    }

    if (shape) {
      const color = toHslString(entity);
      shape.style.background = color;
      shape.style.transform = `scale(${entity.scale}) rotate(${entity.rotation}deg)`;
      shape.className = `shape shape--${name}`;
      shape.style.setProperty("--shape-color", color);
    }
  }
}

function renderActionLog(elements, lines) {
  if (elements.actionLog) {
    elements.actionLog.textContent = lines.length ? lines.join("\n") : "No actions executed yet.";
  }

  if (elements.actionLogSummary) {
    elements.actionLogSummary.textContent = `Action log (${lines.length})`;
  }
}

function renderRules(elements, state) {
  if (!elements.rulesList) return;

  if (!state.rules.length) {
    elements.rulesList.innerHTML = `<div class="rule-empty">Run a prompt starting with "when" to add a persistent rule.</div>`;
    return;
  }

  elements.rulesList.innerHTML = state.rules.map(rule => `
    <div class="rule-row ${rule.lastValue ? "rule-row--true" : ""} ${state.editingRuleId === rule.id ? "rule-row--editing" : ""}" data-rule-id="${escapeHtml(rule.id)}" role="button" tabindex="0">
      <input type="checkbox" ${rule.lastValue ? "checked" : ""} disabled />
      <div class="rule-copy">
        <div class="rule-condition">${escapeHtml(rule.condition.label)}</div>
        <div class="rule-effect">${escapeHtml(rule.effect.label)}</div>
      </div>
      <span class="rule-state">${rule.lastValue ? "true" : "watching"}</span>
    </div>
  `).join("");
}

function renderToolPlan(elements, toolPlan) {
  if (elements.toolPlan) {
    elements.toolPlan.textContent = toolPlan
      ? JSON.stringify(toolPlan, null, 2)
      : "Run a prompt to inspect the filtered ball-only tool plan.";
  }
}

function renderStatus(elements, message) {
  if (elements.status) {
    elements.status.textContent = message;
  }
}

function resetScene(state) {
  state.focusTarget = "circle";
  resetShapes(state);
  state.history = [];
  state.rules = [];
  state.nextRuleId = 1;
  state.editingRuleId = null;
  installDefaultRules(state);
}

function resetShapes(state) {
  state.focusTarget = "circle";
  state.entities = createInitialEntities();
}

function installDefaultRules(state) {
  for (const prompt of DEFAULT_RULE_PROMPTS) {
    const result = symbolicTransform(prompt);
    const compiledRule = compileShapeRule(prompt, result, state);
    if (!compiledRule) continue;

    state.rules.push({
      id: `rule_${state.nextRuleId++}`,
      source: compiledRule.source,
      condition: compiledRule.condition,
      effect: compiledRule.effect,
      lastValue: false,
      firedCount: 0,
    });
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function applyNamedColor(entity, name) {
  const preset = COLOR_PRESETS[String(name).toLowerCase()];
  if (!preset) return;
  entity.hue = preset.hue;
  entity.saturation = preset.saturation;
  entity.lightness = preset.lightness;
}

function adjustShapeColor(entity, operation, value) {
  const safeValue = Number.isFinite(value) ? value : 0;

  if (operation === "set_hue") entity.hue = normalizeHue(safeValue);
  if (operation === "rotate_hue") entity.hue = normalizeHue(entity.hue + safeValue);
  if (operation === "set_saturation") entity.saturation = clamp(round2(safeValue), 0, 100);
  if (operation === "adjust_saturation") entity.saturation = clamp(round2(entity.saturation + safeValue), 0, 100);
  if (operation === "set_lightness") entity.lightness = clamp(round2(safeValue), 0, 100);
  if (operation === "adjust_lightness") entity.lightness = clamp(round2(entity.lightness + safeValue), 0, 100);
}

function normalizeHue(value) {
  const normalized = Number(value) % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function toHslString(state) {
  return `hsl(${round2(state.hue)} ${round2(state.saturation)}% ${round2(state.lightness)}%)`;
}

function filterBallToolPlan(toolPlan) {
  const calls = (toolPlan?.calls || []).filter(call => UI_TOOL_NAMES.has(call.name));
  const toolNames = new Set(calls.map(call => call.name));
  const tools = (toolPlan?.tools || []).filter(tool => toolNames.has(tool.name));

  return {
    type: "ToolPlan",
    source: toolPlan?.source || null,
    model: toolPlan?.model || null,
    tools,
    calls,
  };
}

function expandAllShapeToolPlan(toolPlan, result) {
  if (!isAllShapesRequest(result)) return toolPlan;

  const inferredCalls = [...inferAllShapeCalls(result), ...toolPlan.calls];
  const calls = inferredCalls.flatMap(call => {
    if (!call.arguments || !("target" in call.arguments)) return [call];
    return ENTITY_ORDER.map(target => ({
      ...call,
      id: `${call.id || call.name}_${target}`,
      arguments: { ...call.arguments, target },
    }));
  });

  if (!calls.length) return toolPlan;

  const toolNames = new Set(calls.map(call => call.name));
  return {
    ...toolPlan,
    tools: (toolPlan.tools || []).filter(tool => toolNames.has(tool.name)),
    calls,
  };
}

function inferAllShapeCalls(result) {
  const symbols = result.symbols || [];
  const color = symbols.find(symbol => typeof symbol.concept === "string" && symbol.concept.startsWith("Color:"));
  const hasUpdate = symbols.some(symbol => symbol.kind === "action" && ["Create", "Update"].includes(symbol.concept));

  if (hasUpdate && color) {
    return [{
      id: "all_shapes_color",
      type: "tool_call",
      name: "ui_set_ball_color",
      arguments: {
        target: "all",
        color: color.concept.split(":")[1],
      },
      dependsOn: [],
      gatedBy: [],
      schemaValid: true,
      validation: [],
    }];
  }

  return [];
}

function isAllShapesRequest(result) {
  const symbols = result.symbols || [];
  return symbols.some(symbol => symbol.clean === "all");
}

function compileResetShapes(prompt, result) {
  const symbols = result.symbols || [];
  const hasReset = symbols.some(symbol => symbol.kind === "action" && symbol.concept === "Reset");
  const hasShape = symbols.some(symbol => symbol.clean === "all" || symbol.concept === "UI:shape" || shapeNameFromSymbol(symbol));
  if (!hasReset || !hasShape) return null;

  return {
    line: "reset shapes",
    toolPlan: {
      type: "ToolPlan",
      source: prompt,
      model: "demo shape reset",
      tools: [],
      calls: [{
        id: "reset_shapes",
        type: "tool_call",
        name: "ui_reset_shapes",
        arguments: { target: "all" },
        dependsOn: [],
        gatedBy: [],
        schemaValid: true,
        validation: [],
      }],
    },
  };
}

function resolveTarget(target) {
  return ENTITY_ORDER.includes(target) ? target : "circle";
}

function compileShapeRule(prompt, result, state) {
  const symbols = result.symbols || [];
  const conditionIndex = symbols.findIndex(symbol => symbol.kind === "condition");
  const firstCondition = symbols[conditionIndex];
  if (!firstCondition || !["when", "if"].includes(firstCondition.clean)) return null;

  const effectIndex = symbols.findIndex(symbol => symbol.kind === "directive" || symbol.kind === "action");
  if (effectIndex === -1) return null;
  if (conditionIndex > effectIndex) return null;

  const conditionSymbols = symbols.slice(conditionIndex + 1, effectIndex);
  const effectSymbols = symbols.slice(effectIndex);
  const condition = compileShapeCondition(conditionSymbols, state);
  if (!condition) return null;
  const effect = compileRuleEffect(effectSymbols, state, condition.primaryTarget);
  if (!effect) return null;

  const mode = firstCondition.clean === "when" ? "watch" : "once";
  return {
    mode,
    source: prompt,
    condition,
    effect,
    toolPlan: shapeRuleToolPlan(prompt, condition, effect, mode),
  };
}

function compileTrailingConditionalAction(prompt, result, state) {
  const symbols = result.symbols || [];
  const conditionIndex = symbols.findIndex(symbol => symbol.kind === "condition" && symbol.clean === "if");
  if (conditionIndex <= 0) return null;

  const effectSymbols = symbols.slice(0, conditionIndex);
  const conditionSymbols = symbols.slice(conditionIndex + 1);
  const effectTarget = effectSymbols.map(symbol => shapeNameFromSymbol(symbol)).find(Boolean) || state.focusTarget;
  const normalizedConditionSymbols = shouldAddImplicitConditionSubject(conditionSymbols, effectTarget)
    ? [{ clean: effectTarget, concept: shapeConceptFromName(effectTarget), kind: "entity" }, ...conditionSymbols]
    : conditionSymbols;
  const condition = compileShapeCondition(normalizedConditionSymbols, state);
  if (!condition) return null;

  const effect = compileRuleEffect(effectSymbols, state, effectTarget);
  if (!effect) return null;

  return {
    mode: "once",
    source: prompt,
    condition,
    effect,
    toolPlan: shapeRuleToolPlan(prompt, condition, effect, "once"),
  };
}

function shouldAddImplicitConditionSubject(conditionSymbols, effectTarget) {
  const conditionShapeNames = conditionSymbols.map(symbol => shapeNameFromSymbol(symbol)).filter(Boolean);
  if (!conditionShapeNames.length) return true;
  if (conditionShapeNames.length >= 2 || conditionShapeNames.includes(effectTarget)) return false;

  const hasColorValue = conditionSymbols.some(symbol => typeof symbol.concept === "string" && symbol.concept.startsWith("Color:"));
  if (hasColorValue) return false;

  const hasSame = conditionSymbols.some(symbol => symbol.clean === "same");
  const hasComparator = Boolean(inferSpatialRelation(conditionSymbols) || inferSizeRelation(conditionSymbols));
  return hasSame || hasComparator;
}

function hasTrailingIf(result) {
  const symbols = result.symbols || [];
  return symbols.findIndex(symbol => symbol.kind === "condition" && symbol.clean === "if") > 0;
}

function blockedConditionalToolPlan(source) {
  return {
    type: "ToolPlan",
    source,
    model: "blocked conditional",
    tools: [],
    calls: [{
      id: "blocked_condition",
      type: "gate_tool_call",
      name: "condition_evaluate",
      arguments: { reason: "unsupported or ambiguous demo condition" },
      dependsOn: [],
      gatedBy: [],
      schemaValid: false,
      validation: ["conditional prompt was not compiled into a safe demo rule"],
    }],
  };
}

function installOrRunRule(compiledRule, state) {
  if (compiledRule.mode === "watch") {
    const editedRule = state.editingRuleId
      ? state.rules.find(rule => rule.id === state.editingRuleId)
      : null;

    if (editedRule) {
      editedRule.source = compiledRule.source;
      editedRule.condition = compiledRule.condition;
      editedRule.effect = compiledRule.effect;
      editedRule.lastValue = false;
      editedRule.firedCount = 0;
      state.editingRuleId = null;
      return [`rule updated: ${editedRule.condition.label} -> ${editedRule.effect.label}`];
    }

    const rule = {
      id: `rule_${state.nextRuleId++}`,
      source: compiledRule.source,
      condition: compiledRule.condition,
      effect: compiledRule.effect,
      lastValue: false,
      firedCount: 0,
    };
    state.rules.push(rule);
    return [`rule armed: ${rule.condition.label} -> ${rule.effect.label}`];
  }

  const passed = compiledRule.condition.evaluate(state);
  if (!passed) return [`condition false: ${compiledRule.condition.label} -> blocked ${compiledRule.effect.label}`];

  return [
    `condition true: ${compiledRule.condition.label}`,
    runRuleEffect(compiledRule.effect, state),
  ];
}

function editRule(ruleId, elements, state) {
  const rule = state.rules.find(item => item.id === ruleId);
  if (!rule) return;

  if (state.editingRuleId === rule.id) {
    state.editingRuleId = null;
    renderRules(elements, state);
    renderStatus(elements, "Rule editing cancelled.");
    return;
  }

  state.editingRuleId = rule.id;
  if (elements.promptInput) {
    elements.promptInput.value = rule.source;
    elements.promptInput.focus();
    elements.promptInput.setSelectionRange(0, elements.promptInput.value.length);
  }
  renderRules(elements, state);
  renderStatus(elements, "Editing rule. Run prompt to replace it.");
}

function evaluateRules(state) {
  const lines = [];

  for (const rule of state.rules) {
    const passed = rule.condition.evaluate(state);
    if (passed && !rule.lastValue) {
      rule.firedCount++;
      lines.push(`rule fired: ${rule.condition.label} -> ${rule.effect.label}`);
      lines.push(runRuleEffect(rule.effect, state));
    }
    rule.lastValue = passed;
  }

  return lines;
}

function runRuleEffect(effect, state) {
  if (effect.type === "notify") {
    return `notification_send message="${effect.message}" gatedBy=condition_evaluate`;
  }

  if (effect.type === "multi_tool_call") {
    return effect.effects.map(item => runRuleEffect(item, state)).join("\n");
  }

  if (effect.type === "tool_call") {
    return executeToolCall(effect.call, state);
  }

  return `ignored rule effect ${effect.type}`;
}

function compileShapeCondition(symbols, state) {
  const shapeNames = symbols.map(symbol => shapeNameFromSymbol(symbol)).filter(Boolean);
  const uniqueShapes = [...new Set(shapeNames)];
  const hasSame = symbols.some(symbol => symbol.clean === "same");
  const hasColor = symbols.some(symbol => symbol.clean === "color" || symbol.concept === "Metric:color");
  const quantity = symbols.find(symbol => symbol.kind === "quantity" && typeof symbol.value === "number");
  const color = symbols.find(symbol => typeof symbol.concept === "string" && symbol.concept.startsWith("Color:"));
  const hasAll = symbols.some(symbol => symbol.clean === "all");
  const hasShapeGroup = symbols.some(symbol => symbol.concept === "UI:shape");
  const hasSize = symbols.some(symbol => symbol.clean === "size" || symbol.concept === "Metric:size");

  if (hasAll && hasShapeGroup && hasSame && hasColor) {
    return {
      primaryTarget: "circle",
      label: "all shapes same color",
      evaluate: demoState => ENTITY_ORDER.every(name => sameColor(demoState.entities[name], demoState.entities[ENTITY_ORDER[0]])),
    };
  }

  if (hasSame && hasColor && uniqueShapes.length >= 2) {
    const [left, right] = uniqueShapes;
    return {
      primaryTarget: left,
      label: `${left} same color as ${right}`,
      evaluate: demoState => sameColor(demoState.entities[left], demoState.entities[right]),
    };
  }

  if (hasSame && hasSize && uniqueShapes.length >= 2) {
    const [left, right] = uniqueShapes;
    return {
      primaryTarget: left,
      label: `${left} same size as ${right}`,
      evaluate: demoState => shapeSize(demoState.entities[left]) === shapeSize(demoState.entities[right]),
    };
  }

  if (color && uniqueShapes.length >= 1) {
    const target = uniqueShapes[0];
    const colorName = color.concept.split(":")[1];
    return {
      primaryTarget: target,
      label: `${target} is ${colorName}`,
      evaluate: demoState => sameColor(demoState.entities[target], COLOR_PRESETS[colorName]),
    };
  }

  const relation = inferSpatialRelation(symbols);
  if (relation && uniqueShapes.length >= 2) {
    const [left, right] = uniqueShapes;
    return {
      primaryTarget: left,
      label: `${left} ${relation} ${right}`,
      evaluate: demoState => compareShapeRelation(demoState.entities[left], demoState.entities[right], relation),
    };
  }

  const sizeRelation = inferSizeRelation(symbols);
  if (sizeRelation && uniqueShapes.length >= 1) {
    const left = uniqueShapes[0];

    if (uniqueShapes.length >= 2) {
      const right = uniqueShapes[1];
      return {
        primaryTarget: left,
        label: `${left} ${sizeRelation} ${right}`,
        evaluate: demoState => compareNumbers(shapeSize(demoState.entities[left]), shapeSize(demoState.entities[right]), sizeRelation),
      };
    }

    if (quantity) {
      return {
        primaryTarget: left,
        label: `${left} ${sizeRelation} ${quantity.displayValue ?? quantity.value}px`,
        evaluate: demoState => compareNumbers(shapeSize(demoState.entities[left]), Number(quantity.displayValue ?? quantity.value), sizeRelation),
      };
    }
  }

  return null;
}

function compileRuleEffect(symbols, state, fallbackTarget = null) {
  const clauses = splitEffectClauses(symbols);
  if (clauses.length > 1) {
    const effects = clauses
      .map(clause => compileSingleRuleEffect(clause, state, fallbackTarget))
      .filter(Boolean);
    if (!effects.length) return null;
    if (effects.length === 1) return effects[0];
    return {
      type: "multi_tool_call",
      label: effects.map(effect => effect.label).join(" + "),
      effects,
    };
  }

  return compileSingleRuleEffect(symbols, state, fallbackTarget);
}

function compileSingleRuleEffect(symbols, state, fallbackTarget = null) {
  const directive = symbols.find(symbol => symbol.kind === "directive");
  if (directive?.clean === "notify" || directive?.clean === "alert") {
    return {
      type: "notify",
      label: "notify",
      message: "Shape rule matched",
    };
  }

  const color = symbols.find(symbol => typeof symbol.concept === "string" && symbol.concept.startsWith("Color:"));
  if (color) {
    const target = symbols.map(symbol => shapeNameFromSymbol(symbol)).find(Boolean) || fallbackTarget || state.focusTarget;
    const colorName = color.concept.split(":")[1];
    return {
      type: "tool_call",
      label: `make ${target} ${colorName}`,
      call: {
        name: "ui_set_ball_color",
        arguments: { target, color: colorName },
      },
    };
  }

  const resizeOperation = inferResizeOperation(symbols);
  if (resizeOperation) {
    const target = symbols.map(symbol => shapeNameFromSymbol(symbol)).find(Boolean) || fallbackTarget || state.focusTarget;
    const factor = inferResizeFactor(symbols, resizeOperation);
    return {
      type: "tool_call",
      label: `${resizeOperation} ${target}`,
      call: {
        name: "ui_resize_ball",
        arguments: { target, operation: resizeOperation, factor },
      },
    };
  }

  const moveDirection = inferMoveDirection(symbols);
  if (moveDirection) {
    const target = symbols.map(symbol => shapeNameFromSymbol(symbol)).find(Boolean) || fallbackTarget || state.focusTarget;
    const distance = inferMoveDistance(symbols);
    return {
      type: "tool_call",
      label: `move ${target} ${moveDirection}`,
      call: {
        name: "ui_move_ball",
        arguments: { target, direction: moveDirection, distance: distance.value, unit: distance.unit },
      },
    };
  }

  const rotationDegrees = inferRotationDegrees(symbols);
  if (rotationDegrees !== null) {
    const target = symbols.map(symbol => shapeNameFromSymbol(symbol)).find(Boolean) || fallbackTarget || state.focusTarget;
    return {
      type: "tool_call",
      label: `rotate ${target}`,
      call: {
        name: "ui_rotate_shape",
        arguments: { target, degrees: rotationDegrees },
      },
    };
  }

  return null;
}

function splitEffectClauses(symbols) {
  const clauses = [];
  let current = [];

  for (const symbol of symbols) {
    if (symbol.clean === "and") {
      if (current.length) clauses.push(current);
      current = [];
      continue;
    }

    current.push(symbol);
  }

  if (current.length) clauses.push(current);
  return clauses;
}

function shapeRuleToolPlan(source, condition, effect, mode) {
  const effects = effect.type === "multi_tool_call" ? effect.effects : [effect];
  const effectCalls = effects.map((item, index) => item.type === "notify"
    ? {
        id: `rule_effect_${index + 1}`,
        type: "tool_call",
        name: "notification_send",
        arguments: { message: item.message, when: "$condition_evaluate.output == true" },
        dependsOn: ["rule_condition"],
        gatedBy: ["rule_condition"],
        schemaValid: true,
        validation: [],
      }
    : {
        id: `rule_effect_${index + 1}`,
        type: "tool_call",
        name: item.call.name,
        arguments: item.call.arguments,
        dependsOn: ["rule_condition"],
        gatedBy: ["rule_condition"],
        schemaValid: true,
        validation: [],
      });

  return {
    type: "ToolPlan",
    source,
    model: mode === "watch" ? "persistent shape rule" : "immediate shape condition",
    tools: [],
    calls: [
      {
        id: "rule_condition",
        type: "gate_tool_call",
        name: "condition_evaluate",
        arguments: { condition: condition.label },
        dependsOn: [],
        gatedBy: [],
        schemaValid: true,
        validation: [],
      },
      ...effectCalls,
    ],
  };
}

function shapeNameFromSymbol(symbol) {
  if (symbol.clean === "circle" || symbol.concept === "UI:ball") return "circle";
  if (symbol.clean === "square" || symbol.concept === "UI:square") return "square";
  if (symbol.clean === "triangle" || symbol.concept === "UI:triangle") return "triangle";
  return null;
}

function shapeConceptFromName(name) {
  if (name === "circle") return "UI:ball";
  if (name === "square") return "UI:square";
  if (name === "triangle") return "UI:triangle";
  return "UI:shape";
}

function inferResizeOperation(symbols) {
  const words = new Set(symbols.map(symbol => symbol.clean));
  if (["grow", "bigger", "larger", "expand", "enlarge", "inflate"].some(word => words.has(word))) return "grow";
  if (["shrink", "smaller", "reduce", "contract"].some(word => words.has(word))) return "shrink";
  return null;
}

function inferResizeFactor(symbols, operation) {
  const explicit = symbols.find(symbol => symbol.kind === "quantity" && typeof symbol.value === "number");
  if (!explicit) return operation === "grow" ? 1.35 : 0.75;

  if (explicit.unit === "percent") {
    return operation === "grow" ? 1 + explicit.value : Math.max(0.2, 1 - explicit.value);
  }

  if (explicit.value > 0 && explicit.value <= 10) return Math.max(0.2, explicit.value);
  return operation === "grow"
    ? 1 + explicit.value / 100
    : Math.max(0.2, 1 - explicit.value / 100);
}

function inferRotationDegrees(symbols) {
  const words = new Set(symbols.map(symbol => symbol.clean));
  if (!["rotate", "spin", "twist", "tilt"].some(word => words.has(word))) return null;
  if (["hue", "saturation", "lightness", "brightness", "color", "colour"].some(word => words.has(word))) return null;

  const explicit = symbols.find(symbol => symbol.kind === "quantity" && typeof symbol.value === "number");
  return explicit ? (explicit.displayValue ?? explicit.value) : 45;
}

function inferMoveDirection(symbols) {
  const hasMove = symbols.some(symbol => symbol.kind === "action" && symbol.concept === "Move");
  if (!hasMove) return null;

  const words = new Set(symbols.map(symbol => symbol.clean));
  if (words.has("up")) return "up";
  if (words.has("down")) return "down";
  if (words.has("left")) return "left";
  if (words.has("right")) return "right";
  return null;
}

function inferMoveDistance(symbols) {
  const explicit = symbols.find(symbol => symbol.kind === "quantity" && typeof symbol.value === "number");
  if (!explicit) return { value: 20, unit: "px" };
  if (explicit.unit === "percent") return { value: Number(explicit.displayValue ?? explicit.value * 100), unit: "percent" };
  return { value: Number(explicit.displayValue ?? explicit.value), unit: "px" };
}

function inferSpatialRelation(symbols) {
  const words = new Set(symbols.map(symbol => symbol.clean));
  if (words.has("above") || words.has("over")) return "above";
  if (words.has("below") || words.has("under")) return "below";
  if (words.has("left")) return "left of";
  if (words.has("right")) return "right of";
  return null;
}

function inferSizeRelation(symbols) {
  const words = new Set(symbols.map(symbol => symbol.clean));
  if (["larger", "bigger", "greater", "over", "above"].some(word => words.has(word))) return "larger than";
  if (["smaller", "less", "under", "below"].some(word => words.has(word))) return "smaller than";
  return null;
}

function compareShapeRelation(left, right, relation) {
  if (relation === "above") return left.y > right.y;
  if (relation === "below") return left.y < right.y;
  if (relation === "left of") return left.x < right.x;
  if (relation === "right of") return left.x > right.x;
  return false;
}

function shapeSize(entity) {
  return round2(92 * entity.scale);
}

function compareNumbers(left, right, relation) {
  if (relation === "larger than") return left > right;
  if (relation === "smaller than") return left < right;
  return false;
}

function sameColor(left, right) {
  if (!left || !right) return false;
  return Math.round(left.hue) === Math.round(right.hue)
    && Math.round(left.saturation) === Math.round(right.saturation)
    && Math.round(left.lightness) === Math.round(right.lightness);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export {
  createDemoState,
  executeToolCall,
  initializeDemo,
};

if (typeof document !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => initializeDemo(document));
}
