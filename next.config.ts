import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_SUPABASE_URL: 'https://myvflezdghrypytvdfgm.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im15dmZsZXpkZ2hyeXB5dHZkZmdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1MTg4NjQsImV4cCI6MjA5NTA5NDg2NH0.97kxoGVMM4Ptey6erKyXbpqgYYPOjTlI8XkvIlrxXB4',
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'BF0F7j9TKRhnN4r2m0Q6SPAyctMW2Du03yJ1XUIb2q7ACpr3h-tSA0skmbrCCw5BQMMjr_vROWIozkZu98MyNOo',
  },
};

export default nextConfig;
