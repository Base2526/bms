// utils/date.ts
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
dayjs.extend(utc);
dayjs.extend(timezone);

export function formatDate(timestamp: number | string, format = 'DD/MM/YYYY') {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    if (typeof timestamp === 'number') {
        return dayjs(timestamp).tz(tz).format(format);
    }

    const asNumber = Number(timestamp);
    if (Number.isFinite(asNumber)) {
        return dayjs(asNumber).tz(tz).format(format);
    }

    return dayjs(timestamp).tz(tz).format(format);
}

const BANGKOK_DAY = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
});

/**
 * YYYY-MM-DD of the given instant in Asia/Bangkok — the shop's calendar day. Not
 * toISOString().slice(0, 10), which is still "yesterday" from 00:00 to 06:59 in Thailand.
 */
export function bangkokDateKey(at: Date = new Date()): string {
    return BANGKOK_DAY.format(at);
}
