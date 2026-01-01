import { createClient } from "../../_shared/supabase.ts";

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

export interface DocWithDate {
  file_path: string;
  title: string;
  tags: string[];
  created_date: string;
}

export interface DocWithFrontmatterDate {
  file_path: string;
  title: string;
  tags: string[];
  created_at: string | null;
  updated_at: string | null;
}

export interface PaginatedDocsResult {
  docs: DocSummary[];
  total_count: number;
  has_more: boolean;
}

export interface ContentSearchResult {
  file_path: string;
  title: string;
  tags: string[];
  snippet: string;
}

export async function searchChunks(
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

export async function getDocument(
  filePath: string
): Promise<DocumentResult | null> {
  const supabase = createClient();

  const { data, error } = await supabase
    .schema("raw")
    .from("docs_github")
    .select("file_path, frontmatter, content")
    .eq("file_path", filePath)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
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

export async function listTags(): Promise<TagInfo[]> {
  const supabase = createClient();

  const { data, error } = await supabase.rpc("list_all_tags");

  if (error) {
    throw new Error(`Failed to list tags: ${error.message}`);
  }

  return data || [];
}

export async function listDocsByTag(
  tag: string,
  limit: number,
  random: boolean
): Promise<DocSummary[]> {
  const supabase = createClient();

  const query = supabase
    .schema("raw")
    .from("docs_github")
    .select("file_path, frontmatter")
    .contains("frontmatter->tags", JSON.stringify([tag]));

  if (random) {
    const { data, error } = await query.limit(Math.min(limit * 3, 100));

    if (error) {
      throw new Error(`Failed to list docs by tag: ${error.message}`);
    }

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
  }

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

export async function listDocsByDate(
  sortOrder: "asc" | "desc",
  afterDate: string | null,
  beforeDate: string | null,
  limit: number
): Promise<DocWithDate[]> {
  const supabase = createClient();

  const { data, error } = await supabase.rpc("list_docs_by_date", {
    sort_order: sortOrder,
    after_date: afterDate,
    before_date: beforeDate,
    match_count: limit,
  });

  if (error) {
    throw new Error(`Failed to list docs by date: ${error.message}`);
  }

  return (data || []).map(
    (d: {
      file_path: string;
      title: string | null;
      tags: string[] | null;
      created_date: string;
    }) => ({
      file_path: d.file_path,
      title: d.title || "",
      tags: d.tags || [],
      created_date: d.created_date,
    })
  );
}

export async function listDocsByFrontmatterDate(
  dateField: "created" | "updated",
  sortOrder: "asc" | "desc",
  afterDate: string | null,
  beforeDate: string | null,
  limit: number
): Promise<DocWithFrontmatterDate[]> {
  const supabase = createClient();

  const { data, error } = await supabase.rpc("list_docs_by_frontmatter_date", {
    date_field: dateField,
    sort_order: sortOrder,
    after_date: afterDate,
    before_date: beforeDate,
    match_count: limit,
  });

  if (error) {
    throw new Error(`Failed to list docs by ${dateField}: ${error.message}`);
  }

  return (data || []).map(
    (d: {
      file_path: string;
      title: string | null;
      tags: string[] | null;
      created_at: string | null;
      updated_at: string | null;
    }) => ({
      file_path: d.file_path,
      title: d.title || "",
      tags: d.tags || [],
      created_at: d.created_at,
      updated_at: d.updated_at,
    })
  );
}

export async function searchByTitle(
  query: string,
  limit: number
): Promise<DocSummary[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .schema("raw")
    .from("docs_github")
    .select("file_path, frontmatter")
    .ilike("frontmatter->>title", `%${query}%`)
    .limit(limit);

  if (error) {
    throw new Error(`Failed to search by title: ${error.message}`);
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

export async function listAllDocs(
  offset: number,
  limit: number
): Promise<PaginatedDocsResult> {
  const supabase = createClient();

  const { count, error: countError } = await supabase
    .schema("raw")
    .from("docs_github")
    .select("*", { count: "exact", head: true });

  if (countError) {
    throw new Error(`Failed to count docs: ${countError.message}`);
  }

  const { data, error } = await supabase
    .schema("raw")
    .from("docs_github")
    .select("file_path, frontmatter")
    .order("file_path", { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) {
    throw new Error(`Failed to list docs: ${error.message}`);
  }

  const docs = (data || []).map((d) => {
    const frontmatter = d.frontmatter as Record<string, unknown>;
    return {
      file_path: d.file_path,
      title: (frontmatter?.title as string) || "",
      tags: (frontmatter?.tags as string[]) || [],
    };
  });

  return {
    docs,
    total_count: count || 0,
    has_more: offset + docs.length < (count || 0),
  };
}

export async function searchByKeyword(
  keywords: string[],
  limit: number
): Promise<ContentSearchResult[]> {
  const supabase = createClient();

  const orConditions = keywords.map((k) => `content.ilike.%${k}%`).join(",");

  const { data, error } = await supabase
    .schema("raw")
    .from("docs_github")
    .select("file_path, frontmatter, content")
    .or(orConditions)
    .limit(limit);

  if (error) {
    throw new Error(`Failed to search by keyword: ${error.message}`);
  }

  return (data || []).map((d) => {
    const frontmatter = d.frontmatter as Record<string, unknown>;
    const content = d.content as string;

    const lowerContent = content.toLowerCase();
    let snippet = "";

    for (const keyword of keywords) {
      const lowerKeyword = keyword.toLowerCase();
      const index = lowerContent.indexOf(lowerKeyword);
      if (index !== -1) {
        const start = Math.max(0, index - 50);
        const end = Math.min(content.length, index + keyword.length + 100);
        snippet =
          (start > 0 ? "..." : "") +
          content.slice(start, end).trim() +
          (end < content.length ? "..." : "");
        break;
      }
    }

    return {
      file_path: d.file_path,
      title: (frontmatter?.title as string) || "",
      tags: (frontmatter?.tags as string[]) || [],
      snippet,
    };
  });
}
