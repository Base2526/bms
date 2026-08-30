import { Skeleton } from "antd";

export default function AdminLoading() {
  return (
    <div
      aria-hidden="true"
      style={{ width: "100%", maxWidth: 1200, margin: "0 auto", padding: "24px" }}
    >
      <Skeleton active title={{ width: "28%" }} paragraph={{ rows: 8 }} />
    </div>
  );
}
