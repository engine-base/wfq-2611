// 消す口（K-488）の問い合わせの確かめ。DB に触らない純粋な関数だけ。契約の問い合わせの欄（05_flow/screen_api.d/K-488.py の QUERY_RANGES）と同じ決まり。
//   children  ：空（指定なし）・move・cascade・detach の 4 つ。それ以外は 422（欄 children）
//   parent_id ：uuid（空は指定なし）。uuid でない値は children が move でなくても 422（欄 parent_id・入口が先に見る形と同じ）。
//               移し先として読むのは children が move のときだけ（move 以外に付いた形の正しい値は読まずに無視する）。
//               move なのに無い・空なら、ここでは 422 にせず null のまま関数へ渡す（移し先を指していないのは 404・E-DEL-014）
//   reason    ：任意。前後の空白を落とす前の字数（コードポイント）が 400 を超えたら 422（欄 reason・契約の maxLength 400 と同じ数え方）。
//               そのあと前後の空白（全角を含む）を落とし、空は null。NFKC のそろえは画面（K-590）の仕事で、ここではしない
import { isUuid } from "@kaname/contracts";

export const REASON_MAX = 400;
export const CHILDREN_MODES = ["move", "cascade", "detach"] as const;
export type ChildrenMode = (typeof CHILDREN_MODES)[number];

export interface Issue {
  field: string;
  message: string;
}
export interface DeleteInput {
  children: ChildrenMode | null;
  /** children が move のときだけ入る移し先（無い・空は null） */
  parent: string | null;
  reason: string | null;
}
export type Parsed = { ok: true; value: DeleteInput } | { ok: false; details: Issue[] };

/** raw は届いたままの問い合わせ（空の値も含む） */
export function parseDeleteQuery(raw: Record<string, string>): Parsed {
  const details: Issue[] = [];
  const childrenRaw = raw["children"] ?? "";
  if (childrenRaw !== "" && !(CHILDREN_MODES as readonly string[]).includes(childrenRaw))
    details.push({ field: "children", message: "move・cascade・detach のどれか" });
  const parentRaw = raw["parent_id"] ?? "";
  if (parentRaw !== "" && !isUuid(parentRaw)) details.push({ field: "parent_id", message: "uuid" });
  const reasonRaw = raw["reason"] ?? "";
  if ([...reasonRaw].length > REASON_MAX) details.push({ field: "reason", message: `${REASON_MAX} 文字まで` });
  if (details.length) return { ok: false, details };
  const children = childrenRaw === "" ? null : (childrenRaw as ChildrenMode);
  const reason = reasonRaw.trim();
  return {
    ok: true,
    value: {
      children,
      parent: children === "move" && parentRaw !== "" ? parentRaw : null,
      reason: reason === "" ? null : reason,
    },
  };
}
