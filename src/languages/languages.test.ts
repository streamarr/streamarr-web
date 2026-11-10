import { describe, expect, it } from 'vitest'
import { Language } from '../graphql/generated/enumValues'
import { languageListing, languageName, languageOfTrack } from './languages'

describe('languageName', () => {
  it('shouldNameEachLanguageInEnglishWhenItIsABaseLanguage', () => {
    expect(languageName('FR')).toBe('French')
    expect(languageName('JA')).toBe('Japanese')
  })

  it('shouldNameTheVariantWhenTheValueCarriesARegionOrScript', () => {
    expect(languageName('PT_BR')).toBe('Brazilian Portuguese')
    expect(languageName('ES_419')).toBe('Latin American Spanish')
    expect(languageName('ZH_HANS')).toBe('Simplified Chinese')
    expect(languageName('ZH_HANT')).toBe('Traditional Chinese')
  })

  it('shouldNameAValueFromItsTagWhenTheServerAddedItAfterThisClient', () => {
    expect(languageName('FR_CA')).toBe('Canadian French')
  })

  it('shouldNameAValueByItsTagWhenTheBrowserCannotReadThatTag', () => {
    expect(languageName('QAA_QTZ')).toBe('qaa-QTZ')
  })

  it('shouldNameTagalogAndTwiAsTheServersTableDoesWhereUnicodeRenamesThem', () => {
    expect(languageName('TL')).toBe('Tagalog')
    expect(languageName('TW')).toBe('Twi')
  })

  it('shouldGiveEachLanguageANameNoOtherLanguageHas', () => {
    const names = Object.values(Language).map(languageName)

    expect(names.filter((name, index) => names.indexOf(name) !== index)).toEqual([])
  })
})

describe('languageListing', () => {
  it('shouldLeadWithEnglishSpanishAndFrenchWhenNoLanguageComesFirst', () => {
    expect(languageListing().leading.map(languageName)).toEqual(['English', 'Spanish', 'French'])
  })

  it('shouldLeadWithTheGivenLanguagesThenTheCommonOnesItLacks', () => {
    expect(languageListing(['JA', 'FR']).leading.map(languageName)).toEqual([
      'Japanese',
      'French',
      'English',
      'Spanish',
    ])
  })

  it('shouldListEveryOtherLanguageOnceInTheOrderOfItsName', () => {
    const { leading, rest } = languageListing(['JA'])
    const names = rest.map(languageName)

    expect([...leading, ...rest].sort()).toEqual(Object.values(Language).sort())
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')))
  })
})

describe('languageOfTrack', () => {
  it('shouldReadEveryCodeAFileUsesForALanguageAsThatLanguage', () => {
    expect(['fr', 'fre', 'fra'].map(languageOfTrack)).toEqual(['FR', 'FR', 'FR'])
    expect(['de', 'ger', 'deu'].map(languageOfTrack)).toEqual(['DE', 'DE', 'DE'])
  })

  it('shouldReadTagalogAndTwiByTheirOwnCodesWhereUnicodeRenamesThem', () => {
    expect(['tl', 'tgl'].map(languageOfTrack)).toEqual(['TL', 'TL'])
    expect(['tw', 'twi'].map(languageOfTrack)).toEqual(['TW', 'TW'])
  })

  it('shouldReadAWithdrawnCodeAsTheLanguageThatReplacedIt', () => {
    expect(['iw', 'in', 'ji'].map(languageOfTrack)).toEqual(['HE', 'ID', 'YI'])
  })

  it('shouldReadACodeWrittenWithAnUnderscoreSpacesOrCapitalsAsTheServerDoes', () => {
    expect(['pt_br', ' en ', 'ZH_hant', 'FRE'].map(languageOfTrack)).toEqual([
      'PT_BR',
      'EN',
      'ZH_HANT',
      'FR',
    ])
  })

  it('shouldReadTheVariantWhenTheTableHasOne', () => {
    expect(languageOfTrack('pt-BR')).toBe('PT_BR')
    expect(languageOfTrack('pt-br')).toBe('PT_BR')
    expect(languageOfTrack('zh-Hant')).toBe('ZH_HANT')
    expect(languageOfTrack('es-419')).toBe('ES_419')
  })

  it('shouldReadTheBaseLanguageWhenTheTableHasNoValueForTheRegion', () => {
    expect(languageOfTrack('pt-PT')).toBe('PT')
    expect(languageOfTrack('zh-TW')).toBe('ZH')
  })

  it('shouldReadNoLanguageWhenTheCodeNamesNoneOfTheTable', () => {
    expect([undefined, '', 'und', 'zxx', 'not a tag'].map(languageOfTrack)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ])
  })
})
