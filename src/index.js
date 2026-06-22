#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { all, create } from "mathjs";
import { z } from "zod";

const DEFAULT_PRECISION = 64;
const MAX_PRECISION = 512;
const MAX_ARRAY_LENGTH = 10000;

const baseMath = create(all, {
  number: "BigNumber",
  precision: DEFAULT_PRECISION,
});

baseMath.import(
  {
    import: () => {
      throw new Error("import is disabled");
    },
    createUnit: () => {
      throw new Error("createUnit is disabled");
    },
    evaluate: () => {
      throw new Error("nested evaluate is disabled");
    },
    parse: () => {
      throw new Error("parse is disabled inside expressions");
    },
    simplify: () => {
      throw new Error("simplify is disabled inside expressions");
    },
    derivative: () => {
      throw new Error("derivative is disabled inside expressions");
    },
  },
  { override: true },
);

function createMath(precision = DEFAULT_PRECISION) {
  return create(all, {
    number: "BigNumber",
    precision: clampPrecision(precision),
  });
}

function clampPrecision(precision) {
  if (!Number.isInteger(precision) || precision < 1 || precision > MAX_PRECISION) {
    throw new UserFacingError(`precision must be an integer between 1 and ${MAX_PRECISION}`);
  }
  return precision;
}

class UserFacingError extends Error {
  constructor(message) {
    super(message);
    this.name = "MathInputError";
  }
}

function resultText(payload) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

async function withErrors(fn) {
  try {
    return resultText({
      ok: true,
      ...fn(),
    });
  } catch (error) {
    return resultText({
      ok: false,
      error: {
        type: error.name || "Error",
        message: sanitizeError(error.message),
      },
    });
  }
}

function sanitizeError(message) {
  return String(message || "Unknown error").replace(/\s+/g, " ").trim();
}

function formatMathValue(math, value, format = "auto") {
  if (Array.isArray(value)) {
    return value.map((item) => formatMathValue(math, item, format));
  }

  if (math.typeOf(value) === "Matrix") {
    return value.toArray().map((item) => formatMathValue(math, item, format));
  }

  if (math.typeOf(value) === "Complex") {
    return value.toString();
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : String(value);
  }

  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value.toString === "function") {
    if (format === "fixed" && typeof value.toFixed === "function") {
      return trimTrailingZeros(value.toFixed());
    }
    if (format === "scientific" && typeof value.toExponential === "function") {
      return value.toExponential();
    }
    return value.toString();
  }

  return String(value);
}

