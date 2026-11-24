-- 20261121090700 返事の期限が過ぎた渡しを、渡した人が開いたときに 1 回知らせる（K-407・段 9・D-125.89・D-148.9・D-148.19・D-148.33・D-128.130・D-131.9・関門 C2・C6）
--   承認待ちを読む前の片付け（app.ticket_execute_sweep_read と同じ 1 本の文）に足す関数 1 つ。時間で動く仕組みは作らない（開いたときに 1 回）。
--   呼んだ人が渡した人（from_member_id）の、待っていて・返事の期限が過ぎ・まだ知らせていない渡しだけを、知らせた時刻 overdue_notified_at を入れて拾い、
--   渡した人の受け箱の行を入れ、メールの宛てを返す（送るのは取引の後に口の側・K-401 の sendHandoverMails）。
--   同時に 2 回開いても行の錠で 1 回（2 本目は前の確定を待って条件を見直し 0 行）。片付けが例外になったら、関数の中で自分の書き込みだけを戻して
--   {ok: false, mails: []} を返す（読む口から savepoint の文を流さない・K-236 と同じ）。受け箱の行の payload に理由・お願いは入れない

create or replace function app.handover_overdue_sweep() returns jsonb
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare
  v_me uuid := app.user_id();
  v_mails jsonb;
begin
  if v_me is null or app.tenant_id() is null or not app.member_ok() then
    return jsonb_build_object('ok', true, 'mails', '[]'::jsonb);
  end if;
  begin
    with due as (
      update ticket_handovers h
         set overdue_notified_at = now()
       where h.tenant_id = app.tenant_id() and h.from_member_id = v_me and h.state = 'waiting' and h.deleted_at is null
         and h.reply_due is not null and h.reply_due < now() and h.overdue_notified_at is null
         and exists (select 1 from tickets t where t.id = h.ticket_id and t.tenant_id = h.tenant_id and t.deleted_at is null)
      returning h.id, h.ticket_id, h.to_member_id, h.to_scope_id, h.reply_due
    ), shown as (
      select d.id as handover_id, t.id as ticket_id, t.number, t.title, d.reply_due,
             coalesce(app.member_name(d.to_member_id), s.name, '') as to_name
        from due d
        join tickets t on t.id = d.ticket_id
        left join scopes s on s.id = d.to_scope_id
    ), ins as (
      insert into notifications (tenant_id, member_id, channel_id, event_kind_id, payload, dedupe_key)
      select app.tenant_id(), v_me, 'inapp', 'handover.overdue',
             jsonb_build_object('handover_id', sh.handover_id, 'ticket_id', sh.ticket_id, 'number', sh.number, 'title', sh.title,
                                'to_name', sh.to_name, 'reply_due', sh.reply_due),
             'handover_overdue:' || sh.handover_id::text
        from shown sh
      returning id, dedupe_key
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'notification_id', ins.id, 'handover_id', sh.handover_id, 'email', u.email::text, 'event', 'overdue',
             'ticket_id', sh.ticket_id, 'ticket_number', sh.number, 'ticket_title', sh.title,
             'actor_name', app.member_name(v_me), 'to_name', sh.to_name, 'reply_due', sh.reply_due)
             order by sh.reply_due, sh.handover_id), '[]'::jsonb)
      into v_mails
      from ins
      join shown sh on 'handover_overdue:' || sh.handover_id::text = ins.dedupe_key
      join members m on m.id = v_me and m.tenant_id = app.tenant_id()
      left join tenant_memberships tm on tm.member_id = m.id and tm.tenant_id = m.tenant_id and tm.deleted_at is null
      join kaname_auth."user" u on u.id = coalesce(m.auth_user_id, tm.auth_user_id)
     where app.handover_member_state(v_me) = 'active';
  exception when others then
    return jsonb_build_object('ok', false, 'mails', '[]'::jsonb);
  end;
  return jsonb_build_object('ok', true, 'mails', coalesce(v_mails, '[]'::jsonb));
end $$;

revoke all on function app.handover_overdue_sweep() from public;
grant execute on function app.handover_overdue_sweep() to kaname_app;
