// A fast drop-in for csv-reader 1.0.0: run(input) returns exactly the answer the
// reference reader gives for {text, header} — {columns, rows, errors} — but reads
// with jumps instead of one character at a time.
//
// The reading policy, restated from the competition rules:
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside a quoted field a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled,
//     "" inside it is one quote, and each CRLF or lone CR inside it is read as LF;
//     what follows its closing quote, up to the next comma or line break, is appended
//     as it stands (quote_junk, when the field ends); a quote that never closes is a
//     literal character, and the text after it is read again as an unquoted field
//     (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay strings,
//     never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds the
//     records after it (every record when header is false), each padded with ""
//     (short_row, with fields: its count) or cut (long_row, with extra: the cut
//     fields) to the first record's width;
//   - each error is {code, line, row}: line the 1-based line its record starts on
//     (every LF, CRLF and lone CR inside a quoted field counted), row its record's
//     index in rows (null for the header), in the order met, a field's quote_junk
//     when the field ends and a record's short_row or long_row when the record ends.
//
// Speed comes from never walking the text a character at a time: unquoted fields end
// at the next comma, LF or CR found by one scan, and quoted fields jump straight to
// their closing quote. Pure: no clock, no randomness, no locale, nothing kept from
// one call to the next.

/** The next comma, CR or LF at or after the scan position. */
const TERMINATOR = /[,\r\n]/g;

/** How a field ended. */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** How many times one character occurs in a string. */
function countOf(s, ch) {
  let n = 0;
  let i = -1;
  while ((i = s.indexOf(ch, i + 1)) !== -1) n += 1;
  return n;
}

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // The field just read: how it ended, and how many characters an unquoted read kept.
  let ended = END;
  let added = 0;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads unquoted characters onto `value` up to the next comma or line break: a CR
  // not followed by LF is dropped (stray_cr). Sets `ended` and `added`, returns the field.
  function readUnquoted(value) {
    added = 0;
    for (;;) {
      TERMINATOR.lastIndex = pos;
      const m = TERMINATOR.exec(text);
      if (m === null) {
        if (pos < len) {
          value += text.slice(pos);
          added += len - pos;
        }
        pos = len;
        ended = END;
        return value;
      }
      const i = m.index;
      const c = m[0];
      if (c === ',') {
        value += text.slice(pos, i);
        added += i - pos;
        pos = i + 1;
        ended = COMMA;
        return value;
      }
      if (c === '\n') {
        value += text.slice(pos, i);
        added += i - pos;
        pos = i + 1;
        line += 1;
        ended = LINE_BREAK;
        return value;
      }
      // c === '\r'
      if (i + 1 < len && text.charCodeAt(i + 1) === 10) {
        value += text.slice(pos, i);
        added += i - pos;
        pos = i + 2;
        line += 1;
        ended = LINE_BREAK;
        return value;
      }
      error('stray_cr');
      value += text.slice(pos, i);
      added += i - pos;
      pos = i + 1;
    }
  }

  // Reads a quoted field whose opening quote is at pos. Sets `ended`, returns the field.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    // Collect the stretches between doubled quotes; the closing quote ends the field.
    let parts = null;
    let start = pos;
    for (;;) {
      const q = text.indexOf('"', start);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text after it
        // is read again as an unquoted field.
        pos = open + 1;
        line = openLine;
        error('unterminated_quote');
        return readUnquoted('"');
      }
      if (q + 1 < len && text.charCodeAt(q + 1) === 34) {
        if (parts === null) parts = [];
        parts.push(text.slice(start, q));
        start = q + 2;
        continue;
      }
      let raw;
      if (parts === null) {
        raw = text.slice(start, q);
      } else {
        parts.push(text.slice(start, q));
        raw = parts.join('"');
      }
      // CRLF and a lone CR inside quotes are each one LF; count the line breaks.
      let value;
      if (raw.indexOf('\r') === -1) {
        value = raw;
        line += countOf(raw, '\n');
      } else {
        value = raw.replace(/\r\n?/g, '\n');
        line += countOf(value, '\n');
      }
      pos = q + 1;
      if (pos >= len) {
        ended = END;
        return value;
      }
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos += 1;
        ended = COMMA;
        return value;
      }
      if (c === 10) {
        pos += 1;
        line += 1;
        ended = LINE_BREAK;
        return value;
      }
      if (c === 13 && pos + 1 < len && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        ended = LINE_BREAK;
        return value;
      }
      // What follows the closing quote is appended as it stands, up to the next
      // comma or line break.
      const junk = readUnquoted(value);
      if (added > 0) error('quote_junk');
      return junk;
    }
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && pos + 1 < len && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;
    do {
      quoted = pos < len && text.charCodeAt(pos) === 34;
      fields.push(quoted ? readQuoted() : readUnquoted(''));
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
