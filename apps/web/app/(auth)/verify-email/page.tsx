import VerifyEmailClient from "@/components/auth/VerifyEmailClient";

export default function Page({
  searchParams,
}: {
  searchParams?: {
    token?: string;
    lang?: string;
  };
}) {
  const token = searchParams?.token ?? null;
  return <VerifyEmailClient token={token} />;
}
