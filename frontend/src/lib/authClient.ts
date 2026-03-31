import { createAuthClient } from 'better-auth/react'

// V produkcii (Vercel): auth ide cez /api/auth/... proxy na vercel.app
// → cookie je same-origin → Safari/iOS ITP neblokuje
// Lokálne: ide priamo na localhost:3001
const isProd = typeof window !== 'undefined' && !window.location.hostname.includes('localhost')
const authBase = isProd
  ? window.location.origin
  : (import.meta.env.VITE_API_URL ?? 'http://localhost:3001')

export const authClient = createAuthClient({
  baseURL: authBase,
  fetchOptions: {
    credentials: 'include',
  },
})
