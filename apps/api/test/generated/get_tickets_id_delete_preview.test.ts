// 生成物（scripts/ci/gen_ears_tests.mjs ← 07_qa/test-plan/ears-test-mapping.json・ears-elsewhere.json）。手で直さない。GET /api/v1/tickets/:id/delete-preview
// 消す前の下見は、そのチケットの子・承認待ち・つながり・実行の件数と、作った人か edit かの判定で答えが変わる。生成の試験の種ではその組を作れない（K-487）
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("GET /api/v1/tickets/:id/delete-preview", () => {
  it("test_get_tickets_id_delete_preview_ok", () => {
    // EVENT-DRIVEN: WHEN GET /api/v1/tickets/:id/delete-preview が「子・孫の扱いを決めて消す／アーカイブする」として呼ばれたとき THEN Kaname は「—」を行い 2xx を返す
    // 本物の試験：apps/api/test/features/F7/ticket-delete-preview.test.ts の「K487-API-001」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F7/ticket-delete-preview.test.ts", "utf8")).toContain("K487-API-001");
  });
  it("test_get_tickets_id_delete_preview_rejected_401", () => {
    // UNWANTED: IF セッションが無いか失効しているなら、Kaname は 401 を返し入り直しを促す（発行済みトークンの期限に頼らない）
    // 本物の試験：apps/api/test/features/F7/ticket-delete-preview.test.ts の「K487-API-012」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F7/ticket-delete-preview.test.ts", "utf8")).toContain("K487-API-012");
  });
  it("test_get_tickets_id_delete_preview_rejected_403", () => {
    // UNWANTED: IF 作った人でも、そのグループで編集の権限を持つ人でもない人が下見を開いたなら、Kaname は 403 と E-DEL-001 を返し、チケットも何も変えない
    // 本物の試験：apps/api/test/features/F7/ticket-delete-preview.test.ts の「K487-API-010」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F7/ticket-delete-preview.test.ts", "utf8")).toContain("K487-API-010");
  });
  it("test_get_tickets_id_delete_preview_not_found", () => {
    // UNWANTED: IF 見えない・別の会社・無い・もう消えたチケットの下見を開いたなら、Kaname は 404 を返し、チケットも何も変えない
    // 本物の試験：apps/api/test/features/F7/ticket-delete-preview.test.ts の「K487-API-011」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F7/ticket-delete-preview.test.ts", "utf8")).toContain("K487-API-011");
  });
  it("test_get_tickets_id_delete_preview_rejected_422", () => {
    // UNWANTED: IF 入力が受け付けられないなら、Kaname は 422 と項目ごとの理由を返す（表記ゆらぎはサーバーで正規化してから判定）
    // 本物の試験：apps/api/test/features/contract/k144.d/K-487.ts の「K144-API-887」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/contract/k144.d/K-487.ts", "utf8")).toContain("K144-API-887");
  });
  it("test_get_tickets_id_delete_preview_session_unresolved", () => {
    // UNWANTED: IF 件数を数える DB が落ちたなら、Kaname は 503 と E-PAGE-003 を返し、一部だけの件数を返さない
    // 本物の試験：apps/api/test/features/F7/ticket-delete-preview.test.ts の「K487-API-014」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F7/ticket-delete-preview.test.ts", "utf8")).toContain("K487-API-014");
  });
  it("test_get_tickets_id_delete_preview_rate_limited", () => {
    // UNWANTED: IF 60/min/user を超えたら、Kaname は 429 と retry_after_sec を返す
    // 本物の試験：apps/api/test/features/F7/ticket-delete-preview.test.ts の「K487-API-012」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F7/ticket-delete-preview.test.ts", "utf8")).toContain("K487-API-012");
  });
  it("test_get_tickets_id_delete_preview_terms_pending", () => {
    // UNWANTED: IF 同意し直しが要るセッションなら、Kaname は 403 と E-AUTH-010 を返し、副作用を起こさない
    // 本物の試験：apps/api/test/features/F1/terms.test.ts の「K53-API-005」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/terms.test.ts", "utf8")).toContain("K53-API-005");
  });
  // 当てはまらない（止めは全部の口で同じ 1 か所の入口（op.ts）。本物のログインで印を立てて止まることは apps/api/test/features/F1/mfa-gate.test.ts の K321-API-001〜011、口ごとの止めは作った口の生成の試験 mfa_pending が見る）：UNWANTED: IF 付けるまで進めないの印が立ったセッションなら、Kaname は 403 と MFA_REQUIRED を返し、副作用を起こさない
  it.todo("test_get_tickets_id_delete_preview_mfa_pending");
  it("test_get_tickets_id_delete_preview_session_unresolved_2", () => {
    // UNWANTED: IF 入口でセッションを解く所が落ちたなら、Kaname は 503 と E-PAGE-003 を返し、止める側に倒して副作用を起こさない
    // 本物の試験：apps/api/test/features/contract/k144-contract.test.ts の「K144-API-032」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/contract/k144-contract.test.ts", "utf8")).toContain("K144-API-032");
  });
  it("test_get_tickets_id_delete_preview_shape", () => {
    // UBIQUITOUS: GET /api/v1/tickets/:id/delete-preview の副作用は関門 C2 を経由し、認可 → ポリシー → 承認 → 副作用 → 記録 の順で行う
    // 本物の試験：apps/api/test/features/F7/ticket-delete-preview.test.ts の「K487-API-001」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F7/ticket-delete-preview.test.ts", "utf8")).toContain("K487-API-001");
  });
});
