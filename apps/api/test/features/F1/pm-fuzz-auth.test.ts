// K-638「認証の口の契約 fuzz の借り」の単体の試験（口・本物の DB・本物のログインの部品）。名前の頭の行 ID（K638-API-…）は 11_tickets/K-638.md の表と 1 対 1。
// 土台は login.harness.ts（K-301 が持ち込む）。テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。
//   形どおりの入力（契約に合う入力）は、422 で断らない。形の誤りは契約に書いた形のとおり 422。リンクが DB に無いのは 409 E-PAGE-006（410・422 でない）。
//   上限（1 分に 10 回・IP ごと）を避けるため、要求ごとに別の IP で送る（harness の req が要求ごとに IP を替える）。
import { describe, expect, it } from "vitest";
import { resetWorkIdle } from "../../../src/features/F1/password-reset/index.js";
import { awayFromStepEdge, mails, msg, pendingOf, setupLogin, totp } from "./login.harness.js";

const h = setupLogin("k638");
const FORGOT = "/api/v1/auth/password/forgot";
const RESET = "/api/v1/auth/password/reset";
const ADMIN_REQUEST = "/api/v1/auth/recovery/admin-request";

/** 422 の欄：details の並び（入口・前処理の形）か、detail.field（正本のエラーの形・forgot と sign-in の E-VAL-004） */
const fieldsOf = (j: Record<string, unknown>): string[] => [
  ...((j["details"] as { field: string }[] | undefined) ?? []).map((d) => d.field),
  ...[(j["detail"] as { field?: string } | undefined)?.field].filter((x): x is string => typeof x === "string"),
];
const failedCount = async (userId: string): Promise<number> =>
  Number(
    (
      await h.admin.query<{ n: number }>(
        'select "failedVerificationCount" as n from kaname_auth."twoFactor" where "userId" = $1',
        [userId],
      )
    ).rows[0]!.n,
  );

describe("K-638 再設定のメールを頼む：形どおりのメールは 201、形の誤りだけ 422", () => {
  it("K638-API-001 形どおりのメール（登録している人・登録していない人・大文字と前後の空白つき）：どれも 201 { accepted: true }。422 にしない", async () => {
    const u = await h.makeUser("fg1");
    for (const e of [` ${u.email.toUpperCase()} `, h.email("fg1-nobody"), "a@b.co"]) {
      const r = await h.req("POST", FORGOT, { email: e });
      expect(r.status, `${e}：${await r.clone().text()}`).toBe(201);
      expect((await h.json(r)).data).toEqual({ accepted: true });
    }
    await resetWorkIdle();
  });

  it("K638-API-002 形の誤りのメール（空・空白だけ・@ が無い・ドットが無い・@ が 2 つ・ローカル部が無い）：422・欄 email・E-VAL-004 の文。メールは 1 通も送らない", async () => {
    const before = mails.length;
    for (const email of ["", "   ", "abc", "a@b", "@b.c", "a@@b.c"]) {
      const r = await h.req("POST", FORGOT, { email });
      expect(r.status, JSON.stringify(email)).toBe(422);
      const j = await h.json(r);
      expect(fieldsOf(j), JSON.stringify(email)).toContain("email");
      expect(JSON.stringify(j)).toContain(msg("E-VAL-004"));
    }
    await resetWorkIdle();
    expect(mails.length).toBe(before);
  });
});

describe("K-638 パスワードで入る：形どおりのメールは 401、形の誤りだけ 422", () => {
  it("K638-API-003 形どおりで登録の無いメール：401・E-AUTH-001（422 にしない）。形の誤り（@ が無い・ドットが無い・ローカル部が無い）は 422・E-VAL-004。空は 422・E-VAL-008", async () => {
    const r = await h.signIn(h.email("si3-ghost"));
    expect(r.status, await r.clone().text()).toBe(401);
    expect((await h.json(r))["code"]).toBe("E-AUTH-001");
    for (const e of ["abc", "a@b", "@b.c"]) {
      const x = await h.signIn(e);
      expect(x.status, e).toBe(422);
      expect((await h.json(x))["code"], e).toBe("E-VAL-004");
    }
    const empty = await h.signIn("");
    expect(empty.status).toBe(422);
    expect((await h.json(empty))["code"]).toBe("E-VAL-008");
  });
});

