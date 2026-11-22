-- 20261119120700_credential_resolve PC がログイン情報を取り出す口（K-354・契約の口 resolveCredential・D-128.57 ①②④・D-102.2・関門 C2）
--   口（apps/api/src/features/F3/credentials/resolve.ts）が呼ぶ関数を 3 つ足す。前の道すじの関数（0064・0065 の app.bridge_credential）は消さない（K-358 まで今のまま動く）。
--   ① app.bridge_credential_for_job：取り出してよいかの判定（書かない。ただし持ち主でない取り出しの証跡だけは同じ関数の中で書く）
--   ② app.credential_used          ：使った記録（use_count・last_used_at・証跡）を 1 つの取引で
--   ③ app.credential_wrong_place   ：使える場所の外へ入れようとした証跡（毎回）と、持ち主への知らせ（同じ情報・同じ場所は 1 時間に 1 つ）を 1 つの取引で
--   仕事は app.bridge_job_of（その PC が取った仕事か、アカウントの人のまだ誰も取っていない仕事・D-128.150 ④）で引く。
--   値（ログイン名・パスワード・鍵）はどの関数も扱わない（預かり先の参照 vault_ref を返すだけ。読むのは口の関門 C8）
--   中に begin／commit を書かない（migrate.ts が 1 本を 1 つの取引で当てる）。もう一度当てても誤りにならない形にする

-- ① 取り出してよいか。答えは {"error": not_found|not_running|revoked} か、取り出しに要る列（vault_ref・kind_id・name・destinations・two_factor_id・expires_at・tenant_id・owner・member）
--   判定の順：仕事がその PC の物 → 仕事が動いている（running・asking）→ 情報が仕事と同じワークスペースで消していない →
--             確かめの仕事ならその仕事の情報 → 個人の物は持ち主の仕事（でなければ証跡 not_owner を書いて not_found）・
--             ワークスペースの物はそのワークスペースの生きた所属の人の仕事 → 失効・期限切れ・参照が無い
create or replace function app.bridge_credential_for_job(p_session uuid, p_job uuid, p_credential uuid) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare j bridge_jobs%rowtype; c credentials%rowtype;
begin
  select * into j from bridge_jobs where id = app.bridge_job_of(p_session, p_job);
  if j.id is null then return jsonb_build_object('error', 'not_found'); end if;
  if j.state_id not in ('running', 'asking') then return jsonb_build_object('error', 'not_running'); end if;
  select * into c from credentials where id = p_credential and tenant_id = j.tenant_id and deleted_at is null;
  if c.id is null then return jsonb_build_object('error', 'not_found'); end if;
  if j.kind = 'login_check' and j.credential_id is distinct from c.id then return jsonb_build_object('error', 'not_found'); end if;
  if c.layer = 'personal' then
    if c.owner_member_id is distinct from j.member_id then
      insert into audit_events (tenant_id, actor_member_id, actor_role, action, target_type, target_id, choke_point_id, payload, created_by)
        values (j.tenant_id, j.member_id, 'bridge', 'credential.bridge_denied', 'credentials', c.id::text, 'C8',
                jsonb_build_object('job_id', j.id, 'reason', 'not_owner'), j.member_id);
      return jsonb_build_object('error', 'not_found');
    end if;
  elsif not exists (
    -- 今いる会社の人（app.current_members_of_auth_user・0111 と同じ書き方）：消していない members で、所属が抜けた・招待中・消したでない
    select 1 from members m
     where m.id = j.member_id and m.tenant_id = c.tenant_id and m.deleted_at is null
       and not exists (select 1 from tenant_memberships tm
                        where tm.tenant_id = m.tenant_id and tm.member_id = m.id
                          and (tm.status in ('left', 'invited') or tm.deleted_at is not null))
  ) then
    return jsonb_build_object('error', 'not_found');
  end if;
  if c.revoked_at is not null or (c.expires_at is not null and c.expires_at < now()) or c.vault_ref is null then
    return jsonb_build_object('error', 'revoked');
  end if;
  return jsonb_build_object(
    'vault_ref', c.vault_ref,
    'kind_id', c.kind_id,
    'name', c.name,
    'destinations', to_jsonb(coalesce(c.destinations, '{}'::text[])),
    'two_factor_id', c.two_factor_id,
    'expires_at', c.expires_at,
    'tenant_id', c.tenant_id,
    'owner', c.owner_member_id,
    'member', j.member_id);
