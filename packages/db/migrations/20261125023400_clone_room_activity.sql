-- 20261125023400 分身の部屋の「やったこと」と「育ち具合」を読む（K-754・関門 C2 は読むだけ・D-128.39・D-153.13・D-153.33）
--   新しい表・列・索引は作らない。読む関数を足す（どれも security definer・stable・search_path に pg_temp・public から外す）。
-- app.clone_runs_done(p_me, p_from, p_to)：期間の中の自分が作った終えた実行と、その結末（result）を 1 つの文で（中だけ・誰にも渡さない）
-- app.clone_run_row(...)：頁の 1 行 { id, at, kind, ticket_id, ticket_number, title, result, detail }（中だけ・誰にも渡さない）
-- app.clone_activity(p_kind, p_from, p_to, p_limit, p_after_at, p_after_id)：{ data, summary, more }。今のメンバーでなければ null
-- app.clone_growth()：{ assigned, pass_rate, pass_rate_last_week, work_seconds }。今のメンバーでなければ null
--   「人が直した版」＝そのチケットの区画 artifacts の版のうち edited_by_clone が偽で、実行が終わった後・承認を決めた時刻（無ければ今）以前に作られた物

create or replace function app.clone_runs_done(p_me uuid, p_from timestamptz, p_to timestamptz)
returns table (run_id uuid, at timestamptz, kind text, ticket_id uuid, ticket_number text, title text, result text,
               approval_id uuid, edited_by uuid, edited_version int)
language sql stable security definer set search_path = public, app, pg_temp as $$
  select r.id, r.at,
         case when r.status_id = 'stopped' then 'stopped' when r.phase = 'make' then 'made' else 'ran' end,
         t.id, t.number, t.title,
         case when r.status_id = 'stopped' then 'stopped'
              when r.phase = 'execute' then 'done'
              when a.id is null or a.decision is null then 'awaiting'
              when a.decision = 'return' then 'returned'
              when a.decision = 'stop' then 'stopped'
              when a.decision = 'self_edit' then 'fixed'
              when a.decision = 'approve' and e.version is not null then 'fixed'
              when a.decision = 'approve' then 'passed'
              else 'awaiting' end,
         a.id, e.edited_by, e.version
    from (select x.*, coalesce(x.finished_at, x.created_at) as at from action_runs x
           where x.created_by = p_me and x.tenant_id = app.tenant_id() and x.deleted_at is null and x.ticket_id is not null
             and x.phase is not null
             and (x.status_id = 'stopped' or (x.status_id = 'done' and x.phase in ('make', 'execute')))
             and coalesce(x.finished_at, x.created_at) >= p_from and coalesce(x.finished_at, x.created_at) < p_to) r
    join tickets t on t.id = r.ticket_id and t.deleted_at is null
    left join lateral (select y.id, y.decision, y.decided_at from approvals y
                        where y.action_run_id = r.id and y.deleted_at is null
                        order by y.created_at desc, y.id desc limit 1) a on r.phase = 'make' and r.status_id = 'done'
    left join lateral (select v.version, v.edited_by from ticket_section_versions v
                         join ticket_sections s on s.id = v.section_id and s.section_key = 'artifacts'
                        where v.ticket_id = r.ticket_id and v.deleted_at is null and not v.edited_by_clone
                          and v.created_at > coalesce(r.finished_at, r.created_at) and v.created_at <= coalesce(a.decided_at, now())
                        order by v.version desc limit 1) e on a.id is not null
   where app.ticket_visible(t.id)
$$;
revoke all on function app.clone_runs_done(uuid, timestamptz, timestamptz) from public;

create or replace function app.clone_run_row(p_run uuid, p_at timestamptz, p_kind text, p_ticket uuid, p_number text, p_title text,
                                             p_result text, p_approval uuid, p_edited_by uuid, p_edited_version int)
returns jsonb
language sql stable security definer set search_path = public, app, pg_temp as $$
  select jsonb_build_object(
    'id', p_run, 'at', p_at, 'kind', p_kind, 'ticket_id', p_ticket, 'ticket_number', p_number, 'title', p_title, 'result', p_result,
    'detail', case
      when p_kind = 'stopped' then
        (select jsonb_build_object('stopped_reason', coalesce(r.error_summary, j.stopped_reason))
           from action_runs r left join bridge_jobs j on j.id = r.bridge_job_id where r.id = p_run)
      when p_kind = 'ran' then
        (select jsonb_build_object('approved', jsonb_build_object('by', app.member_name(a.approver_member_id), 'at', a.decided_at))
           from action_runs r left join approvals a on a.id = r.approval_id where r.id = p_run)
      else
        (select jsonb_build_object('checks', jsonb_build_object('ai', count(*) filter (where s.checked_by_ai), 'total', count(*)))
           from test_specs s where s.ticket_id = p_ticket and s.deleted_at is null)
        || case when p_edited_version is not null
                then jsonb_build_object('edited', jsonb_build_object('by', app.member_name(p_edited_by), 'version', p_edited_version))
                else '{}'::jsonb end
        || case when p_result = 'returned'
                then (select jsonb_build_object('returned', jsonb_build_object('by', app.member_name(a.approver_member_id), 'reason', a.return_reason))
                        from approvals a where a.id = p_approval)
                else '{}'::jsonb end
    end)
