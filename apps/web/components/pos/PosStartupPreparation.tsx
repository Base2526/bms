"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

const PREPARED_TTL_MS = 15_000;
const PREPARE_TIMEOUT_MS = 12_000;

const RESTAURANT_STARTUP_URLS = [
  "/api/pos/session",
  "/api/pos/restaurant/floor",
  "/api/pos/kitchen/tickets?limit=200",
  "/api/pos/restaurant/menu",
  "/api/pos/restaurant/qr-orders",
  "/api/pos/restaurant/service-calls",
  "/api/pos/restaurant/waitlist",
] as const;

type PreparedRestaurantSlot = {
  token: string;
  expiresAt: number;
  responses: Map<string, unknown>;
};

type PreparedBoardGameSlot = {
  token: string;
  cashierUserId: string;
  expiresAt: number;
  workspace: unknown;
};

type PosStartupPreparationValue = {
  prepareRestaurantWorkspace: (token: string) => Promise<void>;
  takeRestaurantStartupResponse: (token: string, url: string) => unknown | undefined;
  prepareBoardGameWorkspace: (token: string, cashierUserId: string, pin: string) => Promise<void>;
  takeBoardGameWorkspace: (token: string, cashierUserId: string) => unknown | undefined;
  clearPreparedWorkspaces: () => void;
};

const PosStartupPreparationContext = createContext<PosStartupPreparationValue | null>(null);

function responseMessage(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const value = body as Record<string, unknown>;
    for (const key of ["error", "reason", "message"]) {
      if (typeof value[key] === "string" && value[key]) return value[key];
    }
  }
  return `โหลดข้อมูลหน้าร้านไม่สำเร็จ (HTTP ${status})`;
}

async function readJson(response: Response): Promise<unknown> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(responseMessage(body, response.status));
  return body;
}

/**
 * One short-lived hand-off between the Desktop PIN gate and the first operating workspace.
 *
 * The provider lives in the shared /pos layout, so a prepared Restaurant response survives the
 * client-side route change from /pos/app to /pos/restaurant. Nothing is persisted: a reload,
 * lock, unpair, timeout, or successful consume discards the snapshot, and the PIN is never kept
 * in either prepared slot.
 */
