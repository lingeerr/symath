# SyMath MCP

SyMath MCP is a high-precision mathematics server for MCP clients. It gives LLMs a reliable calculator layer for exact integer work, configurable decimal precision, symbolic derivatives and simplification, numerical calculus, statistics, number theory, and common LaTeX-style math input.

## Features

- High-precision expression evaluation powered by `mathjs` BigNumber mode.
- Common LaTeX normalization, including `\frac{}`, `\sqrt{}`, trig/log functions, `\pi`, `\cdot`, and braced powers.
- Dedicated tools for arithmetic, statistics, number theory, and calculus.
- Symbolic derivative and simplification support.
- Exact integer algorithms using `BigInt` for gcd, lcm, prime checks, factorization, modular exponentiation, and modular inverse.
- Structured errors for edge cases such as division by zero, invalid domains, malformed LaTeX, and non-integer number theory input.
- Official MCP transports:
  - `stdio` for local desktop clients.
  - Streamable HTTP at `/mcp` for remote or local HTTP clients.
  - Legacy HTTP+SSE for older clients that have not migrated yet.

## Install

```bash
npm install
```

After npm publication, users can run it without cloning:

```bash
npx symath-mcp
```

## Run Locally

### stdio

Use this for Claude Desktop and other local MCP clients that launch a command.

```bash
npm start
```

Equivalent direct command:

```bash
node /Users/fengling/AiProjects/symath/src/stdio.js
```

### Streamable HTTP

Use this for clients that connect to an MCP URL.

```bash
npm run start:http
```

Defaults:

- URL: `http://127.0.0.1:3000/mcp`
- Health check: `http://127.0.0.1:3000/health`

Configuration:

```bash
HOST=0.0.0.0 PORT=3000 MCP_PATH=/mcp npm run start:http
```

### Legacy SSE

SSE is deprecated by the MCP SDK, but some older clients still support it.

```bash
npm run start:sse
```

Defaults:

- SSE endpoint: `http://127.0.0.1:3000/mcp`
- Messages endpoint: `http://127.0.0.1:3000/messages`

Configuration:

```bash
HOST=0.0.0.0 PORT=3000 SSE_PATH=/mcp MESSAGES_PATH=/messages npm run start:sse
```

## Client Configuration

### Claude Desktop, local clone

Add this to Claude Desktop's MCP configuration and restart Claude Desktop:

```json
{
  "mcpServers": {
    "symath": {
      "command": "node",
      "args": ["/Users/fengling/AiProjects/symath/src/stdio.js"]
    }
  }
}
```

### Claude Desktop, after npm publication

```json
{
  "mcpServers": {
    "symath": {
      "command": "npx",
      "args": ["-y", "symath-mcp"]
    }
  }
}
```

### MCP clients with Streamable HTTP support

Start the HTTP server:

```bash
npm run start:http
```

Then configure the client URL:

```text
http://127.0.0.1:3000/mcp
```

For a remote deployment, replace the URL with your public HTTPS endpoint, for example:

```text
https://your-domain.example/mcp
```

### Older SSE clients

Start the SSE server:

```bash
npm run start:sse
```

Configure:

```text
SSE URL:      http://127.0.0.1:3000/mcp
Messages URL: http://127.0.0.1:3000/messages
```

## Publish

### GitHub

```bash
git add .
git commit -m "Support all MCP transports"
git push
```

### npm

Log in once:

```bash
npm login
```

Publish:

```bash
npm publish --access public
```

Package binaries:

- `symath-mcp`: stdio server.
- `symath-mcp-http`: Streamable HTTP server.
- `symath-mcp-sse`: legacy SSE server.

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
node --check src/server.js
node --check src/stdio.js
node --check src/http.js
node --check src/sse.js
```
