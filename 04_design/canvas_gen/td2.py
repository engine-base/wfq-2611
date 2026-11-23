import os; os.environ["NOGEN"] = "1"
import re
from td import *

# 7 versions: full page replacing main content
s = BASE
bar_end = s.index("</div>", s.index('class="kn-bar"'))
bar_end = s.index("</span></div>", s.index('class="kn-bar"')) + len("</span></div>")
mend = s.rindex("</main>")
ver = lambda v, who, when, what, sel=False, ai=False: ('<a href="#" style="display: flex; gap: 10px; padding: 10px; border-radius: 8px; text-decoration: none; color: #131B27; %s">%s<span style="flex: 1; min-width: 0"><b style="font-weight: 500; display: block">%s</b><span style="font-size: 11px; color: %s">%s ・ %s</span><span style="display: block; font-size: 12px; color: %s">%s</span></span></a>'
   % ("background: #FFFFFF; box-shadow: 0 1px 2px rgba(19,27,39,.08), 0 0 0 1px rgba(19,27,39,.06)" if sel else "", icon("AI", NAVY, 26) if ai else AV(who[0], "#6B5B99" if who[0] == "高" else "#2F4B7C"), v, MUTED, who, when, MUTED, what))
DEL = 'background: #FDECEC; color: #991B1B; text-decoration: line-through'; ADD = 'background: #E6F6EA; color: #166534'
line = lambda t, st="": '<div style="padding: 2px 8px; border-radius: 4px; %s">%s</div>' % (st, t)
body = ('\n  <div style="display: flex; flex: 1 0 auto; min-height: 0">'
  '<aside aria-label="版の一覧" class="kn-sub" style="width: 280px">'
  '<div class="kn-sub-h">本文の版 ・ 3 つ</div>'
  + ver("版 3（いま）", "高本", "11/01 08:50", "請求の内訳：追加対応を 2 回に", True) + ver("版 2", "高本のAI", "11/01 08:12", "請求書を作った・実施事項を 3 つ済みに", ai=True) + ver("版 1", "高本", "10/30 17:44", "作成（ひな形「請求書を作る v3」）")
  + '<div class="kn-sub-note">本文を保存するたびに版が増える。書いている途中の自動保存は版にしない</div></aside>'
  + '<section style="flex: 1; min-width: 0; padding: 16px 24px; display: flex; flex-direction: column; gap: 12px">'
  '<div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap"><a href="TicketDetail.dc.html" style="font-size: 12px">← チケットに戻る</a><h2 style="font-size: 17px; margin: 0">版と差分</h2>'
  '<span style="display: inline-flex; align-items: center; gap: 6px; font-size: 12px; border: 1px solid #DDE2E9; border-radius: 6px; padding: 4px 10px; background: #FFFFFF">版 2 ▾ → 版 3 ▾</span>'
  '<span style="display: inline-flex; border: 1px solid #DDE2E9; border-radius: 6px; overflow: hidden"><button type="button" style="height: 28px; border: 0; background: #22345C; color: #FFFFFF; padding: 0 10px; font-size: 12px">変わったところだけ</button><button type="button" style="height: 28px; border: 0; background: #FFFFFF; color: #4A5563; padding: 0 10px; font-size: 12px">全文</button></span>'
  '<span style="margin-left: auto; display: flex; gap: 6px">' + btn("版 2 に戻す") + btn("この差分をコピー") + '</span></div>'
  '<div style="display: flex; gap: 8px; font-size: 12px; color: %s">%s%s<span>2 か所 ・ 高本 11/01 08:50</span></div>' % (MUTED, pill("− 1 行", "#FDECEC", "#991B1B"), pill("＋ 1 行", "#E6F6EA", "#166534"))
  + '<div style="background: #FFFFFF; border: 1px solid #DDE2E9; border-radius: 10px; padding: 14px 18px; display: flex; flex-direction: column; gap: 4px; font-size: 13px">'
  '<div style="font-size: 12px; color: %s; font-weight: 500">請求の内訳</div>' % MUTED
  + line("システム保守（11月分） ・ 1 式 ・ 1,500,000") + line("追加対応（10/12） ・ 1 回 ・ 30,000", DEL) + line("追加対応（10/12・10/19） ・ 2 回 ・ 60,000", ADD)
  + line("合計（税込） 1,683,000", DEL) + line("合計（税込） 1,716,000", ADD)
  + '<div style="font-size: 12px; color: %s; font-weight: 500; margin-top: 10px">相手</div>' % MUTED
  + line("セイコー株式会社 経理部 山田様（宛先）") + line("営業 鈴木様（CC）", ADD) + '</div>'
  + '<div style="display: flex; gap: 10px; align-items: flex-start; background: #FFF8EE; border: 1px solid #F1D9A8; border-radius: 8px; padding: 10px 12px; font-size: 12px">' + icon("!", "#B45309", 22) + '<span>版 3 で本文が変わったので、確認の結果（版 2 で通った 3 件）は古くなった。承認の前に確認がやり直される（D-125.84）</span></div>'
  '</section></div>\n ')
