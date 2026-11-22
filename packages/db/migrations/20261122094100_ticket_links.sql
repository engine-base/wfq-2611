-- 20261122094100 つながりを読む・足す・外す・複製が呼ぶ派生元（K-441・K-59 の葉・D-125.50・D-128.80・D-128.115・D-150.1・D-150.16・D-150.22・D-150.27・関門 C2）
--   新しい表・列は作らない（ticket_links は 0072）。足すのは、関連の対の一意の索引と、関数 6 本。
--   どの関数も呼んだ人を app.user_id() で引き、引数で人を受けない。security definer・search_path に pg_temp・public から外す。
--   つながりは関連（向きなし・行は 1 つ）と派生元（from＝派生した側・to＝元）の 2 つだけ。
--
-- ① 索引 ticket_links_related_pair_uq：消していない関連の行は、向きを問わず同じ対に 1 つだけ（同時に A→B と B→A を足しても 1 本だけ通る最後の砦）
-- ② app.ticket_link_json（中だけ）：p_ticket から見たつながり 1 件の形。相手が見えなければ番号だけ（id・題名・段・グループは null・visible false）
-- ③ app.ticket_link_put（中だけ）：足す本体（足す口と複製が共有）。会社・両方消していない・自分自身・重複・派生元の輪を断り、外した行は生き返らせる
-- ④ app.ticket_links_list（kaname_app）：一覧と子の一覧。見えないチケットは null（口は 404）
-- ⑤ app.ticket_link_add（kaname_app）：見えて書ける 2 つのチケットをつなぎ、証跡 ticket_link.create を書く
-- ⑥ app.ticket_link_remove（kaname_app）：両端のどちらか 1 つに書ける人が外し（相手が見えなくてもよい）、証跡 ticket_link.delete を書く
-- ⑦ app.ticket_link_derive（誰にも渡さない）：複製（K-438）が呼ぶ。元が見えるかだけ確かめ（書けるかは確かめない）、put の答えをそのまま返す。証跡は書かない

-- ① 関連の対の一意の索引
create unique index if not exists ticket_links_related_pair_uq
  on ticket_links (least(from_ticket_id, to_ticket_id), greatest(from_ticket_id, to_ticket_id))
  where kind = 'related' and deleted_at is null;

-- ② p_ticket から見たつながり 1 件（中だけ）
create or replace function app.ticket_link_json(p_link uuid, p_ticket uuid) returns jsonb
language sql stable security definer set search_path = public, app, pg_temp as $$
  select jsonb_build_object(
    'id', l.id,
    'kind', l.kind,
    'side', case when l.kind = 'derived_from' then (case when l.from_ticket_id = p_ticket then 'derived' else 'source' end) else null end,
    'other', case
      when app.ticket_visible(o.id) then jsonb_build_object(
        'id', o.id, 'number', o.number, 'title', o.title,
        'stage', jsonb_build_object('id', s.id, 'key', s.key, 'name', s.name),
        'scope', jsonb_build_object('id', g.id, 'name', g.name),
        'visible', true)
      else jsonb_build_object('id', null, 'number', o.number, 'title', null, 'stage', null, 'scope', null, 'visible', false)
    end,
    'can_remove', (app.ticket_visible(l.from_ticket_id) and app.ticket_writable(l.from_ticket_id))
               or (app.ticket_visible(l.to_ticket_id) and app.ticket_writable(l.to_ticket_id)),
    'created_at', l.created_at)
    from ticket_links l
    join tickets o on o.id = case when l.from_ticket_id = p_ticket then l.to_ticket_id else l.from_ticket_id end
    left join ticket_stages s on s.id = o.stage_id
    left join scopes g on g.id = o.scope_id
   where l.id = p_link
$$;
revoke all on function app.ticket_link_json(uuid, uuid) from public;

