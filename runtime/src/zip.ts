const decoder = new TextDecoder();

/** Read the stored (uncompressed) ZIP entries written by XP. */
export function readPackageZip(buffer: ArrayBuffer): Map<string, Uint8Array<ArrayBuffer>> {
  const view = new DataView(buffer);
  let end = -1;
  for (let offset = buffer.byteLength - 22; offset >= Math.max(0, buffer.byteLength - 65_557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) { end = offset; break; }
  }
  if (end < 0) throw new Error('Not a ZIP package.');
  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > buffer.byteLength || view.getUint32(cursor, true) !== 0x02014b50) throw new Error('Invalid ZIP directory.');
    const method = view.getUint16(cursor + 10, true);
    if (method !== 0) throw new Error('Compressed ZIP entries are not supported. Use an XP export.');
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const local = view.getUint32(cursor + 42, true);
    if (cursor + 46 + nameLength > buffer.byteLength || local + 30 > buffer.byteLength || view.getUint32(local, true) !== 0x04034b50) {
      throw new Error('Invalid ZIP entry.');
    }
    const name = decoder.decode(new Uint8Array(buffer, cursor + 46, nameLength));
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (start + size > buffer.byteLength || files.has(name)) throw new Error(`Invalid or duplicate ZIP entry: ${name}`);
    files.set(name, new Uint8Array(buffer.slice(start, start + size)));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}
