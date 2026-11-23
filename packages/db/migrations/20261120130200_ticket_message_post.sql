-- 20261120130200 やり取りに書き込む口（K-385・契約の口 createTicketMessage・答え合わせ ⑧⑨⑭⑮・D-125.130・D-130.1・D-130.4・D-136.1・D-136.2・関門 C2 と C6 の受け箱の行）
--   書き込み 1 行と受け箱の行を 1 つの取引（app.ticket_message_post の 1 回）で書く。途中で落ちたら何も残らない。
--
-- ① app.ticket_visible_for：人を指定して「そのチケットを見られるか」（app.ticket_visible は呼んだ人だけ）。中だけで使う
-- ② app.ticket_message_people：並びの中で、見られない最初の人の id（全員見られれば null）。中だけで使う（K-386 も使う）
-- ③ app.ticket_message_notify：受け箱の行を書く（K-386 も使う）。中だけで使う
-- ④ app.ticket_message_post：書く（K-389 が作り直して段の欄を足す）。kaname_app に渡す

-- ① 人を指定して見られるか：消していないチケット・抜けていない止められていない人・取り込みの下書きの持ち主・
--   グループが見える（visible_scopes）か担当者か関わっている人（app.ticket_involved）。K-383 の候補（people）と同じ条件
create or replace function app.ticket_visible_for(p_ticket uuid, p_member uuid) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select exists (
    select 1 from tickets t
     where t.id = p_ticket and t.tenant_id = app.tenant_id() and t.deleted_at is null
       and app.ticket_member_ok(t.tenant_id, p_member)
       and exists (select 1 from members m where m.id = p_member and m.tenant_id = t.tenant_id and m.kind_id = 'human')
       and app.ticket_draft_ok(t.draft_import_id, p_member)
       and (t.scope_id = any(visible_scopes(p_member)) or t.assignee_member_id = p_member or app.ticket_involved(t.id, p_member))
  )
$$;
revoke all on function app.ticket_visible_for(uuid, uuid) from public;

-- ② 見られない最初の人（並びの順）。全員見られる（空の並びも）なら null
create or replace function app.ticket_message_people(p_ticket uuid, p_ids uuid[]) returns uuid
language sql stable security definer set search_path = public, app, pg_temp as $$
  select x.id from unnest(coalesce(p_ids, '{}'::uuid[])) with ordinality as x(id, n)
   where not app.ticket_visible_for(p_ticket, x.id)
   order by x.n limit 1
$$;
revoke all on function app.ticket_message_people(uuid, uuid[]) from public;

-- ③ 受け箱の行（メールは送らない・ベルで見る画面は段 8）。宛先＝(p_members ∪ p_mentioned) − 呼んだ人、1 人 1 通。
--   p_mentioned の人は ticket.mentioned・ほかは ticket.message。本文は入れない。sent_at は今（受け箱に入った時点で届いた）。
--   notifications の dedupe_key には一意の索引が無いので on conflict は使わず、同じ dedupe_key の行がもう在る人には書かない。答えは書いた行の数
create or replace function app.ticket_message_notify(p_message uuid, p_members uuid[], p_mentioned uuid[]) returns integer
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  m ticket_messages%rowtype; t tickets%rowtype; v_me uuid := app.user_id(); n integer := 0;
begin
  select * into m from ticket_messages where id = p_message and tenant_id = app.tenant_id();
  if m.id is null then return 0; end if;
  select * into t from tickets where id = m.ticket_id and tenant_id = m.tenant_id;
  if t.id is null then return 0; end if;
  insert into notifications (tenant_id, member_id, channel_id, event_kind_id, payload, dedupe_key, sent_at, created_by)
    select m.tenant_id, r.id, 'inapp',
           case when r.id = any(coalesce(p_mentioned, '{}'::uuid[])) then 'ticket.mentioned' else 'ticket.message' end,
           jsonb_build_object('ticket_id', t.id, 'number', t.number, 'title', t.title, 'message_id', m.id, 'url', '/tickets/' || t.id::text),
           'ticket.message:' || m.id::text || ':' || r.id::text, now(), v_me
      from (select distinct u.id from unnest(coalesce(p_members, '{}'::uuid[]) || coalesce(p_mentioned, '{}'::uuid[])) as u(id)
             where u.id is not null and u.id is distinct from v_me) r
     where not exists (select 1 from notifications o where o.dedupe_key = 'ticket.message:' || m.id::text || ':' || r.id::text);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function app.ticket_message_notify(uuid, uuid[], uuid[]) from public;

