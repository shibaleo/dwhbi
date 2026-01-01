/**
 * Repository for MCP document search
 */
import { createClient } from "./supabase";

export interface SearchResult {
  id: string;
  title: string;
  heading: string;
  content: string;
  file_path: string;
  similarity: number;
}

export interface DocumentResult {
  file_path: string;
  title: string;
  tags: string[];
  content: string;
}

export interface TagInfo {
  tag: string;
  count: number;
}

export class DocsRepository {
  async searchChunks(
    queryEmbedding: number[],
    tags: string[] | null,
    limit: number,
    threshold: number
  ): Promise<SearchResult[]> {
    const supabase = createClient();

    const { data, error } = await supabase.rpc("search_chunks", {
      query_embedding: `[${queryEmbedding.join(",")}]`,
      filter_tags: tags,
      match_count: limit,
      similarity_threshold: threshold,
    });

    if (error) {
      throw new Error(`Search failed: ${error.message}`);
    }

    return data || [];
  }

  async getDocument(filePath: string): Promise<DocumentResult | null> {
    const supabase = createClient();

    const { data, error } = await supabase
      .schema("raw")
      .from("docs_github")
      .select("file_path, frontmatter, content")
      .eq("file_path", filePath)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null; // Not found
      throw new Error(`Failed to get document: ${error.message}`);
    }

    const frontmatter = data.frontmatter as Record<string, unknown>;

    return {
      file_path: data.file_path,
      title: (frontmatter?.title as string) || "",
      tags: (frontmatter?.tags as string[]) || [],
      content: data.content,
    };
  }

  async listTags(): Promise<TagInfo[]> {
    const supabase = createClient();

    const { data, error } = await supabase.rpc("list_all_tags");

    if (error) {
      throw new Error(`Failed to list tags: ${error.message}`);
    }

    return data || [];
  }
}
