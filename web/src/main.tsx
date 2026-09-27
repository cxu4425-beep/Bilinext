import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import ServerSetup from './components/ServerSetup'
import { NATIVE, serverUrl } from './api/client'
import './styles/index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: (failureCount, error: any) => {
        // Re-requesting a 401 or a risk-control 429 just burns the account's
        // budget; only transient failures are worth retrying. A dead server is
        // not transient either -- retrying just delays the message that would
        // tell the user to start it.
        if (error?.needsLogin || error?.riskControlled || error?.offline) return false
        return failureCount < 2
      },
      refetchOnWindowFocus: false,
    },
  },
})

const saved = localStorage.getItem('bili.theme')
if (saved) document.documentElement.dataset.theme = saved

/**
 * The APK is a folder of files with no server behind it, so reloading on
 * /video/BV... has nothing to fall back to index.html; hash routes always
 * resolve. In the browser the real paths stay, so links remain shareable.
 */
const Router = NATIVE ? HashRouter : BrowserRouter

const root = createRoot(document.getElementById('root')!)

// Nothing in the app works until the phone knows which machine to talk to, and
// every page would render the same "cannot reach the server" state, so setup
// takes over the whole app rather than being one item buried in 設定.
if (NATIVE && !serverUrl()) {
  root.render(
    <React.StrictMode>
      <ServerSetup />
    </React.StrictMode>,
  )
} else {
  root.render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <Router>
          <App />
        </Router>
      </QueryClientProvider>
    </React.StrictMode>,
  )
}
