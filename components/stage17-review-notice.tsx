import {TriangleAlert,Info} from "lucide-react";

/**
 * Stage 17 — candidate accessibility component.
 * Intentionally NOT imported by any live page, provider or route.
 * Use only in a reviewed offline component-gallery/test context.
 */
export type Stage17Notice = Readonly<{
  id: "water" | "gate" | "risk" | "freshness";
  heading: string;
  detail: string;
  tone: "warning" | "neutral";
  evidence: string;
}>;

export function Stage17ReviewNotice({notice}: {notice: Stage17Notice}) {
  const titleId = `stage17-${notice.id}-heading`;
  const descriptionId = `stage17-${notice.id}-description`;
  return (
    <section
      role="note"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      data-review-only="true"
      className="rounded-xl border border-amber-300/40 bg-slate-900 p-5 text-slate-100"
    >
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="mt-1 shrink-0 text-amber-300">
          {notice.tone === "warning" ? <TriangleAlert size={22}/> : <Info size={22}/>}
        </span>
        <div className="min-w-0">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-200">
            Review-only preview · synthetic
          </p>
          <h2 id={titleId} className="mb-2 text-lg font-bold break-words">
            {notice.heading}
          </h2>
          <p id={descriptionId} className="text-sm leading-6 text-slate-200 break-words">
            {notice.detail}
          </p>
          <p className="mt-3 text-xs leading-5 text-slate-300">{notice.evidence}</p>
        </div>
      </div>
    </section>
  );
}
