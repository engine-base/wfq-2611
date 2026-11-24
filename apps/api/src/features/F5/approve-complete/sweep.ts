// 読むときの片付け（K-164）：読む口（listApprovalQueue・getApproval・getTicket）が、読む前に待っている承認の後の実行の仕事を片付ける。
//   止めるのは、チケットが消された・任せた人が使えない・承認から 24 時間を過ぎた 仕事（24 時間は新しい承認待ちで聞き直す）。書くのは関門 C2 の関数だけ（0098）。
//   読む口で書くのは例外（何度呼んでも同じになる片付けだけ）。片付けが例外になったら、片付けだけを戻して（DB の関数の中・K-236）読めたものを返す。
//   失敗は記録だけで答えに出さない（読む口を 503 にしない）。次に開いたときにまた片付ける（決める人の答え bf373f5b265a・K63-API-085）
import type pg from "pg";
import type { OverdueMail } from "../../F8/handovers/overdue.js";

// K-236：片付けは DB の包む関数 app.ticket_execute_sweep_read（0104）の 1 本の文。失敗したときの戻しは関数の中（例外の受け）で、
//   答えが -1 なら片付けだけが戻っている。読む口からは savepoint を流さない。
/** そのチケット 1 枚（見える人だけ） */
export const SWEEP_TICKET = "select app.ticket_execute_sweep_read('ticket', $1) as n";
/** 承認の id から、そのチケット 1 枚（承認が読めなければ何もしない） */
export const SWEEP_OF_APPROVAL = "select app.ticket_execute_sweep_read('approval', $1) as n";
/** 呼んだ人が今の担当者のチケットを全部 */
export const SWEEP_MINE = "select app.ticket_execute_sweep_read('mine', null) as n";

/** K-407：承認待ちを読む前の片付け（今のまま）＋ 返事の期限が過ぎた渡しの知らせ（渡した人が開いたとき 1 回）を、同じ 1 本の文で流す */
export const SWEEP_MINE_AND_OVERDUE =
  "select app.ticket_execute_sweep_read('mine', null) as n, app.handover_overdue_sweep() as overdue";

/** 包む関数が「片付けに失敗したので戻した」ときの答え */
const SWEEP_FAILED = -1;

function logSkipped(where: string, kind: string): void {
  console.error(`[approve-complete] ${where}：読む前の片付けに失敗したので飛ばした（${kind}）`);
}

/** 読む取引の中で片付けを 1 本の文で流す。失敗しても投げない（片付けだけが戻る）。ログは場所と例外の種類だけ */
export async function sweepBeforeRead(cl: pg.PoolClient, sql: string, args: unknown[], where: string): Promise<void> {
  try {
    const r = await cl.query<{ n: number | null }>(sql, args);
    if (r.rows[0]?.n === SWEEP_FAILED) logSkipped(where, "DB の中で戻した");
  } catch (e) {
    // 接続が切れたなど、文そのものが失敗した。今までと同じく投げ直さない（続く読みは同じ接続の上なので、そこで失敗する）
    logSkipped(where, (e as Error)?.name ?? "Error");
  }
}

function logOverdueSkipped(where: string): void {
  console.error(`[handover] ${where}：期限切れの知らせの片付けに失敗したので飛ばした`);
}

/** 読む前の片付け（mine）と期限切れの知らせを 1 本の文で流す。送るメールの宛てを返す（失敗しても投げず、空を返す） */
export async function sweepMineAndOverdue(cl: pg.PoolClient, where: string): Promise<OverdueMail[]> {
  try {
    const r = await cl.query<{ n: number | null; overdue: { ok?: boolean; mails?: OverdueMail[] } | null }>(
      SWEEP_MINE_AND_OVERDUE,
    );
    const row = r.rows[0];
    if (row?.n === SWEEP_FAILED) logSkipped(where, "DB の中で戻した");
    if (!row?.overdue || row.overdue.ok === false) {
      logOverdueSkipped(where);
      return [];
    }
    return row.overdue.mails ?? [];
  } catch (e) {
    logSkipped(where, (e as Error)?.name ?? "Error");
    return [];
  }
}
