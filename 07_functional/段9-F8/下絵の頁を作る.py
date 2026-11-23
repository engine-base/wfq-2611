#!/usr/bin/env python3
"""段 9（F8 渡す・配る ＋ 前に出す招く葉）の下絵の頁を 1 枚の HTML に作る（本番と同じ部品のモックの写しを埋め込む）。

使い方：python3 07_functional/段9-F8/下絵の頁を作る.py <写しの置き場> <出す先.html> [<出す先 2.html> ...]
- 写しは 07_functional/段9-F8/mock-shots.mjs が撮った <id>-375.png・<id>-1440.png と measure.json（モックの置き場 /dev/mock/f8）
- 状態の並びと名前は apps/web/app/(dev)/dev/mock/f8/mocks.tsx の MOCKS（ここで手で並べない）
- 写しは JPEG に縮めて data: で埋め込み、頁を 15MB 以下にする
- 前の手描きの下絵は 07_functional/段9-F8/下絵-手描き.html（作り手は 下絵の作り手.py）
"""
from __future__ import annotations

import base64
import html
import io
import json
import re
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
MOCKS = ROOT / "apps/web/app/(dev)/dev/mock/f8/mocks.tsx"
LIMIT = 15 * 1024 * 1024
E = html.escape

# 状態ごとの「だれが・どこを押すと・何が起きるか」（1〜2 行）と、聞くことの番号
WHAT: dict[str, tuple[str, str]] = {
    "f8-detail-owner": ("担当者（高本）がチケットの詳細を開く。右のパネルの「担当者 高本 聖斗 ▾」が入口。押すと相手を選ぶ小窓が開く。", "1"),
    "f8-pick": ("担当者が「担当者 ▾」を押した。上の探す欄に名前かメールを打つと絞れる。人ごとに今週の件数とメール。止まっている人・招待中の人は「選べません」。人を押すと「引き継いでもらう」の小窓へ進む。", "1・2・14・17"),
    "f8-pick-search": ("探す欄に「suzuki」と打った。名前かメールに合う人だけが残る（大文字小文字・前後の空白は見ない）。", "直し 1"),
    "f8-pick-none": ("探す欄に合う人がいない。「「山田」に合う人がいません…」と出る。一覧を空にして黙らない。", "直し 1"),
    "f8-pass": ("担当者が佐藤さんを選んだ。理由（必須）・お願い・返事の期限（既定は次の平日 18:00）・一緒に切り替えるもの・上の層にも知らせる、を書いて「引き継いでもらう」を押す。", "3・9・10・20"),
    "f8-pass-error": ("押したが、理由が空・期限が過去・相手が止まった。欄ごとに赤い字が出て、書いた中身は残る。", "—"),
    "f8-pass-refused": ("押したが、口が断った（いま別の人の返事を待っている）。小窓の上に赤い知らせ。書いた中身は残る。", "19"),
    "f8-blocked": ("AI が動いている・承認を待っているチケットで「担当者 ▾」を押した。人は選べず「AI の実行（承認）が終わってから渡してください」と出る。", "5"),
    "f8-waiting-sender": ("渡した直後の渡した人の画面。題名の下に「佐藤さんの返事を待っています（渡し中）」の帯と、催促する・取り消す・別の人にする。担当者はまだ高本。完了にする・消すこともできる（そのときは渡しが取り消され相手に知らせる）。", "4・7"),
    "f8-reminded": ("渡した人が「催促する」を押した。佐藤さんにもう一度知らせが届く。同じ渡しは 1 日 1 回まで（2 回目は「今日はもう催促しました」）。", "7"),
    "f8-withdraw": ("渡した人が「取り消す」を押した。確かめの小窓。取り消すと担当者は高本のまま、佐藤さんに「取り消されました」と知らせる。", "20"),
    "f8-overdue": ("返事の期限を過ぎた。渡した人が Kaname を開いたときに帯が「返事がまだありません」に替わる（知らせとメールはそのとき 1 回）。佐藤さんは今からでも受ける・断るを押せる。", "8"),
    "f8-declined-sender": ("佐藤さんが断った後の渡した人の画面。理由が帯に出る。担当者は高本のまま。「別の人にする」で相手を選び直す（前の理由とお願いを入れた形で始める）。帯は「閉じる」まで残る。", "6"),
    "f8-taken-sender": ("佐藤さんが受けた後に、渡した人が詳細を開いた。担当者が佐藤に替わり、「佐藤さんが引き継ぎました」の帯（1 回だけ・次に開いたときは出ない）。高本は読めるが担当者ではない。", "6・直し 3"),
    "f8-queue": ("渡された人（佐藤）の承認待ち。PC は表の行、スマホは 1 件 1 枚のカード（番号の札とだれから・題名・中身の 1 行・返事の期限・断る／受ける）。左のメニューとスマホの下のタブの数にも入る。絞り込みの札は今の本線どおり押せない形（スマホは横に送る 1 列）。", "12・13・18・直し 2"),
    "f8-waiting-recipient": ("渡された人が行の題名を押して詳細を開いた。「高本さんから、引き継いでほしいと頼まれています」の帯に理由・お願い・一緒に来るもの。帯の「受ける」「断る」でも決められる。", "—"),
    "f8-decline": ("渡された人が「断る」を押した。理由は必須。理由は高本さんに届き、チケットの記録に残る。", "20"),
    "f8-accepted": ("渡された人が「受ける」を押した。担当者が佐藤になり「担当者になりました」の帯（1 回だけ・子チケットも一緒に移った）。小さな知らせは重ねない。この後 AI に任せると、佐藤さんの AI が動く。", "6・10・直し 3"),
    "f8-gone": ("もう取り消された（決まっていた・完了した・消された）渡しを古い知らせ・別のタブから開いた。何も変えずに訳を出し、承認待ちの行は消える。", "—"),
    "f8-offer-entry": ("担当者でない人（鈴木）が詳細を開くと、題名の下に「引き継ぐ（申し出る）」のボタン。担当者の欄は名前だけ（▾ は出ない）。", "2・11"),
    "f8-offer": ("鈴木さんが「引き継ぐ（申し出る）」を押した。理由（必須）を書いて「申し出る」。返事の期限は付けない（いつでも取り下げられる）。", "11"),
    "f8-offer-answer": ("担当者（高本）の承認待ちに、種類「渡された」で「鈴木さんが引き継ぎを申し出ています」の行。「渡す」で担当者が鈴木に替わる。「断る」は理由が必須。", "11"),
    "f8-offer-band": ("担当者が申し出のあるチケットの詳細を開いた。帯の「渡す」「断る」でも答えられる。", "11"),
    "f8-pick-manager": ("マネージャー（佐藤）が、ほかの人が担当のチケットで「担当者 ▾」を押した。選ぶと「配る」になる（相手の合意なし）と 1 行で出る。人のほかに、グループにも配れる。", "2・15"),
    "f8-distribute": ("マネージャーが鈴木さんを選んだ。理由（必須）・お願いを書いて「配る」。すぐ鈴木さんが担当者になり知らせが届く。", "15"),
    "f8-distribute-group": ("マネージャーがグループ「受託開発」を選んだ。そのグループの人が担当を決めるまで、担当者はマネージャーのまま。", "16"),
    "f8-distributed": ("配られた人（鈴木）の詳細。「佐藤さんから配られました」の帯と理由。合意なしなので承認待ちには出ない（知らせだけ）。", "15・18"),
    "f8-group-waiting": ("グループに配った後のマネージャーの画面。「グループ「受託開発」に配り中」の帯。取り消せる。", "16"),
    "f8-group": ("グループ「受託開発」の権限を持つ人の承認待ち。「人を決める」か「自分が持つ」を押すと担当者が移る。", "16"),
    "f8-noperm": ("閲覧のみの人（山口）が詳細を開いた。担当者は名前だけで「▾」も「引き継ぐ（申し出る）」も出ない（権限で使えない物は出さない）。", "17"),
    "f8-failed": ("渡しの様子を読む口が落ちた。帯の場所にだけ「読み込めませんでした」と「もう一度読む」。本文は読める。", "—"),
    "inv-members": ("管理者（高本）がワークスペースの管理 › メンバーを開く。PC はグループごとのカードに 1 人 1 行（丸いアイコン・名前とメール・役割・状態・操作）で本文の幅いっぱい。スマホは 1 人 1 行（丸いアイコン・名前とメール・役割の札）。右上の「＋ 招く」が入口。役割の ▾・「⋯」・＋ グループ・決まり／記録／設定は F10 の残りなのでグレー。", "招く・直し 5"),
    "inv-dialog": ("「＋ 招く」を押した。メールを入れて「足す」→ 下の「招く人」の並びに入る（何人でも）。グループと役割を選んで「招く」。ひとこととリンクは「ひとこと・リンクで招く」を開くと出る。", "招く・直し 6"),
    "inv-error": ("メールの形が違う・もう入っている人を入れた。並びの下に赤い字。書いた中身は残る。", "招く"),
    "inv-link": ("「ひとこと・リンクで招く」を開いて「招待のリンクを作る」を押した。7 日・1 回だけ使えるリンクが出てコピーできる。", "招く"),
    "inv-stepup": ("役割を「管理者」にして招こうとした。先に本人確認を取り直す（契約の決まり）。", "招く"),
    "inv-sent": ("招いた後。画面の下に「kimura@… に招待を送りました」の小さな知らせ（5 秒で消える）。並びには「招待中 ・ あと 7 日」の行が残る。相手は招待のメールから参加する（段 3 で作った画面）。", "招く・直し 3"),
}

