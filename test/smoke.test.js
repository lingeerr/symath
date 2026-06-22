import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";

const child = spawn(process.execPath, ["src/index.js"], {
  stdio: ["pipe", "pipe", "pipe"],
});

let nextId = 1;
let buffer = "";
const responses = new Map();

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  let newlineIndex;
  while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.id !== undefined) {
      responses.set(message.id, message);
    }
  }
});

function send(method, params = {}) {
  const id = nextId++;
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return waitForResponse(id);
}

async function waitForResponse(id) {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    if (responses.has(id)) {
      const response = responses.get(id);
      responses.delete(id);
      return response;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for response ${id}`);
}

try {
  const init = await send("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "smoke-test", version: "0.0.0" },
  });
  assert.equal(init.result.serverInfo.name, "symath-mcp");

  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);

  const tools = await send("tools/list");
  assert.ok(tools.result.tools.some((tool) => tool.name === "calculate"));

  const calc = await send("tools/call", {
    name: "calculate",
    arguments: {
      expression: "\\frac{1}{3} + \\sqrt{2}",
      precision: 50,
    },
  });
  const calcPayload = JSON.parse(calc.result.content[0].text);
  assert.equal(calcPayload.ok, true);
  assert.match(calcPayload.result, /^1\.747546895706428/);

  const nt = await send("tools/call", {
    name: "number_theory",
    arguments: {
      operation: "modPow",
      values: ["7", "560", "561"],
    },
  });
  const ntPayload = JSON.parse(nt.result.content[0].text);
  assert.equal(ntPayload.result, "1");

  const errorCase = await send("tools/call", {
    name: "arithmetic",
    arguments: {
      operation: "divide",
      values: ["1", "0"],
    },
  });
  const errorPayload = JSON.parse(errorCase.result.content[0].text);
  assert.equal(errorPayload.ok, false);
  assert.match(errorPayload.error.message, /division by zero/);

  const stats = await send("tools/call", {
    name: "statistics",
    arguments: {
      operation: "summary",
      values: ["1", "2", "3", "4"],
    },
  });
  const statsPayload = JSON.parse(stats.result.content[0].text);
  assert.equal(statsPayload.ok, true);
  assert.equal(statsPayload.result.mean, "2.5");
  assert.equal(statsPayload.result.median, "2.5");

  const derivative = await send("tools/call", {
    name: "calculus",
    arguments: {
      operation: "derivative",
      expression: "sin(x)^2 + x^3",
      variable: "x",
    },
  });
  const derivativePayload = JSON.parse(derivative.result.content[0].text);
  assert.equal(derivativePayload.ok, true);
  assert.match(derivativePayload.result, /3 \* x \^ 2/);

  const integral = await send("tools/call", {
    name: "calculus",
    arguments: {
      operation: "integrate",
      expression: "x^2",
      lower: "0",
      upper: "1",
      intervals: 100,
      precision: 40,
    },
  });
  const integralPayload = JSON.parse(integral.result.content[0].text);
  assert.equal(integralPayload.ok, true);
  assert.match(integralPayload.result, /^0\.333333333333333/);

  const latex = await send("tools/call", {
    name: "latex_to_expression",
    arguments: {
      latex: "\\frac{\\sqrt{9}}{3}",
    },
  });
  const latexPayload = JSON.parse(latex.result.content[0].text);
  assert.equal(latexPayload.ok, true);
  assert.equal(latexPayload.expression, "((sqrt(9)) / (3))");
} finally {
  child.kill();
  await once(child, "exit").catch(() => {});
}
