import ResetClient from "@/components/auth/ResetClient";

export default function Page({
  searchParams,
}: {
  searchParams?: {
    token?: string;
    lang?: string;
  };
}) {
  const token = searchParams?.token ?? null;
  return <ResetClient token={token} />;
}
