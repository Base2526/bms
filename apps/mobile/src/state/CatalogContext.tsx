import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { useLazyQuery, useQuery } from '@apollo/client';
import {
  MobilePosCatalogDocument,
  MobilePosScanDocument,
  MobileRestaurantMenuDocument,
} from '../graphql/generated';
import type { PosMenuCatalog, PosMenuItem } from '../types/pos';
import { useStoreMode } from './StoreModeContext';

interface CatalogContextValue {
  catalog: PosMenuCatalog;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  resolveScan: (code: string) => Promise<PosMenuItem>;
  setSearchQuery: (query: string) => void;
}

const CatalogContext = createContext<CatalogContextValue | null>(null);

function unique(values: Array<string | null | undefined>): string[] {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ];
}

export function CatalogProvider({ children }: { children: React.ReactNode }) {
  const { mode } = useStoreMode();
  const [searchQuery, setSearchQuery] = useState('');
  const restaurant = useQuery(MobileRestaurantMenuDocument, {
    skip: mode !== 'restaurant',
    notifyOnNetworkStatusChange: true,
  });
  const retail = useQuery(MobilePosCatalogDocument, {
    variables: { q: searchQuery },
    skip: mode === 'restaurant',
    notifyOnNetworkStatusChange: true,
  });
  const [scan] = useLazyQuery(MobilePosScanDocument, {
    fetchPolicy: 'network-only',
  });

  const catalog = useMemo<PosMenuCatalog>(() => {
    const artKind =
      mode === 'restaurant'
        ? ('food' as const)
        : mode === 'pharmacy'
        ? ('pharmacy' as const)
        : ('retail' as const);
    const items: PosMenuItem[] =
      mode === 'restaurant'
        ? (restaurant.data?.bmsPosRestaurantMenu.items ?? []).map(item => ({
            sku: item.sku,
            name: item.name,
            price: item.price,
            category: item.kitchenStation ?? 'เมนูอื่น',
            station: item.kitchenStation ?? 'เมนูอื่น',
            sellable: item.sellable,
            imageUrl: item.imageUrl,
            unavailableNote: item.unavailableReason,
            artKind: 'food',
            size: item.availableSizes[0]?.size ?? '',
            packCode: '',
            unitName: '',
            baseQty: 1,
          }))
        : (retail.data?.bmsPosCatalogSearch.items ?? []).map(item => ({
            sku: item.sku,
            name: item.name,
            price: item.availableSizes[0]?.price ?? item.price,
            category: 'สินค้า',
            station: 'สินค้า',
            sellable:
              item.availability === 'AVAILABLE' && item.availableTotal > 0,
            imageUrl: item.imageUrl,
            unavailableNote:
              item.availability === 'AVAILABLE' ? null : item.availability,
            artKind,
            size: item.availableSizes[0]?.size ?? '',
            packCode: '',
            unitName: '',
            baseQty: 1,
          }));
    const noun = mode === 'restaurant' ? 'เมนู' : 'สินค้า';
    return {
      categories: [
        mode === 'restaurant' ? 'เมนูทั้งหมด' : 'สินค้าทั้งหมด',
        ...unique(items.map(item => item.category)),
      ],
      stations: unique(items.map(item => item.station)),
      items,
      searchPlaceholder:
        mode === 'restaurant'
          ? 'ค้นหาเมนู หรือ SKU'
          : 'ค้นหาสินค้า บาร์โค้ด หรือ SKU',
      resultNoun: noun,
      unavailableLabel:
        mode === 'restaurant' ? 'ขายไม่ได้ตอนนี้' : 'สต็อกไม่พอ',
    };
  }, [
    mode,
    restaurant.data?.bmsPosRestaurantMenu.items,
    retail.data?.bmsPosCatalogSearch.items,
  ]);

  const resolveScan = useCallback(
    async (code: string): Promise<PosMenuItem> => {
      const response = await scan({ variables: { code: code.trim() } });
      const item = response.data?.bmsPosScan;
      if (!item) throw new Error('ไม่พบสินค้าจากรหัสนี้');
      return {
        sku: item.sku,
        name: item.receiptName || item.productName,
        price: item.packPrice,
        category: 'สินค้า',
        station: 'สินค้า',
        sellable: item.available >= item.baseQty,
        imageUrl: item.imageUrl,
        unavailableNote:
          item.available >= item.baseQty ? null : 'จำนวนคงเหลือไม่พอ',
        artKind:
          mode === 'restaurant'
            ? 'food'
            : mode === 'pharmacy'
            ? 'pharmacy'
            : 'retail',
        size: item.size,
        packCode: item.packCode,
        unitName: item.unitName,
        baseQty: item.baseQty,
      };
    },
    [mode, scan],
  );

  const refetch = useCallback(async () => {
    if (mode === 'restaurant') await restaurant.refetch();
    else await retail.refetch();
  }, [mode, restaurant, retail]);

  const value = useMemo<CatalogContextValue>(
    () => ({
      catalog,
      loading: mode === 'restaurant' ? restaurant.loading : retail.loading,
      error:
        (mode === 'restaurant' ? restaurant.error : retail.error)?.message ??
        null,
      refetch,
      resolveScan,
      setSearchQuery,
    }),
    [
      catalog,
      mode,
      refetch,
      resolveScan,
      restaurant.error,
      restaurant.loading,
      retail.error,
      retail.loading,
      setSearchQuery,
    ],
  );
  return (
    <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>
  );
}

export function useCatalog(): CatalogContextValue {
  const value = useContext(CatalogContext);
  if (!value) throw new Error('useCatalog ต้องอยู่ใต้ <CatalogProvider>');
  return value;
}
