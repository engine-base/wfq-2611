// K-322「確認のコードで入る口の守りを固める」の単体の試験（口 POST /api/v1/auth/two-factor/verify・本物の DB・本物のログインの部品）。
// 名前の頭の行 ID（K322-API-…）は 11_tickets/K-322.md の表の分岐に 1 対 1 で結ぶ。土台は login.harness.ts（K-301・K-302 の物をそのまま使う）。
// テストはチケットを作る人が書き、実装する人は変えない（D-128.125）。実装の前に流して赤を確かめない（D-128.143）。
// 同時の 2 本（K322-API-001）は、部品が確かめを通った後に必ず書き直す "twoFactor" の行を試験の側で先にロックし、
// 2 本の要求をそこで止めてから（DB の待ちの数で確かめる・決まった時間は待たない）ロックを解く。順が決まるので揺れない。
import { describe, expect, it } from "vitest";
import { CODE_LOCKED, UA_MAC, awayFromStepEdge, pendingOf, setupLogin, totp, type User } from "./login.harness.js";

const h = setupLogin("k322");

/** 試験で入れる DDL に本人の id をそのまま埋めるので、形を確かめる（G-10：この回の本人だけに効かせる） */
const safeId = (v: string): string => {
  expect(v, "本人の id の形").toMatch(/^[A-Za-z0-9_-]+$/);
  return v;
};
const failures = async (userId: string): Promise<number> =>
  Number(
    (
      await h.admin.query<{ n: number }>(
        'select "failedVerificationCount" as n from kaname_auth."twoFactor" where "userId" = $1',
        [userId],
      )
    ).rows[0]!.n ?? 0,
  );
const loginSucceeded = async (memberId: string): Promise<number> =>
  Number(
    (
      await h.admin.query<{ n: string }>(
        "select count(*) as n from security_events where member_id = $1 and kind_id = 'login_succeeded'",
        [memberId],
      )
    ).rows[0]!.n,
  );
/** 試験の間だけ、条件に合う insert を落とす引き金を張る（終わったら必ず外す・G-10） */
const withFailingInsert = async <T>(name: string, table: string, when: string, fn: () => Promise<T>): Promise<T> => {
  await h.admin.query(`create or replace function app.${name}() returns trigger language plpgsql as $$
    begin if ${when} then raise exception 'K-322 の試験：ここで書けない'; end if; return new; end $$`);
  await h.admin.query(`create trigger ${name} before insert on ${table} for each row execute function app.${name}()`);
  try {
    return await fn();
  } finally {
    await h.admin.query(`drop trigger if exists ${name} on ${table}`);
    await h.admin.query(`drop function if exists app.${name}()`);
  }
};
const quiet = async (fn: () => Promise<Response>): Promise<Response> => {
  let r: Response | undefined;
  await h.captureLogs(async () => {
    r = await fn();
  });
  return r!;
};
const counts = async (u: User) => ({ live: await h.liveSessions(u.memberId), auth: await h.authSessions(u.userId) });

