import { renderRunsMarkdown } from "./src/index.js";

const examples = [
  "What is the weather in Boston?",
  "Remind me to check the boiler tomorrow morning.",
  "Compare the east and west search indexes and alert me if drift exceeds 5%.",
  "Monitor index latency daily and notify me when it exceeds 10%.",
  "Build a report from the deck and summarize errors.",
  "If cost is over $250, notify me and build a report.",
  "Every morning, check the primary API latency and alert me above 2.5%.",
];

if (import.meta.main) {
  console.log(renderRunsMarkdown(examples));
}