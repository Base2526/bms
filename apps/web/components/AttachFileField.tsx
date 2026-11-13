"use client";

import { useUiText } from "@/lib/useUiText";
import React, { FC, useMemo, useRef, useEffect } from 'react';
import { Space, Avatar, Button, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';

const { Text } = Typography;

const ASSET_BASE = process.env.NEXT_PUBLIC_ASSET_BASE ?? '';

export type ExistingFile = {
  _id: string | number;
  url: string;
  delete?: boolean;
  [k: string]: any;
};
export type FileValue = ExistingFile | File;

export interface AttachFileFieldProps {
  label: string;
  values: FileValue[];
  multiple?: boolean;
  required?: boolean;
  onChange: (newValues: FileValue[]) => void;
  onSnackbar?: (p: { open: boolean; message: string }) => void;
  accept?: string;
  thumbSize?: number;
}

const isExisting = (v: FileValue): v is ExistingFile => typeof (v as any)?.url === 'string';

const AttachFileField: FC<AttachFileFieldProps> = ({
  label,
  values,
  multiple = true,
  required = false,
  onChange,
  onSnackbar,
  accept = 'image/*',
  thumbSize = 120,
}) => {
  const uiText = useUiText();
  const inputRef = useRef<HTMLInputElement>(null);

  const previews = useMemo(() => {
    return values.map((v) => {
      if (isExisting(v)) return null;
      try {
        return URL.createObjectURL(v as File);
      } catch {
        return null;
      }
    });
  }, [values]);

  useEffect(() => {
    return () => { previews.forEach((u) => u && URL.revokeObjectURL(u)); };
  }, [previews]);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const added: File[] = [];
    for (let i = 0; i < e.target.files.length; i++) {
      const f = e.target.files[i];
      if (f?.type?.startsWith('image/')) added.push(f);
    }
    if (added.length === 0) return;
    const newList = [...values, ...added];
    onChange(newList);
    onSnackbar?.({ open: true, message: uiText("admin_ui.en_added_file_s_d804e", { v0: added.length }) });
    e.target.value = '';
  };

  const handleRemove = (item: FileValue, index: number) => {
    const next = [...values];
    if (isExisting(item)) {
      const i = next.findIndex((v) => isExisting(v) && (v as any)._id === (item as any)._id);
      if (i !== -1) next[i] = { ...(next[i] as any), delete: true };
      onSnackbar?.({ open: true, message: uiText("admin_ui.en_marked_image_for_delete_fc56e") });
    } else {
      next.splice(index, 1);
      onSnackbar?.({ open: true, message: uiText("admin_ui.en_removed_image_7cb39") });
    }
    onChange(next);
  };

  const openPicker = () => inputRef.current?.click();

  return (
    <Space align="start" size="large" style={{ width: '100%' }}>
      <div>
        <Text>{label}{required ? ' *' : ''}</Text>
        <div><input ref={inputRef} type="file" accept={accept} multiple={multiple}
          style={{ display:'none' }} onChange={onFileChange} /></div>
        <Button icon={<PlusOutlined />} onClick={openPicker} size="middle" />
      </div>
      <Space size={8} wrap>
        {values.filter(v => !(isExisting(v) && (v as any).delete)).map((v, idx) => {
          const old = isExisting(v);
          const src = old
            ? `${ASSET_BASE.replace(/\/$/, '')}/${(v as any).url.replace(/^\//,'')}`
            : (previews[idx] || '');
          const key = old ? `old-${(v as any)._id}` : `new-${idx}`;
          return (
            <div key={key} style={{ position: 'relative' }}>
              <Avatar shape="square" src={src}
                style={{ width: thumbSize, height: thumbSize, border: '1px solid #ddd', objectFit: 'cover' }} />
              <Button type="text" icon={<DeleteOutlined />} onClick={() => handleRemove(v, idx)}
                style={{ position:'absolute', top: 0, right: 0, color: 'red' }} />
            </div>
          );
        })}
      </Space>
    </Space>
  );
};

export default AttachFileField;