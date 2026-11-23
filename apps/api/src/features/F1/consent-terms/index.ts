// K-53 規約に同意する：今の版を出し（getCurrentTerms・誰でも）、同意した版と時刻を残す（consentToTerms・本人・関門 C2）。
//   「今の版」は kind ごとに、公開の時刻を過ぎた、取り下げていない一番新しい版（DB の app.current_terms()）。同意をもらうのは
//   利用規約（terms）とプライバシーポリシー（privacy）の 2 つだけ（特商法の表示は見せるだけ・D-128.137）。
//   同意は 1 つのトランザクションで「版ごとに terms_consents へ 1 行（同じ人・同じ版は 1 行だけ）→ その人の画面のセッションの印を下ろす」。
//   どちらかが落ちたら両方戻る。テナントと人はセッションから決める（行の守り terms_consents_self_add）。体の知らない項目（tenant_id・member_id など）は
//   落とさず入口の strict な形に渡し、422 にする（D-129.42・K-144）。
//   ログに IP とメールを出さない
import { withTenant, type TenantContext } from "@kaname/db/context";
import { kanameError } from "@kaname/errors";
import type { Row } from "@kaname/db/repository";
import type { HookArgs, HookReply } from "../../../contract/deps.js";
import { isUuid } from "@kaname/contracts";

/** 関門 C2 の withTenant に渡す業務の接続（kaname_app） */
export type AppPool = Parameters<typeof withTenant>[0];
export interface ConsentTermsDeps {
  appPool: AppPool;
}
export interface TermsItem {
  id: string;
  kind: string;
  version: string;
  url: string;
  published_at: string;
}
/** 同意が要る版の種類と、体の項目の名前 */
const REQUIRED = [
  { kind: "terms", field: "terms_version_id" },
  { kind: "privacy", field: "privacy_version_id" },
] as const;
/** 正式な uuid の形（契約の入口と同じ isUuid＝z.uuid()・版と variant の桁まで見る・K-145） */
const UUID = { test: (v: string): boolean => isUuid(v) };

const errName = (e: unknown) => (e as Error)?.name ?? "Error";
const fromCatalog = (status: number, code: string, error: string, extra: Record<string, unknown> = {}): HookReply => {
  const e = kanameError(code).toJSON() as { message?: string; action?: string };
  return { status, body: { error, code, message: e.message ?? "", action: e.action ?? "", ...extra } };
};
const invalid = (details: { field: string; message: string }[]): HookReply => ({
  status: 422,
  body: { error: "validation_failed", code: "VALIDATION_ERROR", details },
});
const serverDown = (): HookReply => fromCatalog(503, "E-PAGE-003", "unavailable"); // DB の失敗は 503（K-1106・D-136.1）
/** 要求の送り元の IP（記録だけに使う。ログには出さない）。形が IP でなければ残さない */
const ipOf = (a: HookArgs): string | null => {
  const v = a.c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || a.c.req.header("x-real-ip") || "";
  return isIpText(v) ? v : null;
};
/** IP の形か（IPv4 は 4 つの 0〜255・IPv6 は URL の決まりで読めるもの）。DB の inet に入れて落ちない形だけを残す */
export function isIpText(v: string): boolean {
  if (!v || v.length > 45) return false;
  const four = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v);
  if (four) return four.slice(1).every((x) => Number(x) <= 255 && String(Number(x)) === x);
  if (!/^[0-9a-f:.]+$/i.test(v) || !v.includes(":")) return false;
  try {
    return new URL(`http://[${v}]/`).hostname.length > 2;
  } catch {
    return false;
  }
}
const toItem = (r: Record<string, unknown>): TermsItem => ({
  id: String(r["id"]),
  kind: String(r["kind"]),
  version: String(r["version"]),
  url: String(r["url"]),
  published_at: new Date(r["published_at"] as string | Date).toISOString(),
});

/** 同意の体の前処理。同意の印が無ければ E-VAL-019。版の ID は形だけ（中身は before で見る）。
 *  知らない項目は落とさない：このあと入口が契約の strict な形（正式な uuid も）で確かめ、422 にする（D-129.42・K-144） */
