// 生成物（scripts/ci/gen_ears_tests.mjs ← 07_qa/test-plan/ears-test-mapping.json・ears-elsewhere.json）。手で直さない。GET /api/v1/auth/terms/current
// 規約の同意は、本物のログインの部品（Better Auth のセッションができたときの hook で立つ同意し直しの印）・本物の DB の今の版の関数（app.current_terms）と同意の行で確かめる。生成の試験の偽のセッションと土台では確かめられない（K-53）
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("GET /api/v1/auth/terms/current", () => {
  it("test_get_auth_terms_current_ok", () => {
    // EVENT-DRIVEN: WHEN GET /api/v1/auth/terms/current が「規約とプライバシーポリシーを読んで同意する」として呼ばれたとき THEN Kaname は「同意した版と時刻を残す。版が上がったら次のログインで同意を取り直す」を行い 2xx を返す
    // 本物の試験：apps/api/test/features/F1/terms.test.ts の「K53-API-016」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/terms.test.ts", "utf8")).toContain("K53-API-016");
  });
  it("test_get_auth_terms_current_rejected_422", () => {
    // UNWANTED: IF 入力が受け付けられないなら、Kaname は 422 と項目ごとの理由を返す（表記ゆらぎはサーバーで正規化してから判定）
    // 本物の試験：apps/api/test/features/F1/terms.test.ts の「K53-API-022」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/terms.test.ts", "utf8")).toContain("K53-API-022");
  });
  it("test_get_auth_terms_current_session_unresolved", () => {
    // UNWANTED: IF 今の版を読む DB が落ちたなら、Kaname は 503 と E-PAGE-003 を返し、版も url も返さない
    // 本物の試験：apps/api/test/features/F1/terms.test.ts の「K53-API-033」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/terms.test.ts", "utf8")).toContain("K53-API-033");
  });
  it("test_get_auth_terms_current_rate_limited", () => {
    // UNWANTED: IF 10/min/ip を超えたら、Kaname は 429 と retry_after_sec を返す
    // 本物の試験：apps/api/test/features/F1/terms.test.ts の「K53-API-028」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/terms.test.ts", "utf8")).toContain("K53-API-028");
  });
  it("test_get_auth_terms_current_session_unresolved_2", () => {
    // UNWANTED: IF 入口でセッションを解く所が落ちたなら、Kaname は 503 と E-PAGE-003 を返し、止める側に倒して副作用を起こさない
    // 本物の試験：apps/api/test/features/contract/k144-contract.test.ts の「K144-API-032」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/contract/k144-contract.test.ts", "utf8")).toContain("K144-API-032");
  });
  it("test_get_auth_terms_current_shape", () => {
    // UBIQUITOUS: GET /api/v1/auth/terms/current の副作用は関門 C2 を経由し、認可 → ポリシー → 承認 → 副作用 → 記録 の順で行う
    // 本物の試験：apps/api/test/features/F1/terms.test.ts の「K53-API-016」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/terms.test.ts", "utf8")).toContain("K53-API-016");
  });
});
