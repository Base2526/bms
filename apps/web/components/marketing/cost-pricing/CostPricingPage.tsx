"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18nContext";
import { useSessionCtx } from "@/lib/session-context";
import { resolveBilingual } from "@/lib/static-page-i18n";
import { BMS_LINE_OA_URL } from "@/lib/bms/lineOfficialAccount";
import { useBreadcrumbsOverride } from "@/components/breadcrumbs-context";
import { costCopy } from "./content";
import { calculateExample } from "./example";
import CostFlow from "./CostFlow";
import styles from "./cost-pricing.module.css";
import { localizedPublicPath } from "@/lib/publicSeo";

export default function CostPricingPage({ children }: { children?: React.ReactNode }) {
  const { lang, t } = useI18n(), { admin, loading } = useSessionCtx();
  const c = resolveBilingual(costCopy, lang);
  const { setOverride, clearOverride } = useBreadcrumbsOverride();
  const home = t("breadcrumbs.home");
  useEffect(() => { setOverride("/cost-pricing", [{ href: "/", label: home }, { label: c.title }]);
    return () => clearOverride("/cost-pricing"); }, [setOverride, clearOverride, home, c.title]);
  const [values, setValues] = useState(["2000", "200", "65", "21000"]);
  const result = calculateExample(...values.map(value => value.trim() === "" ? NaN : Number(value)) as [number, number, number, number]);
  const money = (n: number) => n.toLocaleString(lang === "th" ? "th-TH" : "en-US", {minimumFractionDigits:2, maximumFractionDigits:2});
  const count = (n: number | null) => n == null ? "—" : `${n.toLocaleString()} ${c.cups}`;
  const metrics = result ? [`${money(result.unit)} ฿`, `${money(result.contribution)} ฿`, count(result.monthly), count(result.daily)] : ["—", "—", "—", "—"];
  return <article className={styles.page} data-cost-pricing>
    <header className={styles.hero}><div><p className={styles.eyebrow}>COST & PRICING · BMS</p><h1>{c.headline}</h1><p className={styles.intro}>{c.intro}</p>
      <div className={styles.actions}><a className={styles.primary} href="#cost-example">{c.try} ↓</a><a className={styles.button} href="#cost-flow">{c.flow}</a></div><p className={styles.note}>{c.audience}</p></div>
      <div className={styles.sample}><div className={styles.sampleHead}><h2>{c.coffee}</h2><span className={styles.tag}>{c.sample}</span></div><p className={styles.note}>{c.batch}</p>
        {[[c.goods,"2,000"],[c.freight,"200"],[c.landed,"22"],[c.extra,"8"]].map(([label,value]) => <div className={styles.billRow} key={label}><span>{label}</span><strong>{value} {c.baht}</strong></div>)}
        <div className={styles.sampleResult}><div><span>{c.estimate}</span><strong>30 {c.baht}</strong></div><div><span>{c.price}</span><strong>65 {c.baht}</strong></div></div><p className={styles.note}>{c.excludes}</p>
      </div>
    </header>
    <div className={styles.benefits}>{c.benefits.map((title,i) => <div key={title}><h2>{String(i+1).padStart(2,"0")} · {title}</h2><p>{c.benefitDetails[i]}</p></div>)}</div>
    <section id="cost-example" className={styles.section} aria-labelledby="cost-example-title"><div className={styles.sectionHead}><p className={styles.eyebrow}>TRY THE NUMBERS · {c.sample}</p><h2 id="cost-example-title">{c.calculator}</h2><p>{c.calculatorDescription}</p></div>
      <div className={styles.calculator}><div><div className={styles.fields}>{c.fields.map((label,i) => <label key={label}>{label}<input type="number" min={0} max={1000000} step="0.01" value={values[i]} data-cost-input={i}
        onChange={e => setValues(previous => previous.map((value,j) => j === i ? e.target.value : value))} /></label>)}</div><p className={styles.note}>{c.assumptions}</p></div>
        <div><div className={styles.metrics} aria-live="polite">{metrics.map((value,i) => <div key={c.metrics[i]}><span>{c.metrics[i]}</span><strong data-cost-result={i}>{value}</strong></div>)}</div>
          <p className={styles.note} role="status" data-calculation-status>{!result ? c.invalid : result.contribution <= 0 ? c.noBreakEven : c.estimateNote}</p><p className={styles.note}>{c.limitations}</p></div>
      </div>
    </section>
    <CostFlow key={lang} lang={lang} />
    {children}
    <section className={styles.closing}><div><h2>{c.closing}</h2><p>{c.closingDescription}</p></div><div className={styles.actions}>
      <a className={styles.primary} href={BMS_LINE_OA_URL} target="_blank" rel="noopener noreferrer">{c.contact} ↗</a>
      {!loading && <Link className={styles.button} data-session-cta href={admin ? "/admin/dashboard" : "/shop-signup"}>{admin ? c.dashboard : c.signup}</Link>}
    </div></section><Link className={styles.guideLink} href={localizedPublicPath("/restaurant", lang)}>{c.restaurant} →</Link>
  </article>;
}