export function parseConsent(raw: unknown): { input: Row } | { reply: HookReply } {
  const b = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!b) return { reply: invalid([{ field: "body", message: "JSON の形" }]) };
  if (b["agree"] !== true) {
    const e = kanameError("E-VAL-019").toJSON() as { message?: string };
    return {
      reply: {
        status: 422,
        body: {
          error: "validation_failed",
          code: "E-VAL-019",
          message: e.message ?? "",
          details: [{ field: "agree", message: e.message ?? "" }],
        },
      },
    };
  }
  const details: { field: string; message: string }[] = [];
  const input: Row = { ...b, agree: true };
  for (const { field } of REQUIRED) {
    const v = b[field];
    if (typeof v !== "string" || !v) details.push({ field, message: "同意する版の ID が要る" });
    else if (!UUID.test(v)) details.push({ field, message: "uuid" });
    else input[field] = v.toLowerCase();
  }
  return details.length ? { reply: invalid(details) } : { input };
}

export function consentTermsFeature(d: ConsentTermsDeps) {
  /** 今の版（kind ごとに 1 つ）。文脈は呼んだ人のまま（関数は security definer で、誰でも同じ答え） */
  const currentOf = async (ctx: TenantContext): Promise<TermsItem[]> =>
    withTenant(d.appPool, ctx, async (cl) => {
      const r = await cl.query("select id, kind, version, url, published_at from app.current_terms() order by kind");
      return r.rows.map(toItem);
    });

  const current = async (a: HookArgs): Promise<HookReply> => {
    try {
      return { status: 200, body: { data: await currentOf(a.ctx) } };
    } catch (e) {
      console.error(`[terms] 今の版を読めなかった: ${errName(e)}`);
      return serverDown();
    }
  };

  const consent = async (a: HookArgs): Promise<HookReply> => {
    const ctx = a.ctx;
    const want = Object.fromEntries(REQUIRED.map((x) => [x.kind, String(a.input[x.field])])) as Record<string, string>;
    let now: TermsItem[];
    let known: Map<string, string>;
    try {
      now = (await currentOf(ctx)).filter((x) => x.kind === "terms" || x.kind === "privacy");
      known = await withTenant(d.appPool, ctx, async (cl) => {
        const r = await cl.query<{ id: string; kind: string }>(
          "select id, kind from terms_versions where id = any($1::uuid[])",
          [Object.values(want)],
        );
        return new Map(r.rows.map((x) => [x.id, x.kind]));
      });
    } catch (e) {
      console.error(`[terms] 同意の前に版を読めなかった: ${errName(e)}`);
      return serverDown();
    }
    // 無い版の ID・種類の違う版の ID（プライバシーポリシーの欄に利用規約の版）は 422
    const details = REQUIRED.filter((x) => known.get(want[x.kind]!) !== x.kind).map((x) => ({
      field: x.field,
      message: "その種類の版が無い",
    }));
    if (details.length) return invalid(details);
    // 押した時点の今の版でなければ 409 と今の版（取り下げた・さらに新しい版が出た）
    const stale = REQUIRED.some((x) => now.find((v) => v.kind === x.kind)?.id !== want[x.kind]);
    if (stale) return fromCatalog(409, "E-CONF-012", "conflict", { current: now });
    const ip = ipOf(a);
    try {
      await withTenant(d.appPool, ctx, async (cl) => {
        const me = await cl.query<{ auth_user_id: string | null }>("select auth_user_id from members where id = $1", [
          ctx.userId,
        ]);
        const userId = me.rows[0]?.auth_user_id;
        if (!userId) throw new Error("本人の認証の印が無い");
        for (const v of Object.values(want))
          await cl.query(
            `insert into terms_consents (tenant_id, member_id, auth_user_id, terms_version_id, agreed_at, ip)
             values ($1, $2, $3, $4, now(), $5::inet)
             on conflict (auth_user_id, terms_version_id) where deleted_at is null do nothing`,
            [ctx.tenantId, ctx.userId, userId, v, ip],
          );
        await cl.query("select app.refresh_terms_pending($1)", [userId]);
      });
    } catch (e) {
      console.error(`[terms] 同意を残せなかった（全部戻した）: ${errName(e)}`);
      return serverDown();
    }
    return { status: 201, body: { data: { consented: true } } };
  };

  return { current, consent };
}
