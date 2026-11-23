// 生成物（scripts/ci/gen_ears_tests.mjs ← 07_qa/test-plan/ears-test-mapping.json・ears-elsewhere.json）。手で直さない。GET /api/v1/clones/me/activity
// やったことは実行・承認・成果物の版の組み合わせで result が決まる。生成の試験の種では承認と版を作れない（K-754）
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("GET /api/v1/clones/me/activity", () => {
  it("test_get_clones_me_activity_ok", () => {
    // EVENT-DRIVEN: WHEN GET /api/v1/clones/me/activity が「実行中・待ち・終わった・止まったを見て、チケットへ戻る」として呼ばれたとき THEN Kaname は「—」を行い 2xx を返す
    // 本物の試験：apps/api/test/features/F5/clone-room-activity.test.ts の「K754-API-001」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F5/clone-room-activity.test.ts", "utf8")).toContain("K754-API-001");
  });
  it("test_get_clones_me_activity_rejected_401", () => {
    // UNWANTED: IF セッションが無いか失効しているなら、Kaname は 401 を返し入り直しを促す（発行済みトークンの期限に頼らない）
    // 本物の試験：apps/api/test/features/F5/clone-room-activity.test.ts の「K754-API-018」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F5/clone-room-activity.test.ts", "utf8")).toContain("K754-API-018");
  });
  it("test_get_clones_me_activity_rejected_403", () => {
    // UNWANTED: IF 権限が無いなら、Kaname は 403 を返し副作用を一切起こさない（認可 → ポリシー → 承認 → 副作用 → 記録の順）
    // 本物の試験：apps/api/test/features/F5/clone-room-activity.test.ts の「K754-API-018」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F5/clone-room-activity.test.ts", "utf8")).toContain("K754-API-018");
  });
  it("test_get_clones_me_activity_rejected_422", () => {
    // UNWANTED: IF 入力が受け付けられないなら、Kaname は 422 と項目ごとの理由を返す（表記ゆらぎはサーバーで正規化してから判定）
    // 本物の試験：apps/api/test/features/F5/clone-room-activity.test.ts の「K754-API-019」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F5/clone-room-activity.test.ts", "utf8")).toContain("K754-API-019");
  });
  // 当てはまらない（上限は全部の口で同じ 1 か所の入口（op.ts・契約の rate_limit）が数える。この口は上限の振る舞いを自分で持たない（読むだけの口））：UNWANTED: IF 120/min/user を超えたら、Kaname は 429 と retry_after_sec を返す
  it.todo("test_get_clones_me_activity_rate_limited");
  it("test_get_clones_me_activity_terms_pending", () => {
    // UNWANTED: IF 同意し直しが要るセッションなら、Kaname は 403 と E-AUTH-010 を返し、副作用を起こさない
    // 本物の試験：apps/api/test/features/F1/terms.test.ts の「K53-API-005」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/terms.test.ts", "utf8")).toContain("K53-API-005");
  });
  // 当てはまらない（止めは全部の口で同じ 1 か所の入口（op.ts）。本物のログインで印を立てて止まることは apps/api/test/features/F1/mfa-gate.test.ts の K321-API-001〜011、口ごとの止めは作った口の生成の試験 mfa_pending が見る）：UNWANTED: IF 付けるまで進めないの印が立ったセッションなら、Kaname は 403 と MFA_REQUIRED を返し、副作用を起こさない
  it.todo("test_get_clones_me_activity_mfa_pending");
  it("test_get_clones_me_activity_session_unresolved", () => {
    // UNWANTED: IF 入口でセッションを解く所が落ちたなら、Kaname は 503 と E-PAGE-003 を返し、止める側に倒して副作用を起こさない
    // 本物の試験：apps/api/test/features/contract/k144-contract.test.ts の「K144-API-032」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/contract/k144-contract.test.ts", "utf8")).toContain("K144-API-032");
  });
});
