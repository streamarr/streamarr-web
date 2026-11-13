import { Button } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'
import { Icon } from '../ui/Icon'
import { useArrivingShareCode } from './arrivingShareCode'
import { ShareForm } from './ShareForm'
import styles from './Sharing.module.css'
import type { ProfileShareRow } from './WhereShared'

/**
 * The action that shares a Profile with another Household. Its form opens in its place, so the
 * Households that the Profile is already shared with stay in view.
 */
export function ShareWithAnotherHousehold({
  profile,
  shares,
  readAgain,
  onSend,
  readShares,
  onChanged,
}: Readonly<{
  profile: Readonly<{ id: string; name: string }>
  /** The shares that the page lists now. */
  shares: readonly ProfileShareRow[]
  readAgain: () => Promise<unknown>
  /** Called when the person sends the share, before the server answers. */
  onSend: () => void
  /** Reads the shares that the page lists, or gives nothing when the read fails. */
  readShares: () => Promise<readonly ProfileShareRow[] | undefined>
  onChanged: (notice: string) => void
}>) {
  const arriving = useArrivingShareCode()
  const [open, setOpen] = useState(arriving.code !== null)
  /** The shares listed when the form opened: one that is listed later and not among them is new. */
  const listedAtOpen = useRef(shares.map((share) => share.id))
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
        onClick={() => {
          listedAtOpen.current = shares.map((share) => share.id)
          setOpen(true)
        }}
      >
        Share with another Household
      </Button>
    )
  }

  return (
    <ShareForm
      profile={profile}
      onSend={onSend}
      codeFromLink={arriving.code}
      onCodeFromLinkTaken={arriving.take}
      onOffered={async (householdName) => {
        await readAgain()
        setOpen(false)
        onChanged(`Invitation sent to ${householdName}. An admin there must accept it.`)
      }}
      findSent={async () => {
        const read = await readShares()
        if (read === undefined) return null
        return read.some((share) => !listedAtOpen.current.includes(share.id))
      }}
      onCancel={() => {
        returnFocus.current = true
        setOpen(false)
      }}
    />
  )
}
