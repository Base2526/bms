'use client';
import React, { useMemo, useState } from 'react';
import { Image } from 'antd';

type Img = { id: string | number; url: string };

export default function ThumbGrid({
  images,
  width = 160,
  height = 110,
  radius = 5,
  gap = 4,
}: {
  images: Img[];
  width?: number;
  height?: number;
  radius?: number;
  gap?: number;
}) {
  if (!images?.length) return <div style={{ color: 'var(--app-muted)' }}>—</div>;

  // --- Preview control: ให้คลิก thumbnail แล้วเปิด index ที่ถูกต้อง และวนได้ครบ ---
  const [visible, setVisible] = useState(false);
  const [current, setCurrent] = useState(0);

  const openAt = (idx: number) => {
    setCurrent(idx);
    setVisible(true);
  };

  // ทำให้แน่ใจว่าใช้ไม่เกิน 5 รูปสำหรับ thumbnail (ถ้ามากกว่านี้ให้ overlay +N)
  const count = images.length;
  const thumbCount = Math.min(count, 5);

  const box: React.CSSProperties = {
    width,
    height,
    borderRadius: radius,
    overflow: 'hidden',
    position: 'relative',
    background: 'var(--app-surface-2)',
  };
  const imgBase: React.CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    cursor: 'pointer',
    display: 'block',
  };
  const cellStyle = (extra?: React.CSSProperties): React.CSSProperties => ({
    borderRadius: radius,
    overflow: 'hidden',
    ...extra,
  });

  // ============ Layouts ============
  // 1 รูป: เต็มกล่อง
  const render1 = () => (
    <div style={box}>
      <img
        src={images[0].url}
        alt=""
        style={{ ...imgBase }}
        onClick={() => openAt(0)}
      />
    </div>
  );

  // 2 รูป: สองคอลัมน์เท่ากัน (1:1)
  const render2 = () => (
    <div
      style={{
        ...box,
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap,
      }}
    >
      {images.slice(0, 2).map((it, i) => (
        <div key={it.id} style={cellStyle()}>
          <img
            src={it.url}
            alt=""
            style={{ ...imgBase }}
            onClick={() => openAt(i)}
          />
        </div>
      ))}
    </div>
  );

  // 3 รูป: บนกว้าง (ประมาณ 2:1), ล่างสองคอลัมน์ (1:1)
  const render3 = () => {
    const topH = Math.round(height * 0.6);
    const bottomH = height - topH - gap;
    return (
      <div style={{ ...box }}>
        <div style={{ ...cellStyle({ height: topH, marginBottom: gap }) }}>
          <img
            src={images[0].url}
            alt=""
            style={{ ...imgBase }}
            onClick={() => openAt(0)}
          />
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap,
            height: bottomH,
          }}
        >
          {images.slice(1, 3).map((it, i) => (
            <div key={it.id} style={cellStyle()}>
              <img
                src={it.url}
                alt=""
                style={{ ...imgBase }}
                onClick={() => openAt(i + 1)}
              />
            </div>
          ))}
        </div>
      </div>
    );
  };

  // 4 รูป: (Type 1+3) ซ้ายเป็นสี่เหลี่ยมใหญ่ ครอบสองแถว, ขวาเป็นกริด 2 แถว 1 คอลัมน์ + แถวล่าง 2 คอลัมน์
  // เพื่อ balance ให้คล้ายภาพตัวอย่าง: ซ้ายใหญ่, ขวาสามรูปเล็ก
  const render4 = () => (
    <div
      style={{
        ...box,
        display: 'grid',
        gridTemplateColumns: '1.2fr 1fr',
        gridTemplateRows: `1fr 1fr`,
        gap,
      }}
    >
      {/* ซ้ายใหญ่ (รูปที่ 0) span 2 แถว */}
      <div style={{ ...cellStyle({ gridRow: '1 / span 2' }) }}>
        <img
          src={images[0].url}
          alt=""
          style={{ ...imgBase, height: '100%' }}
          onClick={() => openAt(0)}
        />
      </div>

      {/* ขวาบน (รูปที่ 1) */}
      <div style={cellStyle()}>
        <img
          src={images[1].url}
          alt=""
          style={{ ...imgBase }}
          onClick={() => openAt(1)}
        />
      </div>

      {/* ขวาล่าง: สองคอลัมน์เล็ก (รูปที่ 2,3) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap,
        }}
      >
        {images.slice(2, 4).map((it, i) => (
          <div key={it.id} style={cellStyle()}>
            <img
              src={it.url}
              alt=""
              style={{ ...imgBase }}
              onClick={() => openAt(i + 2)}
            />
          </div>
        ))}
      </div>
    </div>
  );

  // 5 รูป: (คล้าย 1+4) ซ้ายใหญ่ span 2 แถว, ขวาเป็นกริด 2x2 สี่รูป
  // const render5 = () => (
  //   <div
  //     style={{
  //       ...box,
  //       display: 'grid',
  //       gridTemplateColumns: '1.2fr 1fr',
  //       gridTemplateRows: `1fr 1fr`,
  //       gap,
  //     }}
  //   >
  //     {/* ซ้ายใหญ่ (รูปที่ 0) */}
  //     <div style={{ ...cellStyle({ gridRow: '1 / span 2' }) }}>
  //       <img
  //         src={images[0].url}
  //         alt=""
  //         style={{ ...imgBase, height: '100%' }}
  //         onClick={() => openAt(0)}
  //       />
  //     </div>

  //     {/* ขวา: 2x2 (รูปที่ 1..4) */}
  //     <div
  //       style={{
  //         display: 'grid',
  //         gridTemplateColumns: '1fr 1fr',
  //         gridTemplateRows: '1fr 1fr',
  //         gap,
  //       }}
  //     >
  //       {images.slice(1, 5).map((it, i) => (
  //         <div key={it.id} style={cellStyle()}>
  //           <img
  //             src={it.url}
  //             alt=""
  //             style={{ ...imgBase }}
  //             onClick={() => openAt(i + 1)}
  //           />
  //         </div>
  //       ))}
  //     </div>

  //     {/* ถ้ามีมากกว่า 5 แสดง +N มุมขวาบนของรูปสุดท้าย */}
  //     {count > 5 && (
  //       <div
  //         style={{
  //           position: 'absolute',
  //           right: 8,
  //           bottom: 8,
  //           background: 'rgba(0,0,0,0.55)',
  //           color: '#fff',
  //           fontSize: 12,
  //           padding: '2px 6px',
  //           borderRadius: 999,
  //         }}
  //       >
  //         +{count - 5}
  //       </div>
  //     )}
  //   </div>
  // );

  // 5 รูปขึ้นไป: ซ้ายใหญ่ 1 รูป + ขวา 4 รูปเต็มพื้นที่
const render5 = () => (
  <div
    style={{
      ...box,
      display: 'grid',
      gridTemplateColumns: '1.2fr 1fr', // ✅ ใช้แค่ column
      // ไม่ต้องมี gridTemplateRows แล้ว
      gap,
    }}
  >
    {/* ซ้ายใหญ่ (รูปที่ 0) */}
    <div style={cellStyle()}>
      <img
        src={images[0].url}
        alt=""
        style={{ ...imgBase, height: '100%' }} // เต็มกล่องซ้าย
        onClick={() => openAt(0)}
      />
    </div>

    {/* ขวา: 2x2 (รูปที่ 1..4) เต็มความสูงกล่อง */}
    <div style={cellStyle()}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gridTemplateRows: '1fr 1fr',
          gap,
          width: '100%',
          height: '100%',       // ✅ ให้กริดขวาเต็มความสูง cell
        }}
      >
        {images.slice(1, 5).map((it, i) => (
          <div key={it.id} style={cellStyle()}>
            <img
              src={it.url}
              alt=""
              style={imgBase}     // มี width/height 100% + objectFit: 'cover'
              onClick={() => openAt(i + 1)}
            />
          </div>
        ))}
      </div>
    </div>

    {/* +N overlay มุมขวาล่างของกล่องใหญ่ */}
    {count > 5 && (
      <div
        style={{
          position: 'absolute',
          right: 5,
          bottom: 5,
          background: 'rgba(var(--app-shadow-rgb),0.55)',
          color: '#fff',
          fontSize: 12,
          padding: '2px 6px',
          borderRadius: 5,
        }}
      >
        +{count - 5}
      </div>
    )}
  </div>
);


  const thumb = useMemo(() => {
    switch (thumbCount) {
      case 1: return render1();
      case 2: return render2();
      case 3: return render3();
      case 4: return render4();
      default: return render5();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thumbCount, images, width, height, radius, gap]);

  return (
    <>
      {/* Thumbnail */}
      {thumb}

      {/* Hidden images สำหรับ PreviewGroup (วนครบทุกภาพ) */}
      <div style={{ display: 'none' }}>
        <Image.PreviewGroup
          preview={{
            visible,
            current,
            onVisibleChange: (v) => setVisible(v),
            onChange: (idx) => setCurrent(idx),
          }}
        >
          {images.map((it) => (
            <Image key={it.id} src={it.url} alt="" />
          ))}
        </Image.PreviewGroup>
      </div>
    </>
  );
}
