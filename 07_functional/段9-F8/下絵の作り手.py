#!/usr/bin/env python3
"""段 9（F8 渡す・配る）の下絵を 1 枚の HTML に作る（導線と配置だけ・静的・絵は入れない）。

使い方：python3 07_functional/段9-F8/下絵の作り手.py <出す先.html> [<出す先 2.html> ...]
- 2026-11-20：この手描きの版（07_functional/段9-F8/下絵-手描き.html）は、本番の部品で作り直した下絵（/dev/mock/f8・頁は 下絵の頁を作る.py）に替えた。残すのは前の版の控え
- 色・字・余白は下絵用の灰色で、製品の正本（DESIGN-kaname.md）の値ではない。詳細のモックは本番の部品で /dev/mock/f8 に作る（W0 の葉）
- 画面に出る文は全部「仮」。決めるのは代表（.ticket-flow/side-notes/段9-代表に聞くこと.md）
- まだ使えない物（複製・AI と話す・ほかの操作・やり取り）は、隠さずグレーで押せない形で描く（answer=78cb822fc1f1）
"""
from __future__ import annotations

import html
import sys

E = html.escape

CSS = """
*{box-sizing:border-box}
body{font-family:system-ui,-apple-system,'Hiragino Sans',sans-serif;margin:24px;background:#f4f5f8;color:#1b2030;font-size:14px;line-height:1.6}
h1{font-size:20px;margin:0 0 8px}
h2{font-size:16px;margin:0 0 4px}
h3{font-size:14px;margin:26px 0 10px;padding:6px 10px;background:#22345c;color:#fff;border-radius:6px}
p{margin:0 0 10px;max-width:1100px}
small{color:#667;font-weight:400}
section{background:#fff;border-radius:10px;padding:16px;margin:0 0 18px}
.meta{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 10px;font-size:12px}
.meta span{background:#eef1f6;border-radius:99px;padding:1px 10px;color:#3b4660}
.meta .ps{background:#e3efe6;color:#215a35}
.meta .q{background:#fdeed3;color:#7a4b00}
.meta .dep{background:#f6e3e3;color:#8a2020}
.note{font-size:12px;color:#556;margin:8px 0 0;max-width:1100px}
.r{display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap}
figure{margin:0}
figcaption{font-size:12px;color:#667;margin-top:4px}
/* 枠 */
.desk{width:640px;height:470px;border:1px solid #c9cfda;border-radius:6px;background:#fff;display:flex;position:relative;overflow:hidden;font-size:11px;line-height:1.45}
.phone{width:236px;height:470px;border:1px solid #c9cfda;border-radius:14px;background:#fff;position:relative;overflow:hidden;font-size:11px;line-height:1.45;display:flex;flex-direction:column}
.nav{width:92px;background:#edf0f4;border-right:1px solid #dde2e9;padding:8px 6px;flex:none}
.nav div{padding:3px 6px;border-radius:5px;color:#4a5563;white-space:nowrap}
.nav .btn{font-size:10px;padding:1px 4px}
.nav .on{background:#fff;color:#131b27;font-weight:600}
.nav b{float:right;background:#22345c;color:#fff;border-radius:99px;padding:0 5px;font-weight:500;font-size:10px}
.main{flex:1;min-width:0;padding:8px 10px;overflow:hidden}
.side{width:150px;border-left:1px solid #dde2e9;padding:8px;flex:none;background:#fafbfc}
.crumb{color:#6b7585;margin-bottom:4px}
.bar{height:26px;border-bottom:1px solid #dde2e9;display:flex;align-items:center;gap:6px;padding:0 8px;flex:none;color:#4a5563}
.tabs{height:30px;border-top:1px solid #dde2e9;display:flex;justify-content:space-around;align-items:center;color:#6b7585;flex:none;margin-top:auto;background:#fff}
.tabs b{color:#22345c}
.pbody{padding:8px;flex:1;min-height:0;overflow:hidden}
.ttl{font-size:13px;font-weight:600;margin:2px 0 4px}
.chip{display:inline-block;border-radius:4px;padding:0 6px;background:#e8ecf3;color:#33415c;margin-right:4px;white-space:nowrap}
.chip.warn{background:#fdeed3;color:#7a4b00}
.chip.ok{background:#e3efe6;color:#215a35}
.chip.bad{background:#f6e3e3;color:#8a2020}
.btn{display:inline-block;border:1px solid #9aa5b8;border-radius:5px;padding:1px 8px;margin:2px 3px 2px 0;background:#fff;white-space:nowrap}
.btn.p{background:#22345c;border-color:#22345c;color:#fff}
.btn.d{border-color:#b91c1c;color:#b91c1c}
.btn.off{color:#a9b1bf;border-color:#d5dae3;background:#f4f5f8}
.band{border:1px solid #c9cfda;border-left:4px solid #22345c;border-radius:5px;padding:5px 8px;margin:4px 0 6px;background:#f7f8fb}
.band.warn{border-left-color:#b45309;background:#fff8ec}
.band.bad{border-left-color:#b91c1c;background:#fdf3f3}
.band.ok{border-left-color:#186f69;background:#eef7f4}
.ln{height:7px;border-radius:3px;background:#e6e9ef;margin:5px 0}
.ln.s{width:60%}
.sec{color:#6b7585;margin:6px 0 2px;font-size:10px}
.kv{display:flex;justify-content:space-between;gap:6px;padding:2px 0;border-bottom:1px dashed #e3e7ee}
.kv span:first-child{color:#6b7585;flex:none}
.hl{outline:2px solid #e0863a;outline-offset:1px;border-radius:4px}
table{border-collapse:collapse;width:100%}
th,td{border-bottom:1px solid #e3e7ee;padding:3px 4px;text-align:left;vertical-align:top}
th{color:#6b7585;font-weight:500;font-size:10px}
.veil{position:absolute;inset:0;background:rgba(19,27,39,.38)}
.dlg{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:340px;max-height:452px;background:#fff;border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.25);display:flex;flex-direction:column}
.sheet{position:absolute;left:0;right:0;bottom:0;max-height:430px;background:#fff;border-radius:12px 12px 0 0;box-shadow:0 -6px 22px rgba(0,0,0,.22);display:flex;flex-direction:column}
.dh{padding:7px 10px;border-bottom:1px solid #e3e7ee;font-weight:600;display:flex;justify-content:space-between;flex:none}
.db{padding:7px 10px;overflow:hidden;flex:1;min-height:0}
.df{padding:6px 10px;border-top:1px solid #e3e7ee;text-align:right;flex:none}
.f{margin:0 0 5px}
.f label{display:block;color:#4a5563;font-size:10px}
.f label i{font-style:normal;color:#b91c1c;margin-left:4px}
.in{border:1px solid #c0c7d4;border-radius:4px;padding:2px 6px;min-height:18px;background:#fff}
.in.err{border-color:#b91c1c}
.em{color:#b91c1c;font-size:10px}
.ck{display:block;padding:1px 0}
.pop{position:absolute;right:12px;top:74px;width:210px;background:#fff;border:1px solid #c9cfda;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.18);padding:6px}
.opt{display:flex;justify-content:space-between;padding:3px 6px;border-radius:5px}
.opt.on{background:#f1f3f6}
.opt.off{color:#a9b1bf}
.toast{position:absolute;right:10px;bottom:10px;background:#131b27;color:#fff;border-radius:6px;padding:4px 10px}
.phone .toast{left:10px;bottom:40px}
.card{border:1px solid #dde2e9;border-radius:6px;padding:5px 7px;margin:0 0 6px}
ul.k{margin:4px 0 10px;padding-left:20px;max-width:1100px}
"""

