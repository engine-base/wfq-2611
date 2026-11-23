// 生成物（scripts/ci/gen_ears_tests.mjs ← 07_qa/test-plan/ears-test-mapping.json・ears-elsewhere.json）。手で直さない。DELETE /api/v1/tickets/:id
// 消すは、作った人か edit・子・孫の扱い・承認の取り下げ・走っている AI の止めで答えが変わる。生成の試験の種ではその組を作れない（K-488）
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("DELETE /api/v1/tickets/:id", () => {
  it("test_delete_tickets_id_ok", () => {
    // EVENT-DRIVEN: WHEN DELETE /api/v1/tickets/:id が「子・孫の扱いを決めて消す／アーカイブする」として呼ばれたとき THEN Kaname は「—」を行い 2xx を返す
    // 本物の試験：apps/api/test/features/F7/ticket-delete.test.ts の「K488-API-001」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F7/ticket-delete.test.ts", "utf8")).toContain("K488-API-001");
  });
  it("test_delete_tickets_id_rejected_401", () => {
    // UNWANTED: IF セッションが無いか失効しているなら、Kaname は 401 を返し入り直しを促す（発行済みトークンの期限に頼らない）
    // 本物の試験：apps/api/test/features/F7/ticket-delete.test.ts の「K488-API-024」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F7/ticket-delete.test.ts", "utf8")).toContain("K488-API-024");
  });
  it("test_delete_tickets_id_rejected_403", () => {
    // UNWANTED: IF 作った人でも編集の権限を持つ人でもない人が消したなら、または一緒に消す子・孫に自分が消せない物があるなら、Kaname は 403 を返し、チケットを何も変えない
    // 本物の試験：apps/api/test/features/F7/ticket-delete.test.ts の「K488-API-003」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F7/ticket-delete.test.ts", "utf8")).toContain("K488-API-003");
  });
  it("test_delete_tickets_id_not_found", () => {
    // UNWANTED: IF 見えない・無い・もう消えたチケットを消したなら、または子の移し先が見つからないなら、Kaname は 404 を返し、チケットを何も変えない
    // 本物の試験：apps/api/test/features/F7/ticket-delete.test.ts の「K488-API-004」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F7/ticket-delete.test.ts", "utf8")).toContain("K488-API-004");
  });
  it("test_delete_tickets_id_rejected_422", () => {
    // UNWANTED: IF 問い合わせの値が契約の値域の外なら、Kaname は 422 を返し、チケットを何も変えない
    // 本物の試験：apps/api/test/features/F7/ticket-delete.test.ts の「K488-API-016」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F7/ticket-delete.test.ts", "utf8")).toContain("K488-API-016");
  });
  it("test_delete_tickets_id_conflict", () => {
    // UNWANTED: IF 子・孫がいるのに扱いを選ばずに消したなら、または移し先が使えないなら、Kaname は 409 を返し、チケットも子も何も変えない
    // 本物の試験：apps/api/test/features/F7/ticket-delete.test.ts の「K488-API-007」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F7/ticket-delete.test.ts", "utf8")).toContain("K488-API-007");
  });
  it("test_delete_tickets_id_session_unresolved", () => {
    // UNWANTED: IF 消す DB の関数か証跡の書き込みが落ちたなら、Kaname は 503 と E-PAGE-003 を返し、何も消さず・取り下げず・止めない
    // 本物の試験：apps/api/test/features/F7/ticket-delete.test.ts の「K488-API-025」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F7/ticket-delete.test.ts", "utf8")).toContain("K488-API-025");
  });
  it("test_delete_tickets_id_rate_limited", () => {
    // UNWANTED: IF 60/min/user を超えたら、Kaname は 429 と retry_after_sec を返す
    // 本物の試験：apps/api/test/features/F7/ticket-delete.test.ts の「K488-API-024」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F7/ticket-delete.test.ts", "utf8")).toContain("K488-API-024");
  });
  it("test_delete_tickets_id_terms_pending", () => {
    // UNWANTED: IF 同意し直しが要るセッションなら、Kaname は 403 と E-AUTH-010 を返し、副作用を起こさない
    // 本物の試験：apps/api/test/features/F1/terms.test.ts の「K53-API-005」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/terms.test.ts", "utf8")).toContain("K53-API-005");
  });
  // 当てはまらない（止めは全部の口で同じ 1 か所の入口（op.ts）。本物のログインで印を立てて止まることは apps/api/test/features/F1/mfa-gate.test.ts の K321-API-001〜011、口ごとの止めは作った口の生成の試験 mfa_pending が見る）：UNWANTED: IF 付けるまで進めないの印が立ったセッションなら、Kaname は 403 と MFA_REQUIRED を返し、副作用を起こさない
  it.todo("test_delete_tickets_id_mfa_pending");
  it("test_delete_tickets_id_session_unresolved_2", () => {
    // UNWANTED: IF 入口でセッションを解く所が落ちたなら、Kaname は 503 と E-PAGE-003 を返し、止める側に倒して副作用を起こさない
    // 本物の試験：apps/api/test/features/contract/k144-contract.test.ts の「K144-API-032」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/contract/k144-contract.test.ts", "utf8")).toContain("K144-API-032");
  });
  it("test_delete_tickets_id_shape", () => {
    // UBIQUITOUS: DELETE /api/v1/tickets/:id の副作用は関門 C2 を経由し、認可 → ポリシー → 承認 → 副作用 → 記録 の順で行う
    // 本物の試験：apps/api/test/features/F7/ticket-delete.test.ts の「K488-API-001」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F7/ticket-delete.test.ts", "utf8")).toContain("K488-API-001");
  });
});
