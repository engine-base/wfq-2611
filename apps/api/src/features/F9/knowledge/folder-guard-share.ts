// 共有しているフォルダは消せない、の確かめ（K-678 が置いた器）。K-719 が中身を差し替える（共有の表は K-689）。
//   真なら消す口は 409 E-KNW-051 を返す。この葉の間は共有が無いので常に false
import type pg from "pg";

export async function shareBlocksFolder(cl: pg.PoolClient, folderId: string): Promise<boolean> {
  void cl;
  void folderId;
  return false;
}
