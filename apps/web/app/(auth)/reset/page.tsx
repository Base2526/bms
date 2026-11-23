import ResetClient from "@/components/auth/ResetClient";

export default async function Page(
  props: {
    searchParams?: Promise<{
      token?: string;
      lang?: string;
    }>;
  }
) {
  const searchParams = await props.searchParams;
  const token = searchParams?.token ?? null;
  return <ResetClient token={token} />;
}