function trimTrailingZeros(value) {
  return value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

function normalizeExpression(input, inputFormat = "auto") {
  const expression = String(input || "").trim();
  if (!expression) {
    throw new UserFacingError("expression cannot be empty");
  }

  if (inputFormat === "mathjs") {
    return expression;
  }

  if (inputFormat === "latex" || /\\(?:frac|sqrt|sin|cos|tan|log|ln|pi|cdot|times|left|right)/.test(expression)) {
    return latexToMathExpression(expression);
  }

  return expression;
}

function latexToMathExpression(source) {
  let expression = stripLatexDelimiters(String(source).trim());
  expression = expression.replace(/\\left/g, "").replace(/\\right/g, "");
  expression = expression.replace(/\s+/g, " ");

  expression = replaceLatexCommandWithTwoArgs(expression, "frac", (a, b) => `((${latexToMathExpression(a)}) / (${latexToMathExpression(b)}))`);
  expression = replaceLatexCommandWithOneArg(expression, "sqrt", (a) => `sqrt(${latexToMathExpression(a)})`);

  expression = expression
    .replace(/\\cdot|\\times/g, "*")
    .replace(/\\div/g, "/")
    .replace(/\\pi/g, "pi")
    .replace(/\\e(?![a-zA-Z])/g, "e")
    .replace(/\\ln\b/g, "log")
    .replace(/\\log\b/g, "log10")
    .replace(/\\sin\b/g, "sin")
    .replace(/\\cos\b/g, "cos")
    .replace(/\\tan\b/g, "tan")
    .replace(/\\asin\b/g, "asin")
    .replace(/\\acos\b/g, "acos")
    .replace(/\\atan\b/g, "atan")
    .replace(/\\sinh\b/g, "sinh")
    .replace(/\\cosh\b/g, "cosh")
    .replace(/\\tanh\b/g, "tanh")
    .replace(/\\exp\b/g, "exp")
    .replace(/\{/g, "(")
    .replace(/\}/g, ")")
    .replace(/\^\(([^()]+)\)/g, "^($1)");

  return expression.trim();
}

function stripLatexDelimiters(value) {
  return value
    .replace(/^\$\$(.*)\$\$$/s, "$1")
    .replace(/^\$(.*)\$$/s, "$1")
    .replace(/^\\\[(.*)\\\]$/s, "$1")
    .replace(/^\\\((.*)\\\)$/s, "$1");
}

function replaceLatexCommandWithOneArg(expression, command, build) {
  let cursor = 0;
  let output = "";
  const needle = `\\${command}`;

  while (cursor < expression.length) {
    const index = expression.indexOf(needle, cursor);
    if (index === -1) {
      output += expression.slice(cursor);
      break;
    }

    output += expression.slice(cursor, index);
    const argStart = skipSpaces(expression, index + needle.length);
    const parsed = readBracedGroup(expression, argStart);
    output += build(parsed.value);
    cursor = parsed.end;
  }

  return output;
}

function replaceLatexCommandWithTwoArgs(expression, command, build) {
  let cursor = 0;
  let output = "";
  const needle = `\\${command}`;

  while (cursor < expression.length) {
    const index = expression.indexOf(needle, cursor);
    if (index === -1) {
      output += expression.slice(cursor);
      break;
    }

    output += expression.slice(cursor, index);
    const firstStart = skipSpaces(expression, index + needle.length);
    const first = readBracedGroup(expression, firstStart);
    const secondStart = skipSpaces(expression, first.end);
    const second = readBracedGroup(expression, secondStart);
    output += build(first.value, second.value);
    cursor = second.end;
  }

  return output;
}

function skipSpaces(expression, index) {
  while (index < expression.length && /\s/.test(expression[index])) {
    index += 1;
  }
  return index;
}

function readBracedGroup(expression, start) {
  if (expression[start] !== "{") {
    throw new UserFacingError("expected a braced LaTeX group");
  }

  let depth = 0;
  for (let index = start; index < expression.length; index += 1) {
    const char = expression[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return {
          value: expression.slice(start + 1, index),
          end: index + 1,
        };
      }
    }
  }

  throw new UserFacingError("unclosed LaTeX brace group");
}

function evaluateExpression({ expression, inputFormat = "auto", precision = DEFAULT_PRECISION, format = "auto" }) {
  const math = createMath(precision);
  const normalized = normalizeExpression(expression, inputFormat);
  const node = math.parse(normalized);
  validateExpressionNode(node);
  const value = node.evaluate({});
  return {
    expression: normalized,
    result: formatMathValue(math, value, format),
    precision: clampPrecision(precision),
  };
}

function validateExpressionNode(node) {
  const blocked = new Set(["import", "createUnit", "evaluate", "parse", "simplify", "derivative"]);
  node.traverse((child) => {
    if (child.isFunctionNode && blocked.has(child.name)) {
      throw new UserFacingError(`function "${child.name}" is not allowed in calculate`);
    }
  });
}

