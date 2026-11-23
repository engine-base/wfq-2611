// フォルダを消す口（K-678・契約の口 deleteKnowledgeFolder・DELETE /api/v1/knowledge/folders/:id）。
//   見えない → 404・書けない → 403・中が空でない（見えない他人の下書きも数える・app.kn_folder_in_use）→ 409 E-KNW-024・
//   共有している（K-719 が確かめを差し替える）→ 409 E-KNW-051。消すのは印（deleted_at）だけで行は残す。証跡は同じ取引。答え 200 { id }
import type pg from "pg";
import { withTenant } from "@kaname/db/context";
import type { HookArgs, HookReply } from "../../../contract/deps.js";
import { conflict, forbidden, notFound } from "./reply.js";
import { auditFolder, folderFailure, readFolder } from "./folder-shape.js";
import { shareBlocksFolder } from "./folder-guard-share.js";

const IN_USE_SQL = "select app.kn_folder_in_use($1) as used";
const DELETE_SQL = `update knowledge_folders set deleted_at = now(), updated_by = app.user_id()
 where id = $1 and tenant_id = app.tenant_id() and deleted_at is null`;

export function createDeleteKnowledgeFolder(appPool: pg.Pool): (a: HookArgs) => Promise<HookReply> {
  return async (a: HookArgs): Promise<HookReply> => {
    const id = a.id!;
    try {
      return await withTenant(appPool, a.ctx, async (cl): Promise<HookReply> => {
        const f = await readFolder(cl, id);
        if (!f) return notFound();
        if (!f.writable) return forbidden();
        if ((await cl.query<{ used: boolean }>(IN_USE_SQL, [id])).rows[0]?.used === true) return conflict("E-KNW-024");
        if (await shareBlocksFolder(cl, id)) return conflict("E-KNW-051");
        const r = await cl.query(DELETE_SQL, [id]);
        if (r.rowCount !== 1) return notFound();
        await auditFolder(cl, "delete", id);
        return { status: 200, body: { data: { id } } };
      });
    } catch (e) {
      return folderFailure(e, "消せ");
    }
  };
}
