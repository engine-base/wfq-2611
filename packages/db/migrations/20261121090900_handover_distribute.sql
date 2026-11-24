-- 20261121090900 人に配る（K-409・段 9・D-125.33・D-125.91・D-125.99・D-125.156・D-148.1・D-148.3・D-148.6・D-148.16・D-148.18〜D-148.20・D-148.30・D-148.35・D-148.42・関門 C2・C6）
--   K-401 の置き場（app.handover_gate・app.handover_answer_gate・app.handover_json・app.handover_apply_switch）の上に、配る関数と答える関数と完了の引き金を足す。
--   合意なしは配ると同時に担当者が替わる。合意ありは待っている行を書き、配られた人が受ける／断る（段 9 では合意ありの設定の欄が無いので配る側からは起きない）。
--   どの関数も security definer・search_path に pg_temp・public から外し、口が直に呼ぶ物だけ kaname_app に渡す。会社は app.tenant_id() で見る

-- ---------------------------------------------------------------- 合意ありか（段 9 では設定の欄が無いので常に false。F9・F10 が列を足したらこの中だけを直す）
create or replace function app.handover_distribute_needs_consent(p_scope uuid) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select false
$$;

-- ---------------------------------------------------------------- メールの宛て（認証の側の利用者のメール。無ければ null）
create or replace function app.handover_dist_email(p_member uuid) returns text
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_email text;
begin
  -- plpgsql にして kaname_auth の表は呼ぶときに引く（migration を当てる時点で認証の表が無くても作れる・handover_preview と同じ）
  select u.email::text into v_email
    from members m
    left join tenant_memberships tm on tm.member_id = m.id and tm.tenant_id = m.tenant_id and tm.deleted_at is null
    left join kaname_auth."user" u on u.id = coalesce(m.auth_user_id, tm.auth_user_id)
   where m.id = p_member and m.tenant_id = app.tenant_id();
  return v_email;
end $$;

