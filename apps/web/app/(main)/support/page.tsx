"use client";

import { useMemo, useState } from "react";
import { Card, Col, Form, Input, Row, Select, Typography, Button, message, Collapse } from "antd";
import { gql, useMutation } from "@apollo/client";
import { useI18n } from "@/lib/i18nContext";
import { resolveBilingual } from "@/lib/static-page-i18n";

const { Title, Text } = Typography;
const { TextArea } = Input;

const CREATE_SUPPORT_TICKET = gql`
  mutation CreateSupportTicket($input: SupportTicketInput!) {
    createSupportTicket(input: $input) {
      ok
      message
      ticketId
    }
  }
`;

type SupportFormValues = {
  name: string;
  email: string;
  topic: string;
  subject: string;
  message: string;
  phone?: string;
  ref?: string;
};

type SupportContent = {
  title: string;
  subtitle: string;
  form: {
    nameLabel: string;
    emailLabel: string;
    phoneLabel: string;
    topicLabel: string;
    subjectLabel: string;
    refLabel: string;
    messageLabel: string;
    submit: string;
    placeholders: {
      name: string;
      email: string;
      phone: string;
      subject: string;
      ref: string;
      message: string;
    };
    validation: {
      nameRequired: string;
      emailRequired: string;
      emailInvalid: string;
      topicRequired: string;
      subjectRequired: string;
      messageRequired: string;
    };
    topics: Array<{ value: string; label: string }>;
  };
  contact: {
    title: string;
    emailLabel: string;
    emailValue: string;
    hoursLabel: string;
    hoursValue: string;
    tipLabel: string;
    tipText: string;
  };
  faq: {
    title: string;
    items: Array<{
      key: string;
      label: string;
      lines: string[];
    }>;
  };
  toast: {
    sendFailed: string;
    sent: string;
    sentWithTicket: (ticketId: string) => string;
    genericError: string;
  };
};

