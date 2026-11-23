// 生成物（scripts/ci/gen_ears_tests.mjs ← 07_qa/test-plan/ears-test-mapping.json・ears-elsewhere.json）。手で直さない。POST /api/v1/auth/two-factor/verify
// 確認のコードで入るのは、本物のログインの部品（Better Auth の 2 段階の待ちの印・TOTP・バックアップコード・6 けたの止め）と、パスワードの段（K-301）の口で受け取った待ちの印で確かめる。生成の試験の偽のセッションでは確かめられない（K-302）
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("POST /api/v1/auth/two-factor/verify", () => {
  it("test_post_auth_two_factor_verify_ok", () => {
    // EVENT-DRIVEN: WHEN POST /api/v1/auth/two-factor/verify が「パスキーで入る／メールとパスワードと 6 桁で入る」として呼ばれたとき THEN Kaname は「セッション（操作が無ければ 12 時間・長くて 7 日）。5 回失敗で 15 分止める」を行い 2xx を返す
    // 本物の試験：apps/api/test/features/F1/sign-in-code.test.ts の「K302-API-001」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/sign-in-code.test.ts", "utf8")).toContain("K302-API-001");
  });
  it("test_post_auth_two_factor_verify_rejected_422", () => {
    // UNWANTED: IF 同じ冪等キーで二度来たら、Kaname は最初の結果を返し副作用を繰り返さない
    // 本物の試験：apps/api/test/features/F1/sign-in-code.test.ts の「K302-API-015」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/sign-in-code.test.ts", "utf8")).toContain("K302-API-015");
  });
  it("test_post_auth_two_factor_verify_rejected_422_2", () => {
    // UNWANTED: IF 本文に知らない欄があるか、コードが 1 つでないなら、Kaname は 422 を返し、失敗の数に入れない
    // 本物の試験：apps/api/test/features/F1/sign-in-code.test.ts の「K302-API-012」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/sign-in-code.test.ts", "utf8")).toContain("K302-API-012");
  });
  it("test_post_auth_two_factor_verify_rejected_401", () => {
    // UNWANTED: IF コードが違うなら、Kaname は 401 と E-AUTH-004 を返し、セッションを作らず失敗の数に入れる
    // 本物の試験：apps/api/test/features/F1/sign-in-code.test.ts の「K302-API-006」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/sign-in-code.test.ts", "utf8")).toContain("K302-API-006");
  });
  it("test_post_auth_two_factor_verify_rejected_401_2", () => {
    // UNWANTED: IF 待ちの印が切れているかコードが違うなら、Kaname は 401 を返し、セッションを作らない
    // 本物の試験：apps/api/test/features/F1/sign-in-code.test.ts の「K302-API-003」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/sign-in-code.test.ts", "utf8")).toContain("K302-API-003");
  });
  it("test_post_auth_two_factor_verify_rejected_403", () => {
    // UNWANTED: IF コードは合っているが会社の人が無いなら、Kaname は 403 と E-AUTH-007 を返し、生きたセッションを残さない
    // 本物の試験：apps/api/test/features/F1/sign-in-code.test.ts の「K302-API-016」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/sign-in-code.test.ts", "utf8")).toContain("K302-API-016");
  });
  it("test_post_auth_two_factor_verify_rejected_422_3", () => {
    // UNWANTED: IF コードが空か 64 文字を超えるなら、Kaname は 422 と E-VAL-009 を返し、部品を呼ばず失敗の数に入れない
    // 本物の試験：apps/api/test/features/F1/sign-in-code.test.ts の「K302-API-012」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/sign-in-code.test.ts", "utf8")).toContain("K302-API-012");
  });
  it("test_post_auth_two_factor_verify_rate_limited", () => {
    // UNWANTED: IF 6 けたを 5 回続けて違えたなら、Kaname は 429 と待つ秒数を返し、15 分は正しいコードでも入れない
    // 本物の試験：apps/api/test/features/F1/sign-in-code.test.ts の「K302-API-007」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/sign-in-code.test.ts", "utf8")).toContain("K302-API-007");
  });
  it("test_post_auth_two_factor_verify_session_unresolved", () => {
    // UNWANTED: IF セッションを写す所が落ちたなら、Kaname は 503 と E-PAGE-003 を返し、認証側のセッションも残さない
    // 本物の試験：apps/api/test/features/F1/sign-in-code.test.ts の「K302-API-017」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/sign-in-code.test.ts", "utf8")).toContain("K302-API-017");
  });
  it("test_post_auth_two_factor_verify_rejected_403_2", () => {
    // UNWANTED: IF 人かワークスペースが止められているなら、Kaname は 403 と止めの理由の文を返し、セッションを作らない
    // 本物の試験：apps/api/test/features/F1/sign-in-code-gate.test.ts の「K305-API-022」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/sign-in-code-gate.test.ts", "utf8")).toContain("K305-API-022");
  });
  it("test_post_auth_two_factor_verify_unavailable", () => {
    // UNWANTED: IF 止めの確かめができなかったなら、Kaname は 503 を返し、セッションを作らない
    // 本物の試験：apps/api/test/features/F1/sign-in-code-gate.test.ts の「K305-API-023」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/sign-in-code-gate.test.ts", "utf8")).toContain("K305-API-023");
  });
  it("test_post_auth_two_factor_verify_too_large", () => {
    // UNWANTED: IF 1 回に送る内容が 1MB（1,048,576 バイト）を超えたなら、Kaname は 413 と PAYLOAD_TOO_LARGE を返し、振る舞いに届かず何も書かない
    // 本物の試験：apps/api/test/features/contract/k144-contract.test.ts の「K144-API-042」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/contract/k144-contract.test.ts", "utf8")).toContain("K144-API-042");
  });
  it("test_post_auth_two_factor_verify_rate_limited_2", () => {
    // UNWANTED: IF 10/min/ip を超えたら、Kaname は 429 と retry_after_sec を返す
    // 本物の試験：apps/api/test/features/F1/sign-in-code.test.ts の「K302-API-018」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/sign-in-code.test.ts", "utf8")).toContain("K302-API-018");
  });
  it("test_post_auth_two_factor_verify_session_unresolved_2", () => {
    // UNWANTED: IF 入口でセッションを解く所が落ちたなら、Kaname は 503 と E-PAGE-003 を返し、止める側に倒して副作用を起こさない
    // 本物の試験：apps/api/test/features/contract/k144-contract.test.ts の「K144-API-032」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/contract/k144-contract.test.ts", "utf8")).toContain("K144-API-032");
  });
  it("test_post_auth_two_factor_verify_shape", () => {
    // UBIQUITOUS: POST /api/v1/auth/two-factor/verify の副作用は関門 C2 を経由し、認可 → ポリシー → 承認 → 副作用 → 記録 の順で行う
    // 本物の試験：apps/api/test/features/F1/sign-in-code.test.ts の「K302-API-021」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/sign-in-code.test.ts", "utf8")).toContain("K302-API-021");
  });
});
