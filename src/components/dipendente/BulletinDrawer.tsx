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
        className="relative w-full max-w-lg bg-slate-900 rounded-t-lg overflow-hidden flex flex-col max-h-[82vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-slate-700" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2">
            <Megaphone className="w-4 h-4 text-slate-400" />
            <h2 className="text-white text-base font-semibold tracking-tight">Bacheca</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-md bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Lista */}
        <div className="overflow-y-auto flex-1 px-5 py-4">
          {loading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-20 bg-slate-800 rounded-md animate-pulse" />
              ))}
            </div>
          ) : bulletins.length === 0 ? (
            <div className="py-12 text-center">
              <Megaphone className="w-8 h-8 text-slate-700 mx-auto mb-3" />
              <p className="text-slate-500 text-sm">Nessun comunicato</p>
            </div>
          ) : (
            <div className="space-y-3 pb-safe">
              {bulletins.map(b => (
                <div key={b.id} className="bg-slate-800 border border-slate-700 rounded-md p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <p className="text-white text-sm font-semibold leading-tight">{b.title}</p>
                    <span className="shrink-0 flex items-center gap-1 text-slate-500 text-xs border border-slate-700 rounded px-1.5 py-0.5 whitespace-nowrap">
                      {b.target === 'all'
                        ? <><Globe className="w-3 h-3" /> Tutti</>
                        : <><Store className="w-3 h-3" /> Ristorante</>
                      }
                    </span>
                  </div>
                  <p className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap">{b.body}</p>
                  <p className="text-slate-600 text-xs mt-2.5">
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
