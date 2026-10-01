import { route } from "@/server/http/route";
import { eraseSubject, erasureInput } from "@/server/privacy/subjects";

/** Erasure request: anonymises the visitor now and switches their notifications off. Needs a reason and `confirm: true`. */
export const POST = route({ permission: "visitors.privacy", body: erasureInput }, ({ actor, params, body }) =>
  eraseSubject(actor, params.id, body),
);
