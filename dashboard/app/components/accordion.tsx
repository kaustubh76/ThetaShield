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
        {/* A <b> here made every registry accordion skip from the section h2
            straight to the h4s inside it. */}
        <h3>{title}</h3>
        {meta ? <small>{meta}</small> : null}
        <i aria-hidden="true">▸</i>
      </summary>
      <div className="acc-body">{children}</div>
    </details>
  );
}
