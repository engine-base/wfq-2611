// 契約どおりの route を組み立てるための差し込み口。個別の振る舞い（関門を通す副作用）は hooks に書く
import type { Context } from "hono";
import type { TenantContext } from "@kaname/db/context";
import type { Repository, Row } from "@kaname/db/repository";
import type { EndpointDef } from "@kaname/contracts";

export interface HookArgs {
  e: EndpointDef;
  ctx: TenantContext;
  repo: Repository;
  input: Row; // 検証・正規化済みの入力（create／update）
  id: string | null; // path の :id
  c: Context;
  /** 条件つきの本人確認（取り消せない承認・管理者として招く など・D-125.139）。直前 15 分以内でなければ 403 の応答を返す */
  requireStepUp?: () => HookReply | void;
  /** 取り直しが直前 15 分の内か、ログインから 15 分の内でなければ 403 の応答を返す（安全の設定の口・契約の step_up が "login_or_step_up"・K-308） */
  requireStepUpOrFreshLogin?: () => HookReply | void;
}
/** raw：JSON でない答え（ファイルを流す・別の置き場へ渡す・K-57）。あれば body の代わりにそのまま返す */
export type HookReply = { status: number; body: unknown; raw?: Response };
export type EffectResult =
  { status: "done"; value?: unknown } | { status: "denied" | "failed"; reason: string; handoff: string };
export interface Hook {
  /** 入力の前処理（契約の形の確かめの前）。表記ゆらぎを直した体を受け、余計な項目を落とした体か、口の独自のエラーの答えを返す。
   *  返した体も、入口が必ず契約の strict な形（schemas）で確かめる（前処理で形の確かめを飛ばさない） */
  input?: (raw: unknown) => { input: Row } | { reply: HookReply };
  /** 認可の後・副作用の前：ポリシー判定・承認の確認。応答を返せば処理を止める（403 等） */
  before?: (a: HookArgs) => Promise<HookReply | void>;
  /** 外向きの副作用（関門 C1／C3〜C8 を通す）。記録（DB）の前。失敗なら 502（記録しない＝副作用の順序） */
  effect?: (a: HookArgs) => Promise<EffectResult>;
  /** 記録の後（通知など。失敗しても応答は返す） */
  after?: (a: HookArgs, row: Row | Row[]) => Promise<void>;
  /** 入口の行の守りが「見えない・無い」と判定したときの 404 の答え（既定は汎用の NOT_FOUND。口が決めた番号で断る口だけが持つ） */
  rowMissing?: () => HookReply;
  /** 冪等の器に答えを残さない（答えに 1 回だけ渡す秘密が入る口・K-57 の PC の印） */
  noIdempotency?: boolean;
}
export interface Limiter {
  take(key: string): boolean;
}
export interface IdempotencyStore {
  get(key: string): { hash: string; status: number; body: unknown } | undefined;
  set(key: string, v: { hash: string; status: number; body: unknown }): void;
}
export interface ContractDeps {
  hooks: Record<string, Hook>;
  /** operationId ごとの上限（既定は契約の rate_limit） */
  limiter: (operationId: string, perMinute: number) => Limiter;
  idempotency: IdempotencyStore;
  /** テストや運用で上限を差し替える（operationId → perMinute） */
  limits?: Record<string, number>;
}
