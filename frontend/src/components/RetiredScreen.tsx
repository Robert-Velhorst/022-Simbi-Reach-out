import { LanguagePicker, useI18n } from '../i18n'
import { useEffect, useRef } from 'react'
import type { RetirementReceipt } from './RetirementControls'
import { Notice, Panel } from './ui'

export default function RetiredScreen({ receipt }: { receipt: RetirementReceipt | null }) {
  const { t, formatDate } = useI18n()
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    // Settings may have been far down a long page when it was removed.
    document.documentElement.scrollTop = 0; document.body.scrollTop = 0
    heading.current?.focus({ preventScroll: true })
  }, [])
  return <main className="boot-failure"><LanguagePicker /><h1 ref={heading} tabIndex={-1}>{t('Local installation retired')}</h1>
    <p>{t('The local account and workspace are unavailable. Sign-in and new setup are blocked so lost safety history cannot silently become a fresh outreach workspace.')}</p>
    {receipt ? <Panel title={t('Retirement completion receipt')}><p>{t('Retirement recorded at {date}. Recovery file: {file}.', { date: formatDate(receipt.completed_at), file: receipt.backup_file })}</p><p>{t('Removed {accounts} local accounts and {workspaces} workspaces.', { accounts: receipt.counts.users, workspaces: receipt.counts.workspaces })}</p></Panel> : null}
    <Notice tone="warning">{t('This is not secure erasure. Simbi and existing backups, exports, browser downloads and HAI copies are unchanged and may still contain private data.')}</Notice>
    <p>{t('For recovery, stop the app and worker, then use the documented offline backup restore. The recovery copy restores the paused workspace and its previous credentials and safety history. Do not create a new database to bypass lost restrictions.')}</p>
  </main>
}
