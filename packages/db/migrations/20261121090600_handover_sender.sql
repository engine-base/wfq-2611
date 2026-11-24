-- 20261121090600 渡した人が取り消す・催促する（K-406・段 9・D-148.5・D-148.8・D-148.19・D-148.20・D-125.89・D-125.14・関門 C2）
--   ① app.handover_withdraw：渡した人（申し出は申し出た人・配るは配った人）が待っている渡しを取り消す。相手に受け箱の行（メールは出さない）
--   ② app.handover_remind：渡した人が待っている人宛ての渡し（pass・distribute）を 1 日 1 回（日本の日付）催促する。相手に受け箱の行とメールの宛て
--   ③ app.handover_autowithdraw（tickets の引き金）：完了・消したチケットの待っている渡しを自動で取り消し、相手に知らせる（D-148.5）
--   どれも security definer・search_path に pg_temp。public から外し、口が直に呼ぶ ①② だけ kaname_app に渡す。
--   ①② は呼んだ人の会社の文脈（app.tenant_id()・app.user_id()）で見る。③ は完了・消すが文脈の無い update（試験の準備・移行）からも起きるので、
--   会社は NEW.tenant_id で見て、app.tenant_id() に頼る関数（app.handover_answerer など）を使わない。

-- ---------------------------------------------------------------- 取り消しの知らせの行（受け箱だけ・メールは出さない・①と③で同じ形）
--   p_to：相手（人宛ては to_member_id）。グループ宛てはここに渡す前に呼び分ける。payload は番号・題名・渡した人の名前・渡しの id・理由（cause）だけ
create or replace function app.handover_withdrawn_note(p_handover uuid, p_member uuid, p_cause text) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare h ticket_handovers%rowtype; t tickets%rowtype;
begin
  select * into h from ticket_handovers x where x.id = p_handover;
  select * into t from tickets x where x.id = h.ticket_id;
  insert into notifications (tenant_id, member_id, channel_id, event_kind_id, payload, dedupe_key, created_by)
  values (h.tenant_id, p_member, 'inapp', 'handover.withdrawn',
          jsonb_build_object('handover_id', h.id, 'ticket_id', t.id, 'number', t.number, 'title', t.title,
                             'from_name', app.member_name(h.from_member_id), 'cause', p_cause),
          'handover_withdrawn:' || h.id || ':' || p_member, h.from_member_id)
  on conflict do nothing;
end $$;

-- ---------------------------------------------------------------- ① 取り消す
create or replace function app.handover_withdraw(p_handover uuid) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare h ticket_handovers%rowtype; v_me uuid := app.user_id(); r record;
begin
  select * into h from ticket_handovers x where x.id = p_handover and x.tenant_id = app.tenant_id() and x.deleted_at is null for update;
  if not found then return jsonb_build_object('ok', false, 'status', 404); end if;
  if v_me is null or h.from_member_id <> v_me then return jsonb_build_object('ok', false, 'status', 403); end if;
  if h.state <> 'waiting' then return jsonb_build_object('ok', false, 'status', 409, 'code', 'E-HND-005'); end if;
  -- 知らせる相手は取り消す前に引く（app.handover_answerer は待っている間だけ真）
  for r in
    select m.id as member_id from members m
     where m.tenant_id = h.tenant_id and m.id <> h.from_member_id
       and (h.to_member_id = m.id
            or (h.to_member_id is null and app.handover_answerer(h.id, m.id)))
  loop
    perform app.handover_withdrawn_note(h.id, r.member_id, 'sender');
  end loop;
  update ticket_handovers set state = 'withdrawn', decided_at = now(), updated_by = v_me where id = h.id returning * into h;
  insert into audit_events (tenant_id, actor_member_id, actor_role, action, target_type, target_id, choke_point_id, payload, created_by)
    values (h.tenant_id, v_me, coalesce(app.role(), 'member'), 'handover.withdraw', 'tickets', h.ticket_id::text, 'C2',
            jsonb_build_object('handover_id', h.id, 'kind', h.kind, 'cause', 'sender'), v_me);
  return jsonb_build_object('ok', true, 'id', h.id, 'state', h.state, 'decided_at', h.decided_at);
end $$;

