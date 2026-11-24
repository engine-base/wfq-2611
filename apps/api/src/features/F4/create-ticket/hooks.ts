// チケットを作る（K-60）の契約の口の振る舞い。
//   createTicket：入口で形を確かめ（題名・期限・優先度・見込み・区画の形）、app.ticket_create（関門 C2・0088）が
//     グループに書けるか・種別・担当者・親・知らせる人が同じ会社か・種別の必須の区画を確かめ、チケット・区画の版 1・受け箱の知らせ・下書きの片付けを 1 つの処理で書く
//   listTicketKinds：種別と、その種別の区画（必須か）を一緒に返す ／ listScopes：グループの一覧と、チケットを書けるグループ（meta.writable）
//   getTicket：読むだけの詳細（属性・区画・種別・段・担当者） ／ listMyTicketDrafts・saveMyTicketDraft：書きかけの下書き（サーバーに残す・D-128.138）
// ログに題名と本文を出さない（共通の決まり）
import type pg from "pg";
import { isUuid } from "@kaname/contracts";
import { withTenant } from "@kaname/db/context";
import type { Row } from "@kaname/db/repository";
import { KanameError } from "@kaname/errors";
import type { Hook, HookArgs, HookReply } from "../../../contract/deps.js";
import { checkCreate, todayJst } from "./input.js";

const fail = (status: number, error: string, code: string, extra: Record<string, unknown> = {}): HookReply => ({
  status,
  body: { error, code, ...extra },
});
const fromCatalog = (code: string, field: string, message?: string): HookReply => {
  const e = new KanameError(code);
  return {
    status: e.status,
    body: { ...e.toJSON(), field, details: [{ field, message: message ?? e.entry.message }] },
  };
};
const LIST_MAX = 200;
/** チケットの詳細の帯（DB の app.ticket_band の答え・0096 と 0100） */
interface TicketBand {
  approval: unknown;
  can_complete?: boolean;
  completed_at?: string | null;
  completed_by_name?: string | null;
}
/** 詳細の進める分（DB の app.ticket_progress_info の答え・K-387） */
interface TicketProgressInfo {
  can_progress?: boolean;
  can_actual?: boolean;
  ai_minutes?: number;
  hold?: { reason: string | null; resume: string | null; at: string; by: string | null } | null;
}
/** 詳細に足す欄を読む 1 文（文の数を増やさない・K234-API-004）。列は関数ごとに 1 つ。
 *  欄を足す葉は、この文に列を 1 つ足し（例 app.ticket_handover_now($1) as h）、DetailExtras と detailExtras に鍵を 1 つ足す */
const DETAIL_EXTRAS_SQL =
  "select app.ticket_band($1) as v, app.ticket_progress_info($1) as p, app.ticket_handover_current($1) as h, app.ticket_handover_kinds($1) as k";
interface DetailExtras {
  v: TicketBand | null;
  p: TicketProgressInfo | null;
  /** 今の渡し（K-405・待っている 1 件か一番新しい 1 件・無ければ null。形は listTicketHandovers の 1 件と同じ） */
  h: Record<string, unknown> | null;
  /** 見ている人が渡せる種類（K-405・pass・distribute・offer） */
  k: string[] | null;
}
/** 詳細の答えのうち、DETAIL_EXTRAS_SQL の列から組む欄（承認の帯・できること・完了・時間・保留の帯） */
function detailExtras(x: DetailExtras | undefined, t: Row): Row {
  const band = x?.v ?? null;
  const p = x?.p ?? null;
  return {
    approval: band?.approval ?? null,
    can: { complete: band?.can_complete === true, progress: p?.can_progress === true, actual: p?.can_actual === true },
    completed: band?.completed_at ? { at: band.completed_at, by: band.completed_by_name ?? null } : null,
    // 予定・人の分（実績）・AI の分（終わった実行の長さの合計・K-387）
    time: {
      estimate_minutes: t["estimate_minutes"] ?? null,
      human_minutes: t["actual_minutes"] ?? 0,
      ai_minutes: p?.ai_minutes ?? 0,
    },
    hold: p?.hold ?? null,
    // 渡しの今（帯の「→ 〇〇（返事待ち）」）と入口の出し分け（K-405）
    handover: x?.h ?? null,
    handover_kinds: x?.k ?? [],
  };
}

