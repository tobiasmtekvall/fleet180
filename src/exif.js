'use strict';

/**
 * When was this photograph taken?
 *
 * A rental car is photographed at pick-up and again at hand-back, and the
 * question that matters three weeks later -- when the firm sends a bill for a
 * scratch -- is not when somebody got round to uploading the picture but when
 * the picture was taken. The camera writes that into the file itself, so it
 * is read here rather than guessed from the upload.
 *
 * Only what is needed: JPEG, APP1/Exif, DateTimeOriginal (0x9003) with its
 * offset (0x9011) when the camera wrote one, falling back to the file-level
 * DateTime (0x0132). No dependency -- an EXIF library is thousands of lines
 * for six tags, and this runs on every uploaded photo.
 *
 * KNOWN LIMIT: JPEG only. A HEIC/HEIF straight off an iPhone, a PNG or a
 * WebP can all carry a timestamp this does not read, and those files fall
 * back to the upload time. In practice iOS transcodes to JPEG for a file
 * input with accept="image/*", which is what the form uses -- but if a
 * hand-back photo ever shows "Uploaded" when it should not, this is why.
 *
 * Returns a Date, or null. NULL IS A TRUTHFUL ANSWER and the common one: a
 * screenshot, a PDF, a picture WhatsApp has re-encoded, or a phone set to
 * strip metadata all arrive without it. The caller shows the upload time
 * instead, and says which it is showing.
 */

/* Cameras that write no time zone are read as Swedish local time: these
   photographs are taken in a yard in Jönköping. An hour out for a picture
   taken abroad is a better answer than no time at all, and the tag that
   settles it (OffsetTimeOriginal) is used whenever it is there. */


/** The offset Sweden is on, on a given date, as +HH:MM. */
function zoneNow(y, mo, d) {
  // Sweden is CET (+01) in winter and CEST (+02) from the last Sunday in
  // March to the last Sunday in October. Worked out rather than hard-coded,
  // because a photo taken in January would otherwise be an hour early.
  const march = lastSunday(y, 2), october = lastSunday(y, 9);
  const day = Date.UTC(y, mo - 1, d);
  return (day >= march && day < october) ? '+02:00' : '+01:00';
}

function lastSunday(year, monthIndex) {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0));
  return Date.UTC(year, monthIndex, last.getUTCDate() - last.getUTCDay());
}

/** "+02:00" -> 120. Used to read a parsed date back in its own local time. */
function offsetMinutes(zone) {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(String(zone || ''));
  if (!m) return 0;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/** "2026:09:16 07:12:44" + an offset -> a Date, or null. */
function toDate(stamp, offset) {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(stamp || '').trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  if (!y || !mo || !d) return null;                  // 0000:00:00 means "unset"
  const zone = /^[+-]\d{2}:\d{2}$/.test(String(offset || '')) ? offset : zoneNow(y, mo, d);
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${zone}`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  /* "2026:02:30" is not a date, but Date rolls it forward to 2 March rather
     than refusing it. A rolled-over date would then be shown as "Taken",
     which this file promises is evidence and not a guess -- so the day is
     read back and has to be the day that was written. */
  const back = new Date(date.getTime() + offsetMinutes(zone) * 60000);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() + 1 !== mo || back.getUTCDate() !== d) {
    return null;
  }
  // A camera with a flat battery reports 1980, and a clock set forward
  // reports next year. Neither is evidence of anything.
  const year = date.getUTCFullYear();
  if (year < 2000 || date.getTime() > Date.now() + 36 * 3600 * 1000) return null;
  return date;
}

/** The EXIF APP1 segment of a JPEG, or null. */
function app1(buf) {
  if (buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) return null;   // not a JPEG
  let p = 2;
  // Walk the marker chain. Stop at the start of the image data: EXIF is in
  // the header, and scanning a 6 MB photo byte by byte is pointless.
  while (p + 4 <= buf.length) {
    if (buf[p] !== 0xFF) return null;
    /* Any number of 0xFF bytes may pad the gap before a marker (ITU T.81
       B.1.1.2), and some encoders write them. Reading the pad as the marker
       loses the timestamp on an otherwise perfectly good photo. */
    while (p + 4 <= buf.length && buf[p + 1] === 0xFF) p++;
    const marker = buf[p + 1];
    if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { p += 2; continue; }
    if (marker === 0xDA || marker === 0xD9) return null;                   // image data
    const size = buf.readUInt16BE(p + 2);
    if (size < 2 || p + 2 + size > buf.length) return null;
    if (marker === 0xE1 && buf.slice(p + 4, p + 10).toString('latin1') === 'Exif\0\0') {
      return buf.slice(p + 10, p + 2 + size);
    }
    p += 2 + size;
  }
  return null;
}

/** Read the tags we want out of one TIFF IFD. */
function readIfd(tiff, offset, little, want, out) {
  const u16 = o => (little ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = o => (little ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  if (offset + 2 > tiff.length) return;
  const count = u16(offset);
  for (let i = 0; i < count; i++) {
    const entry = offset + 2 + i * 12;
    if (entry + 12 > tiff.length) return;
    const tag = u16(entry);
    if (!want.has(tag)) continue;
    const type = u16(entry + 2);
    const n = u32(entry + 4);
    if (tag === 0x8769) { out.exifIfd = u32(entry + 8); continue; }        // pointer, not a value
    if (type !== 2 || n > 64) continue;                                    // ASCII only
    const at = n <= 4 ? entry + 8 : u32(entry + 8);
    if (at + n > tiff.length) continue;
    out[tag] = tiff.slice(at, at + n).toString('latin1').replace(/\0+$/, '');
  }
}

/**
 * The moment a photo was taken, from its own metadata. Null when the file
 * does not say -- never a guess, and never the upload time dressed up as one.
 */
function takenAt(buffer, mime) {
  try {
    if (!Buffer.isBuffer(buffer) || !/^image\/jpe?g$/i.test(String(mime || ''))) return null;
    const tiff = app1(buffer);
    if (!tiff || tiff.length < 8) return null;
    const order = tiff.slice(0, 2).toString('latin1');
    if (order !== 'II' && order !== 'MM') return null;
    const little = order === 'II';
    const ifd0 = little ? tiff.readUInt32LE(4) : tiff.readUInt32BE(4);
    const out = {};
    readIfd(tiff, ifd0, little, new Set([0x0132, 0x8769]), out);            // DateTime, Exif pointer
    if (out.exifIfd) {
      readIfd(tiff, out.exifIfd, little, new Set([0x9003, 0x9011]), out);   // DateTimeOriginal, offset
    }
    return toDate(out[0x9003] || out[0x0132], out[0x9011]) || null;
  } catch (err) {
    // A malformed photo must never stop an upload: the picture is the point,
    // the timestamp is a bonus.
    return null;
  }
}

module.exports = { takenAt, toDate, zoneNow };
