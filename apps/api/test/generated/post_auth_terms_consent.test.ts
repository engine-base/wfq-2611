// 生成物（scripts/ci/gen_ears_tests.mjs ← 07_qa/test-plan/ears-test-mapping.json・ears-elsewhere.json）。手で直さない。POST /api/v1/auth/terms/consent
// 規約の同意は、本物のログインの部品（Better Auth のセッションができたときの hook で立つ同意し直しの印）・本物の DB の今の版の関数（app.current_terms）と同意の行で確かめる。生成の試験の偽のセッションと土台では確かめられない（K-53）
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("POST /api/v1/auth/terms/consent", () => {
  it("test_post_auth_terms_consent_ok", () => {
    // EVENT-DRIVEN: WHEN POST /api/v1/auth/terms/consent が「規約とプライバシーポリシーを読んで同意する」として呼ばれたとき THEN Kaname は「同意した版と時刻を残す。版が上がったら次のログインで同意を取り直す」を行い 2xx を返す
    // 本物の試験：apps/api/test/features/F1/terms.test.ts の「K53-API-004」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/terms.test.ts", "utf8")).toContain("K53-API-004");
  });
  it("test_post_auth_terms_consent_rejected_401", () => {
    // UNWANTED: IF セッションが無いか失効しているなら、Kaname は 401 を返し入り直しを促す（発行済みトークンの期限に頼らない）
    // 本物の試験：apps/api/test/features/F1/terms.test.ts の「K53-API-017」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/terms.test.ts", "utf8")).toContain("K53-API-017");
  });
  it("test_post_auth_terms_consent_rejected_403", () => {
    // UNWANTED: IF 権限が無いなら、Kaname は 403 を返し副作用を一切起こさない（認可 → ポリシー → 承認 → 副作用 → 記録の順）
    // 本物の試験：apps/api/test/features/F1/terms.test.ts の「K53-API-034」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/terms.test.ts", "utf8")).toContain("K53-API-034");
  });
  it("test_post_auth_terms_consent_conflict", () => {
    // UNWANTED: IF 同意する版が今の版でないなら、Kaname は 409 と今の版の並び current を返し、同意の行を書かない
    // 本物の試験：apps/api/test/features/F1/terms.test.ts の「K53-API-013」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/terms.test.ts", "utf8")).toContain("K53-API-013");
  });
  it("test_post_auth_terms_consent_rejected_422", () => {
    // UNWANTED: IF 同意の印が無いか版の ID が受け付けられないなら、Kaname は 422 と項目ごとの理由（同意の印が無いときは E-VAL-019）を返し、同意の行を書かない
    // 本物の試験：apps/api/test/features/F1/terms.test.ts の「K53-API-018」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/terms.test.ts", "utf8")).toContain("K53-API-018");
  });
  it("test_post_auth_terms_consent_session_unresolved", () => {
    // UNWANTED: IF 同意を書く DB が落ちたなら、Kaname は 503 と E-PAGE-003 を返し、同意の行もセッションの印も変えない
    // 本物の試験：apps/api/test/features/F1/terms.test.ts の「K53-API-024」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/terms.test.ts", "utf8")).toContain("K53-API-024");
  });
  it("test_post_auth_terms_consent_too_large", () => {
    // UNWANTED: IF 1 回に送る内容が 1MB（1,048,576 バイト）を超えたなら、Kaname は 413 と PAYLOAD_TOO_LARGE を返し、振る舞いに届かず何も書かない
    // 本物の試験：apps/api/test/features/contract/k144-contract.test.ts の「K144-API-042」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/contract/k144-contract.test.ts", "utf8")).toContain("K144-API-042");
  });
  it("test_post_auth_terms_consent_rate_limited", () => {
    // UNWANTED: IF 60/min/user を超えたら、Kaname は 429 と retry_after_sec を返す
    // 本物の試験：apps/api/test/features/F1/terms.test.ts の「K53-API-027」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/terms.test.ts", "utf8")).toContain("K53-API-027");
  });
  it("test_post_auth_terms_consent_session_unresolved_2", () => {
    // UNWANTED: IF 入口でセッションを解く所が落ちたなら、Kaname は 503 と E-PAGE-003 を返し、止める側に倒して副作用を起こさない
    // 本物の試験：apps/api/test/features/contract/k144-contract.test.ts の「K144-API-032」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/contract/k144-contract.test.ts", "utf8")).toContain("K144-API-032");
  });
  it("test_post_auth_terms_consent_shape", () => {
    // UBIQUITOUS: POST /api/v1/auth/terms/consent の副作用は関門 C2 を経由し、認可 → ポリシー → 承認 → 副作用 → 記録 の順で行う
    // 本物の試験：apps/api/test/features/F1/terms.test.ts の「K53-API-030」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/terms.test.ts", "utf8")).toContain("K53-API-030");
  });
});
