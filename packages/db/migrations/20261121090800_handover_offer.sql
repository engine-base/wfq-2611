-- 20261121090800 引き継ぎの申し出（K-408・段 9・D-125.33・D-125.90・D-125.94・D-128.115・D-148.5・D-148.6・D-148.12・D-148.18〜D-148.21・関門 C2・C6）
--   申し出る：app.handover_offer(p_ticket, p)＝担当者でない人が、ほかの人のチケットの引き取りを申し出る。相手（to_member_id）は申し出た時点の担当者・返事の期限は付けない。
--   答える：app.handover_answer_offer(p_handover, p)＝担当者が「渡す」（申し出た人に替わる・受け箱だけ）か「断る」（理由を残し、申し出た人に受け箱とメール）。
--   どちらも最初に K-401 の共通の確かめ（app.handover_gate・app.handover_answer_gate を p_lock => true）で同じ判定をもう一度する（守りは 2 層）。
--   知らせの行の payload に理由・お願い・断った理由を入れない（番号・題名・人の名前・渡しの id だけ）。
--   答えは {"ok": true, "handover": <16 の鍵>, "mails": [MailRow…]} か {"error": 言葉, …}。security definer・search_path に pg_temp・public から外し kaname_app だけに渡す

-- ---------------------------------------------------------------- 申し出る
create or replace function app.handover_offer(p_ticket uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  v_me uuid := app.user_id(); g jsonb; t jsonb; v_to uuid; v_id uuid; v_note uuid;
  v_from_name text; v_to_name text; v_email text; v_mails jsonb := '[]'::jsonb;
begin
  g := app.handover_gate(p_ticket, p, true);
  if g ? 'error' then return g; end if;
  if g ->> 'kind' <> 'offer' then return jsonb_build_object('error', 'forbidden'); end if;
  t := g -> 'ticket';
  v_to := (t ->> 'assignee_member_id')::uuid;
  select m.display_name into v_from_name from members m where m.id = v_me and m.tenant_id = app.tenant_id();
  select m.display_name into v_to_name from members m where m.id = v_to and m.tenant_id = app.tenant_id();

  insert into ticket_handovers (tenant_id, ticket_id, kind, from_member_id, to_member_id, reason, switch, state, reply_due, created_by, updated_by)
    values (app.tenant_id(), p_ticket, 'offer', v_me, v_to, nullif(p ->> 'reason', ''), g -> 'switch', 'waiting', null, v_me, v_me)
    returning id into v_id;

  insert into notifications (tenant_id, member_id, channel_id, event_kind_id, payload, dedupe_key, created_by)
    values (app.tenant_id(), v_to, 'inapp', 'handover.offered',
            jsonb_build_object('handover_id', v_id, 'ticket_id', p_ticket, 'number', t ->> 'number', 'title', t ->> 'title', 'from_name', v_from_name),
            'handover_offered:' || v_id::text, v_me)
    returning id into v_note;

  insert into audit_events (tenant_id, actor_member_id, actor_role, action, target_type, target_id, choke_point_id, payload, created_by)
    values (app.tenant_id(), v_me, 'member', 'handover.offer', 'tickets', p_ticket::text, 'C2',
            jsonb_build_object('handover_id', v_id, 'to_member_id', v_to), v_me);

  v_email := (select u.email::text from members m
                left join tenant_memberships tm on tm.member_id = m.id and tm.tenant_id = m.tenant_id and tm.deleted_at is null
                join kaname_auth."user" u on u.id = coalesce(m.auth_user_id, tm.auth_user_id)
               where m.id = v_to and m.tenant_id = app.tenant_id() limit 1);
  if v_email is not null then
    v_mails := jsonb_build_array(jsonb_build_object(
      'notification_id', v_note, 'handover_id', v_id, 'email', v_email, 'event', 'offered',
      'ticket_id', p_ticket, 'ticket_number', t ->> 'number', 'ticket_title', t ->> 'title',
      'actor_name', v_from_name, 'to_name', v_to_name, 'reply_due', null));
  end if;
  return jsonb_build_object('ok', true, 'handover', app.handover_json(v_id), 'mails', v_mails);
end $$;

-- ---------------------------------------------------------------- 申し出に答える
create or replace function app.handover_answer_offer(p_handover uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  v_me uuid := app.user_id(); g jsonb; h ticket_handovers%rowtype; t tickets%rowtype;
  v_blocked text; v_state text; v_applicant text; v_answerer text; v_note uuid; v_email text;
  v_applied jsonb; v_mails jsonb := '[]'::jsonb; v_reason text := nullif(btrim(p ->> 'decline_reason'), '');
begin
  g := app.handover_answer_gate(p_handover, true);
  if g ? 'error' then return g; end if;
  if g ->> 'kind' <> 'offer' then return jsonb_build_object('error', 'forbidden'); end if;
  select * into h from ticket_handovers x where x.id = p_handover and x.tenant_id = app.tenant_id();
  select * into t from tickets x where x.id = h.ticket_id and x.tenant_id = app.tenant_id();
  select m.display_name into v_applicant from members m where m.id = h.from_member_id;
  select m.display_name into v_answerer from members m where m.id = v_me;

  if p ->> 'decision' = 'accept' then
    v_blocked := app.handover_blocked(t.id, p_handover);
    if v_blocked = 'closed' then return jsonb_build_object('error', 'closed'); end if;
    if v_blocked in ('ai_running', 'approval') then return jsonb_build_object('error', 'busy', 'reason', v_blocked); end if;
    v_state := app.handover_member_state(h.from_member_id);
    if v_state <> 'active' then
      return jsonb_build_object('error', 'target', 'reason', v_state, '名前', coalesce(v_applicant, ''));
    end if;
    -- 申し出た後に書く権限が外れた人・ゲストにした人は、もう申し出られない（申し出の抜け道を塞ぐ・D-148.18）。今も申し出られるかを渡すときに DB で見る
    if not ('offer' = any (app.handover_kinds(t.id, h.from_member_id))) then
      return jsonb_build_object('error', 'target', 'reason', 'no_offer', '名前', coalesce(v_applicant, ''));
    end if;
    update tickets set assignee_member_id = h.from_member_id, updated_by = v_me where id = t.id and tenant_id = app.tenant_id();
    v_applied := app.handover_apply_switch(p_handover, v_me, h.from_member_id);
    update ticket_handovers
       set state = 'accepted', decided_at = now(), answered_by = v_me, switch_applied = coalesce(v_applied, '{}'::jsonb), updated_by = v_me
     where id = p_handover;
    insert into notifications (tenant_id, member_id, channel_id, event_kind_id, payload, dedupe_key, sent_at, created_by)
      values (app.tenant_id(), h.from_member_id, 'inapp', 'handover.accepted',
              jsonb_build_object('handover_id', p_handover, 'ticket_id', t.id, 'number', t.number, 'title', t.title, 'by_name', v_answerer),
              'handover_accepted:' || p_handover::text, now(), v_me);
    insert into audit_events (tenant_id, actor_member_id, actor_role, action, target_type, target_id, choke_point_id, payload, created_by)
      values (app.tenant_id(), v_me, 'member', 'handover.accept', 'tickets', t.id::text, 'C2',
              jsonb_build_object('handover_id', p_handover, 'to_member_id', h.from_member_id), v_me);
  else
    update ticket_handovers
       set state = 'declined', decline_reason = v_reason, decided_at = now(), answered_by = v_me, updated_by = v_me
     where id = p_handover;
    insert into notifications (tenant_id, member_id, channel_id, event_kind_id, payload, dedupe_key, created_by)
      values (app.tenant_id(), h.from_member_id, 'inapp', 'handover.declined',
              jsonb_build_object('handover_id', p_handover, 'ticket_id', t.id, 'number', t.number, 'title', t.title, 'by_name', v_answerer),
              'handover_declined:' || p_handover::text, v_me)
      returning id into v_note;
    insert into audit_events (tenant_id, actor_member_id, actor_role, action, target_type, target_id, choke_point_id, payload, created_by)
      values (app.tenant_id(), v_me, 'member', 'handover.decline', 'tickets', t.id::text, 'C2',
              jsonb_build_object('handover_id', p_handover), v_me);
    v_email := (select u.email::text from members m
                  left join tenant_memberships tm on tm.member_id = m.id and tm.tenant_id = m.tenant_id and tm.deleted_at is null
                  join kaname_auth."user" u on u.id = coalesce(m.auth_user_id, tm.auth_user_id)
                 where m.id = h.from_member_id and m.tenant_id = app.tenant_id() limit 1);
    if v_email is not null then
      v_mails := jsonb_build_array(jsonb_build_object(
        'notification_id', v_note, 'handover_id', p_handover, 'email', v_email, 'event', 'declined',
        'ticket_id', t.id, 'ticket_number', t.number, 'ticket_title', t.title,
        'actor_name', v_answerer, 'to_name', v_applicant, 'reply_due', null));
    end if;
  end if;
  return jsonb_build_object('ok', true, 'handover', app.handover_json(p_handover), 'mails', v_mails);
end $$;

-- ---------------------------------------------------------------- 渡す・外す
revoke all on function app.handover_offer(uuid, jsonb) from public;
revoke all on function app.handover_answer_offer(uuid, jsonb) from public;
grant execute on function app.handover_offer(uuid, jsonb), app.handover_answer_offer(uuid, jsonb) to kaname_app;