function arithmeticOperation({ operation, values, precision, format }) {
  const math = createMath(precision);
  if (!Array.isArray(values) || values.length === 0) {
    throw new UserFacingError("values must contain at least one operand");
  }

  const nums = values.map((value) => math.bignumber(String(value)));
  let result;

  switch (operation) {
    case "add":
      result = nums.reduce((sum, value) => math.add(sum, value), math.bignumber(0));
      break;
    case "subtract":
      requireOperandCount(nums, 2, "subtract");
      result = nums.slice(1).reduce((acc, value) => math.subtract(acc, value), nums[0]);
      break;
    case "multiply":
      result = nums.reduce((product, value) => math.multiply(product, value), math.bignumber(1));
      break;
    case "divide":
      requireOperandCount(nums, 2, "divide");
      ensureNoZeroDivisors(math, nums.slice(1));
      result = nums.slice(1).reduce((acc, value) => math.divide(acc, value), nums[0]);
      break;
    case "power":
      requireOperandCount(nums, 2, "power");
      result = math.pow(nums[0], nums[1]);
      break;
    case "sqrt":
      requireOperandCount(nums, 1, "sqrt");
      if (math.smaller(nums[0], 0)) {
        throw new UserFacingError("sqrt is undefined for negative real inputs");
      }
      result = math.sqrt(nums[0]);
      break;
    default:
      throw new UserFacingError(`unsupported arithmetic operation "${operation}"`);
  }

  return {
    operation,
    result: formatMathValue(math, result, format),
    precision: clampPrecision(precision),
  };
}

function requireOperandCount(values, minimum, operation) {
  if (values.length < minimum) {
    throw new UserFacingError(`${operation} requires at least ${minimum} operand(s)`);
  }
}

function ensureNoZeroDivisors(math, divisors) {
  for (const divisor of divisors) {
    if (math.equal(divisor, 0)) {
      throw new UserFacingError("division by zero");
    }
  }
}

function statisticsOperation({ operation, values, precision, format, sample = false, percentile }) {
  const math = createMath(precision);
  validateNumericArray(values);
  const nums = values.map((value) => math.bignumber(String(value))).sort((a, b) => Number(math.compare(a, b)));

  let result;
  switch (operation) {
    case "count":
      result = nums.length;
      break;
    case "sum":
      result = nums.reduce((sum, value) => math.add(sum, value), math.bignumber(0));
      break;
    case "mean":
      result = mean(math, nums);
      break;
    case "median":
      result = median(math, nums);
      break;
    case "min":
      result = nums[0];
      break;
    case "max":
      result = nums[nums.length - 1];
      break;
    case "range":
      result = math.subtract(nums[nums.length - 1], nums[0]);
      break;
    case "variance":
      result = variance(math, nums, sample);
      break;
    case "stddev":
      result = math.sqrt(variance(math, nums, sample));
      break;
    case "percentile":
      result = percentileValue(math, nums, percentile);
      break;
    case "summary":
      result = {
        count: nums.length,
        sum: formatMathValue(math, nums.reduce((sum, value) => math.add(sum, value), math.bignumber(0)), format),
        mean: formatMathValue(math, mean(math, nums), format),
        median: formatMathValue(math, median(math, nums), format),
        min: formatMathValue(math, nums[0], format),
        max: formatMathValue(math, nums[nums.length - 1], format),
        variance: formatMathValue(math, variance(math, nums, sample), format),
        stddev: formatMathValue(math, math.sqrt(variance(math, nums, sample)), format),
      };
      break;
    default:
      throw new UserFacingError(`unsupported statistics operation "${operation}"`);
  }

  return {
    operation,
    sample,
    result: typeof result === "object" && !math.isBigNumber(result) ? result : formatMathValue(math, result, format),
    precision: clampPrecision(precision),
  };
}

function validateNumericArray(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new UserFacingError("values must contain at least one number");
  }
  if (values.length > MAX_ARRAY_LENGTH) {
    throw new UserFacingError(`values cannot contain more than ${MAX_ARRAY_LENGTH} items`);
  }
}

function mean(math, values) {
  return math.divide(
    values.reduce((sum, value) => math.add(sum, value), math.bignumber(0)),
    values.length,
  );
}

function median(math, values) {
  const middle = Math.floor(values.length / 2);
  if (values.length % 2 === 1) {
    return values[middle];
  }
  return math.divide(math.add(values[middle - 1], values[middle]), 2);
}

function variance(math, values, sample) {
  if (sample && values.length < 2) {
    throw new UserFacingError("sample variance requires at least two values");
  }

  const avg = mean(math, values);
  const squaredDistanceSum = values.reduce((sum, value) => {
    const diff = math.subtract(value, avg);
    return math.add(sum, math.multiply(diff, diff));
  }, math.bignumber(0));
  return math.divide(squaredDistanceSum, sample ? values.length - 1 : values.length);
}

