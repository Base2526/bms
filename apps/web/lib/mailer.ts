import sgMail from "@sendgrid/mail";
import { addLog } from "@/lib/log/log.server";

let initialized = false;

function initSendGrid() {
  if (initialized) return;

  const key = process.env.NEXT_PUBLIC_SENDGRID_API_KEY;
  if (!key) {
    // log ตอน init พัง
    addLog(
      "error",
      "email",
      "SendGrid init failed: missing API key",
      { env: "NEXT_PUBLIC_SENDGRID_API_KEY" }
    );
    throw new Error("Missing SENDGRID_API_KEY");
  }

  sgMail.setApiKey(key);
  initialized = true;
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}) {
  const from = process.env.NEXT_PUBLIC_SENDGRID_FROM_EMAIL;

  if (!from) {
    addLog(
      "error",
      "email",
      "SendGrid send failed: missing FROM email",
      { env: "NEXT_PUBLIC_SENDGRID_FROM_EMAIL" }
    );
    throw new Error("Missing SENDGRID_FROM_EMAIL");
  }

  // log: ก่อนส่ง
  await addLog("info", "email", "Sending email", {
    to: opts.to,
    subject: opts.subject,
  });

  try {
    initSendGrid();

    const [res] = await sgMail.send({
      to: opts.to,
      from,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    });

    // log: ส่งสำเร็จ
    await addLog("info", "email", "Email sent successfully", {
      to: opts.to,
      subject: opts.subject,
      statusCode: res?.statusCode,
      headers: res?.headers,
    });

    return true;
  } catch (err: any) {
    // log: ส่งล้มเหลว
    await addLog("error", "email", "Email send failed", {
      to: opts.to,
      subject: opts.subject,
      error: err?.message || err,
      response: err?.response?.body,
      statusCode: err?.code || err?.response?.statusCode,
    });

    // อย่า swallow error – ให้ resolver จัดการต่อ
    throw err;
  }
}
