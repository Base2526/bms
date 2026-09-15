import React from 'react';
import { TextInput } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { MoneyField } from '../src/components/MoneyField';
import { ThemeProvider } from '../src/theme/ThemeProvider';

/**
 * ⚠️ เทสนี้ตรึงบั๊กที่ทำให้ "กรอกยอดที่มีสตางค์ไม่ได้เลย"
 *
 * ของเดิมผูก value ของ TextInput กับตัวเลขแล้วแปลงกลับทุกคีย์ที่พิมพ์
 * (`value={String(n)}` + `onChangeText={t => onChange(Number(t) || 0)}`)
 * พิมพ์ "10." แล้ว Number("10.") = 10 → ช่องถูกเขียนทับกลับเป็น "10" ทันที
 * จุดทศนิยมจึงพิมพ์ไม่ติด และ "0" ก็หายเพราะเงื่อนไข `value ? ... : ''`
 */
describe('MoneyField', () => {
  async function mount(initial: number) {
    const onChange = jest.fn();
    let value = initial;
    let renderer!: ReactTestRenderer.ReactTestRenderer;

    const render = () =>
      ReactTestRenderer.act(() => {
        renderer.update(
          <ThemeProvider>
            <MoneyField
              label="ยอดช่องทางนี้"
              value={value}
              onChange={next => {
                value = next;
                onChange(next);
              }}
            />
          </ThemeProvider>,
        );
      });

    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <ThemeProvider>
          <MoneyField
            label="ยอดช่องทางนี้"
            value={value}
            onChange={next => {
              value = next;
              onChange(next);
            }}
          />
        </ThemeProvider>,
      );
    });

    const type = async (text: string) => {
      await ReactTestRenderer.act(() => {
        renderer.root.findByType(TextInput).props.onChangeText(text);
      });
      await render();
    };

    const shown = () => renderer.root.findByType(TextInput).props.value;

    return { type, shown, onChange, current: () => value };
  }

  test('พิมพ์จุดทศนิยมได้ และรายงานค่าตัวเลขที่ถูกต้อง', async () => {
    const field = await mount(0);

    await field.type('10');
    expect(field.shown()).toBe('10');

    // จุดต้องค้างอยู่ในช่อง ไม่ถูกเขียนทับกลับเป็น "10"
    await field.type('10.');
    expect(field.shown()).toBe('10.');

    await field.type('10.5');
    expect(field.shown()).toBe('10.5');
    expect(field.current()).toBe(10.5);

    await field.type('10.50');
    expect(field.shown()).toBe('10.50');
    expect(field.current()).toBe(10.5);
  });

  test('เริ่มด้วย 0 แล้วพิมพ์ต่อได้ (กรอก 0.75 ได้)', async () => {
    const field = await mount(0);

    await field.type('0');
    expect(field.shown()).toBe('0');

    await field.type('0.75');
    expect(field.shown()).toBe('0.75');
    expect(field.current()).toBe(0.75);
  });

  test('ตัวอักษรและจุดซ้ำถูกกรองทิ้ง ไม่ทำให้ค่ากลายเป็น NaN', async () => {
    const field = await mount(0);

    await field.type('12a3');
    expect(field.shown()).toBe('123');
    expect(field.current()).toBe(123);

    await field.type('1.2.3');
    expect(field.shown()).toBe('1.23');
    expect(field.current()).toBe(1.23);
  });

  test('ค่าที่เปลี่ยนจากข้างนอก (ปุ่มเงินด่วน) เขียนทับสิ่งที่พิมพ์ค้างไว้', async () => {
    const onChange = jest.fn();
    let renderer!: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <ThemeProvider>
          <MoneyField label="เงินสดที่รับ" value={10} onChange={onChange} />
        </ThemeProvider>,
      );
    });
    expect(renderer.root.findByType(TextInput).props.value).toBe('10');

    await ReactTestRenderer.act(() => {
      renderer.update(
        <ThemeProvider>
          <MoneyField label="เงินสดที่รับ" value={500} onChange={onChange} />
        </ThemeProvider>,
      );
    });
    expect(renderer.root.findByType(TextInput).props.value).toBe('500');
  });
});