function percentileValue(math, values, percentile) {
  if (typeof percentile !== "number" || percentile < 0 || percentile > 100) {
    throw new UserFacingError("percentile must be a number between 0 and 100");
  }

  if (values.length === 1) {
    return values[0];
  }

  const rank = (percentile / 100) * (values.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  const weight = math.bignumber(String(rank - low));
  return math.add(values[low], math.multiply(math.subtract(values[high], values[low]), weight));
}

function numberTheoryOperation({ operation, values }) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new UserFacingError("values must contain at least one integer");
  }

  const ints = values.map(parseBigIntStrict);
  let result;

  switch (operation) {
    case "gcd":
      result = ints.reduce((acc, value) => gcd(acc, value));
      break;
    case "lcm":
      result = ints.reduce((acc, value) => lcm(acc, value));
      break;
    case "isPrime":
      requireOperandCount(ints, 1, "isPrime");
      result = isPrime(ints[0]);
      break;
    case "primeFactors":
      requireOperandCount(ints, 1, "primeFactors");
      result = primeFactors(ints[0]).map((value) => value.toString());
      break;
    case "modPow":
      requireExactOperandCount(ints, 3, "modPow");
      result = modPow(ints[0], ints[1], ints[2]);
      break;
    case "modInverse":
      requireExactOperandCount(ints, 2, "modInverse");
      result = modInverse(ints[0], ints[1]);
      break;
    case "totient":
      requireOperandCount(ints, 1, "totient");
      result = totient(ints[0]);
      break;
    default:
      throw new UserFacingError(`unsupported number theory operation "${operation}"`);
  }

  return {
    operation,
    result: typeof result === "bigint" ? result.toString() : result,
  };
}

function parseBigIntStrict(value) {
  const text = String(value).trim();
  if (!/^-?\d+$/.test(text)) {
    throw new UserFacingError(`"${value}" is not an integer`);
  }
  return BigInt(text);
}

function requireExactOperandCount(values, count, operation) {
  if (values.length !== count) {
    throw new UserFacingError(`${operation} requires exactly ${count} operand(s)`);
  }
}

function absBigInt(value) {
  return value < 0n ? -value : value;
}

function gcd(a, b) {
  a = absBigInt(a);
  b = absBigInt(b);
  while (b !== 0n) {
    [a, b] = [b, a % b];
  }
  return a;
}

function lcm(a, b) {
  if (a === 0n || b === 0n) {
    return 0n;
  }
  return absBigInt((a / gcd(a, b)) * b);
}

function isPrime(value) {
  const n = absBigInt(value);
  if (n < 2n) return false;
  if (n === 2n || n === 3n) return true;
  if (n % 2n === 0n || n % 3n === 0n) return false;

  for (let divisor = 5n; divisor * divisor <= n; divisor += 6n) {
    if (n % divisor === 0n || n % (divisor + 2n) === 0n) {
      return false;
    }
  }

  return true;
}

function primeFactors(value) {
  let n = absBigInt(value);
  if (n < 2n) {
    throw new UserFacingError("primeFactors requires an integer with absolute value >= 2");
  }

  const factors = [];
  while (n % 2n === 0n) {
    factors.push(2n);
    n /= 2n;
  }

  for (let divisor = 3n; divisor * divisor <= n; divisor += 2n) {
    while (n % divisor === 0n) {
      factors.push(divisor);
      n /= divisor;
    }
  }

  if (n > 1n) {
    factors.push(n);
  }

  return factors;
}

function modPow(base, exponent, modulus) {
  if (modulus === 0n) {
    throw new UserFacingError("modPow modulus cannot be zero");
  }
  if (exponent < 0n) {
    throw new UserFacingError("modPow exponent must be non-negative");
  }

  let result = 1n;
  let currentBase = ((base % modulus) + modulus) % modulus;
  let currentExponent = exponent;

  while (currentExponent > 0n) {
    if (currentExponent % 2n === 1n) {
      result = (result * currentBase) % modulus;
    }
    currentBase = (currentBase * currentBase) % modulus;
    currentExponent /= 2n;
  }

  return ((result % modulus) + modulus) % modulus;
}

