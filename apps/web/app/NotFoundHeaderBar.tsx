"use client";

import dynamic from "next/dynamic";
import styles from "./not-found.module.css";

export default dynamic(() => import("@/components/HeaderBar"), {
  ssr: false,
  loading: () => <div className={styles.headerPlaceholder} />,
});