-- ③ つなぐ本体（中だけ）。答えは {ok, id, created} か {error: gone|same|duplicate|cycle|bad_kind}
--   2 つのチケットの行を id の順に for update で取ってから数える（同時の足しは 1 本ずつになる）。派生元は会社ごとの advisory lock を取ってから輪を辿る
create or replace function app.ticket_link_put(p_from uuid, p_to uuid, p_kind text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_tenant uuid := app.tenant_id(); v_me uuid := app.user_id(); v_n integer; v_row ticket_links%rowtype; v_id uuid; v_cycle boolean;
begin
  if v_tenant is null or v_me is null or not app.approval_member_now() then return jsonb_build_object('error', 'gone'); end if;
  if p_kind is null or p_kind not in ('related', 'derived_from') then return jsonb_build_object('error', 'bad_kind'); end if;
  perform 1 from tickets where id in (p_from, p_to) and tenant_id = v_tenant and deleted_at is null order by id for update;
  select count(*) into v_n from tickets where id in (p_from, p_to) and tenant_id = v_tenant and deleted_at is null;
  if v_n < (case when p_from = p_to then 1 else 2 end) then return jsonb_build_object('error', 'gone'); end if;
  if p_from = p_to then return jsonb_build_object('error', 'same'); end if;
  -- 同じ組（関連は逆向きも）に消していない行が在る
  if exists (select 1 from ticket_links l
              where l.tenant_id = v_tenant and l.deleted_at is null and l.kind = p_kind
                and ((l.from_ticket_id = p_from and l.to_ticket_id = p_to)
                     or (p_kind = 'related' and l.from_ticket_id = p_to and l.to_ticket_id = p_from))) then
    return jsonb_build_object('error', 'duplicate');
  end if;
  -- 派生元の輪：相手から派生元を辿って自分に着くか（最大 20 段）
  if p_kind = 'derived_from' then
    perform pg_advisory_xact_lock(hashtextextended('ticket_link_cycle:' || v_tenant::text, 0));
    with recursive chain(id, depth) as (
      select p_to, 0
      union all
      select l.to_ticket_id, c.depth + 1
        from chain c
        join ticket_links l on l.from_ticket_id = c.id and l.kind = 'derived_from' and l.deleted_at is null and l.tenant_id = v_tenant
       where c.depth < 20
    )
    select exists (select 1 from chain where id = p_from) into v_cycle;
    if v_cycle then return jsonb_build_object('error', 'cycle'); end if;
  end if;
  -- 外した行（同じ組・関連は逆向きも）があれば生き返らせる（元の unique が消した行も数えるため。id は前のまま・向きは足した向き）
  select * into v_row from ticket_links l
   where l.tenant_id = v_tenant and l.deleted_at is not null and l.kind = p_kind
     and ((l.from_ticket_id = p_from and l.to_ticket_id = p_to)
          or (p_kind = 'related' and l.from_ticket_id = p_to and l.to_ticket_id = p_from))
   order by (l.from_ticket_id = p_from) desc, l.deleted_at desc, l.id
   limit 1 for update;
  if v_row.id is not null then
    update ticket_links set deleted_at = null, from_ticket_id = p_from, to_ticket_id = p_to, updated_by = v_me where id = v_row.id;
    return jsonb_build_object('ok', true, 'id', v_row.id, 'created', false);
  end if;
  begin
    insert into ticket_links (tenant_id, from_ticket_id, to_ticket_id, kind, created_by)
      values (v_tenant, p_from, p_to, p_kind, v_me) returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('error', 'duplicate');
  end;
  return jsonb_build_object('ok', true, 'id', v_id, 'created', true);
end $$;
revoke all on function app.ticket_link_put(uuid, uuid, text) from public;

-- ④ 一覧と子（見えないチケットは null）
--   つながり：そのチケットの消していない行を、相手が消えていないものだけ。派生元が先・作った順・id で最大 200 行
--   子：parent_ticket_id が p_ticket・消していない・呼んだ人に見えるチケットを作った順・id で最大 200（親の行は足さない）
create or replace function app.ticket_links_list(p_ticket uuid) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_tenant uuid := app.tenant_id(); v_items jsonb; v_children jsonb;
begin
  if v_tenant is null or not app.ticket_visible(p_ticket) then return null; end if;
  select coalesce(jsonb_agg(app.ticket_link_json(x.id, p_ticket) order by x.is_derived desc, x.created_at, x.id), '[]'::jsonb) into v_items
    from (select l.id, l.created_at, (l.kind = 'derived_from') as is_derived
            from ticket_links l
            join tickets o on o.id = case when l.from_ticket_id = p_ticket then l.to_ticket_id else l.from_ticket_id end
           where l.tenant_id = v_tenant and l.deleted_at is null
             and (l.from_ticket_id = p_ticket or l.to_ticket_id = p_ticket)
             and o.tenant_id = v_tenant and o.deleted_at is null
           order by (l.kind = 'derived_from') desc, l.created_at, l.id
           limit 200) x;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'number', c.number, 'title', c.title,
           'stage', jsonb_build_object('id', s.id, 'key', s.key, 'name', s.name),
           'scope', jsonb_build_object('id', g.id, 'name', g.name)) order by c.created_at, c.id), '[]'::jsonb) into v_children
    from (select t.* from tickets t
           where t.parent_ticket_id = p_ticket and t.tenant_id = v_tenant and t.deleted_at is null and app.ticket_visible(t.id)
           order by t.created_at, t.id
           limit 200) c
    left join ticket_stages s on s.id = c.stage_id
    left join scopes g on g.id = c.scope_id;
  return jsonb_build_object('items', v_items, 'children', v_children);
end $$;
revoke all on function app.ticket_links_list(uuid) from public;
grant execute on function app.ticket_links_list(uuid) to kaname_app;

