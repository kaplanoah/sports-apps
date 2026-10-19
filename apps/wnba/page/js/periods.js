// A game's periods: four ten-minute quarters, then as many five-minute overtimes as it takes.

export const REGULATION_PERIODS = 4;
export const QUARTER_SECONDS = 10 * 60;
export const OVERTIME_SECONDS = 5 * 60;

/**
 * An overtime by its period's number from 1, as "OT" or "2OT".
 * @param {number} period
 */
export function nameOvertime(period) {
  const overtime = period - REGULATION_PERIODS;
  return overtime === 1 ? "OT" : `${overtime}OT`;
}

/**
 * A period by its number from 1, as "Q3", "OT", or "2OT".
 * @param {number} period
 */
export const namePeriod = (period) =>
  period <= REGULATION_PERIODS ? `Q${period}` : nameOvertime(period);
