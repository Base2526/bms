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
