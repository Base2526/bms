'use client';

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Form, Image, Input, Space, Tooltip, Typography, type FormInstance } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useI18n } from "@/lib/i18nContext";
import { isProductGtin, parseProductBarcode, sameProductBarcode, type BarcodeLookupResult, type BarcodeSuggestion } from "@/lib/bms/productBarcodeLookupContract";
import styles from "./BarcodeLookupField.module.css";

type Props = {
  form: FormInstance;
  editingSku?: string;
  generating: boolean;
  onGenerate: () => void;
  onChange: (code: string) => void;
  onApply: (suggestion: BarcodeSuggestion) => void;
  onOpen: (sku: string) => void;
  notice: { tone: "success" | "warning" | "danger"; text: string } | null;
};

export default function BarcodeLookupField(props: Props) {
  const { t } = useI18n();
  const value: string = Form.useWatch("barcode", props.form) ?? "";
  const [resolved, setResolved] = useState<{ input: string; data: BarcodeLookupResult } | null>(null);
  const result = resolved && (value.trim() === resolved.input || sameProductBarcode(value, resolved.input))
    ? resolved.data : null;
  const [state, setState] = useState<"idle" | "loading" | "error" | "limited">("idle");
  const [applied, setApplied] = useState(false);
  const request = useRef<{ controller: AbortController; code: string } | null>(null);
  const lastCode = useRef("");
  const invalidate = useCallback(() => {
    request.current?.controller.abort();
    request.current = null;
    lastCode.current = "";
    setResolved(null);
    setState("idle");
    setApplied(false);
  }, []);

  const lookup = useCallback(async (force = false) => {
    const code = String(props.form.getFieldValue("barcode") ?? "").trim();
    if (!code || request.current?.code === code || (!force && lastCode.current === code)) return;
    request.current?.controller.abort();
    const parsed = parseProductBarcode(code);
    if (!parsed) {
      request.current = null;
      lastCode.current = code;
      setResolved({ input: code, data: { code: "", status: "UNSUPPORTED", matches: [] } });
      setState("idle");
      return;
    }
    const controller = new AbortController();
    request.current = { code, controller };
    const timeout = setTimeout(() => {
      if (request.current?.controller === controller) {
        controller.abort();
        request.current = null;
        setState("error");
      }
    }, 12_000);
    lastCode.current = code;
    setResolved(null);
    setApplied(false);
    setState("loading");
    try {
      const response = await fetch(`/api/bms/products/barcode-lookup?code=${encodeURIComponent(parsed.code)}`, {
        credentials: "same-origin", cache: "no-store", signal: controller.signal,
      });
      if (controller.signal.aborted || props.form.getFieldValue("barcode")?.trim() !== code) return;
      if (!response.ok) { setState(response.status === 429 ? "limited" : "error"); return; }
      const data: BarcodeLookupResult = await response.json();
      if (controller.signal.aborted || props.form.getFieldValue("barcode")?.trim() !== code) return;
      setResolved({ input: code, data });
      setState("idle");
      // Store only the product identifier, never a QR URL/batch/serial in the barcode field.
      if (data.code && data.code !== code) {
        lastCode.current = data.code;
        props.form.setFieldValue("barcode", data.code);
        props.onChange(data.code);
      }
    } catch {
      if (!controller.signal.aborted) setState("error");
    } finally {
      clearTimeout(timeout);
      if (request.current?.controller === controller) request.current = null;
    }
  }, [props.form, props.onChange]);

  useEffect(() => {
    if (!value.trim() || props.editingSku) return;
    const timer = setTimeout(() => void lookup(), 650);
    return () => clearTimeout(timer);
  }, [value, lookup, props.editingSku]);
  useEffect(() => () => {
    request.current?.controller.abort();
    request.current = null;
  }, []);

  const statusText = result ? {
    LOCAL: t("admin_products.lookup_local"),
    EXTERNAL: t("admin_products.lookup_external"),
    NOT_FOUND: t("admin_products.lookup_not_found"),
    NOT_CONFIGURED: t("admin_products.lookup_not_configured"),
    UNSUPPORTED: t("admin_products.lookup_unsupported"),
    UNAVAILABLE: t("admin_products.lookup_unavailable"),
  }[result.status] : null;
  const suggestion = result?.suggestion;

  return <div className={styles.field}>
    <Form.Item label={t("admin_products.lookup_label")}>
      <div className={styles.controls}>
        <Form.Item name="barcode" noStyle rules={[{
          validator: (_rule, code) => {
            const parsed = parseProductBarcode(String(code ?? ""));
            if (/^https?:\/\//i.test(String(code ?? "").trim())) {
              return Promise.reject(new Error(t("admin_products.lookup_qr_pending")));
            }
            if (parsed && result?.code === parsed.code && result.status === "LOCAL"
              && result.matches.some((match) => match.sku !== props.editingSku)) {
              return Promise.reject(new Error(t("admin_products.lookup_local")));
            }
            return Promise.resolve();
          },
        }]}>
          <Input maxLength={512} aria-label={t("admin_products.lookup_label")} placeholder={t("admin_products.placeholder_barcode")}
            onChange={(e) => { invalidate(); props.onChange(e.target.value); }}
            onPressEnter={(e) => { e.preventDefault(); e.stopPropagation(); void lookup(); }} />
        </Form.Item>
        <Tooltip title={t("admin_products.lookup_search")}>
          <Button icon={<SearchOutlined />} loading={state === "loading"} disabled={!value.trim()}
            aria-label={t("admin_products.lookup_search")} onClick={() => void lookup(true)} />
        </Tooltip>
        <Button loading={props.generating} onClick={() => { invalidate(); props.onGenerate(); }}>
          {t("admin_products.barcode_generate")}
        </Button>
      </div>
      {value.length === 14 && isProductGtin(value)
        ? <Typography.Text type="success">{t("admin_products.barcode_valid").replace("{symbology}", "GTIN-14")}</Typography.Text>
        : props.notice && <Typography.Text type={props.notice.tone}>{props.notice.text}</Typography.Text>}
    </Form.Item>
    <div aria-live="polite">
      {state === "loading" && <Typography.Text type="secondary">{t("admin_products.lookup_loading")}</Typography.Text>}
      {(state === "error" || state === "limited") && <Alert closable onClose={() => setState("idle")} type="warning" showIcon message={state === "limited"
        ? t("admin_products.lookup_limited") : t("admin_products.lookup_unavailable")} />}
      {result && <Alert key={`${result.code}:${result.status}`} closable type={result.status === "LOCAL" ? "warning" : "info"} showIcon
        message={statusText} description={<>
          {result.matches.map((match) => <div className={styles.match} key={match.sku}>
            {match.imageUrl && <Image src={match.imageUrl} alt={match.name} width={56} height={56} style={{ objectFit: "contain" }} />}
            <div className={styles.details}><strong>{match.name}</strong><div>{match.sku}</div>
              {!match.active && <Typography.Text type="secondary">{t("admin_products.lookup_inactive")}</Typography.Text>}
            </div>
            <Button onClick={() => {
              if (sameProductBarcode(result.code, String(props.form.getFieldValue("barcode") ?? ""))) props.onOpen(match.sku);
            }}>{t("admin_products.lookup_open")}</Button>
          </div>)}
          {suggestion && <>
            <div className={styles.match}>
              {suggestion.imageUrl && <Image src={suggestion.imageUrl} alt={suggestion.name} width={72} height={72} style={{ objectFit: "contain" }} />}
              <div className={styles.details}><strong>{suggestion.name}</strong>
                <div>{[suggestion.brand, suggestion.size].filter(Boolean).join(" · ")}</div>
                <a href={suggestion.sourceUrl} target="_blank" rel="noopener noreferrer">{suggestion.source}</a>
              </div>
            </div>
            <Space wrap>
              <Button disabled={applied} onClick={() => {
                if (!sameProductBarcode(result.code, String(props.form.getFieldValue("barcode") ?? ""))) return;
                props.onApply(suggestion); setApplied(true);
              }}>
                {applied ? t("admin_products.lookup_applied") : t("admin_products.lookup_apply")}
              </Button>
            </Space>
          </>}
        </>} />}
    </div>
  </div>;
}
