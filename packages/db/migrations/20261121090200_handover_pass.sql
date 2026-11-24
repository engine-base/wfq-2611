-- 20261121090200 引き継いでもらう（渡す口の種類 pass・K-402・段 9・D-125.88・D-148.4・D-148.10・D-148.19・D-148.20・関門 C2）
--   app.handover_pass(p_ticket, p)：共通の確かめ（app.handover_gate・チケットの行を for update で取る）→ 別の人にする（replaces）なら前の渡しを取り消す
--   → 渡しの行（waiting・担当者は渡す人のまま）→ 相手に受け箱の行 handover.requested →「上の層にも知らせる」なら管理する人に handover.managers
--   → 証跡 handover.pass。メールを出す宛てを返す（送るのは口・関門 C6）。理由とお願いは知らせの行にも証跡にも入れない（渡しの行にだけ残る）。
--   security definer・search_path に pg_temp。public から外し kaname_app に渡す。会社は app.tenant_id()・呼んだ人は app.user_id()

create or replace function app.handover_pass(p_ticket uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  v jsonb; v_me uuid := app.user_id(); v_tenant uuid := app.tenant_id();
  v_to uuid; v_due timestamptz; v_switch jsonb; v_notify boolean; v_id uuid; v_nid uuid;
  v_title text; v_number text; v_scope uuid; v_from text; v_to_name text; v_email text;
  old ticket_handovers%rowtype; m record; mails jsonb := '[]'::jsonb;
begin
  v := app.handover_gate(p_ticket, coalesce(p, '{}'::jsonb) || '{"kind":"pass"}'::jsonb, true);
  if v ? 'error' then return v; end if;
  v_to := (v ->> 'receiver')::uuid; v_switch := v -> 'switch';
  v_number := v #>> '{ticket,number}'; v_title := v #>> '{ticket,title}'; v_scope := (v #>> '{ticket,scope_id}')::uuid;
  v_notify := coalesce((p ->> 'notify_managers')::boolean, false);
  v_due := coalesce(nullif(p ->> 'reply_due', '')::timestamptz, app.handover_default_due(now()));
  if v_due <= now() then return jsonb_build_object('error', 'due'); end if;
  v_from := app.member_name(v_me); v_to_name := app.member_name(v_to);
  -- 別の人にする：前の待っている渡しを取り消し、前の相手に知らせる（K-406 の取り消すと同じ形・メールなし）
  if nullif(p ->> 'replaces', '') is not null then
    select * into old from ticket_handovers x where x.id = (p ->> 'replaces')::uuid and x.tenant_id = v_tenant for update;
    update ticket_handovers set state = 'withdrawn', decided_at = now(), updated_at = now(), updated_by = v_me where id = old.id;
    if old.to_member_id is not null then
      insert into notifications (tenant_id, member_id, channel_id, event_kind_id, payload, dedupe_key, created_by)
        values (v_tenant, old.to_member_id, 'inapp', 'handover.withdrawn',
                jsonb_build_object('handover_id', old.id, 'ticket_id', p_ticket, 'number', v_number, 'title', v_title, 'from_name', v_from, 'cause', 'replaced'),
                'handover_withdrawn:' || old.id || ':' || old.to_member_id, v_me);
    end if;
  end if;
  insert into ticket_handovers (tenant_id, ticket_id, kind, from_member_id, to_member_id, reason, ask, reply_due, switch, notify_managers, created_by, updated_by)
    values (v_tenant, p_ticket, 'pass', v_me, v_to, p ->> 'reason', nullif(p ->> 'ask', ''), v_due, v_switch, v_notify, v_me, v_me)
    returning id into v_id;
  if old.id is not null then
    insert into audit_events (tenant_id, actor_member_id, actor_role, action, target_type, target_id, choke_point_id, payload, created_by)
      values (v_tenant, v_me, 'member', 'handover.withdraw', 'ticket_handovers', old.id::text, 'C2',
              jsonb_build_object('ticket_id', p_ticket, 'replaced_by', v_id), v_me);
  end if;
  insert into notifications (tenant_id, member_id, channel_id, event_kind_id, payload, dedupe_key, created_by)
    values (v_tenant, v_to, 'inapp', 'handover.requested',
            jsonb_build_object('handover_id', v_id, 'ticket_id', p_ticket, 'number', v_number, 'title', v_title, 'from_name', v_from, 'reply_due', v_due),
            'handover_requested:' || v_id, v_me)
    returning id into v_nid;
  -- 相手のメール（無ければ送らない）
  select u.email::text into v_email
    from members mm
    left join tenant_memberships tm on tm.tenant_id = mm.tenant_id and tm.member_id = mm.id
    join kaname_auth."user" u on u.id = coalesce(mm.auth_user_id, tm.auth_user_id)
   where mm.id = v_to and mm.tenant_id = v_tenant limit 1;
  if v_email is not null and v_email <> '' then
    mails := jsonb_build_array(jsonb_build_object(
      'notification_id', v_nid, 'handover_id', v_id, 'email', v_email, 'event', 'requested', 'ticket_id', p_ticket,
      'ticket_number', v_number, 'ticket_title', v_title, 'actor_name', v_from, 'to_name', v_to_name, 'reply_due', v_due));
  end if;
  -- 上の層にも知らせる：そのグループを管理する人（渡す人・相手を除く）。受け箱の行だけ
  if v_notify then
    for m in select mm.id, mm.display_name from members mm
              where mm.tenant_id = v_tenant and mm.id not in (v_me, v_to)
                and app.handover_member_state(mm.id) = 'active' and app.handover_manages(mm.id, v_scope) loop
      insert into notifications (tenant_id, member_id, channel_id, event_kind_id, payload, dedupe_key, created_by)
        values (v_tenant, m.id, 'inapp', 'handover.managers',
                jsonb_build_object('handover_id', v_id, 'ticket_id', p_ticket, 'number', v_number, 'title', v_title,
                                   'from_name', v_from, 'to_name', v_to_name, 'reply_due', v_due),
                'handover_managers:' || v_id || ':' || m.id, v_me);
    end loop;
  end if;
  insert into audit_events (tenant_id, actor_member_id, actor_role, action, target_type, target_id, choke_point_id, payload, created_by)
    values (v_tenant, v_me, 'member', 'handover.pass', 'ticket_handovers', v_id::text, 'C2',
            jsonb_build_object('ticket_id', p_ticket, 'to_member_id', v_to, 'notify_managers', v_notify), v_me);
  return jsonb_build_object('ok', true, 'handover', app.handover_json(v_id), 'mails', mails);
end $$;

revoke all on function app.handover_pass(uuid, jsonb) from public;
grant execute on function app.handover_pass(uuid, jsonb) to kaname_app;
