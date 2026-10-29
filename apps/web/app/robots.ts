import type { MetadataRoute } from "next";
import { publicSiteUrl } from "@/lib/publicSeo";

export default function robots(): MetadataRoute.Robots {
  const privatePaths = [
    "/admin",
    "/admin/",
    "/api/",
    "/checkout",
    "/pos",
    "/pos/",
    "/q/",
    "/bg/",
    "/tax-invoice/",
    "/installer-report",
  ];

  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: privatePaths },
      {
        // ChatGPT Search is controlled independently from GPTBot training use.
        userAgent: "OAI-SearchBot",
        allow: "/",
        disallow: privatePaths,
      },
    ],
    sitemap: `${publicSiteUrl()}/sitemap.xml`,
    host: publicSiteUrl(),
  };
}
