import { useNavigate, useRouter } from '@tanstack/react-router'
import styles from './DetailBack.module.css'
import { Icon } from '../ui/Icon'

export const detailBackClass = styles.back

// Returns to wherever the page was opened from; a deep link with no history lands on Home.
export function DetailBackButton() {
  const router = useRouter()
  const navigate = useNavigate()

  function goBack() {
    if (router.history.length > 1) {
      router.history.back()
      return
    }
    void navigate({ to: '/' })
  }

  return (
    <button type="button" className={styles.back} onClick={goBack}>
      <Icon name="arrow-left" size={16} />
      Back
    </button>
  )
}
