export type CustomerChannelIdentity = {
  channel: string;
  customerRef: string;
};

export type OrderChannelAttribution = {
  channel: string;
  customerRef: string | null;
};

export function normalizeCustomerIdentity(
  channel: string | null | undefined,
  customerRef: string | null | undefined
): CustomerChannelIdentity | null {
  const normalizedChannel = String(channel ?? "").trim().toLocaleLowerCase();
  const normalizedRef = String(customerRef ?? "").trim();
  if (!normalizedChannel || !normalizedRef) return null;
  return { channel: normalizedChannel, customerRef: normalizedRef };
}

/** A customer-initiated reorder belongs to the channel currently talking to us. */
export function reorderTargetIdentity(
  source: OrderChannelAttribution,
  current?: CustomerChannelIdentity | null
): OrderChannelAttribution {
  return current ?? source;
}
