// While Diagnostics is on in settings, each open of the page and each return to it records what
// the page draws in its first seconds: what the store sends, and how much each part it draws whole
// (each `data-last-drawn` element) shows, frame by frame. The last few records stay on this
// device. Its button shares them, after the page as it is right then, as a report on a phone or
// tablet, or copies it on a computer, after a header that names the release, the device, the
// page's state, how the store's updates stand, and how each of its background jobs last ran, and
// before the steps the service worker kept (service-worker-steps.js), which it keeps on its own,
// since a load it never let reach the page is what they're for, and the logs of the viewport's
// changes (viewport-log.js), of what each dialog's row of sheets does (sheet-log.js), of what a
// season's list of days does (day-strip-log.js), of what became of each touch on a season's
// standings and bracket (bracket-standings-log.js), of what became of each touch and click on
// settings and Contact (settings-touch-log.js), of each change of the phone's look
// (phone-look-log.js), and of each error the page's code doesn't catch (error-log.js). It records
// nothing while it's off, which it starts as.

import {
  formatClockTime,
  formatClockTimeWithSeconds,
  formatWeekdayAndDate,
  nameDay,
  readDeviceTimeZone,
} from "./days.js";
import { isOnHomeScreen, isTouchDevice } from "./device.js";
import { capitalize, html, joinWithSeparator, setHtml } from "./html.js";
import { describeAnimations, describeShownDayLists } from "./list-log.js";
import {
  forgetStored,
  readStoredJson,
  readStoredText,
  storeJson,
  storeText,
} from "./local-storage.js";
import { prefersReducedMotion } from "./reduced-motion.js";
import { readPageRelease } from "./release.js";
import { watchTimeAway } from "./resume.js";
import { forgetServiceWorkerSteps, readServiceWorkerSteps } from "./service-worker.js";
import { SENT_MS } from "./sent-label.js";
import { listSheetsInOpenDialogs } from "./sheet-reopen.js";
import { bracketStandingsLog, watchTouches } from "./bracket-standings-log.js";
import { dayStripLog } from "./day-strip-log.js";
import { errorLog, watchErrors } from "./error-log.js";
import { phoneLookLog, watchPhoneLook } from "./phone-look-log.js";
import { settingsTouchLog, watchSettingsTouches } from "./settings-touch-log.js";
import { sheetLog } from "./sheet-log.js";
import { writeStepsAsText } from "./step-log.js";
import { hideAddresses } from "./report-addresses.js";
import {
  forgetViewportLines,
  readViewportLines,
  watchViewport,
  writeViewportAsText,
} from "./viewport-log.js";

const SWITCH_KEY = "diagnostics";
const RECORDS_KEY = "diagnosticsRecords";
export const RECORD_MS = 5000;
const KEPT_RECORDS = 5;
// A part whose text shrinks by more than this share dipped, which is what a flicker looks like.
const DIP_SHARE = 0.25;
const MINUTE_MS = 60 * 1000;
const ON_REQUEST = "On request";
const STEP_LOGS = [
  errorLog,
  sheetLog,
  dayStripLog,
  bracketStandingsLog,
  settingsTouchLog,
  phoneLookLog,
];
const SERVICE_WORKER_TITLE = "Service worker";

/** @typedef {{ ms: number, text: string, isDip?: boolean }} RecordLine */
/** @typedef {"copied" | "shared"} ReportStep */
/** @typedef {{ at: number, how: string, tab: string, lines: RecordLine[] }} OpenRecord */
/** @typedef {{ text: number, height: number }} PartSize */
/**
 * @typedef {{
 *   appName: string,
 *   release: import("./release.js").Release | null,
 *   userAgent: string,
 *   isOnHomeScreen: boolean,
 *   width: number,
 *   height: number,
 *   pixelRatio: number,
 *   prefersReducedMotion: boolean,
 *   theme: string | undefined,
 *   timeZone: string,
 *   openedAt: number,
 *   returns: number,
 *   jobs: JobStatus[],
 *   update: UpdateStatus | null | undefined,
 *   now: Date,
 * }} PageFacts
 */
/**
 * A background job's status document, as the store last answered for it, or null when it
 * couldn't be read, with how often a sheet read the league for what the job should have kept, for
 * a job that counts it.
 * @typedef {{
 *   name: string,
 *   status:
 *     | Partial<import("../worker/job-status.js").JobRunStatus & { leagueReads: number }>
 *     | null
 *     | undefined,
 * }} JobStatus
 */

