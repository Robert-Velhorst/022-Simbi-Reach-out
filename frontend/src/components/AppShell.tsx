import { LanguagePicker, useI18n } from '../i18n'
import { useEffect, useId, useRef, useState } from 'react'
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import {
  BarChart3, Bell, BookOpenText, ChevronDown, ClipboardCheck, FileText, LayoutDashboard,
  LogOut, Menu, MessagesSquare, Network, ScrollText, Settings, ShieldCheck, Users,
} from 'lucide-react'
import { post } from '../api'
import type { Member } from '../types'
import Dashboard from '../pages/Dashboard'
import { CampaignsPage, ProspectsPage, TemplatesPage } from '../pages/Resources'
import ReviewQueue from '../pages/ReviewQueue'
import { AuditPage, HelpPage, RemindersPage, RepliesPage, ReportsPage } from '../pages/Operations'
import SettingsPage from '../pages/Settings'
import type { RetirementReceipt } from './RetirementControls'
import { Modal } from './ui'
import DraftLeaveGuard, { useDraftLeave } from './DraftLeaveGuard'

const navigation = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/prospects', label: 'Prospects', icon: Users },
  { to: '/campaigns', label: 'Campaigns', icon: Network },
  { to: '/templates', label: 'Templates', icon: FileText },
  { to: '/review', label: 'Review queue', icon: ClipboardCheck },
  { to: '/replies', label: 'Replies', icon: MessagesSquare },
  { to: '/reminders', label: 'Reminders', icon: Bell },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/audit', label: 'Audit log', icon: ScrollText },
  { to: '/settings', label: 'Settings', icon: Settings },
] as const

function NavigationContent({ member, onNavigate, onSignOut, includeHelp = false }: { member: Member; onNavigate: () => void; onSignOut: () => Promise<void>; includeHelp?: boolean }) {
  const { t, formatCode } = useI18n()
  return <>
    <nav aria-label={t("Primary navigation")}>
      {navigation.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === '/'} onClick={onNavigate} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><Icon size={19} /><span>{t(label)}</span></NavLink>)}
      {includeHelp ? <NavLink to="/help" onClick={onNavigate} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><BookOpenText size={19} /><span>{t("Help")}</span></NavLink> : null}
    </nav>
    <div className={`safety-card ${member.paused_at ? 'safety-paused' : ''}`}>
      <ShieldCheck size={19} />
      <div><strong>{member.paused_at ? t("Safety stop active") : t("Assisted mode")}</strong><small>{member.paused_at ? t("External handoffs blocked") : t("No automatic sending")}</small></div>
    </div>
    <div className="sidebar-user"><div className="avatar">{member.display_name.slice(0, 1).toUpperCase()}</div><div><strong>{member.display_name}</strong><small>{formatCode(member.role)} {' '}{t("· local user")}</small></div><ChevronDown size={16} /></div>
    <button className="nav-link signout" onClick={onSignOut}><LogOut size={18} />{t("Sign out")}</button>
  </>
}

export default function AppShell({ member, onMemberChange, onSignedOut, onRetired }: { member: Member; onMemberChange: (member: Member) => void; onSignedOut: () => void; onRetired?: (receipt: RetirementReceipt) => void }) {
  return <DraftLeaveGuard><Shell member={member} onMemberChange={onMemberChange} onSignedOut={onSignedOut} onRetired={onRetired} /></DraftLeaveGuard>
}

function Shell({ member, onMemberChange, onSignedOut, onRetired }: { member: Member; onMemberChange: (member: Member) => void; onSignedOut: () => void; onRetired?: (receipt: RetirementReceipt) => void }) {
  const { t } = useI18n()
  const requestLeave = useDraftLeave()
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  const menuRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const previousPath = useRef(location.pathname)
  const mainId = useId()
  const navigationId = useId()
  const canEdit = ['owner', 'admin', 'editor'].includes(member.role)

  useEffect(() => {
    if (previousPath.current !== location.pathname) {
      previousPath.current = location.pathname
      mainRef.current?.focus()
    }
  }, [location.pathname])

  useEffect(() => {
    if (!open || typeof window.matchMedia !== 'function') return
    const mobile = window.matchMedia('(max-width: 980px)')
    const onChange = (event: MediaQueryListEvent) => {
      if (!event.matches) {
        returnFocusRef.current = mainRef.current
        setOpen(false)
      }
    }
    mobile.addEventListener('change', onChange)
    return () => mobile.removeEventListener('change', onChange)
  }, [open])

  function navigate() {
    // Drawer dismissal restores the destination rather than a now-hidden link.
    returnFocusRef.current = mainRef.current
    setOpen(false)
    mainRef.current?.focus()
  }

  async function completeSignOut() {
    await post('/auth/logout', {})
    onSignedOut()
  }

  async function signOut() {
    navigate()
    requestLeave(() => { void completeSignOut() })
  }

  return <div className="app-shell">
    <a className="skip-link" href={`#${mainId}`} onClick={(event) => { event.preventDefault(); mainRef.current?.focus() }}>{t("Skip to main content")}</a>
    <aside className="sidebar">
      <div className="sidebar-brand"><span className="brand-mark small"><Network /></span><strong>Simbi Reach-Out</strong></div>
      <NavigationContent member={member} onNavigate={navigate} onSignOut={signOut} />
    </aside>
    {open ? <Modal id={navigationId} className="navigation-dialog" title={t("Primary navigation")} returnFocusRef={returnFocusRef} onClose={() => setOpen(false)}>
      <div className="navigation-content"><NavigationContent member={member} onNavigate={navigate} onSignOut={signOut} includeHelp /></div>
    </Modal> : null}
    <div className="app-main">
      <header className="topbar">
        <button ref={menuRef} className="mobile-menu" onClick={() => { returnFocusRef.current = menuRef.current; setOpen(true) }} aria-label={t("Open navigation")} aria-expanded={open} aria-controls={navigationId} aria-haspopup="dialog"><Menu /></button>
        <LanguagePicker />
        <span className="mode-label"><ShieldCheck size={17} />{member.demo_mode ? t("DEMO · EXTERNAL ACTIONS BLOCKED") : t("LOCAL ASSISTED MODE")}</span>
        <span className="local-indicator"><i />{t("Data stored locally")}</span>
        <Link className="help-link" to="/help"><BookOpenText size={17} />{t("Help")}</Link>
      </header>
      <main ref={mainRef} id={mainId} className="content" tabIndex={-1} aria-label={t("Main content")}>
        <Routes>
          <Route path="/" element={<Dashboard member={member} />} />
          <Route path="/prospects" element={<ProspectsPage canEdit={canEdit} />} />
          <Route path="/campaigns" element={<CampaignsPage member={member} onMemberChange={onMemberChange} />} />
          <Route path="/templates" element={<TemplatesPage canEdit={canEdit} />} />
          <Route path="/review" element={<ReviewQueue member={member} onMemberChange={onMemberChange} />} />
          <Route path="/replies" element={<RepliesPage canEdit={canEdit} />} />
          <Route path="/reminders" element={<RemindersPage canEdit={canEdit} />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/settings" element={<SettingsPage member={member} onMemberChange={onMemberChange} onRetired={onRetired} />} />
          <Route path="/help" element={<HelpPage />} />
        </Routes>
      </main>
    </div>
  </div>
}
