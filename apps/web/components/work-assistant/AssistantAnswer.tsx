"use client";

import { Fragment } from "react";
import { Button, Typography } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import { parseAssistantAnswer } from "./assistantAnswerFormat";
import styles from "./AssistantAnswer.module.css";

const INLINE_TOKEN_RE = /(\*\*[^*]+\*\*|`[^`]+`|\/api\/bms\/reports\/download\/\d+|https?:\/\/[^\s)]+)/g;
const REPORT_DOWNLOAD_RE = /^\/api\/bms\/reports\/download\/\d+$/;

function inlineText(text: string, downloadLabel: string) {
  return text.split(INLINE_TOKEN_RE).map((piece, index) => {
    if (!piece) return null;
    if (piece.startsWith("**") && piece.endsWith("**")) {
      return <strong key={index}>{piece.slice(2, -2)}</strong>;
    }
    if (piece.startsWith("`") && piece.endsWith("`")) {
      const inner = piece.slice(1, -1);
      if (REPORT_DOWNLOAD_RE.test(inner)) piece = inner;
      else return <Typography.Text code key={index}>{inner}</Typography.Text>;
    }
    if (REPORT_DOWNLOAD_RE.test(piece)) {
      return <Button key={index} type="primary" ghost size="small" icon={<DownloadOutlined />} href={piece}>
        {downloadLabel}
      </Button>;
    }
    if (/^https?:\/\//.test(piece)) {
      return <a key={index} href={piece} target="_blank" rel="noopener noreferrer">{piece}</a>;
    }
    return <Fragment key={index}>{piece}</Fragment>;
  });
}

export function AssistantAnswer({ text, downloadLabel, image, wide = false, onPrimary = false }: {
  text: string;
  downloadLabel: string;
  image?: { name: string; previewUrl: string } | null;
  wide?: boolean;
  onPrimary?: boolean;
}) {
  const blocks = parseAssistantAnswer(text);
  return <div className={`${styles.answer} ${image ? styles.withImage : ""} ${wide ? styles.wide : ""} ${onPrimary ? styles.onPrimary : ""}`}>
    {image ? <div>
      <a className={styles.imageLink} href={image.previewUrl} target="_blank" rel="noopener noreferrer"
        aria-label={image.name}>
        <img className={styles.image} src={image.previewUrl} alt={image.name} />
      </a>
      <span className={styles.imageName}>{image.name}</span>
    </div> : null}
    <div className={styles.blocks}>
      {blocks.map((block, index) => {
        if (block.kind === "heading") return <h3 className={styles.heading} key={index}>{inlineText(block.text, downloadLabel)}</h3>;
        if (block.kind === "paragraph") return <p className={styles.paragraph} key={index}>{inlineText(block.text, downloadLabel)}</p>;
        if (block.kind === "code") return <pre className={styles.code} key={index}><code>{block.text}</code></pre>;
        const List = block.ordered ? "ol" : "ul";
        return <List className={styles.list} start={block.ordered ? block.start : undefined} key={index}>{block.items.map((item, itemIndex) =>
          <li key={itemIndex}>{inlineText(item, downloadLabel)}</li>)}</List>;
      })}
    </div>
  </div>;
}
