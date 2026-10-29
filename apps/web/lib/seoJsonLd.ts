import { absolutePublicUrl, localizedPublicPath, type PublicSeoLocale } from "@/lib/publicSeo";

export type JsonLdValue = Record<string, unknown> | Array<Record<string, unknown>>;

export function organizationJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${absolutePublicUrl("/")}#organization`,
    name: "BMS",
    url: absolutePublicUrl("/"),
    logo: absolutePublicUrl("/icons/ios-icon-1024.png"),
    description: "BMS is an AI-first business operating system that connects customer conversations to CRM, orders, inventory, payments, shipping and dashboards.",
    knowsAbout: [
      "business management",
      "customer relationship management",
      "point of sale",
      "inventory management",
      "restaurant operations",
      "AI-assisted business workflows",
    ],
  };
}

export function websiteJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${absolutePublicUrl("/")}#website`,
    name: "BMS",
    url: absolutePublicUrl("/"),
    publisher: { "@id": `${absolutePublicUrl("/")}#organization` },
    about: { "@id": `${absolutePublicUrl("/")}#organization` },
    inLanguage: ["th-TH", "en-US"],
  };
}

export function webPageJsonLd(input: {
  locale: PublicSeoLocale;
  path: string;
  title: string;
  description: string;
  reviewedAt: string;
  type?: "WebPage" | "AboutPage";
}): Record<string, unknown> {
  const url = absolutePublicUrl(localizedPublicPath(input.path, input.locale));
  return {
    "@context": "https://schema.org",
    "@type": input.type ?? "WebPage",
    "@id": `${url}#webpage`,
    url,
    name: input.title,
    description: input.description,
    inLanguage: input.locale === "th" ? "th-TH" : "en-US",
    dateModified: input.reviewedAt,
    isPartOf: { "@id": `${absolutePublicUrl("/")}#website` },
    about: { "@id": `${absolutePublicUrl("/")}#organization` },
    ...(input.type === "AboutPage"
      ? { mainEntity: { "@id": `${absolutePublicUrl("/")}#organization` } }
      : {}),
  };
}

export function faqPageJsonLd(
  items: Array<{ question: string; answer: string }>,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
}

export function breadcrumbJsonLd(
  locale: PublicSeoLocale,
  items: Array<{ name: string; path: string }>,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absolutePublicUrl(localizedPublicPath(item.path, locale)),
    })),
  };
}

export function learningArticleJsonLd(input: {
  locale: PublicSeoLocale;
  path: string;
  title: string;
  description: string;
  reviewedAt: string;
}): Record<string, unknown> {
  const url = absolutePublicUrl(localizedPublicPath(input.path, input.locale));
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    "@id": `${url}#article`,
    headline: input.title,
    description: input.description,
    mainEntityOfPage: url,
    url,
    inLanguage: input.locale === "th" ? "th-TH" : "en-US",
    dateModified: input.reviewedAt,
    author: { "@id": `${absolutePublicUrl("/")}#organization` },
    publisher: { "@id": `${absolutePublicUrl("/")}#organization` },
    image: absolutePublicUrl("/og.png"),
  };
}
