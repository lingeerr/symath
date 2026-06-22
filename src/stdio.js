#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createSymathServer } from "./server.js";

const server = createSymathServer();
const transport = new StdioServerTransport();

await server.connect(transport);