export function createTicketHooks(appPool: pg.Pool): Record<string, Hook> {
  return {
    createTicket: {
      before: async (a: HookArgs) => {
        const checked = checkCreate(a.input, todayJst());
        if (!checked.ok) {
          const due = checked.details.find((x) => x.field === "due_on" && x.code === "E-VAL-012");
          if (due) return fromCatalog("E-VAL-012", "due_on");
          return fail(422, "validation_failed", "VALIDATION_ERROR", {
            details: checked.details.map(({ field, message }) => ({ field, message })),
          });
        }
        const r = await withTenant(
          appPool,
          a.ctx,
          async (cl) =>
            (
              await cl.query<{ v: Record<string, unknown> }>("select app.ticket_create($1::jsonb) as v", [
                JSON.stringify(checked.value),
              ])
            ).rows[0]!.v,
        );
        if (r["ok"] !== true) {
          const code = String(r["code"]);
          const field = String(r["field"] ?? "body");
          if (code === "FORBIDDEN") return fail(403, "forbidden", "FORBIDDEN", { field });
          if (code === "PARENT_NOT_FOUND") return fromCatalog("E-PAGE-001", field);
          if (code === "PARENT_DEPTH") return fromCatalog("E-VAL-015", field);
          if (code === "SECTION_REQUIRED") {
            const keys = (r["detail"] as string[] | undefined) ?? [];
            const e = new KanameError("E-VAL-013");
            return {
              status: 422,
              body: {
                ...e.toJSON(),
                field: "sections",
                details: keys.map((k) => ({ field: `sections.${k}`, message: e.entry.message })),
              },
            };
          }
          return fromCatalog("E-VAL-014", field);
        }
        const row = await a.repo.table("tickets").get(a.ctx, String(r["id"]));
        return { status: 201, body: { data: row ?? { id: r["id"], number: r["number"] } } };
      },
    },
    listTicketKinds: {
      before: async (a: HookArgs) => {
        const kinds = (await a.repo.table("ticket_kinds").list(a.ctx, { limit: LIST_MAX, orderBy: "position" })).filter(
          (k) => !k["deleted_at"],
        );
        const secs = (await a.repo.table("kind_sections").list(a.ctx, { limit: 2000, orderBy: "position" })).filter(
          (s) => !s["deleted_at"],
        );
        const data = kinds.map((k) => ({
          id: k["id"],
          name: k["name"],
          color: k["color"] ?? null,
          position: k["position"],
          is_builtin: k["is_builtin"],
          sections: secs
            .filter((s) => s["kind_id"] === k["id"] && s["mode"] !== "hidden")
            .map((s) => ({
              key: s["section_key"],
              label: s["label"],
              mode: s["mode"],
              position: s["position"],
              content_type: s["content_type"],
              hint: s["hint"] ?? null,
            })),
        }));
        return { status: 200, body: { data, meta: { limit: data.length } } };
      },
    },
    listScopes: {
      before: async (a: HookArgs) => {
        // 層の絞り込み（K-249）：入口が uuid と確かめ済み（registry の uuidParams）。空の値（?layer_id=）は指定なし。
        //   見える範囲は行の守りのまま（見えるグループの中で絞る）。別の会社の層・無い層は 0 件
        const layerId = a.c.req.query("layer_id") ?? "";
        const byLayer = layerId ? { where: { layer_id: layerId } } : {};
        const rows = (await a.repo.table("scopes").list(a.ctx, { limit: LIST_MAX, ...byLayer })).filter(
          (s) => !s["deleted_at"],
        );
        // チケットを書けるグループ：グループごとに聞かず、1 回の SQL で（has_permission を並びに当てる）
        const ids = rows.map((s) => String(s["id"]));
        const writable =
          a.ctx.role === "member" && ids.length
            ? await withTenant(appPool, a.ctx, async (cl) =>
                (
                  await cl.query<{ id: string }>(
                    "select s.id::text as id from unnest($1::uuid[]) as s(id) where has_permission(app.user_id(), 'tickets', s.id, 'edit')",
                    [ids],
                  )
                ).rows.map((r) => r.id),
              )
            : [];
        return { status: 200, body: { data: rows, meta: { limit: LIST_MAX, writable } } };
      },
    },
    getTicket: {
      before: async (a: HookArgs) => {
        const t = await a.repo.table("tickets").get(a.ctx, a.id!);
        if (!t || t["deleted_at"]) return fail(404, "not_found", "NOT_FOUND");
        const [secs, kindSecs, kind, stage, assignee] = await Promise.all([
          a.repo.table("ticket_sections").list(a.ctx, { where: { ticket_id: a.id }, limit: 100, orderBy: "position" }),
          a.repo.table("kind_sections").list(a.ctx, { where: { kind_id: t["kind_id"] }, limit: 100 }),
          a.repo.table("ticket_kinds").get(a.ctx, String(t["kind_id"])),
          a.repo.table("ticket_stages").get(a.ctx, String(t["stage_id"])),
          t["assignee_member_id"] ? a.repo.table("members").get(a.ctx, String(t["assignee_member_id"])) : null,
        ]);
        // 承認の帯（K-162・D-128.178）：決まっていない成果物の承認待ち 1 つ（呼んだ人が決められるか）。読むだけ。
        //   完了（K-165）：呼んだ人が完了にできるか（can.complete）と、完了の時刻と押した人の名前（completed）
        //   進める（K-387）：段を変えられるか（can.progress）・実績を入れられるか（can.actual）・AI の分の時間・保留の帯。帯と同じ 1 文で読む
        const extras = await withTenant(
          appPool,
          a.ctx,
          async (cl) => (await cl.query<DetailExtras>(DETAIL_EXTRAS_SQL, [a.id])).rows[0],
        );
        const label = new Map(kindSecs.map((s: Row) => [s["section_key"], s["label"]]));
        return {
          status: 200,
          body: {
            data: {
              ticket: t,
              sections: secs
                .filter((s) => !s["deleted_at"])
                .map((s) => ({
                  key: s["section_key"],
                  label: label.get(s["section_key"]) ?? s["section_key"],
                  body: s["body"],
                  version: s["version"],
                })),
              kind: kind ? { id: kind["id"], name: kind["name"], color: kind["color"] ?? null } : null,
              stage: stage ? { id: stage["id"], key: stage["key"], name: stage["name"] } : null,
              assignee: assignee ? { id: assignee["id"], display_name: assignee["display_name"] } : null,
              ...detailExtras(extras, t),
            },
          },
        };
      },
    },
    listMyTicketDrafts: {
      before: async (a: HookArgs) => {
        const v = await withTenant(
          appPool,
          a.ctx,
          async (cl) => (await cl.query<{ v: unknown[] }>("select app.ticket_drafts_mine() as v")).rows[0]!.v,
        );
        return { status: 200, body: { data: v, meta: { limit: v.length } } };
      },
    },
    saveMyTicketDraft: {
      before: async (a: HookArgs) => {
        const id = a.input["draft_id"];
        // 入口と同じ正式な uuid の確かめ（入口が先に断るので重ねの確かめ・K-144）
        if (typeof id !== "string" || !isUuid(id))
          return fail(422, "validation_failed", "VALIDATION_ERROR", {
            details: [{ field: "draft_id", message: "uuid" }],
          });
        const discard = a.input["discard"] === true;
        // 下書きの大きさに上限は置かない（D-130.3）。守りは入口の送る量 1MB だけ
        const body = a.input["body"] ?? {};
        const v = await withTenant(
          appPool,
          a.ctx,
          async (cl) =>
            (
              await cl.query<{ v: unknown }>("select app.ticket_draft_save($1::uuid, $2::jsonb, $3) as v", [
                id,
                JSON.stringify(body),
                discard,
              ])
            ).rows[0]!.v,
        );
        return { status: 201, body: { data: v } };
      },
    },
  };
}
