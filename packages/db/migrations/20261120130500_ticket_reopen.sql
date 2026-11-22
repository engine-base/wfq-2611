-- 20261120130500 完了したチケットを開き直す（K-388・関門 C2・D-125.38・D-128.49・D-128.81・D-136.1）
--   K-387 の app.ticket_progress_set（同じ名前・引数・答えの形）を作り直し、「完了 → 作業中（鍵 doing）」だけ通す。
--   開き直すと段は作業中に戻り、完了の時刻（completed_at）と押した人（completed_by）が消え、変更の 1 行は「<名前> が開き直した」・
--   changes の段の項に note「開き直した」。完了から作業中以外は今までどおり done（409）。★ K-388 の印が変えた所。
--   列・grant・revoke は K-387 と同じ（create or replace なので grant は残るが、同じ文を書いてもう一度当てても誤りにならない）。中に begin／commit を書かない

-- ---------------------------------------------------------------- ① 人が段・実績・保留を変える（1 つの処理）
--   p の鍵：stage_id か stage_key（どちらか 1 つ）・actual_minutes（null は空にする）・hold_reason・resume_condition。無い鍵は変えない。
--   p_line が true なら変更の 1 行（kind change）を書き、段が変わり担当者が自分でない今のメンバーなら受け箱の行を 1 つ書く。
--   false なら 1 行も知らせも書かず、答えの changes と notify_assignee（知らせるはずの担当者の id か null）を呼んだ側に渡す（K-389）。
--   見る順：今のメンバーか → チケット → 守りの判定（例外は guard_failed）→ 行き先の段（stage_both・stage_missing・stage_fixed）→ 段が変わるなら今の段（busy・done）→ 保留の理由と条件 → 実績
create or replace function app.ticket_progress_set(p_ticket uuid, p jsonb, p_line boolean default true) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_tenant uuid := app.tenant_id(); v_me uuid := app.user_id(); t tickets%rowtype;
        cur ticket_stages%rowtype; nxt ticket_stages%rowtype;
        v_p jsonb := coalesce(p, '{}'::jsonb); v_err text; v_field text; v_raw text;
        v_moved boolean; v_hold boolean; v_was_hold boolean; v_reopen boolean;   -- ★ K-388：完了 → 作業中（開き直す）
        v_old_reason text; v_old_resume text; v_reason text; v_resume text;
        v_missing text[] := '{}'; v_extra text[] := '{}';
        v_set_minutes boolean := false; v_minutes integer; v_num numeric;
        v_changes jsonb := '[]'::jsonb; v_fields text[] := '{}'; v_parts text[] := '{}';
        v_body text; v_msg uuid; v_notify uuid;
        c_ctrl constant text := E'[\\x01-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]';   -- 制御文字（タブ・改行・復帰は残す）
        c_space constant text := E' \t\n\x0B\f\r\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF';   -- 空かどうかを見るときに前後から落とす空白（入口の JavaScript の \s と同じ字・契約の pattern と合わせる）
        c_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
        c_minutes_max constant integer := 100000;   -- 作る口の見込みと同じ値域（0〜100000）
