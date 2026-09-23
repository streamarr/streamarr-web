import { useQuery } from '@apollo/client/react'
import { Alert, Button, Center, Loader } from '@mantine/core'
import { Link, Navigate, Outlet } from '@tanstack/react-router'
import { MeDocument } from '../graphql/generated/graphql'
import { Icon } from '../ui/Icon'
import { canManageServer } from './access'
import styles from './Settings.module.css'

/** The settings shell: sections mount only after the server confirms the admin's access on entry. */
export function ServerSettings() {
  const { data, error, refetch } = useQuery(MeDocument, {
    fetchPolicy: 'network-only',
  })

  if (error)
    return (
      <Alert color="red" role="alert">
        Couldn't confirm your access to server settings.{' '}
        <Button variant="default" onClick={() => void refetch().catch(() => {})}>
          Try again
        </Button>
      </Alert>
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
  if (data.me.scope !== 'profile') return <Navigate to="/select-profile" />

  return (
    <div className={`${styles.settings} ${styles.railLayout}`}>
      <nav className={styles.settingsRail} aria-label="Server settings">
        <div className={styles.railTitle}>Server settings</div>
        <Link to="/settings/server/libraries" className={styles.sectionActive} aria-current="page">
          <Icon name="folder" />
          Libraries
        </Link>
      </nav>
      <section className={styles.railContent} aria-label="Library administration">
        <Outlet />
      </section>
    </div>
  )
}
