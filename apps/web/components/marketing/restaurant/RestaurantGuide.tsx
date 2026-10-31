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
import { ADDITIONAL_GUIDE_SHOPS, PRIMARY_GUIDE_SHOPS, flowFit, guideFlows, guideFlowCopy, type GuideProfile, type ServiceStyle, type ShopType } from "./guideProfiles";
import SequenceDiagram from "./SequenceDiagram";
import styles from "./restaurant.module.css";
import { localizedPublicPath } from "@/lib/publicSeo";

function JourneyIcon({ index }: { index: number }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...common}>
    {index === 0 && <><path d="M5 8h14l-1 11H6L5 8Z" /><path d="m8 8 2-4m6 4-2-4M4 8h16" /></>}
    {index === 1 && <><path d="M7 3h10a2 2 0 0 1 2 2v16l-3-2-4 2-4-2-3 2V5a2 2 0 0 1 2-2Z" /><path d="M8 8h8m-8 4h8m-8 4h5" /></>}
    {index === 2 && <><path d="M5 12a4 4 0 0 1 3-3.87A4.5 4.5 0 0 1 16.5 7 4 4 0 0 1 19 14H5a2 2 0 0 1 0-4" /><path d="M7 14v5h10v-5" /></>}
    {index === 3 && <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 9h18M6 15h4" /></>}
    {index === 4 && <><path d="M4 20V10m5 10V4m6 16v-7m5 7V7" /><path d="m3 6 5-3 6 5 6-5" /></>}
    {index === 5 && <><path d="M3 21h18M5 21V10l7-5 7 5v11" /><path d="M9 21v-6h6v6M9 10h6" /></>}
  </svg>;
}
// Journey copy starts with the central kitchen (icon 5); the remaining steps keep their original icons.
const JOURNEY_ICONS = [5, 0, 1, 2, 3, 4];

function TrustIcon({ index }: { index: number }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...common}>
    {index === 0 && <><ellipse cx="12" cy="5" rx="7" ry="3" /><path d="M5 5v7c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 12v7c0 1.7 3.1 3 7 3s7-1.3 7-3v-7" /></>}
    {index === 1 && <><path d="M12 3 4.5 6v5.5c0 4.7 3.2 7.9 7.5 9.5 4.3-1.6 7.5-4.8 7.5-9.5V6L12 3Z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></>}
    {index === 2 && <><path d="m13 2-9 12h7l-1 8 10-13h-7V2Z" /></>}
  </svg>;
}

