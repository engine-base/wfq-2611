-- 20261122093400 確認項目を足す（K-434・契約の口 listTestSpecs・createTestSpec・D-150.39・D-150.40・D-150.28・D-150.33・D-150.55・D-150.56・D-130.1・関門 C2）
--   確認項目の行は文（title）とチェックだけ（D-150.39）。種類（check_kind）・判定の型・設定値・OFF の理由の列は残るが使わない（段 6 が使い直す余地）。
--
-- ① test_specs：check_kind を任意に（not null を外す。既存の check は null を通す）。チェックの印と付けた人（checked_at・checked_by_member_id・checked_by_ai・付けるのは K-435）。
--    出どころ source（manual・knowledge・ai・既定 manual）と source_ref_id（この葉は列と既定だけ）。守りを足す：口を通さない書き込みも止める（G-02・23514）
--      test_specs_source_check      ：出どころは 3 つ
--      test_specs_checked_pair      ：時刻なしで付けた人（人・AI）は不可
--      test_specs_checked_one_who   ：人と AI の両方は不可
-- ② tickets.no_spec_reason：「AI に任せる」で確認項目が 0 件のとき要る使わない理由（K-565 が使う）。空白だけは断る
-- ③ app.test_spec_title_check：題名の値の確かめ（何も読まない純粋な関数）。足す口・直す口（K-435）・作るとき足す処理（K-437）が同じ関数を呼ぶ
-- ④ app.test_spec_item：行 → { id, title, checked, position, source, version }（鍵ちょうど 6）。K-435 も使う
-- ⑤ app.test_spec_log：やり取りに確認項目の変更の 1 行を書く（5 つの動き・最初から最終の形。K-435 は作り直さない）
-- ⑥ app.test_spec_create：足す（1 つの取引）。入力の外れを最初に断る。チケットの行は for share（完了の確定 app.ticket_complete の for update と順番になる）

