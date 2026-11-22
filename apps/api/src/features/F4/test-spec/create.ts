// 確認項目を足す口（K-434・契約の口 createTestSpec・POST /api/v1/tickets/:id/test-specs・D-150.39・D-150.33）。
//   手順 S1：DB の関数 app.test_spec_create で、題名の確かめ（外れは何も書かない）・チケットの行の共有ロック・行を 1 つ足す・やり取りに 1 行・
//            証跡 test_spec.create を 1 つの取引で書く（関門 C2）。足したときはチェック無し・出どころ manual。外へは何も出さない（メールもお知らせも無い・AI も PC も呼ばない）。
//   答え：ok → 201 { data: SpecItem }／invalid → 422・VALIDATION_ERROR（欄 title）／not_found → 404／forbidden → 403／
//         done（完了したチケット）→ 409・E-SPEC-001／例外 → 503・E-PAGE-003（何も残らない）。
//   入口の順は 入口（401・行の守りの 403・404）→ 入力 422（関数の最初の確かめ）→ 状態 409。入力が外れていれば、チケットの状態に関わらず 422。
//   ログに題名を出さない（チケットの id と例外の種類だけ）
import type pg from "pg";
import { withTenant } from "@kaname/db/context";
import type { HookArgs, HookReply } from "../../../contract/deps.js";
import { pickCreate } from "./input.js";
import { conflictDone, forbidden, invalid, kindOf, notFound, unavailable } from "./reply.js";
import { toSpecItem, type SpecItem } from "./shape.js";

const CREATE_SQL = "select app.test_spec_create($1, $2::jsonb) as v";

type Outcome =
  | { ok: true; row: SpecItem }
  | { error: "invalid"; field?: string; message?: string }
  | { error: "not_found" | "forbidden" | "done" };

export function createCreateTestSpec(appPool: pg.Pool): (a: HookArgs) => Promise<HookReply> {
  return async (a: HookArgs): Promise<HookReply> => {
    const id = a.id!;
    let v: Outcome | undefined;
    try {
      v = await withTenant(
        appPool,
        a.ctx,
        async (cl) =>
          (await cl.query<{ v: Outcome }>(CREATE_SQL, [id, JSON.stringify(pickCreate(a.input))])).rows[0]?.v,
      );
    } catch (e) {
      console.error(`[test-spec] 足せなかった（${id}・${kindOf(e)}）`);
      return unavailable();
    }
    if (!v) return unavailable();
    if ("ok" in v) return { status: 201, body: { data: toSpecItem(v.row) } };
    if (v.error === "invalid") return invalid(v.field ?? "title", v.message ?? "入力内容を確認してください");
    if (v.error === "forbidden") return forbidden();
    if (v.error === "done") return conflictDone();
    return notFound();
  };
}