save("TdVersions.dc.html", "版と差分", s[:bar_end] + body + s[mend:])

# 8 run log drawer
step = lambda t, d, st="ok": '<div style="display: flex; gap: 10px; padding: 6px 0"><span style="width: 18px; height: 18px; flex: none; border-radius: 99px; display: grid; place-items: center; font-size: 11px; color: #FFFFFF; background: %s">%s</span><div style="flex: 1; min-width: 0"><div>%s</div><div style="font-size: 11px; color: %s">%s</div></div></div>' % ({"ok": "#166534", "ng": "#B91C1C", "ask": "#B45309"}[st], {"ok": "✓", "ng": "!", "ask": "?"}[st], t, MUTED, d)
run = lambda h, sub, res, rc, steps, open_=False: ('<div style="border: 1px solid #DDE2E9; border-radius: 10px; overflow: hidden"><div style="display: flex; gap: 10px; align-items: center; padding: 10px 12px; background: %s">%s<div style="flex: 1; min-width: 0"><b style="font-weight: 500">%s</b><div style="font-size: 11px; color: %s">%s</div></div>%s<span style="color: #4A5563">%s</span></div>%s</div>'
   % ("#F7F8FA" if open_ else "#FFFFFF", icon("AI", NAVY, 26), h, MUTED, sub, pill(res, *rc), "▾" if open_ else "▸", ('<div style="padding: 6px 12px 10px; border-top: 1px solid #EDF0F4">%s</div>' % steps) if open_ else ""))
OK = ("#E8F5EC", "#166534"); NG = ("#FDECEC", "#B91C1C")
steps = (step("見積 EG-097 を読んだ", "月額 1,500,000・追加対応 1 回 30,000") + step("請求書のひな形に写した", "業務の型「請求書を作る v3」の 2 つ目") + step("宛名と CC を確かめた", "守ること「宛名と CC」（取引先：セイコー）を使った")
  + step("先方の請求書システムを見ようとした", "許可を聞いた → 高本 が「今回だけ許す」11/01 09:06", "ask") + step("PDF を作った", "請求書 No.2026-1101.pdf ・ 1,716,000 円") + step("確認を流した", "① 機械 2 件 通過 ・ ② AI 1 件 通過（別のセッション）・ ③ 人 1 件 待ち"))
