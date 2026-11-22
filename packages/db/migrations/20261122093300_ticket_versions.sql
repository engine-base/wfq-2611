-- 20261122093300_ticket_versions 本文の版を読む・版に戻す・項目の変更を比べる（K-433・D-150.1・D-150.13・D-150.29・D-150.30・D-150.40・D-150.47・D-150.52・D-128.45・D-128.115・D-130.1・関門 C2）
--   読む 2 本（app.ticket_versions・app.ticket_item_changes）は書かない。戻す 1 本（app.ticket_body_restore）は K-432 の app.ticket_body_set を呼ぶだけで、
--   本文の行・版の行・やり取りの 1 行・証跡の二重書きは K-432 の関数の 1 つの取引に任せる（lessons L-002・関数を書き直さない）。
--   項目の変更は記録の表を別に作らず、やり取りの更新の行（ticket_messages の kind change）から読む（D-150.40）。
--   「項目の更新の行」＝ changes に body・test_spec・item_restore（項目を戻したまとめの行・K-576）以外の欄が 1 つでもある行。
--   どの関数も答えは jsonb：{error: forbidden | not_found | not_writable | done | conflict | same}（口が HTTP の番号に直す）か、読んだ物。

-- ① 項目の名前（固定の欄は表のとおり・会社の項目 field:<uuid> は custom_fields.name・どれでもなければ欄のキーのまま）
create or replace function app.ticket_item_name(p_field text) returns text
language sql stable security definer set search_path = public, app, pg_temp as $$
  select case p_field
    when 'due_on' then '期限'
    when 'start_on' then '開始日'
    when 'priority' then '優先度'
    when 'assignee' then '担当者'
    when 'stage' then '状態'
    when 'parent' then '親'
    when 'estimate_minutes' then '予定時間'
    when 'actual_minutes' then '実績時間'
    when 'hold_reason' then '保留の理由'
    when 'resume_condition' then '再開の条件'
    else coalesce(
      case when p_field ~* '^field:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           then (select c.name from custom_fields c where c.id = substr(p_field, 7)::uuid and c.tenant_id = app.tenant_id())
      end, p_field)
  end
$$;
revoke all on function app.ticket_item_name(text) from public;
grant execute on function app.ticket_item_name(text) to kaname_app;

-- ② 戻せる項目の印（D-150.52）：戻せるなら null・戻せないなら固定の訳の文
create or replace function app.ticket_item_restorable(p_field text) returns text
language sql immutable security definer set search_path = public, app, pg_temp as $$
  select case
    when p_field in ('start_on', 'due_on', 'priority', 'estimate_minutes') or p_field like 'field:%' then null
    when p_field = 'stage' then '状態は段の決まりがあるので戻せません'
    when p_field = 'assignee' then '担当者は「渡す」の流れで変えます'
    when p_field = 'parent' then '親は 3 段までの決まりがあるので戻せません'
    else 'この項目は戻せません'
  end
$$;
revoke all on function app.ticket_item_restorable(text) from public;
grant execute on function app.ticket_item_restorable(text) to kaname_app;

-- ③ そのチケットの「項目の更新の行」を、作った日時・id の順に 1 から数える（k 番目の行の後が点 k + 1）。
--   見えるかの確かめは呼ぶ側（app.ticket_item_changes）が済ませる。口からは直に呼ばせない（kaname_app に渡さない）
create or replace function app.ticket_item_rows(p_ticket uuid)
returns table (k int, made_at timestamptz, who uuid, changes jsonb)
language sql stable security definer set search_path = public, app, pg_temp as $$
  select (row_number() over (order by m.created_at, m.id))::int, m.created_at, m.author_member_id, m.changes
    from ticket_messages m
   where m.ticket_id = p_ticket and m.tenant_id = app.tenant_id() and m.kind = 'change' and m.deleted_at is null
     and jsonb_typeof(m.changes) = 'array'
     and exists (select 1 from jsonb_array_elements(m.changes) c
                  where c->>'field' is not null and c->>'field' not in ('body', 'test_spec', 'item_restore'))
$$;
revoke all on function app.ticket_item_rows(uuid) from public;

-- ④ 本文の版の一覧と、比べる 2 つの版の text。版は新しい順に 200 まで（201 行目があれば truncated）
create or replace function app.ticket_versions(p_ticket uuid, p_from int, p_to int) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare
  v_tenant uuid := app.tenant_id();
  t tickets%rowtype;
  s ticket_sections%rowtype;
  v_can boolean;
  v_to int;
  v_from int;
  v_list jsonb;
  v_trunc boolean;
  v_ft text;
  v_tt text;