-- ④ 書く。p の鍵：body・mention_member_ids・notify_member_ids・quote_of_id。
--   答え { item }（app.ticket_timeline_item の形・kind post）か { error }（何も書いていない）。
--   error：not_found（見えない・無い・消した）／empty（本文が空）／not_selectable（@・知らせる人・引用元が選べない。どの欄かは返さない＝在るかを漏らさない・口は 404 E-PAGE-001）
--   見える・書けるの確かめ：呼んだ人が抜けていない・止められていない人で、app.ticket_visible（行の守りと同じ）でチケットが見えること（読める人は書ける・⑧）
create or replace function app.ticket_message_post(p_ticket uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  v_tenant uuid := app.tenant_id(); v_me uuid := app.user_id(); t tickets%rowtype;
  v_body text := p->>'body'; v_mention uuid[]; v_notify uuid[]; v_quote uuid := nullif(p->>'quote_of_id', '')::uuid;
  v_qtext text; v_bad uuid; v_id uuid; v_seen timestamptz;
begin
  if v_tenant is null or v_me is null or p_ticket is null
     or not app.ticket_member_ok(v_tenant, v_me) or not app.ticket_visible(p_ticket) then
    return jsonb_build_object('error', 'not_found');
  end if;
  select * into t from tickets where id = p_ticket and tenant_id = v_tenant and deleted_at is null;
  if t.id is null then return jsonb_build_object('error', 'not_found'); end if;
  if v_body is null or btrim(v_body, E' \t\r\n\f\v　') = '' then
    return jsonb_build_object('error', 'empty', 'field', 'body');
  end if;
  -- 重なりは 1 つにし、並びは最初に出た順。知らせる人の並びから自分を外す（@ は本文の札なので自分も残す）
  select coalesce(array_agg(y.id order by y.n), '{}'::uuid[]) into v_mention
    from (select distinct on (x.id::uuid) x.id::uuid as id, x.n from jsonb_array_elements_text(coalesce(p->'mention_member_ids', '[]'::jsonb))
            with ordinality as x(id, n) order by x.id::uuid, x.n) y;
  select coalesce(array_agg(y.id order by y.n), '{}'::uuid[]) into v_notify
    from (select distinct on (x.id::uuid) x.id::uuid as id, x.n from jsonb_array_elements_text(coalesce(p->'notify_member_ids', '[]'::jsonb))
            with ordinality as x(id, n) where x.id::uuid <> v_me order by x.id::uuid, x.n) y;
  v_bad := app.ticket_message_people(p_ticket, v_mention);
  if v_bad is not null then return jsonb_build_object('error', 'not_selectable'); end if;
  v_bad := app.ticket_message_people(p_ticket, v_notify);
  if v_bad is not null then return jsonb_build_object('error', 'not_selectable'); end if;
  if v_quote is not null then
    -- 同じチケットの、消していない書き込み（kind post）だけ。元の頭の 2 行（改行で分けた最初の 2 行・行の中は切らない）を写す
    select array_to_string((string_to_array(m.body, E'\n'))[1:2], E'\n') into v_qtext
      from ticket_messages m
     where m.id = v_quote and m.tenant_id = v_tenant and m.ticket_id = p_ticket and m.kind = 'post' and m.deleted_at is null;
    if not found then return jsonb_build_object('error', 'not_selectable'); end if;
  end if;
  insert into ticket_messages (tenant_id, ticket_id, author_member_id, kind, body, mentions, notify_member_ids, quote_of_id, quote_text, created_by, updated_by)
    values (v_tenant, p_ticket, v_me, 'post', v_body, v_mention, v_notify, v_quote, v_qtext, v_me, v_me)
    returning id into v_id;
  perform app.ticket_message_notify(v_id, v_notify, v_mention);
  select s.seen_at into v_seen from app.ticket_thread_seen s where s.tenant_id = v_tenant and s.ticket_id = p_ticket and s.member_id = v_me;
  return jsonb_build_object('item', app.ticket_timeline_item(v_id, v_seen));
end $$;
revoke all on function app.ticket_message_post(uuid, jsonb) from public;
grant execute on function app.ticket_message_post(uuid, jsonb) to kaname_app;
