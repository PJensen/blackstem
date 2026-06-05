# blackstem

<p align="center">
  <img src="./assets/logo.png" alt="blackstem logo" />
</p>

`blackstem-js` is a small symbolic compiler for executable tool plans.

It explores how much of tool calling can be handled as an inspectable compiler
pipeline instead of a model guessing JSON. The prototype scans a request,
classifies symbols, builds graph structure, validates arguments, and emits a
tool plan with dependencies and gates.

[Try the demo](https://pjensen.github.io/blackstem/)

```txt
language in
tool plan out
```

## Why

Tool calls cross from language into action. At that boundary, the useful
questions are compiler questions:

```txt
What action is being requested?
What object is being acted on?
What condition controls the action?
What schema must the arguments satisfy?
What depends on what?
What is allowed to cause a side effect?
```

`blackstem-js` keeps those answers visible. The output is not a single guessed
function call; it is a plan that can include named tools, JSON Schema arguments,
dependencies, gates, thresholds, source objects, target objects, and downstream
side effects.

## Run Locally

The browser demo is static. Open `index.html`, or run the CLI examples with
Deno:

```sh
deno run run.js
```

## Pipeline

```mermaid
flowchart TD
  A["Input text"] --> B["Scan lexemes"]
  B --> C["Classify symbols"]
  C --> D["Resolve context"]
  D --> E["Build concept graph"]
  E --> F["Build derivation DAG"]
  E --> G["Build execution DAG"]
  G --> H["Compile ToolPlan"]
  H --> I["Validate JSON Schema arguments"]
  I --> J["Emit gated tool calls"]

  E -. exposes .-> X["Intent / objects / values / thresholds"]
  G -. exposes .-> Y["Dependencies / branches / side effects"]
  H -. exposes .-> Z["Named tools / arguments / gates"]
```

## Examples

### Generated concept graph

Input:

```txt
Remind me to check the boiler tomorrow morning.
```

One generated trace from the demo turns that request into this concept graph:

```mermaid
flowchart TD
  request_0010(["Request<br/>UserRequest"])
  plan_0011[["Plan<br/>ConceptualPlan"]]
  intent_0012{{"Intent<br/>CreateReminder<br/>source: remind | sourceKind: directive | confidence: 1"}}
  directive_0013["Directive<br/>Remind<br/>token: remind"]
  step_0014(["Step<br/>Step:1<br/>order: 1 | operation: Remind | operationKind: directive"])
  action_0015["Action<br/>Monitor<br/>token: check"]
  step_0016(["Step<br/>Step:2<br/>order: 2 | operation: Monitor | operationKind: action"])
  object_0017["Object<br/>PhysicalSystem:boiler<br/>token: boiler | kind: entity"]
  target_0018["Target<br/>PhysicalSystem:boiler<br/>token: boiler"]
  target_0019["Target<br/>PhysicalSystem:boiler<br/>token: boiler"]
  constraint_0020["Constraint<br/>TemporalConstraint"]
  constraint_0021["Constraint<br/>RelativeDate:tomorrow<br/>token: tomorrow"]
  constraint_0022["Constraint<br/>TimeBucket:morning<br/>token: morning"]
  tool_0023[("Tool<br/>scheduler.createWatch<br/>sourceOperation: Monitor")]
  tool_0024[("Tool<br/>calendar.createReminder<br/>sourceOperation: CreateReminder")]
  request_0010 -->|has_plan| plan_0011
  request_0010 -->|has_intent| intent_0012
  plan_0011 -->|has_intent| intent_0012
  request_0010 -->|has_directive| directive_0013
  intent_0012 -->|has_directive| directive_0013
  plan_0011 -->|has_step| step_0014
  step_0014 -->|has_directive| directive_0013
  request_0010 -->|has_action| action_0015
  intent_0012 -->|has_action| action_0015
  plan_0011 -->|has_step| step_0016
  step_0016 -->|has_action| action_0015
  intent_0012 -->|has_object| object_0017
  intent_0012 -->|has_target| target_0018
  target_0018 -->|refers_to| object_0017
  intent_0012 -->|has_target| target_0019
  target_0019 -->|refers_to| object_0017
  intent_0012 -->|has_constraint| constraint_0020
  constraint_0020 -->|has_constraint| constraint_0021
  constraint_0020 -->|has_constraint| constraint_0022
  intent_0012 -->|compiles_to| tool_0023
  intent_0012 -->|compiles_to| tool_0024
```

### Reminder with temporal normalization

Input:

```txt
Remind me to check the boiler tomorrow morning.
```

Recognized structure:

```txt
intent:
  CreateReminder

object:
  PhysicalSystem:boiler

temporal:
  RelativeDate:tomorrow
  TimeBucket:morning
```

Compiled plan:

```txt
NormalizeTemporalConstraint
  temporal:
    - RelativeDate:tomorrow
    - TimeBucket:morning

CreateReminder
  text: check boiler
  temporal: $NormalizeTemporalConstraint.output
```

The important part is that temporal interpretation is separated from reminder
creation.

### Compare, gate, notify

Input:

```txt
Compare the east and west search indexes and alert me if drift exceeds 5%.
```

This is not one function call. It is a graph:

```mermaid
flowchart TD
  A["Fetch east SearchIndex"] --> C["Compare drift"]
  B["Fetch west SearchIndex"] --> C
  C --> D{"drift > 5%?"}
  D -- true --> E["Send notification"]
  D -- false --> F["No side effect"]

  D:::gate
  E:::sideEffect

  classDef gate fill:#f5f5f5,stroke:#333,stroke-width:2px;
  classDef sideEffect fill:#fff,stroke:#333,stroke-width:2px;
```

Compiled shape:

```txt
FetchSubjectA
  subject: SearchIndex
  qualifier: Region:east

FetchSubjectB
  subject: SearchIndex
  qualifier: Region:west

Compare
  metric: Metric:drift

EvaluateCondition
  Metric:drift > 5%

Notify
  gatedBy: EvaluateCondition
```

Tool calling is not just choosing a function. It is preserving the shape of the
action.

### One condition, multiple side effects

Input:

```txt
If cost is over $250, notify me and build a report.
```

Compiled shape:

```txt
CreateWatch
  -> EvaluateCondition
    -> Notify
    -> BuildDocument
```

One condition can branch into multiple downstream side effects. Dependency order
is not permission, so side effects should carry explicit gate lineage:

```txt
condition -> side effect
```

should compile into:

```txt
dependsOn: condition
gatedBy: condition
```

## Current Status

This is a prototype and an argument, not a production library.

Known rough edges:

- the weather path still rejects the symbolic parse while still emitting a
  direct tool-plan override
- repeated temporal expressions such as "every morning" lose useful cadence
  detail
- qualifier binding is crude, for example `primary API latency`
- side-effect gate propagation should be stricter
- the vocabulary needs domain packs for tool surfaces such as weather,
  calendar, monitoring, documents, git, email, and finance

Near-term work:

- domain vocabulary packs
- stricter gate propagation
- better qualifier binding
- unified direct-tool and symbolic paths
- richer temporal normalization
- policy nodes
- plan validation passes
- graph export
- minimal runtime executor
- request-to-plan test corpus

## Non-goals

`blackstem-js` is not trying to be a chatbot, an agent framework, a general
natural language understanding system, or a replacement for all model-based
planning.

It is a control-plane experiment: use models where they help, but keep the
action boundary inspectable, boring, and governable.

## License

HSSL.
