import { Button } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'
import { Icon } from '../ui/Icon'
import { useArrivingShareCode } from './arrivingShareCode'
import { ShareForm } from './ShareForm'
import styles from './Sharing.module.css'

/**
 * The action that shares a Profile with another Household. Its form opens in its place, so the
 * Households that the Profile is already shared with stay in view.
 */
export function ShareWithAnotherHousehold({
  profile,
  readAgain,
  onChanged,
}: Readonly<{
  profile: Readonly<{ id: string; name: string }>
  readAgain: () => Promise<unknown>
  onChanged: (notice: string) => void
}>) {
  const arriving = useArrivingShareCode()
  const [open, setOpen] = useState(arriving.code !== null)
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
      codeFromLink={arriving.code}
      onCodeFromLinkTaken={arriving.take}
      onOffered={async (householdName) => {
        await readAgain()
        setOpen(false)
        onChanged(`Offer sent to ${householdName}. An admin there must accept it.`)
      }}
      onCancel={() => {
        returnFocus.current = true
        setOpen(false)
      }}
    />
  )
}
