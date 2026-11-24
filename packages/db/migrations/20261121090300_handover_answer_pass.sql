-- 20261121090300 渡すの答え（種類 pass・K-403・段 9・D-125.88・D-125.90・D-148.5〜D-148.7・D-148.19・D-148.34・D-148.35・関門 C2・C6）
--   受ける＝担当者が移る（一緒に切り替えるものは app.handover_apply_switch・K-404）。断る＝理由が必須・担当者は渡した人のまま。
--   どちらも最初に app.handover_answer_gate(…, true)（渡しの行とチケットの行を for update）を呼び直す。受けると断るが同時に来たら、
--   後の 1 つは前の確定を待ってから decided（口が 409・E-HND-005）。1 取引で行・知らせの行・証跡を書く。
--   受け箱の行・証跡に断る理由の文は入れない（理由は渡しの行の decline_reason）。メールは断るときだけ（受けるは受け箱の行だけ）

create or replace function app.handover_answer_pass(p_handover uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  v jsonb; v_me uuid := app.user_id(); v_blocked text; v_tid uuid := app.tenant_id();
  t tickets%rowtype; v_from uuid; v_to uuid; v_name text; v_nid uuid; v_email text;
  v_mails jsonb := '[]'::jsonb; v_switch jsonb; v_reason text;
begin
  v := app.handover_answer_gate(p_handover, true);
  if v ? 'error' then return v; end if;
  v_from := (v->>'from_member_id')::uuid;
  v_to := (v->>'to_member_id')::uuid;
  select * into t from tickets x where x.id = (v->>'ticket_id')::uuid and x.tenant_id = v_tid;
  v_name := app.member_name(v_me);

  if p->>'decision' = 'accept' then
    v_blocked := app.handover_blocked(t.id, p_handover);
    if v_blocked in ('ai_running', 'approval') then return jsonb_build_object('error', 'busy'); end if;
    if v_blocked = 'closed' then return jsonb_build_object('error', 'closed'); end if;
    update tickets set assignee_member_id = v_to, updated_by = v_me where id = t.id;
    v_switch := coalesce(app.handover_apply_switch(p_handover, v_from, v_to), '{}'::jsonb);
    update ticket_handovers
       set state = 'accepted', decided_at = now(), answered_by = v_me, switch_applied = v_switch, updated_by = v_me
     where id = p_handover;
    insert into notifications (tenant_id, member_id, channel_id, event_kind_id, payload, dedupe_key, created_by)
      values (v_tid, v_from, 'inapp', 'handover.accepted',
              jsonb_build_object('handover_id', p_handover, 'ticket_id', t.id, 'number', t.number, 'title', t.title, 'to_name', v_name),
              'handover_accepted:' || p_handover, v_me);
    insert into audit_events (tenant_id, actor_member_id, actor_role, action, target_type, target_id, choke_point_id, payload, created_by)
      values (v_tid, v_me, 'member', 'handover.accept', 'ticket_handovers', p_handover::text, 'C2',
              jsonb_build_object('ticket_id', t.id, 'from_member_id', v_from), v_me);
  else
    v_reason := p->>'decline_reason';
    update ticket_handovers
       set state = 'declined', decline_reason = v_reason, decided_at = now(), answered_by = v_me, updated_by = v_me
     where id = p_handover;
    insert into notifications (tenant_id, member_id, channel_id, event_kind_id, payload, dedupe_key, created_by)
      values (v_tid, v_from, 'inapp', 'handover.declined',
              jsonb_build_object('handover_id', p_handover, 'ticket_id', t.id, 'number', t.number, 'title', t.title, 'to_name', v_name),
              'handover_declined:' || p_handover, v_me)
      returning id into v_nid;
    insert into audit_events (tenant_id, actor_member_id, actor_role, action, target_type, target_id, choke_point_id, payload, created_by)
      values (v_tid, v_me, 'member', 'handover.decline', 'ticket_handovers', p_handover::text, 'C2',
              jsonb_build_object('ticket_id', t.id, 'from_member_id', v_from), v_me);
    select u.email into v_email from members m join kaname_auth."user" u on u.id = m.auth_user_id
     where m.id = v_from and m.tenant_id = v_tid;
    if v_email is not null then
      v_mails := jsonb_build_array(jsonb_build_object(
        'notification_id', v_nid, 'handover_id', p_handover, 'email', v_email, 'event', 'declined',
        'ticket_id', t.id, 'ticket_number', t.number, 'ticket_title', t.title,
        'actor_name', v_name, 'to_name', v_name, 'reply_due', null));
    end if;
  end if;
  return jsonb_build_object('ok', true, 'handover', app.handover_json(p_handover), 'mails', v_mails);
end $$;

revoke all on function app.handover_answer_pass(uuid, jsonb) from public;
grant execute on function app.handover_answer_pass(uuid, jsonb) to kaname_app;
