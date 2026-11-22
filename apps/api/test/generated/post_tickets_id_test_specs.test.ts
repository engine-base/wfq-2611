// 生成物（scripts/ci/gen_ears_tests.mjs ← 07_qa/test-plan/ears-test-mapping.json・ears-elsewhere.json）。手で直さない。POST /api/v1/tickets/:id/test-specs
// 確認項目を足す口は、チケットが見えるか・書けるか・完了したか・同時に完了したかで答えが変わり、DB の関数が行とやり取りと証跡を 1 つの取引で書く。生成の試験の偽のセッションでは作れない（K-434）
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("POST /api/v1/tickets/:id/test-specs", () => {
  it("test_post_tickets_id_test_specs_ok", () => {
    // EVENT-DRIVEN: WHEN POST /api/v1/tickets/:id/test-specs が「確認項目を見て直す・OFF にするなら理由を書く」として呼ばれたとき THEN Kaname は「項目と版を残す」を行い 2xx を返す（自動側：案を出し、抜けを点検し、①機械 ②AI ③人 の種類と判定の型を提案する）
    // 本物の試験：apps/api/test/features/F4/test-spec-create.test.ts の「K434-API-008」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F4/test-spec-create.test.ts", "utf8")).toContain("K434-API-008");
  });
  it("test_post_tickets_id_test_specs_rejected_401", () => {
    // UNWANTED: IF セッションが無いか失効しているなら、Kaname は 401 を返し入り直しを促す（発行済みトークンの期限に頼らない）
    // 本物の試験：apps/api/test/features/F4/test-spec-create.test.ts の「K434-API-011」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F4/test-spec-create.test.ts", "utf8")).toContain("K434-API-011");
  });
  it("test_post_tickets_id_test_specs_rejected_403", () => {
    // UNWANTED: IF チケットを書けない人なら、Kaname は 403 を返し、項目も証跡も作らない
    // 本物の試験：apps/api/test/features/F4/test-spec-create.test.ts の「K434-API-011」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F4/test-spec-create.test.ts", "utf8")).toContain("K434-API-011");
  });
  it("test_post_tickets_id_test_specs_not_found", () => {
    // UNWANTED: IF チケットが無いか見えないなら、Kaname は 404 を返し、在るかを漏らさず項目も証跡も作らない
    // 本物の試験：apps/api/test/features/F4/test-spec-create.test.ts の「K434-API-011」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F4/test-spec-create.test.ts", "utf8")).toContain("K434-API-011");
  });
  // 本物の試験はまだ無い（apps/api/test/features/F4/test-spec-create.test.ts）：UNWANTED: IF チケットが完了しているなら、Kaname は 409 と E-SPEC-001 を返し、項目も証跡も作らない
  it.todo("test_post_tickets_id_test_specs_conflict");
  it("test_post_tickets_id_test_specs_rejected_422", () => {
    // UNWANTED: IF 入力が決まりに合わないなら、Kaname は 422 と欄ごとの理由を返し、項目も証跡も作らない
    // 本物の試験：apps/api/test/features/F4/test-spec-create.test.ts の「K434-API-009」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F4/test-spec-create.test.ts", "utf8")).toContain("K434-API-009");
  });
  it("test_post_tickets_id_test_specs_session_unresolved", () => {
    // UNWANTED: IF 書けないなら、Kaname は 503 と E-PAGE-003 を返し、項目も証跡も残さない
    // 本物の試験：apps/api/test/features/F4/test-spec-create.test.ts の「K434-API-016」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F4/test-spec-create.test.ts", "utf8")).toContain("K434-API-016");
  });
  it("test_post_tickets_id_test_specs_too_large", () => {
    // UNWANTED: IF 1 回に送る内容が 1MB（1,048,576 バイト）を超えたなら、Kaname は 413 と PAYLOAD_TOO_LARGE を返し、振る舞いに届かず何も書かない
    // 本物の試験：apps/api/test/features/contract/k144-contract.test.ts の「K144-API-042」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/contract/k144-contract.test.ts", "utf8")).toContain("K144-API-042");
  });
  it("test_post_tickets_id_test_specs_rate_limited", () => {
    // UNWANTED: IF 60/min/user を超えたら、Kaname は 429 と retry_after_sec を返す
    // 本物の試験：apps/api/test/features/F4/test-spec-create.test.ts の「K434-API-018」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F4/test-spec-create.test.ts", "utf8")).toContain("K434-API-018");
  });
  // 当てはまらない（外を呼ばない（C3 は契約の口の宣言に付いているだけ・AI も PC も呼ばない））：UNWANTED: IF 外部が失敗したか完了信号が無いなら、Kaname は成功扱いにせず 502 と次の一手（人へのハンドオフ）を返す
  it.todo("test_post_tickets_id_test_specs_upstream_failed");
  it("test_post_tickets_id_test_specs_terms_pending", () => {
    // UNWANTED: IF 同意し直しが要るセッションなら、Kaname は 403 と E-AUTH-010 を返し、副作用を起こさない
    // 本物の試験：apps/api/test/features/F1/terms.test.ts の「K53-API-005」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/terms.test.ts", "utf8")).toContain("K53-API-005");
  });
  // 当てはまらない（止めは全部の口で同じ 1 か所の入口（op.ts）。本物のログインで印を立てて止まることは apps/api/test/features/F1/mfa-gate.test.ts の K321-API-001〜011、口ごとの止めは作った口の生成の試験 mfa_pending が見る）：UNWANTED: IF 付けるまで進めないの印が立ったセッションなら、Kaname は 403 と MFA_REQUIRED を返し、副作用を起こさない
  it.todo("test_post_tickets_id_test_specs_mfa_pending");
  it("test_post_tickets_id_test_specs_session_unresolved_2", () => {
    // UNWANTED: IF 入口でセッションを解く所が落ちたなら、Kaname は 503 と E-PAGE-003 を返し、止める側に倒して副作用を起こさない
    // 本物の試験：apps/api/test/features/contract/k144-contract.test.ts の「K144-API-032」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/contract/k144-contract.test.ts", "utf8")).toContain("K144-API-032");
  });
  it("test_post_tickets_id_test_specs_shape", () => {
    // UBIQUITOUS: POST /api/v1/tickets/:id/test-specs の副作用は関門 C2・C3 を経由し、認可 → ポリシー → 承認 → 副作用 → 記録 の順で行う
    // 本物の試験：apps/api/test/features/F4/test-spec-create.test.ts の「K434-API-008」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F4/test-spec-create.test.ts", "utf8")).toContain("K434-API-008");
  });
});
