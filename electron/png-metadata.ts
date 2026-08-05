import { ImageRecipeV1 } from "./image-recipe";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const KEYWORD = "pinaic.recipe";

let crcTable: number[] | undefined;
function table() {
  if (crcTable) return crcTable;
  crcTable = Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
  });
  return crcTable;
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  const values = table();
  for (const value of buffer) crc = values[(crc ^ value) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type: string, data: Buffer) {
  const typeBuffer = Buffer.from(type, "ascii");
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  typeBuffer.copy(header, 4);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([header, data, crc]);
}

function chunks(buffer: Buffer) {
  const result: Array<{ type: string; data: Buffer; raw: Buffer }> = [];
  if (buffer.length < 20 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return result;
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > buffer.length) return [];
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    result.push({ type, data: buffer.subarray(offset + 8, offset + 8 + length), raw: buffer.subarray(offset, end) });
    offset = end;
    if (type === "IEND") break;
  }
  return result;
}

function keywordOf(data: Buffer) {
  const end = data.indexOf(0);
  return end < 0 ? "" : data.toString("latin1", 0, end);
}

export function embedRecipeInPng(buffer: Buffer, recipe: ImageRecipeV1) {
  const parsed = chunks(buffer);
  if (!parsed.length) return buffer;
  const payload = Buffer.concat([
    Buffer.from(KEYWORD, "latin1"),
    Buffer.from([0, 0, 0, 0, 0]),
    Buffer.from(JSON.stringify(recipe), "utf8"),
  ]);
  const metadata = makeChunk("iTXt", payload);
  const output: Buffer[] = [PNG_SIGNATURE];
  let inserted = false;
  for (const chunk of parsed) {
    if (chunk.type === "iTXt" && keywordOf(chunk.data) === KEYWORD) continue;
    if (!inserted && (chunk.type === "IDAT" || chunk.type === "IEND")) {
      output.push(metadata);
      inserted = true;
    }
    output.push(chunk.raw);
  }
  return Buffer.concat(output);
}

export function readRecipeFromPng(buffer: Buffer): ImageRecipeV1 | null {
  for (const chunk of chunks(buffer)) {
    if (chunk.type !== "iTXt" || keywordOf(chunk.data) !== KEYWORD) continue;
    let offset = chunk.data.indexOf(0) + 1;
    if (offset <= 0 || offset + 2 > chunk.data.length) continue;
    const compressed = chunk.data[offset];
    offset += 2;
    const languageEnd = chunk.data.indexOf(0, offset);
    if (languageEnd < 0) continue;
    offset = languageEnd + 1;
    const translatedEnd = chunk.data.indexOf(0, offset);
    if (translatedEnd < 0 || compressed !== 0) continue;
    offset = translatedEnd + 1;
    try {
      return JSON.parse(chunk.data.toString("utf8", offset)) as ImageRecipeV1;
    } catch {
      return null;
    }
  }
  return null;
}