begin
  if v_tenant is null or v_me is null then return jsonb_build_object('error', 'not_member'); end if;
  -- 同じチケットの同時の 2 本は 1 本ずつにする（チケットの行で待ち合わせる。後の 1 本は前の 1 本が書いた後の行を見る）
  select * into t from tickets where id = p_ticket and tenant_id = v_tenant for update;
  if t.id is null or t.deleted_at is not null then return jsonb_build_object('error', 'not_found'); end if;
  -- 守りの判定（今のメンバーか・書けるか）の所で例外になったら、外に投げずに guard_failed を返して何も書かない（fail-closed・D-136.1）
  begin
    if not app.approval_member_now() then v_err := 'not_member';
    elsif not app.ticket_writable(t.id) then v_err := 'not_writable';
    end if;
  exception when others then
    return jsonb_build_object('error', 'guard_failed');
  end;
  if v_err is not null then return jsonb_build_object('error', v_err); end if;
  select * into cur from ticket_stages where id = t.stage_id;
  v_was_hold := coalesce(cur.key, '') = 'hold';

  -- 行き先の段：同じ会社・消していない・仕組みの段でない・完了でない（鍵が空の会社が足した段も選べる・D-125.68・D-128.95）
  if v_p ? 'stage_id' and v_p ? 'stage_key' then return jsonb_build_object('error', 'stage_both'); end if;
  nxt := cur;
  if v_p ? 'stage_id' or v_p ? 'stage_key' then
    v_field := case when v_p ? 'stage_id' then 'stage_id' else 'stage_key' end;
    v_raw := v_p ->> v_field;
    if v_field = 'stage_id' then
      if coalesce(v_raw, '') !~ c_uuid then return jsonb_build_object('error', 'stage_missing', 'fields', jsonb_build_array(v_field)); end if;
      select * into nxt from ticket_stages s where s.id = v_raw::uuid and s.tenant_id = v_tenant and s.deleted_at is null;
    else
      select * into nxt from ticket_stages s where s.key = v_raw and s.tenant_id = v_tenant and s.deleted_at is null;
    end if;
    -- 断る番号は役割で分ける（代表の答え answer=f0f290e785a9）：指した段が無い・別の会社・消した → stage_missing（口は 404）、
    --   仕組みの段・完了の段（段の口では移せない）→ stage_fixed（口は 409）
    if nxt.id is null then return jsonb_build_object('error', 'stage_missing', 'fields', jsonb_build_array(v_field)); end if;
    if nxt.is_fixed or coalesce(nxt.key, '') = 'done' then
      return jsonb_build_object('error', 'stage_fixed', 'fields', jsonb_build_array(v_field));
    end if;
  end if;
  v_moved := nxt.id is distinct from cur.id;
  -- ★ K-388：今が完了で行き先が作業中（鍵 doing）のときだけ開き直せる。ほかの行き先は今までどおり done（409）
  v_reopen := v_moved and coalesce(cur.key, '') = 'done' and coalesce(nxt.key, '') = 'doing';
  -- 段が変わるとき：今が仕組みの段か、走っている実行・決まっていない承認待ちがある間は変えられない（完了の口の can_complete と同じ条件）。
  --   今が完了なら開き直してから（作業中への開き直しだけ K-388 が通す）。実績と保留の理由だけなら、この間も変えられる
  if v_moved then
    if coalesce(cur.is_fixed, false)
       or exists (select 1 from action_runs r
                   where r.ticket_id = t.id and r.status_id in ('queued', 'running', 'asking') and r.deleted_at is null)
       or exists (select 1 from approvals a
                   where a.ticket_id = t.id and a.decision is null and a.withdrawn_at is null and a.deleted_at is null) then
      return jsonb_build_object('error', 'busy');
    end if;
    if coalesce(cur.key, '') = 'done' and not v_reopen then return jsonb_build_object('error', 'done'); end if;   -- ★ K-388：作業中への開き直しは通す
  end if;

  -- 保留の理由と再開の条件（D-125.33）：結果の段が保留なら両方が要る。制御文字を除き、前後の空白（全角も）を落として空なら足りない。
  --   字数の上限は置かない・切らない（D-130.1・D-130.4）。保留でない行き先に付けたら断る。保留から出たら列は空にする（記録は 1 行に残る）
  v_hold := coalesce(nxt.key, '') = 'hold';
  v_old_reason := case when v_was_hold then t.hold_reason end;
  v_old_resume := case when v_was_hold then t.resume_condition end;
  if v_hold then
    v_reason := case when v_p ? 'hold_reason' then nullif(btrim(regexp_replace(v_p ->> 'hold_reason', c_ctrl, '', 'g'), c_space), '')
                     when v_field is not null then null else v_old_reason end;   -- 段を送って保留にするなら、理由と条件も体に要る（契約の決まりと同じ）
    v_resume := case when v_p ? 'resume_condition' then nullif(btrim(regexp_replace(v_p ->> 'resume_condition', c_ctrl, '', 'g'), c_space), '')
                     when v_field is not null then null else v_old_resume end;   -- 段を送って保留にするなら、理由と条件も体に要る（契約の決まりと同じ）
    if v_reason is null then v_missing := array_append(v_missing, 'hold_reason'); end if;
    if v_resume is null then v_missing := array_append(v_missing, 'resume_condition'); end if;
    if cardinality(v_missing) > 0 then return jsonb_build_object('error', 'hold_required', 'fields', to_jsonb(v_missing)); end if;
  else
    if coalesce(jsonb_typeof(v_p -> 'hold_reason'), 'null') <> 'null' then v_extra := array_append(v_extra, 'hold_reason'); end if;
    if coalesce(jsonb_typeof(v_p -> 'resume_condition'), 'null') <> 'null' then v_extra := array_append(v_extra, 'resume_condition'); end if;
    if cardinality(v_extra) > 0 then return jsonb_build_object('error', 'hold_not_allowed', 'fields', to_jsonb(v_extra)); end if;
  end if;

  -- 実績（人の分の合計・整数 0〜100000 か null）。入口の値域と、ここの 2 重
  if v_p ? 'actual_minutes' then
    v_set_minutes := true;
    if jsonb_typeof(v_p -> 'actual_minutes') = 'null' then
      v_minutes := null;
    elsif jsonb_typeof(v_p -> 'actual_minutes') = 'number' then
      v_num := (v_p ->> 'actual_minutes')::numeric;
      if v_num <> trunc(v_num) or v_num < 0 or v_num > c_minutes_max then return jsonb_build_object('error', 'bad_minutes'); end if;
      v_minutes := v_num::integer;
    else
      return jsonb_build_object('error', 'bad_minutes');
    end if;
  end if;

  -- 変えた物（並びは段・保留の理由・再開の条件・実績）と、変更の 1 行の文
  if v_moved then
    v_changes := v_changes || case when v_reopen then jsonb_build_object('field', 'stage', 'from', cur.name, 'to', nxt.name, 'note', '開き直した')   -- ★ K-388
                                   else jsonb_build_object('field', 'stage', 'from', cur.name, 'to', nxt.name) end;
    v_fields := array_append(v_fields, 'stage');
  end if;
  if v_hold and v_reason is distinct from v_old_reason then
    v_changes := v_changes || jsonb_build_object('field', 'hold_reason', 'from', v_old_reason, 'to', v_reason);
    v_fields := array_append(v_fields, 'hold_reason');
  end if;
  if v_hold and v_resume is distinct from v_old_resume then
    v_changes := v_changes || jsonb_build_object('field', 'resume_condition', 'from', v_old_resume, 'to', v_resume);
    v_fields := array_append(v_fields, 'resume_condition');
  end if;
  if v_set_minutes and v_minutes is distinct from t.actual_minutes then
    v_changes := v_changes || jsonb_build_object('field', 'actual_minutes', 'from', app.ticket_minutes_text(t.actual_minutes),
                                                 'to', app.ticket_minutes_text(v_minutes));
    v_fields := array_append(v_fields, 'actual_minutes');
  end if;
  -- 何も変わらない（同じ段・同じ値・二度押し）：1 行も知らせも証跡も書かない
  if cardinality(v_fields) = 0 then
    return jsonb_build_object('ticket', app.ticket_progress_row(t), 'stage', jsonb_build_object('id', cur.id, 'key', cur.key, 'name', cur.name),
                              'changed', false, 'message_id', null, 'changes', '[]'::jsonb, 'notify_assignee', null);
  end if;
  if v_moved and v_hold then
    v_parts := v_parts || ('保留にした（理由：' || v_reason || '・再開の条件：' || v_resume || '）');
  elsif v_reopen then
    v_parts := array_append(v_parts, '開き直した'::text);   -- ★ K-388
  elsif v_moved then
    v_parts := v_parts || ('状態を ' || cur.name || ' → ' || nxt.name || ' に変えた');
  elsif 'hold_reason' = any(v_fields) or 'resume_condition' = any(v_fields) then
    v_parts := v_parts || ('保留の理由を直した（理由：' || v_reason || '・再開の条件：' || v_resume || '）');
  end if;
  if 'actual_minutes' = any(v_fields) then
    v_parts := v_parts || case when v_minutes is null then '実績を空にした'
                               else '実績を ' || app.ticket_minutes_text(v_minutes) || ' に変えた' end;
  end if;
  v_body := app.member_name(v_me) || ' が' || array_to_string(v_parts, '・');

  -- 書く（1 つの処理）：段・保留の列（保留でなければ空）・実績・書いた人
  update tickets
     set stage_id = nxt.id,
         hold_reason = case when v_hold then v_reason end,
         resume_condition = case when v_hold then v_resume end,
         actual_minutes = case when v_set_minutes then v_minutes else actual_minutes end,
         completed_at = case when v_reopen then null else completed_at end,   -- ★ K-388：開き直したら完了の時刻と押した人を消す
         completed_by = case when v_reopen then null else completed_by end,
         updated_by = v_me
   where id = t.id
  returning * into t;
  -- 担当者でない人が段を変えたときだけ、担当者（今のメンバー：抜けた・止められた人は除く・D-131.12）に知らせる。実績・保留の理由だけなら知らせない
  if v_moved and t.assignee_member_id is not null and t.assignee_member_id <> v_me then
    select m.id into v_notify from members m
     where m.id = t.assignee_member_id and m.tenant_id = t.tenant_id and m.deleted_at is null and m.suspended_at is null;
  end if;
  if coalesce(p_line, true) then
    insert into ticket_messages (tenant_id, ticket_id, author_member_id, kind, body, changes, created_by)
      values (t.tenant_id, t.id, v_me, 'change', v_body, v_changes, v_me)
    returning id into v_msg;
    -- 受け箱（画面の中だけ・D-125.130）。本文はチケットの id・番号・リンク・変更の 1 行の id・行き先の段だけ（理由の字は入れない）
    if v_notify is not null then
      insert into notifications (tenant_id, member_id, channel_id, event_kind_id, payload, dedupe_key, sent_at, created_by)
        values (t.tenant_id, v_notify, 'inapp', 'ticket.stage_changed',
                jsonb_build_object('ticket_id', t.id, 'number', t.number, 'url', '/tickets/' || t.id::text, 'message_id', v_msg,
                                   'stage', jsonb_build_object('key', nxt.key, 'name', nxt.name)),
                'ticket.stage_changed:' || v_msg::text, now(), v_me);
    end if;
  end if;
  -- 証跡（関門 C2）。中身は変えた欄の名前だけ（理由の字を残さない）
  insert into audit_events (tenant_id, actor_member_id, actor_role, action, target_type, target_id, choke_point_id, payload, created_by)
    values (t.tenant_id, v_me, 'member', 'ticket.progress', 'tickets', t.id::text, 'C2',
            jsonb_build_object('number', t.number, 'fields', to_jsonb(v_fields)), v_me);
  return jsonb_build_object('ticket', app.ticket_progress_row(t), 'stage', jsonb_build_object('id', nxt.id, 'key', nxt.key, 'name', nxt.name),
                            'changed', true, 'message_id', v_msg, 'changes', v_changes,
                            'notify_assignee', case when coalesce(p_line, true) then null else v_notify end);
end $$;
revoke all on function app.ticket_progress_set(uuid, jsonb, boolean) from public;
grant execute on function app.ticket_progress_set(uuid, jsonb, boolean) to kaname_app;
