import { Language } from '../graphql/generated/enumValues'

const KNOWN: ReadonlySet<string> = new Set(Object.values(Language))

// The interface is in English, so the languages it names are too.
const names = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' })

// The BCP 47 tag that a value stands for: the schema writes pt-BR as PT_BR and zh-Hans as ZH_HANS.
function tagOf(language: string): string {
  const [base = '', ...subtags] = language.split('_')
  return [base.toLowerCase(), ...subtags.map(subtagOf)].join('-')
}

// A four-letter subtag is a script, written in title case; anything else is a region.
function subtagOf(subtag: string): string {
  if (subtag.length === 4) {
    return subtag.charAt(0) + subtag.slice(1).toLowerCase()
  }
  return subtag
}

/** The language's English name, or its tag when the browser knows no name for it. */
export function languageName(language: string): string {
  const tag = tagOf(language)
  return names.of(tag) ?? tag
}

/** Every Language the pinned schema lists, in the order of its English name. */
export const LANGUAGES_BY_NAME: readonly Language[] = Object.values(Language)
  .map((language) => ({ language, name: languageName(language) }))
  .sort((a, b) => a.name.localeCompare(b.name, 'en'))
  .map(({ language }) => language)

/**
 * The Language of a track's language code, such as `fre`, `fr-CA` or `pt-BR`: the variant when
 * the table lists one, else the base language. None when the code names no language of the table.
 */
export function languageOfTrack(code: string | undefined): Language | undefined {
  const locale = localeOf(code)
  if (!locale) {
    return undefined
  }
  const [base, ...subtags] = locale.baseName.toUpperCase().split('-')
  return [[base, ...subtags].join('_'), base].find(isLanguage)
}

function localeOf(code: string | undefined): Intl.Locale | undefined {
  if (!code) {
    return undefined
  }
  try {
    return new Intl.Locale(code)
  } catch {
    return undefined
  }
}

function isLanguage(value: string): value is Language {
  return KNOWN.has(value)
}
