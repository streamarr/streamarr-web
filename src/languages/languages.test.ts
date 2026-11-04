import { describe, expect, it } from 'vitest'
import { Language } from '../graphql/generated/enumValues'
import { LANGUAGES_BY_NAME, languageName, languageOfTrack } from './languages'

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
})

describe('LANGUAGES_BY_NAME', () => {
  it('shouldListEveryLanguageOnceInTheOrderOfItsName', () => {
    const names = LANGUAGES_BY_NAME.map(languageName)

    expect([...LANGUAGES_BY_NAME].sort()).toEqual(Object.values(Language).sort())
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
