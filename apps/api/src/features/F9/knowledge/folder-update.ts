// フォルダの名前を直す・動かす口（K-678・契約の口 updateKnowledgeFolder・PATCH /api/v1/knowledge/folders/:id）。
//   見えない（無い・消した・別の会社・見えない棚・他人の自分のフォルダ）は 404・見えて書けないは 403。動かすのは同じ棚の中だけ：
//   親が見えない → 404／別の棚 → 409 E-KNW-023／自分か自分の下 → 409 E-KNW-022／動かした後の深さ（下の段も数える）が 6 を超える → 409 E-KNW-021。
//   送った欄だけを書く。親を替えて並びを送らなければ新しい親の最後。名前の重なりは DB の一意 → 409 E-KNW-020。証跡は同じ取引
import type pg from "pg";
import { withTenant } from "@kaname/db/context";
import type { HookArgs, HookReply } from "../../../contract/deps.js";
import { checkKnowledgeInput } from "./input.js";
import { conflict, forbidden, notFound } from "./reply.js";
import {
  FOLDER_COLS,
  FOLDER_DEPTH_MAX,
  auditFolder,
  depthOf,
  folderFailure,
  heightBelow,
  isBelow,
  nextPosition,
  readFolder,
  sameShelf,
  toKnowledgeFolder,
  type FolderRead,
} from "./folder-shape.js";

const UPDATE_SQL = `with f as (
  update knowledge_folders set name = $2, parent_folder_id = $3, position = $4, updated_by = app.user_id()
   where id = $1 and tenant_id = app.tenant_id() and deleted_at is null
  returning *) select ${FOLDER_COLS} from f`;

interface Patch {
  name?: string;
  parent_folder_id?: string | null;
  position?: number;
}

/** 新しい親を確かめる。断りの答えか null（通る） */
async function checkMove(cl: pg.PoolClient, f: FolderRead, parentId: string | null): Promise<HookReply | null> {
  if (parentId) {
    const p = await readFolder(cl, parentId);
    if (!p) return notFound();
    if (!sameShelf(p, { scopeId: f.scope_id, isPersonal: f.is_personal, ownerId: f.owner_member_id }))
      return conflict("E-KNW-023");
    if (p.id === f.id || (await isBelow(cl, f.id, p.id))) return conflict("E-KNW-022");
  }
  if ((await depthOf(cl, parentId)) + (await heightBelow(cl, f.id)) > FOLDER_DEPTH_MAX) return conflict("E-KNW-021");
  return null;
}

export function createUpdateKnowledgeFolder(appPool: pg.Pool): (a: HookArgs) => Promise<HookReply> {
  return async (a: HookArgs): Promise<HookReply> => {
    const bad = checkKnowledgeInput("updateKnowledgeFolder", a.input);
    if (bad) return bad;
    const input = a.input as Patch;
    const id = a.id!;
    try {
      return await withTenant(appPool, a.ctx, async (cl): Promise<HookReply> => {
        const f = await readFolder(cl, id);
        if (!f) return notFound();
        if (!f.writable) return forbidden();
        const moving = input.parent_folder_id !== undefined;
        const parentId = moving ? (input.parent_folder_id ?? null) : f.parent_folder_id;
        if (moving) {
          const stop = await checkMove(cl, f, parentId);
          if (stop) return stop;
        }
        const position =
          input.position ??
          (moving && parentId !== f.parent_folder_id
            ? await nextPosition(cl, { scopeId: f.scope_id, isPersonal: f.is_personal }, parentId)
            : f.position);
        const row = (await cl.query(UPDATE_SQL, [id, input.name ?? f.name, parentId, position])).rows[0];
        if (!row) return notFound();
        await auditFolder(cl, "update", id);
        return { status: 200, body: { data: toKnowledgeFolder(row) } };
      });
    } catch (e) {
      return folderFailure(e, "直せ");
    }
  };
}
