"use client";
// 知らせ（K-24）。2 つ：
//   Callout … 画面の中の帯（正本 components.callout-*）。危ない知らせは role="alert"、ほかは role="status"
//   Toaster / useNotify … 小さな知らせ（コピーした・保存した）。sonner（技術の選定 D-067）。読み上げに伝わる。Alt+T で知らせの束に移れ、閉じるボタンはいつも出す
import { Toaster as Sonner, toast } from "sonner";
import type { ReactNode } from "react";

export type CalloutTone = "info" | "warn" | "danger";
export function Callout({
  tone = "info",
  title,
  children,
}: {
  tone?: CalloutTone;
  title?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="k-callout" data-tone={tone} role={tone === "danger" ? "alert" : "status"}>
      <div>
        {title ? <div className="k-callout-title">{title}</div> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}

const TOASTER_ID = "k";

/** 小さな知らせの置き場。画面の木の上に 1 つ。前の画面の置き場（components/providers）とは名前で分ける */
export function Toaster({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <Sonner
        id={TOASTER_ID}
        position="bottom-center"
        closeButton
        containerAriaLabel="知らせ"
        toastOptions={{
          unstyled: true,
          closeButtonAriaLabel: "閉じる",
          classNames: {
            toast: "k-toast",
            title: "k-toast-title",
            description: "k-toast-desc",
            closeButton: "k-toast-close",
          },
        }}
      />
    </>
  );
}

/** 知らせを出す。失敗の知らせ（error）は自分で閉じるまで残す。
 *  読み上げと探し方のため、題を role の付いた要素で包む（失敗は alert・ふつうは status。sonner は role を付けないのでここ 1 か所で付ける） */
export function useNotify() {
  return (title: string, o: { description?: string; type?: "info" | "error" } = {}) =>
    (o.type === "error" ? toast.error : toast)(<span role={o.type === "error" ? "alert" : "status"}>{title}</span>, {
      toasterId: TOASTER_ID,
      ...(o.description ? { description: o.description } : {}),
      duration: o.type === "error" ? Infinity : 5000,
      className: o.type === "error" ? "k-toast k-toast-error" : "k-toast",
    });
}
