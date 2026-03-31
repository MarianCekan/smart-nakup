import { betterAuth } from 'better-auth'
import { Pool } from 'pg'
import { Resend } from 'resend'

// pg.Pool has a `connect` method → Better Auth auto-detects it as PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

const resend = new Resend(process.env.RESEND_API_KEY)

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET ?? 'fallback-secret',
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3001',
  trustedOrigins: [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:3000',
    'https://smart-nakup.vercel.app',
    ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
  ],
  database: pool as any,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      // Redirect after verification should go to frontend
      const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173'
      const verifyUrl = url.replace(/callbackURL=[^&]+/, `callbackURL=${encodeURIComponent(frontendUrl)}`)
      console.log(`📧 Posielam overovací email na ${user.email}, url: ${verifyUrl}`)
      const result = await resend.emails.send({
        from: 'SmartNákup <noreply@kvalityweb.sk>',
        to: user.email,
        subject: 'Potvrďte svoju e-mailovú adresu',
        html: `
          <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 32px;">
            <h2 style="color: #1a7f37;">SmartNákup — Overenie e-mailu</h2>
            <p>Ahoj,</p>
            <p>Klikni na tlačidlo nižšie pre potvrdenie tvojej e-mailovej adresy:</p>
            <a href="${verifyUrl}" style="display:inline-block;margin:16px 0;padding:12px 24px;background:#1a7f37;color:#fff;border-radius:6px;text-decoration:none;font-weight:bold;">
              Potvrdiť e-mail
            </a>
            <p style="color:#666;font-size:13px;">Ak si si nezaregistroval účet, tento e-mail ignoruj.</p>
          </div>
        `,
      })
      console.log(`📧 Resend result:`, JSON.stringify(result))
    },
  },
})
