// A strict engine selector: never silently fall back to Chromium or a user's profile.
export function selectBrowser(playwright, name = process.env.SIMBI_E2E_BROWSER ?? 'chromium') {
  if (!['chromium', 'firefox', 'webkit'].includes(name)) {
    throw new Error('SIMBI_E2E_BROWSER must be chromium, firefox, or webkit')
  }
  return { name, type: playwright[name] }
}