/**
 * The status the store saves as each update of the season's data ends, from `live/status`, with
 * when it last changed.
 * @typedef {Record<string, string> & { at?: string }} UpdateStatus
 */

/** @type {OpenRecord | null} */
let record = null;
let recordStartedAt = 0;
/** @type {Map<string, PartSize>} */
let shownSizes = new Map();
/** @type {ReportStep | null} */
let reportStep = null;
/** @type {ReturnType<typeof setTimeout> | undefined} */
let reportTimer;
const openedAt = Date.now();
let returns = 0;
/** @type {(() => Promise<JobStatus[]>) | null} */
let readJobStatuses = null;
/** @type {JobStatus[]} */
let jobStatuses = [];
/** @type {(() => UpdateStatus | null | undefined) | null} */
let readUpdateStatus = null;
/** @type {import("./step-log.js").StepLine[]} */
let serviceWorkerSteps = [];

const findElement = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

const isRecording = () => readStoredText(SWITCH_KEY) === "on";

/** @returns {OpenRecord[]} */
function readRecords() {
  const records = readStoredJson(RECORDS_KEY);
  return Array.isArray(records) ? records : [];
}

// A record storage won't take is lost, and the next one tries again.
/** @param {OpenRecord[]} records */
const saveRecords = (records) => storeJson(RECORDS_KEY, records.slice(-KEPT_RECORDS));

// A switch storage won't take stays as it was.
/** @param {boolean} isOn */
function saveSwitch(isOn) {
  if (isOn) {
    storeText(SWITCH_KEY, "on");
    return;
  }
  if (!forgetStored(SWITCH_KEY)) return;
  forgetStored(RECORDS_KEY);
  forgetViewportLines();
  for (const log of STEP_LOGS) log.forgetLines();
  forgetServiceWorkerSteps();
}

/**
 * Adds a step that happened at `at`, on the page's performance clock, to the record under way, if
 * there is one.
 * @param {number} at
 * @param {string} text
 * @param {boolean} [isDip]
 */
function noteStepAt(at, text, isDip = false) {
  if (!record) return;
  record.lines.push({ ms: Math.round(at - recordStartedAt), text, isDip });
}

/**
 * Adds a step to the record under way, if there is one.
 * @param {string} text
 * @param {boolean} [isDip]
 */
export function noteStep(text, isDip = false) {
  noteStepAt(performance.now(), text, isDip);
}

function readPartSizes() {
  const parts = /** @type {HTMLElement[]} */ ([...document.querySelectorAll("[data-last-drawn]")]);
  return new Map(
    parts.map((part) => [
      part.id,
      {
        text: (part.textContent ?? "").replace(/\s+/g, "").length,
        // Its height as laid out, which a sheet sliding it doesn't change, as its box on the screen,
        // rounded to a pixel, would as it moves.
        height: part.offsetHeight,
      },
    ]),
  );
}

/**
 * @param {string} id
 * @param {PartSize} before
 * @param {PartSize} after
 */
function describeChange(id, before, after) {
  const changes = [
    before.text !== after.text && `text ${before.text} to ${after.text}`,
    before.height !== after.height && `height ${before.height} to ${after.height}px`,
  ].filter(Boolean);
  return `${id}: ${changes.join(", ")}`;
}

/** @param {Map<string, PartSize>} sizes */
const describeSizes = (sizes) =>
  [...sizes].map(([id, size]) => `${id} ${size.text}/${size.height}px`).join(", ");

/**
 * @param {PartSize} before
 * @param {PartSize} after
 */
const isDip = (before, after) => after.text < before.text * (1 - DIP_SHARE);

function noteChangedParts() {
  const sizes = readPartSizes();
  for (const [id, after] of sizes) {
    const before = shownSizes.get(id);
    if (!before || (before.text === after.text && before.height === after.height)) continue;
    noteStep(describeChange(id, before, after), isDip(before, after));
  }
  shownSizes = sizes;
}

// Steps the browser reports late, like the first paint, go back among the others by when they happened.
/** @param {OpenRecord} openRecord */
const sortLines = (openRecord) => ({
  ...openRecord,
  lines: openRecord.lines.toSorted((first, second) => first.ms - second.ms),
});

function finishRecord() {
  if (!record) return;
  saveRecords([...readRecords(), sortLines(record)]);
  record = null;
  drawRecords();
}

