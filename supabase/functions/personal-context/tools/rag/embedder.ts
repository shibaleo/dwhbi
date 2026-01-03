import { createClient } from "@supabase/supabase-js";

const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const MODEL = "voyage-3-lite";

function getSupabaseClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  return createClient(supabaseUrl, supabaseKey);
}

async function getVoyageApiKey(): Promise<string> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .schema("console")
    .rpc("get_service_secret", { service_name: "voyage" });

  if (error || !data?.api_key) {
    throw new Error("Voyage API key not found in vault");
  }

  return data.api_key;
}

export async function embedQuery(text: string): Promise<number[]> {
  const apiKey = await getVoyageApiKey();

  const response = await fetch(VOYAGE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: [text],
      model: MODEL,
      input_type: "query",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Voyage API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  const embedding = data.data?.[0]?.embedding;

  if (!embedding) {
    throw new Error("Failed to generate embedding");
  }

  return embedding;
}
