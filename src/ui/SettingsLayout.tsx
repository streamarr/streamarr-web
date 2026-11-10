import { Link, Outlet, useMatchRoute, type LinkProps } from '@tanstack/react-router'
import styles from '../styles/settings.module.css'
import { Icon, type IconName } from './Icon'

/** One page of a settings area: where it lives, and how the menu and the page region say it. */
export interface SettingsSection {
  to: NonNullable<LinkProps['to']>
  icon: IconName
  label: string
  region: string
}

/** A settings area: its menu of sections beside the page of the section that the route shows. */
export function SettingsLayout({
  title,
  sections,
}: Readonly<{ title: string; sections: readonly SettingsSection[] }>) {
  const matchRoute = useMatchRoute()
  const current = sections.find((section) => matchRoute({ to: section.to, fuzzy: true }))
  return (
    <div className={`${styles.settings} ${styles.railLayout}`}>
      <nav className={styles.settingsRail} aria-label={title}>
        <div className={styles.railTitle}>{title}</div>
        {sections.map((section) => (
          <Link
            key={section.to}
            to={section.to}
            className={styles.section}
            aria-current={section === current ? 'page' : undefined}
          >
            <Icon name={section.icon} size={16} />
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
