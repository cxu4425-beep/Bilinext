import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import ServerSetup from './components/ServerSetup'
import { REMOTE_API, serverUrl, setServerKey, setServerUrl } from './api/client'
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
 * Picks up the settings from the QR code bilinext.cmd prints
 * (`.../#/setup?key=...&server=...`), so a phone never has to be told an
 * address and a key by hand.
 *
 * They ride in the fragment deliberately: fragments are never sent to a
 * server, so the key stays on the device even when the page itself is hosted
 * on GitHub Pages. It is stripped from the address bar immediately afterwards.
 */
function consumeSetupLink() {
  const { hash, search, pathname } = window.location
  const query = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : search.slice(1)
  if (!query) return
  const params = new URLSearchParams(query)
  const key = params.get('key')
  const server = params.get('server')
  if (!key && !server) return
  if (key) setServerKey(key)
  if (server) setServerUrl(server.replace(/\/+$/, ''))
  window.history.replaceState(null, '', pathname + (REMOTE_API ? '#/' : ''))
}
consumeSetupLink()

/**
 * The APK is a folder of files with no server behind it, so reloading on
 * /video/BV... has nothing to fall back to index.html; hash routes always
 * resolve. In the browser the real paths stay, so links remain shareable.
 */
const Router = REMOTE_API ? HashRouter : BrowserRouter

const root = createRoot(document.getElementById('root')!)

// Nothing in the app works until the phone knows which machine to talk to, and
// every page would render the same "cannot reach the server" state, so setup
// takes over the whole app rather than being one item buried in 設定.
if (REMOTE_API && !serverUrl()) {
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
