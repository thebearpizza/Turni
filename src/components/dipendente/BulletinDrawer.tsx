'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { X, Megaphone, Globe, Store, Users, ChevronDown } from 'lucide-react'
import { formatInTimeZone } from 'date-fns-tz'

const TZ = 'Europe/Rome'

type Bulletin = {
  id: string
  title: string
  body: string
  target: 'all' | 'restaurant' | 'role' | 'users' | 'department'
  target_user_ids: string[]
  created_at: string
  author?: { full_name: string } | null
}

interface Props {
  userId: string
  onClose: () => void
}

function TargetChip({ target }: { target: Bulletin['target'] }) {
  const base = 'shrink-0 flex items-center gap-1 text-muted-foreground text-xs border border-border rounded-sm px-1.5 py-0.5 whitespace-nowrap'
  if (target === 'all')        return <span className={base}><Globe  className="w-3 h-3" /> Tutti</span>
  if (target === 'restaurant') return <span className={base}><Store  className="w-3 h-3" /> Ristorante</span>
  if (target === 'department') return <span className={base}><Store  className="w-3 h-3" /> Reparto</span>
  return                              <span className={base}><Users  className="w-3 h-3" /> Per te</span>
}

export function BulletinDrawer({ userId, onClose }: Props) {
  const [bulletins, setBulletins]   = useState<Bulletin[]>([])
  const [loading, setLoading]       = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  // track IDs already inserted in this session to avoid redundant upserts
  const [sentReadIds, setSentReadIds] = useState<Set<string>>(new Set())

  // Lock body scroll while drawer is open; restore on unmount
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('bulletins')
      .select('id, title, body, target, target_user_ids, created_at, author:profiles!created_by(full_name)')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setBulletins((data as unknown as Bulletin[]) ?? [])
        setLoading(false)
      })
  }, [userId])

  function handleToggle(b: Bulletin) {
    const opening = expandedId !== b.id
    setExpandedId(opening ? b.id : null)

    // Only fire the read receipt on the first open of each bulletin
    if (opening && !sentReadIds.has(b.id)) {
      setSentReadIds(prev => new Set(prev).add(b.id))
      const supabase = createClient()
      supabase
        .from('bulletin_reads')
        .upsert(
          [{ bulletin_id: b.id, user_id: userId }],
          { onConflict: 'bulletin_id,user_id', ignoreDuplicates: true }
        )
        .then(() => {})
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      <div
        className="relative w-full max-w-lg bg-card border-t border-border rounded-t-md overflow-hidden flex flex-col max-h-[82vh]"
        onClick={e => e.stopPropagation()}
        onTouchMove={e => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-border" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Megaphone className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-foreground text-base font-semibold tracking-tight">Bacheca</h2>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-md bg-card border border-border flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Lista */}
        <div className="overflow-y-auto flex-1 px-5 py-4">
          {loading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-14 bg-muted rounded-md animate-pulse" />
              ))}
            </div>
          ) : bulletins.length === 0 ? (
            <div className="py-12 text-center">
              <Megaphone className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">Nessun comunicato</p>
            </div>
          ) : (
            <div className="divide-y divide-border border border-border rounded-md overflow-hidden pb-safe">
              {bulletins.map(b => {
                const isOpen = expandedId === b.id
                return (
                  <div key={b.id} className="bg-muted">
                    {/* Row header — always visible, click to toggle */}
                    <button
                      onClick={() => handleToggle(b)}
                      className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-accent/50 transition-colors"
                    >
                      <ChevronDown
                        className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-foreground text-sm font-semibold leading-tight truncate">
                          {b.title}
                        </p>
                        <p className="text-muted-foreground text-xs mt-0.5 tabular-nums">
                          {b.author?.full_name && (
                            <span className="not-italic">{b.author.full_name} · </span>
                          )}
                          {formatInTimeZone(new Date(b.created_at), TZ, 'dd-MM-yyyy HH:mm')}
                        </p>
                      </div>
                      <TargetChip target={b.target} />
                    </button>

                    {/* Expanded body */}
                    {isOpen && (
                      <div className="px-4 pb-4 pt-1 border-t border-border bg-card">
                        <p className="text-foreground/80 text-sm leading-relaxed whitespace-pre-wrap">
                          {b.body}
                        </p>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
