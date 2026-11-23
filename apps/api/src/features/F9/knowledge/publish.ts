// 書き終える口（K-680・契約の口 publishKnowledgePage・POST /api/v1/knowledge_pages/:id/publish）。
//   1 つの取引で 3 手で確かめてから書く：①見えるか（錠なし・消した・見えない → 404）②書けるか（403）③ページの行に錠をかけ、自分の生きている下書きの版を
//   取り直す（無い → 409 E-KNW-040：下書き無し・別の人の下書きだけ・二度押し）。必ず守るのページは本文が 2,000 字を超えると 409 E-KNW-041（字は SQL で数える）。
//   書く：下書きの版を公開の版にし（本文はそのまま・版はページの次の番号）、ページの版を 1 つ進めて state published。題名・説明・印は触らない。
//   証跡は同じ取引（版の数だけ・題名を入れない）。お知らせは出さない。DB の失敗は 503。ログに題名・本文を出さない
import type pg from "pg";
import { withTenant } from "@kaname/db/context";
import type { HookArgs, HookReply } from "../../../contract/deps.js";
import { conflict, forbidden, notFound, unavailable } from "./reply.js";
import { readMyDraft } from "./draft-shape.js";

const SEEN_SQL = `select app.kpage_writable(p.id) as writable from knowledge_pages p
 where p.id = $1 and p.tenant_id = app.tenant_id() and p.deleted_at is null
   and p.state in ('draft', 'published') and app.kpage_visible(p.id)`;
const LOCK_SQL = `select p.current_version, p.is_must from knowledge_pages p
 where p.id = $1 and p.tenant_id = app.tenant_id() and p.deleted_at is null for update`;
const TOO_LONG_SQL = `select char_length(coalesce(v.body->>'text', '')) > app.kn_must_text_max() as too_long
  from knowledge_page_versions v where v.id = $1`;
const PUBLISH_VERSION_SQL = `update knowledge_page_versions
   set kind = 'published', version = $2, published_at = now(), published_by = app.user_id(), updated_by = app.user_id()
 where id = $1 returning published_at`;
const PAGE_SQL = `update knowledge_pages set current_version = $2, state = 'published', updated_by = app.user_id()
 where id = $1 and tenant_id = app.tenant_id() and deleted_at is null`;
const AUDIT_SQL = "select app.record_audit('knowledge.page.publish', 'knowledge_pages', $1, 'C2', $2::jsonb)";

const kindOf = (e: unknown): string => (e instanceof Error ? e.name : typeof e);

async function run(cl: pg.PoolClient, id: string): Promise<HookReply> {
  const seen = (await cl.query<{ writable: boolean }>(SEEN_SQL, [id])).rows[0];
  if (!seen) return notFound();
  if (seen.writable !== true) return forbidden();
  const page = (await cl.query<{ current_version: number; is_must: boolean }>(LOCK_SQL, [id])).rows[0];
  if (!page) return notFound();
  const draft = await readMyDraft(cl, id); // 錠の後に読む（先に通した同じ下書きは、もう公開になっていて見つからない）
  if (!draft) return conflict("E-KNW-040");
  if (page.is_must && (await cl.query<{ too_long: boolean }>(TOO_LONG_SQL, [draft])).rows[0]?.too_long === true)
    return conflict("E-KNW-041");
  const version = page.current_version + 1;
  const at = (await cl.query<{ published_at: Date }>(PUBLISH_VERSION_SQL, [draft, version])).rows[0]!.published_at;
  await cl.query(PAGE_SQL, [id, version]);
  await cl.query(AUDIT_SQL, [id, JSON.stringify({ version })]);
  return { status: 200, body: { data: { id, version, published_at: at.toISOString() } } };
}

export function createPublishKnowledgePage(appPool: pg.Pool): (a: HookArgs) => Promise<HookReply> {
  return async (a: HookArgs): Promise<HookReply> => {
    try {
      return await withTenant(appPool, a.ctx, (cl) => run(cl, a.id!));
    } catch (e) {
      console.error(`[knowledge] 書き終えられなかった（${kindOf(e)}）`);
      return unavailable();
    }
  };
}
