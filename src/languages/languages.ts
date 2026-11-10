import { Language } from '../graphql/generated/enumValues'

// The interface is in English, so the languages it names are too.
const names = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' })

// Chromium's trimmed locale data names none of these languages, so the client carries their
// English names as the full Unicode data writes them.
const NAMES_BROWSERS_LACK = new Map([
  ['aa', 'Afar'],
  ['ab', 'Abkhazian'],
  ['ae', 'Avestan'],
  ['av', 'Avaric'],
  ['ba', 'Bashkir'],
  ['bi', 'Bislama'],
  ['bo', 'Tibetan'],
  ['ce', 'Chechen'],
  ['ch', 'Chamorro'],
  ['cr', 'Cree'],
  ['cu', 'Church Slavic'],
  ['cv', 'Chuvash'],
  ['dz', 'Dzongkha'],
  ['ff', 'Fula'],
  ['fj', 'Fijian'],
  ['gv', 'Manx'],
  ['ho', 'Hiri Motu'],
  ['hz', 'Herero'],
  ['ie', 'Interlingue'],
  ['ii', 'Sichuan Yi'],
  ['ik', 'Inupiaq'],
  ['io', 'Ido'],
  ['iu', 'Inuktitut'],
  ['kg', 'Kongo'],
  ['ki', 'Kikuyu'],
  ['kj', 'Kuanyama'],
  ['kl', 'Kalaallisut'],
  ['kr', 'Kanuri'],
  ['ks', 'Kashmiri'],
  ['kv', 'Komi'],
  ['kw', 'Cornish'],
  ['li', 'Limburgish'],
  ['lu', 'Luba-Katanga'],
  ['mh', 'Marshallese'],
  ['na', 'Nauru'],
  ['nd', 'North Ndebele'],
  ['ng', 'Ndonga'],
  ['nr', 'South Ndebele'],
  ['nv', 'Navajo'],
  ['oj', 'Ojibwa'],
  ['os', 'Ossetic'],
  ['pi', 'Pali'],
  ['rn', 'Rundi'],
  ['sc', 'Sardinian'],
  ['se', 'Northern Sami'],
  ['sg', 'Sango'],
  ['ss', 'Swati'],
  ['ty', 'Tahitian'],
  ['ve', 'Venda'],
  ['vo', 'Volapük'],
  ['za', 'Zhuang'],
])

// Unicode's aliases name tl Filipino and tw Akan, which is also ak's name; the server's table, like
// the files that use these codes, reads them as Tagalog and Twi.
const NAMES_UNICODE_RENAMES = new Map([
  ['tl', 'Tagalog'],
  ['tw', 'Twi'],
])

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
  return NAMES_UNICODE_RENAMES.get(tag) ?? browserName(tag) ?? NAMES_BROWSERS_LACK.get(tag) ?? tag
}

// A value newer than this client need not be a tag the browser can read, and it throws then.
function browserName(tag: string): string | undefined {
  try {
    return names.of(tag)
  } catch {
    return undefined
  }
}

// The languages most viewers pick, which lead every list so that few viewers scroll for theirs.
const COMMON_LANGUAGES: readonly Language[] = ['EN', 'ES', 'FR']

const LANGUAGES_BY_NAME: readonly Language[] = Object.values(Language)
  .map((language) => ({ language, name: languageName(language) }))
  .sort((a, b) => a.name.localeCompare(b.name, 'en'))
  .map(({ language }) => language)

/**
 * Every Language the pinned schema lists, in two parts that a list divides: `first` and then the
 * common languages lead, and every other language follows in the order of its English name.
 */
export function languageListing<First extends string = Language>(
  first: readonly First[] = [],
): { leading: (First | Language)[]; rest: Language[] } {
  const leading = [...new Set<First | Language>([...first, ...COMMON_LANGUAGES])]
  return { leading, rest: LANGUAGES_BY_NAME.filter((language) => !leading.includes(language)) }
}

// Each value by its tag in lower case, as the server's table matches a file's code.
const BY_TAG = new Map<string, Language>(
  Object.values(Language).map((language) => [tagOf(language).toLowerCase(), language]),
)

// Unicode's aliases rename these two codes to Filipino and Akan; the server's table, like the files
// that use them, reads them as Tagalog and Twi.
const CODES_UNICODE_RENAMES = new Map<string, Language>([
  ['tgl', 'TL'],
  ['twi', 'TW'],
])

/**
 * The Language of a track's language code, read by the server's rule: a code such as `fre` or
 * `pt_BR` names a value of the table, and a region or script the table has no value for reads as
 * its base language. None when the code names no language of the table.
 */
export function languageOfTrack(code: string | undefined): Language | undefined {
  const normalized = code?.trim().replaceAll('_', '-').toLowerCase()
  if (!normalized) {
    return undefined
  }
  const [base = normalized] = normalized.split('-')
  return languageOfCode(normalized) ?? languageOfCode(base)
}

// A code the table lists as it is, else the two-letter code Unicode gives a three-letter or
// withdrawn one, such as fr for fre and he for iw.
function languageOfCode(code: string): Language | undefined {
  return BY_TAG.get(code) ?? CODES_UNICODE_RENAMES.get(code) ?? BY_TAG.get(canonical(code))
}

function canonical(code: string): string {
  try {
    return Intl.getCanonicalLocales(code)[0]?.toLowerCase() ?? ''
  } catch {
    return ''
  }
}