-- ---------------------------------------------------------------- ② 催促する
create or replace function app.handover_remind(p_handover uuid) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare h ticket_handovers%rowtype; t tickets%rowtype; v_me uuid := app.user_id(); v_nid uuid; v_mails jsonb := '[]'::jsonb;
        v_email text; v_today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  select * into h from ticket_handovers x where x.id = p_handover and x.tenant_id = app.tenant_id() and x.deleted_at is null for update;
  if not found then return jsonb_build_object('ok', false, 'status', 404); end if;
  if v_me is null or h.from_member_id <> v_me then return jsonb_build_object('ok', false, 'status', 403); end if;
  if h.state <> 'waiting' then return jsonb_build_object('ok', false, 'status', 409, 'code', 'E-HND-005'); end if;
  if h.to_member_id is null or h.kind not in ('pass', 'distribute') then
    return jsonb_build_object('ok', false, 'status', 409, 'code', 'E-HND-081');
  end if;
  if h.reminded_at is not null and (h.reminded_at at time zone 'Asia/Tokyo')::date = v_today then
    return jsonb_build_object('ok', false, 'status', 409, 'code', 'E-HND-080');
  end if;
  select * into t from tickets x where x.id = h.ticket_id;
  update ticket_handovers set reminded_at = now(), updated_by = v_me where id = h.id returning * into h;
  insert into notifications (tenant_id, member_id, channel_id, event_kind_id, payload, dedupe_key, created_by)
  values (h.tenant_id, h.to_member_id, 'inapp', 'handover.reminded',
          jsonb_build_object('handover_id', h.id, 'ticket_id', t.id, 'number', t.number, 'title', t.title,
                             'from_name', app.member_name(h.from_member_id), 'reply_due', h.reply_due),
          'handover_reminded:' || h.id || ':' || v_today, v_me)
  returning id into v_nid;
  insert into audit_events (tenant_id, actor_member_id, actor_role, action, target_type, target_id, choke_point_id, payload, created_by)
    values (h.tenant_id, v_me, coalesce(app.role(), 'member'), 'handover.remind', 'tickets', h.ticket_id::text, 'C2',
            jsonb_build_object('handover_id', h.id, 'kind', h.kind), v_me);
  -- メールの宛て（止めた・抜けた人でない・認証の側のメールが引ける人）。引けなければ空（受け箱の行は残る）
  if app.handover_member_state(h.to_member_id) in ('active') then
    select u.email::text into v_email
      from members m
      left join tenant_memberships tm on tm.tenant_id = m.tenant_id and tm.member_id = m.id
      join kaname_auth."user" u on u.id = coalesce(m.auth_user_id, tm.auth_user_id)
     where m.id = h.to_member_id and m.tenant_id = h.tenant_id
     limit 1;
    if v_email is not null then
      v_mails := jsonb_build_array(jsonb_build_object(
        'notification_id', v_nid, 'handover_id', h.id, 'email', v_email, 'event', 'reminded',
        'ticket_id', t.id, 'ticket_number', t.number, 'ticket_title', t.title,
        'actor_name', app.member_name(h.from_member_id), 'to_name', app.member_name(h.to_member_id),
        'reply_due', h.reply_due));
    end if;
  end if;
  return jsonb_build_object('ok', true, 'id', h.id, 'reminded_at', h.reminded_at, 'mails', v_mails);
end $$;

-- ---------------------------------------------------------------- ③ 完了・消したときの自動の取り消し（引き金・会社は NEW.tenant_id）
create or replace function app.handover_autowithdraw() returns trigger
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare h ticket_handovers%rowtype; v_cause text; v_actor uuid := nullif(current_setting('app.user_id', true), '')::uuid; r record;
begin
  if not ((old.completed_at is null and new.completed_at is not null) or (old.deleted_at is null and new.deleted_at is not null)) then
    return new;
  end if;
  v_cause := case when new.deleted_at is not null and old.deleted_at is null then 'deleted' else 'completed' end;
  for h in select * from ticket_handovers x where x.ticket_id = new.id and x.tenant_id = new.tenant_id and x.state = 'waiting' and x.deleted_at is null for update loop
    -- 相手：人宛ては to_member_id。グループ宛ては宛てのグループ（かその上）の manager と所属の admin（止まっている・抜けた人・渡した人は除く）
    for r in
      select m.id as member_id from members m
       where m.tenant_id = new.tenant_id and m.id <> h.from_member_id and m.deleted_at is null and m.suspended_at is null
         and m.kind_id = 'human'
         and not exists (select 1 from tenant_memberships z where z.tenant_id = m.tenant_id and z.member_id = m.id
                            and z.deleted_at is null and z.status in ('left', 'suspended', 'invited'))
         and (m.id = h.to_member_id
              or (h.to_member_id is null and h.to_scope_id is not null and (
                    exists (select 1 from tenant_memberships a where a.tenant_id = m.tenant_id and a.member_id = m.id
                               and a.role = 'admin' and a.status = 'active' and a.deleted_at is null)
                    or exists (select 1 from scope_memberships sm
                                where sm.tenant_id = m.tenant_id and sm.member_id = m.id and sm.role = 'manager' and sm.deleted_at is null
                                  and h.to_scope_id in (select app.scope_tree(sm.scope_id)))))
              )
    loop
      perform app.handover_withdrawn_note(h.id, r.member_id, v_cause);
    end loop;
    update ticket_handovers set state = 'withdrawn', decided_at = now() where id = h.id;
    insert into audit_events (tenant_id, actor_member_id, actor_role, action, target_type, target_id, choke_point_id, payload, created_by)
      values (new.tenant_id, v_actor, coalesce(nullif(current_setting('app.role', true), ''), 'system'), 'handover.withdraw', 'tickets',
              new.id::text, 'C2', jsonb_build_object('handover_id', h.id, 'kind', h.kind, 'cause', v_cause), v_actor);
  end loop;
  return new;
end $$;

drop trigger if exists tickets_handover_autowithdraw on tickets;
create trigger tickets_handover_autowithdraw after update of completed_at, deleted_at on tickets
  for each row execute function app.handover_autowithdraw();

-- ---------------------------------------------------------------- 渡す・外す
revoke all on function app.handover_withdrawn_note(uuid, uuid, text) from public;
revoke all on function app.handover_withdraw(uuid) from public;
revoke all on function app.handover_remind(uuid) from public;
revoke all on function app.handover_autowithdraw() from public;
grant execute on function app.handover_withdraw(uuid), app.handover_remind(uuid) to kaname_app;
