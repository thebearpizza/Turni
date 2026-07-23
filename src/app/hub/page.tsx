import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { CalendarClock, Wallet } from 'lucide-react'

const HUB_ITEMS = [
  {
    href: '/dashboard',
    icon: CalendarClock,
    title: 'Turni',
    description: 'Gestione turni, presenze, dipendenti e ristoranti',
  },
  {
    href: '/cassa/chiusura',
    icon: Wallet,
    title: 'Cassa',
    description: 'Chiusura cassa e prima nota',
  },
]

export default async function HubPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'manager') redirect('/dashboard')

  return (
    <div className="p-6 lg:p-10 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Benvenuto</h1>
        <p className="text-muted-foreground mt-1">Scegli l&apos;area in cui vuoi lavorare.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {HUB_ITEMS.map(({ href, icon: Icon, title, description }) => (
          <Link key={href} href={href} className="block h-full">
            <Card className="h-full hover:border-primary/50 hover:shadow-md transition-all cursor-pointer">
              <CardHeader>
                <div className="w-11 h-11 rounded-lg bg-primary/10 flex items-center justify-center mb-2">
                  <Icon className="w-5 h-5 text-primary" />
                </div>
                <CardTitle className="text-lg">{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