/**
 * The records kept, and the one under way, newest first.
 * @returns {OpenRecord[]}
 */
const listRecords = () => [...readRecords(), ...(record ? [sortLines(record)] : [])].toReversed();

const describeShownLists = () => [...describeShownDayLists(), describeAnimations()];

function sampleParts() {
  if (!record) return;
  noteChangedParts();
  if (performance.now() - recordStartedAt < RECORD_MS) requestAnimationFrame(sampleParts);
  else {
    for (const line of describeShownLists()) noteStep(line);
    finishRecord();
  }
}

const PAINT_NAMES = {
  "first-paint": "First paint",
  "first-contentful-paint": "First contentful paint",
};

/** @param {string} url */
const readFileName = (url) => new URL(url, location.href).pathname.split("/").pop() ?? "";

/** @param {PerformanceEntry} entry */
const isFontFile = (entry) => readFileName(entry.name).endsWith(".woff2");

// A font file that arrives after the first paint swaps out the stand-in font its text was drawn in.
/** @param {PerformanceEntry} entry */
function noteTiming(entry) {
  if (entry.entryType === "paint")
    noteStepAt(entry.startTime, PAINT_NAMES[entry.name] ?? entry.name);
  else if (isFontFile(entry))
    noteStepAt(
      /** @type {PerformanceResourceTiming} */ (entry).responseEnd,
      `Font ${readFileName(entry.name)} arrived`,
    );
}

// The page's first paints and font files can come before its modules run, so the record takes
// those the browser already has too.
function watchTimings() {
  if (typeof PerformanceObserver === "undefined") return;
  const observer = new PerformanceObserver((list) => list.getEntries().forEach(noteTiming));
  for (const type of ["paint", "resource"]) observer.observe({ type, buffered: true });
}

// A tab named for what it opens on holds a face for each, only one of them shown.
const readShownTab = () =>
  document
    .querySelector("nav.tabs [role=tab][aria-selected=true] .tab-label:not([hidden] *)")
    ?.textContent?.trim() ?? "";

/**
 * A line for each sheet in an open dialog's row, saying which one its dialog shows.
 * @param {{ id: string, isShown: boolean }[]} sheets
 * @returns {string[]}
 */
export const describeOpenSheets = (sheets) =>
  sheets.length
    ? sheets.map(({ id, isShown }) => `Sheet ${id}${isShown ? ", shown" : ""}`)
    : ["No sheets open"];

/** @param {string} how */
function startRecord(how) {
  finishRecord();
  if (!isRecording()) return;
  record = { at: Date.now(), how, tab: readShownTab(), lines: [] };
  recordStartedAt = performance.now();
  shownSizes = readPartSizes();
  noteStep(`Shows ${describeSizes(shownSizes)}`);
  requestAnimationFrame(sampleParts);
}

/**
 * The page as it is right now, with the sheets open, for the report being sent. It's never kept,
 * so sending reports never pushes out the records of opens and returns.
 * @returns {OpenRecord}
 */
function describePageNow() {
  const lines = [
    ...describeOpenSheets(listSheetsInOpenDialogs()),
    `Shows ${describeSizes(readPartSizes())}`,
    ...describeShownLists(),
  ];
  return {
    at: Date.now(),
    how: ON_REQUEST,
    tab: readShownTab(),
    lines: lines.map((text) => ({ ms: 0, text })),
  };
}

/**
 * @param {number} ms
 * @returns {string}
 */
