// 生成物（scripts/ci/gen_ears_tests.mjs ← 07_qa/test-plan/ears-test-mapping.json・ears-elsewhere.json）。手で直さない。GET /api/v1/tickets/:id/versions
// 本文の版の一覧は、本物の DB の版の行・書ける人の判定・消したチケットで答えが変わる。生成の試験の偽のセッションでは版を作れない（K-433）
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("GET /api/v1/tickets/:id/versions", () => {
  it("test_get_tickets_id_versions_ok", () => {
    // EVENT-DRIVEN: WHEN GET /api/v1/tickets/:id/versions が「区画ごとに書く」として呼ばれたとき THEN Kaname は「区画ごとに版を残す」を行い 2xx を返す（自動側：抜けを指摘する）
    // 本物の試験：apps/api/test/features/F4/ticket-versions.test.ts の「K433-API-001」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F4/ticket-versions.test.ts", "utf8")).toContain("K433-API-001");
  });
  it("test_get_tickets_id_versions_rejected_401", () => {
    // UNWANTED: IF セッションが無いか失効しているなら、Kaname は 401 を返し入り直しを促す（発行済みトークンの期限に頼らない）
    // 本物の試験：apps/api/test/features/F4/ticket-versions.test.ts の「K433-API-007」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F4/ticket-versions.test.ts", "utf8")).toContain("K433-API-007");
  });
  // 当てはまらない（読むだけの口で、そのチケットが見える人なら誰でも読める（閲覧のみの人も。見えない人は入口が 404 で止める。受けは K433-API-007・027））：UNWANTED: IF 権限が無いなら、Kaname は 403 を返し副作用を一切起こさない（認可 → ポリシー → 承認 → 副作用 → 記録の順）
  it.todo("test_get_tickets_id_versions_rejected_403");
  it("test_get_tickets_id_versions_not_found", () => {
    // UNWANTED: IF チケットが別の会社・見えない・無い id・消したチケットなら、Kaname は 404 と NOT_FOUND を返し、何も返さない
    // 本物の試験：apps/api/test/features/F4/ticket-versions.test.ts の「K433-API-007」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F4/ticket-versions.test.ts", "utf8")).toContain("K433-API-007");
  });
  it("test_get_tickets_id_versions_rejected_422", () => {
    // UNWANTED: IF 入力が受け付けられないなら、Kaname は 422 と項目ごとの理由を返す（表記ゆらぎはサーバーで正規化してから判定）
    // 本物の試験：apps/api/test/features/contract/k144.d/K-433.ts の「K144-API-510」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/contract/k144.d/K-433.ts", "utf8")).toContain("K144-API-510");
  });
  it("test_get_tickets_id_versions_not_found_2", () => {
    // UNWANTED: IF 無い版・形の違う from・to を指したなら、Kaname は 404 と E-PAGE-001 を返し、何も返さない
    // 本物の試験：apps/api/test/features/F4/ticket-versions.test.ts の「K433-API-008」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F4/ticket-versions.test.ts", "utf8")).toContain("K433-API-008");
  });
  // 当てはまらない（読む口の DB 落ちは、書く側と同じ bodyReply の 503・E-PAGE-003 の道を通る（本物の DB を落とせるのは書く側の K433-API-019 の取引の失敗だけ。読む側に専用の行は無い））：UNWANTED: IF 版を読む DB が落ちたなら、Kaname は 503 と E-PAGE-003 を返す
  it.todo("test_get_tickets_id_versions_session_unresolved");
  // 当てはまらない（回数は入口の共通の数えで、読む口の型の確かめは K144-API の共通の試験が持つ）：UNWANTED: IF 120/min/user を超えたら、Kaname は 429 と retry_after_sec を返す
  it.todo("test_get_tickets_id_versions_rate_limited");
  it("test_get_tickets_id_versions_terms_pending", () => {
    // UNWANTED: IF 同意し直しが要るセッションなら、Kaname は 403 と E-AUTH-010 を返し、副作用を起こさない
    // 本物の試験：apps/api/test/features/F1/terms.test.ts の「K53-API-005」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/terms.test.ts", "utf8")).toContain("K53-API-005");
  });
  // 当てはまらない（止めは全部の口で同じ 1 か所の入口（op.ts）。本物のログインで印を立てて止まることは apps/api/test/features/F1/mfa-gate.test.ts の K321-API-001〜011、口ごとの止めは作った口の生成の試験 mfa_pending が見る）：UNWANTED: IF 付けるまで進めないの印が立ったセッションなら、Kaname は 403 と MFA_REQUIRED を返し、副作用を起こさない
  it.todo("test_get_tickets_id_versions_mfa_pending");
  it("test_get_tickets_id_versions_session_unresolved_2", () => {
    // UNWANTED: IF 入口でセッションを解く所が落ちたなら、Kaname は 503 と E-PAGE-003 を返し、止める側に倒して副作用を起こさない
    // 本物の試験：apps/api/test/features/contract/k144-contract.test.ts の「K144-API-032」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/contract/k144-contract.test.ts", "utf8")).toContain("K144-API-032");
  });
  it("test_get_tickets_id_versions_shape", () => {
    // UBIQUITOUS: GET /api/v1/tickets/:id/versions の副作用は関門 C2 を経由し、認可 → ポリシー → 承認 → 副作用 → 記録 の順で行う
    // 本物の試験：apps/api/test/features/F4/ticket-versions.test.ts の「K433-API-001」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F4/ticket-versions.test.ts", "utf8")).toContain("K433-API-001");
  });
});