dr = ('<div style="display: flex; align-items: center; gap: 10px; padding: 14px 18px; border-bottom: 1px solid #EDF0F4"><b style="font-size: 15px">実行の記録</b><span style="font-size: 12px; color: %s">EG-128 ・ 3 回</span><a href="TicketDetail.dc.html" aria-label="閉じる" style="margin-left: auto; color: #4A5563; text-decoration: none; font-size: 18px">×</a></div>' % MUTED
  + '<div style="display: flex; gap: 6px; padding: 10px 18px; border-bottom: 1px solid #EDF0F4">' + chip("すべて 3", True) + chip("通った 2") + chip("落ちた 1") + '</div>'
  + '<div style="flex: 1; overflow: auto; padding: 14px 18px; display: flex; flex-direction: column; gap: 10px">'
  + run("請求書を作り、確認を流した", "高本のAI ・ 11/01 09:00 → 09:12（12 分）・ 高本の MacBook", "通った", OK, steps, True)
  + run("確認 ② AI の判定（2 回目）", "高本のAI（別のセッション）・ 11/01 09:10 ・ 1 分", "通った", OK, "")
  + run("確認 ② AI の判定（1 回目）", "高本のAI（別のセッション）・ 11/01 09:08 ・ CC が抜けていた → 直して流し直し", "落ちた", NG, "")
  + '<div style="font-size: 12px; color: %s">使ったもの：ナレッジ「請求のルール」版 4 ・ 取引先のルール：セイコー様 ・ 5 時間の枠の 3%%</div></div>' % MUTED
  + '<div style="padding: 12px 18px; border-top: 1px solid #EDF0F4; display: flex; gap: 8px">' + btn("記録を書き出す") + btn("この実行について分身と話す", "", "StAiPanel.dc.html") + '</div>')
save("TdRunLog.dc.html", "実行の記録", drawer(BASE, dr, 540, "実行の記録"))

# 9 add child / link
tab = lambda t, on: '<a href="#" style="padding: 8px 14px; border-bottom: 2px solid %s; color: %s; text-decoration: none; %s">%s</a>' % (((NAVY, NAVY, "font-weight: 500") if on else ("transparent", MUTED, "")) + (t,))
res = lambda k, t, g, st, sel=False: '<div style="display: flex; gap: 10px; align-items: center; padding: 8px 10px; border-radius: 6px; %s"><span style="font-size: 12px; color: #22345C; width: 52px">%s</span><span style="flex: 1">%s</span><span style="font-size: 11px; color: %s">%s</span>%s</div>' % ("background: #F1F3F6" if sel else "", k, t, MUTED, g, pill(st))
s = modal(BASE, mhead("つながりを足す", "", "EG-128 セイコー様へ 11月分の請求書を送る")
  + '<div style="display: flex; border-bottom: 1px solid #EDF0F4; padding: 0 18px">' + tab("今あるチケットとつなぐ", True) + tab("子チケットを作る", False) + '</div>'
  + mbody('<div>' + lab("つながりの種類") + '<div style="display: flex; gap: 6px; flex-wrap: wrap">' + chip("関連", True) + chip("これを先に終える（前提）") + chip("これが終わったら始める") + chip("重複") + chip("派生元") + '</div></div>'
  + '<div>' + lab("チケットを探す") + '<input value="入金" style="width: 100%; box-sizing: border-box; height: 34px; border: 1px solid #22345C; box-shadow: 0 0 0 2px #DCE4F2; border-radius: 6px; padding: 0 10px; font-family: inherit; font-size: 13px">'
  + '<div style="margin-top: 6px; display: flex; flex-direction: column; gap: 2px">' + res("KR-031", "入金の照合（11月分）", "経理", "未着手 ・ もうつながっている") + res("KR-035", "セイコー様 入金の確認（11/30）", "経理", "未着手", True) + res("EG-102", "入金サイクルの見直し", "営業", "完了") + '</div></div>'
  + '<div style="display: flex; gap: 8px; align-items: center; background: #F7F8FA; border-radius: 8px; padding: 8px 10px; font-size: 12px">' + icon("AI", NAVY, 22) + '<span>分身の提案：<b style="font-weight: 500">KR-035</b> は「これが終わったら始める」が合いそう（入金の確認は請求のあと）</span></div>')
  + mfoot(btn("やめる", "", "TicketDetail.dc.html"), btn("つなぐ", "p", "TicketDetail.dc.html"), left='<span style="font-size: 12px; color: %s">子チケットは「子チケットを作る」から。親の担当・期限を写せる</span>' % MUTED), 620, "つながりを足す")