function extendedGcd(a, b) {
  let oldR = a;
  let r = b;
  let oldS = 1n;
  let s = 0n;
  let oldT = 0n;
  let t = 1n;

  while (r !== 0n) {
    const quotient = oldR / r;
    [oldR, r] = [r, oldR - quotient * r];
    [oldS, s] = [s, oldS - quotient * s];
    [oldT, t] = [t, oldT - quotient * t];
  }

  return { gcd: oldR, x: oldS, y: oldT };
}

function modInverse(value, modulus) {
  if (modulus === 0n) {
    throw new UserFacingError("modInverse modulus cannot be zero");
  }
  const result = extendedGcd(value, modulus);
  if (absBigInt(result.gcd) !== 1n) {
    throw new UserFacingError("modular inverse does not exist because values are not coprime");
  }
  return ((result.x % modulus) + modulus) % modulus;
}

function totient(value) {
  let n = absBigInt(value);
  if (n === 0n) {
    throw new UserFacingError("totient is undefined for zero");
  }

  let result = n;
  let divisor = 2n;
  while (divisor * divisor <= n) {
    if (n % divisor === 0n) {
      while (n % divisor === 0n) {
        n /= divisor;
      }
      result -= result / divisor;
    }
    divisor = divisor === 2n ? 3n : divisor + 2n;
  }

  if (n > 1n) {
    result -= result / n;
  }

  return result;
}

function calculusOperation({ operation, expression, variable = "x", precision, inputFormat = "auto", lower, upper, intervals = 1000, format }) {
  const math = createMath(precision);
  const normalized = normalizeExpression(expression, inputFormat);

  switch (operation) {
    case "derivative": {
      const derivative = math.derivative(normalized, variable);
      return {
        operation,
        expression: normalized,
        variable,
        result: derivative.toString(),
        latex: derivative.toTex(),
      };
    }
    case "simplify": {
      const simplified = math.simplify(normalized);
      return {
        operation,
        expression: normalized,
        result: simplified.toString(),
        latex: simplified.toTex(),
      };
    }
    case "integrate": {
      if (lower === undefined || upper === undefined) {
        throw new UserFacingError("integrate requires lower and upper bounds");
      }
      const value = integrateSimpson(math, normalized, variable, lower, upper, intervals);
      return {
        operation,
        expression: normalized,
        variable,
        lower: String(lower),
        upper: String(upper),
        result: formatMathValue(math, value, format),
        precision: clampPrecision(precision),
      };
    }
    default:
      throw new UserFacingError(`unsupported calculus operation "${operation}"`);
  }
}

function integrateSimpson(math, expression, variable, lower, upper, intervals) {
  if (!Number.isInteger(intervals) || intervals < 2 || intervals > 100000) {
    throw new UserFacingError("intervals must be an integer between 2 and 100000");
  }
  if (intervals % 2 === 1) {
    intervals += 1;
  }

  const node = math.parse(expression);
  validateExpressionNode(node);
  const code = node.compile();
  const a = math.bignumber(String(lower));
  const b = math.bignumber(String(upper));
  const n = math.bignumber(intervals);
  const h = math.divide(math.subtract(b, a), n);

  let sum = math.add(evaluateCompiledAt(math, code, variable, a), evaluateCompiledAt(math, code, variable, b));

  for (let index = 1; index < intervals; index += 1) {
    const x = math.add(a, math.multiply(h, index));
    const fx = evaluateCompiledAt(math, code, variable, x);
    sum = math.add(sum, math.multiply(index % 2 === 0 ? 2 : 4, fx));
  }

  return math.multiply(math.divide(h, 3), sum);
}

function evaluateCompiledAt(math, code, variable, value) {
  const result = code.evaluate({ [variable]: value });
  if (math.typeOf(result) === "Complex") {
    throw new UserFacingError("integral produced a complex value; real-valued integration is required");
  }
  return result;
}

