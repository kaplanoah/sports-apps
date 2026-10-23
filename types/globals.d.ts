declare const Sortable: {
  create(element: HTMLElement, options: Record<string, unknown>): unknown;
};

// The page's plain scripts in its head share these, from shared/page/pick-theme.js, page-move.js,
// long-away.js, open-last-tab.js, show-last-drawn.js, season-header.js, and draw-channel-tag-age.js.
declare function isOnHomeScreen(): boolean;
declare function isAppleBrowser(): boolean;
declare function isAppearanceChoice(value: unknown): boolean;
declare function readPickedAppearance(): string;
declare function readAppearanceChoice(stored: string): string;
declare function checkPickedChoice(choices: Iterable<HTMLInputElement>, picked: string): void;
declare function keepPickedAppearance(choice: string): void;
declare function openThemeAddress(choice: string): void;
declare function buildSafariAddress(choice: string, address: string): string;
declare function isLook(value: unknown): value is "light" | "dark";
declare function readPhoneLook(): "light" | "dark";
declare function resolveTheme(choice: string): "light" | "dark";
declare function readHomeScreenIcon(): string | null;
declare const WELCOME_CLOSED_KEY: string;
declare function forgetWelcomeClosed(): void;
declare function isMovingToPageHost(): boolean;
declare function isOldAddress(href: string): boolean;
declare function takeCarriedChoices(now?: number): "light" | "dark" | null;
declare function readPageMove(): object | null;
declare function readPageMoveIcon(): "light" | "dark" | null;
declare function keepPageMoveIcon(icon: "light" | "dark"): void;
declare function forgetPageMove(): void;
declare function isNotificationsAskKept(): boolean;
declare function forgetNotificationsAsk(): void;
declare function requestPageMove(extras?: {
  notifications?: boolean;
  fromApp?: boolean;
}): Promise<URL | null>;
declare function leaveOldAddress(): Promise<void>;
declare const START_AFTER_AWAY_MS: number;
declare function isAwayLong(awayMs: number): boolean;
declare function isLongAwayFrom(savedAt: unknown, now?: number): boolean;
declare function findPlaceToShow(
  saved: {
    hidden?: unknown;
    scrolls?: unknown;
    holderTop?: unknown;
    pageTop?: unknown;
    classes?: unknown;
    savedAt?: unknown;
  },
  where: { isInSheet: boolean; isStartHidden: boolean },
  now: number,
): {
  hidden: boolean;
  scrolls: { path: unknown; left: number; top: number; isOnStart: boolean }[];
  holderTop: number;
  pageTop: number;
  classes: string;
  isOnFirstTab: boolean;
};
declare function readStored(key: string): string | null;
declare const LAST_DRAWN_KEY: string;
declare const OPEN_SHEETS_KEY: string;
declare const LAST_SWITCHED_KEY: string;
declare const KEPT_SWITCHES: string;
declare function followSeasonPart(part?: HTMLElement): void;
declare function listAboveSeasonView(): HTMLElement[];
declare function listPageParts(): HTMLElement[];
declare function isInFlow(element: Element): boolean;
declare function drawChannelTagAge(): void;

// Cloudflare Workers runtime: a Durable Object answers a WebSocket upgrade with one end of a pair.
declare class WebSocketPair {
  0: WebSocket;
  1: WebSocket;
}

interface ResponseInit {
  webSocket?: WebSocket;
}