end $$;
revoke all on function app.bridge_credential_for_job(uuid, uuid, uuid) from public;
grant execute on function app.bridge_credential_for_job(uuid, uuid, uuid) to kaname_app;

-- ② 使った記録。use_count + 1・last_used_at・証跡 credential.bridge_resolve（job_id だけ・値は無い）を 1 つの取引で。
--   仕事と情報の結びつきを引き直し、合わなければ投げる（口は 503 にして封を返さない）
create or replace function app.credential_used(p_session uuid, p_job uuid, p_credential uuid) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare j bridge_jobs%rowtype; v_id uuid;
begin
  select * into j from bridge_jobs where id = app.bridge_job_of(p_session, p_job);
  if j.id is null then raise exception '取り出した仕事が見つからない' using errcode = 'P0002'; end if;
  update credentials set use_count = use_count + 1, last_used_at = now()
   where id = p_credential and tenant_id = j.tenant_id and deleted_at is null
   returning id into v_id;
  if v_id is null then raise exception '取り出した情報が見つからない' using errcode = 'P0002'; end if;
  insert into audit_events (tenant_id, actor_member_id, actor_role, action, target_type, target_id, choke_point_id, payload, created_by)
    values (j.tenant_id, j.member_id, 'bridge', 'credential.bridge_resolve', 'credentials', v_id::text, 'C8',
            jsonb_build_object('job_id', j.id), j.member_id);
end $$;
revoke all on function app.credential_used(uuid, uuid, uuid) from public;
grant execute on function app.credential_used(uuid, uuid, uuid) to kaname_app;

-- ③ 使える場所の外。p_destination は口が取り出した名前（URL の道・問い合わせ・@ の前は入れない）。
--   証跡 credential.bridge_denied（理由 wrong_destination）は毎回 1 行。持ち主への知らせ（inapp・credential.wrong_destination・
--   payload は credential_id・name・destination だけ）は、同じ持ち主・同じ情報・同じ場所の知らせが 1 時間の内に無いときだけ 1 行
--   （代表の答え answer=449e72553c59）。情報の行で待ち合わせて、同時の 2 本が知らせを 2 つ書かないようにする
create or replace function app.credential_wrong_place(p_session uuid, p_job uuid, p_credential uuid, p_destination text) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare j bridge_jobs%rowtype; c credentials%rowtype;
begin
  select * into j from bridge_jobs where id = app.bridge_job_of(p_session, p_job);
  if j.id is null then raise exception '仕事が見つからない' using errcode = 'P0002'; end if;
  select * into c from credentials where id = p_credential and tenant_id = j.tenant_id and deleted_at is null for update;
  if c.id is null then raise exception '情報が見つからない' using errcode = 'P0002'; end if;
  insert into audit_events (tenant_id, actor_member_id, actor_role, action, target_type, target_id, choke_point_id, payload, created_by)
    values (j.tenant_id, j.member_id, 'bridge', 'credential.bridge_denied', 'credentials', c.id::text, 'C8',
            jsonb_build_object('job_id', j.id, 'reason', 'wrong_destination', 'destination', left(p_destination, 253)), j.member_id);
  if c.owner_member_id is not null and not exists (
    select 1 from notifications
     where member_id = c.owner_member_id and event_kind_id = 'credential.wrong_destination'
       and payload->>'credential_id' = c.id::text and payload->>'destination' = p_destination
       and created_at > now() - interval '1 hour'
  ) then
    insert into notifications (tenant_id, member_id, channel_id, event_kind_id, payload, dedupe_key, sent_at, created_by)
      values (c.tenant_id, c.owner_member_id, 'inapp', 'credential.wrong_destination',
              jsonb_build_object('credential_id', c.id, 'name', c.name, 'destination', p_destination),
              'credential.wrong_destination:' || c.id::text || ':' || p_destination, now(), j.member_id);
  end if;
end $$;
revoke all on function app.credential_wrong_place(uuid, uuid, uuid, text) from public;
grant execute on function app.credential_wrong_place(uuid, uuid, uuid, text) to kaname_app;
