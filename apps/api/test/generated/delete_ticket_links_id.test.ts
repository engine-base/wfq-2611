// 生成物（scripts/ci/gen_ears_tests.mjs ← 07_qa/test-plan/ears-test-mapping.json・ears-elsewhere.json）。手で直さない。DELETE /api/v1/ticket_links/:id
// つながりを外す口は、両端のどちらに書けるか・見えるかで答えが変わる。生成の試験の種ではグループと権限を作れない（K-441）
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("DELETE /api/v1/ticket_links/:id", () => {
  it("test_delete_ticket_links_id_ok", () => {
    // EVENT-DRIVEN: WHEN DELETE /api/v1/ticket_links/:id が「責任者・期限・分類・親を決める」として呼ばれたとき THEN Kaname は「—」を行い 2xx を返す（自動側：振り分けの案を出す）
    // 本物の試験：apps/api/test/features/F4/ticket-links.test.ts の「K441-API-015」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F4/ticket-links.test.ts", "utf8")).toContain("K441-API-015");
  });
  it("test_delete_ticket_links_id_rejected_401", () => {
    // UNWANTED: IF セッションが無いか失効しているなら、Kaname は 401 を返し入り直しを促す（発行済みトークンの期限に頼らない）
    // 本物の試験：apps/api/test/features/F4/ticket-links.test.ts の「K441-API-022」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F4/ticket-links.test.ts", "utf8")).toContain("K441-API-022");
  });
  it("test_delete_ticket_links_id_rejected_403", () => {
    // UNWANTED: IF つながりの両端のどちらにも書けないなら、Kaname は 403 を返し、行も証跡も変えない
    // 本物の試験：apps/api/test/features/F4/ticket-links.test.ts の「K441-API-017」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F4/ticket-links.test.ts", "utf8")).toContain("K441-API-017");
  });
  it("test_delete_ticket_links_id_not_found", () => {
    // UNWANTED: IF つながりが見えないなら、Kaname は 404 と E-PAGE-001 を返し、行も証跡も変えない
    // 本物の試験：apps/api/test/features/F4/ticket-links.test.ts の「K441-API-018」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F4/ticket-links.test.ts", "utf8")).toContain("K441-API-018");
  });
  // 当てはまらない（入力は道の id だけ（uuid の確かめは入口の共通・K144-API-543））：UNWANTED: IF 入力が受け付けられないなら、Kaname は 422 と項目ごとの理由を返す（表記ゆらぎはサーバーで正規化してから判定）
  it.todo("test_delete_ticket_links_id_rejected_422");
  it("test_delete_ticket_links_id_session_unresolved", () => {
    // UNWANTED: IF つながりを外す DB が落ちたなら、Kaname は 503 と E-PAGE-003 を返し、行は生きたまま・証跡も増やさない
    // 本物の試験：apps/api/test/features/F4/ticket-links.test.ts の「K441-API-020」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F4/ticket-links.test.ts", "utf8")).toContain("K441-API-020");
  });
  it("test_delete_ticket_links_id_rate_limited", () => {
    // UNWANTED: IF 60/min/user を超えたら、Kaname は 429 と retry_after_sec を返す
    // 本物の試験：apps/api/test/features/F4/ticket-links.test.ts の「K441-API-023」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F4/ticket-links.test.ts", "utf8")).toContain("K441-API-023");
  });
  it("test_delete_ticket_links_id_terms_pending", () => {
    // UNWANTED: IF 同意し直しが要るセッションなら、Kaname は 403 と E-AUTH-010 を返し、副作用を起こさない
    // 本物の試験：apps/api/test/features/F1/terms.test.ts の「K53-API-005」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/terms.test.ts", "utf8")).toContain("K53-API-005");
  });
  // 当てはまらない（止めは全部の口で同じ 1 か所の入口（op.ts）。本物のログインで印を立てて止まることは apps/api/test/features/F1/mfa-gate.test.ts の K321-API-001〜011、口ごとの止めは作った口の生成の試験 mfa_pending が見る）：UNWANTED: IF 付けるまで進めないの印が立ったセッションなら、Kaname は 403 と MFA_REQUIRED を返し、副作用を起こさない
  it.todo("test_delete_ticket_links_id_mfa_pending");
  it("test_delete_ticket_links_id_session_unresolved_2", () => {
    // UNWANTED: IF 入口でセッションを解く所が落ちたなら、Kaname は 503 と E-PAGE-003 を返し、止める側に倒して副作用を起こさない
    // 本物の試験：apps/api/test/features/contract/k144-contract.test.ts の「K144-API-032」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/contract/k144-contract.test.ts", "utf8")).toContain("K144-API-032");
  });
  it("test_delete_ticket_links_id_shape", () => {
    // UBIQUITOUS: DELETE /api/v1/ticket_links/:id の副作用は関門 C2 を経由し、認可 → ポリシー → 承認 → 副作用 → 記録 の順で行う
    // 本物の試験：apps/api/test/features/F4/ticket-links.test.ts の「K441-API-015」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F4/ticket-links.test.ts", "utf8")).toContain("K441-API-015");
  });
});
