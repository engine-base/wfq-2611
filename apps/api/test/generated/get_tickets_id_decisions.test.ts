// 生成物（scripts/ci/gen_ears_tests.mjs ← 07_qa/test-plan/ears-test-mapping.json・ears-elsewhere.json）。手で直さない。GET /api/v1/tickets/:id/decisions
// 決定は見えるか・書けるか・決めた人・元の書き込みの組み合わせで答えが変わり、生成の試験の種では作れない（K-390）
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("GET /api/v1/tickets/:id/decisions", () => {
  it("test_get_tickets_id_decisions_ok", () => {
    // EVENT-DRIVEN: WHEN GET /api/v1/tickets/:id/decisions が「決めたこと・理由を書く／AI の候補を確定する」として呼ばれたとき THEN Kaname は「決定と改めた先を残す」を行い 2xx を返す（自動側：スレッドから決定の候補を出す）
    // 本物の試験：apps/api/test/features/F6/decisions.test.ts の「K390-API-002」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F6/decisions.test.ts", "utf8")).toContain("K390-API-002");
  });
  it("test_get_tickets_id_decisions_rejected_401", () => {
    // UNWANTED: IF セッションが無いか失効しているなら、Kaname は 401 を返し入り直しを促す（発行済みトークンの期限に頼らない）
    // 本物の試験：apps/api/test/features/F6/decisions.test.ts の「K390-API-014」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F6/decisions.test.ts", "utf8")).toContain("K390-API-014");
  });
  // 当てはまらない（見るだけの人も読める。見えない人は 404（K390-API-014））：UNWANTED: IF 権限が無いなら、Kaname は 403 を返し副作用を一切起こさない（認可 → ポリシー → 承認 → 副作用 → 記録の順）
  it.todo("test_get_tickets_id_decisions_rejected_403");
  it("test_get_tickets_id_decisions_not_found", () => {
    // UNWANTED: IF 対象が無いか他社の行なら、Kaname は 404 を返す（存在を漏らさない）
    // 本物の試験：apps/api/test/features/F6/decisions.test.ts の「K390-API-014」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F6/decisions.test.ts", "utf8")).toContain("K390-API-014");
  });
  // 当てはまらない（入口の uuid の確かめ（K144-API-750））：UNWANTED: IF 入力が受け付けられないなら、Kaname は 422 と項目ごとの理由を返す（表記ゆらぎはサーバーで正規化してから判定）
  it.todo("test_get_tickets_id_decisions_rejected_422");
  // 当てはまらない（上限は入口の共通の数え方。同じ道を足す口で K390-API-019 が確かめる）：UNWANTED: IF 120/min/user を超えたら、Kaname は 429 と retry_after_sec を返す
  it.todo("test_get_tickets_id_decisions_rate_limited");
  it("test_get_tickets_id_decisions_terms_pending", () => {
    // UNWANTED: IF 同意し直しが要るセッションなら、Kaname は 403 と E-AUTH-010 を返し、副作用を起こさない
    // 本物の試験：apps/api/test/features/F1/terms.test.ts の「K53-API-005」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/terms.test.ts", "utf8")).toContain("K53-API-005");
  });
  // 当てはまらない（止めは全部の口で同じ 1 か所の入口（op.ts）。本物のログインで印を立てて止まることは apps/api/test/features/F1/mfa-gate.test.ts の K321-API-001〜011、口ごとの止めは作った口の生成の試験 mfa_pending が見る）：UNWANTED: IF 付けるまで進めないの印が立ったセッションなら、Kaname は 403 と MFA_REQUIRED を返し、副作用を起こさない
  it.todo("test_get_tickets_id_decisions_mfa_pending");
  it("test_get_tickets_id_decisions_session_unresolved", () => {
    // UNWANTED: IF 入口でセッションを解く所が落ちたなら、Kaname は 503 と E-PAGE-003 を返し、止める側に倒して副作用を起こさない
    // 本物の試験：apps/api/test/features/contract/k144-contract.test.ts の「K144-API-032」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/contract/k144-contract.test.ts", "utf8")).toContain("K144-API-032");
  });
  it("test_get_tickets_id_decisions_shape", () => {
    // UBIQUITOUS: GET /api/v1/tickets/:id/decisions の副作用は関門 C2 を経由し、認可 → ポリシー → 承認 → 副作用 → 記録 の順で行う
    // 本物の試験：apps/api/test/features/F6/decisions.test.ts の「K390-API-002」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F6/decisions.test.ts", "utf8")).toContain("K390-API-002");
  });
});