NAV_ITEMS = ["チケット", "承認待ち", "高本のAI", "ナレッジ", "取引先", "管理"]


def nav(on: str, count: int = 0) -> str:
    out = ['<div class="nav"><div style="font-weight:600;color:#131b27">ENGINE BASE</div><div class="btn" style="margin:4px 0">＋ チケットを作る</div>']
    for n in NAV_ITEMS:
        badge = f"<b>{count}</b>" if n == "承認待ち" and count else ""
        out.append(f'<div class="{"on" if n == on else ""}">{n}{badge}</div>')
    out.append("</div>")
    return "".join(out)


def tabs(on: str, count: int = 0) -> str:
    items = ["チケット", "承認", "＋", "AI", "メニュー"]
    return '<div class="tabs">' + "".join(
        f"<{'b' if i == on else 'span'}>{i}{f'({count})' if i == '承認' and count else ''}</{'b' if i == on else 'span'}>" for i in items
    ) + "</div>"


OFF = '<span class="btn off" title="まだ使えません">複製</span><span class="btn off">高本のAI と話す</span><span class="btn off">…</span>'


def detail_main(band: str = "", who: str = "高本", stage: str = "作業中", extra_btn: str = "") -> str:
    return (
        '<div class="crumb">営業 › 一覧 › EG-119</div>'
        f'<div><span class="chip">タスク</span>EG-119　期限 11/05　<span class="chip">{stage}</span></div>'
        '<div class="ttl">問い合わせ（山田様）に一次返信する</div>'
        f"<div>{extra_btn}{OFF}</div>{band}"
        '<div class="sec">目的</div><div class="ln"></div><div class="ln s"></div>'
        '<div class="sec">完了の条件</div><div class="ln"></div><div class="ln s"></div><div class="ln"></div>'
    )


