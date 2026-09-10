import { createFileRoute } from '@tanstack/react-router'
import { Home } from '../../home/Home'

export const Route = createFileRoute('/_authenticated/')({
  component: Home,
})