const SUPPORT: { en: SupportContent; th: SupportContent } = {
  en: {
    title: "Support",
    subtitle: "Tell us what you need help with. We usually reply within 24 hours.",
    form: {
      nameLabel: "Name",
      emailLabel: "Email",
      phoneLabel: "Phone (optional)",
      topicLabel: "Topic",
      subjectLabel: "Subject",
      refLabel: "Reference (optional)",
      messageLabel: "Message",
      submit: "Send to Support",
      placeholders: {
        name: "Your name",
        email: "you@example.com",
        phone: "+66...",
        subject: "Short summary",
        ref: "e.g. order id, phone number, screenshot id",
        message: "Explain the problem, steps to reproduce, etc.",
      },
      validation: {
        nameRequired: "Please enter your name",
        emailRequired: "Please enter your email",
        emailInvalid: "Invalid email",
        topicRequired: "Please choose a topic",
        subjectRequired: "Please enter a subject",
        messageRequired: "Please describe your issue",
      },
      topics: [
        { value: "general", label: "General" },
        { value: "account", label: "Account" },
        { value: "billing", label: "Billing" },
        { value: "bug", label: "Bug report" },
        { value: "feature", label: "Feature request" },
      ],
    },
    contact: {
      title: "Contact",
      emailLabel: "Email:",
      emailValue: "support@yourdomain.com",
      hoursLabel: "Hours:",
      hoursValue: "Mon–Fri (9:00–18:00)",
      tipLabel: "Tip:",
      tipText: "Include screenshot / reference id for faster help.",
    },
    faq: {
      title: "FAQ",
      items: [
        {
          key: "1",
          label: "I didn’t receive the verification email",
          lines: [
            "1) Check spam/junk folder",
            "2) Wait 1–2 minutes and try resend",
            "3) Make sure the email address is correct",
          ],
        },
        {
          key: "2",
          label: "Password reset link is expired",
          lines: [
            "Reset links expire for security.",
            "Go to Forgot Password and request a new link.",
          ],
        },
        {
          key: "3",
          label: "I want to delete my account",
          lines: [
            "Send a request via the form below (Topic: Account).",
            "We will verify ownership and proceed.",
          ],
        },
      ],
    },
    toast: {
      sendFailed: "Failed to send",
      sent: "Sent!",
      sentWithTicket: (ticketId) => `Sent! Ticket: ${ticketId}`,
      genericError: "Something went wrong",
    },
  },
  th: {
    title: "ช่วยเหลือ",
    subtitle: "บอกเราว่าคุณต้องการความช่วยเหลือเรื่องอะไร โดยปกติเราจะตอบกลับภายใน 24 ชั่วโมง",
    form: {
      nameLabel: "ชื่อ",
      emailLabel: "อีเมล",
      phoneLabel: "โทรศัพท์ (ไม่บังคับ)",
      topicLabel: "หัวข้อ",
      subjectLabel: "เรื่อง",
      refLabel: "ข้อมูลอ้างอิง (ไม่บังคับ)",
      messageLabel: "รายละเอียด",
      submit: "ส่งถึงทีมช่วยเหลือ",
      placeholders: {
        name: "ชื่อของคุณ",
        email: "you@example.com",
        phone: "+66...",
        subject: "สรุปสั้น ๆ",
        ref: "เช่น เลขออเดอร์, เบอร์โทร, รหัสรูป/สกรีนช็อต",
        message: "อธิบายปัญหา ขั้นตอนที่ทำ และรายละเอียดที่เกี่ยวข้อง",
      },
      validation: {
        nameRequired: "กรุณากรอกชื่อ",
        emailRequired: "กรุณากรอกอีเมล",
        emailInvalid: "รูปแบบอีเมลไม่ถูกต้อง",
        topicRequired: "กรุณาเลือกหัวข้อ",
        subjectRequired: "กรุณากรอกเรื่อง",
        messageRequired: "กรุณาอธิบายปัญหาที่พบ",
      },
      topics: [
        { value: "general", label: "ทั่วไป" },
        { value: "account", label: "บัญชีผู้ใช้" },
        { value: "billing", label: "การชำระเงิน" },
        { value: "bug", label: "รายงานบั๊ก" },
        { value: "feature", label: "ขอฟีเจอร์" },
      ],
    },
    contact: {
      title: "ติดต่อ",
      emailLabel: "อีเมล:",
      emailValue: "support@yourdomain.com",
      hoursLabel: "เวลาให้บริการ:",
      hoursValue: "จันทร์–ศุกร์ (9:00–18:00)",
      tipLabel: "ทิป:",
      tipText: "แนบสกรีนช็อต / ข้อมูลอ้างอิง เพื่อช่วยให้ตรวจสอบได้เร็วขึ้น",
    },
    faq: {
      title: "คำถามที่พบบ่อย",
      items: [
        {
          key: "1",
          label: "ไม่ได้รับอีเมลยืนยันตัวตน",
          lines: [
            "1) ตรวจสอบโฟลเดอร์สแปม/จดหมายขยะ",
            "2) รอ 1–2 นาที แล้วลองกดส่งใหม่",
            "3) ตรวจสอบว่าอีเมลที่กรอกถูกต้อง",
          ],
        },
        {
          key: "2",
          label: "ลิงก์รีเซ็ตรหัสผ่านหมดอายุ",
          lines: [
            "ลิงก์รีเซ็ตมีอายุจำกัดเพื่อความปลอดภัย",
            "ไปที่ “ลืมรหัสผ่าน” แล้วขอลิงก์ใหม่อีกครั้ง",
          ],
        },
        {
          key: "3",
          label: "ต้องการลบบัญชีผู้ใช้",
          lines: [
            "ส่งคำขอผ่านฟอร์มด้านล่าง (หัวข้อ: บัญชีผู้ใช้)",
            "เราจะตรวจสอบความเป็นเจ้าของบัญชีและดำเนินการต่อ",
          ],
        },
      ],
    },
    toast: {
      sendFailed: "ส่งไม่สำเร็จ",
      sent: "ส่งแล้ว",
      sentWithTicket: (ticketId) => `ส่งแล้ว (Ticket: ${ticketId})`,
      genericError: "เกิดข้อผิดพลาด",
    },
  },
};

