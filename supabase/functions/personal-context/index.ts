import { rootApp } from "./app.ts";

Deno.serve((req: Request) => rootApp.fetch(req));