-- ⑤ つながりを足す。答えは {ok, link} か {error[, field]}（error：not_member|not_found|not_writable|same|duplicate|cycle|bad_kind|gone）
create or replace function app.ticket_link_add(p_ticket uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_tenant uuid := app.tenant_id(); v_me uuid := app.user_id(); v_other uuid; v_txt text := p->>'other_ticket_id'; v_kind text := p->>'kind'; v_res jsonb; v_id uuid;
begin
  if v_tenant is null or v_me is null or not app.approval_member_now() then return jsonb_build_object('error', 'not_member'); end if;
  if not app.ticket_visible(p_ticket) then return jsonb_build_object('error', 'not_found'); end if;
  -- 足す側に書けないのは、口の入口の行の確かめが先に 403（欄なし）で止める。ここは競合（入口の後で権限が変わった）の守りで、欄は付けない
  if not app.ticket_writable(p_ticket) then return jsonb_build_object('error', 'not_writable'); end if;
  if v_txt is null or v_txt !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return jsonb_build_object('error', 'not_found'); end if;
  v_other := v_txt::uuid;
  if not app.ticket_visible(v_other) then return jsonb_build_object('error', 'not_found'); end if;
  if not app.ticket_writable(v_other) then return jsonb_build_object('error', 'not_writable', 'field', 'other_ticket_id'); end if;
  v_res := app.ticket_link_put(p_ticket, v_other, v_kind);
  if v_res ? 'error' then return v_res; end if;
  v_id := (v_res->>'id')::uuid;
  insert into audit_events (tenant_id, actor_member_id, actor_role, action, target_type, target_id, choke_point_id, payload, created_by)
    values (v_tenant, v_me, 'member', 'ticket_link.create', 'ticket_links', v_id::text, 'C2',
            jsonb_build_object('ticket_id', p_ticket, 'other_ticket_id', v_other, 'kind', v_kind), v_me);
  return jsonb_build_object('ok', true, 'link', app.ticket_link_json(v_id, p_ticket));
end $$;
revoke all on function app.ticket_link_add(uuid, jsonb) from public;
grant execute on function app.ticket_link_add(uuid, jsonb) to kaname_app;

-- ⑥ つながりを外す（論理削除）。答えは {ok, id} か {error: not_member|not_found|not_writable}
--   外せるのは、両端のどちらか 1 つが見えて書ける人（相手が見えなくてもよい）。どちらも見えない人・別の会社・消した行・無い id は not_found
create or replace function app.ticket_link_remove(p_link uuid) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_tenant uuid := app.tenant_id(); v_me uuid := app.user_id(); l ticket_links%rowtype;
begin
  if v_tenant is null or v_me is null or not app.approval_member_now() then return jsonb_build_object('error', 'not_member'); end if;
  select * into l from ticket_links x where x.id = p_link and x.tenant_id = v_tenant and x.deleted_at is null for update;
  if l.id is null or not (app.ticket_visible(l.from_ticket_id) or app.ticket_visible(l.to_ticket_id)) then
    return jsonb_build_object('error', 'not_found');
  end if;
  if not ((app.ticket_visible(l.from_ticket_id) and app.ticket_writable(l.from_ticket_id))
          or (app.ticket_visible(l.to_ticket_id) and app.ticket_writable(l.to_ticket_id))) then
    return jsonb_build_object('error', 'not_writable');
  end if;
  update ticket_links set deleted_at = now(), updated_by = v_me where id = l.id;
  insert into audit_events (tenant_id, actor_member_id, actor_role, action, target_type, target_id, choke_point_id, payload, created_by)
    values (v_tenant, v_me, 'member', 'ticket_link.delete', 'ticket_links', l.id::text, 'C2',
            jsonb_build_object('ticket_id', l.from_ticket_id, 'other_ticket_id', l.to_ticket_id, 'kind', l.kind), v_me);
  return jsonb_build_object('ok', true, 'id', l.id);
end $$;
revoke all on function app.ticket_link_remove(uuid) from public;
grant execute on function app.ticket_link_remove(uuid) to kaname_app;

-- ⑦ 複製（K-438）が呼ぶ派生元のつながり。誰にも execute を渡さない（security definer の関数の中から呼ぶ）
--   元が見えるかだけ確かめる（書けるかは確かめない。呼ぶ複製の関数が書ける人だけを通す）。put の答えをそのまま返す：
--   {ok, id, created} か {error: gone|same|duplicate|cycle}。外した行は生き返って created false。証跡は書かない（複製の証跡に含まれる）
create or replace function app.ticket_link_derive(p_ticket uuid, p_source uuid) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if not app.ticket_visible(p_source) then return jsonb_build_object('error', 'gone'); end if;
  return app.ticket_link_put(p_ticket, p_source, 'derived_from');
end $$;
revoke all on function app.ticket_link_derive(uuid, uuid) from public;