describe("K-638 待ちの印（pending）：空は 422、形どおりの知らない印は 401", () => {
  it("K638-API-004 端末をなくした頼み（admin-request）：pending が空・空白だけは 422・欄 pending。形どおりの知らない pending は 401・E-AUTH-013。どちらも管理者に知らせない", async () => {
    const before = mails.length;
    for (const pending of ["", "   "]) {
      const r = await h.req("POST", ADMIN_REQUEST, { pending });
      expect(r.status, JSON.stringify(pending)).toBe(422);
      expect(fieldsOf(await h.json(r))).toContain("pending");
    }
    const ghost = await h.req("POST", ADMIN_REQUEST, { pending: "k638-no-such-pending" });
    expect(ghost.status, await ghost.clone().text()).toBe(401);
    expect((await h.json(ghost))["code"]).toBe("E-AUTH-013");
    expect(mails.length).toBe(before);
  });

  it("K638-API-005 確認のコードで入る（verify）：pending が空・空白だけは 422・欄 pending。形どおりの知らない pending とコードは 401・E-AUTH-013", async () => {
    for (const pending of ["", "   "]) {
      const r = await h.verifyCode({ pending, code: "123456" });
      expect(r.status, JSON.stringify(pending)).toBe(422);
      expect(fieldsOf(await h.json(r))).toContain("pending");
    }
    const ghost = await h.verifyCode({ pending: "k638-no-such-pending", code: "123456" });
    expect(ghost.status, await ghost.clone().text()).toBe(401);
    expect((await h.json(ghost))["code"]).toBe("E-AUTH-013");
  });
});

describe("K-638 確認のコードで入る：code と backup_code は、どちらか 1 つだけ文字で来る", () => {
  it("K638-API-006 code・backup_code が null・数・真偽・両方・どちらも無い：422（欄 code）。コードは使ったことにならず、失敗の数も増えず、待ちの印は生きたまま。そのあと正しい 6 けたで 201", async () => {
    const u = await h.makeUser("v6", { twoFactor: true });
    const pending = await pendingOf(h, u);
    await awayFromStepEdge(); // 6 けたの切り替わりの境で落ちない
    const right = totp(u.secret!);
    const bodies: Record<string, unknown>[] = [
      {},
      { code: null },
      { backup_code: null },
      { code: right, backup_code: null }, // 本物のコードと null の backup_code：null を「無い」として通さない
      { code: null, backup_code: u.backupCodes![0] },
      { code: right, backup_code: u.backupCodes![0] },
      { code: 123456 },
      { backup_code: true },
    ];
    for (const b of bodies) {
      const r = await h.verifyCode({ pending, ...b });
      expect(r.status, `${JSON.stringify(b)}：${await r.clone().text()}`).toBe(422);
      expect(
        fieldsOf(await h.json(r)).some((x) => x === "code" || x === "backup_code"),
        `${JSON.stringify(b)} は欄 code か backup_code の 422`,
      ).toBe(true);
    }
    expect(await failedCount(u.userId), "失敗の数に入れない").toBe(0);
    const ok = await h.verifyCode({ pending, code: right });
    expect(ok.status, await ok.clone().text()).toBe(201);
    expect(typeof (await h.json(ok)).data!["token"]).toBe("string");
  });

  it("K638-API-007 コードの長さは文字（コードポイント）で数える：64 文字ちょうど・絵文字 33 個（UTF-16 では 66）は 422 にしない（401）、65 文字は 422・E-VAL-009", async () => {
    for (const code of ["a".repeat(64), "😀".repeat(33)]) {
      const r = await h.verifyCode({ pending: "k638-no-such-pending", code });
      expect(r.status, `${[...code].length} 文字：${await r.clone().text()}`).toBe(401);
    }
    const over = await h.verifyCode({ pending: "k638-no-such-pending", code: "a".repeat(65) });
    expect(over.status).toBe(422);
    expect((await h.json(over))["code"]).toBe("E-VAL-009");
    const emoji = await h.verifyCode({ pending: "k638-no-such-pending", backup_code: "😀".repeat(65) });
    expect(emoji.status, "65 文字の絵文字は 422").toBe(422);
  });
});

describe("K-638 新しいパスワードを決める：リンクが DB に無いのは 409 E-PAGE-006", () => {
  it("K638-API-008 リンクが無いとき、新しいパスワードの長さ（11 文字）を先に見ない：リンクを先に見て 409・E-PAGE-006（422 にしない）", async () => {
    const r = await h.req("POST", RESET, { token: "k638-no-such-link-0123456789abcdef", new_password: "short-11-ch" });
    expect(r.status, await r.clone().text()).toBe(409);
    expect((await h.json(r))["code"]).toBe("E-PAGE-006");
  });

  it("K638-API-009 リンクがでたらめ・空・空白だけ：409・E-PAGE-006（正本の文）。欄・details は付けない。410・422 にしない", async () => {
    for (const token of ["k638-no-such-link-0123456789abcdef", "", "   "]) {
      const r = await h.req("POST", RESET, { token, new_password: "brand-new-password-638" });
      expect(r.status, `${JSON.stringify(token)}：${await r.clone().text()}`).toBe(409);
      const j = await h.json(r);
      expect(j["code"]).toBe("E-PAGE-006");
      expect(j["message"]).toBe(msg("E-PAGE-006"));
      expect(j["details"]).toBeUndefined();
      expect(j["field"]).toBeUndefined();
      expect(j["detail"] ?? {}).toEqual({});
    }
  });
});