save("TdLink.dc.html", "つながりを足す", s)

# 10 make decision
s = modal(BASE, mhead("決定にする", icon("決", "#186F69", 30), "書き込みを決定ログに残す。あとから根拠として引ける")
  + mbody('<div style="border-left: 3px solid #DDE2E9; padding: 6px 10px; background: #F7F8FA; border-radius: 0 6px 6px 0; font-size: 12px"><b style="font-weight: 500">鈴木 一郎</b> <span style="color: %s">11/01 10:20</span><div>10/19 の追加対応は先方の都合で無償にした件、請求から外すか？ → 外してください。先方とは電話で合意済みです</div></div>' % MUTED
  + '<div>' + lab("決めたこと", "（分身が一文にまとめた案）") + '<textarea style="width: 100%; box-sizing: border-box; min-height: 56px; border: 1px solid #22345C; box-shadow: 0 0 0 2px #DCE4F2; border-radius: 8px; padding: 8px 10px; font-family: inherit; font-size: 13px">10/19 の追加対応は無償。11月分の請求から外す</textarea></div>'
  + '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px"><div>' + lab("決めた人") + field("鈴木 一郎（先方と合意）") + '</div><div>' + lab("理由") + field("先方の都合による作業のため") + '</div></div>'
  + '<div style="display: flex; gap: 8px; align-items: center; background: #FFF8EE; border-radius: 8px; padding: 8px 10px; font-size: 12px">' + icon("!", "#B45309", 22) + '<span>本文の「請求の内訳」と食い違う（追加対応 2 回）。決定にしたあと、分身が本文を直す案を出す</span></div>')
  + mfoot(btn("やめる", "", "TicketDetail.dc.html"), btn("決定にする", "p", "StAiPanel.dc.html")), 600, "決定にする")
save("TdDecision.dc.html", "決定にする", s)

# 11 preview deliverable
page_ = ('<div style="background: #FFFFFF; width: 100%; max-width: 420px; aspect-ratio: 1 / 1.414; box-shadow: 0 2px 12px rgba(0,0,0,.12); padding: 28px; box-sizing: border-box; font-size: 11px; display: flex; flex-direction: column; gap: 8px">'
  '<b style="font-size: 18px">請求書</b><div style="display: flex"><span>セイコー株式会社 経理部 山田 様</span><span style="margin-left: auto">No.2026-1101 ・ 2026/11/01</span></div>'
  '<div style="border-top: 2px solid #131B27; padding-top: 8px; font-size: 14px">ご請求金額 <b>¥1,716,000</b>（税込）</div>'
  '<div style="display: grid; grid-template-columns: 1fr 40px 80px; gap: 4px; border-top: 1px solid #DDE2E9; padding-top: 6px"><span>システム保守（11月分）</span><span>1 式</span><span style="text-align: right">1,500,000</span><span>追加対応（10/12・10/19）</span><span>2 回</span><span style="text-align: right">60,000</span><span>消費税 10%</span><span></span><span style="text-align: right">156,000</span></div>'
  '<div style="margin-top: auto; color: #4A5563">お支払期日 2026/12/31 ・ 登録番号 T1234567890123 ・ 株式会社ENGINE BASE</div></div>')
