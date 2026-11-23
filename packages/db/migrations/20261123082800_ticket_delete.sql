-- 20261123082800 チケットを消す（K-488・契約の口 deleteTicket・D-125.51・D-125.62・D-128.84・D-128.116・D-128.158・D-129.43・D-130.4・D-136.2・D-148.5・D-151.14〜16・D-151.20）
--   新しい表・列は作らない。関数を 1 つ足す（書く・関門 C2）。前の app.ticket_soft_delete（0102）は直さず残す（K-92 の試験が直に呼ぶ）。
--
-- app.ticket_delete(p_ticket, p_children, p_parent, p_reason)：1 つの取引の中で、チケットを消す。
--   呼んだ人は app.user_id() で引く（引数で人を受けない）。消せる人は、作った人か、そのグループで tickets の edit を持つ人。
--   子・孫の数え方は K-487 の app.ticket_descendant_counts と同じ（見えない子も数える・消していない物・子と孫の 2 段下まで）。
--   p_children：null＝選ばない／move＝子を p_parent へ移す／cascade＝子・孫も一緒に消す／detach＝子の親を外す。子が無いときは p_children・p_parent を読まない。
--   順：① 消す印（deleted_at）を先に立てる ② 決まっていない承認を取り下げる ③ 走っている実行を止める。
--     止める引き金（K-464 の action_runs_ticket_stopped_notice）は、消えているチケットでは担当者に知らせを書かない。印が後だと「消されたので止めました」を知らせてしまう。
--   答え：{ ok: true, id, deleted_count, withdrawn_approvals, stopped_runs, deleted_at }（deleted_at はミリ秒に切り捨てた UTC の文字）
--         { ok: false, code: FORBIDDEN | NOT_FOUND | PARENT_NOT_FOUND | PARENT_INVALID | TOO_DEEP | CHILDREN_REQUIRED | CASCADE_FORBIDDEN }

