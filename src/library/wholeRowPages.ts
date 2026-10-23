import type { SortDirection } from '../graphql/generated/graphql'

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

/** The library position of a letter's first title, from the server's per-letter counts. */
export function titlesBeforeLetter({
  index,
  letter,
  direction,
}: {
  index: ReadonlyArray<{ letter: string; count: number }>
  letter: string
  direction: SortDirection
}) {
  const target = letterRank(letter)
  return index
    .filter((entry) =>
      direction === 'DESC' ? letterRank(entry.letter) > target : letterRank(entry.letter) < target,
    )
    .reduce((total, entry) => total + entry.count, 0)
}

// Titles under '#' sort before A, regardless of the server's alphabet index order.
function letterRank(letter: string) {
  return letter === 'HASH' ? -1 : (letter.codePointAt(0) ?? 0)
}