def detail_side(assignee: str) -> str:
    return (
        '<div class="side"><div><b>属性</b>　<span style="color:#a9b1bf">やり取り</span></div>'
        f'<div class="sec">担当</div><div class="kv"><span>担当者</span><span>{assignee}</span></div>'
        '<div class="kv"><span>承認する人</span><span>高本</span></div>'
        '<div class="sec">日付と時間</div><div class="kv"><span>期限</span><span>11/05（木）</span></div>'
        '<div class="sec">分類</div><div class="kv"><span>グループ</span><span>営業（EG）</span></div>'
        '<div class="kv"><span>親</span><span></span></div></div>'
    )


def desk(main: str, side: str = "", over: str = "", on: str = "チケット", count: int = 0) -> str:
    return f'<div class="desk">{nav(on, count)}<div class="main">{main}</div>{side}{over}</div>'


def phone(body: str, over: str = "", on: str = "チケット", count: int = 0, title: str = "営業 › EG-119") -> str:
    return f'<div class="phone"><div class="bar"><b>E</b> {title}<span style="margin-left:auto">🔍 🔔 高</span></div><div class="pbody">{body}</div>{tabs(on, count)}{over}</div>'


def phone_detail(band: str = "", assignee: str = "高本", extra: str = "") -> str:
    return (
        '<div class="ttl">問い合わせ（山田様）に一次返信する</div>'
        f"{band}"
        f'<div class="kv"><span>状態</span><span>作業中</span></div><div class="kv"><span>担当者</span><span>{assignee}</span></div>'
        f'<div class="kv"><span>期限</span><span>11/05</span></div>{extra}'
        '<div class="sec">目的</div><div class="ln"></div><div class="ln s"></div>'
    )


def dlg(title: str, body: str, foot: str, sheet: bool = False) -> str:
    cls = "sheet" if sheet else "dlg"
    return f'<div class="veil"></div><div class="{cls}"><div class="dh"><span>{title}</span><span>×</span></div><div class="db">{body}</div><div class="df">{foot}</div></div>'


def fld(label: str, value: str = "", req: bool = False, err: str = "") -> str:
    r = "<i>必須</i>" if req else ""
    e = f'<div class="em">{err}</div>' if err else ""
    return f'<div class="f"><label>{label}{r}</label><div class="in{" err" if err else ""}">{value}</div>{e}</div>'


def fig(d: str, p: str) -> str:
    return f'<div class="r"><figure>{p}<figcaption>375</figcaption></figure><figure>{d}<figcaption>1440</figcaption></figure></div>'


def state(no: int, sid: str, title: str, ps: str, acts: str, role: str, d: str, p: str, note: str = "", q: str = "", dep: str = "") -> str:
    meta = f'<span class="ps">時点：{E(ps)}</span><span>行為：{E(acts)}</span><span>見る人：{E(role)}</span>'
    if q:
        meta += f'<span class="q">聞くこと：{E(q)}</span>'
    if dep:
        meta += f'<span class="dep">前提：{E(dep)}</span>'
    n = f'<p class="note">{note}</p>' if note else ""
    return f'<section id="{sid}"><h2>{no}. {E(title)} <small>{sid}</small></h2><div class="meta">{meta}</div>{fig(d, p)}{n}</section>'


# ---------------------------------------------------------------- 部品（文は全部仮）
A_OWN = '<span class="hl">高本 ▾</span>'
PASS_BODY = (
    '<div style="color:#6b7585">EG-119 問い合わせ（山田様）に一次返信する</div>'
    + fld("渡す相手", "佐藤 花子（営業）・今週 9 件")
    + fld("理由", "先方と面識があるので、佐藤さんから返したほうが早い", req=True)
    + fld("お願い", "今日中に一次返信だけお願いします")
    + fld("返事の期限", "11/03（火）18:00")
    + '<div class="sec">一緒に切り替えるもの（ワークスペースの決まり）</div>'
    '<label class="ck">☑ 子チケット 2 件も渡す</label><label class="ck">☐ 関連のチケット 1 件も渡す</label>'
    '<label class="ck">☑ グループを「営業」から「営業（サポート）」に移す <span class="chip">いつも</span></label>'
    '<label class="ck">☐ 上の層（マネージャー）にも知らせる</label>'
    '<div style="color:#6b7585;margin-top:3px">相手が受けるまで担当者はあなたのまま（渡し中）。断られたら理由つきで戻ってきます。</div>'
)
PASS_FOOT = '<span class="btn">やめる</span><span class="btn p">渡す</span>'
PICK = (
    '<div class="pop"><div class="in" style="margin-bottom:4px;color:#8a93a3">名前で探す</div><div class="sec">担当者</div>'
    '<div class="opt on"><span>高本 聖斗（自分）</span><span>今週 7 件 ✓</span></div>'
    '<div class="opt"><span>鈴木 一郎</span><span>今週 4 件</span></div>'
    '<div class="opt"><span>佐藤 花子・マネージャー</span><span>今週 9 件</span></div>'
    '<div class="opt off"><span>田中 美咲（止まっている）</span><span>選べません</span></div>'
    '<div style="color:#6b7585;padding:4px 6px 0">別の人を選ぶと「引き継いでもらう」が開きます</div></div>'
)
BAND_SENDER = (
    '<div class="band"><b>佐藤さんの返事を待っています（渡し中）</b><br>理由：先方と面識がある ・ 返事の期限 11/03 18:00 ・ 子 2 件も一緒に<br>'
    '担当者はあなたのままです。<span class="btn">催促する</span><span class="btn">取り消す</span><span class="btn">別の人にする</span></div>'
)
BAND_RECIP = (
    '<div class="band"><b>高本さんから、引き継いでほしいと頼まれています</b><br>理由：先方と面識があるので、佐藤さんから返したほうが早い<br>'
    'お願い：今日中に一次返信だけお願いします ・ 返事の期限 11/03 18:00<br>一緒に来るもの：子チケット 2 件・グループを営業（サポート）へ<br>'
    '<span class="btn p">受ける</span><span class="btn">断る</span></div>'
)
QUEUE_HEAD = '<div class="ttl">承認待ち　<small>あなたが決めるもの 3 件</small></div><div><span class="chip">すべて 3</span><span class="chip">AI の成果物 1</span><span class="chip hl">渡された 2</span><span class="chip">判断を仰がれた 0</span></div>'


