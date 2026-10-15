import { useQuery } from '@apollo/client/react'
import { Alert, Center, Loader } from '@mantine/core'
import { Link, Outlet, useMatchRoute } from '@tanstack/react-router'
import { MeDocument } from '../graphql/generated/graphql'
import { Icon, type IconName } from '../ui/Icon'
import { RetryAlert } from '../ui/RetryAlert'
import { canManageServer } from './access'
import styles from './Settings.module.css'

const SECTIONS = [
  {
    to: '/settings/server/libraries',
    icon: 'folder',
    label: 'Libraries',
    region: 'Library administration',
  },
  { to: '/settings/server/encoding', icon: 'encoding', label: 'Encoding', region: 'Encoding' },
] as const satisfies readonly {
  to: string
  icon: IconName
  label: string
  region: string
}[]

/** The settings shell: sections mount only after the server confirms the admin's access on entry. */
export function ServerSettings() {
  const { data, error, refetch } = useQuery(MeDocument, {
    fetchPolicy: 'network-only',
  })

  if (error)
    return (
      <RetryAlert onRetry={refetch}>Couldn't confirm your access to server settings.</RetryAlert>
    )
  if (!data)
    return (
      <Center h={200}>
        <Loader role="status" aria-label="Checking server settings access" />
      </Center>
    )
  if (!canManageServer(data.me))
    return (
      <Alert role="alert">
        Server settings are available to server admins using an account session.{' '}
        <Link to="/">Back to Home</Link>
      </Alert>
    )

  return <SettingsRail />
}

function SettingsRail() {
  const matchRoute = useMatchRoute()
  const current = SECTIONS.find((section) => matchRoute({ to: section.to, fuzzy: true }))
  return (
    <div className={`${styles.settings} ${styles.railLayout}`}>
      <nav className={styles.settingsRail} aria-label="Server settings">
        <div className={styles.railTitle}>Server settings</div>
        {SECTIONS.map((section) => (
          <Link
            key={section.to}
            to={section.to}
            className={styles.section}
            aria-current={section === current ? 'page' : undefined}
          >
            <Icon name={section.icon} />
            {section.label}
          </Link>
        ))}
      </nav>
      <section className={styles.railContent} aria-label={current?.region}>
        <Outlet />
      </section>
    </div>
  )
}