begin
  if v_tenant is null or app.user_id() is null or not app.member_ok() then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into t from tickets where id = p_ticket and tenant_id = v_tenant and deleted_at is null;
  if not found or not app.ticket_visible(t.id) then
    return jsonb_build_object('error', 'not_found');
  end if;
  -- 書けて、完了していない人だけが戻せる（画面が「戻す」を押せるかの出し分けに使う）
  v_can := app.ticket_writable(t.id) and t.completed_at is null
           and not exists (select 1 from ticket_stages st where st.id = t.stage_id and st.key = 'done');
  select * into s from ticket_sections where ticket_id = t.id and section_key = 'body';
  if not found then
    return jsonb_build_object('versions', '[]'::jsonb, 'from', null, 'to', null, 'truncated', false, 'can_restore', v_can);
  end if;
  v_to := coalesce(p_to, s.version);
  v_from := coalesce(p_from, case when v_to > 1 then v_to - 1 end);
  select v.body->>'text' into v_tt from ticket_section_versions v where v.section_id = s.id and v.version = v_to;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;
  if v_from is not null then
    select v.body->>'text' into v_ft from ticket_section_versions v where v.section_id = s.id and v.version = v_from;
    if not found then
      return jsonb_build_object('error', 'not_found');
    end if;
  end if;
  with r as (
    select v.version, v.edited_by, v.edited_by_clone, v.edited_at, v.restored_from,
           row_number() over (order by v.version desc) as rn
      from ticket_section_versions v
     where v.section_id = s.id
     order by v.version desc
     limit 201
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'version', r.version,
           'edited_by', case when r.edited_by_clone or r.edited_by is null then null
                             else jsonb_build_object('id', r.edited_by, 'name', coalesce(app.member_name(r.edited_by), '自分')) end,
           'edited_by_ai', r.edited_by_clone,
           'edited_at', r.edited_at,
           'is_current', r.version = s.version,
           'restored_from', r.restored_from,
           'summary', case when r.version = 1 then '作成'
                           when r.restored_from is not null then '版 ' || r.restored_from || ' に戻した'
                           else '本文を直した' end) order by r.version desc) filter (where r.rn <= 200), '[]'::jsonb),
         coalesce(bool_or(r.rn > 200), false)
    into v_list, v_trunc
    from r;
  return jsonb_build_object(
    'versions', v_list,
    'from', case when v_from is null then null else jsonb_build_object('version', v_from, 'text', v_ft) end,
    'to', jsonb_build_object('version', v_to, 'text', v_tt),
    'truncated', v_trunc,
    'can_restore', v_can);
end $$;
revoke all on function app.ticket_versions(uuid, int, int) from public;
grant execute on function app.ticket_versions(uuid, int, int) to kaname_app;

-- ⑤ 本文を版 p_from に戻す。確かめの順は K-432 の関数と同じ（会社の人 → チケットの行を押さえる・見えない／消した → 書ける → 完了）。
--   そのあと 本文の行 → 戻す版の行 → 今見ている版（p_current）→ 戻す先が今と同じ（same）。通れば K-432 の app.ticket_body_set に任せる（版・やり取り・証跡はそこで 1 つの取引）
create or replace function app.ticket_body_restore(p_ticket uuid, p_from int, p_current int) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  v_tenant uuid := app.tenant_id();
  t tickets%rowtype;
  s ticket_sections%rowtype;
  v_body jsonb;
begin
  if v_tenant is null or app.user_id() is null or not app.member_ok() then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into t from tickets where id = p_ticket and tenant_id = v_tenant and deleted_at is null for update;
  if not found or not app.ticket_visible(t.id) then
    return jsonb_build_object('error', 'not_found');
  end if;
  if not app.ticket_writable(t.id) then
    return jsonb_build_object('error', 'not_writable');
  end if;
  if t.completed_at is not null or exists (select 1 from ticket_stages st where st.id = t.stage_id and st.key = 'done') then
    return jsonb_build_object('error', 'done');
  end if;
  select * into s from ticket_sections where ticket_id = t.id and section_key = 'body' for update;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;
  select v.body into v_body from ticket_section_versions v where v.section_id = s.id and v.version = p_from;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;
  if p_current is distinct from s.version then
    return jsonb_build_object('error', 'conflict');
  end if;
  if v_body->'doc' = s.body->'doc' then
    return jsonb_build_object('error', 'same');
  end if;
  return app.ticket_body_set(p_ticket, jsonb_build_object(
    'version', p_current, 'doc', v_body->'doc', 'text', v_body->>'text', 'restored_from', p_from));