describe("K-322 確認のコードで入る：同じ 6 けたを同時に送る", () => {
  it("K322-API-001 同じ人の 2 つの待ちの印に同じ 6 けたを同時に 2 本：1 本は 201・もう 1 本は 401・E-AUTH-004。生きたセッションも認証側のセッションも 1 つだけ増え、6 けたの失敗の数は 0 のまま", async () => {
    const u = await h.makeUser("race", { twoFactor: true });
    const p1 = await pendingOf(h, u);
    const p2 = await pendingOf(h, u);
    const before = await counts(u);
    await awayFromStepEdge();
    const code = totp(u.secret!);
    const locker = await h.admin.connect();
    let released = false;
    const release = async () => {
      if (released) return;
      released = true;
      await locker.query("commit");
      locker.release();
    };
    try {
      await locker.query("begin");
      await locker.query('select 1 from kaname_auth."twoFactor" where "userId" = $1 for update', [u.userId]);
      const pid = (await locker.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
      let settled = 0;
      const send = (p: string) =>
        h.verifyCode({ pending: p, code }, { ua: UA_MAC }).finally(() => {
          settled += 1;
        });
      const both = Promise.all([send(p1), send(p2)]);
      // 2 本とも「ロックで待っている」か「答えが返った」になるまで、DB の待ちの数を見て待つ（15 秒で来なければ落とす）
      const deadline = Date.now() + 15_000;
      for (;;) {
        const waiting = Number(
          (
            await h.admin.query<{ n: string }>(
              "select count(*) as n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))",
              [pid],
            )
          ).rows[0]!.n,
        );
        if (waiting + settled >= 2) break;
        if (Date.now() > deadline) throw new Error(`2 本がそろわない（待ち ${waiting}・答え ${settled}）`);
        await new Promise((r) => setImmediate(r));
      }
      await release();
      const rs = await both;
      const statuses = rs.map((r) => r.status).sort();
      expect(statuses, "1 本だけ入る").toEqual([201, 401]);
      const loser = rs.find((r) => r.status === 401)!;
      expect((await h.json(loser))["code"]).toBe("E-AUTH-004");
      const after = await counts(u);
      expect(after.live, "生きたセッションは 1 つだけ増える").toBe(before.live + 1);
      expect(after.auth, "認証側のセッションも 1 つだけ増える").toBe(before.auth + 1);
      expect(await failures(u.userId), "使い回しの断りは 6 けたの失敗に数えない").toBe(0);
    } finally {
      await release();
    }
  }, 60_000);
});

describe("K-322 確認のコードで入る：確かめの前後で DB が落ちる", () => {
  it("K322-API-002 使った番号を覚える所（totp-used-<本人> の insert）で落ちる：503・E-PAGE-003。部品を呼ばず、セッションは増えず失敗の数は 0。直った後に同じ 6 けたを新しい待ちの印で送ると 201", async () => {
    const u = await h.makeUser("claimdown", { twoFactor: true });
    const id = safeId(u.userId);
    const before = await counts(u);
    await awayFromStepEdge();
    const code = totp(u.secret!);
    const p1 = await pendingOf(h, u);
    const r = await withFailingInsert(
      "k322_claim_down",
      "kaname_auth.verification",
      `new.identifier = 'totp-used-${id}'`,
      () => quiet(() => h.verifyCode({ pending: p1, code })),
    );
    expect(r.status).toBe(503);
    expect((await h.json(r))["code"]).toBe("E-PAGE-003");
    expect(await counts(u), "セッションを作らない").toEqual(before);
    expect(await failures(u.userId), "部品を呼ばない").toBe(0);
    const again = await h.verifyCode({ pending: await pendingOf(h, u), code });
    expect(again.status, await again.clone().text()).toBe(201);
  });

  it("K322-API-003 部品が通った後、残りのバックアップコードを数える所で落ちる（backupCodes が読めない）：503・E-PAGE-003。生きたセッションも認証側のセッションも要求の前と同じ数。直った後に同じ 6 けた（同じ 30 秒）を新しい待ちの印で送ると 201", async () => {
    const u = await h.makeUser("countdown", { twoFactor: true });
    const p1 = await pendingOf(h, u);
    const p2 = await pendingOf(h, u);
    const saved = (
      await h.admin.query<{ codes: string }>(
        'select "backupCodes" as codes from kaname_auth."twoFactor" where "userId" = $1',
        [u.userId],
      )
    ).rows[0]!.codes;
    await h.admin.query(`update kaname_auth."twoFactor" set "backupCodes" = 'broken' where "userId" = $1`, [u.userId]);
    const before = await counts(u);
    await awayFromStepEdge();
    const code = totp(u.secret!);
    const r = await quiet(() => h.verifyCode({ pending: p1, code }));
    expect(r.status).toBe(503);
    expect((await h.json(r))["code"]).toBe("E-PAGE-003");
    expect(await counts(u), "入った後に落ちたらその場で閉じる").toEqual(before);
    await h.admin.query('update kaname_auth."twoFactor" set "backupCodes" = $2 where "userId" = $1', [u.userId, saved]);
    const again = await h.verifyCode({ pending: p2, code });
    expect(again.status, await again.clone().text()).toBe(201);
  });

  it("K322-API-004 部品が通った後、入った記録（security_events の login_succeeded）を書く所で落ちる：201・token（記録が書けなくても入れる・K-301 と同じ）。セッションは 1 つだけ増え、login_succeeded は増えない", async () => {
    const u = await h.makeUser("recorddown", { twoFactor: true });
    const member = safeId(u.memberId);
    const p = await pendingOf(h, u);
    const before = await counts(u);
    const ok0 = await loginSucceeded(u.memberId);
    await awayFromStepEdge();
    const r = await withFailingInsert(
      "k322_record_down",
      "security_events",
      `new.kind_id = 'login_succeeded' and new.member_id::text = '${member}'`,
      () => quiet(() => h.verifyCode({ pending: p, code: totp(u.secret!) })),
    );
    expect(r.status, await r.clone().text()).toBe(201);
    const token = String((await h.json(r)).data!["token"]);
    expect(await h.resolves(token, UA_MAC), "入れている").toBe(true);
    expect(await counts(u)).toEqual({ live: before.live + 1, auth: before.auth + 1 });
    expect(await loginSucceeded(u.memberId)).toBe(ok0);
  });
});

describe("K-322 確認のコードで入る：断られた番号は使ったことにしない", () => {
  it("K322-API-005 6 けたの止めの間（あと 2 秒）に正しい 6 けた：429・E-AUTH-014。止めが解けた後に同じ 6 けた（同じ 30 秒）：201", async () => {
    const u = await h.makeUser("lockrelease", { twoFactor: true });
    const setUntil = (sql: string) =>
      h.admin.query(
        `update kaname_auth."twoFactor" set "failedVerificationCount" = 5, "lockedUntil" = ${sql} where "userId" = $1`,
        [u.userId],
      );
    const p1 = await pendingOf(h, u);
    const p2 = await pendingOf(h, u);
    await awayFromStepEdge();
    const code = totp(u.secret!);
    await setUntil("now() + interval '2 seconds'");
    const locked = await h.verifyCode({ pending: p1, code });
    expect(locked.status).toBe(429);
    expect((await h.json(locked))["code"]).toBe(CODE_LOCKED);
    await setUntil("now() - interval '1 millisecond'");
    const ok = await h.verifyCode({ pending: p2, code });
    expect(ok.status, await ok.clone().text()).toBe(201);
  });

  it("K322-API-006 部品の中（sessions に写す所）で落ちた 6 けた：503・E-PAGE-003。直った後に同じ 6 けた（同じ 30 秒）を新しい待ちの印で送ると 201", async () => {
    const u = await h.makeUser("midfail", { twoFactor: true });
    const p1 = await pendingOf(h, u, { ua: `${UA_MAC} K322-FAIL` });
    const p2 = await pendingOf(h, u);
    await awayFromStepEdge();
    const code = totp(u.secret!);
    const r = await withFailingInsert("k322_copy_down", "sessions", "new.device_label like '%K322-FAIL%'", () =>
      quiet(() => h.verifyCode({ pending: p1, code }, { ua: `${UA_MAC} K322-FAIL` })),
    );
    expect(r.status).toBe(503);
    expect((await h.json(r))["code"]).toBe("E-PAGE-003");
    const ok = await h.verifyCode({ pending: p2, code }, { ua: UA_MAC });
    expect(ok.status, await ok.clone().text()).toBe(201);
  });
});
