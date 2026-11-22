// 足す入力の取り出し（K-434・createTestSpec）。入口（op.ts）が契約の strict な形（title の 1 欄だけ）で確かめ済みの体から、title だけ取り出す。
//   題名の確かめは DB の関数 app.test_spec_title_check が 1 か所で持つ（口・直す口（K-435）・作るとき足す処理（K-437）が同じ関数を呼ぶ）。
//   外れた答え { field: title, message } は 422。ticket_id は道（:id）から決め、体に入れさせない（入口が知らない欄を 422 にする）
import type { Row } from "@kaname/db/repository";

/** DB の関数に渡す欄（省かれた欄は渡さない） */
export interface CreateInput {
  title?: unknown;
}

export function pickCreate(input: Row): CreateInput {
  const out: CreateInput = {};
  if (input["title"] !== undefined) out.title = input["title"];
  return out;
}