create or replace function app.ticket_delete(p_ticket uuid, p_children text, p_parent uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  v_me uuid := app.user_id();
  v_tenant uuid := app.tenant_id();
  v_at timestamptz := now();
  v_t tickets%rowtype;
  v_kids int;
  v_mode text;
  v_ids uuid[];
  v_dest tickets%rowtype;
  v_withdrawn int := 0;
  v_stopped int := 0;
  v_why constant text := 'チケットが消されたので止めました';
  v_id uuid;
  r action_runs%rowtype;
begin
  if v_me is null or v_tenant is null or not app.member_ok() then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  -- 行を for update で取る（同時の 2 回は 1 回だけ通り、もう 1 回は消えた物が見えない）
  select * into v_t from tickets where id = p_ticket and tenant_id = v_tenant and deleted_at is null for update;
  if not found or not app.ticket_visible(p_ticket) then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_t.created_by is distinct from v_me and not has_permission(v_me, 'tickets', v_t.scope_id, 'edit') then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  select count(*) into v_kids from tickets
   where parent_ticket_id = p_ticket and tenant_id = v_tenant and deleted_at is null;
  if v_kids > 0 then
    if p_children is null then
      return jsonb_build_object('ok', false, 'code', 'CHILDREN_REQUIRED');
    end if;
    v_mode := p_children;
  end if;
  v_ids := array[p_ticket];

  if v_mode = 'move' then
    if p_parent is null then
      return jsonb_build_object('ok', false, 'code', 'PARENT_NOT_FOUND');
    end if;
    select * into v_dest from tickets where id = p_parent and tenant_id = v_tenant and deleted_at is null;
    if not found or not app.ticket_visible(p_parent) then
      return jsonb_build_object('ok', false, 'code', 'PARENT_NOT_FOUND');
    end if;
    if p_parent = p_ticket or exists (
      with recursive d as (
        select c.id, 1 as lv from tickets c where c.parent_ticket_id = p_ticket and c.tenant_id = v_tenant
        union all
        select c.id, d.lv + 1 from tickets c join d on c.parent_ticket_id = d.id where d.lv < 5 and c.tenant_id = v_tenant
      )
      select 1 from d where d.id = p_parent
    ) then
      return jsonb_build_object('ok', false, 'code', 'PARENT_INVALID');
    end if;
    begin
      update tickets set parent_ticket_id = p_parent, updated_by = v_me
       where parent_ticket_id = p_ticket and tenant_id = v_tenant and deleted_at is null;
    exception when sqlstate '22023' then   -- 親子 3 段の引き金（付け替えはこの中だけ巻き戻る）
      return jsonb_build_object('ok', false, 'code', 'TOO_DEEP');
    end;
  elsif v_mode = 'detach' then
    update tickets set parent_ticket_id = null, updated_by = v_me
     where parent_ticket_id = p_ticket and tenant_id = v_tenant and deleted_at is null;
  elsif v_mode = 'cascade' then
    with recursive d as (
      select c.id, 1 as lv from tickets c where c.parent_ticket_id = p_ticket and c.tenant_id = v_tenant and c.deleted_at is null
      union all
      select c.id, d.lv + 1 from tickets c join d on c.parent_ticket_id = d.id
       where d.lv < 2 and c.tenant_id = v_tenant and c.deleted_at is null
    )
    select v_ids || coalesce(array_agg(id), '{}') into v_ids from d;
    perform 1 from tickets where id = any(v_ids) order by id for update;
    -- 1 枚でも自分が消せない子・孫があれば、全部やめる
    if exists (
      select 1 from tickets x
       where x.id = any(v_ids) and x.id <> p_ticket
         and x.created_by is distinct from v_me and not has_permission(v_me, 'tickets', x.scope_id, 'edit')
    ) then
      return jsonb_build_object('ok', false, 'code', 'CASCADE_FORBIDDEN');
    end if;
  end if;

  -- ① 消す印を先に立てる（cascade の子・孫は親と同じ時刻・同じ人）
  update tickets set deleted_at = v_at, deleted_by = v_me, updated_by = v_me, delegated_to_clone = false
   where id = any(v_ids) and tenant_id = v_tenant and deleted_at is null;

  -- ② 決まっていない承認を取り下げる（決まった承認は触らない）
  update approvals set withdrawn_at = v_at, status_id = 'withdrawn', updated_by = v_me
   where ticket_id = any(v_ids) and tenant_id = v_tenant
     and decision is null and withdrawn_at is null and deleted_at is null;
  get diagnostics v_withdrawn = row_count;

  -- ③ 走っている AI を止める（待っている・動いている・コードを待っている実行を、仕事と実行ごと）
  for r in
    select * from action_runs
     where ticket_id = any(v_ids) and tenant_id = v_tenant
       and status_id in ('queued', 'running', 'asking') and deleted_at is null
     order by created_at for update
  loop
    v_stopped := v_stopped + 1;
    if r.bridge_job_id is not null then
      -- 承認の後の実行（execute）の仕事は、この更新で引き金が実行・段・旗を書く
      update bridge_jobs set state_id = 'stopped', finished_at = now(), partial = null, stopped_reason = v_why
       where id = r.bridge_job_id and kind = 'ticket' and state_id in ('queued', 'running', 'asking') and deleted_at is null;
    end if;
    update action_runs set status_id = 'stopped', error_summary = v_why, finished_at = now()
     where id = r.id and status_id in ('queued', 'running', 'asking');
    if r.phase is distinct from 'execute' then
      perform app.ticket_stage_to(r.ticket_id, 'doing', r.created_by);   -- 「実行中」のまま固まらず、任せ直せる
    end if;
  end loop;

  -- 証跡は 1 枚ずつ（同じ取引・書けなければ全部戻る）
  foreach v_id in array v_ids loop
    perform app.record_audit('tickets.delete', 'tickets', v_id::text, 'C2',
      jsonb_build_object('reason', p_reason, 'children', v_mode,
                         'cause', case when v_id = p_ticket then 'direct' else 'cascade' end));
  end loop;

  return jsonb_build_object('ok', true, 'id', p_ticket, 'deleted_count', coalesce(array_length(v_ids, 1), 0),
    'withdrawn_approvals', v_withdrawn, 'stopped_runs', v_stopped,
    'deleted_at', to_char(date_trunc('milliseconds', v_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end $$;
revoke all on function app.ticket_delete(uuid, text, uuid, text) from public;
grant execute on function app.ticket_delete(uuid, text, uuid, text) to kaname_app;
comment on function app.ticket_delete(uuid, text, uuid, text) is
  '取り下げた承認は withdrawn_at・status_id = ''withdrawn'' だけを書き、resolved_at は書かない（読む側は decision is null and withdrawn_at is null で見ている・0095・0100）。resolved_at で数える読み手を作るときはこの関数も直す';
