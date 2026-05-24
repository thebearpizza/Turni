'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { X, Megaphone, Globe, Store } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { it } from 'date-fns/locale'

type Bulletin = {
  id: string
  title: string
  body: string
  target: 'all' | 'restaurant'
  created_at: string
}

interface Props {
  onClose: () => void
}

export function BulletinDrawer({ onClose }: Props) {
  const [bulletins, setBulletins] = useState<Bulletin[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('bulletins')
      .select('id, title, body, target, created_at')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setBulletins((data as Bulletin[]) ?? [])
        setLoading(false)
      })
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      <div
        className="relative w-full max-w-lg bg-card border-t border-border rounded-t-md overflow-hidden flex flex-col max-h-[82vh]"
        onClick={e => e.stopPropagation()}
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
                <div key={i} className="h-20 bg-muted rounded-md animate-pulse" />
              ))}
            </div>
          ) : bulletins.length === 0 ? (
            <div className="py-12 text-center">
              <Megaphone className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">Nessun comunicato</p>
            </div>
          ) : (
            <div className="space-y-3 pb-safe">
              {bulletins.map(b => (
                <div key={b.id} className="bg-muted border border-border rounded-md p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <p className="text-foreground text-sm font-semibold leading-tight">{b.title}</p>
                    <span className="shrink-0 flex items-center gap-1 text-muted-foreground text-xs border border-border rounded-sm px-1.5 py-0.5 whitespace-nowrap">
                      {b.target === 'all'
                        ? <><Globe className="w-3 h-3" /> Tutti</>
                        : <><Store className="w-3 h-3" /> Ristorante</>
                      }
                    </span>
                  </div>
                  <p className="text-foreground/80 text-sm leading-relaxed whitespace-pre-wrap">{b.body}</p>
                  <p className="text-muted-foreground text-xs mt-2.5">
                    {formatDistanceToNow(new Date(b.created_at), { addSuffix: true, locale: it })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