s = modal(BASE, mhead("請求書 No.2026-1101.pdf", "", "成果物の版 1 ・ 11/01 09:10 高本のAI が作成 ・ データ（項目）から作成")
  + '<div style="display: flex; border-bottom: 1px solid #EDF0F4; padding: 0 18px">' + tab("見た目", True) + tab("データ", False) + tab("試し打ち（自分宛）", False) + '</div>'
  + '<div style="display: flex; flex-wrap: wrap; gap: 0; min-height: 0">'
  + '<div style="flex: 1 1 420px; background: #EEF0F4; padding: 20px; display: grid; place-items: center">' + page_ + '</div>'
  + '<div style="flex: 1 1 240px; padding: 16px 18px; display: flex; flex-direction: column; gap: 10px; font-size: 12px"><b style="font-size: 13px">確認の結果</b>'
  + '<span style="color: #166534">✓ 金額が見積の月額と一致</span><span style="color: #166534">✓ インボイスの必須項目</span><span style="color: #166534">✓ 宛名と CC（AI 判定）</span><span style="color: #7A4A05">□ 送る前に PDF を目で見る（あなた）</span>'
  + '<div style="border-top: 1px solid #EDF0F4; padding-top: 10px"><b style="font-weight: 500">送る文面</b><div style="color: %s; margin-top: 4px">山田様　いつもお世話になっております。11 月分の請求書をお送りします。ご確認のほどよろしくお願いいたします。</div></div>' % MUTED
  + '<label style="display: flex; gap: 6px; align-items: center"><span style="width: 16px; height: 16px; border-radius: 4px; background: #22345C; color: #FFFFFF; font-size: 11px; display: grid; place-items: center">✓</span>目で見た（確認 ③ を済みにする）</label></div></div>'
  + mfoot(btn("ダウンロード"), btn("直すところを分身に伝える", "", "StAiPanel.dc.html"), btn("承認して送る", "p", "StModal.dc.html"), left='<span style="font-size: 12px; color: %s">1 / 1 ページ ・ 100%%</span>' % MUTED), 920, "成果物を大きく見る")
save("TdPreview.dc.html", "成果物を大きく見る", s)

# 12 check gaps
sug = lambda t, kind, why, on=True: '<div style="display: flex; gap: 10px; align-items: flex-start; border: 1px solid #DDE2E9; border-radius: 8px; padding: 10px 12px">%s<div style="flex: 1"><div>%s %s</div><div style="font-size: 11px; color: %s">%s</div></div></div>' % (check("", on).replace('padding: 4px 0', 'padding: 0'), t, pill(kind), MUTED, why)
s = modal(BASE, mhead("抜けを点検する", icon("AI", NAVY, 30), "分身が完了の条件・業務の型・過去の差し戻しと見比べた")
  + mbody('<div style="display: flex; gap: 8px; font-size: 12px">' + pill("足りないかも 3", "#FFF4E0", "#7A4A05") + pill("今ので足りている 4", "#E8F5EC", "#166534") + '</div>'
  + sug("支払期日が「月末締め翌月末」になっている", "① 機械", "前提と制約にあるのに、確認の項目にない")
  + sug("PDF のファイル名が取引先の決まりどおり", "② AI", "セイコー様は「請求書_年月_社名.pdf」を求めている（取引先のルール）")
  + sug("前月の請求と金額が大きく違わない", "② AI", "10 月に金額の打ち間違いで差し戻しが 1 回あった（EG-112）", False)
  + '<div>' + lab("自分で項目を足す") + '<div style="display: grid; grid-template-columns: 1fr 120px; gap: 8px">' + field("確認すること（例：振込先が正しい）", True) + field("① 機械 ▾") + '</div><div style="font-size: 11px; color: %s; margin-top: 4px">① 機械：決まった調べ方で白黒つく ・ ② AI：別のセッションが根拠つきで判定 ・ ③ 人：人が見て決める</div></div>' % MUTED
  + '<div style="display: flex; gap: 8px; align-items: center; background: #F7F8FA; border-radius: 8px; padding: 8px 10px; font-size: 12px">' + check("", False).replace('padding: 4px 0', 'padding: 0') + '<span>足した項目を業務の型「請求書を作る」にも入れる（次から最初から入る）</span></div>')
  + mfoot(btn("やめる", "", "TicketDetail.dc.html"), btn("2 つ足して確認を流す", "p", "StRunning.dc.html"), left='<span style="font-size: 12px; color: %s">足すと本文の版が上がり、確認がやり直される</span>' % MUTED), 640, "抜けを点検する")
save("TdCheck.dc.html", "抜けを点検する", s)
