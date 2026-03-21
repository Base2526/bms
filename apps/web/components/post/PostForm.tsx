'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Card,
  Form,
  Input,
  Button,
  Select,
  message,
  InputNumber,
  DatePicker,
  Switch,
  Typography,
  Divider,
} from 'antd';
import { gql, useMutation } from "@apollo/client";
import AttachFileField from '@/components/AttachFileField';
import { PlusOutlined, MinusCircleOutlined } from '@ant-design/icons';
import _ from "lodash";
import dayjs from 'dayjs';

import { formatDate } from "@/lib/date";
import { useI18n } from "@/lib/i18nContext";

const { Text } = Typography;

const UPSERT = gql`
  mutation Upsert($id: ID, $data: PostInput!, $images:[Upload!], $image_ids_delete:[ID!]) {
    upsertPost(id: $id, data: $data, images: $images, image_ids_delete: $image_ids_delete) {
      id
      title
      auto_publish
      images { id url }
    }
  }
`;

export type ExistingImage = { id: number | string; url: string };
export type PostRecord = {
  id?: number | string;
  title: string;
  body?: string;
  phone?: string;
  status: 'public' | 'unpublic';
  images?: ExistingImage[];

  // ✅ เพิ่มฟิลด์ auto_publish สำหรับอ่าน initialData (หากมีจาก backend)
  auto_publish?: boolean;

  // ฟิลด์อื่น ๆ
  first_last_name?: string;
  id_card?: string;
  transfer_amount?: number;
  transfer_date?: string;
  website?: string;
  province_id?: string;
  detail?: string;
  tel_numbers?: Array<{ id?: string | number; tel: string }>;
  seller_accounts?: Array<{ id?: string | number; bank_id: string; bank_name: string; seller_account?: string }>;
};

type ExistingFile = { _id: string | number; url: string; delete?: boolean };
type FileValue = ExistingFile | File;

type Props = {
  apiBase?: string;
  initialData?: PostRecord | null;
  onSaved?: (savedId: string | number) => void;
  title?: string;
};

enum TelNumberMode {
  New = 'new',
  Edited = 'edited',
  Deleted = 'deleted',
  Unchanged = 'unchanged',
}

enum SellerAccountMode {
  New = 'new',
  Edited = 'edited',
  Deleted = 'deleted',
  Unchanged = 'unchanged',
}

type PaymentProviderType = "bank" | "ewallet";

type BankItem = {
  id: string;
  name_th: string;
  name_en: string;
  type: PaymentProviderType;
  description?: string;
};

interface ProvinceItem {
  id: string;
  name_th: string;
  name_en: string;
}

type ITelNumber = {
  id: string;
  tel: string;
  mode: TelNumberMode;
};

type ISellerAccount = {
  id: string;
  bank_id: string;
  bank_name: string;
  mode: SellerAccountMode;
};

type ITelNumberDTO = { id?: string | number; tel: string };
type ISellerAccountDTO = { id?: string | number; bank_id: string; bank_name: string; seller_account?: string };

