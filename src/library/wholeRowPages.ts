// About this many titles per page, rounded to whole rows of the grid.
const TITLES_PER_PAGE = 48

// Rows break where a title's position in the whole library is a multiple of the column count, so
// pages joined in either direction leave no empty cell between them.

/** How many titles to load after library position `end` so the page ends where a row ends. */
export function pageSizeAfter({ columns, end }: { columns: number; end: number }) {
  return wholeRows(columns) + ((columns - (end % columns)) % columns)
}

/** How many titles to load before library position `start` so the page starts a row. */
export function pageSizeBefore({ columns, start }: { columns: number; start: number }) {
  return wholeRows(columns) + (start % columns)
}

function wholeRows(columns: number) {
  return columns * Math.ceil(TITLES_PER_PAGE / columns)
}
