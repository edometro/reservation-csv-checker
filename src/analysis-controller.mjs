/**
 * Guard asynchronous analyses (including previous-CSV reads).
 * Only the most recent run may publish results or errors.
 * Any input change must call invalidate() before starting another run.
 */
export function createAnalysisController({onResult, onError}) {
  let generation = 0;
  return {
    invalidate() {
      generation++;
    },
    async run(compute) {
      const request = ++generation;
      try {
        const result = await compute();
        if (request === generation) onResult(result);
      } catch (error) {
        if (request === generation) onError(error);
      }
    }
  };
}
