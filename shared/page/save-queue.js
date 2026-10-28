// Saves of a choice that can change again while one is on its way.

/**
 * Runs `save` one at a time. A request while one runs asks for one more run after it, however many
 * requests come, so the last run starts after the last request and saves the newest choice.
 * @param {() => Promise<void>} save reads the newest choice when it starts, and shows its own
 * failures
 */
export function createSaveQueue(save) {
  /** @type {Promise<void> | null} */
  let running = null;
  let isAskedAgain = false;
  async function saveUntilCurrent() {
    try {
      do {
        isAskedAgain = false;
        await save();
      } while (isAskedAgain);
    } finally {
      running = null;
    }
  }
  return {
    /** Saves the newest choice, settling once nothing is left to save. */
    requestSave() {
      if (running) isAskedAgain = true;
      else running = saveUntilCurrent();
      return running;
    },
    isSaving: () => running !== null,
  };
}
