declare const Sortable: {
  create(element: HTMLElement, options: Record<string, unknown>): unknown;
};

// The page's plain scripts in its head share these, from shared/page/pick-theme.js,
// long-away.js, open-last-tab.js, and season-header.js.
declare function isOnHomeScreen(): boolean;
declare function isAppearanceChoice(value: unknown): boolean;
declare function readPickedAppearance(): string;
declare function keepPickedAppearance(choice: string): void;
declare function openThemeAddress(choice: string): void;
declare function buildSafariAddress(choice: string, address: string): string;
declare const WELCOME_CLOSED_KEY: string;
declare function forgetWelcomeClosed(): void;
declare const START_AFTER_AWAY_MS: number;
declare function isAwayLong(awayMs: number): boolean;
declare function isLongAwayFrom(savedAt: unknown): boolean;
declare function findPlaceToShow(
  saved: {
    scrolls?: unknown;
    holderTop?: unknown;
    pageTop?: unknown;
    classes?: unknown;
    savedAt?: unknown;
  },
  isInSheet: boolean,
): {
  scrolls: { path: unknown; left: number; top: number; isOnStart: boolean }[];
  holderTop: number;
  pageTop: number;
  classes: string;
  isOnFirstTab: boolean;
};
declare function readStored(key: string): string | null;
declare function followSeasonPart(part?: HTMLElement): void;
declare function listAboveSeasonView(): HTMLElement[];
declare function listPageParts(): HTMLElement[];
declare function isInFlow(element: Element): boolean;

// Cloudflare Workers runtime: a Durable Object answers a WebSocket upgrade with one end of a pair.
declare class WebSocketPair {
  0: WebSocket;
  1: WebSocket;
}

interface ResponseInit {
  webSocket?: WebSocket;
}