# 確定した答え（代表の確認 2026-11-20 10:20 ごろ・「あとは OK」）。描いた状態は id で書き、番号は並びから出す
DECIDED = [
    ("0 範囲", "横に渡す（引き継いでもらう・受ける／断る・催促・取り消す・申し出）と、上から配るを今切る。上へ上げるは後。2 人目を入れるため、招く葉（F10）を前に出して先に作る", ["f8-detail-owner", "inv-members"]),
    ("1 入口", "詳細の右の「担当者 ▾」→ 相手を選ぶ小窓 → 引き継いでもらう小窓", ["f8-detail-owner", "f8-pick", "f8-pass"]),
    ("2 だれが選ぶと何になるか", "担当者本人＝「引き継いでもらう」（相手の合意）／マネージャーがほかの人のチケットで選ぶ＝「配る」（合意なし）／それ以外の人＝「引き継ぐ（申し出る）」だけ／担当者を黙って直に書き換える道は作らない", ["f8-pick", "f8-offer-entry", "f8-pick-manager", "f8-noperm"]),
    ("4 渡し中に渡した人ができること", "今までどおり全部できる。完了にする・消すときは、渡しを自動で取り消して相手に知らせる", ["f8-waiting-sender"]),
    ("5 AI が動いている・承認待ち", "渡せない。押すと「AI の実行（承認）が終わってから渡してください」と出る", ["f8-blocked"]),
    ("3", "返事の期限の既定は次の平日（土日を飛ばす）の 18:00。祝日は数えない。渡すときに直せる", ["f8-pass"]),
    ("6", "「断られました」は閉じるか別の人に渡すまで残す。「担当者になりました」「引き継ぎました」は 1 回だけ", ["f8-declined-sender", "f8-taken-sender", "f8-accepted"]),
    ("7", "催促は渡した人が押す。1 日 1 回まで。期限の前でも押せる。自動の催促はしない", ["f8-waiting-sender", "f8-reminded"]),
    ("8", "期限切れの知らせは、渡した人が Kaname を開いたときに 1 回（時間で動く仕組みは段 9 では作らない）", ["f8-overdue"]),
    ("9", "「上の層にも知らせる」は、そのグループで配る・承認する権限を持つ人全員。既定は印なし", ["f8-pass"]),
    ("10", "一緒に移すのは、渡す人が担当の子・孫だけ。グループは相手が入っていないときだけ「移す」を出す", ["f8-pass", "f8-accepted"]),
    ("11", "申し出：同じグループの人は誰でも。入口は題名の下のボタン。答えは担当者の承認待ちに「渡された」のまま「渡す／断る」。理由は必須。期限は付けない", ["f8-offer-entry", "f8-offer", "f8-offer-answer", "f8-offer-band"]),
    ("12", "自分が答える渡しは、一覧の「自分に関わるもの」には出さない", ["f8-queue"]),
    ("13", "承認待ちの絞り込みは段 9 では押せない形のまま。渡した側の「返事待ち」の札は作らない", ["f8-queue"]),
    ("14", "今週の件数＝その人が担当でまだ終わっていない、期限が今週（月〜日・日本時間）のチケットの数", ["f8-pick"]),
    ("15", "配るときの合意は、段 9 では既定（合意なし）だけを作る", ["f8-pick-manager", "f8-distribute", "f8-distributed"]),
    ("16", "グループに配った後、担当者が決まるまでは配った人のまま（「配り中」の帯）", ["f8-distribute-group", "f8-group-waiting", "f8-group"]),
    ("17", "閲覧のみ・取引先には「▾」も申し出も出さない。止まっている人・招待中の人は「選べません」", ["f8-pick", "f8-noperm"]),
    ("18", "知らせは受け箱の行＋メール（渡された・申し出・催促・断られた・期限切れ・配られた）。メールに理由とお願いは書かない", ["f8-queue", "f8-distributed"]),
    ("19", "待っている渡しは同時に 1 つだけ", ["f8-pass-refused"]),
    ("20", "ボタンの名前は「引き継いでもらう」。帯・確かめ・断るの文は下絵のとおり（仮）", ["f8-pass", "f8-waiting-sender", "f8-withdraw", "f8-decline"]),
    ("新 1", "招く葉で作るのは、並びを読む・招く・リンクを作る、だけ。ほかはグレー", ["inv-members"]),
    ("新 2", "招待の入力にグループの欄を足す", ["inv-dialog"]),
    ("新 3", "AI が動いているときの「担当者 ▾」は、押すと小窓に訳が出る形", ["f8-blocked"]),
]
FIXES = [
    ("1", "担当者を選ぶ所に探す欄（名前・メールで絞る・合う人がいないときの文）。配るときの小窓も同じ（グループ名でも絞れる）", ["f8-pick", "f8-pick-search", "f8-pick-none", "f8-pick-manager"]),
    ("2", "スマホの承認待ち：表を横に送るのをやめ、キャンバス MbApprovals のカード（1 件 1 枚）にした。文・札・ボタンが重ならない（幅 375 で 1 枚ずつ目で見た）", ["f8-queue", "f8-decline", "f8-offer-answer", "f8-group"]),
    ("3", "知らせがいつ消えるかを決めて描いた（下の表）。自分の操作の成功は小さな知らせで 5 秒、失敗は直すまで残る、答えを待つ帯は答えが来るまで", ["f8-waiting-sender", "f8-accepted", "f8-taken-sender", "inv-sent"]),
    ("4", "スマホの詳細の頭：開始日・期限・段の札を横に並べ、2 行までにした（段 7 と同じ並べ方）", ["f8-detail-owner"]),
    ("5", "メンバーの画面を作り直した（キャンバス WsPeople：ワークスペースの管理の頭と第 2 ナビ・グループごとのカード・丸いアイコン・本文の幅いっぱい・スマホは 1 人 1 行）", ["inv-members", "inv-sent"]),
    ("6", "招くの小窓：メールを入れる欄（「足す」）・招く人の並び・グループと役割を段に分けた。ひとこととリンクは開くと出る（キャンバス WsInvite）", ["inv-dialog", "inv-error", "inv-link"]),
]
NOTICES = [
    ("自分の操作がうまくいった（渡しました・催促しました・配りました・招待を送りました）", "画面の下の小さな知らせ", "5 秒で消える（前からの部品 useNotify の決まり）", ["f8-waiting-sender", "f8-reminded", "f8-group-waiting", "inv-sent"]),
    ("自分の操作の失敗（口が断った・送れない・引き継げませんでした）", "小窓の上の赤い箱。書いた中身は残す", "直して押し直すか、小窓を閉じるまで残る（承認の帯・段 3 の招待の画面と同じ）。失敗の小さな知らせを使うときは自分で閉じるまで残る（useNotify の決まり）", ["f8-pass-refused"]),
    ("入力の誤り", "欄の下の赤い字", "直すまで", ["f8-pass-error", "inv-error"]),
    ("相手の答えを待つ帯（渡し中・頼まれています・申し出ています・配り中）", "題名の下の帯", "答えが来る・取り消すまで残る", ["f8-waiting-sender", "f8-waiting-recipient", "f8-offer-band", "f8-group-waiting"]),
    ("返事がまだありません", "帯", "答えが来る・取り消す・別の人にするまで", ["f8-overdue"]),
    ("断られました", "帯", "「閉じる」を押すか、別の人に渡すまで", ["f8-declined-sender"]),
    ("担当者になりました・〇〇さんが引き継ぎました・配られました", "帯（受けた直後に小さな知らせは重ねない）", "1 回だけ。次にその詳細を開いたときは出ない（後から見るのは渡しの記録）", ["f8-accepted", "f8-taken-sender", "f8-distributed"]),
    ("この渡しは取り消されました（古い知らせ・別のタブから開いた）", "帯", "その画面にいる間だけ（読み直すと出ない）", ["f8-gone"]),
    ("AI が動いているので渡せない", "小窓の上の橙の箱", "AI の実行・承認が終わるまで、開くたびに出る", ["f8-blocked"]),
    ("渡しの様子を読み込めない", "帯の場所", "「もう一度読む」で読めるまで", ["f8-failed"]),
]
# 製品の時点（既定は PS0 から。渡す・受けるは PC が無くてもできる・D-127.8）。AI が要る状態だけ
PS = {"f8-blocked": "PS1 から（AI が在る時点）"}
# 範囲.md の行為と、それを描いた状態（最初と最後の id）
ACTS = [
    ("A51 引き継いでもらう", ("f8-detail-owner", "f8-taken-sender")),
    ("A110 渡されたものを受ける／断る", ("f8-queue", "f8-gone")),
    ("A48 引き継ぐ（申し出る）・申し出に答える", ("f8-offer-entry", "f8-offer-band")),
    ("A111 上から配る（人・グループ）", ("f8-pick-manager", "f8-group")),
    ("A112 上へ上げる", None),
    ("共通（権限・読めない）", ("f8-noperm", "f8-failed")),
    ("招く（F10 の葉を前に出す）", ("inv-members", "inv-sent")),
]

