// 預けたログイン情報の「使える場所」の名前の取り出しと合わせ方（K-354 が写した・代表の答え answer=449e72553c59）。
//   口（apps/api/src/features/F3/credentials/host.ts・K-352）と同じ 1 つの決まりにする。Bridge は CommonJS で apps/api も packages も読めないので、
//   下の区切りの中は口の host.ts と 1 字も違わない写し（K354-BRG-010 が 2 つを比べる）。直すときは口の側を直してから、区切りの中をそのまま写す。
//   区切りの中は外の部品を import しない

// ---- 名前の取り出しと合わせ方（apps/bridge/src/host.ts と同じ字） ----
/** URL か名前から、宛先の名前（小文字・末尾の点なし・日本語は punycode）を取り出す。取り出せなければ null。
 *  userinfo（@ の前）・道・問い合わせ・断片・ポートは名前に入らない（new URL の hostname だけを使う）。
 *  読む前に字を変えない（NFKC をかけない）：全角の区切り（／ ＃ ？ ＼）を半角に直すと、ブラウザが読む行き先と違う名前になる
 *  （例 https://example.com／@evil.test/ の行き先は evil.test）。全角の英字と点・日本語の名前は new URL が自分で直す */
export function hostnameOf(v: string): string | null {
  const s = v.trim();
  if (s === "" || /\s/.test(s)) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  return host === "" ? null : host;
}

/** 使える場所の 1 つを整える。頭の「*.」（下の名前だけに当てる印）は外して整え、付け直す */
export function destinationOf(v: string): string | null {
  const s = v.trim();
  const wild = s.startsWith("*.");
  const host = hostnameOf(wild ? s.slice(2) : s);
  if (host === null) return null;
  return wild ? `*.${host}` : host;
}

/** 宛先が使える場所に入っているか。「*.名前」は下の名前だけ（名前そのものは当たらない）。「名前」は同じか、その下の名前。空の並びは false */
export function hostAllowed(target: string, destinations: readonly string[]): boolean {
  const host = hostnameOf(target);
  if (host === null) return false;
  for (const d of destinations) {
    if (d.startsWith("*.")) {
      if (host.endsWith(d.slice(1))) return true;
    } else if (host === d || host.endsWith(`.${d}`)) return true;
  }
  return false;
}
// ---- ここまで ----
