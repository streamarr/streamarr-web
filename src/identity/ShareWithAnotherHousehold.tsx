import { Button } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'
import { Icon } from '../ui/Icon'
import { ShareForm } from './ShareForm'
import styles from './Sharing.module.css'

/**
 * The action that shares a Profile with another Household. Its form opens in its place, so the
 * Households that the Profile is already shared with stay in view.
 */
export function ShareWithAnotherHousehold({
  profile,
  readAgain,
  onSend,
  onChanged,
}: Readonly<{
  profile: Readonly<{ id: string; name: string }>
  readAgain: () => Promise<unknown>
  /** Called when the person sends the share, before the server answers. */
  onSend: () => void
  onChanged: (notice: string) => void
}>) {
  const [open, setOpen] = useState(false)
  const action = useRef<HTMLButtonElement>(null)
  /** Set when the person leaves the form, so that focus returns to the action they left. */
  const returnFocus = useRef(false)

  useEffect(() => {
    if (open || !returnFocus.current) return
    returnFocus.current = false
    action.current?.focus()
  }, [open])

  if (!open) {
    return (
      <Button
        ref={action}
        className={styles.share}
        variant="default"
        leftSection={<Icon name="plus" />}
        onClick={() => setOpen(true)}
      >
        Share with another Household
      </Button>
    )
  }

  return (
    <ShareForm
      profile={profile}
      onSend={onSend}
      onOffered={async () => {
        await readAgain()
        setOpen(false)
        onChanged('Invitation sent. An admin there must accept it.')
      }}
      onCancel={() => {
        returnFocus.current = true
        setOpen(false)
      }}
    />
  )
}
