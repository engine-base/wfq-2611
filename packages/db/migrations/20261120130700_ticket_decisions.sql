-- 20261120130700 決定を読む口・足す口（K-390・契約の口 listTicketDecisions・createTicketDecision・D-125.40・D-125.63・D-130.1・D-130.4・D-136.1・D-136.2・関門 C2）
--   決めたことと理由を残し、後から根拠として引けるようにする。直接書く道と、やり取りの書き込みから決定にする道（source_message_id）の 2 つ。
--
-- ① 決定の表の 2000 字の決まりを外す（自由に書く欄に上限を置かない・D-130.1）。代わりに「空白だけの字」を断る
-- ② 列を足す：decided_note（決めた人のひとこと）・cancelled_at／cancelled_by／cancel_reason（取り消しの印と理由・K-391 が書く。同じ表に 2 回列を足さない）
-- ③ 関数：決定 1 件の答えの形（中だけ）・読む（口が呼ぶ）・足す（口が呼ぶ・1 つの処理）・知らせを書く（中だけ）

-- ① 2000 字の決まり（0072 の名前の無い check の自動の名前）を外し、空白だけを断る決まりに付け替える
-- squawk-ignore ban-drop-constraint
alter table ticket_decisions drop constraint if exists ticket_decisions_text_check;
alter table ticket_decisions add constraint ticket_decisions_text_not_blank check (text ~ '\S') not valid;
alter table ticket_decisions validate constraint ticket_decisions_text_not_blank;

-- ② 列（どれも既定は null。取り消したなら、取り消した人と理由が要る）
alter table ticket_decisions add column if not exists decided_note text;
alter table ticket_decisions add column if not exists cancelled_at timestamptz;
-- squawk-ignore adding-foreign-key-constraint
alter table ticket_decisions add column if not exists cancelled_by uuid references members(id);
alter table ticket_decisions add column if not exists cancel_reason text;
alter table ticket_decisions add constraint ticket_decisions_cancel_ck
  check (cancelled_at is null or (cancelled_by is not null and coalesce(cancel_reason, '') ~ '\S')) not valid;
alter table ticket_decisions validate constraint ticket_decisions_cancel_ck;

-- ③-1 決定 1 件の答えの形（中だけ・K-391 も使う）。決めた人・取り消した人は会社から外れていても名前を出す（D-128.96）。
--   引くのは呼んだ人の会社の人だけ。元の書き込みの時刻 at は消した後も同じ値
create or replace function app.ticket_decision_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = public, app, pg_temp as $$
  select jsonb_build_object(
    'id', d.id,
    'ticket_id', d.ticket_id,
    'text', d.text,
    'reason', d.reason,
    'decided_by', case when d.decided_by is null then null else jsonb_build_object(
        'id', d.decided_by,
        'display_name', (select nullif(btrim(m.display_name), '') from members m where m.id = d.decided_by and m.tenant_id = d.tenant_id)) end,
    'decided_note', d.decided_note,
    'decided_at', d.decided_at,
    'source', case when d.source_message_id is null then null else
        (select jsonb_build_object('id', s.id, 'at', s.created_at, 'deleted', s.deleted_at is not null)
           from ticket_messages s where s.id = d.source_message_id and s.tenant_id = d.tenant_id) end,
    'revises_id', (select r.id from ticket_decisions r
                    where r.superseded_by_id = d.id and r.tenant_id = d.tenant_id and r.deleted_at is null
                    order by r.decided_at, r.id limit 1),
    'superseded_by_id', d.superseded_by_id,
    'cancelled', case when d.cancelled_at is null then null else jsonb_build_object(
        'at', d.cancelled_at,
        'by', case when d.cancelled_by is null then null else jsonb_build_object(
            'id', d.cancelled_by,
            'display_name', (select nullif(btrim(m.display_name), '') from members m where m.id = d.cancelled_by and m.tenant_id = d.tenant_id)) end,
        'reason', d.cancel_reason) end,
    'promoted_to', d.promoted_to)
  from ticket_decisions d where d.id = p_id and d.tenant_id = app.tenant_id() and d.deleted_at is null
$$;
revoke all on function app.ticket_decision_json(uuid) from public;
-- 呼ぶのはこの段の security definer の関数の中だけ。アプリの役には渡さない

