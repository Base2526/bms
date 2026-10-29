import type { JsonLdValue } from "@/lib/seoJsonLd";

export default function StructuredData({ id, data }: { id: string; data: JsonLdValue }) {
  return (
    <script
      id={id}
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