function formatDuration(ms) {
  const minutes = Math.round(ms / MINUTE_MS);
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/**
 * @param {number} awayMs
 * @returns {string}
 */
export const describeTimeAway = (awayMs) => `Back after ${formatDuration(awayMs)}`;

/**
 * The device and browser a user agent names: an iPhone's or iPad's model, Safari version, WebKit
 * build, and the iOS version Safari reports, or the user agent itself for any other. Safari stopped
 * moving its reported iOS version past 18, so the Safari version is what tells a newer iOS apart.
 * @param {string} userAgent
 * @returns {string}
 */
export function describeDevice(userAgent) {
  const ios = /(iPhone|iPad|iPod).*? OS (\d+(?:_\d+)*)/.exec(userAgent);
  if (!ios) return userAgent;
  const safari = /Version\/([\d.]+)/.exec(userAgent);
  const webKit = /AppleWebKit\/([\d.]+)/.exec(userAgent);
  return [
    ios[1],
    safari && `Safari ${safari[1]}`,
    webKit && `WebKit ${webKit[1]}`,
    `reports iOS ${ios[2].replaceAll("_", ".")}`,
  ]
    .filter(Boolean)
    .join(", ");
}

/** @param {{ appName: string, release: import("./release.js").Release | null }} facts */
function describeRelease({ appName, release: shown }) {
  if (!shown) return `${appName}, release unknown`;
  return [appName, shown.version && `v${shown.version}`, `commit ${shown.commit}`]
    .filter(Boolean)
    .join(" ");
}

/** @param {{ appName: string, release: import("./release.js").Release | null }} facts */
const renderRelease = ({ appName, release: shown }) =>
  joinWithSeparator(
    shown
      ? [appName, shown.version && `v${shown.version}`, shown.commit].filter(Boolean)
      : [appName, "Release unknown"],
  );

/** @param {Date} date */
const formatMoment = (date) => `${formatWeekdayAndDate(date)} ${formatClockTimeWithSeconds(date)}`;

/** @param {number} count */
const countTimes = (count) => (count === 1 ? "1 time" : `${count} times`);

/** @param {number} count */
const countRequests = (count) => (count === 1 ? "1 request" : `${count} requests`);

/**
 * One line on a background job's last run, from the status document it saves.
 * @param {JobStatus} job
 * @returns {string}
 */
export function describeJobStatus({ name, status }) {
  const job = `${capitalize(name)} job`;
  if (status === null) return `${job}: status couldn't be read`;
  if (!status?.ranAt) return `${job}: no run saved`;
  const { lastFailure } = status;
  return [
    `${job} last ran ${formatMoment(new Date(status.ranAt))}`,
    countRequests(status.requests ?? 0),
    Number.isInteger(status.leagueReads) &&
      `sheets read the league ${countTimes(Number(status.leagueReads))}`,
    lastFailure && `last failed ${formatMoment(new Date(lastFailure.at))}: ${lastFailure.message}`,
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * One line on how the store's updates of the season's data stand, from the status it last saved,
 * naming each field that has something to report.
 * @param {UpdateStatus | null | undefined} status
 * @returns {string}
 */
export function describeUpdateStatus(status) {
  if (!status?.at) return "Updates: no status read";
  const since = formatMoment(new Date(status.at));
  const fields = Object.entries(status)
    .filter(([field, value]) => field !== "at" && value)
    .map(([field, value]) => `${field} ${value}`);
  return fields.length
    ? `Updates since ${since}: ${fields.join(", ")}`
    : `Updates ok since ${since}`;
}

/**
 * The lines that open the report, saying which release, on what device, in what state.
 * @param {PageFacts} facts
 * @returns {string}
 */
export const writeHeader = (facts) =>
  [
    describeRelease(facts),
    `Device: ${describeDevice(facts.userAgent)}`,
    facts.isOnHomeScreen ? "Runs from the home screen" : "Runs in the browser",
    `Viewport ${facts.width}x${facts.height} at ${facts.pixelRatio}x`,
    `Reduced motion ${facts.prefersReducedMotion ? "on" : "off"}`,
    facts.theme && `Theme ${facts.theme}`,
    `Opened ${formatMoment(new Date(facts.openedAt))}, ${formatDuration(facts.now.getTime() - facts.openedAt)} ago`,
    `Back from the background ${countTimes(facts.returns)} since`,
    `Now ${formatMoment(facts.now)}, ${facts.timeZone}`,
    describeUpdateStatus(facts.update),
    ...facts.jobs.map(describeJobStatus),
  ]
    .filter(Boolean)
    .join("\n");

/** @returns {PageFacts} */
const readPageFacts = () => ({
  appName:
    document.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute("content") ??
    document.title,
  release: readPageRelease(),
  userAgent: navigator.userAgent,
  isOnHomeScreen: isOnHomeScreen(),
  width: innerWidth,
  height: innerHeight,
  pixelRatio: devicePixelRatio,
  prefersReducedMotion: prefersReducedMotion(),
  theme: document.documentElement.dataset.theme,
  timeZone: readDeviceTimeZone(),
  openedAt,
  returns,
  jobs: jobStatuses,
  update: readUpdateStatus?.(),
  now: new Date(),
});

// Read as settings opens, so a report sent from there names how the jobs stand, and what the
// service worker did, without waiting.
function refreshJobStatuses() {
  readJobStatuses?.().then((read) => {
    jobStatuses = read;
  });
  readServiceWorkerSteps().then((steps) => {
    serviceWorkerSteps = steps;
    drawRecords();
  });
}

/**
 * Has the report name how each of the store's background jobs last ran, from the status document
 * each saves as `<name>/status`, read as Diagnostics starts recording and as settings opens.
 * @param {{ doc: (path: string) => { get: () => Promise<{ data: () => any }> } }} store
 * @param {string[]} names
 */
export function showJobStatuses(store, names) {
  readJobStatuses = () =>
    Promise.all(
      names.map(async (name) => {
        try {
          return { name, status: (await store.doc(`${name}/status`).get()).data() };
        } catch {
          return { name, status: null };
        }
      }),
    );
  if (isRecording()) refreshJobStatuses();
}

/**
 * Has the report name how the store's updates of the season's data stand, from the status the
 * page already follows.
 * @param {() => UpdateStatus | null | undefined} readStatus
 */
export function showUpdateStatus(readStatus) {
  readUpdateStatus = readStatus;
}

/**
 * @param {string | undefined} navigationType a PerformanceNavigationTiming's type
 * @returns {string}
 */
export const describeLoad = (navigationType) =>
  navigationType === "reload" ? "Reloaded" : "Opened";

function readNavigationType() {
  const [navigation] = /** @type {PerformanceNavigationTiming[]} */ (
    performance.getEntriesByType("navigation")
  );
  return navigation?.type;
}

/** @param {OpenRecord} openRecord */
const hasDip = (openRecord) => openRecord.lines.some((line) => line.isDip);

/**
 * @param {OpenRecord} openRecord
 * @param {Date} now
 */
function describeWhen(openRecord, now) {
  const at = new Date(openRecord.at);
  return `${nameDay(at, now, { isCapitalized: true })} ${formatClockTime(at)}`;
}

/**
 * @param {OpenRecord} openRecord
 * @param {Date} now
 */
const describeRecord = (openRecord, now) =>
  [describeWhen(openRecord, now), openRecord.how, openRecord.tab].filter(Boolean);

/**
 * How long after its record started a step came, or before it, like a paint before the page's
 * modules ran.
 * @param {number} ms
 */
const formatStepTime = (ms) => (ms < 0 ? String(ms) : `+${ms}`);

/**
 * @param {OpenRecord[]} records newest first
 * @param {Date} now
 * @returns {string}
 */
export const writeRecordsAsText = (records, now) =>
  records
    .map((openRecord) =>
      [
        describeRecord(openRecord, now).join(", ") + (hasDip(openRecord) ? " (dip)" : ""),
        ...openRecord.lines.map((line) => `${formatStepTime(line.ms)} ${line.text}`),
      ].join("\n"),
    )
    .join("\n\n");

/** @param {RecordLine} line */
const renderLine = (line) =>
  html`<li class="${line.isDip ? "diagnostics-dip" : ""}">
    <span class="diagnostics-ms">${formatStepTime(line.ms)}</span><span>${line.text}</span>
  </li>`;

/**
 * Each record's open state the viewer chose, by its `data-record` key, since a redraw puts back
 * each record's markup.
 * @type {Map<string, boolean>}
 */
const chosenOpen = new Map();
/**
 * Each record's open state as the last draw drew it, so only what the viewer changed since counts
 * as a choice, never a record drawn open as the newest.
 * @type {Map<string, boolean>}
 */
let drawnOpen = new Map();

/** @param {Element} section */
function noteChosenOpen(section) {
  for (const details of section.querySelectorAll("details[data-record]")) {
    const { open } = /** @type {HTMLDetailsElement} */ (details);
    const key = /** @type {HTMLDetailsElement} */ (details).dataset.record ?? "";
    if (open !== drawnOpen.get(key)) chosenOpen.set(key, open);
  }
}

/**
 * The attributes that key a record and open it as the viewer chose, or as it opens at first.
 * @param {string} key
 * @param {boolean} isOpenAtFirst
 */
function renderRecordState(key, isOpenAtFirst) {
  const isOpen = chosenOpen.get(key) ?? isOpenAtFirst;
  drawnOpen.set(key, isOpen);
  return html`data-record="${key}" ${isOpen ? "open" : ""}`;
}

/**
 * @param {OpenRecord} openRecord
 * @param {number} index
 */
const renderRecord = (openRecord, index) =>
  html`<details class="diagnostics-record" ${renderRecordState(String(openRecord.at), index === 0)}>
    <summary class="press-tint">
      <span class="diagnostics-when"
        >${joinWithSeparator(describeRecord(openRecord, new Date()))}</span
      >
      <span class="diagnostics-flag ${hasDip(openRecord) ? "dip" : ""}"
        >${hasDip(openRecord) ? "Dip" : "Steady"}</span
      >
    </summary>
    <ol class="diagnostics-lines">
      ${openRecord.lines.map(renderLine)}
    </ol>
  </details>`;

/** @param {import("./viewport-log.js").ViewportLine} line */
const renderViewportLine = (line) =>
  html`<li class="${line.isOff ? "diagnostics-dip" : ""}">
    <span class="diagnostics-ms">${formatClockTimeWithSeconds(new Date(line.at))}</span
    ><span>${line.text}</span>
  </li>`;

/** @param {import("./step-log.js").StepLine} line */
const renderStepLine = (line) =>
  html`<li>
    <span class="diagnostics-ms">${formatClockTimeWithSeconds(new Date(line.at))}</span
    ><span>${line.text}</span>
  </li>`;

/**
 * @param {string} title
 * @param {import("./step-log.js").StepLine[]} lines newest first
 */
const renderSteps = (title, lines) =>
  lines.length > 0 &&
  html`<details class="diagnostics-record" ${renderRecordState(title, false)}>
    <summary class="press-tint"><span class="diagnostics-when">${title}</span></summary>
    <ol class="diagnostics-lines diagnostics-viewport">
      ${lines.map(renderStepLine)}
    </ol>
  </details>`;

/** @param {import("./step-log.js").StepLog} log */
const renderStepLog = (log) => renderSteps(log.title, log.readLines().toReversed());

const listServiceWorkerSteps = () => serviceWorkerSteps.toReversed();

const VIEWPORT_TITLE = "Viewport";

/** @param {import("./viewport-log.js").ViewportLine[]} lines newest first */
const renderViewport = (lines) => {
  const isOff = lines.some((line) => line.isOff);
  return html`<details class="diagnostics-record" ${renderRecordState(VIEWPORT_TITLE, false)}>
    <summary class="press-tint">
      <span class="diagnostics-when">${VIEWPORT_TITLE}</span>
      <span class="diagnostics-flag ${isOff ? "dip" : ""}">${isOff ? "Off" : "Steady"}</span>
    </summary>
    <ol class="diagnostics-lines diagnostics-viewport">
      ${lines.map(renderViewportLine)}
    </ol>
  </details>`;
};

/**
 * What the report button says: the way to send the report, then, for a moment, that it was sent.
 * @param {{ reportStep: ReportStep | null, isTouch: boolean }} state
 * @returns {string}
 */
export function nameReportButton({ reportStep: step, isTouch }) {
  if (step === "copied") return "Copied";
  if (step === "shared") return "Shared";
  return isTouch ? "Share report" : "Copy report";
}

const renderReportButton = () =>
  html`<button type="button" class="diagnostics-button" id="diagnosticsReport">
    ${nameReportButton({ reportStep, isTouch: isTouchDevice() })}
  </button>`;

function renderRecords() {
  const records = listRecords();
  const viewportLines = readViewportLines().toReversed();
  return html`<p class="diagnostics-release">${renderRelease(readPageFacts())}</p>
    <div class="diagnostics-head">
      <h3>Recent opens</h3>
      <div class="diagnostics-actions">${renderReportButton()}</div>
    </div>
    ${
      records.length
        ? records.map(renderRecord)
        : html`<p class="diagnostics-empty">Nothing yet. Each open from now on shows here.</p>`
    }
    ${renderSteps(SERVICE_WORKER_TITLE, listServiceWorkerSteps())}
    ${viewportLines.length > 0 && renderViewport(viewportLines)}
    ${STEP_LOGS.map(renderStepLog)}`;
}

const findSettings = () =>
  /** @type {HTMLDialogElement | null} */ (findElement("diagnostics").closest("dialog"));

// The records are drawn only while settings shows them, and again as it opens, since a log can
// take a line many times a second.
function drawRecords() {
  const isOn = isRecording();
  findElement("diagnosticsSwitch").setAttribute("aria-checked", String(isOn));
  const section = findElement("diagnostics");
  section.hidden = !isOn;
  if (!findSettings()?.open) return;
  noteChosenOpen(section);
  drawnOpen = new Map();
  setHtml(section, isOn ? renderRecords() : html``);
}

function drawRecordsAsSettingsOpens() {
  const settings = findSettings();
  if (!settings) return;
  new MutationObserver(() => settings.open && drawRecords()).observe(settings, {
    attributeFilter: ["open"],
  });
}

function toggleRecording() {
  const isOn = !isRecording();
  saveSwitch(isOn);
  if (isOn) refreshJobStatuses();
  else record = null;
  reportStep = null;
  drawRecords();
}

/**
 * A report from its parts, each that has anything, with no address in any of its lines, wherever
 * a line came from, like a job's failure or the service worker's steps.
 * @param {string[]} parts
 */
export const joinReport = (parts) => hideAddresses(parts.filter(Boolean).join("\n\n"));

/** @param {OpenRecord} pageNow */
function writeReport(pageNow) {
  const header = writeHeader(readPageFacts());
  const records = writeRecordsAsText([pageNow, ...listRecords()], new Date());
  const worker = writeStepsAsText(SERVICE_WORKER_TITLE, listServiceWorkerSteps());
  const viewport = writeViewportAsText(readViewportLines().toReversed());
  const steps = STEP_LOGS.map((log) => log.writeLinesAsText(log.readLines().toReversed()));
  return joinReport([header, records, worker, viewport, ...steps]);
}

/** @param {ReportStep | null} step */
function showReportStep(step) {
  clearTimeout(reportTimer);
  reportStep = step;
  drawRecords();
  if (step) reportTimer = setTimeout(() => showReportStep(null), SENT_MS);
}

/**
 * Opens the phone's share sheet, which has to start in the tap's own gesture, so it's called
 * before anything waits. A share sheet the viewer closes was their choice, so nothing else happens.
 * @param {string} text
 * @returns {Promise<"shared" | "closed" | "failed">}
 */
async function shareReport(text) {
  if (!isTouchDevice() || typeof navigator.share !== "function") return "failed";
  try {
    await navigator.share({ title: `${readPageFacts().appName} Diagnostics`, text });
    return "shared";
  } catch (error) {
    return error instanceof DOMException && error.name === "AbortError" ? "closed" : "failed";
  }
}

/**
 * @param {string} text
 * @returns {Promise<boolean>} whether it was copied
 */
async function copyReport(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

async function sendReport() {
  const text = buildDiagnosticsReport();
  const shared = await shareReport(text);
  if (shared === "shared") showReportStep("shared");
  else if (shared === "failed" && (await copyReport(text))) showReportStep("copied");
}

export const buildDiagnosticsReport = () => writeReport(describePageNow());

/** @param {Event} event */
function followSectionClick(event) {
  const target = /** @type {Element} */ (event.target);
  if (target.closest("#diagnosticsReport")) sendReport();
}

function refreshJobStatusesWhileRecording() {
  if (isRecording()) refreshJobStatuses();
}

/** @param {number} awayMs */
function noteReturn(awayMs) {
  returns += 1;
  startRecord(describeTimeAway(awayMs));
}

/**
 * Wires the settings switch (#diagnosticsSwitch) and the records under it (#diagnostics), and,
 * while the switch is on, records this load, each return to the page, each change to the
 * viewport, each step of a dialog's row of sheets, what became of each touch on the standings
 * and bracket and on settings and Contact, and each change of the phone's look. A page that
 * leaves the screen keeps what it recorded so far, as when it reloads for a new release or the
 * phone drops it. The page starts it before drawing anything, so a load's first reading is what
 * show-last-drawn.js put back.
 */
export function startDiagnostics() {
  findElement("diagnosticsSwitch").addEventListener("click", toggleRecording);
  findElement("diagnostics").addEventListener("click", followSectionClick);
  findElement("settingsBtn").addEventListener("click", refreshJobStatusesWhileRecording);
  drawRecordsAsSettingsOpens();
  drawRecords();
  startRecord(describeLoad(readNavigationType()));
  watchTimings();
  watchTimeAway(noteReturn);
  // Its line for the page leaving the screen joins the record before the record closes, and the
  // step logs keep it as they save on the page's hiding.
  watchPhoneLook(noteStep);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) finishRecord();
  });
  addEventListener("pagehide", finishRecord);
  watchViewport(isRecording, drawRecords);
  for (const log of STEP_LOGS) log.watchSteps(isRecording, drawRecords);
  watchErrors();
  watchTouches();
  watchSettingsTouches();
}
