import { handleV1Request } from "./v1/handler.ts";
import { rootApp } from "./v2/app.ts";

const USE_V2 = true;

Deno.serve(async (req: Request) => {
  if (USE_V2) {
    return rootApp.fetch(req);
  }
  return handleV1Request(req);
});