const makeLocalId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export default function PostForm({ apiBase = '', initialData, onSaved, title }: Props) {
  const [form] = Form.useForm();
  const [files, setFiles] = useState<FileValue[]>([]);
  const isEdit = !!initialData?.id;

  const { t } = useI18n();
  const [onPost, { loading }] = useMutation(UPSERT);

  // dropdown data
  const [provinces] = useState<ProvinceItem[]>([
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00001", name_th: "กรุงเทพมหานคร", name_en: "Bangkok" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00002", name_th: "กระบี่", name_en: "Krabi" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00003", name_th: "กาญจนบุรี", name_en: "Kanchanaburi" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00004", name_th: "กาฬสินธุ์", name_en: "Kalasin" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00005", name_th: "กำแพงเพชร", name_en: "Kamphaeng Phet" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00006", name_th: "ขอนแก่น", name_en: "Khon Kaen" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00007", name_th: "จันทบุรี", name_en: "Chanthaburi" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00008", name_th: "ฉะเชิงเทรา", name_en: "Chachoengsao" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00009", name_th: "ชลบุรี", name_en: "Chonburi" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00010", name_th: "ชัยนาท", name_en: "Chai Nat" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00011", name_th: "ชัยภูมิ", name_en: "Chaiyaphum" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00012", name_th: "ชุมพร", name_en: "Chumphon" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00013", name_th: "เชียงราย", name_en: "Chiang Rai" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00014", name_th: "เชียงใหม่", name_en: "Chiang Mai" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00015", name_th: "ตรัง", name_en: "Trang" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00016", name_th: "ตราด", name_en: "Trat" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00017", name_th: "ตาก", name_en: "Tak" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00018", name_th: "นครนายก", name_en: "Nakhon Nayok" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00019", name_th: "นครปฐม", name_en: "Nakhon Pathom" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00020", name_th: "นครพนม", name_en: "Nakhon Phanom" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00021", name_th: "นครราชสีมา", name_en: "Nakhon Ratchasima" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00022", name_th: "นครศรีธรรมราช", name_en: "Nakhon Si Thammarat" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00023", name_th: "นครสวรรค์", name_en: "Nakhon Sawan" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00024", name_th: "นนทบุรี", name_en: "Nonthaburi" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00025", name_th: "นราธิวาส", name_en: "Narathiwat" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00026", name_th: "น่าน", name_en: "Nan" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00027", name_th: "บึงกาฬ", name_en: "Bueng Kan" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00028", name_th: "บุรีรัมย์", name_en: "Buriram" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00029", name_th: "ปทุมธานี", name_en: "Pathum Thani" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00030", name_th: "ประจวบคีรีขันธ์", name_en: "Prachuap Khiri Khan" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00031", name_th: "ปราจีนบุรี", name_en: "Prachinburi" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00032", name_th: "ปัตตานี", name_en: "Pattani" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00033", name_th: "พระนครศรีอยุธยา", name_en: "Phra Nakhon Si Ayutthaya" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00034", name_th: "พะเยา", name_en: "Phayao" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00035", name_th: "พังงา", name_en: "Phang Nga" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00036", name_th: "พัทลุง", name_en: "Phatthalung" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00037", name_th: "พิจิตร", name_en: "Phichit" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00038", name_th: "พิษณุโลก", name_en: "Phitsanulok" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00039", name_th: "เพชรบุรี", name_en: "Phetchaburi" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00040", name_th: "เพชรบูรณ์", name_en: "Phetchabun" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00041", name_th: "แพร่", name_en: "Phrae" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00042", name_th: "ภูเก็ต", name_en: "Phuket" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00043", name_th: "มหาสารคาม", name_en: "Maha Sarakham" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00044", name_th: "มุกดาหาร", name_en: "Mukdahan" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00045", name_th: "แม่ฮ่องสอน", name_en: "Mae Hong Son" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00046", name_th: "ยโสธร", name_en: "Yasothon" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00047", name_th: "ยะลา", name_en: "Yala" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00048", name_th: "ร้อยเอ็ด", name_en: "Roi Et" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00049", name_th: "ระนอง", name_en: "Ranong" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00050", name_th: "ระยอง", name_en: "Rayong" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00051", name_th: "ราชบุรี", name_en: "Ratchaburi" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00052", name_th: "ลพบุรี", name_en: "Lopburi" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00053", name_th: "ลำปาง", name_en: "Lampang" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00054", name_th: "ลำพูน", name_en: "Lamphun" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00055", name_th: "เลย", name_en: "Loei" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00056", name_th: "ศรีสะเกษ", name_en: "Si Sa Ket" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00057", name_th: "สกลนคร", name_en: "Sakon Nakhon" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00058", name_th: "สงขลา", name_en: "Songkhla" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00059", name_th: "สตูล", name_en: "Satun" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00060", name_th: "สมุทรปราการ", name_en: "Samut Prakan" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00061", name_th: "สมุทรสงคราม", name_en: "Samut Songkhram" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00062", name_th: "สมุทรสาคร", name_en: "Samut Sakhon" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00063", name_th: "สระแก้ว", name_en: "Sa Kaeo" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00064", name_th: "สระบุรี", name_en: "Saraburi" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00065", name_th: "สิงห์บุรี", name_en: "Sing Buri" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00066", name_th: "สุโขทัย", name_en: "Sukhothai" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00067", name_th: "สุพรรณบุรี", name_en: "Suphan Buri" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00068", name_th: "สุราษฎร์ธานี", name_en: "Surat Thani" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00069", name_th: "สุรินทร์", name_en: "Surin" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00070", name_th: "หนองคาย", name_en: "Nong Khai" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00071", name_th: "หนองบัวลำภู", name_en: "Nong Bua Lam Phu" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00072", name_th: "อ่างทอง", name_en: "Ang Thong" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00073", name_th: "อำนาจเจริญ", name_en: "Amnat Charoen" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00074", name_th: "อุดรธานี", name_en: "Udon Thani" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00075", name_th: "อุตรดิตถ์", name_en: "Uttaradit" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00076", name_th: "อุทัยธานี", name_en: "Uthai Thani" },
    { id: "1a6c1a5a-1f01-4f3a-9a45-001a01a00077", name_th: "อุบลราชธานี", name_en: "Ubon Ratchathani" },
  ]);

  const [banks] = useState<BankItem[]>([
    { id: "bbl", name_th: "ธนาคารกรุงเทพ", name_en: "Bangkok Bank", type: "bank" },
    { id: "kbank", name_th: "ธนาคารกสิกรไทย", name_en: "Kasikorn Bank", type: "bank" },
    { id: "scb", name_th: "ธนาคารไทยพาณิชย์", name_en: "Siam Commercial Bank", type: "bank" },
    { id: "bay", name_th: "ธนาคารกรุงศรีอยุธยา", name_en: "Bank of Ayudhya", type: "bank" },
    { id: "ktb", name_th: "ธนาคารกรุงไทย", name_en: "Krung Thai Bank", type: "bank" },
    { id: "tmb", name_th: "ธนาคารทหารไทยธนชาต", name_en: "TTB Bank", type: "bank" },
    { id: "uob", name_th: "ธนาคารยูโอบี", name_en: "United Overseas Bank (Thai)", type: "bank" },
    { id: "cimb", name_th: "ธนาคารซีไอเอ็มบีไทย", name_en: "CIMB Thai Bank", type: "bank" },
    { id: "lhb", name_th: "ธนาคารแลนด์ แอนด์ เฮ้าส์", name_en: "Land and Houses Bank", type: "bank" },
    { id: "tisco", name_th: "ธนาคารทิสโก้", name_en: "TISCO Bank", type: "bank" },
    { id: "kkp", name_th: "ธนาคารเกียรตินาคินภัทร", name_en: "Kiatnakin Phatra Bank", type: "bank" },
    { id: "ibank", name_th: "ธนาคารอิสลามแห่งประเทศไทย", name_en: "Islamic Bank of Thailand", type: "bank" },

    { id: "gsb", name_th: "ธนาคารออมสิน", name_en: "Government Savings Bank", type: "bank" },
    { id: "baac", name_th: "ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร", name_en: "BAAC", type: "bank" },
    { id: "ghb", name_th: "ธนาคารอาคารสงเคราะห์", name_en: "Government Housing Bank", type: "bank" },
    { id: "exim", name_th: "ธนาคารเพื่อการส่งออกและนำเข้าแห่งประเทศไทย", name_en: "EXIM Thailand", type: "bank" },
    { id: "sme", name_th: "ธนาคารพัฒนาวิสาหกิจขนาดกลางและขนาดย่อมแห่งประเทศไทย", name_en: "SME D Bank", type: "bank" },

    { id: "truemoney", name_th: "ทรูมันนี่ วอลเล็ท", name_en: "TrueMoney Wallet", type: "ewallet" },
    { id: "shopeepay", name_th: "ช้อปปี้เพย์", name_en: "ShopeePay", type: "ewallet" },
    { id: "linepay", name_th: "ไลน์เพย์", name_en: "LINE Pay", type: "ewallet" },
    { id: "rabbit", name_th: "แรบบิท ไลน์ เพย์", name_en: "Rabbit LINE Pay", type: "ewallet" },
    { id: "paotang", name_th: "เป๋าตัง / ถุงเงิน", name_en: "Pao Tang / Tung Ngern", type: "ewallet" },
    { id: "grabpay", name_th: "แกร็บเพย์", name_en: "GrabPay", type: "ewallet" },
    { id: "airpay", name_th: "แอร์เพย์", name_en: "AirPay", type: "ewallet" },
  ]);

  const [telNumbers, setTelNumbers] = useState<ITelNumber[]>([]);
  const [sellerAccounts, setSellerAccounts] = useState<ISellerAccount[]>([]);

  // ------------------- DIRTY CHECK -------------------
  const initialSnapshotRef = useRef<any>(null);
  const [dirty, setDirty] = useState<boolean>(false);

  const normalizeComparable = (values: any, f: FileValue[], tels: ITelNumber[], sellers: ISellerAccount[]) => {
    const existing = f.filter((x: any) => 'url' in x) as ExistingFile[];
    const keepExistingIds = existing.filter(x => !x.delete).map(x => String(x._id)).sort();
    const deleteExistingIds = existing.filter(x => !!x.delete).map(x => String(x._id)).sort();
    const newFilesCount = f.filter((x) => x instanceof File).length;

    const transferDateIso = values.transfer_date
      ? (values.transfer_date?.toISOString?.() ?? dayjs(values.transfer_date).toISOString())
      : null;

    return {
      form: {
        first_last_name: values.first_last_name?.trim() ?? "",
        id_card: values.id_card?.trim() ?? "",
        title: values.title?.trim() ?? "",
        transfer_amount: typeof values.transfer_amount === 'number'
          ? values.transfer_amount
          : Number(values.transfer_amount || 0),
        transfer_date: transferDateIso,
        website: values.website?.trim() ?? "",
        province_id: values.province_id ?? null,
        detail: values.detail ?? "",
        status: values.status || "public",

        // ✅ auto_publish เอาเข้า snapshot เพื่อ dirty check
        auto_publish: !!values.auto_publish,
      },
      tel_numbers: (tels || [])
        .filter(t => t.mode !== TelNumberMode.Deleted)
        .map(t => ({ tel: t.tel.trim() }))
        .sort((a, b) => a.tel.localeCompare(b.tel)),
      seller_accounts: (sellers || [])
        .filter(s => s.mode !== SellerAccountMode.Deleted)
        .map(s => {
          const sfList = values.seller_accounts || [];
          const idx = sellers.findIndex(x => x.id === s.id);
          const row = sfList[idx] || {};
          return {
            bank_id: String(row.bank_id ?? s.bank_id ?? ''),
            bank_name: (row.bank_name ?? s.bank_name ?? '').trim(),
            seller_account: (row.seller_account ?? '').trim(),
          };
        })
        .sort((a, b) => (a.bank_name + a.seller_account).localeCompare(b.bank_name + b.seller_account)),
      files: {
        keepExistingIds,
        deleteExistingIds,
        newFilesCount,
      }
    };
  };

  // init from initialData
  useEffect(() => {
    if (!initialData) return;

    let parsedTransferDate: dayjs.Dayjs | undefined;
    if (initialData.transfer_date) {
      if (!isNaN(Number(initialData.transfer_date))) {
        parsedTransferDate = dayjs(Number(initialData.transfer_date));
      } else {
        parsedTransferDate = dayjs(initialData.transfer_date);
      }
    }

    form.setFieldsValue({
      first_last_name: initialData.first_last_name ?? "",
      id_card: initialData.id_card ?? "",
      title: initialData.title ?? "",
      transfer_amount: initialData.transfer_amount ?? undefined,
      transfer_date: parsedTransferDate,
      website: initialData.website ?? "",
      province_id: initialData.province_id ?? undefined,
      detail: (initialData as any).detail ?? "",
      tel_numbers: (initialData.tel_numbers ?? []).map((t: ITelNumberDTO) => ({ tel: t.tel })),
      seller_accounts: (initialData.seller_accounts ?? []).map((s: ISellerAccountDTO) => ({
        bank_name: s.bank_name,
        seller_account: s.seller_account ?? "",
        bank_id: s.bank_id
      })),
      status: initialData.status,

      // ✅ auto_publish init (default: true เวลา create, edit ก็ใช้ค่าจาก server)
      auto_publish: typeof initialData.auto_publish === "boolean"
        ? initialData.auto_publish
        : true,
    });

    const telInit: ITelNumber[] = (initialData.tel_numbers ?? []).map(
      (t: ITelNumberDTO, idx: number) => ({
        id: typeof t.id !== 'undefined' ? String(t.id) : makeLocalId(`tel-${idx}`),
        tel: t.tel,
        mode: TelNumberMode.Unchanged,
      })
    );
    setTelNumbers(telInit.length ? telInit : []);

    const sellerInit: ISellerAccount[] = (initialData.seller_accounts ?? []).map(
      (s: ISellerAccountDTO, idx: number) => ({
        id: typeof s.id !== 'undefined' ? String(s.id) : makeLocalId(`seller-${idx}`),
        bank_id: s.bank_id,
        bank_name: s.bank_name,
        mode: SellerAccountMode.Unchanged,
      })
    );
    setSellerAccounts(sellerInit.length ? sellerInit : []);

    const ex: ExistingFile[] = (initialData.images || []).map(img => ({ _id: img.id, url: img.url }));
    setFiles(ex);

    const initValues = form.getFieldsValue(true);
    initialSnapshotRef.current = normalizeComparable(initValues, ex, telInit, sellerInit);
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData, form]);

  const recomputeDirty = React.useCallback(() => {
    const snap = initialSnapshotRef.current;
    if (!snap) { setDirty(true); return; }

    const currentValues = form.getFieldsValue(true);
    const current = normalizeComparable(currentValues, files, telNumbers, sellerAccounts);

    const newFilesChanged = current.files.newFilesCount > 0;
    const filesChanged = newFilesChanged
      || !_.isEqual(snap.files.keepExistingIds, current.files.keepExistingIds)
      || !_.isEqual(snap.files.deleteExistingIds, current.files.deleteExistingIds);

    const formChanged = !_.isEqual(snap.form, current.form);
    const telChanged = !_.isEqual(snap.tel_numbers, current.tel_numbers);
    const sellerChanged = !_.isEqual(snap.seller_accounts, current.seller_accounts);

    setDirty(formChanged || telChanged || sellerChanged || filesChanged);
  }, [form, files, telNumbers, sellerAccounts]);

  const handleValuesChange = () => { recomputeDirty(); };

  useEffect(() => {
    if (initialSnapshotRef.current) recomputeDirty();
  }, [files, telNumbers, sellerAccounts, recomputeDirty]);

  // ------------------- SUBMIT -------------------
  async function onFinish(values: any) {
    const existingDeleteIds = (files.filter((f: any) => 'url' in f && f.delete) as ExistingFile[])
      .map((f: any) => String(f._id));

    const newFiles = files.filter((f): f is File => f instanceof File);

    const tel_numbers_payload = telNumbers
      .filter(t => t.mode !== TelNumberMode.Unchanged)
      .map(t => ({
        id: t.id,
        tel: t.tel,
        mode: t.mode
      }));

    const seller_accounts_form = (form.getFieldValue('seller_accounts') || []) as Array<any>;
    const seller_accounts_payload = sellerAccounts
      .map((s, idx) => {
        const row = seller_accounts_form[idx] || {};
        return {
          id: s.id,
          bank_id: row.bank_id ?? s.bank_id,
          bank_name: row.bank_name ?? s.bank_name,
          seller_account: row.seller_account ?? '',
          mode: s.mode,
        };
      })
      .filter(s => s.mode !== SellerAccountMode.Unchanged);

    const variables: any = {
      id: isEdit ? String(initialData!.id) : null,
      data: {
        first_last_name: values.first_last_name?.trim() ?? "",
        id_card: values.id_card?.trim() ?? "",
        title: values.title?.trim() ?? "",
        transfer_amount: typeof values.transfer_amount === 'number'
          ? values.transfer_amount
          : Number(values.transfer_amount || 0),
        transfer_date: values.transfer_date
          ? (values.transfer_date.toISOString?.() ?? dayjs(values.transfer_date).toISOString())
          : null,
        website: values.website?.trim() ?? "",
        province_id: values.province_id ?? null,
        detail: values.detail ?? "",
        tel_numbers: tel_numbers_payload,
        seller_accounts: seller_accounts_payload,
        status: values.status || "public",

        // ✅ ส่ง auto_publish ไป backend
        auto_publish: !!values.auto_publish,
      },
      image_ids_delete: existingDeleteIds,
    };

    if (newFiles.length > 0) variables.images = newFiles;

    console.log("[variables] =", variables);

    const { data } = await onPost({ variables });

    if (data?.upsertPost?.id) {
      const ap = data?.upsertPost?.auto_publish;
      if (ap) {
        message.success(isEdit
          ? 'บันทึกสำเร็จ และระบบจะเผยแพร่อัตโนมัติ'
          : 'สร้างรายการสำเร็จ และระบบจะเผยแพร่อัตโนมัติ'
        );
      } else {
        message.success(isEdit ? 'บันทึกสำเร็จ' : 'สร้างรายการสำเร็จ');
      }

      const savedImgs = (data.upsertPost.images || []).map((img: any) => ({ _id: img.id, url: img.url }));
      setFiles(savedImgs);

      const nextTel = telNumbers
        .filter(t => t.mode !== TelNumberMode.Deleted)
        .map(t => ({ ...t, mode: TelNumberMode.Unchanged }));

      const nextSeller = sellerAccounts
        .filter(s => s.mode !== SellerAccountMode.Deleted)
        .map(s => ({ ...s, mode: SellerAccountMode.Unchanged }));

      setTelNumbers(nextTel.length ? nextTel : []);
      setSellerAccounts(nextSeller.length ? nextSeller : []);

      const newInitValues = form.getFieldsValue(true);
      initialSnapshotRef.current = normalizeComparable(
        newInitValues,
        savedImgs,
        nextTel,
        nextSeller
      );
      setDirty(false);

      onSaved?.(data.upsertPost.id);
    } else {
      message.error(isEdit ? 'บันทึกไม่สำเร็จ' : 'สร้างรายการไม่สำเร็จ');
    }
  }

  const handleTelChange = (index: number, value: string) => {
    const currentValues = form.getFieldValue('tel_numbers') || [];
    const updatedFormValues = [...currentValues];
    updatedFormValues[index] = { ...(updatedFormValues[index] || {}), tel: value };
    form.setFieldsValue({ tel_numbers: updatedFormValues });

    setTelNumbers(prev => {
      const updated = [...prev];
      const current = updated[index];
      if (!current) return prev;

      let mode = current.mode;
      if (mode === TelNumberMode.Unchanged) mode = TelNumberMode.Edited;

      updated[index] = { ...current, tel: value, mode };
      return updated;
    });
  };

  const addTelNumber = () => {
    setTelNumbers(prev => [
      ...prev,
      { id: makeLocalId("tel"), tel: '', mode: TelNumberMode.New }
    ]);
  };

  const removeTelNumber = (index: number) => {
    setTelNumbers(prev =>
      prev.map((item, i) =>
        i === index ? { ...item, mode: TelNumberMode.Deleted } : item
      )
    );
  };

  const removeSellerAccount = (index: number) => {
    setSellerAccounts(prev =>
      prev.map((item, i) =>
        i === index ? { ...item, mode: SellerAccountMode.Deleted } : item
      )
    );
  };

  const addSellerAccount = () => {
    setSellerAccounts(prev => [
      ...prev,
      { id: makeLocalId("seller"), bank_id: "", bank_name: "", mode: SellerAccountMode.New }
    ]);
  };

  const handleSellerAccountChange = (
    index: number,
    field: 'bank_name' | 'seller_account' | 'bank_id',
    value: string
  ) => {
    const currentValues = form.getFieldValue('seller_accounts') || [];
    const updatedFormValues = [...currentValues];
    updatedFormValues[index] = { ...(updatedFormValues[index] || {}), [field]: value };
    form.setFieldsValue({ seller_accounts: updatedFormValues });

    setSellerAccounts(prev => {
      const updated = [...prev];
      const current = updated[index];
      if (!current) return prev;

      let mode = current.mode;
      if (mode === SellerAccountMode.Unchanged) mode = SellerAccountMode.Edited;

      updated[index] = { ...current, [field]: value, mode };
      return updated;
    });
  };

  return (
    <Card title={title ?? (isEdit ? 'แก้ไขรายการ' : 'สร้างรายการใหม่')}>
      <Form
        form={form}
        layout="vertical"
        onFinish={onFinish}
        onValuesChange={handleValuesChange}
        initialValues={{
          status: 'public',

          // ✅ default ตอน create ให้เปิด auto_publish ไว้เลย (เปลี่ยนได้)
          auto_publish: true,
        }}
      >
        
        {/* ชื่อคนขาย */}
        <Form.Item
          label="ชื่อ-นามสกุล คนขาย"
          name="first_last_name"
          rules={[{ required: true, message: 'กรุณากรอกชื่อ-นามสกุล คนขาย' }]}
        >
          <Input placeholder="กรุณากรอกชื่อ-นามสกุล คนขาย" />
        </Form.Item>

        <Form.Item
          label="เลขบัตรประชาชนคนขาย (13 หลัก) หรือ พาสปอร์ต"
          name="id_card"
          rules={[{ message: 'กรุณากรอกเลขบัตรประชาชน หรือ พาสปอร์ต' }]}
        >
          <Input placeholder="กรุณากรอกเลขบัตรประชาชน หรือ พาสปอร์ต" maxLength={13} />
        </Form.Item>

        {/* สินค้า/บริการ ที่สั่งซื้อ */}
        <Form.Item
          label="สินค้า/บริการ ที่สั่งซื้อ"
          name="title"
          rules={[{ required: true, message: 'กรุณากรอกสินค้า/บริการ ที่สั่งซื้อ' }]}
        >
          <Input placeholder="กรุณากรอกสินค้า/บริการ ที่สั่งซื้อ" />
        </Form.Item>

        {/* ยอดโอน */}
        <Form.Item
          label="ยอดโอน"
          name="transfer_amount"
          rules={[{ required: true, message: 'กรุณากรอกยอดโอน' }]}
        >
          <InputNumber placeholder="กรุณากรอกยอดโอน" style={{ width: '100%' }} />
        </Form.Item>

        {/* วันโอนเงิน */}
        <Form.Item
          label="วันโอนเงิน"
          name="transfer_date"
          rules={[{ required: true, message: 'กรุณาเลือกวันโอนเงิน' }]}
        >
          <DatePicker placeholder="กรุณาเลือกวันโอนเงิน" style={{ width: '100%' }} format="DD/MM/YYYY" />
        </Form.Item>

        {/* เว็บประกาศขายของ */}
        <Form.Item
          label="เว็บ/แพลตฟอร์มที่ประกาศขาย"
          name="website"
          rules={[{ message: 'กรุณากรอกเว็บ/แพลตฟอร์มที่ประกาศขาย' }]}
        >
          <Input placeholder="เช่น Facebook Marketplace, Kaidee, Shopee, Lazada, เว็บไซต์อื่น ๆ" />
        </Form.Item>

        {/* รายละเอียดเพิ่มเติม */}
        <Form.Item label="รายละเอียดเพิ่มเติม" name="detail">
          <Input.TextArea rows={4} placeholder="กรุณากรอกรายละเอียดเพิ่มเติม" />
        </Form.Item>

        {/* Tel Numbers */}
        <div style={{ borderColor: 'var(--app-border)', padding: '10px', borderStyle: 'dashed', marginTop: '10px', marginBottom: '10px' }}>
          {telNumbers.map((number, index) => (
            number.mode !== TelNumberMode.Deleted && (
              <div
                key={`${number.id}-${index}`}
                style={{
                  marginBottom: 20,
                  padding: '10px',
                  marginTop: '10px',
                  border: "1px solid var(--app-border)",
                  borderRadius: 6
                }}
              >
                <Form.Item
                  label={`เบอร์โทรศัพท์ / LINE / ช่องทางติดต่อ ${index + 1}`}
                  name={['tel_numbers', index, 'tel']}
                  rules={[{ required: true, message: 'กรุณากรอกช่องทางติดต่อ' }]}
                >
                  <Input
                    placeholder="เช่น 08x-xxx-xxxx หรือ LINE ID"
                    onChange={(e) => handleTelChange(index, e.target.value)}
                  />
                </Form.Item>

                <Button type="dashed" onClick={() => removeTelNumber(index)}>
                  <MinusCircleOutlined /> ลบ
                </Button>
              </div>
            )
          ))}

          <Form.Item>
            <Button type="dashed" onClick={addTelNumber}>
              <PlusOutlined /> เพิ่มช่องทางติดต่อ
            </Button>
          </Form.Item>
        </div>

        {/* Seller Accounts */}
        <div style={{ borderColor: 'var(--app-border)', padding: '10px', borderStyle: 'dashed', marginTop: '10px', marginBottom: '10px' }}>
          {sellerAccounts.map((account, index) => (
            account.mode !== SellerAccountMode.Deleted && (
              <div
                key={`${account.id}-${index}`}
                style={{
                  marginBottom: 20,
                  padding: '10px',
                  marginTop: '10px',
                  border: "1px solid var(--app-border)",
                  borderRadius: 6
                }}
              >
                <Form.Item
                  label={`ชื่อบัญชีคนขาย ${index + 1}`}
                  name={['seller_accounts', index, 'bank_name']}
                  rules={[{ required: true, message: 'กรุณากรอกชื่อบัญชีคนขาย' }]}
                >
                  <Input
                    placeholder="ชื่อบัญชีตามหน้า Bank"
                    onChange={(e) => handleSellerAccountChange(index, 'bank_name', e.target.value)}
                  />
                </Form.Item>

                <Form.Item
                  label={`เลขที่บัญชีคนขาย ${index + 1}`}
                  name={['seller_accounts', index, 'seller_account']}
                  rules={[{ required: true, message: 'กรุณากรอกเลขที่บัญชีคนขาย' }]}
                >
                  <Input
                    placeholder="กรอกเลขบัญชี"
                    onChange={(e) => handleSellerAccountChange(index, 'seller_account', e.target.value)}
                  />
                </Form.Item>

                <Form.Item
                  label="เลือกธนาคาร"
                  name={['seller_accounts', index, 'bank_id']}
                  rules={[{ required: true, message: 'กรุณาเลือกธนาคาร' }]}
                >
                  <Select
                    placeholder="กรุณาเลือกธนาคาร"
                    onChange={(value) => handleSellerAccountChange(index, 'bank_id', value)}
                    optionFilterProp="children"
                    showSearch
                  >
                    {banks.map((bank, index2) => (
                      <Select.Option key={`${bank.id}-${index2}`} value={bank.id}>
                        {bank.name_th}
                      </Select.Option>
                    ))}
                  </Select>
                </Form.Item>

                <Button type="dashed" onClick={() => removeSellerAccount(index)}>
                  <MinusCircleOutlined /> ลบ
                </Button>
              </div>
            )
          ))}

          <Form.Item>
            <Button type="dashed" onClick={addSellerAccount}>
              <PlusOutlined /> เพิ่มบัญชีคนขายใหม่
            </Button>
          </Form.Item>
        </div>

        <AttachFileField
          label="ไฟล์แนบ"
          values={files}
          multiple
          accept="image/*"
          onChange={setFiles}
          onSnackbar={(s) => s.open && message.info(s.message)}
        />

        {/* จังหวัดของคนสร้างรายงาน */}
        <Form.Item
          label="จังหวัดของคนสร้างรายงาน"
          name="province_id"
          rules={[{ required: true, message: 'กรุณาเลือกจังหวัด' }]}
        >
          <Select
            placeholder="กรุณาเลือกจังหวัด"
            showSearch
            optionFilterProp="label"
            options={provinces.map((p) => ({ label: p.name_th, value: p.id }))}
          />
        </Form.Item>

        {/* ✅ Auto publish */}
        <div style={{
          padding: 12,
          border: "1px solid var(--app-border)",
          borderRadius: 8,
          marginBottom: 12
        }}>
          <Form.Item
            name="auto_publish"
            valuePropName="checked"
            style={{ marginBottom: 6 }}
          >
            <Switch />
          </Form.Item>

          <Text strong>เผยแพร่อัตโนมัติ (Auto Publish)</Text>
          <div style={{ marginTop: 4 }}>
            <Text type="secondary">
              เมื่อเปิด ระบบจะนำข้อมูลนี้ไปเผยแพร่ไปยังช่องทางที่ตั้งค่าไว้ (เช่น X / Facebook) แบบอัตโนมัติหลังบันทึก
            </Text>
          </div>
        </div>

        <Divider style={{ margin: "12px 0" }} />

        <Button
          type="primary"
          htmlType="submit"
          style={{ marginTop: 16 }}
          loading={loading}
          disabled={!dirty}
        >
          {isEdit ? t("postPage.save") : t("postPage.create")}
        </Button>

        {!dirty && (
          <div style={{ marginTop: 8 }}>
            <Text type="secondary">ยังไม่มีการแก้ไขข้อมูล</Text>
          </div>
        )}
      </Form>
    </Card>
  );
}
