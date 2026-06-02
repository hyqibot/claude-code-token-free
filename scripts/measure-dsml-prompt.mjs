import {
  buildDsmlToolPrompt,
  buildDeepSeekPromptForTurn,
  filterToolsForDsmlPrompt,
  measureDsmlPromptStats,
} from "../vendor/copaw-zero-token/python/src/copaw/zero_token_gateway/deepseek-prompt.mjs";
import {
  DEEPSEEK_GUARD,
  capDeepSeekPrompt,
  fitDeepSeekSystemParts,
  promptHasFullDsml,
} from "../vendor/copaw-zero-token/python/src/copaw/zero_token_gateway/deepseek-guard.mjs";

const claudeTools3 = [
  { type: "function", function: { name: "Bash", description: "Executes a bash command in a persistent shell session" } },
  { type: "function", function: { name: "Read", description: "Reads a file from the local filesystem" } },
  { type: "function", function: { name: "WebFetch", description: "Fetches content from a specified URL and processes it" } },
];
const claudeTools10 = [
  ...claudeTools3,
  { type: "function", function: { name: "Write", description: "Write a file to the local filesystem" } },
  { type: "function", function: { name: "Edit", description: "Edit a file by replacing strings" } },
  { type: "function", function: { name: "Glob", description: "Find files matching a glob pattern" } },
  { type: "function", function: { name: "Grep", description: "Search file contents with ripgrep" } },
  { type: "function", function: { name: "Task", description: "Launch a subagent for complex tasks" } },
  { type: "function", function: { name: "WebSearch", description: "Search the web" } },
  { type: "function", function: { name: "NotebookEdit", description: "Edit Jupyter notebook cells" } },
];
const claudeTools20 = [
  ...claudeTools10,
  ...Array.from({ length: 10 }, (_, i) => ({
    type: "function",
    function: {
      name: `Tool${i + 1}`,
      description: `Description for synthetic tool ${i + 1} with some extra text to simulate long CLI schema`,
    },
  })),
];

const sysShort = "You are Claude Code, Anthropic official CLI for Claude.";
const sysLong = `${sysShort}\n${"Read CLAUDE.md for project rules. ".repeat(200)}`;

function report(label, tools, user, sys) {
  const dsml = buildDsmlToolPrompt(tools);
  const hiPrompt = buildDeepSeekPromptForTurn(
    [{ role: "system", content: sys }, { role: "user", content: user }],
    tools,
    null,
    { dsmlFullSent: false },
  );
  const stats = measureDsmlPromptStats(tools, hiPrompt);
  console.log(`--- ${label}`);
  console.log(`  measureDsmlPromptStats:`, stats);
  console.log(`  DSML (file URL filtered): ${buildDsmlToolPrompt(filterToolsForDsmlPrompt(tools, user)).length} chars`);
  console.log(`  fitDeepSeekSystemParts: ${fitDeepSeekSystemParts(sys, dsml).length} / cap ${DEEPSEEK_GUARD.maxSystemChars()}`);
}

console.log("DeepSeek guard defaults:");
console.log(`  maxSystemChars=${DEEPSEEK_GUARD.maxSystemChars()}`);
console.log(`  maxPromptChars=${DEEPSEEK_GUARD.maxPromptChars()}`);
console.log(`  minGapMs=${DEEPSEEK_GUARD.minGapMs()}`);
console.log(`  minSessionCreateGapMs=${DEEPSEEK_GUARD.minSessionCreateGapMs()}`);
console.log("");

report("3 tools + short sys + hi", claudeTools3, "hi", sysShort);
report("10 tools + short sys + hi", claudeTools10, "hi", sysShort);
report("20 tools + short sys + hi", claudeTools20, "hi", sysShort);
report("3 tools + long sys (~5k) + hi", claudeTools3, "hi", sysLong);
report("3 tools + short sys + download", claudeTools3, "下载 https://example.com/a.md", sysShort);