-- ① test_specs
-- 確認項目は文とチェックだけ・種類を持たない行を足すため外す（表は今のところ誰も書かず、読む口は種類を使わない・D-150.39）
-- squawk-ignore ban-drop-not-null
alter table public.test_specs alter column check_kind drop not null;
alter table public.test_specs add column if not exists checked_at timestamptz;
alter table public.test_specs add column if not exists checked_by_member_id uuid references public.members(id);
alter table public.test_specs add column if not exists checked_by_ai boolean not null default false;
alter table public.test_specs add column if not exists source text not null default 'manual';
alter table public.test_specs add column if not exists source_ref_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.test_specs'::regclass and conname = 'test_specs_source_check') then
    alter table public.test_specs add constraint test_specs_source_check
      check (source in ('manual', 'knowledge', 'ai'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.test_specs'::regclass and conname = 'test_specs_checked_pair') then
    alter table public.test_specs add constraint test_specs_checked_pair
      check (checked_at is not null or (checked_by_member_id is null and not checked_by_ai));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.test_specs'::regclass and conname = 'test_specs_checked_one_who') then
    alter table public.test_specs add constraint test_specs_checked_one_who
      check (not (checked_by_member_id is not null and checked_by_ai));
  end if;
end $$;

-- ② tickets.no_spec_reason
alter table public.tickets add column if not exists no_spec_reason text;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.tickets'::regclass and conname = 'tickets_no_spec_reason_check') then
    alter table public.tickets add constraint tickets_no_spec_reason_check
      check (no_spec_reason is null or length(btrim(no_spec_reason, E' \t\r\n　')) > 0);
  end if;
end $$;

-- ③ 題名の値の確かめ（合えば null・外れは言葉）。空白は全角・タブ・改行も空白として見る（DB のロケールに任せない）。長さは落とす前の生の字で数える
create or replace function app.test_spec_title_check(p jsonb) returns text
language plpgsql immutable as $$
declare
  v_ws constant text := E' \t\r\n\f\v　';
  v text;
begin
  if jsonb_typeof(p) is distinct from 'string' then return '題名を入れてください'; end if;
  v := p #>> '{}';
  if char_length(v) > 200 then return '題名は 200 字までにしてください'; end if;
  if btrim(v, v_ws) = '' then return '題名を入れてください'; end if;
  return null;
end $$;
grant execute on function app.test_spec_title_check(jsonb) to public, kaname_app;

-- ④ 行 → 答えの項目（鍵ちょうど 6）。position は同じチケットの消していない行を created_at・id の順に数えた 1 からの番号
create or replace function app.test_spec_item(p_spec uuid) returns jsonb
language sql stable security definer set search_path = public, app, pg_temp as $$
  select jsonb_build_object(
    'id', s.id,
    'title', s.title,
    'checked', s.checked_at is not null,
    'position', (select count(*) from test_specs x
                  where x.tenant_id = s.tenant_id and x.ticket_id = s.ticket_id and x.deleted_at is null
                    and (x.created_at, x.id) <= (s.created_at, s.id))::int,
    'source', s.source,
    'version', s.version)
    from test_specs s
   where s.id = p_spec and s.tenant_id = app.tenant_id()
$$;
revoke all on function app.test_spec_item(uuid) from public;
grant execute on function app.test_spec_item(uuid) to kaname_app;

-- ⑤ やり取りに確認項目の変更の 1 行を書く（行の id を返す）。名前は人なら app.member_name(app.user_id())・AI は「AI」で author は空。
--    changes は [{ field: test_spec, from, to, note }]・note は確認項目の文（画面が文を作れるように）。この葉は added だけを呼ぶ
create or replace function app.test_spec_log(p_ticket uuid, p_action text, p_title text, p_by_ai boolean default false, p_from text default null) returns uuid
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  v_me uuid := app.user_id();
  v_name text;
  v_body text;
  v_from jsonb;
  v_to jsonb;
  v_tenant uuid;
  v_id uuid;
begin
  if p_action is null or p_action not in ('added', 'checked', 'unchecked', 'edited', 'removed') then
    raise exception 'test_spec_log: 知らない動き' using errcode = '22023';
  end if;
  select t.tenant_id into v_tenant from tickets t where t.id = p_ticket and t.tenant_id = app.tenant_id();
  if v_tenant is null then raise exception 'test_spec_log: チケットが無い' using errcode = '22023'; end if;
  v_name := case when coalesce(p_by_ai, false) then 'AI' else app.member_name(v_me) end;
  if p_action = 'added' then
    v_body := v_name || 'が確認項目を足しました：' || p_title; v_from := 'null'::jsonb; v_to := to_jsonb(p_title);
  elsif p_action = 'checked' then
    v_body := v_name || 'が確認項目『' || p_title || '』にチェックを付けました'; v_from := 'false'::jsonb; v_to := 'true'::jsonb;
  elsif p_action = 'unchecked' then
    v_body := v_name || 'が確認項目『' || p_title || '』のチェックを外しました'; v_from := 'true'::jsonb; v_to := 'false'::jsonb;
  elsif p_action = 'edited' then
    v_body := v_name || 'が確認項目『' || p_title || '』を直しました'; v_from := to_jsonb(p_from); v_to := to_jsonb(p_title);
  else
    v_body := v_name || 'が確認項目『' || p_title || '』を外しました'; v_from := to_jsonb(p_title); v_to := 'null'::jsonb;
  end if;
  insert into ticket_messages (tenant_id, ticket_id, author_member_id, kind, body, changes, created_by, updated_by)
  values (v_tenant, p_ticket, case when coalesce(p_by_ai, false) then null else v_me end, 'change', v_body,
          jsonb_build_array(jsonb_build_object('field', 'test_spec', 'from', coalesce(v_from, 'null'::jsonb), 'to', coalesce(v_to, 'null'::jsonb), 'note', p_title)),
          case when coalesce(p_by_ai, false) then null else v_me end,
          case when coalesce(p_by_ai, false) then null else v_me end)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function app.test_spec_log(uuid, text, text, boolean, text) from public;
grant execute on function app.test_spec_log(uuid, text, text, boolean, text) to kaname_app;

-- ⑥ 足す（1 つの取引）。security definer・search_path に pg_temp・public から外し kaname_app だけに渡す。呼んだ人は app.user_id() で引き、引数で人を受けない。
--    答えは { ok: true, row } か { error: invalid（field・message）| not_found | forbidden | done }。外れのときは何も書かない
create or replace function app.test_spec_create(p_ticket uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  v_ws constant text := E' \t\r\n\f\v　';
  v_me uuid := app.user_id();
  v_tenant uuid := app.tenant_id();
  v_bad text;
  v_stage text;
  t tickets%rowtype;
  v_id uuid;
  v_title text;
begin
  -- 入力の外れを最初に断る（何も読まない・何も書かない。チケットの状態に関わらず）
  v_bad := app.test_spec_title_check(p -> 'title');
  if v_bad is not null then
    return jsonb_build_object('error', 'invalid', 'field', 'title', 'message', v_bad);
  end if;
  if v_me is null or v_tenant is null or not app.member_ok() then return jsonb_build_object('error', 'not_found'); end if;
  -- チケットの行を共有で持つ（完了の確定 app.ticket_complete は for update。確定の後に来た方は完了の行を見る）
  select * into t from tickets where id = p_ticket and tenant_id = v_tenant for share;
  if t.id is null or t.deleted_at is not null or not app.ticket_visible(t.id) then return jsonb_build_object('error', 'not_found'); end if;
  if not app.ticket_writable(t.id) then return jsonb_build_object('error', 'forbidden'); end if;
  select st.key into v_stage from ticket_stages st where st.id = t.stage_id;
  if t.completed_at is not null or v_stage = 'done' then return jsonb_build_object('error', 'done'); end if;

  v_title := btrim(p ->> 'title', v_ws);
  insert into test_specs (tenant_id, ticket_id, check_kind, title, params, created_by, updated_by)
  values (t.tenant_id, t.id, null, v_title, '{}'::jsonb, v_me, v_me)
  returning id into v_id;
  perform app.test_spec_log(t.id, 'added', v_title);
  perform app.record_audit('test_spec.create', 'test_specs', v_id::text, 'C2', jsonb_build_object('ticket_id', t.id));
  return jsonb_build_object('ok', true, 'row', app.test_spec_item(v_id));
end $$;
revoke all on function app.test_spec_create(uuid, jsonb) from public;
grant execute on function app.test_spec_create(uuid, jsonb) to kaname_app;
