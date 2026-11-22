-- 20261122090100_ticket_body 本文 1 枚の持ち方（K-561・D-150.35・D-150.49・D-150.50・関門 C2）
--   本文は ticket_sections の鍵 body の 1 行（列 body＝{ doc, text }・版は ticket_section_versions）。種別のひな形は ticket_kinds.body_template。
--   ① ticket_kinds.body_template（jsonb・文書の木）を足し、既定の 4 種別（タスク・課題・QA・会議）に製品のひな形（下絵 Template：目的・完了の条件・実施事項・前提と制約・参考）を入れる。
--      新しい会社の種まきは tenants の引き金で入れる（0071 の app.ticket_basics は作り直さない。名前の順で ticket_basics の後に走る）。
--   ② app.ticket_create に「本文 1 枚の道」を足す：入力 body（{doc, text}）が在れば鍵 body の 1 行と版 1 を書く。入力 sections は今までどおり（前の作る面・AI に任せる・完了が壊れないように。消すのは K-575）。
--      text は口が doc から作って渡す（packages/contracts の docToText）。DB は形と上限だけを app.ticket_body_valid で守る。
--   ③ kind_sections は触らない（凍結の印は K-575）。
--   本文の上限：doc の長さ 1,048,576 バイト・text 1,048,576 バイト（節の数に上限は持たない）。packages/contracts/src/doc.ts の DOC_MAX_* と同じ数。

-- ---------------------------------------------------------------- 本文の形の守り（口の入口の確かめと同じ数・直に入れる道の最後の砦）
create or replace function app.ticket_body_valid(b jsonb) returns boolean
language sql stable set search_path = public, app, pg_temp as $$
  select coalesce(
    jsonb_typeof(b) = 'object'
    and jsonb_typeof(b->'text') = 'string'
    and jsonb_typeof(b->'doc') = 'object'
    and b->'doc'->>'type' = 'doc'
    and jsonb_typeof(b->'doc'->'content') = 'array'
    and octet_length(b->>'text') <= 1048576
    and octet_length((b->'doc')::text) <= 1048576,
    false)
$$;

-- 鍵 body の行は形を守る（前の区画の行 {text} には関わらない）
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ticket_sections_body_ok') then
    alter table ticket_sections add constraint ticket_sections_body_ok
      check (section_key <> 'body' or app.ticket_body_valid(body));
  end if;
end $$;

-- ---------------------------------------------------------------- 種別のひな形
alter table ticket_kinds add column if not exists body_template jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ticket_kinds_body_template_ok') then
    alter table ticket_kinds add constraint ticket_kinds_body_template_ok
      check (body_template is null or (jsonb_typeof(body_template) = 'object' and body_template->>'type' = 'doc'
             and jsonb_typeof(body_template->'content') = 'array' and octet_length(body_template::text) <= 1048576));
  end if;
end $$;

-- 製品のひな形（見出しと薄い字の説明。下絵 apps/web/features/F4/doc/views.tsx の Template と同じ字・薄い字は attrs.ghost）
create or replace function app.ticket_body_template() returns jsonb
language sql stable set search_path = public, app, pg_temp as $$
  select jsonb_build_object('type', 'doc', 'content', jsonb_agg(n.node order by v.ord, n.sub))
  from (values
    (1, '目的', 'このチケットで何を実現したいかを書きます'),
    (2, '完了の条件', 'どうなれば終わりかを書きます'),
    (3, '実施事項', 'やることを 1 行ずつ書き、済んだらチェックを付けます'),
    (4, '前提と制約', '守ってほしい条件や、決まっている範囲があれば書きます'),
    (5, '参考', '元のメールや資料のリンクを貼ります')
  ) as v(ord, h, t)
  cross join lateral (values
    (1, jsonb_build_object('type', 'heading', 'attrs', jsonb_build_object('level', 2, 'ghost', true),
          'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', v.h)))),
    (2, jsonb_build_object('type', 'paragraph', 'attrs', jsonb_build_object('ghost', true),
          'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', v.t))))
  ) as n(sub, node)
$$;

-- 既定の種別（is_builtin）で、まだひな形の無い物にだけ入れる（会社が直した物は上書きしない）
create or replace function app.ticket_body_template_basics(t uuid) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  update ticket_kinds set body_template = app.ticket_body_template()
   where tenant_id = t and is_builtin and deleted_at is null and body_template is null;
end $$;
revoke all on function app.ticket_body_template_basics(uuid) from public;

