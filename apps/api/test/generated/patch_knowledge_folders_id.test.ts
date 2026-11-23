// 生成物（scripts/ci/gen_ears_tests.mjs ← 07_qa/test-plan/ears-test-mapping.json・ears-elsewhere.json）。手で直さない。PATCH /api/v1/knowledge/folders/:id
// フォルダを直す・動かすは棚・役・循環・深さ・同じ名前で変わる。生成の試験の偽のセッションでは作れない（K-678）
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("PATCH /api/v1/knowledge/folders/:id", () => {
  it("test_patch_knowledge_folders_id_ok", () => {
    // EVENT-DRIVEN: WHEN PATCH /api/v1/knowledge/folders/:id が「層ごとのページを書く・直す」として呼ばれたとき THEN Kaname は「版を残す」を行い 2xx を返す
    // 本物の試験：apps/api/test/features/F9/knowledge-folders.test.ts の「K678-API-008」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F9/knowledge-folders.test.ts", "utf8")).toContain("K678-API-008");
  });
  it("test_patch_knowledge_folders_id_rejected_401", () => {
    // UNWANTED: IF セッションが無いか失効しているなら、Kaname は 401 を返し入り直しを促す（発行済みトークンの期限に頼らない）
    // 本物の試験：apps/api/test/features/F9/knowledge-folders.test.ts の「K678-API-019」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F9/knowledge-folders.test.ts", "utf8")).toContain("K678-API-019");
  });
  it("test_patch_knowledge_folders_id_rejected_403", () => {
    // UNWANTED: IF フォルダに書けない人なら、Kaname は 403 を返し、何も変えない
    // 本物の試験：apps/api/test/features/F9/knowledge-folders.test.ts の「K678-API-013」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F9/knowledge-folders.test.ts", "utf8")).toContain("K678-API-013");
  });
  it("test_patch_knowledge_folders_id_not_found", () => {
    // UNWANTED: IF フォルダが無いか見えないなら、Kaname は 404 を返し、在るかを漏らさず何も変えない
    // 本物の試験：apps/api/test/features/F9/knowledge-folders.test.ts の「K678-API-013」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F9/knowledge-folders.test.ts", "utf8")).toContain("K678-API-013");
  });
  it("test_patch_knowledge_folders_id_rejected_422", () => {
    // UNWANTED: IF 入力が決まりに合わないなら、Kaname は 422 と欄ごとの理由を返し、何も変えない
    // 本物の試験：apps/api/test/features/F9/knowledge-base.test.ts の「K675-API-003」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F9/knowledge-base.test.ts", "utf8")).toContain("K675-API-003");
  });
  it("test_patch_knowledge_folders_id_conflict", () => {
    // UNWANTED: IF 同じ場所に同じ名前のフォルダがあるなら、Kaname は 409 と E-KNW-020 を返し、ページもフォルダも変えない
    // 本物の試験：apps/api/test/features/F9/knowledge-folders.test.ts の「K678-API-008」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F9/knowledge-folders.test.ts", "utf8")).toContain("K678-API-008");
  });
  it("test_patch_knowledge_folders_id_conflict_2", () => {
    // UNWANTED: IF フォルダの深さが 6 を超えるなら、Kaname は 409 と E-KNW-021 を返し、ページもフォルダも変えない
    // 本物の試験：apps/api/test/features/F9/knowledge-folders.test.ts の「K678-API-012」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F9/knowledge-folders.test.ts", "utf8")).toContain("K678-API-012");
  });
  it("test_patch_knowledge_folders_id_conflict_3", () => {
    // UNWANTED: IF フォルダを自分の中へ動かそうとしたなら、Kaname は 409 と E-KNW-022 を返し、ページもフォルダも変えない
    // 本物の試験：apps/api/test/features/F9/knowledge-folders.test.ts の「K678-API-010」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F9/knowledge-folders.test.ts", "utf8")).toContain("K678-API-010");
  });
  it("test_patch_knowledge_folders_id_conflict_4", () => {
    // UNWANTED: IF フォルダを別の棚へ動かそうとしたなら、Kaname は 409 と E-KNW-023 を返し、ページもフォルダも変えない
    // 本物の試験：apps/api/test/features/F9/knowledge-folders.test.ts の「K678-API-011」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F9/knowledge-folders.test.ts", "utf8")).toContain("K678-API-011");
  });
  it("test_patch_knowledge_folders_id_session_unresolved", () => {
    // UNWANTED: IF DB が使えないなら、Kaname は 503 と E-PAGE-003 を返し、ページもフォルダも変えない
    // 本物の試験：apps/api/test/features/contract/k144-contract.test.ts の「K144-API-032」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/contract/k144-contract.test.ts", "utf8")).toContain("K144-API-032");
  });
  it("test_patch_knowledge_folders_id_too_large", () => {
    // UNWANTED: IF 1 回に送る内容が 1MB（1,048,576 バイト）を超えたなら、Kaname は 413 と PAYLOAD_TOO_LARGE を返し、振る舞いに届かず何も書かない
    // 本物の試験：apps/api/test/features/contract/k144-contract.test.ts の「K144-API-042」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/contract/k144-contract.test.ts", "utf8")).toContain("K144-API-042");
  });
  it("test_patch_knowledge_folders_id_rate_limited", () => {
    // UNWANTED: IF 60/min/user を超えたら、Kaname は 429 と retry_after_sec を返す
    // 本物の試験：apps/api/test/features/F9/knowledge-folders.test.ts の「K678-API-020」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F9/knowledge-folders.test.ts", "utf8")).toContain("K678-API-020");
  });
  it("test_patch_knowledge_folders_id_terms_pending", () => {
    // UNWANTED: IF 同意し直しが要るセッションなら、Kaname は 403 と E-AUTH-010 を返し、副作用を起こさない
    // 本物の試験：apps/api/test/features/F1/terms.test.ts の「K53-API-005」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F1/terms.test.ts", "utf8")).toContain("K53-API-005");
  });
  // 当てはまらない（止めは全部の口で同じ 1 か所の入口（op.ts）。本物のログインで印を立てて止まることは apps/api/test/features/F1/mfa-gate.test.ts の K321-API-001〜011、口ごとの止めは作った口の生成の試験 mfa_pending が見る）：UNWANTED: IF 付けるまで進めないの印が立ったセッションなら、Kaname は 403 と MFA_REQUIRED を返し、副作用を起こさない
  it.todo("test_patch_knowledge_folders_id_mfa_pending");
  it("test_patch_knowledge_folders_id_session_unresolved_2", () => {
    // UNWANTED: IF 入口でセッションを解く所が落ちたなら、Kaname は 503 と E-PAGE-003 を返し、止める側に倒して副作用を起こさない
    // 本物の試験：apps/api/test/features/contract/k144-contract.test.ts の「K144-API-032」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/contract/k144-contract.test.ts", "utf8")).toContain("K144-API-032");
  });
  it("test_patch_knowledge_folders_id_shape", () => {
    // UBIQUITOUS: PATCH /api/v1/knowledge/folders/:id の副作用は関門 C2 を経由し、認可 → ポリシー → 承認 → 副作用 → 記録 の順で行う
    // 本物の試験：apps/api/test/features/F9/knowledge-folders.test.ts の「K678-API-008」（同じ CI の G3 で流れる）
    expect(readFileSync("apps/api/test/features/F9/knowledge-folders.test.ts", "utf8")).toContain("K678-API-008");
  });
});
