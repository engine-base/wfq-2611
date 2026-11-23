"use client";
// 段 9（F8 渡す・配る）がチケットの詳細と承認待ちに中身を足す差し込み口の先（K-380 が名前を置き、K-400 が配り分けに書き直した）。
//   ここは書き出しだけ。配り分けは slot-dispatch.tsx、区画のファイルは assignee-action・band-*・offer-action・queue-row-*、
//   値と分け方は use-handovers.ts。後ろの画面の葉（K-411〜K-415）は区画のファイルだけを触り、このファイルは触らない。
//   入る所は features/F4/create-ticket/ の ticket-detail.tsx・detail-panel.tsx と features/F5/approve-complete/queue-table.tsx
export { AssigneeSlot, DetailScope, HandoverBandSlot, QueueRowSlot } from "./slot-dispatch";
