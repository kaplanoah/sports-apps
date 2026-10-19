import { html } from "#shared/html.js";
import { renderPlaceholder } from "#shared/placeholder.js";
import { renderRetryNote } from "#shared/retry.js";
import { renderSeasonSeries, SEASON_SERIES_TITLE } from "#shared/season-series.js";
import { renderSheetPart } from "#shared/sheet-part.js";
import { renderTapeRow } from "#shared/tape.js";
import { renderClub, renderTeamName } from "./clubs.js";
import { nameTeam } from "./series.js";
import {
  describeNumbers,
  describeRecords,
  renderSheetMessage,
  renderTapeTeams,
} from "./sheet-parts.js";
import { findTeamLeaders, formatPointMargin, renderLeaderTable } from "./team-view.js";

// The game sheet's preview for a game that hasn't started: the two teams' season series, from their
// meetings this regular season, which the Worker reads, then their seasons side by side and each
// team's leading scorers, from the season the page already has. Until the meetings load, they hold
// their shape with placeholders, and meetings that didn't load say so over a Try again button.

/** @typedef {{ team: string, score: number }} MeetingSide */
/** @typedef {{ id: string, start: string, away: MeetingSide, home: MeetingSide }} Meeting */
/** @typedef {{ wins: number, losses: number, pointsFor: number, pointsAgainst: number, margin: number, home: string, road: string, lastTen: string }} TeamSeason */
/** @typedef {import("./team-view.js").Season} Season */
/** @typedef {Record<"away" | "home", string>} Teams */

/** @type {("away" | "home")[]} */
const SIDES = ["away", "home"];
const ROAD_HOME = html`<span class="label-split">Road <i aria-hidden="true"></i> Home</span>`;
const SEASON_ROW_LABELS = ["Record", "PPG", "Opp PPG", "Margin", ROAD_HOME, "Last 10"];
// Teams in a playoff series have usually met a few times by then.
const PENDING_MEETINGS = 3;

/** @type {import("#shared/season-series.js").TeamLooks} */
const LOOKS = { renderWinner: renderClub, renderLoser: renderTeamName, nameTeam };

/** @param {Meeting} meeting */
const readMeeting = (meeting) => ({
  day: new Date(meeting.start),
  away: meeting.away,
  home: meeting.home,
});

/**
 * @param {Meeting[] | null} meetings
 * @param {Teams} teams
 * @param {boolean} isSeriesOver whether the regular season, and so its series, is over
 */
function renderMeetings(meetings, teams, isSeriesOver) {
  if (!meetings)
    return renderSheetPart(
      SEASON_SERIES_TITLE,
      renderRetryNote("Couldn't load this season's meetings", "sheet-message"),
    );
  return renderSeasonSeries(meetings.map(readMeeting), { ...teams, isOver: isSeriesOver }, LOOKS);
}

const renderPendingMeeting = () =>
  html`<li>
    <span class="meeting-day">${renderPlaceholder("Sep 00")}</span>
    <span class="meeting-result">${renderPlaceholder("Team 00-00")}</span>
    <span>${renderPlaceholder("at Mystics")}</span>
  </li>`;

const renderPendingMeetings = () =>
  renderSheetPart(
    SEASON_SERIES_TITLE,
    html`<ul class="meetings">
      ${Array.from({ length: PENDING_MEETINGS }, renderPendingMeeting)}
    </ul>`,
  );

const formatAverage = (value) => value.toFixed(1);

// The visitors play on the road and the hosts at home, so each is measured where it plays.
/**
 * @param {TeamSeason} away
 * @param {TeamSeason} home
 */
const describeSeasonRows = (away, home) => {
  const [record, points, allowed, margin, roadHome, lastTen] = SEASON_ROW_LABELS;
  return [
    describeRecords(record, [`${away.wins}-${away.losses}`, `${home.wins}-${home.losses}`]),
    describeNumbers(points, [away.pointsFor, home.pointsFor], { format: formatAverage }),
    describeNumbers(allowed, [away.pointsAgainst, home.pointsAgainst], {
      format: formatAverage,
      isLowerBetter: true,
    }),
    describeNumbers(margin, [away.margin, home.margin], { format: formatPointMargin }),
    describeRecords(roadHome, [away.road, home.home]),
    describeRecords(lastTen, [away.lastTen, home.lastTen]),
  ];
};

/**
 * A team's line in the standings, once it has the averages the preview compares.
 * @param {Season | null} season
 * @param {string} team
 * @returns {TeamSeason | null}
 */
function findTeamSeason(season, team) {
  const row = season?.standings?.find((each) => each.team === team);
  if (!row) return null;
  const { wins, losses, pointsFor, pointsAgainst, margin } = row;
  if (pointsFor == null || pointsAgainst == null || margin == null) return null;
  const [home, road, lastTen] = [row.home, row.road, row.lastTen].map((record) => record ?? "");
  return { wins, losses, pointsFor, pointsAgainst, margin, home, road, lastTen };
}

/**
 * @param {Teams} teams
 * @param {Season | null} season
 */
function renderSeasons(teams, season) {
  const [away, home] = SIDES.map((place) => findTeamSeason(season, teams[place]));
  if (!away || !home)
    return renderSheetPart("Season stats", renderSheetMessage("Couldn't load the standings"));
  return renderSheetPart(
    "Season stats",
    html`${renderTapeTeams(teams.away, teams.home)}
      <div class="tape">${describeSeasonRows(away, home).map(renderTapeRow)}</div>`,
  );
}

/**
 * @param {Teams} teams
 * @param {Season | null} season
 */
function renderLeadingScorers(teams, season) {
  const [away, home] = SIDES.map((place) => findTeamLeaders(season, teams[place]));
  if (!away.length || !home.length)
    return renderSheetPart(
      "Leading scorers",
      renderSheetMessage("Couldn't load the players' averages"),
    );
  return renderSheetPart(
    "Leading scorers",
    renderLeaderTable([
      { heading: renderClub(teams.away), leaders: away },
      { heading: renderClub(teams.home), leaders: home },
    ]),
    "Per game",
  );
}

/**
 * The preview: the season series, or its placeholders while its meetings load, then the two
 * seasons and the leading scorers.
 * @param {{ teams: Teams, season: Season | null, meetings: Meeting[] | null, isLoading: boolean, isSeriesOver: boolean }} parts
 *   `isSeriesOver` says the regular season is over, as it is for a playoff game
 */
export const renderPreview = ({ teams, season, meetings, isLoading, isSeriesOver }) =>
  html`${isLoading ? renderPendingMeetings() : renderMeetings(meetings, teams, isSeriesOver)}
  ${renderSeasons(teams, season)} ${renderLeadingScorers(teams, season)}`;
