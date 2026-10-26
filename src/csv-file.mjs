/** Decode user-selected CSV locally, without reading oversized files into memory. */
export const MAX_CSV_BYTES = 12 * 1024 * 1024;

export async function readCSVFile(file) {
  // File.size is available before File.arrayBuffer() allocates the full contents.
  if (!file || !Number.isSafeInteger(file.size) || file.size < 0) {
    throw new Error('CSVファイルのサイズを確認できません');
  }
  if (file.size > MAX_CSV_BYTES) {
    throw new Error('試作版ではCSVを12MB以下にしてください');
  }
  const buffer = await file.arrayBuffer();
  // Defense in depth: do not trust the reported size (e.g. mocked or unusual File implementations).
  if (buffer.byteLength > MAX_CSV_BYTES) {
    throw new Error('試作版ではCSVを12MB以下にしてください');
  }
  try {
    return new TextDecoder('utf-8', {fatal:true}).decode(buffer);
  } catch {
    return new TextDecoder('shift_jis', {fatal:true}).decode(buffer);
  }
}