end $$;
revoke all on function app.ticket_body_restore(uuid, int, int) from public;
grant execute on function app.ticket_body_restore(uuid, int, int) to kaname_app;

-- ⑥ 項目の変更の点の一覧（作成が点 1・k 番目の項目の更新の行の後が点 k + 1・新しい順に 200 まで）と、
--   点 p_from から p_to までの間の正味の変わり（同じ項目の最初の from と最後の to を比べ、同じなら出さない・最初に現れた順）。
--   p_from が p_to より大きければ向きを逆にして返す（from と to を入れ替える）
create or replace function app.ticket_item_changes(p_ticket uuid, p_from int, p_to int) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare
  v_tenant uuid := app.tenant_id();
  t tickets%rowtype;
  v_max int;
  v_to int;
  v_from int;
  v_pts jsonb;
  v_trunc boolean;
  v_diff jsonb := '[]'::jsonb;
begin
  if v_tenant is null or app.user_id() is null or not app.member_ok() then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into t from tickets where id = p_ticket and tenant_id = v_tenant and deleted_at is null;
  if not found or not app.ticket_visible(t.id) then
    return jsonb_build_object('error', 'not_found');
  end if;
  select count(*)::int + 1 into v_max from app.ticket_item_rows(t.id);
  v_to := coalesce(p_to, v_max);
  v_from := coalesce(p_from, case when v_to > 1 then v_to - 1 end);
  if v_to < 1 or v_to > v_max or (v_from is not null and (v_from < 1 or v_from > v_max)) then
    return jsonb_build_object('error', 'not_found');
  end if;
  with pts as (
    select 1 as n, t.created_at as at_, t.created_by as who, '作成'::text as summary
    union all
    select r.k + 1, r.made_at, r.who,
           (select string_agg(app.ticket_item_name(e.c->>'field'), '・' order by e.ord) || 'を変えた'
              from jsonb_array_elements(r.changes) with ordinality as e(c, ord)
             where e.c->>'field' is not null and e.c->>'field' not in ('body', 'test_spec', 'item_restore'))
      from app.ticket_item_rows(t.id) r
  ), top as (
    select p.*, row_number() over (order by p.n desc) as rn from pts p order by p.n desc limit 201
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'n', top.n,
           'at', top.at_,
           'by', case when top.who is null then null
                      else jsonb_build_object('id', top.who, 'name', coalesce(app.member_name(top.who), '自分')) end,
           'by_ai', top.who is null,
           'summary', top.summary) order by top.n desc) filter (where top.rn <= 200), '[]'::jsonb),
         coalesce(bool_or(top.rn > 200), false)
    into v_pts, v_trunc
    from top;
  if v_from is not null then
    with el as (
      select r.k, e.ord, e.c->>'field' as field,
             coalesce(e.c->'from', 'null'::jsonb) as f, coalesce(e.c->'to', 'null'::jsonb) as t_,
             e.c->'raw_from' as rf, e.c->'raw_to' as rt
        from app.ticket_item_rows(t.id) r, jsonb_array_elements(r.changes) with ordinality as e(c, ord)
       where r.k >= least(v_from, v_to) and r.k <= greatest(v_from, v_to) - 1
         and e.c->>'field' is not null and e.c->>'field' not in ('body', 'test_spec', 'item_restore')
    ), g as (
      select field,
             (array_agg(f order by k, ord))[1] as first_from,
             (array_agg(t_ order by k desc, ord desc))[1] as last_to,
             (array_agg(rf order by k, ord))[1] as first_rf,
             (array_agg(rt order by k desc, ord desc))[1] as last_rt,
             min(k * 100000 + ord) as pos
        from el group by field
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'field', g.field,
             'name', app.ticket_item_name(g.field),
             'from', case when v_from <= v_to then g.first_from else g.last_to end,
             'to', case when v_from <= v_to then g.last_to else g.first_from end,
             'raw_from', case when v_from <= v_to then g.first_rf else g.last_rt end,
             'raw_to', case when v_from <= v_to then g.last_rt else g.first_rf end,
             'restorable', app.ticket_item_restorable(g.field) is null,
             'why', app.ticket_item_restorable(g.field)) order by g.pos), '[]'::jsonb)
      into v_diff
      from g
     where g.first_from is distinct from g.last_to;
  end if;
  return jsonb_build_object('points', v_pts, 'from', v_from, 'to', v_to, 'diff', v_diff, 'truncated', v_trunc);
end $$;
revoke all on function app.ticket_item_changes(uuid, int, int) from public;
grant execute on function app.ticket_item_changes(uuid, int, int) to kaname_app;