export default function SupportPage() {
  const { lang } = useI18n();
  const content = resolveBilingual(SUPPORT, lang);

  const [form] = Form.useForm<SupportFormValues>();
  const [mutate] = useMutation(CREATE_SUPPORT_TICKET);
  const [loading, setLoading] = useState(false);

  const faqItems = useMemo(
    () => [
      ...content.faq.items.map((it) => ({
        key: it.key,
        label: it.label,
        children: (
          <div>
            {it.lines.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        ),
      })),
    ],
    [content]
  );

  const onSubmit = async (values: SupportFormValues) => {
    try {
      setLoading(true);

      const input = {
        name: values.name,
        email: values.email,
        phone: values.phone || null,
        topic: values.topic,
        subject: values.subject,
        message: values.message,
        ref: values.ref || null,
        pageUrl: typeof window !== "undefined" ? window.location.href : null,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      };

      const { data } = await mutate({ variables: { input } });

      if (!data?.createSupportTicket?.ok) {
        message.error(data?.createSupportTicket?.message || content.toast.sendFailed);
        return;
      }

      message.success(
        data.createSupportTicket.ticketId
          ? content.toast.sentWithTicket(data.createSupportTicket.ticketId)
          : content.toast.sent
      );
      form.resetFields();
    } catch (err: any) {
      message.error(err?.message || content.toast.genericError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "24px 14px" }}>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={16}>
          <Card style={{ borderRadius: 14 }}>
            <Title level={3} style={{ marginTop: 0 }}>
              {content.title}
            </Title>
            <Text type="secondary">
              {content.subtitle}
            </Text>

            <div style={{ height: 16 }} />

            <Form
              form={form}
              layout="vertical"
              onFinish={onSubmit}
              initialValues={{ topic: "general" }}
            >
              <Row gutter={12}>
                <Col xs={24} md={12}>
                  <Form.Item
                    label={content.form.nameLabel}
                    name="name"
                    rules={[{ required: true, message: content.form.validation.nameRequired }]}
                  >
                    <Input placeholder={content.form.placeholders.name} />
                  </Form.Item>
                </Col>

                <Col xs={24} md={12}>
                  <Form.Item
                    label={content.form.emailLabel}
                    name="email"
                    rules={[
                      { required: true, message: content.form.validation.emailRequired },
                      { type: "email", message: content.form.validation.emailInvalid },
                    ]}
                  >
                    <Input placeholder={content.form.placeholders.email} />
                  </Form.Item>
                </Col>

                <Col xs={24} md={12}>
                  <Form.Item label={content.form.phoneLabel} name="phone">
                    <Input placeholder={content.form.placeholders.phone} />
                  </Form.Item>
                </Col>

                <Col xs={24} md={12}>
                  <Form.Item
                    label={content.form.topicLabel}
                    name="topic"
                    rules={[{ required: true, message: content.form.validation.topicRequired }]}
                  >
                    <Select
                      options={[
                        ...content.form.topics,
                      ]}
                    />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item
                label={content.form.subjectLabel}
                name="subject"
                rules={[{ required: true, message: content.form.validation.subjectRequired }]}
              >
                <Input placeholder={content.form.placeholders.subject} />
              </Form.Item>

              <Form.Item label={content.form.refLabel} name="ref">
                <Input placeholder={content.form.placeholders.ref} />
              </Form.Item>

              <Form.Item
                label={content.form.messageLabel}
                name="message"
                rules={[{ required: true, message: content.form.validation.messageRequired }]}
              >
                <TextArea rows={6} placeholder={content.form.placeholders.message} />
              </Form.Item>

              <Button type="primary" htmlType="submit" loading={loading} block>
                {content.form.submit}
              </Button>
            </Form>
          </Card>
        </Col>

        <Col xs={24} md={8}>
          <Card style={{ borderRadius: 14, marginBottom: 16 }}>
            <Title level={5} style={{ marginTop: 0 }}>
              {content.contact.title}
            </Title>
            <div style={{ marginBottom: 8 }}>
              <Text type="secondary">{content.contact.emailLabel}</Text> <Text>{content.contact.emailValue}</Text>
            </div>
            <div style={{ marginBottom: 8 }}>
              <Text type="secondary">{content.contact.hoursLabel}</Text> <Text>{content.contact.hoursValue}</Text>
            </div>
            <div>
              <Text type="secondary">{content.contact.tipLabel}</Text>{" "}
              <Text>{content.contact.tipText}</Text>
            </div>
          </Card>

          <Card style={{ borderRadius: 14 }}>
            <Title level={5} style={{ marginTop: 0 }}>
              {content.faq.title}
            </Title>
            <Collapse items={faqItems as any} />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
