-- 20261121091000 グループに配る・グループに来たものを引き取る（K-410・段 9・D-125.92・D-125.118・D-148.17・D-148.19・D-148.43・関門 C2）
--   ① app.handover_distribute_group(p_ticket, p)：共通の確かめ（app.handover_gate・チケットの行を for update で取る）→ 渡しの行（distribute・to_scope_id・
--      to_member_id 空・waiting）→ 担当者は配った人に（違っていれば前の担当者に handover.reassigned の知らせの行）→ そのグループで権限を持つ人（配った人を除く）に
--      handover.group_distributed の知らせの行 → 証跡。メールを出す宛てを返す（送るのは口・関門 C6）。理由とお願いは知らせの行にも証跡にも入れない
--   ② app.handover_claim(p_handover, p_member)：共通の確かめ（app.handover_answer_gate・for update）→ グループの人を担当者に決める（p_member が空・呼んだ人と
--      同じなら自分が持つ）→ 渡しの行を accepted に・担当者・一緒に切り替え → 配った人に handover.claimed（人を決めたなら決めた人に handover.distributed）→ 証跡
--   ③ app.handover_answerer の作り直し：グループ宛ての渡しは、決まった後も、そのグループを管理する人を「答える人」と数える（古い画面から押した人に
--      403 でなく 409・E-HND-005 を返すため・K410-API-018・019）。待っている物の判定（p_waiting_only が true）は変えない
--   security definer・search_path に pg_temp。public から外し、口が直に呼ぶ物だけ kaname_app に渡す。会社は app.tenant_id()・呼んだ人は app.user_id()

-- ---------------------------------------------------------------- ③ 答える人（K-401 の形のまま、グループ宛ての決まった渡しにも当てる）
create or replace function app.handover_answerer(p_handover uuid, p_member uuid, p_waiting_only boolean default true) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select exists (
    select 1 from ticket_handovers h
    where h.id = p_handover and h.tenant_id = app.tenant_id() and h.deleted_at is null
      and (not p_waiting_only or h.state = 'waiting')
      and p_member is not null and h.from_member_id <> p_member
      and (h.to_member_id = p_member
           or (h.to_scope_id is not null and (h.to_member_id is null or h.state <> 'waiting')
               and app.handover_manages(p_member, h.to_scope_id)))
      and app.handover_member_state(p_member) = 'active'
  )
$$;

-- ---------------------------------------------------------------- メールの宛て（無ければ null）
create or replace function app.handover_group_email(p_member uuid) returns text
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_email text;
begin
  -- plpgsql にして kaname_auth の表は呼ぶときに引く（migration を当てる時点で認証の表が無くても作れる・handover_dist_email と同じ）
  select u.email::text into v_email
    from members mm
    left join tenant_memberships tm on tm.tenant_id = mm.tenant_id and tm.member_id = mm.id
    join kaname_auth."user" u on u.id = coalesce(mm.auth_user_id, tm.auth_user_id)
   where mm.id = p_member and mm.tenant_id = app.tenant_id() limit 1;
  return v_email;
end $$;

