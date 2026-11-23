-- 20261123082700 消す前の下見で、子・孫の件数を数える（K-487・契約の口 previewTicketDelete・D-125.62・D-130.4・D-136.2・D-151.14・D-151.15・D-151.16）
--   新しい表・列は作らない。関数を 1 つ足す（読むだけ・書かない）。
--
-- app.ticket_descendant_counts：そのチケットの子・孫（消していない物・子と孫の 2 段下まで）の件数を数える。
--   呼んだ人の行の守りの外（security definer）で数える訳：消す口 K-488 の関数 app.ticket_delete は、見えないグループにいる子も全部数え、
--   扱い（move・detach・cascade）を選ばなければ 409・E-DEL-010 を返す。下見が呼んだ人の行の守りの中で子を数えると、見えない子が入らず、
--   画面は 3 択の小窓を出さないまま消す口で E-DEL-010 になり、消せなくなる（下見を読み直しても 0 のまま）。
--   だから下見も同じ数え方にする。数えるのは件数だけで、題名・中身は返さない（数だけが見えない子の分も出る）。
--   呼んだ人は app.user_id() で引き（引数で人を受けない）、会社の中の人で、そのチケットが見えるときだけ答える。見えなければ { ok: false, code: 'NOT_FOUND' }。
--   答え：{ ok: true, children, descendants, pending_approvals, running_runs }
--     pending_approvals＝子・孫の決まっていない承認（decision なし・取り下げなし・消していない）
--     running_runs＝子・孫の走っている AI の実行（queued・running・asking）。どちらも「一緒に消す」で取り下げ・止まる分（K-488 の cascade と同じ式）

create or replace function app.ticket_descendant_counts(p_ticket uuid) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_tenant uuid := app.tenant_id(); r jsonb;
begin
  if v_tenant is null or not app.member_ok() or not app.ticket_visible(p_ticket) then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  with recursive d as (
    select c.id, 1 as lv from tickets c
     where c.parent_ticket_id = p_ticket and c.tenant_id = v_tenant and c.deleted_at is null
    union all
    select c.id, d.lv + 1 from tickets c join d on c.parent_ticket_id = d.id
     where d.lv < 2 and c.tenant_id = v_tenant and c.deleted_at is null
  )
  select jsonb_build_object(
    'ok', true,
    'children', (select count(*) from d where d.lv = 1),
    'descendants', (select count(*) from d),
    'pending_approvals', (select count(*) from approvals a
                           where a.ticket_id in (select id from d) and a.tenant_id = v_tenant
                             and a.decision is null and a.withdrawn_at is null and a.deleted_at is null),
    'running_runs', (select count(*) from action_runs x
                      where x.ticket_id in (select id from d) and x.tenant_id = v_tenant
                        and x.status_id in ('queued', 'running', 'asking') and x.deleted_at is null))
    into r;
  return r;
end $$;
revoke all on function app.ticket_descendant_counts(uuid) from public;
grant execute on function app.ticket_descendant_counts(uuid) to kaname_app;
