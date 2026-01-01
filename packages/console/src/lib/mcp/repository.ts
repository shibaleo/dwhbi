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

export interface DocSummary {
  file_path: string;
  title: string;
  tags: string[];
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

  async listDocsByTag(
    tag: string,
    limit: number,
    random: boolean
  ): Promise<DocSummary[]> {
    const supabase = createClient();

    let query = supabase
      .schema("raw")
      .from("docs_github")
      .select("file_path, frontmatter")
      .contains("frontmatter->tags", JSON.stringify([tag]));

    if (random) {
      // For random, we fetch more and shuffle client-side
      // This is simpler than using PostgreSQL TABLESAMPLE
      const { data, error } = await query.limit(Math.min(limit * 3, 100));

      if (error) {
        throw new Error(`Failed to list docs by tag: ${error.message}`);
      }

      // Shuffle and take limit
      const shuffled = (data || [])
        .sort(() => Math.random() - 0.5)
        .slice(0, limit);

      return shuffled.map((d) => {
        const frontmatter = d.frontmatter as Record<string, unknown>;
        return {
          file_path: d.file_path,
          title: (frontmatter?.title as string) || "",
          tags: (frontmatter?.tags as string[]) || [],
        };
      });
    } else {
      const { data, error } = await query.limit(limit);

      if (error) {
        throw new Error(`Failed to list docs by tag: ${error.message}`);
      }

      return (data || []).map((d) => {
        const frontmatter = d.frontmatter as Record<string, unknown>;
        return {
          file_path: d.file_path,
          title: (frontmatter?.title as string) || "",
          tags: (frontmatter?.tags as string[]) || [],
        };
      });
    }
  }
}