-- ---------------------------------------------------------------- 配る（人へ）
--   答え {ok, handover_id, state, handover, mails} か {error: 言葉, …}。言葉は共通の確かめ（K-401）のほかに viewer（閲覧のみ・取引先）・current（今の担当者）
create or replace function app.handover_distribute(p_ticket uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  v_me uuid := app.user_id(); v_tenant uuid := app.tenant_id(); g jsonb;
  v_to uuid; v_prev uuid; v_hid uuid; v_consent boolean; v_num text; v_title text; v_scope uuid;
  v_me_name text; v_to_name text; v_email text; v_note uuid; v_due timestamptz; v_state text;
  v_mails jsonb := '[]'::jsonb;
begin
  g := app.handover_gate(p_ticket, p, true);
  if not coalesce((g ->> 'ok')::boolean, false) then return g; end if;
  v_to := nullif(g ->> 'receiver', '')::uuid;
  v_prev := nullif(g -> 'ticket' ->> 'assignee_member_id', '')::uuid;
  v_num := g -> 'ticket' ->> 'number'; v_title := g -> 'ticket' ->> 'title';
  v_scope := (g -> 'ticket' ->> 'scope_id')::uuid;
  if v_to is null then return jsonb_build_object('error', 'target', 'reason', 'missing'); end if;
  -- 閲覧のみ・依頼する側（取引先）には配れない
  if exists (select 1 from tenant_memberships tm
              where tm.member_id = v_to and tm.tenant_id = v_tenant and tm.deleted_at is null and tm.role in ('viewer', 'requester'))
     or exists (select 1 from client_contacts c where c.member_id = v_to and c.tenant_id = v_tenant and c.deleted_at is null) then
    return jsonb_build_object('error', 'viewer');
  end if;
  if v_to = v_prev then return jsonb_build_object('error', 'current'); end if;

  v_consent := app.handover_distribute_needs_consent(v_scope);
  v_state := case when v_consent then 'waiting' else 'accepted' end;
  v_due := case when v_consent then coalesce(nullif(p ->> 'reply_due', '')::timestamptz, app.handover_default_due(now())) else null end;
  select m.display_name into v_me_name from members m where m.id = v_me;
  select m.display_name into v_to_name from members m where m.id = v_to;

  insert into ticket_handovers (tenant_id, ticket_id, kind, from_member_id, to_member_id, reason, ask, reply_due, switch, state, decided_at, created_by)
  values (v_tenant, p_ticket, 'distribute', v_me, v_to, p ->> 'reason', nullif(p ->> 'ask', ''), v_due,
          coalesce(g -> 'switch', '{}'::jsonb), v_state, case when v_consent then null else now() end, v_me)
  returning id into v_hid;

  if not v_consent then
    update tickets set assignee_member_id = v_to, updated_by = v_me where id = p_ticket and tenant_id = v_tenant;
    perform app.handover_apply_switch(v_hid, v_prev, v_to);
    -- 前の担当者へ（受け箱の行だけ）
    if v_prev is not null and v_prev <> v_me then
      insert into notifications (tenant_id, member_id, channel_id, event_kind_id, payload, dedupe_key, created_by)
      values (v_tenant, v_prev, 'inapp', 'handover.reassigned',
              jsonb_build_object('ticket_id', p_ticket, 'handover_id', v_hid, 'number', v_num, 'title', v_title),
              'handover_reassigned:' || v_hid || ':' || v_prev, v_me);
    end if;
  end if;

  -- 配られた人へ（受け箱の行＋メール）
  insert into notifications (tenant_id, member_id, channel_id, event_kind_id, payload, dedupe_key, created_by)
  values (v_tenant, v_to, 'inapp', 'handover.distributed',
          jsonb_build_object('ticket_id', p_ticket, 'handover_id', v_hid, 'number', v_num, 'title', v_title),
          'handover_distributed:' || v_hid || ':' || v_to, v_me)
  returning id into v_note;
  v_email := app.handover_dist_email(v_to);
  if v_email is not null then
    v_mails := jsonb_build_array(jsonb_build_object(
      'notification_id', v_note, 'handover_id', v_hid, 'email', v_email, 'event', 'distributed',
      'ticket_id', p_ticket, 'ticket_number', v_num, 'ticket_title', v_title,
      'actor_name', coalesce(v_me_name, ''), 'to_name', coalesce(v_to_name, ''), 'reply_due', to_jsonb(v_due)));
  end if;

  perform app.record_audit('handover.distributed', 'ticket', p_ticket::text, 'C2',
    jsonb_build_object('handover_id', v_hid, 'from', v_prev, 'to', v_to, 'state', v_state));

  return jsonb_build_object('ok', true, 'handover_id', v_hid, 'state', v_state,
                            'handover', app.handover_json(v_hid), 'mails', v_mails);
end $$;

-- ---------------------------------------------------------------- 合意ありで配られたものに答える（受ける／断る）
create or replace function app.handover_answer_distribute(p_handover uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  v_me uuid := app.user_id(); v_tenant uuid := app.tenant_id(); g jsonb; h ticket_handovers%rowtype; t tickets%rowtype;
  v_blocked text; v_prev uuid; v_note uuid; v_email text; v_from_name text; v_me_name text;
  v_mails jsonb := '[]'::jsonb; v_accept boolean := coalesce(p ->> 'decision', '') = 'accept';
begin
  g := app.handover_answer_gate(p_handover, true);
  if not coalesce((g ->> 'ok')::boolean, false) then return g; end if;
  select * into h from ticket_handovers x where x.id = p_handover and x.tenant_id = v_tenant;
  select * into t from tickets x where x.id = h.ticket_id and x.tenant_id = v_tenant;
  if v_accept then
    v_blocked := app.handover_blocked(h.ticket_id, h.id);
    if v_blocked = 'closed' then return jsonb_build_object('error', 'closed'); end if;
    if v_blocked in ('ai_running', 'approval') then return jsonb_build_object('error', 'busy', 'reason', v_blocked); end if;
    v_prev := t.assignee_member_id;
    update ticket_handovers set state = 'accepted', decided_at = now(), answered_by = v_me, updated_by = v_me where id = h.id;
    update tickets set assignee_member_id = h.to_member_id, updated_by = v_me where id = t.id and tenant_id = v_tenant;
    perform app.handover_apply_switch(h.id, v_prev, h.to_member_id);
    insert into notifications (tenant_id, member_id, channel_id, event_kind_id, payload, dedupe_key, created_by)
    values (v_tenant, h.from_member_id, 'inapp', 'handover.accepted',
            jsonb_build_object('ticket_id', t.id, 'handover_id', h.id, 'number', t.number, 'title', t.title),
            'handover_accepted:' || h.id || ':' || h.from_member_id, v_me);
    perform app.record_audit('handover.accepted', 'ticket', t.id::text, 'C2',
      jsonb_build_object('handover_id', h.id, 'from', v_prev, 'to', h.to_member_id));
  else
    update ticket_handovers set state = 'declined', decline_reason = p ->> 'decline_reason', decided_at = now(),
           answered_by = v_me, updated_by = v_me where id = h.id;
    insert into notifications (tenant_id, member_id, channel_id, event_kind_id, payload, dedupe_key, created_by)
    values (v_tenant, h.from_member_id, 'inapp', 'handover.declined',
            jsonb_build_object('ticket_id', t.id, 'handover_id', h.id, 'number', t.number, 'title', t.title),
            'handover_declined:' || h.id || ':' || h.from_member_id, v_me)
    returning id into v_note;
    v_email := app.handover_dist_email(h.from_member_id);
    if v_email is not null then
      select m.display_name into v_from_name from members m where m.id = h.from_member_id;
      select m.display_name into v_me_name from members m where m.id = v_me;
      v_mails := jsonb_build_array(jsonb_build_object(
        'notification_id', v_note, 'handover_id', h.id, 'email', v_email, 'event', 'declined',
        'ticket_id', t.id, 'ticket_number', t.number, 'ticket_title', t.title,
        'actor_name', coalesce(v_me_name, ''), 'to_name', coalesce(v_from_name, ''), 'reply_due', null));
    end if;
    perform app.record_audit('handover.declined', 'ticket', t.id::text, 'C2', jsonb_build_object('handover_id', h.id));
  end if;
  return jsonb_build_object('ok', true, 'handover_id', h.id, 'state', case when v_accept then 'accepted' else 'declined' end,
                            'handover', app.handover_json(h.id), 'mails', v_mails);
end $$;

-- ---------------------------------------------------------------- 配ったチケットが完了したら配った人へ（受け箱の行だけ・D-125.99）
--   会社は NEW.tenant_id で見る（会社の文脈の無い完了でも動く）。いちばん新しい accepted の distribute の行を錠で取り、同じ知らせは 1 つだけ
create or replace function app.handover_distribute_done() returns trigger
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare h ticket_handovers%rowtype; v_key text;
begin
  if old.completed_at is not null or new.completed_at is null then return new; end if;
  select * into h from ticket_handovers x
   where x.ticket_id = new.id and x.tenant_id = new.tenant_id and x.kind = 'distribute' and x.state = 'accepted' and x.deleted_at is null
   order by x.decided_at desc nulls last, x.created_at desc, x.id
   limit 1 for update;
  if not found then return new; end if;
  if h.from_member_id is not distinct from new.completed_by then return new; end if;
  v_key := 'distributed_done:' || new.id || ':' || h.id;
  insert into notifications (tenant_id, member_id, channel_id, event_kind_id, payload, dedupe_key)
  select new.tenant_id, h.from_member_id, 'inapp', 'handover.distributed_done',
         jsonb_build_object('ticket_id', new.id, 'handover_id', h.id, 'number', new.number, 'title', new.title), v_key
   where not exists (select 1 from notifications n where n.tenant_id = new.tenant_id and n.dedupe_key = v_key);
  return new;
end $$;

drop trigger if exists tickets_handover_distribute_done on tickets;
create trigger tickets_handover_distribute_done after update of completed_at on tickets
  for each row when (old.completed_at is null and new.completed_at is not null)
  execute function app.handover_distribute_done();

-- ---------------------------------------------------------------- 渡す・外す
revoke all on function app.handover_distribute_needs_consent(uuid) from public;
revoke all on function app.handover_dist_email(uuid) from public;
revoke all on function app.handover_distribute(uuid, jsonb) from public;
revoke all on function app.handover_answer_distribute(uuid, jsonb) from public;
revoke all on function app.handover_distribute_done() from public;
grant execute on function app.handover_distribute(uuid, jsonb), app.handover_answer_distribute(uuid, jsonb) to kaname_app;
