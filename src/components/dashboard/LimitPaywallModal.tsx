import Link from "next/link";
import type { ReactNode } from "react";

type LimitPaywallModalProps = {
  title: string;
  description: string;
  children?: ReactNode;
};

export function LimitPaywallModal({
  title,
  description,
  children,
}: LimitPaywallModalProps) {
  return (
    <section className="limit-paywall">
      <h3 className="limit-paywall-title">{title}</h3>
      <p className="limit-paywall-copy">{description}</p>
      {children}
      <Link className="limit-paywall-cta" href="/pricing">
        Upgrade to Pro
      </Link>
    </section>
  );
}