-- ③-2 読む。見られないチケット・消したチケットなら null。
--   答え { items, can_write }。並びは 生きている決定（決めた時刻の新しい順）→ 改められた決定（新しい順）→ 取り消した決定（取り消した時刻の新しい順）。
--   同じ時刻は id の順。1 つのチケットの決定は多くて数十なので全部返す（500 を超えたら切って記録に 1 行・字は出さない）
create or replace function app.ticket_decision_list(p_ticket uuid) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare
  v_tenant uuid := app.tenant_id(); v_me uuid := app.user_id(); t tickets%rowtype;
  c_max constant int := 500; v_items jsonb; v_total int;
begin
  if v_tenant is null or v_me is null or p_ticket is null or not app.ticket_visible(p_ticket) then return null; end if;
  select * into t from tickets where id = p_ticket and tenant_id = v_tenant and deleted_at is null;
  if t.id is null then return null; end if;
  select count(*) into v_total from ticket_decisions d where d.ticket_id = t.id and d.tenant_id = v_tenant and d.deleted_at is null;
  if v_total > c_max then raise warning 'ticket_decision_list: % 件のうち % 件で切った', v_total, c_max; end if;
  select coalesce(jsonb_agg(app.ticket_decision_json(x.id) order by x.grp, x.sort_at desc, x.id), '[]'::jsonb) into v_items
    from (select d.id,
                 case when d.cancelled_at is not null then 2 when d.superseded_by_id is not null then 1 else 0 end as grp,
                 case when d.cancelled_at is not null then d.cancelled_at else d.decided_at end as sort_at
            from ticket_decisions d
           where d.ticket_id = t.id and d.tenant_id = v_tenant and d.deleted_at is null
           order by 2, 3 desc, 1 limit c_max) x;
  return jsonb_build_object(
    'items', v_items,
    'can_write', coalesce(app.approval_member_now() and app.ticket_writable(t.id), false));
end $$;
revoke all on function app.ticket_decision_list(uuid) from public;
grant execute on function app.ticket_decision_list(uuid) to kaname_app;

-- ③-3 知らせを書く（中だけ・K-391 も使う）。宛先を選ぶのはここだけ：担当者と、決まっていない承認待ちの承認する人（今は担当者と同じ人）。
--   呼んだ人自身・会社から抜けた人・止められた人は除く。同じ人には 1 つ（dedupe_key は ticket.decision:<決定の id>:<action>）。
--   本文はチケットの id・番号・リンク・決定の id・action だけ（決めたことの字は入れない）。action は add・revise・cancel
create or replace function app.ticket_decision_notify(p_ticket uuid, p_decision uuid, p_action text) returns integer
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare t tickets%rowtype; v_me uuid := app.user_id(); v_key text; n integer := 0;
begin
  select * into t from tickets where id = p_ticket and tenant_id = app.tenant_id() and deleted_at is null;
  if t.id is null or p_decision is null or p_action not in ('add', 'revise', 'cancel') then return 0; end if;
  v_key := 'ticket.decision:' || p_decision::text || ':' || p_action;
  insert into notifications (tenant_id, member_id, channel_id, event_kind_id, payload, dedupe_key, created_by)
    select t.tenant_id, r.id, 'inapp', 'ticket.decision',
           jsonb_build_object('ticket_id', t.id, 'number', t.number, 'url', '/tickets/' || t.id::text,
                              'decision_id', p_decision, 'action', p_action),
           v_key, v_me
      from (select t.assignee_member_id as id
            union
            select a.approver_member_id from approvals a
             where a.tenant_id = t.tenant_id and a.ticket_id = t.id
               and a.decision is null and a.withdrawn_at is null and a.deleted_at is null) r
     where r.id is not null and r.id is distinct from v_me and app.ticket_member_ok(t.tenant_id, r.id)
       and not exists (select 1 from notifications o
                        where o.tenant_id = t.tenant_id and o.member_id = r.id and o.dedupe_key = v_key);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function app.ticket_decision_notify(uuid, uuid, text) from public;