def qrow(kind: str, no: str, title: str, sub: str, who: str, due: str, a1: str, a2: str, hl: bool = False) -> str:
    c = ' class="hl"' if hl else ""
    return f'<tr{c}><td><span class="chip">{kind}</span></td><td>{no}</td><td>{title}<br><span style="color:#6b7585">{sub}</span></td><td>{who}</td><td>{due}</td><td><span class="btn">{a2}</span><span class="btn p">{a1}</span></td></tr>'


def queue(rows: str) -> str:
    return QUEUE_HEAD + "<table><tr><th>決めること</th><th>番号</th><th>題名</th><th>誰から</th><th>期限</th><th>その場で決める</th></tr>" + rows + "</table>"


def qcard(kind: str, no: str, title: str, sub: str, a1: str, a2: str) -> str:
    return f'<div class="card"><span class="chip">{kind}</span>{no}<br><b>{title}</b><br><span style="color:#6b7585">{sub}</span><br><span class="btn">{a2}</span><span class="btn p">{a1}</span></div>'


ROW_AI = qrow("AI の成果物", "EG-128", "セイコー様へ 11月分の請求書を送る", "承認するとメールを送る", "高本のAI", "11/01", "中身を見る", "差し戻す")
ROW_PASS = qrow("渡された", "EG-119", "問い合わせ（山田様）に一次返信する", "理由：先方と面識がある ・ 返事の期限 11/03", "高本", "11/03", "受ける", "断る", hl=True)
ROW_PASS2 = qrow("渡された", "JD-190", "【親】京蟻 v2.1 リリース", "子 8 件も一緒に ・ 返事の期限 11/16", "鈴木", "11/16", "受ける", "断る")


