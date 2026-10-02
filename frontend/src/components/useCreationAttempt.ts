import { useRef, useState } from 'react'
import { post } from '../api'

type CreationPath = '/campaigns' | '/prospects' | '/templates' | '/drafts' | '/replies' | '/prospects/import'

export function useCreationAttempt() {
  const key = useRef<string | null>(null)
  const [reference, setReference] = useState<string | null>(null)
  async function submit(path: CreationPath, body: unknown) {
    try {
      // Only the opaque reference lives in RAM, not another private body copy.
      // api() verifies the matching receipt AND existing semantic confirmation.
      key.current ??= crypto.randomUUID()
      await post(path, body, { 'Idempotency-Key': key.current })
      key.current = null; setReference(null)
    } catch (cause) {
      setReference(key.current)
      throw cause
    }
  }
  return { reference, submit }
}