export default function RestaurantGuide({ children }: { children?: React.ReactNode }) {
  const { lang, t } = useI18n(), { admin, loading } = useSessionCtx();
  const copy = resolveBilingual(restaurantCopy, lang);
  const { setOverride, clearOverride } = useBreadcrumbsOverride();
  const homeLabel = t("breadcrumbs.home");
  useEffect(() => {
    setOverride("/restaurant", [{ href: "/", label: homeLabel }, { label: copy.breadcrumb }]);
    return () => clearOverride("/restaurant");
  }, [setOverride, clearOverride, homeLabel, copy.breadcrumb]);
  const [selected, setSelected] = useState(3), [shareStatus, setShareStatus] = useState<"copied" | "failed" | "shared" | null>(null);
  const [profile, setProfile] = useState<GuideProfile>({ shop: "overview", service: "dine_in", multiBranch: false, centralKitchen: false });
  const [includeExamples, setIncludeExamples] = useState(false);
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
      const multiBranch = url.searchParams.get("branches") === "multi";
      setProfile({
        shop: shop === "restaurant" || shop === "food_beverage" || shop === "board_game_cafe" ? shop : "overview",
        service: service === "counter" || service === "online" ? service : "dine_in",
        multiBranch,
        centralKitchen: multiBranch && url.searchParams.get("kitchen") === "central",
      });
      setShareStatus(null);
      setIncludeExamples(false);
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
  // Keep existing shared deep links readable, with an explicit reference warning.
  const showingExamples = includeExamples || fit === "restaurant_example";
  const visibleIds = guideFlows(profile, showingExamples);
  const visibleFlows = restaurantFlows.filter(item => visibleIds.includes(item.id));
  const hasExamples = guideFlows(profile).length < restaurantFlows.length;
  const branchShop = profile.shop === "restaurant" || profile.shop === "food_beverage";
  const scopeSummary = copy.profile.scopes[profile.shop === "restaurant" ? profile.service : profile.shop]
    + (branchShop && profile.multiBranch && profile.centralKitchen ? ` ${copy.profile.centralKitchenScope}` : "");
  const printScope = `${profile.shop === "board_game_cafe" ? copy.profile.additionalHeading : copy.profile.primaryHeading} · ${shopLabels[profile.shop]}${profile.shop === "restaurant" ? ` · ${copy.profile.services[profile.service]}` : ""}`;
  const fitLabel = (value: ReturnType<typeof flowFit>) => value === "restaurant_example" ? copy.profile.restaurantExample : copy.profile[value];
  const recommended = restaurantFlows.filter(item => flowFit(item.id, profile) === "recommended");
  const learningPath = profile.shop === "food_beverage"
    ? "/learn/retail?format=food-counter"
    : profile.shop === "board_game_cafe"
      ? "/learn/board-game"
      : profile.shop === "restaurant"
        ? `/learn/restaurant?format=${profile.service === "dine_in" ? "dine-in" : profile.service === "counter" ? "counter-kitchen" : "pickup-delivery"}`
        : "/learn/restaurant";
  const learningHref = localizedPublicPath(learningPath, lang);
  const address = (id: number, nextProfile: GuideProfile) => {
    const url = new URL(window.location.href);
    if (nextProfile.shop === "overview") url.searchParams.delete("shop");
    else url.searchParams.set("shop", nextProfile.shop);
    if (nextProfile.shop === "restaurant" && nextProfile.service !== "dine_in") url.searchParams.set("service", nextProfile.service);
    else url.searchParams.delete("service");
    if (nextProfile.multiBranch) url.searchParams.set("branches", "multi");
    else url.searchParams.delete("branches");
    if (nextProfile.multiBranch && nextProfile.centralKitchen) url.searchParams.set("kitchen", "central");
    else url.searchParams.delete("kitchen");
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
    setIncludeExamples(false);
    const nextProfile: GuideProfile = { shop, service: shop === "restaurant" ? "dine_in" : "counter", multiBranch: profile.multiBranch, centralKitchen: profile.centralKitchen };
    navigate(shop === "restaurant" || shop === "food_beverage" || shop === "board_game_cafe" ? 3 : selected, nextProfile);
  };
  const changeService = (service: ServiceStyle) => {
    if (service === profile.service) return;
    setIncludeExamples(false);
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
      <div className={styles.heroCopy}>
        <p className={styles.eyebrow}>BMS FOR RESTAURANTS &amp; CAFÉS</p>
        <h1>{copy.title}</h1>
        <p className={styles.intro}>{copy.description}</p>
        <div className={styles.actions}>
          <a className={styles.primaryButton} href="#restaurant-flows">{copy.explore} <span aria-hidden="true">↓</span></a>
          <Link className={styles.button} href={learningHref}>{copy.learnGuide} <span aria-hidden="true">→</span></Link>
        </div>
        <nav className={styles.heroLinks} aria-label={lang === "th" ? "เครื่องมือเพิ่มเติม" : "More tools"}>
          <Link href={localizedPublicPath("/cost-pricing", lang)}>{lang === "th" ? "คำนวณต้นทุนและราคาขาย" : "Costs and selling prices"} <span aria-hidden="true">→</span></Link>
          <a href={BMS_LINE_OA_URL} target="_blank" rel="noopener noreferrer">{copy.contact} <span aria-hidden="true">↗</span></a>
        </nav>
      </div>

      <div className={styles.heroVisual}>
        <ol className={styles.journey} aria-label={lang === "th" ? "ลำดับการทำงานของร้าน" : "Restaurant workflow"}>
          {copy.journey.map((step, index) => <li key={step}>
            <span className={styles.journeyIcon}><JourneyIcon index={JOURNEY_ICONS[index]} /></span>
            <strong>{step}</strong>
          </li>)}
        </ol>
        <div className={styles.visualBottom}>
          <div className={styles.signalCard}>
            <span className={styles.signalIcon}><TrustIcon index={0} /></span>
            <span><strong>{copy.heroSignalTitle}</strong><small>{copy.heroSignalDescription}</small></span>
          </div>
          <div className={styles.operationsPreview} aria-hidden="true">
            <div className={styles.previewTop}><span /><span /></div>
            <div className={styles.previewBody}>
              <div className={styles.previewNav}><i /><i /><i /></div>
              <div className={styles.previewRows}><span /><span /><span /><span /></div>
            </div>
          </div>
        </div>
      </div>
    </header>

    <section className={styles.trustStrip} aria-label={lang === "th" ? "จุดเด่นของ BMS" : "Why BMS"}>
      {copy.trustPoints.map((point, index) => <div className={styles.trustItem} key={point.title}>
        <span className={styles.trustIcon}><TrustIcon index={index} /></span>
        <span><strong>{point.title}</strong><small>{point.description}</small></span>
      </div>)}
    </section>

    <section id="restaurant-flows" className={styles.explore} aria-labelledby="restaurant-flows-title">
      <div className={styles.sectionHead}><p className={styles.eyebrow}>HOW YOUR RESTAURANT WORKS</p>
        <h2 id="restaurant-flows-title">{copy.explorerTitle}</h2><p>{copy.explorerDescription}</p>
      </div>
      <div className={styles.profilePanel}>
        <div><h3>{copy.profile.heading}</h3><p>{copy.profile.description}</p></div>
        <fieldset className={styles.shopChoices} data-primary-shops><legend>{copy.profile.primaryHeading}</legend>
          {PRIMARY_GUIDE_SHOPS.map(shop => <button key={shop} type="button" data-shop={shop} aria-pressed={profile.shop === shop} onClick={() => changeShop(shop)}>{shopLabels[shop]}</button>)}
        </fieldset>
        <div className={styles.additionalShops} data-additional-shops>
          <fieldset className={styles.shopChoices} aria-describedby="additional-shop-description"><legend>{copy.profile.additionalHeading}</legend>
            {ADDITIONAL_GUIDE_SHOPS.map(shop => <button key={shop} type="button" data-shop={shop} aria-pressed={profile.shop === shop} onClick={() => changeShop(shop)}>{shopLabels[shop]}</button>)}
          </fieldset>
          <p id="additional-shop-description">{copy.profile.additionalDescription}</p>
        </div>
        {profile.shop === "restaurant" && <fieldset className={styles.serviceChoices}><legend>{copy.profile.serviceLabel}</legend>
          {(Object.keys(copy.profile.services) as ServiceStyle[]).map(service => <button key={service} type="button" aria-pressed={profile.service === service} onClick={() => changeService(service)}>{copy.profile.services[service]}</button>)}
        </fieldset>}
        {branchShop && <label className={styles.branchChoice}><input type="checkbox" checked={profile.multiBranch} onChange={event => {
          const multiBranch = event.target.checked;
          navigate(!multiBranch && selected === 12 ? 2 : selected, { ...profile, multiBranch, centralKitchen: multiBranch && profile.centralKitchen });
        }} />{copy.profile.multiBranch}</label>}
        {branchShop && profile.multiBranch && <label className={styles.branchChoice}><input data-central-kitchen type="checkbox" checked={!!profile.centralKitchen} onChange={event => {
          const centralKitchen = event.target.checked;
          navigate(centralKitchen ? 12 : selected, { ...profile, centralKitchen });
        }} />{copy.profile.centralKitchen}</label>}
        <p className={styles.profileScope} data-profile-scope>{scopeSummary}</p>
        {hasExamples && <label className={styles.branchChoice}><input data-show-examples type="checkbox" checked={showingExamples} onChange={event => {
          setIncludeExamples(event.target.checked);
          if (!event.target.checked && fit === "restaurant_example") navigate(profile.shop === "restaurant" && profile.service === "online" ? 7 : 3);
        }} />{copy.profile.showExamples}</label>}
        {recommended.length > 0 && <div className={styles.recommendations}><strong>{copy.profile.recommendedHeading}</strong><div>
          {recommended.map(item => <button key={item.id} type="button" onClick={() => select(item.id)} aria-current={selected === item.id ? "true" : undefined}>{String(item.id).padStart(2, "0")} · {guideFlowCopy(item, profile, lang).title}</button>)}
        </div></div>}
      </div>
      <div className={styles.categories} role="group" aria-label={copy.groupLabel}>
        {copy.groups.map((title, group) => visibleFlows.some(item => item.group === group) && <button key={group} type="button" aria-pressed={flow.group === group} onClick={() => select(visibleFlows.find(f => f.group === group)!.id)}>{title}</button>)}
      </div>
      <div className={styles.explorer}>
        <nav className={styles.flowList} aria-label={copy.flowLabel}>
          {visibleFlows.filter(f => f.group === flow.group).map(f => <button key={f.id} type="button" data-flow-id={f.id} aria-pressed={selected === f.id} onClick={() => select(f.id)}>
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
          {fit === "restaurant_example" && <p className={styles.exampleNotice} data-flow-reference>{copy.profile.exampleNotice}</p>}
          <h4 className={styles.diagramHeading}>{copy.diagram}</h4>
          <SequenceDiagram key={`${flow.id}-${lang}-${profile.shop}-${profile.service}-${profile.multiBranch}`} source={detail.source} title={`${copy.diagram}: ${detail.title}`} lang={lang} labels={copy.labels} zoomLabel={copy.zoom} fitLabel={copy.fit} hint={copy.diagramHint} transcriptLabel={copy.transcript} playerCopy={copy.player}
            printFlow={{ id: flow.id, title: detail.title, description: detail.description, note: detail.note, pageLabel: copy.page, continued: copy.continued, scope: `${printScope} · ${fitLabel(fit)}. ${copy.scope}` }} />
          <p className={styles.boundary}>{detail.note}</p>
        </section>
      </div>
    </section>

    <section className={styles.readiness} aria-labelledby="restaurant-readiness-title">
      <div><h2>{copy.fitTitle}</h2><p>{copy.fitDescription}</p><ul className={styles.fitTags}>{copy.fits.map(fit => <li key={fit}>{fit}</li>)}</ul></div>
      <div><h2 id="restaurant-readiness-title">{copy.readinessTitle}</h2><ul className={styles.limits}>{copy.readiness.map(point => <li key={point}>{point}</li>)}</ul></div>
    </section>
    {children}
    <section className={styles.cta}><div><h2>{copy.ctaTitle}</h2><p>{copy.ctaDescription}</p></div><div className={styles.actions}>
      <a className={styles.primaryButton} href={BMS_LINE_OA_URL} target="_blank" rel="noopener noreferrer">{copy.contact} ↗</a>
      <Link className={styles.button} href={learningHref}>{copy.learnGuide} →</Link>
      {!loading && <Link className={styles.button} href={admin ? "/admin/dashboard" : "/shop-signup"}>{admin ? copy.dashboard : copy.signup}</Link>}
    </div></section>
    <p className={styles.scope}>{copy.scope}</p>
  </article>;
}
