import { Skeleton } from "antd";

export default function MainLoading() {
  return (
    <div
      aria-hidden="true"
      style={{ width: "min(100% - 32px, 1120px)", margin: "32px auto" }}
    >
      <Skeleton active title={{ width: "30%" }} paragraph={{ rows: 8 }} />
    </div>
  );
}
