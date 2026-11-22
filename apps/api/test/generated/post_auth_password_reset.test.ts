// 生成物（scripts/ci/gen_ears_tests.mjs ← 07_qa/test-plan/ears-test-mapping.json・ears-elsewhere.json）。手で直さない。POST /api/v1/auth/password/reset
// 新しいパスワードを決める口は、本物の DB の verification・account・セッションの失効とロックで確かめる（K-314）
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("POST /api/v1/auth/password/reset", () => {
  it("test_post_auth_password_reset_ok", () => {
    // EVENT-DRIVEN: WHEN POST /api/v1/auth/password/reset が「メールを入れて届いたリンクから新しいパスワードを決める」として呼ばれたとき THEN Kaname は「全部のセッション（Bridge も）を失効」を行い 2xx を返す
    // 本物の試験：apps/api/test/features/F1/password-reset.test.ts の「K314-API-001 期限内のリンクで決める」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/password-reset.test.ts", "utf8")).toContain("K314-API-001 期限内のリンクで決める");
  });
  it("test_post_auth_password_reset_rejected_422", () => {
    // UNWANTED: IF 新しいパスワードが 12 文字より短いか 128 文字を超えるか漏れたものなら、Kaname は 422 と欄 new_password の理由を返し、端末を切らずパスワードを変えない
    // 本物の試験：apps/api/test/features/F1/password-reset.test.ts の「K314-API-009 新しいパスワード 11 文字は 422」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/password-reset.test.ts", "utf8")).toContain("K314-API-009 新しいパスワード 11 文字は 422");
  });
  it("test_post_auth_password_reset_gone", () => {
    // UNWANTED: IF リンクが期限切れ・使用済み・前のリンクなら、Kaname は 410 と次の一手を返し、パスワードを変えない
    // 本物の試験：apps/api/test/features/F1/password-reset.test.ts の「K314-API-003 期限切れ」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/password-reset.test.ts", "utf8")).toContain("K314-API-003 期限切れ");
  });
  it("test_post_auth_password_reset_conflict", () => {
    // UNWANTED: IF リンクが無い（でたらめ・空）なら、Kaname は 409 と E-PAGE-006 を返し、パスワードを変えない
    // 本物の試験：apps/api/test/features/F1/pm-fuzz-auth.test.ts の「K638-API-009」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/pm-fuzz-auth.test.ts", "utf8")).toContain("K638-API-009");
  });
  it("test_post_auth_password_reset_server_error", () => {
    // UNWANTED: IF 端末を切る所かパスワードを変える所で落ちたなら、Kaname は 500 と E-PAGE-003 を返し、リンクを使えるまま残す
    // 本物の試験：apps/api/test/features/F1/password-reset.test.ts の「K314-API-017 端末を切る所で失敗」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/password-reset.test.ts", "utf8")).toContain("K314-API-017 端末を切る所で失敗");
  });
  it("test_post_auth_password_reset_too_large", () => {
    // UNWANTED: IF 1 回に送る内容が 1MB（1,048,576 バイト）を超えたなら、Kaname は 413 と PAYLOAD_TOO_LARGE を返し、振る舞いに届かず何も書かない
    // 本物の試験：apps/api/test/features/contract/k144-contract.test.ts の「K144-API-042」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/contract/k144-contract.test.ts", "utf8")).toContain("K144-API-042");
  });
  it("test_post_auth_password_reset_rate_limited", () => {
    // UNWANTED: IF 10/min/ip を超えたら、Kaname は 429 と retry_after_sec を返す
    // 本物の試験：apps/api/test/features/F1/password-reset.test.ts の「K314-API-019 同じ IP から 1 分に 11 回」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/password-reset.test.ts", "utf8")).toContain("K314-API-019 同じ IP から 1 分に 11 回");
  });
  it("test_post_auth_password_reset_session_unresolved", () => {
    // UNWANTED: IF 入口でセッションを解く所が落ちたなら、Kaname は 503 と E-PAGE-003 を返し、止める側に倒して副作用を起こさない
    // 本物の試験：apps/api/test/features/contract/k144-contract.test.ts の「K144-API-032」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/contract/k144-contract.test.ts", "utf8")).toContain("K144-API-032");
  });
  it("test_post_auth_password_reset_shape", () => {
    // UBIQUITOUS: POST /api/v1/auth/password/reset の副作用は関門 C2・C6 を経由し、認可 → ポリシー → 承認 → 副作用 → 記録 の順で行う
    // 本物の試験：apps/api/test/features/F1/password-reset.test.ts の「K314-API-020 DB の中」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/password-reset.test.ts", "utf8")).toContain("K314-API-020 DB の中");
  });
});
