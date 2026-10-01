import { route } from "@/server/http/route";
import { exportInput, exportSubject } from "@/server/privacy/subjects";

/** Access request: the data held about the visitor as `{ filename, mime, content }`; recorded in the request history. */
export const POST = route({ permission: "visitors.privacy", body: exportInput }, ({ actor, params, body }) =>
  exportSubject(actor, params.id, body),
);
