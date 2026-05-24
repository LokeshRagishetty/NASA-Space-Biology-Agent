import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Rocket, ShieldCheck, Sparkles } from 'lucide-react'
import missionPatch from '../assets/mission-patch.svg'

export default function AuthLayout({ children, title, subtitle, footer }) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-space-radial text-white light:bg-slate-50 light:text-slate-950">
      <div className="space-grid absolute inset-0 opacity-80" />
      <div className="star-field absolute inset-0 animate-drift opacity-50" />
      <div className="absolute left-[-12rem] top-[-12rem] h-96 w-96 rounded-full bg-comet/20 blur-3xl" />
      <div className="absolute bottom-[-14rem] right-[-8rem] h-96 w-96 rounded-full bg-solar/20 blur-3xl" />

      <section className="relative mx-auto grid min-h-screen w-full max-w-7xl grid-cols-1 gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:px-8">
        <div className="hidden flex-col justify-between rounded-[2rem] border border-white/10 bg-white/[0.05] p-8 shadow-panel backdrop-blur-2xl light:border-slate-200 light:bg-white/70 lg:flex">
          <Link to="/" className="flex w-fit items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-comet to-solar text-slate-950">
              <Rocket className="h-6 w-6" />
            </span>
            <span>
              <span className="block text-sm font-semibold uppercase tracking-[0.24em] text-comet">
                NASA Space Biology
              </span>
              <span className="text-2xl font-semibold">AI Agent</span>
            </span>
          </Link>

          <div className="mx-auto flex max-w-lg flex-col items-center text-center">
            <motion.img
              src={missionPatch}
              alt="NASA Space Biology mission patch"
              className="mb-8 h-64 w-64 drop-shadow-[0_0_80px_rgba(120,231,255,0.24)]"
              initial={{ opacity: 0, scale: 0.94, rotate: -4 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              transition={{ duration: 0.5 }}
            />
            <h1 className="text-5xl font-semibold leading-tight tracking-tight">
              Explore space biology with a private research cockpit.
            </h1>
            <p className="mt-5 text-base leading-7 text-slate-300 light:text-slate-600">
              Search NASA ADS, synthesize web evidence, and keep your mission notes tied to your account.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-3xl border border-white/10 bg-white/[0.05] p-4 light:border-slate-200 light:bg-white">
              <ShieldCheck className="mb-3 h-5 w-5 text-aurora" />
              <p className="text-sm font-medium">JWT secured</p>
              <p className="text-xs text-slate-400 light:text-slate-500">Protected AI sessions</p>
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/[0.05] p-4 light:border-slate-200 light:bg-white">
              <Sparkles className="mb-3 h-5 w-5 text-solar" />
              <p className="text-sm font-medium">Groq powered</p>
              <p className="text-xs text-slate-400 light:text-slate-500">Fast answer synthesis</p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-center">
          <motion.div
            className="glass-panel w-full max-w-md rounded-[2rem] p-6 sm:p-8"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
          >
            <div className="mb-7">
              <div className="mb-5 flex items-center gap-3 lg:hidden">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-comet to-solar text-slate-950">
                  <Rocket className="h-5 w-5" />
                </span>
                <span className="font-semibold">NASA Space Biology AI Agent</span>
              </div>
              <h2 className="text-3xl font-semibold tracking-tight text-white light:text-slate-950">
                {title}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-400 light:text-slate-600">{subtitle}</p>
            </div>

            {children}

            {footer && <div className="mt-6 text-center text-sm text-slate-400 light:text-slate-600">{footer}</div>}
          </motion.div>
        </div>
      </section>
    </main>
  )
}
