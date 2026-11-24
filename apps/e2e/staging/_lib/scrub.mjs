// 記録（JUnit・標準出力）から、staging の住所・試験の宛先・確認のリンクの手がかり・鍵・PC の印を伏せる（K-65）。
//   JUnit は成果物に 3 日残り、GitHub の伏せ字は成果物に効かない（K-204 の申し送り）。落ちた試験の文（Playwright が付ける URL つきの文）も
//   ここを通してから残す。型の無い素の JS にしてある：形の試験（scripts/ci/k65_staging_spec_test.py）が node でそのまま動かして確かめる
import process from "node:process";
import { URL } from "node:url";

const XML = [
  ["&", "&amp;"],
  ["<", "&lt;"],
  [">", "&gt;"],
  ['"', "&quot;"],
  ["'", "&apos;"],
];
const xml = (s) => XML.reduce((v, [a, b]) => v.split(a).join(b), s);

/** 伏せる値：名前が STAGING_ で始まる環境の値そのもの。住所の形なら、出どころ（origin）とホストの名前も */
export function secretValues(env = process.env) {
  const out = new Set();
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith("STAGING_") || !value || value.length < 6) continue;
    out.add(value);
    out.add(value.replace(/\/+$/, ""));
    try {
      const u = new URL(value);
      out.add(u.origin);
      out.add(u.host);
      out.add(u.hostname);
      if (u.password) out.add(u.password);
      if (u.username) out.add(u.username);
    } catch {
      /* 住所の形でない値（鍵）は、そのものだけを伏せる */
    }
  }
  return [...out].filter((v) => v.length >= 6).sort((a, b) => b.length - a.length);
}

/** 伏せた跡の字。全角の角括弧にする：JUnit（XML）の中に < > & を足すと、記録が XML として読めなくなる（判定が読めない） */
const HIDDEN = "［伏せた］";
/** 形で伏せるもの（値を知らなくても伏せる。環境の値が空の回でも効く） */
const SHAPES = [
  [/[A-Za-z0-9._+-]+@resend\.dev/g, "［試験の宛先］"],
  [/([?&](?:amp;)?token=)[^&\s"'<>]+/g, `$1${HIDDEN}`],
  // 招待のリンクの印（/invite/<印>・K-418）。道の中に印があるので token= の形では伏せられない
  [/(\/invite\/)[A-Za-z0-9_-]{16,}/g, `$1${HIDDEN}`],
  [/kpc_[A-Za-z0-9_-]{20,}/g, "［PC の印］"],
  [/\bre_[A-Za-z0-9_]{16,}/g, "［鍵］"],
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi, `$1${HIDDEN}`],
  [/(X-Amz-[A-Za-z-]+=)[^&\s"'<>]+/g, `$1${HIDDEN}`],
  [/postgres(?:ql)?:\/\/[^\s"'<>]+/g, "［DB の接続］"],
  [/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:vercel\.app|supabase\.co|supabase\.com)\b/gi, "［staging］"],
  // その回に作ったパスワード（_lib/steps.ts の person が尻に付ける印の形）。落ちた文の Call log（fill の中身）に乗る
  [/[A-Za-z0-9_-]{24}-k65pw-aA1/g, "［パスワード］"],
];

/** 文字を伏せて返す。環境の値は、XML に書かれた形（&amp; など）でも伏せる */
export function scrub(text, env = process.env) {
  let out = String(text);
  for (const v of secretValues(env)) {
    out = out.split(v).join(HIDDEN);
    const x = xml(v);
    if (x !== v) out = out.split(x).join(HIDDEN);
  }
  for (const [re, to] of SHAPES) out = out.replace(re, to);
  return out;
}