MOCK_ENTRY = re.compile(r'\{\s*id:\s*"([^"]+)",\s*screen:\s*"([^"]+)",\s*label:\s*"([^"]+)",\s*ticket:\s*"([^"]+)"', re.S)


def jpeg(path: Path, width: int | None = None, q: int = 80) -> str:
    im = Image.open(path).convert("RGB")
    if width and im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=q, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def build(shots: Path, q: int, wide: int | None) -> str:
    states = MOCK_ENTRY.findall(MOCKS.read_text(encoding="utf-8"))
    missing = [s[0] for s in states if s[0] not in WHAT]
    if missing:
        raise SystemExit(f"説明の無い状態：{missing}")
    measure = json.loads((shots / "measure.json").read_text(encoding="utf-8"))
    over = [f"{m['id']}@{m['w']}:{m['over']}" for m in measure if m["over"] > 0 or m.get("tabsOver", 0) > 0]
    hidden = [f"{m['id']}@{m['w']}" for m in measure if m.get("buttonsSeen") is False]
    out = [
        '<!DOCTYPE html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
        "<title>段 9 渡す・配る 下絵</title>",
        "<style>body{font-family:system-ui,sans-serif;margin:24px;background:#f4f5f8;color:#1b2030;line-height:1.6}"
        "section{background:#fff;border-radius:10px;padding:16px;margin:0 0 18px}h1{font-size:20px}h2{font-size:16px;margin:0 0 6px}"
        "h3{font-size:15px;margin:22px 0 10px}small{color:#667;font-weight:400}p,li,td,th{font-size:14px}"
        ".r{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap}figure{margin:0}img{border:1px solid #dde;border-radius:6px;height:auto;max-width:100%}"
        "figcaption{font-size:12px;color:#667}.what{background:#eef3fb;border-radius:6px;padding:8px 12px;margin:0 0 10px}"
        ".meta{font-size:12px;color:#556;margin:0 0 8px}table{border-collapse:collapse;width:100%}td,th{border-top:1px solid #e3e6ee;padding:6px 8px;text-align:left;vertical-align:top}"
        "th{background:#f7f8fb}</style>",
        f"<h1>段 9（渡す・配る）と、前に出す「招く」の下絵：{len(states)} の状態（2026-11-20）</h1>",
        "<p><b>本番と同じ部品で作った下絵です。</b>アプリの中の開発用の置き場 <code>/dev/mock/f8/&lt;名前&gt;</code> に、本番の外枠・チケットの詳細・承認待ち・小窓・帯の部品を並べて作りました（前の手描きの絵は作り直しました）。写しは幅 375（スマホ）と 1440（PC）。768 は横のはみ出しだけ測りました。</p>",
        "<section><h2>段 9 で、利用者ができるようになること</h2><ol>"
        "<li><b>引き継いでもらう</b>：担当者がチケットの詳細の「担当者 ▾」から相手を選び、理由とお願い・返事の期限を書いて頼む。相手が受けるまで担当者は自分のまま（渡し中）</li>"
        "<li><b>受ける／断る</b>：頼まれた人は承認待ちに「渡された」の行が出る。受けると担当者になる。断るときは理由を書き、頼んだ人に戻る</li>"
        "<li><b>催促する・取り消す・別の人にする</b>：頼んだ人は、返事を待つ間に帯のボタンで。返事の期限を過ぎたら帯が「返事がまだありません」に替わる</li>"
        "<li><b>引き継ぐ（申し出る）</b>：担当者でない人が「こちらでやります」と申し出る。担当者が「渡す」と答えたら替わる</li>"
        "<li><b>配る</b>：マネージャーが人かグループに担当を配る（合意なし・すぐ替わる。グループへはそのグループの人が担当を決める）</li>"
        "<li><b>招く</b>：管理者がメンバーの画面から人を招く（メールかリンク）。2 人目がいないと渡す相手がいないので、この葉を段 9 の前に作る</li>"
        "</ol><p>担当者を黙って直に書き換える道は作りません（理由と記録が必ず残る）。渡す・受けるは PC をつないでいなくてもできるので、どの状態も登録した直後（製品の時点 PS0）から出ます。</p></section>",
    ]
    num = {sid: i for i, (sid, *_r) in enumerate(states, 1)}
    refs = lambda ids: "・".join(str(num[i]) for i in ids)  # noqa: E731
    out.append(
        "<section><h2>決めてほしいこと（1 つだけ）</h2>"
        "<p>代表の確認（2026-11-20 10:20 ごろ）で、下絵の形と答えは「あとは OK」をもらいました。残っているのは<b>知らせがいつ消えるか</b>の確かめだけです。"
        "前からの部品の決まり（小さな知らせは 5 秒で消え、失敗の小さな知らせは自分で閉じるまで残る）と、承認の帯・段 3 の招待の画面の赤い箱（直すまで残る）にそろえました。違う所だけ教えてください。</p>"
        "<table><tr><th>知らせの種類</th><th>出し方</th><th>いつ消えるか（勧め）</th><th>描いた状態</th></tr>"
    )
    out += [f"<tr><td>{E(k)}</td><td>{E(h)}</td><td>{E(w)}</td><td>{E(refs(ids))}</td></tr>" for k, h, w, ids in NOTICES]
    out.append("</table></section><section><h2>今回の直し（代表の言葉 6 つ）</h2><table><tr><th>番号</th><th>直したこと</th><th>描いた状態</th></tr>")
    out += [f"<tr><td>{E(n)}</td><td>{E(t)}</td><td>{E(refs(ids))}</td></tr>" for n, t, ids in FIXES]
    out.append("</table></section><section><h2>決まったこと（確定・決定ログに書く）</h2><table><tr><th>番号</th><th>決まった形</th><th>描いた状態</th></tr>")
    out += [f"<tr><td>{E(n)}</td><td>{E(t)}</td><td>{E(refs(ids))}</td></tr>" for n, t, ids in DECIDED]
    out.append("</table></section>")
    out.append("<section><h2>行為の一覧との突き合わせ（範囲.md）</h2><table><tr><th>行為</th><th>描いた状態</th></tr>")
    for act, span in ACTS:
        where = "今回は切らない（キャンバスに在るのは承認待ちの絞り込みの札だけで、今の本線どおりグレー）" if span is None else f"{num[span[0]]}〜{num[span[1]]}"
        out.append(f"<tr><td>{E(act)}</td><td>{E(where)}</td></tr>")
    out.append(
        f"</table><p class=\"meta\">横のはみ出し（幅 375・768・1440 × {len(states)} の状態）：{'0（全部）' if not over else E(' '.join(over))}。"
        f"小窓のボタンが画面の外に出た状態：{'無し' if not hidden else E(' '.join(hidden))}。幅 375 の写しは 1 枚ずつ目で見た（文・札・ボタンの重なりが無い）。</p></section>"
    )
    for i, (sid, screen, label, leaf) in enumerate(states, 1):
        what, q_no = WHAT[sid]
        out.append(
            f'<section id="{E(sid)}"><h2>{i}. {E(label)} <small>{E(sid)}</small></h2>'
            f'<p class="what">{E(what)}</p>'
            f'<p class="meta">画面：{E(screen)} ・ 製品の時点：{E(PS.get(sid, "PS0 から"))} ・ 持ち主の葉：{E(leaf)} ・ 聞くこと：{E(q_no)}</p>'
            f'<div class="r"><figure><img alt="{E(sid)} 幅 375" width="260" src="{jpeg(shots / f"{sid}-375.png", None, q)}"><figcaption>幅 375</figcaption></figure>'
            f'<figure><img alt="{E(sid)} 幅 1440" width="720" src="{jpeg(shots / f"{sid}-1440.png", wide, q)}"><figcaption>幅 1440</figcaption></figure></div></section>'
        )
    out.append("</html>")
    return "".join(out)


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    shots = Path(sys.argv[1])
    for q, wide in ((80, None), (72, 1200), (65, 1000)):
        text = build(shots, q, wide)
        if len(text.encode()) <= LIMIT:
            break
    else:
        raise SystemExit("15MB を超えた")
    for dst in sys.argv[2:]:
        Path(dst).write_text(text, encoding="utf-8")
        print(dst, f"{len(text.encode()) / 1024 / 1024:.1f}MB")


if __name__ == "__main__":
    main()
