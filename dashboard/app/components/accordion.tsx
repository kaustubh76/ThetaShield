import type { ReactNode } from "react";

export default function Accordion({
  id,
  badge,
  title,
  meta,
  defaultOpen = false,
  children,
}: {
  id: string;
  badge: string;
  title: string;
  meta?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="registry-accordion" id={id} open={defaultOpen}>
      <summary>
        <span className="acc-badge">{badge}</span>
        <b>{title}</b>
        {meta ? <small>{meta}</small> : null}
        <i aria-hidden="true">▸</i>
      </summary>
      <div className="acc-body">{children}</div>
    </details>
  );
}
