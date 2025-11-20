// zaim/get_supabase_user_id.ts
import "https://deno.land/std@0.203.0/dotenv/load.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(supabaseUrl, supabaseKey);

// 全ユーザーを取得（管理者権限）
const { data: { users }, error } = await supabase.auth.admin.listUsers();

if (error) {
  console.error("Error:", error);
  Deno.exit(1);
}

if (users && users.length > 0) {
  console.log("Supabase User ID:", users[0].id);
  console.log("\n環境変数に設定してください:");
  console.log(`export USER_ID="${users[0].id}"`);
} else {
  console.log("ユーザーが見つかりません");
}