$$;
revoke all on function app.clone_run_row(uuid, timestamptz, text, uuid, text, text, text, uuid, uuid, int) from public;

-- 期間は日本の日付（両端を入れる）。並びは at の降順・同じなら id の降順。続きは (at, id) が鍵より小さい行から。1 件多く読んで続きの有無を決める
create or replace function app.clone_activity(p_kind text, p_from date, p_to date, p_limit integer, p_after_at timestamptz, p_after_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.user_id(); v_lo timestamptz; v_hi timestamptz; v_data jsonb; v_n int; v_summary jsonb;
begin
  if v_me is null or not app.member_ok()
     or exists (select 1 from members x where x.id = v_me and x.suspended_at is not null) then
    return null;
  end if;
  v_lo := p_from::timestamp at time zone 'Asia/Tokyo';
  v_hi := (p_to + 1)::timestamp at time zone 'Asia/Tokyo';
  select jsonb_build_object(
           'total', count(*),
           'passed', count(*) filter (where d.result in ('passed', 'done')),
           'fixed', count(*) filter (where d.result in ('fixed', 'returned')),
           'stopped', count(*) filter (where d.result = 'stopped'),
           'waiting', count(*) filter (where d.result = 'awaiting'))
    into v_summary
    from app.clone_runs_done(v_me, v_lo, v_hi) d;
  select coalesce(jsonb_agg(app.clone_run_row(p.run_id, p.at, p.kind, p.ticket_id, p.ticket_number, p.title, p.result,
                                              p.approval_id, p.edited_by, p.edited_version) order by p.at desc, p.run_id desc), '[]'::jsonb),
         count(*)
    into v_data, v_n
    from (select d.* from app.clone_runs_done(v_me, v_lo, v_hi) d
           where (p_kind is null or d.kind = p_kind)
             and (p_after_at is null or (d.at, d.run_id) < (p_after_at, p_after_id))
           order by d.at desc, d.run_id desc
           limit p_limit + 1) p;
  if v_n > p_limit then
    v_data := v_data - p_limit;   -- 1 件多く読んだ分を落とす
  end if;
  return jsonb_build_object('data', v_data, 'summary', v_summary, 'more', v_n > p_limit);
end $$;
revoke all on function app.clone_activity(text, date, date, integer, timestamptz, uuid) from public;
grant execute on function app.clone_activity(text, date, date, integer, timestamptz, uuid) to kaname_app;

-- 今週＝日本時間の月曜 0 時（含む）から次の月曜 0 時まで。先週はその 1 週前
create or replace function app.clone_growth()
returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.user_id(); v_tenant uuid := app.tenant_id(); v_ws timestamptz; v_we timestamptz; v_lw timestamptz;
        v_assigned int; v_rate int; v_last int; v_secs bigint;
begin
  if v_me is null or not app.member_ok()
     or exists (select 1 from members x where x.id = v_me and x.suspended_at is not null) then
    return null;
  end if;
  v_ws := date_trunc('week', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo';
  v_we := v_ws + interval '7 days';
  v_lw := v_ws - interval '7 days';
  select count(distinct r.ticket_id) into v_assigned from action_runs r
   where r.created_by = v_me and r.tenant_id = v_tenant and r.deleted_at is null and r.ticket_id is not null
     and r.phase = 'make' and r.created_at >= v_ws and r.created_at < v_we;
  -- 決めた承認のうち、承認されて人が直した版が無かった物の割合（決めた承認が 0 件なら null）
  with d as (
    select a.decided_at >= v_ws as this_week,
           a.decision = 'approve' and not exists (
             select 1 from ticket_section_versions v join ticket_sections s on s.id = v.section_id and s.section_key = 'artifacts'
               left join action_runs r on r.id = a.action_run_id
              where v.ticket_id = a.ticket_id and v.deleted_at is null and not v.edited_by_clone
                and v.created_at > coalesce(r.finished_at, r.created_at, '-infinity'::timestamptz) and v.created_at <= a.decided_at) as passed
      from approvals a
     where a.requested_by = v_me and a.tenant_id = v_tenant and a.deleted_at is null and a.kind = 'artifact'
       and a.decision in ('approve', 'return', 'self_edit') and a.decided_at >= v_lw and a.decided_at < v_we)
  select round(100.0 * count(*) filter (where this_week and passed) / nullif(count(*) filter (where this_week), 0))::int,
         round(100.0 * count(*) filter (where not this_week and passed) / nullif(count(*) filter (where not this_week), 0))::int
    into v_rate, v_last from d;
  select coalesce(sum(greatest(0, floor(extract(epoch from (r.finished_at - r.started_at))))), 0) into v_secs from action_runs r
   where r.created_by = v_me and r.tenant_id = v_tenant and r.deleted_at is null and r.ticket_id is not null
     and r.status_id in ('done', 'stopped') and r.started_at is not null
     and r.finished_at >= v_ws and r.finished_at < v_we;
  return jsonb_build_object('assigned', v_assigned, 'pass_rate', v_rate, 'pass_rate_last_week', v_last, 'work_seconds', v_secs);
end $$;
revoke all on function app.clone_growth() from public;
grant execute on function app.clone_growth() to kaname_app;
