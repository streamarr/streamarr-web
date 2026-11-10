import { SettingsLayout, type SettingsSection } from '../ui/SettingsLayout'

const SECTIONS = [
  { to: '/settings/profile/languages', icon: 'languages', label: 'Languages', region: 'Languages' },
] as const satisfies readonly SettingsSection[]

/** The selected Profile's settings: a menu of sections beside the open section's page. */
export function ProfileSettings() {
  return <SettingsLayout title="Profile settings" sections={SECTIONS} />
}
