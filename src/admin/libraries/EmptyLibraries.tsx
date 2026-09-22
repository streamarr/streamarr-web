import { Button } from '@mantine/core'
import { Link } from '@tanstack/react-router'
import { Icon } from '../../ui/Icon'
import styles from '../Settings.module.css'

/** Successful empty inventory, shared by Home and settings. Never use for a failed query. */
export function EmptyLibraries({ canCreate }: Readonly<{ canCreate: boolean }>) {
  return (
    <div className={`${styles.settings} ${styles.empty}`}>
      <Icon name="folder" size={40} />
      <h2>{canCreate ? 'Add your first library' : 'Nothing to watch yet'}</h2>
      <p>
        {canCreate
          ? 'Choose a folder on your server to start adding movies or TV shows.'
          : 'Ask your server admin to add a library.'}
      </p>
      {canCreate && (
        <Button
          component={Link}
          to="/settings/server/libraries/new"
          leftSection={<Icon name="plus" />}
        >
          Add library
        </Button>
      )}
    </div>
  )
}