export function PosStartupPreparationProvider({ children }: { children: ReactNode }) {
  const restaurant = useRef<PreparedRestaurantSlot | null>(null);
  const restaurantInFlight = useRef<{ token: string; promise: Promise<void> } | null>(null);
  const restaurantAbort = useRef<AbortController | null>(null);
  const restaurantGeneration = useRef(0);
  const boardGame = useRef<PreparedBoardGameSlot | null>(null);
  const boardGameInFlight = useRef<{
    token: string;
    cashierUserId: string;
    promise: Promise<void>;
  } | null>(null);
  const boardGameAbort = useRef<AbortController | null>(null);
  const boardGameGeneration = useRef(0);

  const prepareRestaurantWorkspace = useCallback((token: string): Promise<void> => {
    const cached = restaurant.current;
    if (cached?.token === token && cached.expiresAt > Date.now() && cached.responses.size > 0) {
      return Promise.resolve();
    }
    const active = restaurantInFlight.current;
    if (active?.token === token) return active.promise;

    const generation = ++restaurantGeneration.current;
    const controller = new AbortController();
    restaurantAbort.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), PREPARE_TIMEOUT_MS);
    const promise = Promise.all(RESTAURANT_STARTUP_URLS.map(async (url) => {
      const response = await fetch(url, {
        headers: { "x-pos-device-token": token },
        cache: "no-store",
        signal: controller.signal,
      });
      return [url, await readJson(response)] as const;
    })).then((entries) => {
      if (restaurantGeneration.current !== generation) return;
      restaurant.current = {
        token,
        expiresAt: Date.now() + PREPARED_TTL_MS,
        responses: new Map(entries),
      };
    }).catch((cause) => {
      if (cause instanceof DOMException && cause.name === "AbortError") {
        throw new Error("โหลดข้อมูลหน้าร้านใช้เวลานานเกินไป กรุณาลองอีกครั้ง");
      }
      throw cause;
    }).finally(() => {
      window.clearTimeout(timeout);
      if (restaurantAbort.current === controller) restaurantAbort.current = null;
      if (restaurantInFlight.current?.promise === promise) restaurantInFlight.current = null;
    });
    restaurantInFlight.current = { token, promise };
    return promise;
  }, []);

  const takeRestaurantStartupResponse = useCallback((token: string, url: string) => {
    const cached = restaurant.current;
    if (!cached || cached.token !== token || cached.expiresAt <= Date.now()) {
      restaurant.current = null;
      return undefined;
    }
    if (!cached.responses.has(url)) return undefined;
    const body = cached.responses.get(url);
    cached.responses.delete(url);
    if (cached.responses.size === 0) restaurant.current = null;
    return body;
  }, []);

  const prepareBoardGameWorkspace = useCallback((
    token: string,
    cashierUserId: string,
    pin: string,
  ): Promise<void> => {
    const cached = boardGame.current;
    if (cached?.token === token
      && cached.cashierUserId === cashierUserId
      && cached.expiresAt > Date.now()) return Promise.resolve();
    const active = boardGameInFlight.current;
    if (active?.token === token && active.cashierUserId === cashierUserId) return active.promise;

    const generation = ++boardGameGeneration.current;
    const controller = new AbortController();
    boardGameAbort.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), PREPARE_TIMEOUT_MS);
    const promise = fetch("/api/pos/board-game", {
      method: "POST",
      headers: { "content-type": "application/json", "x-pos-device-token": token },
      body: JSON.stringify({ action: "workspace", cashierUserId, pin }),
      cache: "no-store",
      signal: controller.signal,
    }).then(readJson).then((workspace) => {
      if (boardGameGeneration.current !== generation) return;
      boardGame.current = {
        token,
        cashierUserId,
        expiresAt: Date.now() + PREPARED_TTL_MS,
        workspace,
      };
    }).catch((cause) => {
      if (cause instanceof DOMException && cause.name === "AbortError") {
        throw new Error("โหลดข้อมูลหน้าร้านใช้เวลานานเกินไป กรุณาลองอีกครั้ง");
      }
      throw cause;
    }).finally(() => {
      window.clearTimeout(timeout);
      if (boardGameAbort.current === controller) boardGameAbort.current = null;
      if (boardGameInFlight.current?.promise === promise) boardGameInFlight.current = null;
    });
    boardGameInFlight.current = { token, cashierUserId, promise };
    return promise;
  }, []);

  const takeBoardGameWorkspace = useCallback((token: string, cashierUserId: string) => {
    const cached = boardGame.current;
    boardGame.current = null;
    if (!cached
      || cached.token !== token
      || cached.cashierUserId !== cashierUserId
      || cached.expiresAt <= Date.now()) return undefined;
    return cached.workspace;
  }, []);

  const clearPreparedWorkspaces = useCallback(() => {
    restaurantGeneration.current += 1;
    boardGameGeneration.current += 1;
    restaurantAbort.current?.abort();
    boardGameAbort.current?.abort();
    restaurantAbort.current = null;
    boardGameAbort.current = null;
    restaurant.current = null;
    restaurantInFlight.current = null;
    boardGame.current = null;
    boardGameInFlight.current = null;
  }, []);

  const value = useMemo(() => ({
    prepareRestaurantWorkspace,
    takeRestaurantStartupResponse,
    prepareBoardGameWorkspace,
    takeBoardGameWorkspace,
    clearPreparedWorkspaces,
  }), [
    clearPreparedWorkspaces,
    prepareBoardGameWorkspace,
    prepareRestaurantWorkspace,
    takeBoardGameWorkspace,
    takeRestaurantStartupResponse,
  ]);

  return (
    <PosStartupPreparationContext.Provider value={value}>
      {children}
    </PosStartupPreparationContext.Provider>
  );
}

export function usePosStartupPreparation(): PosStartupPreparationValue {
  const value = useContext(PosStartupPreparationContext);
  if (!value) throw new Error("usePosStartupPreparation must be used inside PosStartupPreparationProvider");
  return value;
}
