import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requirePlatformAdminSeeder } from "@/lib/dev-guards";
import { query } from "@/lib/db";
import { nanoid } from "nanoid";
import { persistWebFile } from "@/lib/storage";
import dayjs from "dayjs";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";

// ดึง type return ของ persistWebFile มาใช้
type StoredFileRow = Awaited<ReturnType<typeof persistWebFile>>;

// =============================
// Create Random Image
// =============================
async function createRandomImageBuffer(
  w = 800,
  h = 500,
  fmt: "png" | "jpeg" = "png"
): Promise<Buffer> {
  const { default: sharp } = await import("sharp");

  const bg = randomHexColor();
  const image = sharp({
    create: {
      width: w,
      height: h,
      channels: 3,
      background: bg,
    },
  });
  return fmt === "png"
    ? image.png().toBuffer()
    : image.jpeg({ quality: 85 }).toBuffer();
}

function randomHexColor(): string {
  const n = Math.floor(Math.random() * 0xffffff);
  return `#${n.toString(16).padStart(6, "0")}`;
}

// Simulate File object
function makeWebFileFromBuffer(buf: Buffer, filename: string, mime: string) {
  return {
    name: filename,
    type: mime,
    size: buf.length,
    async arrayBuffer(): Promise<ArrayBuffer> {
      const ab = buf.buffer.slice(
        buf.byteOffset,
        buf.byteOffset + buf.byteLength
      );
      return ab as ArrayBuffer;
    },
  } as unknown as File;
}

async function handlePOST(req: NextRequest) {
  console.log("[POST] - dev fake posts with images + new fields");

  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Disabled in production" }, { status: 403 });
  }

  const body = await req.json();
  const { count = 5 } = body;

  // Admin only
  const guard = await requirePlatformAdminSeeder();
  if (!guard.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // =============================
  // 🟦 NEW: Random author from users
  // =============================
  const usersRows = await query(
    `SELECT id, name FROM users ORDER BY random() LIMIT 100`
  );

  const pickRandomUser = () => {
    if (!usersRows.rows?.length) return guard.actor?.id ?? null;
    const randomIndex = Math.floor(Math.random() * usersRows.rows.length);
    return usersRows.rows[randomIndex].id;
  };

  // list will store created posts
  const created: any[] = [];
  const IMAGES_PER_POST = 3;

  // Province sample IDs
  const provinceIds = [
    "a0f9a3b6-3a42-4c61-924d-14e3a9e4c2d1",
    "b27f6c4a-7f53-4a77-bb12-83211d9e62a3",
    "c913aef8-4581-4b40-90d8-5c3efde0b61a",
    "d57a89e3-f2e4-4fa4-a38a-14cc6bcbf879",
    "e89db1cf-9a12-4e7f-b354-67a8e1b58a50",
  ];

  for (let i = 0; i < count; i++) {
    // 🟦 AUTHOR RANDOM
    const author_id = pickRandomUser();
    const meta = JSON.stringify({ generated_by: author_id });

    const title = `Fake Report ${nanoid(6)}`;
    const status = Math.random() > 0.5 ? "public" : "unpublic";

    // New fields
    const first_last_name = `สมคิด ทดสอบ${i}`;
    const id_card = `1234567890${String(100 + i).padStart(3, "0")}`;
    const transfer_amount = (Math.random() * 50000 + 5000).toFixed(2);
    const transfer_date = dayjs().subtract(i, "day").toISOString();
    const website = ["facebook.com", "shopee.co.th", "lazada.co.th"][i % 3];
    const province_id = provinceIds[i % provinceIds.length];
    const detail = "โพสต์จำลองสำหรับ dev testing.";

    const insertSql = `
      INSERT INTO posts (
        title, status, author_id, meta,
        first_last_name, id_card, 
        transfer_amount, transfer_date, website,
        province_id, detail,
        created_at, updated_at, fake_test
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,
        $7,$8,$9,
        $10,$11,
        NOW(),NOW(),true
      )
      RETURNING *
    `;

    const { rows } = await query(insertSql, [
      title,
      status,
      author_id,
      meta,
      first_last_name,
      id_card,
      transfer_amount,
      transfer_date,
      website,
      province_id,
      detail,
    ]);

    const post = rows[0];
    created.push(post);

    // Telephone
    const telCount = Math.ceil(Math.random() * 2);
    for (let t = 0; t < telCount; t++) {
      const tel = `09${Math.floor(10000000 + Math.random() * 90000000)}`;
      await query(
        `INSERT INTO post_tel_numbers (post_id, tel) VALUES ($1,$2)`,
        [post.id, tel]
      );
    }

    // Seller Accounts
    const banks = [
      { id: "002", name: "ธ.กรุงเทพ" },
      { id: "004", name: "ธ.กสิกรไทย" },
      { id: "014", name: "ธ.ไทยพาณิชย์" },
      { id: "025", name: "ธ.กรุงไทย" },
    ];
    const bank = banks[i % banks.length];
    await query(
      `INSERT INTO post_seller_accounts (post_id, bank_id, bank_name, seller_account)
       VALUES ($1,$2,$3,$4)`,
      [post.id, bank.id, bank.name, `123-45${i}-6789`]
    );

    // Fake Upload Images
    const fileRows: StoredFileRow[] = [];
    for (let k = 0; k < IMAGES_PER_POST; k++) {
      const usePng = Math.random() < 0.5;
      const mime = usePng ? "image/png" : "image/jpeg";
      const ext = usePng ? "png" : "jpg";
      const buf = await createRandomImageBuffer(
        800,
        500,
        usePng ? "png" : "jpeg"
      );
      const filename = `fake_${nanoid(8)}.${ext}`;
      const webFile = makeWebFileFromBuffer(buf, filename, mime);
      const fileRow = await persistWebFile(webFile);
      fileRows.push(fileRow);
    }

    if (fileRows.length) {
      const values = fileRows.map((_, i) => `($1, $${i + 2})`).join(", ");
      await query(
        `INSERT INTO post_images (post_id, file_id) VALUES ${values}`,
        [post.id, ...fileRows.map((r) => r.id)]
      );
    }
  }

  return NextResponse.json({
    ok: true,
    created_count: created.length,
    created,
  });
}

export const POST = withRouteErrorLog("POST /api/dev/fake/posts", handlePOST);
