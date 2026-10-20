import { showSeasonPhase } from "#shared/bracket-standings.js";
import { chooseTitleYear, showTitleYear } from "#shared/title-year.js";
import { buildBracket } from "./bracket.js";
import { renderBracket } from "./bracket-view.js";
import { refreshGameSheet } from "./game-sheet.js";
import { renderGames } from "./games-view.js";
import { LEAGUE_WORDS } from "./league-words.js";
import { renderRanking } from "./ranking.js";
import { isFieldSet, session } from "./session.js";
import { renderStamp } from "./stamp-view.js";
import { renderStandings } from "./standings.js";
import { refreshGameSearch } from "#shared/game-search-view.js";
import { refreshTeamSheet } from "#shared/team-sheet.js";
import { renderUpdates } from "./updates.js";

const isSeasonOver = () => !!session.state && !!buildBracket(session.state).ws?.winner;

function renderTitleYear() {
  const shownYear = session.activeYear;
  showTitleYear(
    chooseTitleYear({
      shownYear,
      currentYear: session.currentSeason,
      isSeasonOver: isSeasonOver(),
    }),
    LEAGUE_WORDS,
  );
}

export function renderAll() {
  showSeasonPhase(isFieldSet());
  renderStamp();
  renderUpdates();
  renderBracket();
  renderGames();
  refreshGameSearch();
  renderStandings();
  renderRanking();
  renderTitleYear();
  refreshTeamSheet();
  refreshGameSheet();
}
