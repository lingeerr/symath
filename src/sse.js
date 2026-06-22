#!/usr/bin/env node

import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { createSymathServer } from "./server.js";

const host = process.env.HOST || "127.0.0.1";
const port = Number.parseInt(process.env.PORT || "3000", 10);
const ssePath = process.env.SSE_PATH || "/mcp";
const messagesPath = process.env.MESSAGES_PATH || "/messages";

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("PORT must be an integer between 1 and 65535");
  process.exit(1);
}

const app = createMcpExpressApp();
const transports = {};

app.get("/health", (_req, res) => {
  res.json({ ok: true, name: "symath-mcp", transport: "sse" });
});

app.get(ssePath, async (_req, res) => {
  try {
    const transport = new SSEServerTransport(messagesPath, res);
    const sessionId = transport.sessionId;
    const server = createSymathServer();

    transports[sessionId] = { transport, server };
    transport.onclose = () => {
      delete transports[sessionId];
      server.close().catch(() => {});
    };

    await server.connect(transport);
  } catch (error) {
    console.error("Error establishing MCP SSE stream:", error);
    if (!res.headersSent) {
      res.status(500).send("Error establishing MCP SSE stream");
    }
  }
});

app.post(messagesPath, async (req, res) => {
  const sessionId = req.query.sessionId;
  if (!sessionId || typeof sessionId !== "string") {
    res.status(400).send("Missing sessionId parameter");
    return;
  }

  const entry = transports[sessionId];
  if (!entry) {
    res.status(404).send("Session not found");
    return;
  }

  try {
    await entry.transport.handlePostMessage(req, res, req.body);
  } catch (error) {
    console.error("Error handling MCP SSE message:", error);
    if (!res.headersSent) {
      res.status(500).send("Error handling request");
    }
  }
});

app.listen(port, host, (error) => {
  if (error) {
    console.error("Failed to start SyMath MCP SSE server:", error);
    process.exit(1);
  }
  console.error(`SyMath MCP SSE listening on http://${host}:${port}${ssePath}`);
});
