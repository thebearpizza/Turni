import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Fatture e Articoli si sono spostati sotto /acquisti (macroarea
  // Acquisti, separata da Cassa) — redirect permanenti perché manager e
  // direttore hanno già segnalibri/schermate Home del telefono che
  // puntano alle vecchie rotte. /fatture e /articoli erano la stessa
  // vista ospitata nella shell Turni per il solo direttore, ora superflua
  // dato che il direttore ha accesso esclusivo ad Acquisti.
  async redirects() {
    return [
      { source: '/cassa/fatture', destination: '/acquisti/fatture', permanent: true },
      { source: '/cassa/articoli', destination: '/acquisti/articoli', permanent: true },
      { source: '/fatture', destination: '/acquisti/fatture', permanent: true },
      { source: '/articoli', destination: '/acquisti/articoli', permanent: true },
    ]
  },
  env: {
    NEXT_PUBLIC_SUPABASE_URL: 'https://myvflezdghrypytvdfgm.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im15dmZsZXpkZ2hyeXB5dHZkZmdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1MTg4NjQsImV4cCI6MjA5NTA5NDg2NH0.97kxoGVMM4Ptey6erKyXbpqgYYPOjTlI8XkvIlrxXB4',
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'BF0F7j9TKRhnN4r2m0Q6SPAyctMW2Du03yJ1XUIb2q7ACpr3h-tSA0skmbrCCw5BQMMjr_vROWIozkZu98MyNOo',
  },
};

export default nextConfig;