-- ③-4 足す（1 つの処理：決定・やり取りの 1 行・受け箱・証跡）。p の鍵は text・reason・decided_by_member_id・decided_note・source_message_id・promoted_to。
--   答えは { decision, message_id } か { error[, field] }。だめなときは何も書かない。
--   守りの 2 層目：今のメンバーで、そのチケットを書ける人（口の入口の行の確かめ write と同じ判定）。見るだけの人は足せない。
--   守りの判定で例外になったら guard_failed（止める側に倒す・D-136.1）。見る順：
--     会社か人が無い → not_member／無い・消した・見られない → not_found／今のメンバーでない → not_member／書けない → not_writable／
--     取引先のルール → not_yet／ほかの値 → bad_promoted／決めたことが空 → text_empty／決めた人 → bad_decider／元の書き込み → bad_source
create or replace function app.ticket_decision_add(p_ticket uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  v_tenant uuid := app.tenant_id(); v_me uuid := app.user_id(); t tickets%rowtype;
  c_blank constant text := E' \t\r\n\f\v 　';
  c_ctrl constant text := '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]';
  v_text text; v_reason text; v_note text; v_promoted text; v_decider uuid := app.user_id(); v_source uuid;
  v_raw text; v_id uuid; v_msg uuid;
begin
  if v_tenant is null or v_me is null or p_ticket is null then return jsonb_build_object('error', 'not_member'); end if;
  begin
    select * into t from tickets where id = p_ticket and tenant_id = v_tenant and deleted_at is null for update;
    if t.id is null or not app.ticket_visible(t.id) then return jsonb_build_object('error', 'not_found'); end if;
    if not app.approval_member_now() then return jsonb_build_object('error', 'not_member'); end if;
    if not app.ticket_writable(t.id) then return jsonb_build_object('error', 'not_writable'); end if;
  exception when others then
    return jsonb_build_object('error', 'guard_failed');
  end;

  v_promoted := coalesce(nullif(p->>'promoted_to', ''), 'ticket');
  if v_promoted = 'client_rule' then return jsonb_build_object('error', 'not_yet', 'field', 'promoted_to'); end if;
  if v_promoted <> 'ticket' then return jsonb_build_object('error', 'bad_promoted', 'field', 'promoted_to'); end if;

  -- 字：制御文字（タブ・改行を除く）を取り除き、前後の空白（全角も）を落とす。上限は置かない・切らない
  v_text := btrim(regexp_replace(coalesce(p->>'text', ''), c_ctrl, '', 'g'), c_blank);
  if v_text = '' then return jsonb_build_object('error', 'text_empty', 'field', 'text'); end if;
  v_reason := nullif(btrim(regexp_replace(coalesce(p->>'reason', ''), c_ctrl, '', 'g'), c_blank), '');
  v_note := nullif(btrim(regexp_replace(coalesce(p->>'decided_note', ''), c_ctrl, '', 'g'), c_blank), '');

  -- 決めた人：既定は本人。ほかの人なら同じ会社の今のメンバー
  v_raw := nullif(p->>'decided_by_member_id', '');
  if v_raw is not null then
    begin
      v_decider := v_raw::uuid;
    exception when others then
      return jsonb_build_object('error', 'bad_decider', 'field', 'decided_by_member_id');
    end;
    if not app.ticket_member_ok(v_tenant, v_decider) then
      return jsonb_build_object('error', 'bad_decider', 'field', 'decided_by_member_id');
    end if;
  end if;

  -- 元の書き込み：このチケットの消していない書き込み（kind post）
  v_raw := nullif(p->>'source_message_id', '');
  if v_raw is not null then
    begin
      select m.id into v_source from ticket_messages m
       where m.id = v_raw::uuid and m.tenant_id = v_tenant and m.ticket_id = t.id and m.kind = 'post' and m.deleted_at is null;
    exception when others then
      v_source := null;
    end;
    if v_source is null then return jsonb_build_object('error', 'bad_source', 'field', 'source_message_id'); end if;
  end if;

  insert into ticket_decisions (tenant_id, ticket_id, text, reason, decided_by, decided_note, source_message_id, promoted_to, created_by)
    values (v_tenant, t.id, v_text, v_reason, v_decider, v_note, v_source, v_promoted, v_me) returning id into v_id;
  insert into ticket_messages (tenant_id, ticket_id, author_member_id, kind, body, changes, created_by)
    values (v_tenant, t.id, v_me, 'change', app.member_name(v_me) || ' が決定を足した',
            jsonb_build_array(jsonb_build_object('field', 'decision', 'from', null::text, 'to', v_id, 'note', 'add')), v_me)
    returning id into v_msg;
  perform app.ticket_decision_notify(t.id, v_id, 'add');
  insert into audit_events (tenant_id, actor_member_id, actor_role, action, target_type, target_id, choke_point_id, payload, created_by)
    values (v_tenant, v_me, 'member', 'ticket_decision.add', 'ticket_decisions', v_id::text, 'C2',
            jsonb_build_object('decision_id', v_id), v_me);
  return jsonb_build_object('decision', app.ticket_decision_json(v_id), 'message_id', v_msg);
end $$;
revoke all on function app.ticket_decision_add(uuid, jsonb) from public;
grant execute on function app.ticket_decision_add(uuid, jsonb) to kaname_app;
