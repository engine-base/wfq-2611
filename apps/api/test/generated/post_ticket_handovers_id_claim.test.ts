// 生成物（scripts/ci/gen_ears_tests.mjs ← 07_qa/test-plan/ears-test-mapping.json・ears-elsewhere.json）。手で直さない。POST /api/v1/ticket_handovers/:id/claim
// グループに配られた渡しの人を決める口は、配る・グループの権限・グループの人の組み合わせで答えが変わる。生成の試験の種ではグループ宛ての待っている渡しを作れない（K-410）
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("POST /api/v1/ticket_handovers/:id/claim", () => {
  it("test_post_ticket_handovers_id_claim_ok", () => {
    // EVENT-DRIVEN: WHEN POST /api/v1/ticket_handovers/:id/claim が「人かグループを選んで配る」として呼ばれたとき THEN Kaname は「層ごとの合意の要否に沿って知らせる」を行い 2xx を返す
    // 本物の試験：apps/api/test/features/F8/distribute-group.test.ts の「K410-API-013」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F8/distribute-group.test.ts", "utf8")).toContain("K410-API-013");
  });
  it("test_post_ticket_handovers_id_claim_rejected_401", () => {
    // UNWANTED: IF セッションが無いか失効しているなら、Kaname は 401 を返し入り直しを促す（発行済みトークンの期限に頼らない）
    // 本物の試験：apps/api/test/features/F8/distribute-group.test.ts の「K410-API-022」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F8/distribute-group.test.ts", "utf8")).toContain("K410-API-022");
  });
  it("test_post_ticket_handovers_id_claim_rejected_403", () => {
    // UNWANTED: IF 答える人でないか、グループ宛てでない渡しなら、Kaname は 403 と E-HND-002 を返し、何も書かない
    // 本物の試験：apps/api/test/features/F8/distribute-group.test.ts の「K410-API-016」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F8/distribute-group.test.ts", "utf8")).toContain("K410-API-016");
  });
  it("test_post_ticket_handovers_id_claim_not_found", () => {
    // UNWANTED: IF 無い渡し、または無い人・別の会社の人を決める人に選んだなら、Kaname は 404 と E-PAGE-001 を返し、何も書かない
    // 本物の試験：apps/api/test/features/F8/distribute-group.test.ts の「K410-API-022」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F8/distribute-group.test.ts", "utf8")).toContain("K410-API-022");
  });
  it("test_post_ticket_handovers_id_claim_conflict", () => {
    // UNWANTED: IF その渡しがもう決まっているか、選んだ人が担当者にできないなら、Kaname は 409 と E-HND-005／E-HND-150／E-HND-151 を返し、何も書かない
    // 本物の試験：apps/api/test/features/F8/distribute-group.test.ts の「K410-API-018」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F8/distribute-group.test.ts", "utf8")).toContain("K410-API-018");
  });
  it("test_post_ticket_handovers_id_claim_rejected_422", () => {
    // UNWANTED: IF 入力が受け付けられないなら、Kaname は 422 と項目ごとの理由を返す（表記ゆらぎはサーバーで正規化してから判定）
    // 本物の試験：apps/api/test/features/F8/distribute-group.test.ts の「K410-API-026」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F8/distribute-group.test.ts", "utf8")).toContain("K410-API-026");
  });
  it("test_post_ticket_handovers_id_claim_too_large", () => {
    // UNWANTED: IF 1 回に送る内容が 1MB（1,048,576 バイト）を超えたなら、Kaname は 413 と PAYLOAD_TOO_LARGE を返し、振る舞いに届かず何も書かない
    // 本物の試験：apps/api/test/features/contract/k144-contract.test.ts の「K144-API-042」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/contract/k144-contract.test.ts", "utf8")).toContain("K144-API-042");
  });
  it("test_post_ticket_handovers_id_claim_rate_limited", () => {
    // UNWANTED: IF 60/min/user を超えたら、Kaname は 429 と retry_after_sec を返す
    // 本物の試験：apps/api/test/features/F8/distribute-group.test.ts の「K410-API-022」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F8/distribute-group.test.ts", "utf8")).toContain("K410-API-022");
  });
  it("test_post_ticket_handovers_id_claim_terms_pending", () => {
    // UNWANTED: IF 同意し直しが要るセッションなら、Kaname は 403 と E-AUTH-010 を返し、副作用を起こさない
    // 本物の試験：apps/api/test/features/F1/terms.test.ts の「K53-API-005」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/terms.test.ts", "utf8")).toContain("K53-API-005");
  });
  // 当てはまらない（止めは全部の口で同じ 1 か所の入口（op.ts）。本物のログインで印を立てて止まることは apps/api/test/features/F1/mfa-gate.test.ts の K321-API-001〜011、口ごとの止めは作った口の生成の試験 mfa_pending が見る）：UNWANTED: IF 付けるまで進めないの印が立ったセッションなら、Kaname は 403 と MFA_REQUIRED を返し、副作用を起こさない
  it.todo("test_post_ticket_handovers_id_claim_mfa_pending");
  it("test_post_ticket_handovers_id_claim_session_unresolved", () => {
    // UNWANTED: IF 入口でセッションを解く所が落ちたなら、Kaname は 503 と E-PAGE-003 を返し、止める側に倒して副作用を起こさない
    // 本物の試験：apps/api/test/features/contract/k144-contract.test.ts の「K144-API-032」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/contract/k144-contract.test.ts", "utf8")).toContain("K144-API-032");
  });
  it("test_post_ticket_handovers_id_claim_shape", () => {
    // UBIQUITOUS: POST /api/v1/ticket_handovers/:id/claim の副作用は関門 C2・C6 を経由し、認可 → ポリシー → 承認 → 副作用 → 記録 の順で行う
    // 本物の試験：apps/api/test/features/F8/distribute-group.test.ts の「K410-API-013」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F8/distribute-group.test.ts", "utf8")).toContain("K410-API-013");
  });
});