create or replace function app.ticket_body_template_on_tenant() returns trigger
language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  perform app.ticket_body_template_basics(new.id);
  return new;
end $$;
revoke all on function app.ticket_body_template_on_tenant() from public;
-- 名前の順で tenants_ticket_basics（種別を作る）の後に走る
drop trigger if exists tenants_ticket_body_template on tenants;
create trigger tenants_ticket_body_template after insert on tenants for each row execute function app.ticket_body_template_on_tenant();
do $$ declare r record; begin
  for r in select id from tenants loop perform app.ticket_body_template_basics(r.id); end loop;
end $$;

-- ---------------------------------------------------------------- 作る：本文 1 枚の道を足す（0090 の app.ticket_create の作り直し。前の sections の道はそのまま）
--   body が在れば：形と上限を確かめ（違えば 422 BODY_INVALID・何も書かない）、必須の区画の確かめと区画の書き込みはしない（D-150.49・body 優先）、
--   ticket_sections に鍵 body の 1 行（position 0・version 1）と ticket_section_versions の版 1 を書く。
create or replace function app.ticket_create(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  v_tenant uuid := app.tenant_id(); v_me uuid := app.user_id();
  v_scope uuid; v_kind uuid; v_assignee uuid; v_parent uuid; v_stage uuid; v_id uuid; v_number text;
  v_missing text[]; sec record; v_sid uuid; v_body jsonb; v_body_in jsonb; nm uuid; v_notify uuid[];
begin
  if v_tenant is null or v_me is null or not app.member_ok() then
    return jsonb_build_object('ok', false, 'status', 403, 'code', 'FORBIDDEN');
  end if;
  v_scope := nullif(p->>'scope_id', '')::uuid; v_kind := nullif(p->>'kind_id', '')::uuid;
  v_assignee := nullif(p->>'assignee_member_id', '')::uuid; v_parent := nullif(p->>'parent_ticket_id', '')::uuid;
  if not exists (select 1 from scopes s where s.id = v_scope and s.tenant_id = v_tenant and s.deleted_at is null)
     or not has_permission(v_me, 'tickets', v_scope, 'edit') then
    return jsonb_build_object('ok', false, 'status', 403, 'code', 'FORBIDDEN', 'field', 'scope_id');
  end if;
  if not exists (select 1 from ticket_kinds k where k.id = v_kind and k.tenant_id = v_tenant and k.deleted_at is null) then
    return jsonb_build_object('ok', false, 'status', 422, 'code', 'KIND_GONE', 'field', 'kind_id');
  end if;
  if not app.ticket_member_ok(v_tenant, v_assignee) then
    return jsonb_build_object('ok', false, 'status', 422, 'code', 'ASSIGNEE_GONE', 'field', 'assignee_member_id');
  end if;
  if v_parent is not null and not exists (
       select 1 from tickets t where t.id = v_parent and t.tenant_id = v_tenant and t.deleted_at is null and app.ticket_visible(t.id)) then
    return jsonb_build_object('ok', false, 'status', 404, 'code', 'PARENT_NOT_FOUND', 'field', 'parent_ticket_id');
  end if;
  select coalesce(array_agg(distinct x::uuid), '{}') into v_notify from jsonb_array_elements_text(coalesce(p->'notify_member_ids', '[]'::jsonb)) x;
  foreach nm in array v_notify loop
    if not app.ticket_member_ok(v_tenant, nm) then
      return jsonb_build_object('ok', false, 'status', 422, 'code', 'NOTIFY_GONE', 'field', 'notify_member_ids');
    end if;
  end loop;
  -- 本文 1 枚（body）：doc と text の 2 つだけを取り、形と上限を確かめる（口が先に確かめるので、ここは最後の砦）
  if p->'body' is not null and jsonb_typeof(p->'body') <> 'null' then
    v_body_in := jsonb_build_object('doc', p->'body'->'doc', 'text', p->'body'->'text');
    if not app.ticket_body_valid(v_body_in) then
      return jsonb_build_object('ok', false, 'status', 422, 'code', 'BODY_INVALID', 'field', 'body');
    end if;
  else
    -- 前の道（sections）：種別の必須の区画（kind_sections.mode = required・D-125.53）。K-575 でこの道ごと無くなる
    select coalesce(array_agg(ks.section_key order by ks.position), '{}') into v_missing from kind_sections ks
      where ks.kind_id = v_kind and ks.tenant_id = v_tenant and ks.deleted_at is null and ks.mode = 'required'
        and coalesce(btrim(p->'sections'->>ks.section_key), '') = '';
    if array_length(v_missing, 1) > 0 then
      return jsonb_build_object('ok', false, 'status', 422, 'code', 'SECTION_REQUIRED', 'field', 'sections', 'detail', to_jsonb(v_missing));
    end if;
  end if;
  select id into v_stage from ticket_stages where tenant_id = v_tenant and key = 'todo' and deleted_at is null;
  begin
    insert into tickets (tenant_id, scope_id, number, kind_id, stage_id, title, assignee_member_id, parent_ticket_id,
                         start_on, due_on, priority, priority_reason, estimate_minutes, created_by, updated_by)
    values (v_tenant, v_scope, 'pending', v_kind, v_stage, p->>'title', v_assignee, v_parent,
            nullif(p->>'start_on', '')::date, (p->>'due_on')::date, coalesce(nullif(p->>'priority', ''), 'mid'),
            nullif(p->>'priority_reason', ''), nullif(p->>'estimate_minutes', '')::int, v_me, v_me)
    returning id, number into v_id, v_number;
  exception when sqlstate '22023' then
    if sqlerrm like '%3 段%' then return jsonb_build_object('ok', false, 'status', 422, 'code', 'PARENT_DEPTH', 'field', 'parent_ticket_id'); end if;
    raise;
  end;
  if v_body_in is not null then
    insert into ticket_sections (tenant_id, ticket_id, section_key, position, body, version, created_by, updated_by)
      values (v_tenant, v_id, 'body', 0, v_body_in, 1, v_me, v_me) returning id into v_sid;
    insert into ticket_section_versions (tenant_id, ticket_id, section_id, version, body, edited_by, created_by)
      values (v_tenant, v_id, v_sid, 1, v_body_in, v_me, v_me);
  else
    for sec in select ks.section_key, ks.position from kind_sections ks
               where ks.kind_id = v_kind and ks.tenant_id = v_tenant and ks.deleted_at is null and ks.mode <> 'hidden'
                 and coalesce(btrim(p->'sections'->>ks.section_key), '') <> '' loop
      v_body := jsonb_build_object('text', p->'sections'->>sec.section_key);
      insert into ticket_sections (tenant_id, ticket_id, section_key, position, body, version, created_by, updated_by)
        values (v_tenant, v_id, sec.section_key, sec.position, v_body, 1, v_me, v_me) returning id into v_sid;
      insert into ticket_section_versions (tenant_id, ticket_id, section_id, version, body, edited_by, created_by)
        values (v_tenant, v_id, v_sid, 1, v_body, v_me, v_me);
    end loop;
  end if;
  if v_assignee <> v_me then
    insert into notifications (tenant_id, member_id, channel_id, event_kind_id, payload, dedupe_key, created_by)
      values (v_tenant, v_assignee, 'inapp', 'ticket.assigned', jsonb_build_object('ticket_id', v_id, 'number', v_number, 'title', p->>'title'),
              'ticket_assigned:' || v_id || ':' || v_assignee, v_me);
  end if;
  foreach nm in array v_notify loop
    if nm <> v_me and nm <> v_assignee then
      insert into notifications (tenant_id, member_id, channel_id, event_kind_id, payload, dedupe_key, created_by)
        values (v_tenant, nm, 'inapp', 'ticket.created', jsonb_build_object('ticket_id', v_id, 'number', v_number, 'title', p->>'title'),
                'ticket_created:' || v_id || ':' || nm, v_me);
    end if;
  end loop;
  for nm in select (x)::uuid from unnest(array[nullif(p->>'draft_id', ''), nullif(p->>'source_draft_id', '')]) as x where x is not null loop
    delete from app.ticket_drafts where tenant_id = v_tenant and member_id = v_me and draft_id = nm;
    insert into app.ticket_drafts_used (tenant_id, member_id, draft_id) values (v_tenant, v_me, nm)
      on conflict (tenant_id, member_id, draft_id) do update set used_at = now();
  end loop;
  delete from app.ticket_drafts_used where tenant_id = v_tenant and member_id = v_me and used_at < now() - interval '30 days';
  return jsonb_build_object('ok', true, 'id', v_id, 'number', v_number);
end $$;
revoke all on function app.ticket_create(jsonb) from public;
grant execute on function app.ticket_create(jsonb) to kaname_app;
