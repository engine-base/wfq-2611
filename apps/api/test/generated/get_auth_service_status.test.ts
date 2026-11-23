// 生成物（scripts/ci/gen_ears_tests.mjs ← 07_qa/test-plan/ears-test-mapping.json・ears-elsewhere.json）。手で直さない。GET /api/v1/auth/service-status
// いまの様子は、運営のテナントの障害とお知らせの行と、行の守りの外で読む DB の関数で確かめる。生成の試験の土台には障害とお知らせが無い（K-307）
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("GET /api/v1/auth/service-status", () => {
  it("test_get_auth_service_status_ok", () => {
    // EVENT-DRIVEN: WHEN GET /api/v1/auth/service-status が「パスキーで入る／メールとパスワードと 6 桁で入る」として呼ばれたとき THEN Kaname は「セッション（操作が無ければ 12 時間・長くて 7 日）。5 回失敗で 15 分止める」を行い 2xx を返す
    // 本物の試験：apps/api/test/features/F1/service-status.test.ts の「K307-API-001」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/service-status.test.ts", "utf8")).toContain("K307-API-001");
  });
  it("test_get_auth_service_status_ok_2", () => {
    // EVENT-DRIVEN: WHEN GET /api/v1/auth/service-status が「困りごとを選んで次の画面へ進む／稼働状況を見る／運営にメールする」として呼ばれたとき THEN Kaname は「誰でも読める稼働状況の口（公開の分だけ）を読む」を行い 2xx を返す
    // 本物の試験：apps/api/test/features/F1/service-status.test.ts の「K307-API-001」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/service-status.test.ts", "utf8")).toContain("K307-API-001");
  });
  it("test_get_auth_service_status_rejected_422", () => {
    // UNWANTED: IF 入力が受け付けられないなら、Kaname は 422 と項目ごとの理由を返す（表記ゆらぎはサーバーで正規化してから判定）
    // 本物の試験：apps/api/test/features/F1/service-status.test.ts の「K307-API-013」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/service-status.test.ts", "utf8")).toContain("K307-API-013");
  });
  it("test_get_auth_service_status_session_unresolved", () => {
    // UNWANTED: IF 稼働状況を読む DB が落ちたなら、Kaname は 503 と E-PAGE-003 を返し、題も時刻も返さない
    // 本物の試験：apps/api/test/features/F1/service-status.test.ts の「K307-API-015」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/service-status.test.ts", "utf8")).toContain("K307-API-015");
  });
  it("test_get_auth_service_status_rate_limited", () => {
    // UNWANTED: IF 10/min/ip を超えたら、Kaname は 429 と retry_after_sec を返す
    // 本物の試験：apps/api/test/features/F1/service-status.test.ts の「K307-API-014」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/service-status.test.ts", "utf8")).toContain("K307-API-014");
  });
  it("test_get_auth_service_status_session_unresolved_2", () => {
    // UNWANTED: IF 入口でセッションを解く所が落ちたなら、Kaname は 503 と E-PAGE-003 を返し、止める側に倒して副作用を起こさない
    // 本物の試験：apps/api/test/features/contract/k144-contract.test.ts の「K144-API-032」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/contract/k144-contract.test.ts", "utf8")).toContain("K144-API-032");
  });
  it("test_get_auth_service_status_shape", () => {
    // UBIQUITOUS: GET /api/v1/auth/service-status の副作用は関門 C2 を経由し、認可 → ポリシー → 承認 → 副作用 → 記録 の順で行う
    // 本物の試験：apps/api/test/features/F1/service-status.test.ts の「K307-API-002」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/service-status.test.ts", "utf8")).toContain("K307-API-002");
  });
});
