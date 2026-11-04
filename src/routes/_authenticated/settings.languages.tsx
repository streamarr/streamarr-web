import { createFileRoute } from '@tanstack/react-router'
import { LanguageSettings } from '../../languages/LanguageSettings'

export const Route = createFileRoute('/_authenticated/settings/languages')({
  component: LanguageSettings,
})
