// フォルダの口 3 本（K-678）が共有する読みと答えの形・DB の断りの番号への直し。ログに名前を出さない
import type pg from "pg";
import type { HookReply } from "../../../contract/deps.js";
import { conflict, unavailable } from "./reply.js";
import type { ShelfKind } from "./shape.js";

/** フォルダの深さの上限（棚の直下が 1） */
export const FOLDER_DEPTH_MAX = 6;

export interface FolderRead {
  readonly id: string;
  readonly name: string;
  readonly scope_id: string;
  readonly is_personal: boolean;
  readonly owner_member_id: string;
  readonly parent_folder_id: string | null;
  readonly position: number;
  readonly shelf_kind: ShelfKind;
  readonly visible: boolean;
  readonly writable: boolean;
}

/** 答えの KnowledgeFolder（鍵ちょうど 6） */
export interface KnowledgeFolderOut {
  readonly id: string;
  readonly name: string;
  readonly shelf: ShelfKind;
  readonly group_id: string | null;
  readonly parent_folder_id: string | null;
  readonly position: number;
}

export const FOLDER_COLS = `f.id, f.name, f.scope_id, f.is_personal, f.owner_member_id, f.parent_folder_id, f.position,
       app.kn_shelf_kind(f.scope_id, f.is_personal) as shelf_kind`;
const READ_SQL = `select ${FOLDER_COLS}, app.kfolder_visible(f.id) as visible, app.kfolder_writable(f.id) as writable
  from knowledge_folders f where f.id = $1 and f.tenant_id = app.tenant_id() and f.deleted_at is null`;
/** 棚の直下から数えた段（直下が 1） */
const DEPTH_SQL = `with recursive up(id, parent, d) as (
    select f.id, f.parent_folder_id, 1 from knowledge_folders f where f.id = $1 and f.tenant_id = app.tenant_id()
    union all
    select f.id, f.parent_folder_id, up.d + 1 from knowledge_folders f join up on f.id = up.parent where up.d < 64
  ) select coalesce(max(d), 0)::int as n from up`;
/** 自分を 1 として、下の一番深い所までの段の数（消した物は数えない） */
const HEIGHT_SQL = `with recursive down(id, h) as (
    select $1::uuid, 1
    union all
    select f.id, down.h + 1 from knowledge_folders f join down on f.parent_folder_id = down.id
     where f.tenant_id = app.tenant_id() and f.deleted_at is null and down.h < 64
  ) select max(h)::int as n from down`;
/** 自分の下のフォルダ（自分を含まない） */
const BELOW_SQL = `with recursive down(id, n) as (
    select f.id, 1 from knowledge_folders f where f.parent_folder_id = $1 and f.tenant_id = app.tenant_id() and f.deleted_at is null
    union all
    select f.id, down.n + 1 from knowledge_folders f join down on f.parent_folder_id = down.id
     where f.tenant_id = app.tenant_id() and f.deleted_at is null and down.n < 64
  ) select exists (select 1 from down where id = $2) as hit`;
/** 同じ棚・同じ親の中の最後の並び＋10（無ければ 10） */
const NEXT_SQL = `select coalesce(max(f.position), 0) + 10 as n from knowledge_folders f
 where f.tenant_id = app.tenant_id() and f.deleted_at is null and f.scope_id = $1 and f.is_personal = $2
   and (not $2 or f.owner_member_id = app.user_id())
   and f.parent_folder_id is not distinct from $3::uuid`;
const AUDIT_SQL = "select app.record_audit($1, 'knowledge_folders', $2, 'C2', '{}'::jsonb)";

/** 見えるフォルダを読む（無い・消した・別の会社・行の守りで見えない物は null） */
export async function readFolder(cl: pg.PoolClient, id: string): Promise<FolderRead | null> {
  const r = (await cl.query<FolderRead>(READ_SQL, [id])).rows[0];
  return r && r.visible ? r : null;
}
export async function depthOf(cl: pg.PoolClient, id: string | null): Promise<number> {
  if (!id) return 0;
  return Number((await cl.query<{ n: number }>(DEPTH_SQL, [id])).rows[0]?.n ?? 0);
}
export async function heightBelow(cl: pg.PoolClient, id: string): Promise<number> {
  return Number((await cl.query<{ n: number }>(HEIGHT_SQL, [id])).rows[0]?.n ?? 1);
}
export async function isBelow(cl: pg.PoolClient, id: string, other: string): Promise<boolean> {
  return (await cl.query<{ hit: boolean }>(BELOW_SQL, [id, other])).rows[0]?.hit === true;
}
export async function nextPosition(
  cl: pg.PoolClient,
  shelf: { scopeId: string; isPersonal: boolean },
  parent: string | null,
): Promise<number> {
  return Number((await cl.query<{ n: number }>(NEXT_SQL, [shelf.scopeId, shelf.isPersonal, parent])).rows[0]?.n ?? 10);
}
export async function auditFolder(
  cl: pg.PoolClient,
  action: "create" | "update" | "delete",
  id: string,
): Promise<void> {
  await cl.query(AUDIT_SQL, [`knowledge.folder.${action}`, id]);
}

/** 同じ棚か（自分の棚は持ち主も同じ） */
export const sameShelf = (
  a: { scope_id: string; is_personal: boolean; owner_member_id: string },
  b: { scopeId: string; isPersonal: boolean; ownerId: string },
): boolean =>
  a.scope_id === b.scopeId && a.is_personal === b.isPersonal && (!a.is_personal || a.owner_member_id === b.ownerId);

export function toKnowledgeFolder(r: {
  id: string;
  name: string;
  scope_id: string;
  shelf_kind: ShelfKind;
  parent_folder_id: string | null;
  position: number;
}): KnowledgeFolderOut {
  return {
    id: r.id,
    name: r.name,
    shelf: r.shelf_kind,
    group_id: r.shelf_kind === "group" ? r.scope_id : null,
    parent_folder_id: r.parent_folder_id,
    position: r.position,
  };
}

const kindOf = (e: unknown): string => (e instanceof Error ? e.name : typeof e);

/** 取引の外で受けた例外を答えに直す：名前の重なり・深さ・循環・別の棚は 409、それ以外は 503（ログに種類だけ） */
export function folderFailure(e: unknown, what: string): HookReply {
  const err = e as { code?: string; constraint?: string; message?: string };
  if (err?.code === "23505" && err.constraint === "knowledge_folders_name_uq") return conflict("E-KNW-020");
  const msg = typeof err?.message === "string" ? err.message : "";
  if (msg.startsWith("KNW_FOLDER_DEPTH")) return conflict("E-KNW-021");
  if (msg.startsWith("KNW_FOLDER_CYCLE")) return conflict("E-KNW-022");
  if (msg.startsWith("KNW_FOLDER_SHELF")) return conflict("E-KNW-023");
  console.error(`[knowledge] フォルダを${what}なかった（${kindOf(e)}）`);
  return unavailable();
}
