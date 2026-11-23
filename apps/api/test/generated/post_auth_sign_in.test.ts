// 生成物（scripts/ci/gen_ears_tests.mjs ← 07_qa/test-plan/ears-test-mapping.json・ears-elsewhere.json）。手で直さない。POST /api/v1/auth/sign-in
// パスワードで入るのは、本物のログインの部品（Better Auth の本人・2 段階・セッション）と DB のロック（app.login_attempts）・差し込んだ送出先（関門 C6 の新しい端末の知らせ）で確かめる。生成の試験の偽のセッションでは確かめられない（K-301）
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("POST /api/v1/auth/sign-in", () => {
  it("test_post_auth_sign_in_ok", () => {
    // EVENT-DRIVEN: WHEN POST /api/v1/auth/sign-in が「パスキーで入る／メールとパスワードと 6 桁で入る」として呼ばれたとき THEN Kaname は「セッション（操作が無ければ 12 時間・長くて 7 日）。5 回失敗で 15 分止める」を行い 2xx を返す
    // 本物の試験：apps/api/test/features/F1/sign-in.test.ts の「K301-API-001」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/sign-in.test.ts", "utf8")).toContain("K301-API-001");
  });
  it("test_post_auth_sign_in_rejected_422", () => {
    // UNWANTED: IF 同じ冪等キーで二度来たら、Kaname は最初の結果を返し副作用を繰り返さない
    // 本物の試験：apps/api/test/features/F1/sign-in.test.ts の「K301-API-015」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/sign-in.test.ts", "utf8")).toContain("K301-API-015");
  });
  it("test_post_auth_sign_in_rejected_422_2", () => {
    // UNWANTED: IF 本文に知らない欄があるなら、Kaname は 422 と項目ごとの理由を返し、DB を引かず失敗の数に入れない
    // 本物の試験：apps/api/test/features/F1/sign-in.test.ts の「K301-API-013」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/sign-in.test.ts", "utf8")).toContain("K301-API-013");
  });
  it("test_post_auth_sign_in_rejected_401", () => {
    // UNWANTED: IF メールアドレスかパスワードが違うなら、Kaname は 401 と残り回数を返し、登録の有無を漏らさない
    // 本物の試験：apps/api/test/features/F1/sign-in.test.ts の「K301-API-003」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/sign-in.test.ts", "utf8")).toContain("K301-API-003");
  });
  it("test_post_auth_sign_in_rejected_403", () => {
    // UNWANTED: IF パスワードは合っているが会社の人が無いなら、Kaname は 403 と E-AUTH-007 を返し、生きたセッションを残さない
    // 本物の試験：apps/api/test/features/F1/sign-in.test.ts の「K301-API-014」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/sign-in.test.ts", "utf8")).toContain("K301-API-014");
  });
  it("test_post_auth_sign_in_rejected_403_2", () => {
    // UNWANTED: IF 人かワークスペースが止められているなら、Kaname は 403 と止めの理由の文を返し、セッションを作らない
    // 本物の試験：apps/api/test/features/F1/login-gate.test.ts の「K303-API-001」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/login-gate.test.ts", "utf8")).toContain("K303-API-001");
  });
  it("test_post_auth_sign_in_rejected_422_3", () => {
    // UNWANTED: IF メールアドレスかパスワードが空なら、Kaname は 422 と E-VAL-008 を返し、DB を引かず失敗の数に入れない
    // 本物の試験：apps/api/test/features/F1/sign-in.test.ts の「K301-API-009」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/sign-in.test.ts", "utf8")).toContain("K301-API-009");
  });
  it("test_post_auth_sign_in_rejected_422_4", () => {
    // UNWANTED: IF メールアドレスの形が違うなら、Kaname は 422 と E-VAL-004 を返し、失敗の数に入れない
    // 本物の試験：apps/api/test/features/F1/sign-in.test.ts の「K301-API-010」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/sign-in.test.ts", "utf8")).toContain("K301-API-010");
  });
  it("test_post_auth_sign_in_rate_limited", () => {
    // UNWANTED: IF 5 回続けて違えたなら、Kaname は 429 と待つ秒数を返し、15 分は正しいパスワードでも入れない
    // 本物の試験：apps/api/test/features/F1/sign-in.test.ts の「K301-API-004」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/sign-in.test.ts", "utf8")).toContain("K301-API-004");
  });
  it("test_post_auth_sign_in_session_unresolved", () => {
    // UNWANTED: IF ロックを見る DB かセッションを写す所が落ちたなら、Kaname は 503 と E-PAGE-003 を返し、半分だけ入った状態を残さず失敗の数に入れない
    // 本物の試験：apps/api/test/features/F1/sign-in.test.ts の「K301-API-019」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/sign-in.test.ts", "utf8")).toContain("K301-API-019");
  });
  it("test_post_auth_sign_in_unavailable", () => {
    // UNWANTED: IF 止めの確かめができなかったなら、Kaname は 503 を返し、セッションを作らない
    // 本物の試験：apps/api/test/features/F1/login-gate.test.ts の「K303-API-010」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/login-gate.test.ts", "utf8")).toContain("K303-API-010");
  });
  it("test_post_auth_sign_in_too_large", () => {
    // UNWANTED: IF 1 回に送る内容が 1MB（1,048,576 バイト）を超えたなら、Kaname は 413 と PAYLOAD_TOO_LARGE を返し、振る舞いに届かず何も書かない
    // 本物の試験：apps/api/test/features/contract/k144-contract.test.ts の「K144-API-042」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/contract/k144-contract.test.ts", "utf8")).toContain("K144-API-042");
  });
  it("test_post_auth_sign_in_rate_limited_2", () => {
    // UNWANTED: IF 10/min/ip を超えたら、Kaname は 429 と retry_after_sec を返す
    // 本物の試験：apps/api/test/features/F1/sign-in.test.ts の「K301-API-020」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/sign-in.test.ts", "utf8")).toContain("K301-API-020");
  });
  it("test_post_auth_sign_in_session_unresolved_2", () => {
    // UNWANTED: IF 入口でセッションを解く所が落ちたなら、Kaname は 503 と E-PAGE-003 を返し、止める側に倒して副作用を起こさない
    // 本物の試験：apps/api/test/features/contract/k144-contract.test.ts の「K144-API-032」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/contract/k144-contract.test.ts", "utf8")).toContain("K144-API-032");
  });
  it("test_post_auth_sign_in_shape", () => {
    // UBIQUITOUS: POST /api/v1/auth/sign-in の副作用は関門 C2 を経由し、認可 → ポリシー → 承認 → 副作用 → 記録 の順で行う
    // 本物の試験：apps/api/test/features/F1/sign-in.test.ts の「K301-API-024」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/sign-in.test.ts", "utf8")).toContain("K301-API-024");
  });
});
