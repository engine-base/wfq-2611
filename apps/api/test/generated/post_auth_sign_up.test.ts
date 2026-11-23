// 生成物（scripts/ci/gen_ears_tests.mjs ← 07_qa/test-plan/ears-test-mapping.json・ears-elsewhere.json）。手で直さない。POST /api/v1/auth/sign-up
// 登録は、申し込みの印・漏れたパスワードの照合（関門 C1）・確認のメール（関門 C6）を本物の DB と差し込んだ送出先で確かめる。生成の試験の偽のセッションと土台では確かめられない（K-51）
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("POST /api/v1/auth/sign-up", () => {
  it("test_post_auth_sign_up_ok", () => {
    // EVENT-DRIVEN: WHEN POST /api/v1/auth/sign-up が「名前・メール・パスワード・会社名（空でもよい）を入れる」として呼ばれたとき THEN Kaname は「テナント（会社／個人）と本人を作る。保留の申し込みを暗号化して 30 分」を行い 2xx を返す
    // 本物の試験：apps/api/test/features/F1/sign-up.test.ts の「K51-API-001 無し × 登録の画面から送る」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/sign-up.test.ts", "utf8")).toContain("K51-API-001 無し × 登録の画面から送る");
  });
  it("test_post_auth_sign_up_ok_2", () => {
    // EVENT-DRIVEN: WHEN POST /api/v1/auth/sign-up が「規約とプライバシーポリシーを読んで同意する」として呼ばれたとき THEN Kaname は「同意した版と時刻を残す。版が上がったら次のログインで同意を取り直す」を行い 2xx を返す
    // 本物の試験：apps/api/test/features/F1/sign-up.test.ts の「K51-API-027 規約の版」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/sign-up.test.ts", "utf8")).toContain("K51-API-027 規約の版");
  });
  // 本物の試験はまだ無い（apps/api/test/features/F1/sign-up.test.ts）：UNWANTED: IF 同じ冪等キーで二度来たら、Kaname は最初の結果を返し副作用を繰り返さない
  it.todo("test_post_auth_sign_up_rejected_422");
  it("test_post_auth_sign_up_rejected_422_2", () => {
    // UNWANTED: IF 入力が受け付けられないなら、Kaname は 422 と項目ごとの理由を返す（表記ゆらぎはサーバーで正規化してから判定）
    // 本物の試験：apps/api/test/features/F1/sign-up.test.ts の「K51-API-011 メールが空・形が違う」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/sign-up.test.ts", "utf8")).toContain("K51-API-011 メールが空・形が違う");
  });
  it("test_post_auth_sign_up_session_unresolved", () => {
    // UNWANTED: IF 規約の版を読む DB か申し込みを書く DB が落ちたなら、Kaname は 503 と E-PAGE-003 を返し、申し込みを作らずメールも送らない
    // 本物の試験：apps/api/test/features/F1/sign-up.test.ts の「K51-API-021」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/sign-up.test.ts", "utf8")).toContain("K51-API-021");
  });
  it("test_post_auth_sign_up_too_large", () => {
    // UNWANTED: IF 1 回に送る内容が 1MB（1,048,576 バイト）を超えたなら、Kaname は 413 と PAYLOAD_TOO_LARGE を返し、振る舞いに届かず何も書かない
    // 本物の試験：apps/api/test/features/contract/k144-contract.test.ts の「K144-API-042」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/contract/k144-contract.test.ts", "utf8")).toContain("K144-API-042");
  });
  it("test_post_auth_sign_up_rate_limited", () => {
    // UNWANTED: IF 10/min/ip を超えたら、Kaname は 429 と retry_after_sec を返す
    // 本物の試験：apps/api/test/features/F1/sign-up.test.ts の「K51-API-023 1 分に 11 回」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/sign-up.test.ts", "utf8")).toContain("K51-API-023 1 分に 11 回");
  });
  it("test_post_auth_sign_up_session_unresolved_2", () => {
    // UNWANTED: IF 入口でセッションを解く所が落ちたなら、Kaname は 503 と E-PAGE-003 を返し、止める側に倒して副作用を起こさない
    // 本物の試験：apps/api/test/features/contract/k144-contract.test.ts の「K144-API-032」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/contract/k144-contract.test.ts", "utf8")).toContain("K144-API-032");
  });
  // 本物の試験はまだ無い（apps/api/test/features/F1/sign-up.test.ts）：UBIQUITOUS: POST /api/v1/auth/sign-up の副作用は関門 C2 を経由し、認可 → ポリシー → 承認 → 副作用 → 記録 の順で行う
  it.todo("test_post_auth_sign_up_shape");
});
