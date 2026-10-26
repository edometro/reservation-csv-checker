/**
 * Keep CSV uploads transactional: a new selection invalidates the previous result
 * immediately, and only the latest asynchronous read may update the UI.
 */
export function createUploadController({readFile, applyCSV, reset, onError}) {
  let generation = 0;
  function begin() {
    generation++;
    reset();
    return generation;
  }
  return {
    async loadFile(file) {
      const request = begin();
      if (!file) return;
      try {
        const text = await readFile(file);
        if (request !== generation) return;
        applyCSV(text, file.name || 'CSV');
      } catch (error) {
        if (request === generation) onError(error);
      }
    },
    loadText(text, label) {
      begin();
      try {
        applyCSV(text, label);
      } catch (error) {
        onError(error);
      }
    }
  };
}
