// フォルダを足す口（K-678・契約の口 createKnowledgeFolder・POST /api/v1/knowledge/folders・201）。
//   1 つの取引で：棚を決める（見えない・無い棚は 404）→ 書けるか（403）→ 親（見えない・無い・消した・別の棚は 404）→ 深さ（409 E-KNW-021）
//   → 並び（同じ親の最後＋10）→ 挿入（同じ名前は DB の一意 → 409 E-KNW-020）→ 証跡。DB の失敗は 503。ログに名前を出さない
import type pg from "pg";
import { withTenant } from "@kaname/db/context";
import type { HookArgs, HookReply } from "../../../contract/deps.js";
import { checkKnowledgeInput } from "./input.js";
import { conflict, forbidden, notFound } from "./reply.js";
import { resolveShelf } from "./shelf.js";
import type { ShelfKind } from "./shape.js";
import {
  FOLDER_COLS,
  FOLDER_DEPTH_MAX,
  auditFolder,
  depthOf,
  folderFailure,
  nextPosition,
  readFolder,
  sameShelf,
  toKnowledgeFolder,
} from "./folder-shape.js";

const WRITABLE_SQL = "select app.kn_shelf_writable($1, $2, app.user_id()) as ok";
const INSERT_SQL = `with f as (
  insert into knowledge_folders (tenant_id, scope_id, is_personal, owner_member_id, parent_folder_id, name, position, created_by, updated_by)
  values (app.tenant_id(), $1, $2, app.user_id(), $3, $4, $5, app.user_id(), app.user_id())
  returning *) select ${FOLDER_COLS} from f`;

export function createCreateKnowledgeFolder(appPool: pg.Pool): (a: HookArgs) => Promise<HookReply> {
  return async (a: HookArgs): Promise<HookReply> => {
    const bad = checkKnowledgeInput("createKnowledgeFolder", a.input);
    if (bad) return bad;
    const input = a.input as {
      shelf: ShelfKind;
      group_id?: string | null;
      parent_folder_id?: string | null;
      name: string;
    };
    try {
      return await withTenant(appPool, a.ctx, async (cl): Promise<HookReply> => {
        const shelf = await resolveShelf(cl, { shelf: input.shelf, group_id: input.group_id ?? null });
        if (!shelf) return notFound();
        const ok = (await cl.query<{ ok: boolean }>(WRITABLE_SQL, [shelf.scopeId, shelf.isPersonal])).rows[0]?.ok;
        if (ok !== true) return forbidden();
        const parentId = input.parent_folder_id ?? null;
        if (parentId) {
          const parent = await readFolder(cl, parentId);
          const me = { scopeId: shelf.scopeId, isPersonal: shelf.isPersonal, ownerId: a.ctx.userId ?? "" };
          if (!parent || !sameShelf(parent, me)) return notFound();
          if ((await depthOf(cl, parent.id)) + 1 > FOLDER_DEPTH_MAX) return conflict("E-KNW-021");
        }
        const position = await nextPosition(cl, shelf, parentId);
        const row = (await cl.query(INSERT_SQL, [shelf.scopeId, shelf.isPersonal, parentId, input.name, position]))
          .rows[0];
        await auditFolder(cl, "create", row.id);
        return { status: 201, body: { data: toKnowledgeFolder(row) } };
      });
    } catch (e) {
      return folderFailure(e, "足せ");
    }
  };
}
