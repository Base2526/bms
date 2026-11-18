import type { ReactNode } from "react";
import Link from "next/link";
import styles from "./BrandedNotFound.module.css";

export type NotFoundLink = { href: string; label: string };

export function NotFoundLinks({
  primary,
  secondary,
}: {
  primary: NotFoundLink;
  secondary?: NotFoundLink;
}) {
  return (
    <div className={styles.actions}>
      <Link href={primary.href} className={styles.primaryAction}>{primary.label}</Link>
      {secondary && <Link href={secondary.href} className={styles.secondaryAction}>{secondary.label}</Link>}
    </div>
  );
}

function Illustration({ kind }: { kind: "store" | "book" | "compass" }) {
  return (
    <div className={styles.illustration} aria-hidden="true">
      <div className={styles.orbit}>
        <div className={styles.iconTile}>
          <svg viewBox="0 0 80 80" fill="none" focusable="false">
            {kind === "store" ? (
              <>
                <path d="M17 35h46v30H17V35Z" />
                <path d="m13 35 7-20h40l7 20c0 6-5 10-10 10-4 0-8-3-9-7-1 4-4 7-8 7s-7-3-8-7c-1 4-5 7-9 7-5 0-10-4-10-10Z" />
                <path d="M34 65V51h13v14" />
              </>
            ) : kind === "book" ? (
              <>
                <path d="M40 62c-7-4-15-5-25-3V18c10-2 18-1 25 3v41Z" />
                <path d="M40 62c7-4 15-5 25-3V18c-10-2-18-1-25 3v41Z" />
                <path d="M22 31c4-.3 7 0 10 1M48 32c3-1 6-1.3 10-1" />
              </>
            ) : (
              <>
                <circle cx="40" cy="40" r="25" />
                <path d="m48 32-8 21-8-8 16-13Z" />
                <path d="M40 14v5M40 61v5M14 40h5M61 40h5" />
              </>
            )}
          </svg>
        </div>
      </div>
      <span className={styles.sparkTop}>✦</span>
      <span className={styles.sparkBottom}>✦</span>
    </div>
  );
}

export default function BrandedNotFound({
  id,
  eyebrow,
  title,
  description,
  kind = "compass",
  primary,
  secondary,
  actions,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  kind?: "store" | "book" | "compass";
  primary?: NotFoundLink;
  secondary?: NotFoundLink;
  actions?: ReactNode;
}) {
  return (
    <section className={styles.panel} data-bms-not-found aria-labelledby={id}>
      <span className={styles.watermark} aria-hidden="true">404</span>
      <div className={styles.copy}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1 id={id} className={styles.title}>{title}</h1>
        <p className={styles.description}>{description}</p>
        {actions ?? (primary ? <NotFoundLinks primary={primary} secondary={secondary} /> : null)}
      </div>
      <Illustration kind={kind} />
    </section>
  );
}
