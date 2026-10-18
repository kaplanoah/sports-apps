declare const Sortable: {
  create(element: HTMLElement, options: Record<string, unknown>): unknown;
};

// The page's plain scripts in its head share these, from shared/page/pick-theme.js,
// open-last-tab.js, and season-header.js.
declare function isOnHomeScreen(): boolean;
declare function isAppearanceChoice(value: unknown): boolean;
declare function readPickedAppearance(): string;
declare function keepPickedAppearance(choice: string): void;
declare function openThemeAddress(choice: string): void;
declare function buildSafariAddress(choice: string, address: string): string;
declare const WELCOME_CLOSED_KEY: string;
declare function readStored(key: string): string | null;
declare function followSeasonPart(part?: HTMLElement): void;

// Cloudflare Workers runtime: a Durable Object answers a WebSocket upgrade with one end of a pair.
declare class WebSocketPair {
  0: WebSocket;
  1: WebSocket;
}

interface ResponseInit {
  webSocket?: WebSocket;
}
