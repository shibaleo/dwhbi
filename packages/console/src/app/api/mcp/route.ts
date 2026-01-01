/**
 * MCP API Route - Streamable HTTP transport for MCP server
 * Uses Web Standard APIs compatible with Next.js App Router
 */
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { NextRequest, NextResponse } from "next/server";

import { createMcpServer } from "@/lib/mcp/server";
import { getVoyageConfig } from "@/lib/vault";

// Session storage for MCP connections
const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>();

async function getOrCreateTransport(
  sessionId: string | null,
  voyageApiKey: string
): Promise<{ transport: WebStandardStreamableHTTPServerTransport; isNew: boolean }> {
  // Check for existing session
  if (sessionId && sessions.has(sessionId)) {
    return { transport: sessions.get(sessionId)!, isNew: false };
  }

  // Create new transport
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    onsessioninitialized: (id) => {
      sessions.set(id, transport);
    },
    onsessionclosed: (id) => {
      sessions.delete(id);
    },
    enableJsonResponse: true, // Simpler for initial implementation
  });

  // Create and connect MCP server
  const server = createMcpServer(voyageApiKey);

  // Handle transport close
  transport.onclose = () => {
    if (transport.sessionId) {
      sessions.delete(transport.sessionId);
    }
  };

  await server.connect(transport);

  return { transport, isNew: true };
}

export async function POST(request: NextRequest) {
  // Get Voyage API key from vault
  const voyageConfig = await getVoyageConfig();
  if (!voyageConfig?.api_key) {
    return NextResponse.json(
      { error: "Voyage AI not configured. Please configure it in settings." },
      { status: 500 }
    );
  }

  try {
    const sessionId = request.headers.get("mcp-session-id");
    const { transport } = await getOrCreateTransport(sessionId, voyageConfig.api_key);

    // Convert NextRequest to standard Request and handle
    const response = await transport.handleRequest(request as unknown as Request);

    return response;
  } catch (error) {
    console.error("MCP POST error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  // Get Voyage API key from vault
  const voyageConfig = await getVoyageConfig();
  if (!voyageConfig?.api_key) {
    return NextResponse.json(
      { error: "Voyage AI not configured. Please configure it in settings." },
      { status: 500 }
    );
  }

  try {
    const sessionId = request.headers.get("mcp-session-id");

    // If session exists, handle SSE stream
    if (sessionId && sessions.has(sessionId)) {
      const transport = sessions.get(sessionId)!;
      const response = await transport.handleRequest(request as unknown as Request);
      return response;
    }

    // Otherwise return server info
    return NextResponse.json({
      status: "ok",
      mcp: {
        name: "personal-knowledge",
        version: "1.0.0",
        configured: true,
        tools: ["search_docs", "get_doc", "list_tags"],
      },
    });
  } catch (error) {
    console.error("MCP GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const sessionId = request.headers.get("mcp-session-id");

  if (sessionId && sessions.has(sessionId)) {
    const transport = sessions.get(sessionId)!;
    const response = await transport.handleRequest(request as unknown as Request);
    return response;
  }

  return NextResponse.json({ error: "Session not found" }, { status: 404 });
}