def build() -> str:
    s: list[str] = []
    n = 0

    def add(*a: str, **k: str) -> None:
        nonlocal n
        n += 1
        s.append(state(n, *a, **k))

    s.append("<h3>束 A　横に渡す（引き継いでもらう → 受ける／断る）— 先に切って作れる</h3>")
    add("f8-detail-owner", "詳細：担当者が見る（入口は右の「担当者 ▾」）", "PS0 から（PC が無くても出る・チケットが 1 本在れば）", "A51", "担当者（R2・R3）",
        desk(detail_main(), detail_side(A_OWN)),
        phone(phone_detail(assignee=A_OWN)),
        note="入口はキャンバスの「担当者を変える」（TdAssignee）の位置。題名の右の 複製・AI と話す・「…」は今の本線と同じく、まだ使えない物としてグレーで出したまま。",
        q="1（入口）")
    add("f8-pick", "相手を選ぶ（人の一覧・今週の件数・選べない人）", "PS0 から", "A51", "担当者",
        desk(detail_main(), detail_side(A_OWN), PICK),
        phone(phone_detail(assignee=A_OWN), dlg("担当者", '<div class="opt on"><span>高本 聖斗（自分）</span><span>今週 7 件 ✓</span></div><div class="opt"><span>鈴木 一郎</span><span>今週 4 件</span></div><div class="opt"><span>佐藤 花子・マネージャー</span><span>今週 9 件</span></div><div class="opt off"><span>田中 美咲（止まっている）</span><span>選べません</span></div>', '<span class="btn">やめる</span>', sheet=True)),
        note="キャンバス TdAssignee のとおり、相手の今の負荷（今週の件数・D-061）を横に出す。止まっている人・招待中の人・閲覧のみ・取引先は選べない形で出す。キャンバスに在る「実行を分身に任せる」の切り替えは F5 の物なので、この小窓には F8 では足さない（在る場所はそのまま）。",
        q="1・2・14（今週の件数の数え方）")
    add("f8-pass", "引き継いでもらうの小窓（キャンバス StModal）", "PS0 から", "A51", "担当者",
        desk(detail_main(), detail_side(A_OWN), dlg("引き継いでもらう", PASS_BODY, PASS_FOOT)),
        phone(phone_detail(assignee=A_OWN), dlg("引き継いでもらう", PASS_BODY, PASS_FOOT, sheet=True)),
        note="キャンバスの絵のとおり：相手・理由（必須）・お願い・返事の期限（既定は 1 営業日・D-125.89）・一緒に切り替えるもの（ワークスペースの決まり：毎回聞く＝選べる／いつも＝印が付いて外せない／しない＝出さない・D-125.71）・上の層にも知らせる。スマホは下からのシートで、ボタンの行はいつも見える。",
        q="3（1 営業日の数え方）・9（上の層とは誰か）・10（子・関連のどれを移すか）・20（ボタンの名前）")
    err_body = (fld("渡す相手", "田中 美咲（営業）", err="田中さんは今は選べません（止まっています）。別の人を選んでください")
                + fld("理由", "", req=True, err="理由を書いてください") + fld("お願い", "") + fld("返事の期限", "11/01（日）09:00", err="返事の期限は今より後にしてください"))
    add("f8-pass-error", "小窓：入力の誤り（理由が空・期限が過去・相手が選べなくなった）", "PS0 から", "A51", "担当者",
        desk(detail_main(), detail_side(A_OWN), dlg("引き継いでもらう", err_body, PASS_FOOT)),
        phone(phone_detail(assignee=A_OWN), dlg("引き継いでもらう", err_body, PASS_FOOT, sheet=True)),
        note="口が断ったとき（もう渡し中・チケットが完了した・相手が抜けた・送りすぎ・調子が悪い）は、小窓の上に赤の知らせを出し、書いた中身は消さない。",
        q="19（待っている渡しは同時に 1 つだけ）")
    add("f8-waiting-sender", "詳細：渡し中の帯（渡した人）", "PS0 から", "A51・D-125.88・D-125.89", "渡した人",
        desk(detail_main(BAND_SENDER), detail_side("高本 → 佐藤（渡し中）")),
        phone(phone_detail(BAND_SENDER, assignee="高本（渡し中）")),
        note="担当者はまだ渡した人（D-125.88）。帯は承認の帯と同じ場所（題名のすぐ下）。押せるのは 催促する・取り消す・別の人にする（D-125.89 の 3 つ）。渡した直後は右下に「佐藤さんに渡しました」の小さな知らせ。",
        q="4（渡し中にできること）・5（AI が動いているチケット）・7（催促の回数）")
    add("f8-queue", "承認待ち：渡された行（受ける／断る）", "PS0 から（渡しが 1 件在れば）", "A110・D-128.36", "渡された人",
        desk(queue(ROW_AI + ROW_PASS + ROW_PASS2), on="承認待ち", count=3),
        phone('<div class="ttl">承認　3 件</div>' + qcard("渡された", "EG-119", "問い合わせ（山田様）に一次返信する", "高本さんから ・ 返事の期限 11/03", "受ける", "断る") + qcard("渡された", "JD-190", "【親】京蟻 v2.1 リリース", "鈴木さんから ・ 子 8 件も一緒に", "受ける", "断る"), on="承認", count=3, title="承認"),
        note="キャンバス Approvals の行のとおり。左のメニューとスマホの下のタブの数に、渡されたものも入る。絞り込みの 6 つ・「続けて裁く」「まとめて承認」は今の本線と同じく押せない形のまま（F5・F9 の物）。「渡された」の絞り込みだけ先に押せるようにするかは聞くこと 13。",
        q="12（「自分に関わるもの」に出すか）・13（絞り込み）・18（知らせの届け方）")
    add("f8-waiting-recipient", "詳細：渡されています の帯（渡された人）", "PS0 から", "A110・D-128.115", "渡された人",
        desk(detail_main(BAND_RECIP), detail_side("高本 → あなた（返事待ち）"), on="チケット", count=3),
        phone(phone_detail(BAND_RECIP, assignee="高本（あなたの返事待ち）"), count=3),
        note="渡された人は、答えるまでそのチケットを読める（グループの外でも・D-128.115）。帯に 理由・お願い・一緒に来るもの を出す（D-128.34）。")
    dec = fld("断る理由", "今週は月次の締めで手が空きません", req=True) + '<div style="color:#6b7585">理由は高本さんに届き、チケットの記録に残ります（D-125.90）。</div>'
    add("f8-decline", "断る小窓（理由が必須）", "PS0 から", "A110・D-125.90", "渡された人",
        desk(queue(ROW_AI + ROW_PASS + ROW_PASS2), over=dlg("断る", dec, '<span class="btn">やめる</span><span class="btn d">断る</span>'), on="承認待ち", count=3),
        phone(phone_detail(BAND_RECIP), dlg("断る", dec, '<span class="btn">やめる</span><span class="btn d">断る</span>', sheet=True), count=3),
        note="承認待ちの行からも、詳細の帯からも同じ小窓。理由が空なら「理由を書いてください」。")
    ok_band = '<div class="band ok"><b>担当者になりました</b>（高本さんから引き継ぎ・11/02 10:12）　子チケット 2 件も一緒に移りました ・ グループは営業（サポート）</div>'
    add("f8-accepted", "受けた後（担当者が替わる・一緒に切り替わる）", "PS0 から（AI は PS1 から）", "A110・D-125.87・D-125.70・D-125.156", "新しい担当者／渡した人",
        desk(detail_main(ok_band) + '<div class="toast">引き継ぎました</div>', detail_side("佐藤")),
        phone(phone_detail('<div class="band ok"><b>佐藤さんが引き継ぎました</b>（11/02 10:12）</div>', assignee="佐藤") + '<div class="toast">佐藤さんが受けました</div>'),
        note="左：受けた人の画面（担当者＝佐藤・番号 EG-119 はそのまま・D-125.60）。右のスマホ：渡した人の画面（読めるが担当者ではない・D-125.15）。この後に AI に任せると動くのは新しい担当者の AI（D-125.156）。",
        q="6（受けた帯をいつ消すか）")
    add("f8-declined-sender", "断られた帯（渡した人）", "PS0 から", "A110・D-125.90", "渡した人",
        desk(detail_main('<div class="band bad"><b>佐藤さんに断られました</b>（11/02 10:12）<br>理由：今週は月次の締めで手が空きません<br><span class="btn">別の人にする</span><span class="btn">閉じる</span></div>'), detail_side("高本")),
        phone(phone_detail('<div class="band bad"><b>佐藤さんに断られました</b><br>理由：今週は月次の締めで手が空きません<br><span class="btn">別の人にする</span><span class="btn">閉じる</span></div>')),
        note="担当者は渡した人のまま。理由は渡しの記録に残る。「別の人にする」は相手を選ぶ小窓（2）を開き、理由とお願いは前の中身を入れた形で始める。",
        q="6（帯をいつ消すか）")
    add("f8-overdue", "返事の期限が過ぎた（渡した人）", "PS0 から", "D-125.89", "渡した人",
        desk(detail_main('<div class="band warn"><b>佐藤さんの返事がまだありません</b>（返事の期限 11/03 18:00 を過ぎました）<br><span class="btn p">催促する</span><span class="btn">取り消す</span><span class="btn">別の人にする</span></div>'), detail_side("高本 → 佐藤（渡し中）")),
        phone(phone_detail('<div class="band warn"><b>佐藤さんの返事がまだありません</b><br>返事の期限 11/03 18:00 を過ぎました<br><span class="btn p">催促する</span><span class="btn">取り消す</span><span class="btn">別の人にする</span></div>')),
        note="期限を過ぎても、相手は受ける／断るを押せる。渡した人への知らせをいつ・どう届けるかは聞くこと 8。",
        q="7（催促）・8（期限切れの知らせの届け方）")
    wd = '<div>佐藤さんへの渡しを取り消します。担当者はあなたのままです。佐藤さんに「取り消されました」と知らせます。</div>'
    add("f8-withdraw", "取り消す確かめ", "PS0 から", "D-125.89", "渡した人",
        desk(detail_main(BAND_SENDER), detail_side("高本 → 佐藤（渡し中）"), dlg("渡しを取り消しますか？", wd, '<span class="btn">やめる</span><span class="btn d">取り消す</span>')),
        phone(phone_detail(BAND_SENDER), dlg("渡しを取り消しますか？", wd, '<span class="btn">やめる</span><span class="btn d">取り消す</span>', sheet=True)))
    add("f8-gone", "もう決まっている・取り消された渡しを開いた（古い知らせ・二度押し・別のタブ）", "PS0 から", "A110", "渡された人",
        desk(queue(ROW_AI + ROW_PASS2) + '<div class="band warn" style="margin-top:6px"><b>この渡しは取り消されました</b>（高本さんが 11/02 11:40 に取り消し）。一覧を読み直しました。</div>', on="承認待ち", count=2),
        phone(phone_detail('<div class="band warn"><b>この渡しは取り消されました</b><br>あなたが答える必要はなくなりました</div>'), count=2),
        note="受ける／断るを押したときに、もう決まっていた・取り消されていた・チケットが完了していた・消されていた のどれでも、何も変えずにその訳を出して一覧を読み直す。グループの外の人は、この後はチケットを読めなくなる（D-128.115）。")
    offer_btn = '<span class="btn hl">引き継ぐ（申し出る）</span>'
    of = fld("理由", "手が空いたので、こちらで返します", req=True) + '<div style="color:#6b7585">担当者（高本さん）が「渡す」と答えたら、あなたが担当者になります（D-125.94）。</div>'
    add("f8-offer", "引き継ぐ（引き取りを申し出る）", "PS0 から", "A48・D-125.94", "担当者でない人（R2・R3）",
        desk(detail_main(extra_btn=offer_btn), detail_side("高本"), dlg("引き継ぎを申し出る", of, '<span class="btn">やめる</span><span class="btn p">申し出る</span>')),
        phone(phone_detail(extra=offer_btn), dlg("引き継ぎを申し出る", of, '<span class="btn">やめる</span><span class="btn p">申し出る</span>', sheet=True)),
        note="担当者でない人の詳細にだけ出る。同じグループの人と、別のグループでも権限のある人（D-125.94）。画面の言葉は「引き継ぐ」（D-070）。入口の場所は聞くこと 11。",
        q="11（申し出の入口・誰が・どこに出るか）")
    add("f8-offer-answer", "申し出を受けた担当者（渡す／断る）", "PS0 から", "A48・A110", "今の担当者",
        desk(queue(ROW_AI + qrow("渡された", "EG-119", "問い合わせ（山田様）に一次返信する", "鈴木さんが引き継ぎを申し出ています ・ 理由：手が空いた", "鈴木", "—", "渡す", "断る", hl=True)), on="承認待ち", count=2),
        phone(phone_detail('<div class="band"><b>鈴木さんが、引き継ぎを申し出ています</b><br>理由：手が空いたので、こちらで返します<br><span class="btn p">渡す</span><span class="btn">断る</span></div>'), count=2),
        note="答えるのは今の担当者。「渡す」で担当者が申し出た人に移る。断るときは理由が必須。",
        q="11")

    s.append("<h3>束 B　上から配る（人へ・グループへ）— 口は作れる。グループをまたぐ形は 2 つ目のグループを作る画面（F9）と権限の画面（F10）の後に人が確かめられる</h3>")
    dist = (fld("配る先", "◉ 人：鈴木 一郎（営業）・今週 4 件　　○ グループ：受託開発")
            + fld("理由", "来週の展示会の準備を優先してもらうため", req=True) + fld("お願い", "")
            + '<div style="color:#6b7585">営業は「合意なしで配る」決まりです。配るとすぐ鈴木さんが担当者になり、知らせが届きます（D-125.91）。</div>')
    add("f8-distribute", "配る小窓（マネージャー）", "PS0 から", "A111・D-125.91・D-125.92", "マネージャー（R2）",
        desk(detail_main(), detail_side('<span class="hl">高本 ▾</span>'), dlg("配る", dist, '<span class="btn">やめる</span><span class="btn p">配る</span>')),
        phone(phone_detail(assignee=A_OWN), dlg("配る", dist, '<span class="btn">やめる</span><span class="btn p">配る</span>', sheet=True)),
        note="入口は同じ「担当者 ▾」。そのグループで配る権限を持つ人が、自分が担当者でないチケットの相手を選ぶと「配る」になる（聞くこと 2）。合意を取る層では、配った後は渡し中と同じ流れ。",
        q="2・15（合意の設定）",
        dep="役割を変える画面（F10）")
    add("f8-distributed", "配られた人（合意なし：すぐ担当者）", "PS0 から", "A111", "配られた人（R3）",
        desk(detail_main('<div class="band ok"><b>高本さんから配られました</b>（11/02 10:12）　理由：来週の展示会の準備を優先してもらうため</div>'), detail_side("鈴木")),
        phone(phone_detail('<div class="band ok"><b>高本さんから配られました</b><br>理由：来週の展示会の準備を優先してもらうため</div>', assignee="鈴木")),
        note="合意なしのときは承認待ちには出ない（決めることが無い）。知らせだけ届く。完了したら配った人に自動で知らせる（D-125.99）。")
    add("f8-group", "グループに配られたチケット（担当を決める・引き取る）", "PS0 から", "A111・D-125.92・D-125.118", "そのグループで権限を持つ人",
        desk(queue(ROW_AI + qrow("渡された", "EG-140", "展示会の来場者に礼状を送る", "グループ「受託開発」に配られました ・ 担当者を決めてください", "高本", "11/10", "自分が持つ", "人を決める", hl=True)), on="承認待ち", count=2),
        phone('<div class="ttl">承認　2 件</div>' + qcard("渡された", "EG-140", "展示会の来場者に礼状を送る", "グループ「受託開発」に配られました", "自分が持つ", "人を決める"), on="承認", count=2, title="承認"),
        note="人を決めずにグループへ配れる（D-125.92）。そのグループで権限を持つ人が担当を決める・引き取る（D-125.118）。決まるまでの担当者を誰にするかは聞くこと 16。",
        q="16（担当者のいない間）",
        dep="2 つ目のグループを作る画面（F9）")

    s.append("<h3>束 C　上へ上げる（判断を仰ぐ・上位の承認・詰まっています）— 前提の段がまだ無いので、形だけ。詳細は後で</h3>")
    esc = ('<label class="ck">◉ 判断を仰ぐ（上の人宛ての QA の子チケットを作る・D-125.93）</label>'
           '<label class="ck">○ 上位の承認も要る、と付ける（D-128.87）</label>'
           '<label class="ck">○ 詰まっています、と知らせる（D-125.97）</label>'
           + fld("上げる相手", "佐藤 花子（営業のマネージャー）") + fld("聞きたいこと", "保守の範囲にログの保管は入りますか", req=True))
    add("f8-escalate", "上へ上げる（仮の形）", "PS0 から", "A112・D-125.93・D-125.96・D-125.97・D-128.87", "担当者（R3）",
        desk(detail_main(extra_btn='<span class="btn hl">上へ上げる</span>'), detail_side("高本"), dlg("上へ上げる", esc, '<span class="btn">やめる</span><span class="btn p">上げる</span>')),
        phone(phone_detail(extra='<span class="btn hl">上へ上げる</span>'), dlg("上へ上げる", esc, '<span class="btn">やめる</span><span class="btn p">上げる</span>', sheet=True)),
        note="この束は、上位の承認の段（F5 の残り）・決定とやり取り（F6）・上に回す決まりと詰まりの日数（F9）・上の人を決める画面（F10）が無いと最後まで通らない。段 9 では切らず、それらの段を切るときに一緒に詰めるのが勧め（聞くこと 0）。",
        q="0（範囲）",
        dep="F5 の残り・F6・F9・F10")

    s.append("<h3>共通</h3>")
    add("f8-noperm", "渡す権限の無い人が見たとき（閲覧のみ・取引先）", "PS0 から", "A51・A48", "閲覧のみ／取引先（R4）",
        desk(detail_main(), detail_side("高本")),
        phone(phone_detail()),
        note="閲覧のみの人と取引先には、担当者の「▾」も「引き継ぐ（申し出る）」も出さない（押せない物を出すのは「まだ作っていない物」だけ。権限で出ない物は主ナビと同じく出さない・screen-derivation §6）。",
        q="17（誰に何が出るか）")
    add("f8-failed", "読めない・送れない", "PS0 から", "A51・A110", "だれでも",
        desk(detail_main('<div class="band bad"><b>渡しの様子を読み込めませんでした</b>　<span class="btn">もう一度読む</span></div>'), detail_side("高本")),
        phone(phone_detail('<div class="band bad"><b>渡しの様子を読み込めませんでした</b><br><span class="btn">もう一度読む</span></div>')),
        note="詳細の本文は出したまま、帯の場所だけに出す（渡しの様子は別の口で同時に読むため）。送れなかったときは小窓を閉じず、書いた中身を残して赤の知らせ（正本の文 E-PAGE-…・E-LIM-005 を使う）。")
    return "".join(s)


