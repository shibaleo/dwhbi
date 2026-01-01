/**
 * Voyage AI embedding client for MCP query embedding
 */
import { VoyageAIClient } from "voyageai";

const MODEL = "voyage-3-lite";

export class QueryEmbedder {
  private client: VoyageAIClient;

  constructor(apiKey: string) {
    this.client = new VoyageAIClient({ apiKey });
  }

  async embedQuery(text: string): Promise<number[]> {
    const response = await this.client.embed({
      input: [text],
      model: MODEL,
      inputType: "query", // Important: use "query" for search queries, not "document"
    });

    const embedding = response.data?.[0]?.embedding;
    if (!embedding) {
      throw new Error("Failed to generate embedding");
    }

    return embedding;
  }
}
