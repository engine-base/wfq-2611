// 生成物（scripts/ci/gen_ears_tests.mjs ← 07_qa/test-plan/ears-test-mapping.json・ears-elsewhere.json）。手で直さない。GET /api/v1/tickets/:id/links
// つながりの一覧は、相手が見えるか・消えているか・書けるかで答えの形が変わる。生成の試験の種ではグループと権限を作れない（K-441）
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("GET /api/v1/tickets/:id/links", () => {
  it("test_get_tickets_id_links_ok", () => {
    // EVENT-DRIVEN: WHEN GET /api/v1/tickets/:id/links が「責任者・期限・分類・親を決める」として呼ばれたとき THEN Kaname は「—」を行い 2xx を返す（自動側：振り分けの案を出す）
    // 本物の試験：apps/api/test/features/F4/ticket-links.test.ts の「K441-API-001」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F4/ticket-links.test.ts", "utf8")).toContain("K441-API-001");
  });
  it("test_get_tickets_id_links_rejected_401", () => {
    // UNWANTED: IF セッションが無いか失効しているなら、Kaname は 401 を返し入り直しを促す（発行済みトークンの期限に頼らない）
    // 本物の試験：apps/api/test/features/F4/ticket-links.test.ts の「K441-API-022」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F4/ticket-links.test.ts", "utf8")).toContain("K441-API-022");
  });
  // 当てはまらない（見えないときは 404（有ることを漏らさない）で、読む口に 403 は無い（受けは K441-API-004））：UNWANTED: IF 権限が無いなら、Kaname は 403 を返し副作用を一切起こさない（認可 → ポリシー → 承認 → 副作用 → 記録の順）
  it.todo("test_get_tickets_id_links_rejected_403");
  it("test_get_tickets_id_links_not_found", () => {
    // UNWANTED: IF チケットが見えないなら、Kaname は 404 を返し、つながりも子も返さない
    // 本物の試験：apps/api/test/features/F4/ticket-links.test.ts の「K441-API-004」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F4/ticket-links.test.ts", "utf8")).toContain("K441-API-004");
  });
  // 当てはまらない（入力は道の id だけ（uuid の確かめは入口の共通・K144-API-541））：UNWANTED: IF 入力が受け付けられないなら、Kaname は 422 と項目ごとの理由を返す（表記ゆらぎはサーバーで正規化してから判定）
  it.todo("test_get_tickets_id_links_rejected_422");
  // 当てはまらない（入口の確かめの後で消える・見えなくなる競合だけで、入口の 404（K441-API-004）と同じ 404。口の答えは E-PAGE-001（関数が null を返す枝）で、試験で競合を作れない（K-441））：UNWANTED: IF 入口の確かめの後でチケットが見えなくなったなら、Kaname は 404 と E-PAGE-001 を返し、つながりも子も返さない
  it.todo("test_get_tickets_id_links_not_found_2");
  it("test_get_tickets_id_links_session_unresolved", () => {
    // UNWANTED: IF つながりを読む DB が落ちたなら、Kaname は 503 と E-PAGE-003 を返し、何も返さず何も書かない
    // 本物の試験：apps/api/test/features/F4/ticket-links.test.ts の「K441-API-028」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F4/ticket-links.test.ts", "utf8")).toContain("K441-API-028");
  });
  it("test_get_tickets_id_links_rate_limited", () => {
    // UNWANTED: IF 120/min/user を超えたら、Kaname は 429 と retry_after_sec を返す
    // 本物の試験：apps/api/test/features/F4/ticket-links.test.ts の「K441-API-023」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F4/ticket-links.test.ts", "utf8")).toContain("K441-API-023");
  });
  it("test_get_tickets_id_links_terms_pending", () => {
    // UNWANTED: IF 同意し直しが要るセッションなら、Kaname は 403 と E-AUTH-010 を返し、副作用を起こさない
    // 本物の試験：apps/api/test/features/F1/terms.test.ts の「K53-API-005」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/terms.test.ts", "utf8")).toContain("K53-API-005");
  });
  // 当てはまらない（止めは全部の口で同じ 1 か所の入口（op.ts）。本物のログインで印を立てて止まることは apps/api/test/features/F1/mfa-gate.test.ts の K321-API-001〜011、口ごとの止めは作った口の生成の試験 mfa_pending が見る）：UNWANTED: IF 付けるまで進めないの印が立ったセッションなら、Kaname は 403 と MFA_REQUIRED を返し、副作用を起こさない
  it.todo("test_get_tickets_id_links_mfa_pending");
  it("test_get_tickets_id_links_session_unresolved_2", () => {
    // UNWANTED: IF 入口でセッションを解く所が落ちたなら、Kaname は 503 と E-PAGE-003 を返し、止める側に倒して副作用を起こさない
    // 本物の試験：apps/api/test/features/contract/k144-contract.test.ts の「K144-API-032」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/contract/k144-contract.test.ts", "utf8")).toContain("K144-API-032");
  });
  it("test_get_tickets_id_links_shape", () => {
    // UBIQUITOUS: GET /api/v1/tickets/:id/links の副作用は関門 C2 を経由し、認可 → ポリシー → 承認 → 副作用 → 記録 の順で行う
    // 本物の試験：apps/api/test/features/F4/ticket-links.test.ts の「K441-API-001」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F4/ticket-links.test.ts", "utf8")).toContain("K441-API-001");
  });
});
