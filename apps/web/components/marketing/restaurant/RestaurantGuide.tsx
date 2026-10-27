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
import { flowFit, guideFlowCopy, type GuideProfile, type ServiceStyle, type ShopType } from "./guideProfiles";
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
  const [profile, setProfile] = useState<GuideProfile>({ shop: "overview", service: "dine_in", multiBranch: false });
  const shareRequest = useRef(0);
  useEffect(() => { shareRequest.current++; setShareStatus(null); return () => { shareRequest.current++; }; }, [lang]);
  useEffect(() => {
    const restore = (event?: Event) => {
      shareRequest.current++;
      const id = Number(window.location.hash.match(/^#flow-(\d+)$/)?.[1]);
      if (restaurantFlows.some(f => f.id === id)) setSelected(id);
      else if (!event || window.location.hash !== "#restaurant-flows") setSelected(3);
      const url = new URL(window.location.href);
      const shop = url.searchParams.get("shop");
      const service = url.searchParams.get("service");
      setProfile({
        shop: shop === "restaurant" || shop === "food_beverage" || shop === "board_game_cafe" ? shop : "overview",
        service: service === "counter" || service === "online" ? service : "dine_in",
        multiBranch: url.searchParams.get("branches") === "multi",
      });
      setShareStatus(null);
    };
    restore();
    window.addEventListener("hashchange", restore);
    window.addEventListener("popstate", restore);
    return () => { window.removeEventListener("hashchange", restore); window.removeEventListener("popstate", restore); };
  }, []);
  const flow = restaurantFlows.find(f => f.id === selected)!;
  const detail = guideFlowCopy(flow, profile, lang);
  const shopLabels: Record<ShopType, string> = {
    overview: copy.profile.shops.overview,
    restaurant: t("shop_archetypes.restaurant"),
    food_beverage: t("shop_archetypes.food_beverage"),
    board_game_cafe: t("shop_archetypes.board_game_cafe"),
  };
  const fit = flowFit(selected, profile);
  const fitLabel = (value: ReturnType<typeof flowFit>) => value === "restaurant_example" ? copy.profile.restaurantExample : copy.profile[value];
  const recommended = restaurantFlows.filter(item => flowFit(item.id, profile) === "recommended");
  const address = (id: number, nextProfile: GuideProfile) => {
    const url = new URL(window.location.href);
    if (nextProfile.shop === "overview") url.searchParams.delete("shop");
    else url.searchParams.set("shop", nextProfile.shop);
    if (nextProfile.shop === "restaurant" && nextProfile.service !== "dine_in") url.searchParams.set("service", nextProfile.service);
    else url.searchParams.delete("service");
    if (nextProfile.multiBranch) url.searchParams.set("branches", "multi");
    else url.searchParams.delete("branches");
    url.hash = `flow-${id}`;
    return url;
  };
  const navigate = (id: number, nextProfile = profile) => {
    shareRequest.current++;
    setSelected(id); setProfile(nextProfile); setShareStatus(null);
    window.history.pushState(null, "", address(id, nextProfile));
  };
  const select = (id: number) => {
    if (id !== selected) navigate(id);
  };
  const changeShop = (shop: ShopType) => {
    if (shop === profile.shop) return;
    const nextProfile: GuideProfile = { shop, service: shop === "restaurant" ? "dine_in" : "counter", multiBranch: profile.multiBranch };
    navigate(shop === "restaurant" || shop === "food_beverage" || shop === "board_game_cafe" ? 3 : selected, nextProfile);
  };
  const changeService = (service: ServiceStyle) => {
    if (service === profile.service) return;
    navigate(service === "online" ? 7 : 3, { ...profile, service });
  };
  const share = async (native = false) => {
    const request = ++shareRequest.current;
    const url = address(selected, profile);
    setShareStatus(null);
    if (native && navigator.share) {
      try {
        await navigator.share({ title: `BMS · ${detail.title}`, text: detail.description, url: url.href });
        if (shareRequest.current === request) setShareStatus("shared");
        return;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
      }
    }
    if (shareRequest.current !== request) return;
    try { await navigator.clipboard.writeText(url.href); if (shareRequest.current === request) setShareStatus("copied"); }
    catch { if (shareRequest.current === request) { window.history.replaceState(null, "", url.href); setShareStatus("failed"); } }
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
      <div className={styles.profilePanel}>
        <div><h3>{copy.profile.heading}</h3><p>{copy.profile.description}</p></div>
        <fieldset className={styles.shopChoices}><legend>{copy.profile.shopLabel}</legend>
          {(["overview", "restaurant", "food_beverage", "board_game_cafe"] as ShopType[]).map(shop => <button key={shop} type="button" aria-pressed={profile.shop === shop} onClick={() => changeShop(shop)}>{shopLabels[shop]}</button>)}
        </fieldset>
        {profile.shop === "restaurant" && <fieldset className={styles.serviceChoices}><legend>{copy.profile.serviceLabel}</legend>
          {(Object.keys(copy.profile.services) as ServiceStyle[]).map(service => <button key={service} type="button" aria-pressed={profile.service === service} onClick={() => changeService(service)}>{copy.profile.services[service]}</button>)}
        </fieldset>}
        {(profile.shop === "restaurant" || profile.shop === "food_beverage") && <label className={styles.branchChoice}><input type="checkbox" checked={profile.multiBranch} onChange={event => navigate(selected, { ...profile, multiBranch: event.target.checked })} />{copy.profile.multiBranch}</label>}
        {recommended.length > 0 && <div className={styles.recommendations}><strong>{copy.profile.recommendedHeading}</strong><div>
          {recommended.map(item => <button key={item.id} type="button" onClick={() => select(item.id)} aria-current={selected === item.id ? "true" : undefined}>{String(item.id).padStart(2, "0")} · {guideFlowCopy(item, profile, lang).title}</button>)}
        </div></div>}
      </div>
      <div className={styles.categories} role="group" aria-label={copy.groupLabel}>
        {copy.groups.map((title, group) => <button key={group} type="button" aria-pressed={flow.group === group} onClick={() => select(restaurantFlows.find(f => f.group === group)!.id)}>{title}</button>)}
      </div>
      <div className={styles.explorer}>
        <nav className={styles.flowList} aria-label={copy.flowLabel}>
          {restaurantFlows.filter(f => f.group === flow.group).map(f => <button key={f.id} type="button" data-flow-id={f.id} aria-pressed={selected === f.id} onClick={() => select(f.id)}>
            <span className={styles.flowNumber}>{String(f.id).padStart(2, "0")}</span><span>{guideFlowCopy(f, profile, lang).title}</span><small>{fitLabel(flowFit(f.id, profile))}</small>
          </button>)}
        </nav>
        <section className={styles.detail} id={`flow-${selected}`} aria-labelledby={`flow-title-${selected}`}>
          <div className={styles.detailHeading}><div>
            <p className={styles.flowKicker}>FLOW {String(flow.id).padStart(2, "0")} · {fitLabel(fit)}</p>
            <h3 id={`flow-title-${selected}`}>{detail.title}</h3><p>{detail.description}</p>
          </div><div className={styles.share}>
            <button className={styles.button} data-print-flow onClick={() => { void document.fonts.ready.then(() => window.print()); }} title={copy.printHint}>{copy.print}</button>
            <button className={styles.button} data-share-flow onClick={() => void share(true)}>{copy.nativeShare}</button>
            <button className={styles.button} data-copy-flow onClick={() => void share()}>{copy.share}</button>
            <span role="status">{shareStatus === "copied" ? copy.copied : shareStatus === "failed" ? copy.copyFailed : shareStatus === "shared" ? copy.shared : ""}</span>
          </div></div>
          {fit === "restaurant_example" && <p className={styles.exampleNotice}>{copy.profile.exampleNotice}</p>}
          <h4 className={styles.diagramHeading}>{copy.diagram}</h4>
          <SequenceDiagram key={`${flow.id}-${lang}-${profile.shop}-${profile.service}-${profile.multiBranch}`} source={detail.source} title={`${copy.diagram}: ${detail.title}`} lang={lang} labels={copy.labels} zoomLabel={copy.zoom} fitLabel={copy.fit} hint={copy.diagramHint} transcriptLabel={copy.transcript} playerCopy={copy.player}
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
