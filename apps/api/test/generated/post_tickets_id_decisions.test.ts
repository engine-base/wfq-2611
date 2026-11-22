// 生成物（scripts/ci/gen_ears_tests.mjs ← 07_qa/test-plan/ears-test-mapping.json・ears-elsewhere.json）。手で直さない。POST /api/v1/tickets/:id/decisions
// 決定は見えるか・書けるか・決めた人・元の書き込みの組み合わせで答えが変わり、生成の試験の種では作れない（K-390）
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("POST /api/v1/tickets/:id/decisions", () => {
  it("test_post_tickets_id_decisions_ok", () => {
    // EVENT-DRIVEN: WHEN POST /api/v1/tickets/:id/decisions が「決めたこと・理由を書く／AI の候補を確定する」として呼ばれたとき THEN Kaname は「決定と改めた先を残す」を行い 2xx を返す（自動側：スレッドから決定の候補を出す）
    // 本物の試験：apps/api/test/features/F6/decisions.test.ts の「K390-API-004」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F6/decisions.test.ts", "utf8")).toContain("K390-API-004");
  });
  it("test_post_tickets_id_decisions_rejected_401", () => {
    // UNWANTED: IF セッションが無いか失効しているなら、Kaname は 401 を返し入り直しを促す（発行済みトークンの期限に頼らない）
    // 本物の試験：apps/api/test/features/F6/decisions.test.ts の「K390-API-014」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F6/decisions.test.ts", "utf8")).toContain("K390-API-014");
  });
  it("test_post_tickets_id_decisions_rejected_403", () => {
    // UNWANTED: IF 権限が無いなら、Kaname は 403 を返し副作用を一切起こさない（認可 → ポリシー → 承認 → 副作用 → 記録の順）
    // 本物の試験：apps/api/test/features/F6/decisions.test.ts の「K390-API-014」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F6/decisions.test.ts", "utf8")).toContain("K390-API-014");
  });
  it("test_post_tickets_id_decisions_not_found", () => {
    // UNWANTED: IF チケットか決めた人か元の書き込みが無いか見えないなら、Kaname は 404 を返し、在るかを漏らさず何も書かない
    // 本物の試験：apps/api/test/features/F6/decisions.test.ts の「K390-API-014」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F6/decisions.test.ts", "utf8")).toContain("K390-API-014");
  });
  it("test_post_tickets_id_decisions_conflict", () => {
    // UNWANTED: IF 取引先のルールにしたなら、Kaname は 409 と E-CONF-037 を返し、何も書かない（取引先の画面ができるまで）
    // 本物の試験：apps/api/test/features/F6/decisions.test.ts の「K390-API-011」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F6/decisions.test.ts", "utf8")).toContain("K390-API-011");
  });
  it("test_post_tickets_id_decisions_rejected_422", () => {
    // UNWANTED: IF 決めたことが空（空白だけ・制御文字だけを含む）なら、Kaname は 422 E-VAL-042 を返し、何も書かない
    // 本物の試験：apps/api/test/features/F6/decisions.test.ts の「K390-API-008」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F6/decisions.test.ts", "utf8")).toContain("K390-API-008");
  });
  it("test_post_tickets_id_decisions_unavailable", () => {
    // UNWANTED: IF 守りの判定ができなかったなら、Kaname は 503 を返し、止める側に倒して何も書かない（守りの判定の例外）
    // 本物の試験：apps/api/test/features/F6/decisions.test.ts の「K390-API-016」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F6/decisions.test.ts", "utf8")).toContain("K390-API-016");
  });
  it("test_post_tickets_id_decisions_too_large", () => {
    // UNWANTED: IF 1 回に送る内容が 1MB（1,048,576 バイト）を超えたなら、Kaname は 413 と PAYLOAD_TOO_LARGE を返し、振る舞いに届かず何も書かない
    // 本物の試験：apps/api/test/features/contract/k144-contract.test.ts の「K144-API-042」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/contract/k144-contract.test.ts", "utf8")).toContain("K144-API-042");
  });
  it("test_post_tickets_id_decisions_rate_limited", () => {
    // UNWANTED: IF 60/min/user を超えたら、Kaname は 429 と retry_after_sec を返す
    // 本物の試験：apps/api/test/features/F6/decisions.test.ts の「K390-API-019」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F6/decisions.test.ts", "utf8")).toContain("K390-API-019");
  });
  it("test_post_tickets_id_decisions_terms_pending", () => {
    // UNWANTED: IF 同意し直しが要るセッションなら、Kaname は 403 と E-AUTH-010 を返し、副作用を起こさない
    // 本物の試験：apps/api/test/features/F1/terms.test.ts の「K53-API-005」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/terms.test.ts", "utf8")).toContain("K53-API-005");
  });
  // 当てはまらない（止めは全部の口で同じ 1 か所の入口（op.ts）。本物のログインで印を立てて止まることは apps/api/test/features/F1/mfa-gate.test.ts の K321-API-001〜011、口ごとの止めは作った口の生成の試験 mfa_pending が見る）：UNWANTED: IF 付けるまで進めないの印が立ったセッションなら、Kaname は 403 と MFA_REQUIRED を返し、副作用を起こさない
  it.todo("test_post_tickets_id_decisions_mfa_pending");
  it("test_post_tickets_id_decisions_session_unresolved", () => {
    // UNWANTED: IF 入口でセッションを解く所が落ちたなら、Kaname は 503 と E-PAGE-003 を返し、止める側に倒して副作用を起こさない
    // 本物の試験：apps/api/test/features/contract/k144-contract.test.ts の「K144-API-032」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/contract/k144-contract.test.ts", "utf8")).toContain("K144-API-032");
  });
  it("test_post_tickets_id_decisions_shape", () => {
    // UBIQUITOUS: POST /api/v1/tickets/:id/decisions の副作用は関門 C2 を経由し、認可 → ポリシー → 承認 → 副作用 → 記録 の順で行う
    // 本物の試験：apps/api/test/features/F6/decisions.test.ts の「K390-API-004」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F6/decisions.test.ts", "utf8")).toContain("K390-API-004");
  });
});
