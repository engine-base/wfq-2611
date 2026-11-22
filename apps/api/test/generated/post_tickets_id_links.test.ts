// 生成物（scripts/ci/gen_ears_tests.mjs ← 07_qa/test-plan/ears-test-mapping.json・ears-elsewhere.json）。手で直さない。POST /api/v1/tickets/:id/links
// つながりを足す口は、両端の権限・重複・派生元の輪の組み合わせで答えが変わる。生成の試験の種ではグループと権限を作れない（K-441）
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("POST /api/v1/tickets/:id/links", () => {
  it("test_post_tickets_id_links_ok", () => {
    // EVENT-DRIVEN: WHEN POST /api/v1/tickets/:id/links が「責任者・期限・分類・親を決める」として呼ばれたとき THEN Kaname は「—」を行い 2xx を返す（自動側：振り分けの案を出す）
    // 本物の試験：apps/api/test/features/F4/ticket-links.test.ts の「K441-API-005」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F4/ticket-links.test.ts", "utf8")).toContain("K441-API-005");
  });
  it("test_post_tickets_id_links_rejected_401", () => {
    // UNWANTED: IF セッションが無いか失効しているなら、Kaname は 401 を返し入り直しを促す（発行済みトークンの期限に頼らない）
    // 本物の試験：apps/api/test/features/F4/ticket-links.test.ts の「K441-API-022」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F4/ticket-links.test.ts", "utf8")).toContain("K441-API-022");
  });
  it("test_post_tickets_id_links_rejected_403", () => {
    // UNWANTED: IF 足す側か相手のチケットに書けないなら、Kaname は 403 を返し（相手に書けないときは欄 other_ticket_id つき）、行も証跡も書かない
    // 本物の試験：apps/api/test/features/F4/ticket-links.test.ts の「K441-API-011」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F4/ticket-links.test.ts", "utf8")).toContain("K441-API-011");
  });
  it("test_post_tickets_id_links_not_found", () => {
    // UNWANTED: IF 足す側のチケットが見えないなら、Kaname は 404 を返し、行も証跡も書かない
    // 本物の試験：apps/api/test/features/F4/ticket-links.test.ts の「K441-API-010」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F4/ticket-links.test.ts", "utf8")).toContain("K441-API-010");
  });
  it("test_post_tickets_id_links_conflict", () => {
    // UNWANTED: IF 自分自身とつなごうとしたか、もうつながっているか、派生元が輪になるなら、Kaname は 409 とその理由（E-LNK-001・002・003）を返し、行も証跡も書かない
    // 本物の試験：apps/api/test/features/F4/ticket-links.test.ts の「K441-API-007」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F4/ticket-links.test.ts", "utf8")).toContain("K441-API-007");
  });
  it("test_post_tickets_id_links_rejected_422", () => {
    // UNWANTED: IF 入力が決まりに合わないなら、Kaname は 422 と欄ごとの理由を返し、行も証跡も書かない
    // 本物の試験：apps/api/test/features/F4/ticket-links.test.ts の「K441-API-013」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F4/ticket-links.test.ts", "utf8")).toContain("K441-API-013");
  });
  it("test_post_tickets_id_links_not_found_2", () => {
    // UNWANTED: IF 相手のチケットが見えないなら、Kaname は 404 と E-PAGE-001 を返し、行も証跡も書かない
    // 本物の試験：apps/api/test/features/F4/ticket-links.test.ts の「K441-API-010」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F4/ticket-links.test.ts", "utf8")).toContain("K441-API-010");
  });
  it("test_post_tickets_id_links_session_unresolved", () => {
    // UNWANTED: IF つながりを書く DB が落ちたなら、Kaname は 503 と E-PAGE-003 を返し、行も証跡も残さない
    // 本物の試験：apps/api/test/features/F4/ticket-links.test.ts の「K441-API-019」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F4/ticket-links.test.ts", "utf8")).toContain("K441-API-019");
  });
  it("test_post_tickets_id_links_too_large", () => {
    // UNWANTED: IF 1 回に送る内容が 1MB（1,048,576 バイト）を超えたなら、Kaname は 413 と PAYLOAD_TOO_LARGE を返し、振る舞いに届かず何も書かない
    // 本物の試験：apps/api/test/features/contract/k144-contract.test.ts の「K144-API-042」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/contract/k144-contract.test.ts", "utf8")).toContain("K144-API-042");
  });
  it("test_post_tickets_id_links_rate_limited", () => {
    // UNWANTED: IF 60/min/user を超えたら、Kaname は 429 と retry_after_sec を返す
    // 本物の試験：apps/api/test/features/F4/ticket-links.test.ts の「K441-API-023」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F4/ticket-links.test.ts", "utf8")).toContain("K441-API-023");
  });
  it("test_post_tickets_id_links_terms_pending", () => {
    // UNWANTED: IF 同意し直しが要るセッションなら、Kaname は 403 と E-AUTH-010 を返し、副作用を起こさない
    // 本物の試験：apps/api/test/features/F1/terms.test.ts の「K53-API-005」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/terms.test.ts", "utf8")).toContain("K53-API-005");
  });
  // 当てはまらない（止めは全部の口で同じ 1 か所の入口（op.ts）。本物のログインで印を立てて止まることは apps/api/test/features/F1/mfa-gate.test.ts の K321-API-001〜011、口ごとの止めは作った口の生成の試験 mfa_pending が見る）：UNWANTED: IF 付けるまで進めないの印が立ったセッションなら、Kaname は 403 と MFA_REQUIRED を返し、副作用を起こさない
  it.todo("test_post_tickets_id_links_mfa_pending");
  it("test_post_tickets_id_links_session_unresolved_2", () => {
    // UNWANTED: IF 入口でセッションを解く所が落ちたなら、Kaname は 503 と E-PAGE-003 を返し、止める側に倒して副作用を起こさない
    // 本物の試験：apps/api/test/features/contract/k144-contract.test.ts の「K144-API-032」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/contract/k144-contract.test.ts", "utf8")).toContain("K144-API-032");
  });
  it("test_post_tickets_id_links_shape", () => {
    // UBIQUITOUS: POST /api/v1/tickets/:id/links の副作用は関門 C2 を経由し、認可 → ポリシー → 承認 → 副作用 → 記録 の順で行う
    // 本物の試験：apps/api/test/features/F4/ticket-links.test.ts の「K441-API-005」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F4/ticket-links.test.ts", "utf8")).toContain("K441-API-005");
  });
});
