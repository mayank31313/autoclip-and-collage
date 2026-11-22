import type { CollageTemplatesResponse } from "@/lib/schemas/api";
import { withApi } from "@/server/http/withApi";
import { getCollageTemplates } from "@/server/templates/collageTemplates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi({ auth: "apiKey" }, async () => {
  const json: CollageTemplatesResponse = { templates: await getCollageTemplates() };
  return { json };
});
