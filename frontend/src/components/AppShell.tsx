import { LanguagePicker, useI18n } from '../i18n'
import { useState } from 'react'
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import {
  BarChart3, Bell, BookOpenText, ChevronDown, ClipboardCheck, FileText, LayoutDashboard,
  LogOut, Menu, MessagesSquare, Network, ScrollText, Settings, ShieldCheck, Users, X,
} from 'lucide-react'
import { post } from '../api'
import type { Member } from '../types'
import Dashboard from '../pages/Dashboard'
import { CampaignsPage, ProspectsPage, TemplatesPage } from '../pages/Resources'
import ReviewQueue from '../pages/ReviewQueue'
import { AuditPage, HelpPage, RemindersPage, RepliesPage, ReportsPage } from '../pages/Operations'
import SettingsPage from '../pages/Settings'

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

export default function AppShell({ member, onMemberChange, onSignedOut }: { member: Member; onMemberChange: (member: Member) => void; onSignedOut: () => void }) {
  const { t, formatCode } = useI18n()
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const canEdit = ['owner', 'admin', 'editor'].includes(member.role)

  async function signOut() {
    await post('/auth/logout', {})
    onSignedOut()
  }

  return <div className="app-shell">
    <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
      <div className="sidebar-brand"><span className="brand-mark small"><Network /></span><strong>Simbi Reach-Out</strong><button className="mobile-close" onClick={() => setOpen(false)} aria-label={t("Close navigation")}><X /></button></div>
      <nav aria-label={t("Primary navigation")}>
        {navigation.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === '/'} onClick={() => setOpen(false)} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><Icon size={19} /><span>{t(label)}</span></NavLink>)}
      </nav>
      <div className={`safety-card ${member.paused_at ? 'safety-paused' : ''}`}>
        <ShieldCheck size={19} />
        <div><strong>{member.paused_at ? t("Safety stop active") : t("Assisted mode")}</strong><small>{member.paused_at ? t("External handoffs blocked") : t("No automatic sending")}</small></div>
      </div>
      <div className="sidebar-user"><div className="avatar">{member.display_name.slice(0, 1).toUpperCase()}</div><div><strong>{member.display_name}</strong><small>{formatCode(member.role)} {' '}{t("· local user")}</small></div><ChevronDown size={16} /></div>
      <button className="nav-link signout" onClick={signOut}><LogOut size={18} />{t("Sign out")}</button>
    </aside>
    {open ? <button className="sidebar-scrim" onClick={() => setOpen(false)} aria-label={t("Close navigation")} /> : null}
    <div className="app-main">
      <header className="topbar">
        <button className="mobile-menu" onClick={() => setOpen(true)} aria-label={t("Open navigation")}><Menu /></button>
        <LanguagePicker />
        <span className="mode-label"><ShieldCheck size={17} />{member.demo_mode ? t("DEMO · EXTERNAL ACTIONS BLOCKED") : t("LOCAL ASSISTED MODE")}</span>
        <span className="local-indicator"><i />{t("Data stored locally")}</span>
        <Link className="help-link" to="/help"><BookOpenText size={17} />{t("Help")}</Link>
      </header>
      <main className="content" key={location.pathname}>
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
          <Route path="/settings" element={<SettingsPage member={member} onMemberChange={onMemberChange} />} />
          <Route path="/help" element={<HelpPage />} />
        </Routes>
      </main>
    </div>
  </div>
}