const server = new McpServer({
  name: "symath-mcp",
  version: "0.1.0",
});

const precisionSchema = z.number().int().min(1).max(MAX_PRECISION).default(DEFAULT_PRECISION);
const formatSchema = z.enum(["auto", "fixed", "scientific"]).default("auto");
const expressionFormatSchema = z.enum(["auto", "mathjs", "latex"]).default("auto");

server.registerTool(
  "calculate",
  {
    title: "High precision expression calculator",
    description: "Evaluate a mathjs or common LaTeX math expression with configurable high precision.",
    inputSchema: {
      expression: z.string().min(1).describe("Expression to evaluate. Supports mathjs syntax and common LaTeX such as \\frac and \\sqrt."),
      inputFormat: expressionFormatSchema.describe("Input expression format."),
      precision: precisionSchema.describe("Decimal precision in significant digits."),
      format: formatSchema.describe("Output numeric format."),
    },
  },
  async (input) => withErrors(() => evaluateExpression(input)),
);

server.registerTool(
  "arithmetic",
  {
    title: "Basic high precision arithmetic",
    description: "Perform add, subtract, multiply, divide, power, and sqrt with explicit operands.",
    inputSchema: {
      operation: z.enum(["add", "subtract", "multiply", "divide", "power", "sqrt"]),
      values: z.array(z.union([z.string(), z.number()])).min(1).describe("Operands. Strings are recommended for very large or precise numbers."),
      precision: precisionSchema,
      format: formatSchema,
    },
  },
  async (input) => withErrors(() => arithmeticOperation(input)),
);

server.registerTool(
  "statistics",
  {
    title: "High precision statistics",
    description: "Compute count, sum, mean, median, min, max, range, variance, standard deviation, percentile, or summary.",
    inputSchema: {
      operation: z.enum(["count", "sum", "mean", "median", "min", "max", "range", "variance", "stddev", "percentile", "summary"]),
      values: z.array(z.union([z.string(), z.number()])).min(1),
      sample: z.boolean().default(false).describe("Use sample variance/stddev denominator n-1."),
      percentile: z.number().min(0).max(100).optional().describe("Required when operation is percentile."),
      precision: precisionSchema,
      format: formatSchema,
    },
  },
  async (input) => withErrors(() => statisticsOperation(input)),
);

server.registerTool(
  "number_theory",
  {
    title: "Exact number theory",
    description: "Run exact integer operations using BigInt.",
    inputSchema: {
      operation: z.enum(["gcd", "lcm", "isPrime", "primeFactors", "modPow", "modInverse", "totient"]),
      values: z.array(z.union([z.string(), z.number()])).min(1).describe("Integer operands. Use strings for large integers."),
    },
  },
  async (input) => withErrors(() => numberTheoryOperation(input)),
);

server.registerTool(
  "calculus",
  {
    title: "Calculus and symbolic algebra",
    description: "Differentiate symbolically, simplify symbolically, or compute definite integrals numerically with Simpson's rule.",
    inputSchema: {
      operation: z.enum(["derivative", "simplify", "integrate"]),
      expression: z.string().min(1),
      variable: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).default("x"),
      inputFormat: expressionFormatSchema,
      lower: z.union([z.string(), z.number()]).optional().describe("Lower bound for definite integration."),
      upper: z.union([z.string(), z.number()]).optional().describe("Upper bound for definite integration."),
      intervals: z.number().int().min(2).max(100000).default(1000).describe("Simpson intervals. Odd values are rounded up to the next even value."),
      precision: precisionSchema,
      format: formatSchema,
    },
  },
  async (input) => withErrors(() => calculusOperation(input)),
);

server.registerTool(
  "latex_to_expression",
  {
    title: "LaTeX to math expression converter",
    description: "Convert supported LaTeX math syntax into a mathjs-compatible expression.",
    inputSchema: {
      latex: z.string().min(1),
    },
  },
  async ({ latex }) => withErrors(() => ({
    expression: latexToMathExpression(latex),
  })),
);

const transport = new StdioServerTransport();
await server.connect(transport);
