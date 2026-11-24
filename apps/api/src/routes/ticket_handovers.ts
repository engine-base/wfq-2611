// 生成物（scripts/ci/contract.mjs gen ← openapi.yaml）。手で直さない。個別の振る舞いは apps/api/src/hooks/<operationId>.ts に書く（op が呼ぶ）
import type { Hono } from "hono";
import type { Vars } from "../middleware/tenant.js";
import { op, type ContractDeps } from "../contract/op.js";

export function register(app: Hono<Vars>, deps: ContractDeps): void {
  app.patch("/api/v1/ticket_handovers/:id", op(deps, "answerTicketHandover"));
  app.post("/api/v1/ticket_handovers/:id/claim", op(deps, "claimTicketHandover"));
  app.post("/api/v1/ticket_handovers/:id/remind", op(deps, "remindTicketHandover"));
  app.post("/api/v1/ticket_handovers/:id/withdraw", op(deps, "withdrawTicketHandover"));
}
