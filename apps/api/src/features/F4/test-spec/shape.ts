// 確認項目の答えの形（K-434）。一覧（listTestSpecs）・足す（createTestSpec）・直す・付け外す（K-435）の口が同じ形で答える。
//   鍵はちょうど 6（id・title・checked・position・source・version）。version は行の版（画面が updateTestSpec に送る）。
//   中身は DB の関数 app.test_spec_item が作る（position は消していない行を作った順に数えた 1 からの番号）

/** 答えの項目（鍵 6） */
export interface SpecItem {
  id: string;
  title: string;
  checked: boolean;
  position: number;
  source: string;
  version: number;
}

/** DB の関数の答え（jsonb）を整える。鍵をちょうど 6 にそろえる */
export function toSpecItem(v: SpecItem): SpecItem {
  return {
    id: v.id,
    title: v.title,
    checked: v.checked === true,
    position: Number(v.position),
    source: v.source,
    version: Number(v.version),
  };
}