HEAD = """<!DOCTYPE html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>段 9 渡す・配る 下絵</title><style>%s</style>
<h1>段 9（F8 渡す・配る）の下絵：導線と配置だけ</h1>
<p>切る段の最初の区切りの下絵です（2026-11-19・枝 c/段9）。<b>見るのは「どこから入り・何が出て・何を押すと次にどうなるか」だけ</b>で、色・字・余白は下絵用の灰色です。見た目の詳細は、代表の OK の後に、本番と同じ部品で <code>/dev/mock/f8</code> に作ります（段 2 からの決め）。画面に出る文は全部「仮」で、決まっていない所には橙の札「聞くこと：番号」を付けました（番号は <code>.ticket-flow/side-notes/段9-代表に聞くこと.md</code>）。</p>
<p><b>導線</b>：チケットの詳細の右「担当者 ▾」→ 相手を選ぶ → 「引き継いでもらう」の小窓 → 渡す →（渡した人）詳細に渡し中の帯／（渡された人）承認待ちに「渡された」の行と、詳細に帯 → 受ける＝担当者が替わる・断る＝理由つきで戻る。返事が無ければ、渡した人が 催促する・取り消す・別の人にする。</p>
<ul class="k"><li>緑の札＝製品の時点（flow.json の product_states）。渡す・受けるは PC をつないでいなくてもできる（D-127.8）ので、どれも PS0 から出る</li><li>橙の枠＝その状態で見てほしい所</li><li>グレーのボタン＝キャンバスに在るがまだ作っていない物（隠さず、押せない形で出す）</li><li>赤の札「前提」＝ほかの段の画面が無いと、人が実物で確かめられない物</li></ul>
""" % CSS


def main() -> None:
    doc = HEAD + build() + "</html>"
    for out in sys.argv[1:]:
        with open(out, "w", encoding="utf-8") as f:
            f.write(doc)
        print(out, len(doc))


if __name__ == "__main__":
    main()
