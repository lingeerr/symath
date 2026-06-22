# SyMath MCP

SyMath MCP is a high-precision mathematics server for MCP clients such as Claude Desktop. It gives LLMs a reliable calculator layer for exact integer work, configurable decimal precision, symbolic derivatives/simplification, numerical calculus, statistics, number theory, and common LaTeX-style math input.

## Features

- High-precision expression evaluation powered by `mathjs` BigNumber mode.
- Common LaTeX normalization, including `\frac{}`, `\sqrt{}`, trig/log functions, `\pi`, `\cdot`, and braced powers.
- Dedicated tools for arithmetic, statistics, number theory, and calculus.
- Symbolic derivative and simplification support.
- Exact integer algorithms using `BigInt` for gcd, lcm, prime checks, factorization, modular exponentiation, and modular inverse.
- Structured errors for edge cases such as division by zero, invalid domains, malformed LaTeX, and non-integer number theory input.

## Install

```bash
npm install
```

## Run

```bash
npm start
```

The server uses MCP over stdio, so it is meant to be launched by an MCP client.

## Claude Desktop Configuration

Add this to your Claude Desktop MCP configuration:

```json
{
  "mcpServers": {
    "symath": {
      "command": "node",
      "args": ["/Users/fengling/AiProjects/symath/src/index.js"]
    }
  }
}
```

Restart Claude Desktop after saving the configuration.

## Tools

- `calculate`: Evaluate a math expression or common LaTeX expression at configurable precision.
- `arithmetic`: Run basic arithmetic operations with explicit operands.
- `statistics`: Compute descriptive statistics over numeric data.
- `number_theory`: Run exact integer operations such as gcd, lcm, primality, factorization, modular exponentiation, modular inverse, and Euler totient.
- `calculus`: Differentiate symbolically, simplify symbolically, or compute a definite integral numerically.
- `latex_to_expression`: Convert supported LaTeX math syntax to a `mathjs` expression.

## Examples

```json
{
  "expression": "\\frac{1}{3} + \\sqrt{2}",
  "precision": 80
}
```

```json
{
  "operation": "modPow",
  "values": ["7", "560", "561"]
}
```

```json
{
  "operation": "derivative",
  "expression": "sin(x)^2 + x^3",
  "variable": "x"
}
```

## Test

```bash
npm test
```