-- ---------------------------------------------------------------- ① グループに配る
create or replace function app.handover_distribute_group(p_ticket uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  v jsonb; v_me uuid := app.user_id(); v_tenant uuid := app.tenant_id();
  v_scope uuid; v_id uuid; v_nid uuid; v_prev uuid; v_number text; v_title text; v_from text; v_group text; v_email text;
  m record; mails jsonb := '[]'::jsonb;
begin
  v := app.handover_gate(p_ticket, coalesce(p, '{}'::jsonb) || '{"kind":"distribute"}'::jsonb, true);
  if v ? 'error' then return v; end if;
  v_scope := nullif(p ->> 'to_scope_id', '')::uuid;
  if v_scope is null then return jsonb_build_object('error', 'target', 'reason', 'scope'); end if;
  v_number := v #>> '{ticket,number}'; v_title := v #>> '{ticket,title}';
  v_prev := (v #>> '{ticket,assignee_member_id}')::uuid;
  v_from := app.member_name(v_me);
  select s.name into v_group from scopes s where s.id = v_scope;
  insert into ticket_handovers (tenant_id, ticket_id, kind, from_member_id, to_scope_id, reason, ask, switch, notify_managers, created_by, updated_by)
    values (v_tenant, p_ticket, 'distribute', v_me, v_scope, p ->> 'reason', nullif(p ->> 'ask', ''), v -> 'switch',
            coalesce((p ->> 'notify_managers')::boolean, false), v_me, v_me)
    returning id into v_id;
  -- 担当者が決まるまでは配った人が担当者（D-148.17・D-148.43）。前の担当者には受け箱の行だけで知らせる
  if v_prev is distinct from v_me then
    update tickets set assignee_member_id = v_me, updated_at = now(), updated_by = v_me where id = p_ticket and tenant_id = v_tenant;
    if v_prev is not null then
      insert into notifications (tenant_id, member_id, channel_id, event_kind_id, payload, dedupe_key, created_by)
        values (v_tenant, v_prev, 'inapp', 'handover.reassigned',
                jsonb_build_object('handover_id', v_id, 'ticket_id', p_ticket, 'number', v_number, 'title', v_title, 'from_name', v_from, 'to_scope_name', v_group),
                'handover_reassigned:' || v_id || ':' || v_prev, v_me);
    end if;
  end if;
  -- そのグループで権限を持つ人（配った人を除く）に受け箱の行とメール（D-148.19）
  for m in select mm.id, mm.display_name from members mm
            where mm.tenant_id = v_tenant and mm.id <> v_me
              and app.handover_member_state(mm.id) = 'active' and app.handover_manages(mm.id, v_scope)
            order by mm.display_name, mm.id loop
    insert into notifications (tenant_id, member_id, channel_id, event_kind_id, payload, dedupe_key, created_by)
      values (v_tenant, m.id, 'inapp', 'handover.group_distributed',
              jsonb_build_object('handover_id', v_id, 'ticket_id', p_ticket, 'number', v_number, 'title', v_title, 'from_name', v_from, 'to_scope_name', v_group),
              'handover_group_distributed:' || v_id || ':' || m.id, v_me)
      returning id into v_nid;
    v_email := app.handover_group_email(m.id);
    if v_email is not null and v_email <> '' then
      mails := mails || jsonb_build_array(jsonb_build_object(
        'notification_id', v_nid, 'handover_id', v_id, 'email', v_email, 'event', 'group_distributed', 'ticket_id', p_ticket,
        'ticket_number', v_number, 'ticket_title', v_title, 'actor_name', v_from, 'to_name', m.display_name, 'reply_due', null));
    end if;
  end loop;
  insert into audit_events (tenant_id, actor_member_id, actor_role, action, target_type, target_id, choke_point_id, payload, created_by)
    values (v_tenant, v_me, 'member', 'handover.group_distributed', 'tickets', p_ticket::text, 'C2',
            jsonb_build_object('handover_id', v_id, 'to_scope_id', v_scope), v_me);
  return jsonb_build_object('ok', true, 'handover_id', v_id, 'handover', app.handover_json(v_id), 'mails', mails);
end $$;

-- ---------------------------------------------------------------- ② 引き取る（自分が持つ・人を決める）
--   答え {ok, handover_id, handover, assignee_member_id, mails} か {error: 言葉, …}。言葉：K-401 の物（not_found・forbidden・decided）に、
--   claim_missing（無い人・別の会社の人・抜けた人。404 にする）・claim_group（同じ会社でグループ［と下のグループ］の外の人。409）・claim_state（止まっている人・招待中・閲覧のみ・依頼する側）。
--   人宛ての渡し（to_member_id が在る）は 42501（口が 403・E-HND-002 にする）
create or replace function app.handover_claim(p_handover uuid, p_member uuid) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  v jsonb; h ticket_handovers%rowtype; t tickets%rowtype; v_me uuid := app.user_id(); v_tenant uuid := app.tenant_id();
  v_to uuid; v_state text; v_applied jsonb; v_name text; v_to_name text; v_nid uuid; v_email text; mails jsonb := '[]'::jsonb;
begin
  v := app.handover_answer_gate(p_handover, true);
  if v ? 'error' then return v; end if;
  if v ->> 'target' <> 'scope' then
    raise exception 'グループ宛てでない渡しは引き取れない' using errcode = '42501';
  end if;
  select * into h from ticket_handovers x where x.id = p_handover and x.tenant_id = v_tenant;
  select * into t from tickets x where x.id = h.ticket_id and x.tenant_id = v_tenant;
  v_to := coalesce(p_member, v_me);
  if v_to <> v_me then
    v_state := app.handover_member_state(v_to);
    if v_state = 'gone' then return jsonb_build_object('error', 'claim_missing'); end if;
    if not exists (select 1 from members x where x.id = v_to and x.tenant_id = v_tenant and x.scope_id in (select app.scope_tree(h.to_scope_id)))
       and not exists (select 1 from scope_memberships sm
                        where sm.member_id = v_to and sm.tenant_id = v_tenant and sm.deleted_at is null
                          and sm.scope_id in (select app.scope_tree(h.to_scope_id))) then
      return jsonb_build_object('error', 'claim_group');
    end if;
    if v_state <> 'active'
       or exists (select 1 from tenant_memberships tm where tm.member_id = v_to and tm.tenant_id = v_tenant
                    and tm.role in ('viewer', 'requester') and tm.deleted_at is null)
       or exists (select 1 from client_contacts c where c.member_id = v_to and c.tenant_id = v_tenant and c.deleted_at is null) then
      return jsonb_build_object('error', 'claim_state');
    end if;
  end if;
  update ticket_handovers set state = 'accepted', decided_at = now(), to_member_id = v_to, answered_by = v_me, updated_at = now(), updated_by = v_me
   where id = h.id;
  update tickets set assignee_member_id = v_to, updated_at = now(), updated_by = v_me where id = t.id and tenant_id = v_tenant;
  v_applied := app.handover_apply_switch(h.id, h.from_member_id, v_to);
  update ticket_handovers set switch_applied = v_applied where id = h.id;
  v_name := app.member_name(v_me); v_to_name := app.member_name(v_to);
  insert into notifications (tenant_id, member_id, channel_id, event_kind_id, payload, dedupe_key, created_by)
    values (v_tenant, h.from_member_id, 'inapp', 'handover.claimed',
            jsonb_build_object('handover_id', h.id, 'ticket_id', t.id, 'number', t.number, 'title', t.title, 'by_name', v_name, 'assignee_name', v_to_name),
            'handover_claimed:' || h.id, v_me);
  if v_to <> v_me then
    insert into notifications (tenant_id, member_id, channel_id, event_kind_id, payload, dedupe_key, created_by)
      values (v_tenant, v_to, 'inapp', 'handover.distributed',
              jsonb_build_object('handover_id', h.id, 'ticket_id', t.id, 'number', t.number, 'title', t.title, 'from_name', v_name),
              'handover_distributed:' || h.id || ':' || v_to, v_me)
      returning id into v_nid;
    v_email := app.handover_group_email(v_to);
    if v_email is not null and v_email <> '' then
      mails := jsonb_build_array(jsonb_build_object(
        'notification_id', v_nid, 'handover_id', h.id, 'email', v_email, 'event', 'distributed', 'ticket_id', t.id,
        'ticket_number', t.number, 'ticket_title', t.title, 'actor_name', v_name, 'to_name', v_to_name, 'reply_due', null));
    end if;
  end if;
  insert into audit_events (tenant_id, actor_member_id, actor_role, action, target_type, target_id, choke_point_id, payload, created_by)
    values (v_tenant, v_me, 'member', 'handover.claimed', 'tickets', t.id::text, 'C2',
            jsonb_build_object('handover_id', h.id, 'assignee_member_id', v_to), v_me);
  return jsonb_build_object('ok', true, 'handover_id', h.id, 'handover', app.handover_json(h.id), 'assignee_member_id', v_to, 'mails', mails);
end $$;

revoke all on function app.handover_answerer(uuid, uuid, boolean) from public;
revoke all on function app.handover_group_email(uuid) from public;
revoke all on function app.handover_distribute_group(uuid, jsonb) from public;
revoke all on function app.handover_claim(uuid, uuid) from public;
grant execute on function app.handover_answerer(uuid, uuid, boolean), app.handover_distribute_group(uuid, jsonb),
  app.handover_claim(uuid, uuid) to kaname_app;
