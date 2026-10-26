"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18nContext";
import { useSessionCtx } from "@/lib/session-context";
import { resolveBilingual } from "@/lib/static-page-i18n";
import { BMS_LINE_OA_URL } from "@/lib/bms/lineOfficialAccount";
import { useBreadcrumbsOverride } from "@/components/breadcrumbs-context";
import { restaurantCopy } from "./content";
import { restaurantFlows } from "./flowContent";
import SequenceDiagram from "./SequenceDiagram";
import styles from "./restaurant.module.css";

export default function RestaurantGuide() {
  const { lang, t } = useI18n(), { admin, loading } = useSessionCtx();
  const copy = resolveBilingual(restaurantCopy, lang);
  const { setOverride, clearOverride } = useBreadcrumbsOverride();
  const homeLabel = t("breadcrumbs.home");
  useEffect(() => {
    setOverride("/restaurant", [{ href: "/", label: homeLabel }, { label: copy.breadcrumb }]);
    return () => clearOverride("/restaurant");
  }, [setOverride, clearOverride, homeLabel, copy.breadcrumb]);
  const [selected, setSelected] = useState(3), [shareStatus, setShareStatus] = useState<"copied" | "failed" | "shared" | null>(null);
  const currentFlow = useRef(selected); currentFlow.current = selected;
  useEffect(() => {
    const restore = () => {
      const id = Number(window.location.hash.match(/^#flow-(\d+)$/)?.[1]);
      setSelected(restaurantFlows.some(f => f.id === id) ? id : 3);
      setShareStatus(null);
    };
    restore();
    window.addEventListener("hashchange", restore);
    window.addEventListener("popstate", restore);
    return () => { window.removeEventListener("hashchange", restore); window.removeEventListener("popstate", restore); };
  }, []);
  const flow = restaurantFlows.find(f => f.id === selected)!;
  const detail = resolveBilingual(flow, lang);
  const select = (id: number) => {
    if (id === selected) return;
    setSelected(id); setShareStatus(null);
    window.history.pushState(null, "", `#flow-${id}`);
  };
  const share = async (native = false) => {
    const url = new URL(window.location.href); url.hash = `flow-${selected}`;
    setShareStatus(null);
    if (native && navigator.share) {
      try {
        await navigator.share({ title: `BMS · ${detail.title}`, text: detail.description, url: url.href });
        if (currentFlow.current === selected) setShareStatus("shared");
        return;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
      }
    }
    try { await navigator.clipboard.writeText(url.href); if (currentFlow.current === selected) setShareStatus("copied"); }
    catch { if (currentFlow.current === selected) { window.history.replaceState(null, "", url.href); setShareStatus("failed"); } }
  };
  return <article className={styles.page} data-restaurant-guide>
    <header className={styles.hero}>
      <div>
        <p className={styles.eyebrow}>BMS FOR RESTAURANTS &amp; CAFÉS</p>
        <h1>{copy.title}</h1>
      </div>
      <div>
        <p className={styles.intro}>{copy.description}</p>
        <ol className={styles.journey}>{copy.journey.map(step => <li key={step}>{step}</li>)}</ol>
        <div className={styles.actions}>
          <a className={styles.primaryButton} href="#restaurant-flows">{copy.explore} <span aria-hidden="true">↓</span></a>
          <a className={styles.button} href={BMS_LINE_OA_URL} target="_blank" rel="noopener noreferrer">{copy.contact} <span aria-hidden="true">↗</span></a>
        </div>
      </div>
    </header>

    <section id="restaurant-flows" className={styles.explore} aria-labelledby="restaurant-flows-title">
      <div className={styles.sectionHead}><p className={styles.eyebrow}>HOW YOUR RESTAURANT WORKS</p>
        <h2 id="restaurant-flows-title">{copy.explorerTitle}</h2><p>{copy.explorerDescription}</p>
      </div>
      <div className={styles.categories} role="group" aria-label={copy.groupLabel}>
        {copy.groups.map((title, group) => <button key={group} type="button" aria-pressed={flow.group === group} onClick={() => select(restaurantFlows.find(f => f.group === group)!.id)}>{title}</button>)}
      </div>
      <div className={styles.explorer}>
        <nav className={styles.flowList} aria-label={copy.flowLabel}>
          {restaurantFlows.filter(f => f.group === flow.group).map(f => <button key={f.id} type="button" data-flow-id={f.id} aria-pressed={selected === f.id} onClick={() => select(f.id)}>
            <span className={styles.flowNumber}>{String(f.id).padStart(2, "0")}</span>{resolveBilingual(f, lang).title}
          </button>)}
        </nav>
        <section className={styles.detail} id={`flow-${selected}`} aria-labelledby={`flow-title-${selected}`}>
          <div className={styles.detailHeading}><div>
            <p className={styles.flowKicker}>FLOW {String(flow.id).padStart(2, "0")}</p>
            <h3 id={`flow-title-${selected}`}>{detail.title}</h3><p>{detail.description}</p>
          </div><div className={styles.share}>
            <button className={styles.button} data-print-flow onClick={() => { void document.fonts.ready.then(() => window.print()); }} title={copy.printHint}>{copy.print}</button>
            <button className={styles.button} data-share-flow onClick={() => void share(true)}>{copy.nativeShare}</button>
            <button className={styles.button} data-copy-flow onClick={() => void share()}>{copy.share}</button>
            <span role="status">{shareStatus === "copied" ? copy.copied : shareStatus === "failed" ? copy.copyFailed : shareStatus === "shared" ? copy.shared : ""}</span>
          </div></div>
          <h4 className={styles.diagramHeading}>{copy.diagram}</h4>
          <SequenceDiagram key={`${flow.id}-${lang}`} source={detail.source} title={`${copy.diagram}: ${detail.title}`} lang={lang} labels={copy.labels} zoomLabel={copy.zoom} fitLabel={copy.fit} hint={copy.diagramHint} transcriptLabel={copy.transcript}
            printFlow={{ id: flow.id, title: detail.title, description: detail.description, note: detail.note, pageLabel: copy.page, continued: copy.continued, scope: copy.scope }} />
          <p className={styles.boundary}>{detail.note}</p>
        </section>
      </div>
    </section>

    <section className={styles.readiness} aria-labelledby="restaurant-readiness-title">
      <div><h2>{copy.fitTitle}</h2><p>{copy.fitDescription}</p><ul className={styles.fitTags}>{copy.fits.map(fit => <li key={fit}>{fit}</li>)}</ul></div>
      <div><h2 id="restaurant-readiness-title">{copy.readinessTitle}</h2><ul className={styles.limits}>{copy.readiness.map(point => <li key={point}>{point}</li>)}</ul></div>
    </section>
    <section className={styles.cta}><div><h2>{copy.ctaTitle}</h2><p>{copy.ctaDescription}</p></div><div className={styles.actions}>
      <a className={styles.primaryButton} href={BMS_LINE_OA_URL} target="_blank" rel="noopener noreferrer">{copy.contact} ↗</a>
      {!loading && <Link className={styles.button} href={admin ? "/admin/dashboard" : "/shop-signup"}>{admin ? copy.dashboard : copy.signup}</Link>}
    </div></section>
    <p className={styles.scope}>{copy.scope}</p>
  </article>;
}
