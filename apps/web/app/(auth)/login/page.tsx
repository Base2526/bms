import LoginClient from "@/components/auth/LoginClient";
function safeInternalNextPath(nextPath: string | null | undefined): string | null {
  if (!nextPath) return null;
  if (nextPath.startsWith("//")) return null;
  if (!nextPath.startsWith("/")) return null;
  if (nextPath.includes("\\")) return null;
  return nextPath;
}

export default function Page({
  searchParams,
}: {
  searchParams?: {
    next?: string;
  };
}) {
  const nextPath = safeInternalNextPath(searchParams?.next);
  return <LoginClient nextPath={nextPath} />;
}
